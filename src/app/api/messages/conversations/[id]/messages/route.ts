import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { getBrandConfig } from "@/config/brands";

/**
 * Messages API for a conversation
 *
 * - GET /api/messages/conversations/:id/messages
 *   Lists messages for the given conversationId. Caller must be a participant.
 *   Query params:
 *     - page?: number (default 0)
 *     - limit?: number (default 50)
 *
 * - POST /api/messages/conversations/:id/messages
 *   Sends a message in the conversation. Caller must be a participant.
 *   Body:
 *     { body: string }
 *
 * Doc shape:
 * {
 *   id: "message:<uuid>",
 *   type: "message",
 *   wallet: "<partitionKey>",          // same partition key as conversation (first participant)
 *   brandKey: "<brand>",
 *   conversationId: string,
 *   senderWallet: string,
 *   body: string,
 *   createdAt: number,
 *   readBy: string[]                   // wallets who have read this message
 * }
 */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Simple in-memory rate limiter (best-effort)
const RL_STORE = new Map<string, { count: number; resetAt: number }>();
function getClientIp(req: NextRequest): string {
  const xf = req.headers.get("x-forwarded-for") || "";
  const xr = req.headers.get("x-real-ip") || "";
  const ip = xf.split(",")[0].trim() || xr || "unknown";
  return ip;
}
function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const bucket = RL_STORE.get(key);
  if (!bucket || now >= bucket.resetAt) {
    RL_STORE.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfter: 0, resetAt: now + windowMs };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return { limited: true, retryAfter: Math.ceil((bucket.resetAt - now) / 1000), resetAt: bucket.resetAt };
  }
  RL_STORE.set(key, bucket);
  return { limited: false, retryAfter: 0, resetAt: bucket.resetAt };
}

