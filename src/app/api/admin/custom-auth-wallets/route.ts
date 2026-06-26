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

    const url = new URL(req.url);
    const queryBrandKey = url.searchParams.get("brandKey")?.toLowerCase().trim();

    let targetBrandKey = "";
    if (isPartner) {
      targetBrandKey = containerIdentity.brandKey.toLowerCase();
    } else if (queryBrandKey && queryBrandKey !== "basaltsurge" && queryBrandKey !== "portalpay") {
      targetBrandKey = queryBrandKey;
    }

    let query = `
      SELECT *
      FROM c
      WHERE c.type = 'user' AND IS_DEFINED(c.contact) AND IS_DEFINED(c.contact.email)
    `;

    const parameters: { name: string; value: any }[] = [];

    if (targetBrandKey) {
      query += ` AND (ENDSWITH(c.id, @brandSuffix) OR ENDSWITH(c.id, ':user'))`;
      parameters.push({ name: "@brandSuffix", value: `:${targetBrandKey}` });
    }

    const container = await getContainer();
    const querySpec = {
      query,
      parameters
    };

    const { resources } = await container.items.query(querySpec).fetchAll();

    const brandScopedProfiles = new Map<string, any>();
    const legacyProfiles: any[] = [];

    for (const r of resources) {
      const wallet = String(r.wallet || "").toLowerCase().trim();
      const id = String(r.id || "");
      const lowercaseId = id.toLowerCase();
      if (targetBrandKey && lowercaseId === `${wallet}:user:${targetBrandKey}`) {
        brandScopedProfiles.set(wallet, r);
      } else if (lowercaseId === `${wallet}:user`) {
        legacyProfiles.push(r);
      }
    }

    // Resolve brand-specific Thirdweb Client ID dynamically
    const bKey = targetBrandKey ? targetBrandKey.toUpperCase().replace(/-/g, "_") : "";
    const envClientId = (bKey ? (process.env[`NEXT_PUBLIC_THIRDWEB_CLIENT_ID_${bKey}`] || process.env[`THIRDWEB_CLIENT_ID_${bKey}`]) : undefined)
      || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID
      || process.env.THIRDWEB_CLIENT_ID;

    const uncheckedLegacy = legacyProfiles.filter(p => {
      const checked = p.checkedBrands || [];
      return !checked.map((b: string) => b.toLowerCase()).includes(targetBrandKey);
    });

    // Process a max batch size of 20 at a time to prevent server/gateway timeouts
    const batchToProcess = uncheckedLegacy.slice(0, 20);

    if (envClientId && targetBrandKey && batchToProcess.length > 0) {
      try {
        const { createThirdwebClient } = await import("thirdweb");
        const { inAppWallet } = await import("thirdweb/wallets");
        const { base } = await import("thirdweb/chains");
        const { markEmailVerified } = await import("@/app/api/auth/thirdweb-verify/route");

        const brandTwClient = createThirdwebClient({
          clientId: envClientId,
          secretKey: process.env.THIRDWEB_SECRET_KEY,
        });

        // Run EOA checks and database upserts concurrently
        await Promise.all(
          batchToProcess.map(async (legacyProfile) => {
            const wallet = String(legacyProfile.wallet || "").toLowerCase().trim();
            const email = String(legacyProfile.contact?.email || "").toLowerCase().trim();

            if (brandScopedProfiles.has(wallet)) {
              return;
            }

            try {
              const verificationToken = markEmailVerified(email);
              const tempWallet = inAppWallet({
                auth: { options: ["auth_endpoint" as any] },
                executionMode: { mode: "EIP7702", sponsorGas: true },
              });
              const account = await tempWallet.connect({
                client: brandTwClient,
                chain: base,
                strategy: "auth_endpoint" as any,
                payload: JSON.stringify({ email, verificationToken }),
              });
              const derivedAddress = account.address.toLowerCase().trim();

              if (derivedAddress === wallet) {
                console.log(`[custom-auth-wallets] EOA matched: email ${email} derived ${derivedAddress} == wallet ${wallet} using client ID ${envClientId}`);
                
                // Create the brand-scoped profile
                const nextDoc = {
                  ...legacyProfile,
                  id: `${wallet}:user:${targetBrandKey}`,
                  brandKey: targetBrandKey,
                  lastSeen: Date.now()
                };

                await container.items.upsert(nextDoc);
                console.log(`[custom-auth-wallets] Successfully backfilled user profile for ${targetBrandKey}: ${nextDoc.id}`);
                brandScopedProfiles.set(wallet, nextDoc);
              }
            } catch (deriveErr) {
              console.warn(`[custom-auth-wallets] Failed EOA derivation check for email ${email} under brand ${targetBrandKey}:`, deriveErr);
            }

            // Mark this legacy profile as checked for this brand so we never try slow EOA derivation on it again
            try {
              const checked = Array.isArray(legacyProfile.checkedBrands) ? [...legacyProfile.checkedBrands] : [];
              if (!checked.map((b: string) => b.toLowerCase()).includes(targetBrandKey)) {
                checked.push(targetBrandKey);
              }
              const updatedLegacy = {
                ...legacyProfile,
                checkedBrands: checked,
                lastSeen: Date.now()
              };
              await container.items.upsert(updatedLegacy);
            } catch (legacyUpdateErr) {
              console.error(`[custom-auth-wallets] Failed to update checkedBrands on legacy profile for ${wallet}:`, legacyUpdateErr);
            }
          })
        );
      } catch (importErr) {
        console.error(`[custom-auth-wallets] Failed to load Thirdweb SDK for derivation:`, importErr);
      }
    }

    // Determine final resources list to output
    let finalResources: any[] = [];
    if (targetBrandKey) {
      finalResources = Array.from(brandScopedProfiles.values());
    } else {
      finalResources = resources;
    }

    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();
    const items: any[] = [];

    // Sort resources by lastSeen descending first to prioritize the most recent records
    finalResources.sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0));

    for (const r of finalResources) {
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
