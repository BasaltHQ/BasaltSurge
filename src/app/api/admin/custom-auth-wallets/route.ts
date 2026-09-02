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

    // Determine final resources list to output
    let finalResources: any[] = [];
    if (targetBrandKey) {
      finalResources = resources.filter(r => {
        const id = String(r.id || "").toLowerCase();
        return id.endsWith(`:${targetBrandKey}`) || id.endsWith(":user");
      });
    } else {
      finalResources = resources;
    }

    const seenKeys = new Set<string>();
    const seenIds = new Set<string>();
    const preliminaryItems: any[] = [];

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

      preliminaryItems.push({
        id: r.id,
        wallet: r.wallet,
        displayName: r.displayName || "Anonymous User",
        email: r.contact?.email || "",
        phone: r.contact?.phone || "",
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        xp: r.xp || 0,
        brandKey: r.brandKey || (r.id.includes(":") ? r.id.split(":").pop() : "")
      });
    }

    // Check on-chain USDC balances via free read-only RPC (zero Thirdweb auth cost)
    const { createThirdwebClient, getContract, readContract } = await import("thirdweb");
    const { base } = await import("thirdweb/chains");
    const BASE_USDC_ADDRESS = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

    const twReadClient = createThirdwebClient({
      clientId: process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
      secretKey: process.env.THIRDWEB_SECRET_KEY
    });

    const usdcContract = getContract({
      client: twReadClient,
      chain: base,
      address: BASE_USDC_ADDRESS
    });

    // Check top 50 wallets concurrently
    const items = await Promise.all(
      preliminaryItems.slice(0, 100).map(async (item) => {
        let usdcBalance = 0;
        try {
          const rawUnits = await readContract({
            contract: usdcContract,
            method: "function balanceOf(address account) view returns (uint256)",
            params: [item.wallet]
          });
          usdcBalance = +(Number(rawUnits) / 1_000_000).toFixed(2);
        } catch {
          usdcBalance = 0;
        }
        return {
          ...item,
          usdcBalance
        };
      })
    );

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

/**
 * POST /api/admin/custom-auth-wallets
 * Trigger on-demand gasless sweep for a specific custom auth wallet with stranded balance
 * Uses the exact same target split resolution and receipt settlement logic as the background poller
 */
export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const caller = await requireRole(req, "admin");
    const body = await req.json().catch(() => ({}));
    const { email, targetSplitAddress: explicitSplit, brandKey: explicitBrandKey } = body;

    if (!email) {
      return NextResponse.json({ error: "missing_email" }, { status: 400 });
    }

    const container = await getContainer();
    
    // 1. Look up any active/pending receipt for this customer email
    const querySpec = {
      query: "SELECT TOP 1 * FROM c WHERE c.type = 'receipt' AND (LOWER(c.customerEmail) = @email OR LOWER(c.email) = @email OR LOWER(c.stripeEmail) = @email) ORDER BY c._ts DESC",
      parameters: [{ name: "@email", value: email.toLowerCase().trim() }]
    };
    const { resources: matchingReceipts } = await container.items.query(querySpec).fetchAll();
    const receipt = matchingReceipts?.[0];

    let targetBrandKey = explicitBrandKey || receipt?.brandKey || "";
    let merchantWallet = receipt?.wallet || "";
    let targetSplitAddress = explicitSplit || "";

    // 2. Resolve target split address using identical background poller logic
    if (!targetSplitAddress) {
      if (receipt) {
        const isCredit = receipt.isCreditCard === true || receipt.detectedCardFunding === "credit";
        const isAch = receipt.detectedCardFunding === "us_bank_account";
        targetSplitAddress = (isCredit || isAch)
          ? (receipt.splitAddress || receipt.wallet)
          : (receipt.splitAddressCredit || receipt.splitAddress || receipt.wallet);
      }
      
      if (!targetSplitAddress) {
        const { getSiteConfigForWallet } = await import("@/lib/site-config");
        const siteConfig = await getSiteConfigForWallet(merchantWallet, targetBrandKey);
        
        targetSplitAddress = siteConfig?.splitAddress || siteConfig?.split?.address || merchantWallet;
      }
    }

    if (!targetSplitAddress) {
      return NextResponse.json({ error: "could_not_resolve_split_address" }, { status: 400 });
    }

    const { executeGaslessTransferServer } = await import("@/app/api/stripe/background-poll/route");
    const txHash = await executeGaslessTransferServer(
      email,
      targetSplitAddress,
      0, // sweepAll = true will sweep entire remaining balance
      targetBrandKey,
      true
    );

    if (!txHash) {
      return NextResponse.json({ error: "sweep_failed_or_zero_balance" }, { status: 400 });
    }

    // 3. If a matching un-settled receipt was found, update its status to paid with the transaction hash
    if (receipt && receipt.status !== "paid" && receipt.status !== "checkout_success") {
      try {
        receipt.status = "paid";
        receipt.transactionHash = txHash;
        receipt.transactionTimestamp = Date.now();
        receipt.lastUpdatedAt = Date.now();
        receipt.statusHistory = Array.isArray(receipt.statusHistory)
          ? [...receipt.statusHistory, { status: "paid", ts: Date.now() }]
          : [{ status: "paid", ts: Date.now() }];
        receipt.ttl = -1;

        let finalDoc = receipt;
        try {
          const { recalculateReceiptForCardFunding } = await import("@/lib/receipts");
          const { readBrandOverridesCached } = await import("@/lib/brand-config");
          const { getSiteConfigForWallet } = await import("@/lib/site-config");
          const siteConfig = await getSiteConfigForWallet(merchantWallet, targetBrandKey);
          const brandConfigDoc = targetBrandKey ? await readBrandOverridesCached(targetBrandKey) : null;
          const funding = (receipt.detectedCardFunding === "credit" || receipt.isCreditCard === true)
            ? "credit"
            : (receipt.detectedCardFunding === "us_bank_account" ? "us_bank_account" : "debit");
          if (siteConfig) {
            finalDoc = recalculateReceiptForCardFunding(receipt, funding, siteConfig, brandConfigDoc);
          }
        } catch {}

        await container.items.upsert(finalDoc);
      } catch (receiptUpdateErr) {
        console.warn("[admin/custom-auth-wallets] Failed to update matching receipt on sweep:", receiptUpdateErr);
      }
    }

    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "admin_custom_auth_wallet_sweep",
        target: targetSplitAddress,
        correlationId,
        ok: true,
        metadata: { email, txHash, brandKey: targetBrandKey, targetSplitAddress }
      });
    } catch {}

    return NextResponse.json({ ok: true, txHash, targetSplitAddress });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "sweep_failed" }, { status: 500 });
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