async function resolveCallerWallet(req: NextRequest): Promise<string> {
  try {
    const caller = await requireThirdwebAuth(req);
    if (caller?.wallet) return String(caller.wallet).toLowerCase();
  } catch {}
  const headerWallet = req.headers.get("x-client-wallet") || req.headers.get("x-guest-wallet") || "";
  const normalized = String(headerWallet || "").toLowerCase();
  if (/^0x[a-f0-9]{40}$/i.test(normalized)) {
    return normalized;
  }
  throw new Error("unauthorized");
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  try {
    const me = await resolveCallerWallet(req);

    if (!/^0x[a-f0-9]{40}$/i.test(me)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const { id } = await context.params;
    const conversationId = String(decodeURIComponent(id || "")).trim();
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "conversation_id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const url = new URL(req.url);
    const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? "0")));
    const limit = clamp(Math.floor(Number(url.searchParams.get("limit") ?? "50")) || 50, 1, 200);

    // Rate limit: messages list per wallet + conversation + IP
    {
      const ip = getClientIp(req);
      const rl = rateLimit(`msg:GET:${me}:${conversationId}:${ip}`, 300, 10 * 60000);
      if (rl.limited) {
        return NextResponse.json(
          { ok: false, error: "rate_limited" },
          { status: 429, headers: { "x-correlation-id": correlationId, "retry-after": String(rl.retryAfter) } }
        );
      }
    }

    const container = await getContainer();

    // Validate caller participation by reading conversation doc across partitions:
    // Conversations were stored under the first participant partition key, but we can search cross-partition by id.
    const convoSpec = {
      query:
        "SELECT c.id, c.wallet, c.participants, c.brandKey FROM c WHERE c.type='conversation' AND c.id=@id",
      parameters: [{ name: "@id", value: conversationId }],
    } as { query: string; parameters: { name: string; value: any }[] };

    const { resources: convos } = await container.items.query(convoSpec).fetchAll();
    let convo = Array.isArray(convos) ? convos.find((c: any) => String(c?.id || "") === conversationId) : null;

    // Fallback: try direct partition read using caller wallet
    if (!convo) {
      try {
        const { resource } = await container.item(conversationId, me).read<any>();
        if (resource && String(resource?.id || "") === conversationId) {
          convo = resource;
        }
      } catch { }
    }

    if (!convo) {
      // Retry once after a short delay to handle eventual consistency
      try {
        await sleep(200);
        const { resource } = await container.item(conversationId, me).read<any>();
        if (resource && String(resource?.id || "") === conversationId) {
          convo = resource;
        }
      } catch { }
    }

    if (!convo) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: { "x-correlation-id": correlationId } }
      );
    }
    const participantsLc = Array.isArray(convo.participants)
      ? convo.participants.map((w: any) => String(w || "").toLowerCase().trim())
      : [];
    const convoWallet = String(convo.wallet || "").toLowerCase().trim();
    const meTrim = String(me).toLowerCase().trim();
    if (participantsLc.length === 0 || (!participantsLc.includes(meTrim) && convoWallet !== meTrim)) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }
    // Brand check disabled for simplicity: allow messaging across brands if participants include caller.
    // This avoids false 404 when host domain brand differs from conversation brand.

    // Fetch messages by conversationId (cross-partition)
    const msgSpec = {
      query:
        "SELECT * FROM c WHERE c.type='message' AND c.conversationId=@cid ORDER BY c.createdAt DESC",
      parameters: [{ name: "@cid", value: conversationId }],
    } as { query: string; parameters: { name: string; value: any }[] };

    const { resources } = await container.items.query(msgSpec).fetchAll();
    const rows = Array.isArray(resources) ? resources : [];

    const total = rows.length;
    const start = page * limit;
    const end = start + limit;
    const items = rows.slice(start, end).reverse(); // chronological ascending in UI

    return NextResponse.json({ ok: true, items, total, page, pageSize: limit }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const correlationId = crypto.randomUUID();
  try {
    const senderWallet = await resolveCallerWallet(req);

    if (!/^0x[a-f0-9]{40}$/i.test(senderWallet)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const { id } = await context.params;
    const conversationId = String(decodeURIComponent(id || "")).trim();
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "conversation_id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const bodyJson = await req.json().catch(() => ({}));
    const textBody = typeof bodyJson?.body === "string" ? String(bodyJson.body).slice(0, 5000) : "";
    const attachments = Array.isArray(bodyJson?.attachments) ? bodyJson.attachments.filter((a: any) => typeof a === 'string') : [];

    // Rate limit: messages send per wallet + conversation
    {
      const rl = rateLimit(`msg:POST:${senderWallet}:${conversationId}`, 120, 10 * 60000);
      if (rl.limited) {
        return NextResponse.json(
          { ok: false, error: "rate_limited" },
          { status: 429, headers: { "x-correlation-id": correlationId, "retry-after": String(rl.retryAfter) } }
        );
      }
    }

    if (!textBody && attachments.length === 0) {
      return NextResponse.json(
        { ok: false, error: "body_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // Read conversation doc
    const convoSpec = {
      query:
        "SELECT c.id, c.wallet, c.participants, c.brandKey, c.subject FROM c WHERE c.type='conversation' AND c.id=@id",
      parameters: [{ name: "@id", value: conversationId }],
    } as { query: string; parameters: { name: string; value: any }[] };

    const { resources: convos } = await container.items.query(convoSpec).fetchAll();
    let convo = Array.isArray(convos) ? convos.find((c: any) => String(c?.id || "") === conversationId) : null;

    // Fallback: try direct partition read using sender wallet
    if (!convo) {
      try {
        const { resource } = await container.item(conversationId, senderWallet).read<any>();
        if (resource && String(resource?.id || "") === conversationId) {
          convo = resource;
        }
      } catch { }
    }

    if (!convo) {
      // Retry once after a short delay to handle eventual consistency
      try {
        await sleep(200);
        const { resource } = await container.item(conversationId, senderWallet).read<any>();
        if (resource && String(resource?.id || "") === conversationId) {
          convo = resource;
        }
      } catch { }
    }

    if (!convo) {
      return NextResponse.json(
        { ok: false, error: "not_found" },
        { status: 404, headers: { "x-correlation-id": correlationId } }
      );
    }
    const participantsLc2 = Array.isArray(convo.participants)
      ? convo.participants.map((w: any) => String(w || "").toLowerCase().trim())
      : [];
    const convoWallet2 = String(convo.wallet || "").toLowerCase().trim();
    const senderTrim = String(senderWallet).toLowerCase().trim();
    if (participantsLc2.length === 0 || (!participantsLc2.includes(senderTrim) && convoWallet2 !== senderTrim)) {
      return NextResponse.json(
        { ok: false, error: "forbidden" },
        { status: 403, headers: { "x-correlation-id": correlationId } }
      );
    }

    const partitionKey = String(convo.wallet || convo.participants?.[0] || senderWallet).toLowerCase();
    const brandKey = String(convo.brandKey || "").toLowerCase();
    const ts = Date.now();

    const msgDoc = {
      id: `message:${crypto.randomUUID()}`,
      type: "message",
      wallet: partitionKey,
      brandKey,
      conversationId,
      senderWallet,
      body: textBody,
      attachments,
      createdAt: ts,
      readBy: [senderWallet],
    };

    // Write message
    await container.items.upsert(msgDoc as any);

    // Update conversation lastMessageAt
    try {
      const convoDoc = { ...convo, lastMessageAt: ts, updatedAt: ts };
      await container.items.upsert(convoDoc as any);
    } catch { }

    // Asynchronously dispatch email notification if sender is messaging a merchant
    try {
      const recipientWallet = (
        (convo.subject?.type === "merchant" && convo.subject?.id)
          ? String(convo.subject.id).toLowerCase()
          : (Array.isArray(convo.participants)
              ? convo.participants.find((p: string) => String(p || "").toLowerCase() !== senderWallet.toLowerCase())
              : "")
      ) || "";

      if (recipientWallet && /^0x[a-f0-9]{40}$/i.test(recipientWallet)) {
        const { triggerNotification } = await import("@/lib/notifications/dispatcher");
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://surge.basalthq.com";
        triggerNotification("merchant", recipientWallet, "live_client_message", {
          title: "Live Customer Message",
          subtitle: convo.subject?.id ? `Subject: ${convo.subject.id}` : `Conversation #${conversationId.slice(-8)}`,
          message: textBody || "Sent an attachment",
          details: [
            { label: "Customer Wallet", value: senderWallet, isCode: true },
            { label: "Subject", value: convo.subject?.id || "Checkout Inquiry" },
            { label: "Received At", value: new Date(ts).toLocaleString() }
          ],
          ctaText: "Reply in Admin Console",
          ctaUrl: `${appUrl}/admin?tab=messages-merchant`
        }).catch(err => console.error("[Messages API] Notification error:", err));
      }
    } catch {}

    return NextResponse.json({ ok: true, message: msgDoc }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}

