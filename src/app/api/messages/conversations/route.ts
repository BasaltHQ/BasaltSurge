import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { getBrandConfig } from "@/config/brands";

/**
 * Conversations API (brand-scoped)
 *
 * - GET /api/messages/conversations
 *   Lists conversations for the authenticated user under current brand.
 *   Query params:
 *     - page?: number (default 0)
 *     - limit?: number (default 50)
 *
 * - POST /api/messages/conversations
 *   Creates or upserts a conversation for participants under current brand.
 *   Body:
 *     {
 *       participants: string[]; // wallets (must include caller)
 *       subject?: { type?: "merchant" | "shop" | "order" | "general", id?: string }
 *     }
 *
 * Doc shape:
 * {
 *   id: "conversation:<uuid>",
 *   type: "conversation",
 *   wallet: "<partitionKey>",          // partition key (first participant)
 *   brandKey: "<brand>",
 *   participants: string[],            // lowercase wallets
 *   subject?: { type?: string; id?: string },
 *   lastMessageAt?: number,
 *   createdAt: number
 * }
 */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normalizeWallet(w: string): string {
  return String(w || "").toLowerCase();
}

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
    if (caller?.wallet) return normalizeWallet(caller.wallet);
  } catch {}
  const headerWallet = req.headers.get("x-client-wallet") || req.headers.get("x-guest-wallet") || "";
  const normalized = normalizeWallet(headerWallet);
  if (/^0x[a-f0-9]{40}$/i.test(normalized)) {
    return normalized;
  }
  throw new Error("unauthorized");
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const me = await resolveCallerWallet(req);
    if (!/^0x[a-f0-9]{40}$/i.test(me)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const url = new URL(req.url);
    const page = Math.max(0, Math.floor(Number(url.searchParams.get("page") ?? "0")));
    const limit = clamp(Math.floor(Number(url.searchParams.get("limit") ?? "50")) || 50, 1, 100);

    // Rate limit: list conversations per wallet + IP
    {
      const ip = getClientIp(req);
      const rl = rateLimit(`convos:GET:${me}:${ip}`, 120, 10 * 60000);
      if (rl.limited) {
        return NextResponse.json(
          { ok: false, error: "rate_limited" },
          { status: 429, headers: { "x-correlation-id": correlationId, "retry-after": String(rl.retryAfter) } }
        );
      }
    }

    const brandKey = String(getBrandConfig().key || "").toLowerCase();
    const container = await getContainer();

    // Query 1: Partition-targeted (fast) - conversations where partitionKey (wallet) == me
    const specPk = {
      query:
        "SELECT c.id, c.wallet, c.brandKey, c.participants, c.subject, c.lastMessageAt, c.createdAt " +
        "FROM c WHERE c.type = 'conversation' AND c.wallet = @me",
      parameters: [{ name: "@me", value: me }],
    } as { query: string; parameters: { name: string; value: any }[] };
    const { resources: resPk } = await container.items.query(specPk, { partitionKey: me as any }).fetchAll();
    const rowsPk = Array.isArray(resPk) ? resPk : [];

    // Query 2: Cross-partition - conversations where participants include me (may reside in other participant partitions)
    const specCross = {
      query:
        "SELECT c.id, c.wallet, c.brandKey, c.participants, c.subject, c.lastMessageAt, c.createdAt " +
        "FROM c WHERE c.type = 'conversation' AND ARRAY_CONTAINS(c.participants, @me)",
      parameters: [{ name: "@me", value: me }],
    } as { query: string; parameters: { name: string; value: any }[] };
    const { resources: resCross } = await container.items.query(specCross).fetchAll();
    const rowsCross = Array.isArray(resCross) ? resCross : [];

    // Merge unique by id
    const seen = new Set<string>();
    let rows = ([] as any[])
      .concat(rowsPk, rowsCross)
      .filter((c: any) => {
        const id = String(c?.id || "");
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });

    // Fallback: derive conversations from messages if none found (cross-partition)
    if (rows.length === 0) {
      try {
        // Get distinct conversationIds from messages sent by or read by this wallet
        const specMsgs = {
          query:
            "SELECT DISTINCT VALUE c.conversationId FROM c WHERE c.type='message' AND (c.senderWallet=@me OR ARRAY_CONTAINS(c.readBy, @me))",
          parameters: [{ name: "@me", value: me }],
        } as { query: string; parameters: { name: string; value: any }[] };
        const { resources: msgIds } = await container.items.query(specMsgs).fetchAll();
        const ids = Array.isArray(msgIds) ? msgIds.filter((x) => typeof x === "string" && x) : [];
        const convoResults: any[] = [];
        for (const cid of ids) {
          try {
            // Prefer direct partition read using caller wallet to avoid cross-partition query gaps
            let c: any = null;
            try {
              const { resource } = await container.item(cid, me as any).read<any>();
              if (resource && String(resource?.id || "") === cid) {
                c = resource;
              }
            } catch {}

            // Fallback to cross-partition query if direct read didn't find it
            if (!c) {
              const specOne = {
                query:
                  "SELECT c.id, c.wallet, c.brandKey, c.participants, c.subject, c.lastMessageAt, c.createdAt " +
                  "FROM c WHERE c.type='conversation' AND c.id=@id",
                parameters: [{ name: "@id", value: cid }],
              } as { query: string; parameters: { name: string; value: any }[] };
              const { resources: one } = await container.items.query(specOne).fetchAll();
              if (Array.isArray(one) && one.length) {
                c = one[0];
              }
            }

            if (c) {
              // Ensure the caller is indeed participant or partition owner
              const parts = Array.isArray(c?.participants) ? c.participants.map((w: any) => String(w || "").toLowerCase()) : [];
              const pk = String(c?.wallet || "").toLowerCase();
              if (parts.includes(me) || pk === me) {
                const cid2 = String(c.id || "");
                if (cid2 && !seen.has(cid2)) {
                  seen.add(cid2);
                  convoResults.push(c);
                }
              }
            }
          } catch {}
        }
        if (convoResults.length) {
          rows = convoResults;
        }
      } catch {}
    }

    // Sort by lastMessageAt desc then createdAt desc
    rows.sort((a: any, b: any) => {
      const la = Number(a?.lastMessageAt || 0);
      const lb = Number(b?.lastMessageAt || 0);
      if (lb !== la) return lb - la;
      const ca = Number(a?.createdAt || 0);
      const cb = Number(b?.createdAt || 0);
      return cb - ca;
    });

    const total = rows.length;
    const start = page * limit;
    const end = start + limit;
    const items = rows.slice(start, end);

    return NextResponse.json({ ok: true, items, total, page, pageSize: limit }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const me = await resolveCallerWallet(req);
    if (!/^0x[a-f0-9]{40}$/i.test(me)) {
      return NextResponse.json(
        { ok: false, error: "invalid_wallet" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const body = await req.json().catch(() => ({}));

    // Rate limit: create/upsert conversation per caller wallet
    {
      const rl = rateLimit(`convos:POST:${me}`, 20, 60 * 60000);
      if (rl.limited) {
        return NextResponse.json(
          { ok: false, error: "rate_limited" },
          { status: 429, headers: { "x-correlation-id": correlationId, "retry-after": String(rl.retryAfter) } }
        );
      }
    }
    let participants: string[] = Array.isArray(body?.participants) ? body.participants.map(normalizeWallet).filter(Boolean) : [];
    const subject =
      body?.subject && typeof body.subject === "object"
        ? {
            type: typeof body.subject.type === "string" ? String(body.subject.type) : undefined,
            id: typeof body.subject.id === "string" ? String(body.subject.id).toLowerCase() : undefined,
          }
        : undefined;

    // Ensure caller is included
    if (!participants.includes(me)) {
      participants.push(me);
    }
    // Keep unique and only valid wallets
    participants = Array.from(new Set(participants)).filter((w) => /^0x[a-f0-9]{40}$/i.test(w));

    if (participants.length < 2) {
      return NextResponse.json(
        { ok: false, error: "two_participants_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const brandKey = String(getBrandConfig().key || "").toLowerCase();
    const container = await getContainer();
    const ts = Date.now();

    // Deterministic upsert: find existing conversation with exactly same participants (order-insensitive), brand, and subject (if present)
    // Approach: build a signature by sorting participants and subject tuple
    const sorted = participants.slice().sort();
    const sigBase = JSON.stringify({ brandKey, participants: sorted, subject: subject || null });
    const signature = crypto.createHash("sha256").update(sigBase).digest("hex");
    const id = `conversation:${signature.slice(0, 32)}`;

    // Attempt to read by id across the partition of the first participant
    const partitionKey = sorted[0];

    let existing: any = null;
    try {
      const { resource } = await container.item(id, partitionKey).read<any>();
      existing = resource || null;
    } catch {
      existing = null;
    }

    const doc = existing
      ? {
          ...existing,
          participants: sorted,
          subject,
          brandKey,
          lastMessageAt: Number(existing.lastMessageAt || 0),
          updatedAt: ts,
        }
      : {
          id,
          type: "conversation",
          wallet: partitionKey, // partition key
          brandKey,
          participants: sorted,
          subject,
          createdAt: ts,
          lastMessageAt: 0,
        };

    await container.items.upsert(doc as any);
    return NextResponse.json({ ok: true, conversation: doc }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
