import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { pushReceipts } from "@/lib/receipts-mem";
import { isSupportedCurrency } from "@/lib/fx";
import { getBrandKey } from "@/config/brands";
import { getContainerIdentity, getBrandConfigFromCosmos } from "@/lib/brand-config";

/**
 * POST /api/receipts/terminal
 * Headers:
 *   x-wallet: merchant wallet (partition key)
 *
 * Body (JSON):
 * {
 *   amountUsd: number,               // base amount (pre-tax/fees)
 *   label?: string,                  // optional line item label (default: "Terminal Payment")
 *   currency?: string,               // optional currency override (defaults to store currency or USD)
 *   jurisdictionCode?: string,       // optional jurisdiction to apply; otherwise default from site config
 *   taxRate?: number,                // optional override (0..1); if provided, takes precedence
 *   taxComponents?: string[]         // optional set of component codes from jurisdiction to sum
 * }
 *
 * Behavior:
 * - Creates a receipt with a single base line item (label + amountUsd)
 * - Applies tax (from override, selected components, jurisdiction rate, or default jurisdiction from site config)
 * - Applies processing fee: 0.5% base + merchant-configured add-on from site config
 * - Persists to Cosmos DB (partitioned by wallet); falls back to in-memory if Cosmos unavailable
 * - Returns { ok: true, receipt }
 */

type ReceiptLineItem = {
  label: string;
  priceUsd: number;
  qty?: number;
};

export type Receipt = {
  receiptId: string;
  totalUsd: number;
  currency: string;
  lineItems: ReceiptLineItem[];
  createdAt: number;
  brandName?: string;
  status?: string;
  jurisdictionCode?: string;
  taxRate?: number;
  taxComponents?: string[];
  employeeId?: string;
  staffId?: string;
  employeeName?: string;
  servedBy?: string;
  sessionId?: string;
  sessionStartTime?: number;
  tipAmount?: number;
  brandKey?: string;
};

function toCents(n: number) {
  return Math.round(Math.max(0, Number(n || 0)) * 100);
}
function fromCents(c: number) {
  return Math.round(c) / 100;
}

