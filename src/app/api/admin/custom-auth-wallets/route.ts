import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireRole } from "@/lib/auth";
import { auditEvent } from "@/lib/audit";
import { getContainerIdentity } from "@/lib/brand-config";
import crypto from "node:crypto";

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const caller = await requireRole(req, "admin");

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const containerIdentity = await getContainerIdentity(host);
    const isPartner = containerIdentity.containerType === "partner";

    let query = `
      SELECT c.id, c.wallet, c.displayName, c.contact, c.firstSeen, c.lastSeen, c.xp
      FROM c
      WHERE c.type = 'user' AND IS_DEFINED(c.contact) AND IS_DEFINED(c.contact.email)
    `;

    const parameters: { name: string; value: any }[] = [];

    if (isPartner) {
      const brandKey = containerIdentity.brandKey.toLowerCase();
      query += ` AND c.id = CONCAT(c.wallet, ':user:', @brandKey)`;
      parameters.push({ name: "@brandKey", value: brandKey });
    }

    const container = await getContainer();
    const querySpec = {
      query,
      parameters
    };

    const { resources } = await container.items.query(querySpec).fetchAll();
    
    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();
    const items: any[] = [];

    // Sort resources by lastSeen descending first to prioritize the most recent records
    resources.sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0));

    for (const r of resources) {
      const email = String(r.contact?.email || "").toLowerCase().trim();
      const wallet = String(r.wallet || "").toLowerCase().trim();
      const id = String(r.id || "");
      if (!email || !wallet || !id) continue;

      const compositeKey = `${email}:${wallet}`;
      if (seenKeys.has(compositeKey) || seenIds.has(id)) {
        continue;
      }
      seenKeys.add(compositeKey);
      seenIds.add(id);

      items.push({
        id: r.id,
        wallet: r.wallet,
        displayName: r.displayName || "Anonymous User",
        email: r.contact?.email || "",
        phone: r.contact?.phone || "",
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        xp: r.xp || 0
      });
    }

    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "admin_custom_auth_wallets_query",
        target: caller.wallet,
        correlationId,
        ok: true,
        metadata: { count: items.length }
      });
    } catch {}

    return NextResponse.json({ ok: true, items }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    try {
      await auditEvent(req, {
        who: "",
        roles: [],
        what: "admin_custom_auth_wallets_query",
        target: undefined,
        correlationId,
        ok: false,
        metadata: { error: e?.message || "unauthorized" }
      });
    } catch {}
    return NextResponse.json({ error: e?.message || "unauthorized" }, { status: 401, headers: { "x-correlation-id": correlationId } });
  }
}

export async function DELETE(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const caller = await requireRole(req, "admin");
    const body = await req.json().catch(() => ({}));
    const { id, wallet } = body;

    if (!id || !wallet) {
      return NextResponse.json({ error: "missing id or wallet" }, { status: 400 });
    }

    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
    const containerIdentity = await getContainerIdentity(host);
    if (containerIdentity.containerType === "partner") {
      const expectedId = `${wallet.toLowerCase()}:user:${containerIdentity.brandKey.toLowerCase()}`;
      if (id.toLowerCase() !== expectedId) {
        return NextResponse.json({ error: "Access denied: cannot delete user outside this container" }, { status: 403 });
      }
    }

    const container = await getContainer();
    
    // Read the current profile document
    let resource: any;
    try {
      const r = await container.item(id, wallet).read<any>();
      resource = r?.resource;
    } catch (readErr: any) {
      return NextResponse.json({ error: "Profile document not found" }, { status: 404 });
    }

    if (!resource) {
      return NextResponse.json({ error: "Profile document is empty" }, { status: 404 });
    }

    const originalEmail = resource.contact?.email || "";

    // Unlink the custom auth mapping by removing email and phone fields
    if (resource.contact) {
      delete resource.contact.email;
      delete resource.contact.phone;
    }

    // Update document in Cosmos DB
    const nextDoc = {
      ...resource,
      lastSeen: Date.now()
    };

    await container.items.upsert(nextDoc);

    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "admin_custom_auth_wallets_delete",
        target: wallet,
        correlationId,
        ok: true,
        metadata: { id, unlinkedEmail: originalEmail }
      });
    } catch {}

    return NextResponse.json({ ok: true, unlinkedEmail: originalEmail });
  } catch (e: any) {
    try {
      await auditEvent(req, {
        who: "",
        roles: [],
        what: "admin_custom_auth_wallets_delete",
        target: undefined,
        correlationId,
        ok: false,
        metadata: { error: e?.message || "failed" }
      });
    } catch {}
    return NextResponse.json({ error: e?.message || "failed" }, { status: 401, headers: { "x-correlation-id": correlationId } });
  }
}