function genReceiptId(): string {
  const baseId = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  return `R-${baseId}`;
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const url = new URL(req.url);
    const queryWallet = String(url.searchParams.get("wallet") || "").toLowerCase();
    const headerWallet = String(req.headers.get("x-wallet") || "").toLowerCase();
    const rawWallet = headerWallet || queryWallet;
    if (!/^0x[a-f0-9]{40}$/i.test(rawWallet)) {
      return NextResponse.json(
        { error: "wallet_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = rawWallet;

    const amountUsd = Number(body?.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return NextResponse.json(
        { error: "invalid_amount" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Determine brandKey using same logic as receipt document creation (body > env > fallback)
    const effectiveBrandKey = (
      typeof body?.brandKey === "string" ? body.brandKey.toLowerCase() :
        (process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase()
    ) || undefined;

    // Fetch site config (processingFeePct, taxConfig, brandName, storeCurrency), and ensure split configured
    let cfg = await getSiteConfigForWallet(wallet, effectiveBrandKey).catch(() => null as any);

    let directSplitConfig: any = null;
    if (effectiveBrandKey) {
      try {
        const container = await getContainer();
        const docId = `site:config:${effectiveBrandKey}`;
        // Query scoped to the specific merchant's wallet (partition key)
        const { resource } = await container.item(docId, wallet).read<any>();
        if (resource && resource.splitConfig) {
          directSplitConfig = resource.splitConfig;
          console.log("[Terminal Receipt] Direct splitConfig fetch success:", { docId, wallet, splitConfig: directSplitConfig });
        } else {
          console.log("[Terminal Receipt] Direct splitConfig fetch - doc found but no splitConfig:", { docId, wallet, hasResource: !!resource });
        }
      } catch (e: any) {
        console.log("[Terminal Receipt] Direct splitConfig fetch failed:", { docId: `site:config:${effectiveBrandKey}`, wallet, error: e.message });
      }
    }

    // Fetch shop config for merchant's actual brand name (stored in type: "shop_config")
    let shopConfig: any = null;
    try {
      const container = await getContainer();
      // Derive brandKey from env or hostname
      let bk: string | undefined;
      try { bk = getBrandKey(); } catch { bk = undefined; }
      const isPlatform = !bk || bk.toLowerCase() === "portalpay" || bk.toLowerCase() === "basaltsurge";
      const shopConfigId = isPlatform ? "shop:config" : `shop:config:${bk}`;
      const { resource } = await container.item(shopConfigId, wallet).read<any>();
      shopConfig = resource || null;
    } catch { shopConfig = null; }

    const baseLabel = (String(body?.label || "").trim() || "Terminal Payment").slice(0, 120);
    const currencyInput = typeof body?.currency === "string" ? body.currency.toUpperCase() : (cfg?.storeCurrency || "USD");
    const currency = isSupportedCurrency(currencyInput) ? currencyInput : "USD";
    const jurisdictionCode = typeof body?.jurisdictionCode === "string" ? body.jurisdictionCode : undefined;
    const taxRateOverride = typeof body?.taxRate === "number" ? Number(body.taxRate) : undefined;
    const taxComponents: string[] = Array.isArray(body?.taxComponents) ? body.taxComponents : [];

    // Brand name precedence: request body > shop config name > site config theme.brandName > fallback
    // Shop config (type: "shop_config") stores merchant brand in `name` field (e.g., "Testing Co")
    const brandName = (typeof body?.brandName === "string" && body.brandName.trim())
      ? body.brandName.trim()
      : (shopConfig?.name || cfg?.name || cfg?.theme?.brandName || "PortalPay");
    try {
      let splitAddr = (cfg as any)?.splitAddress || (cfg as any)?.split?.address || "";
      if (!/^0x[a-f0-9]{40}$/i.test(String(splitAddr))) {
        // Fallback: attempt to resolve split via split/deploy endpoint, propagating auth headers/cookies.
        try {
          const xfProto = req.headers.get("x-forwarded-proto");
          const xfHost = req.headers.get("x-forwarded-host");
          const host = req.headers.get("host");
          const proto = xfProto || (process.env.NODE_ENV === "production" ? "https" : "http");
          const h = xfHost || host || "";
          const origin = h ? `${proto}://${h}` : (process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin);

          const cookie = req.headers.get("cookie") || "";
          const authorization = req.headers.get("authorization") || "";
          const headers: Record<string, string> = { "x-wallet": wallet };
          if (cookie) headers["cookie"] = cookie;
          if (authorization) headers["authorization"] = authorization;

          const r = await fetch(`${origin}/api/split/deploy?wallet=${encodeURIComponent(wallet)}`, {
            cache: "no-store",
            headers,
          });
          const j = await r.json().catch(() => ({}));
          const addr = String(j?.split?.address || "").toLowerCase();
          if (/^0x[a-f0-9]{40}$/i.test(addr)) {
            splitAddr = addr;
          }
        } catch { }
      }
      if (!/^0x[a-f0-9]{40}$/i.test(String(splitAddr))) {
        return NextResponse.json(
          { error: "split_required", message: "Split contract not configured for this merchant" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    } catch { }

    // Compute taxRate: precedence override > explicit components > jurisdiction rate > default jurisdiction (components if present)
    let appliedJurisdictionCode: string | undefined = jurisdictionCode || undefined;
    let appliedTaxComponents: string[] | undefined =
      Array.isArray(taxComponents) && taxComponents.length ? taxComponents : undefined;

    let taxRate = 0;
    try {
      if (Number.isFinite(taxRateOverride) && (taxRateOverride as number) >= 0 && (taxRateOverride as number) <= 1) {
        taxRate = Math.max(0, Math.min(1, taxRateOverride as number));
      } else if (jurisdictionCode && Array.isArray((cfg as any)?.taxConfig?.jurisdictions)) {
        const j = (cfg as any).taxConfig.jurisdictions.find(
          (x: any) => String(x.code || "").toLowerCase() === String(jurisdictionCode).toLowerCase()
        );
        if (Array.isArray(taxComponents) && taxComponents.length && Array.isArray((j as any)?.components)) {
          const compMap = new Map<string, number>(
            (j as any).components.map((c: any) => [
              String(c.code || "").toLowerCase(),
              Math.max(0, Math.min(1, Number(c.rate || 0))),
            ])
          );
          taxRate = Math.max(
            0,
            Math.min(
              1,
              taxComponents.reduce((s, code) => s + (compMap.get(String(code || "").toLowerCase()) || 0), 0)
            )
          );
        } else {
          const r = Number(j?.rate || 0);
          taxRate = Number.isFinite(r) && r >= 0 && r <= 1 ? r : 0;
          appliedTaxComponents = undefined;
        }
      } else if (typeof taxRateOverride !== "number" && Array.isArray((cfg as any)?.taxConfig?.jurisdictions)) {
        const defCode = String((cfg as any)?.taxConfig?.defaultJurisdictionCode || "");
        if (defCode) {
          const j = (cfg as any).taxConfig.jurisdictions.find(
            (x: any) => String(x.code || "").toLowerCase() === defCode.toLowerCase()
          );
          if (j) {
            appliedJurisdictionCode = defCode;
            const comps = Array.isArray((j as any)?.components) ? (j as any).components : [];
            if (comps.length) {
              const sum = comps.reduce(
                (s: number, c: any) => s + Math.max(0, Math.min(1, Number(c?.rate || 0))),
                0
              );
              taxRate = Math.max(0, Math.min(1, sum));
              appliedTaxComponents = comps.map((c: any) => String(c?.code || "")).filter(Boolean);
            } else {
              const r = Math.max(0, Math.min(1, Number((j as any)?.rate || 0)));
              taxRate = r;
              appliedTaxComponents = undefined;
            }
          }
        }
      }
    } catch { }

    // Processing fee add-on (above base platform fee)
    // basePlatformFeePct: combined platform + partner + agent fee from splitConfig (merchant-specific)
    let basePlatformFeePct: number | undefined = undefined;

    // Priority 1: Use directly fetched splitConfig (most reliable), fallback to cfg.splitConfig
    const splitCfg = directSplitConfig || (cfg as any)?.splitConfig;
    console.log("[Terminal Receipt] Fee config resolution:", {
      hasCfg: !!cfg,
      cfgId: cfg?.id,
      hasDirectSplitConfig: !!directSplitConfig,
      hasSplitConfig: !!splitCfg,
      splitCfg,
      effectiveBrandKey,
      envBrandKey: process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY
    });
    if (splitCfg && typeof splitCfg === "object") {
      const partnerBps = typeof splitCfg.partnerBps === "number" ? splitCfg.partnerBps : 0;
      const platformBps = typeof splitCfg.platformBps === "number" ? splitCfg.platformBps : 0;
      const agentBps = Array.isArray(splitCfg.agents)
        ? splitCfg.agents.reduce((s: number, a: any) => s + (Number(a.bps) || 0), 0)
        : 0;
      basePlatformFeePct = (partnerBps + platformBps + agentBps) / 100;
      console.log("[Terminal Receipt] Using splitConfig fees:", { partnerBps, platformBps, agentBps, basePlatformFeePct });
    }

    // Priority 2: Use basePlatformFeePct if explicitly set in config
    if (typeof basePlatformFeePct !== "number") {
      basePlatformFeePct = typeof (cfg as any)?.basePlatformFeePct === "number"
        ? Math.max(0, Number((cfg as any).basePlatformFeePct))
        : undefined;
    }

    // Priority 3: Fall back to brand overrides
    if (typeof basePlatformFeePct !== "number") {
      try {
        const xfHost = req.headers.get("x-forwarded-host");
        const host = req.headers.get("host");
        const u = new URL(req.url);
        const hostname = (xfHost || host || u.hostname || "").toLowerCase();
        const { brandKey: bk } = await getContainerIdentity(hostname);
        let brandKeyForFees = bk;
        if (!brandKeyForFees) {
          try { brandKeyForFees = getBrandKey(); } catch { brandKeyForFees = ""; }
        }
        if (brandKeyForFees) {
          const clampBps = (v: any) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(0, Math.min(10000, Math.floor(n))) : 0;
          };
          const { brand: fetchedBrand, overrides: fetchedOverrides } = await getBrandConfigFromCosmos(brandKeyForFees);
          const ov = (typeof fetchedOverrides === "object" && fetchedOverrides) ? fetchedOverrides : ({} as any);
          const fb = (typeof fetchedBrand === "object" && fetchedBrand) ? fetchedBrand : null;
          const platformBps = typeof ov?.platformFeeBps === "number" ? ov.platformFeeBps
            : (typeof (fb as any)?.platformFeeBps === "number" ? (fb as any).platformFeeBps : 50);
          const partnerBps = typeof ov?.partnerFeeBps === "number" ? ov.partnerFeeBps
            : (typeof (fb as any)?.partnerFeeBps === "number" ? (fb as any).partnerFeeBps : 0);
          const agentsList = Array.isArray(ov?.agents) ? ov.agents
            : (Array.isArray((fb as any)?.agents) ? (fb as any).agents : []);
          const agentBps = agentsList.reduce((sum: number, a: any) => sum + clampBps(a?.bps || 0), 0);
          basePlatformFeePct = (platformBps + partnerBps + agentBps) / 100;
        } else {
          basePlatformFeePct = 0.5; // 0.5% default
        }
      } catch {
        basePlatformFeePct = 0.5; // 0.5% default
      }
    }

    const processingFeePct =
      typeof cfg?.processingFeePct === "number" ? Math.max(0, Number(cfg.processingFeePct)) : 0;

    // Build line items: base + optional Tax + Processing Fee
    const baseCents = toCents(amountUsd);
    const taxCents = Math.round(baseCents * Math.max(0, Math.min(1, taxRate)));
    const baseWithoutFeeCents = baseCents + taxCents;
    const totalFeePct = Math.max(0, basePlatformFeePct + processingFeePct);
    const feePctFraction = totalFeePct / 100;
    const processingFeeCents = Math.round(baseWithoutFeeCents * feePctFraction);

    const lineItems: ReceiptLineItem[] = [
      { label: baseLabel, priceUsd: fromCents(baseCents) },
      ...(taxCents > 0 ? [{ label: "Tax", priceUsd: fromCents(taxCents) }] : []),
      ...(processingFeeCents > 0 ? [{ label: "Processing Fee", priceUsd: fromCents(processingFeeCents) }] : []),
    ];

    const totalUsd = fromCents(baseWithoutFeeCents + processingFeeCents);
    const receiptId = genReceiptId();
    const ts = Date.now();

    // Extract employee attribution metadata with alias support
    const employeeId = typeof body?.employeeId === "string" ? body.employeeId : undefined;
    const staffId = typeof body?.staffId === "string" ? body.staffId : employeeId; // Alias
    const employeeName = typeof body?.employeeName === "string" ? body.employeeName : undefined;
    const servedBy = typeof body?.servedBy === "string" ? body.servedBy : employeeName; // Alias
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : undefined;
    const sessionStartTime = typeof body?.sessionStartTime === "number" ? body.sessionStartTime : undefined;

    // Tip amount - initialize to 0, will be updated when tip is added
    const tipAmount = typeof body?.tipAmount === "number" ? Math.max(0, body.tipAmount) : 0;

    // Brand key for isolation (from body or derive from env)
    const brandKey = typeof body?.brandKey === "string"
      ? body.brandKey.toLowerCase()
      : (process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "portalpay").toLowerCase();

    const doc = {
      id: `receipt:${receiptId}`,
      type: "receipt",
      wallet,
      receiptId,
      totalUsd,
      currency,
      lineItems,
      createdAt: ts,
      brandName,
      jurisdictionCode: appliedJurisdictionCode,
      taxRate: Math.max(0, Math.min(1, taxRate)),
      taxComponents: appliedTaxComponents,
      status: "generated",
      // Employee attribution with aliases for cross-module compatibility
      employeeId,
      staffId,
      employeeName,
      servedBy,
      sessionId,
      sessionStartTime,
      // Initialize tipAmount (updated via /api/receipts/[id]/tip or /pay)
      tipAmount,
      // Brand isolation
      brandKey,
      statusHistory: [{ status: "generated", ts }],
      lastUpdatedAt: ts,
    };

    const receipt: Receipt = {
      receiptId,
      totalUsd,
      currency,
      lineItems,
      createdAt: ts,
      brandName,
      jurisdictionCode: appliedJurisdictionCode,
      taxRate: Math.max(0, Math.min(1, taxRate)),
      taxComponents: appliedTaxComponents,
      status: "generated",
      employeeId,
      staffId,
      employeeName,
      servedBy,
      sessionId,
      sessionStartTime,
      brandKey,
    };

    // Persist
    try {
      const container = await getContainer();
      await container.items.upsert(doc as any);
      return NextResponse.json({ ok: true, receipt }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      // Degraded: push to in-memory
      pushReceipts([{ ...receipt, wallet } as any]);
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", receipt },
        { status: 200, headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": crypto.randomUUID() } }
    );
  }
}
