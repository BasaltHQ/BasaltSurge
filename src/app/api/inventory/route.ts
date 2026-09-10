import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import {
  upsertInventoryItem,
  getInventoryItems,
  deleteInventoryItem,
  inventoryIdForSku,
  type InventoryItemMem,
} from "@/lib/inventory-mem";
import { isSupportedCurrency } from "@/lib/fx";
import { assertOwnershipOrAdmin } from "@/lib/auth";
import { getBrandKey } from "@/config/brands";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { isPartnerContext } from "@/lib/env";
import { fetchUsdRates } from "@/lib/eth";
import { createReceiptPricing, nativeAmount, nativeAmountToUsd, receiptCurrency, ReceiptCurrencyError } from "@/lib/receipt-currency";

/**
 * Inventory API
 * - GET: list inventory items for a merchant (by wallet)
 * - POST: upsert/create inventory item
 * - DELETE: delete inventory item by id
 *
 * Cosmos DB (NoSQL) is the primary store. Gracefully degrades to in-memory when Cosmos is unavailable.
 */

type InventoryItemBody = {
  sku: string;
  name: string;
  priceUsd?: number;
  price?: number;
  stockQty: number;
  deliveryEnabled?: boolean;
  currency?: string;
  category?: string;
  description?: string;
  tags?: string[];
  images?: string[]; // up to 3 image URLs
  attributes?: Record<string, any>;
  costUsd?: number;
  taxable?: boolean;
  jurisdictionCode?: string;
  industryPack?: string;
  // Publishing / Book fields
  bookFileUrl?: string; // Manuscript
  bookCoverUrl?: string;
  isBook?: boolean;
  releaseDate?: number;
  previewUrl?: string; // Preview file
  allowDownload?: boolean;
  drmEnabled?: boolean;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  /** Subscription-linked item fields */
  isSubscription?: boolean;
  subscriptionPlanId?: string;
  /** Shipping */
  shippingEnabled?: boolean;
  shippingConfig?: {
    enabled: boolean;
    weightLbs?: number;
    dimensions?: { length?: number; width?: number; height?: number; unit?: 'in' | 'cm' };
    shippingClass?: 'standard' | 'oversized' | 'fragile' | 'hazardous';
    freeShippingThreshold?: number;
    methodPricing?: Record<string, number>;
    handlingTimeDays?: number;
    allowedMethods?: ('standard' | 'express' | 'overnight' | 'freight')[];
    originCountry?: string;
    domesticOnly?: boolean;
    requiresSignature?: boolean;
    insuranceRequired?: boolean;
  };
  contentDetails?: {
    // Core
    author?: string; // Primary Author
    subtitle?: string;
    edition?: number;
    contributors?: Array<{ firstName: string; lastName: string; role: string }>;

    // Categorization
    pages?: number;
    isbn?: string;
    genre?: string;
    publisher?: string;
    language?: string;
    series?: string | { name: string; order: number };
    seriesOrder?: number;

    // Rights & Content
    rights?: 'copyright' | 'public_domain';
    aiGenerated?: { used: boolean; methods?: string[] };
    disclosures?: { adult?: boolean; violence?: boolean; aiGenerated?: boolean };
    contentDisclosure?: string;
    ageRestricted?: boolean;
    readingAge?: { min?: number; max?: number };

    // Marketing
    tags?: string[]; // Keywords
    categories?: string[]; // Hierarchical categories

    // Revision
    revisionStatus?: 'PENDING';
    pendingRevision?: any;
  };
};

// Apply search, filter, sort, pagination to inventory items
function applyFiltersAndSort(items: any[], url: URL) {
  try {
    const sp = url.searchParams;
    const q = String(sp.get("q") || "").trim().toLowerCase();
    const category = String(sp.get("category") || "").trim().toLowerCase();
    const taxableParam = String(sp.get("taxable") || "").trim().toLowerCase(); // "true" | "false" | "any"
    const stock = String(sp.get("stock") || "").trim().toLowerCase(); // "in" | "out" | "any"
    const priceMinRaw = sp.get("priceMin");
    const priceMaxRaw = sp.get("priceMax");
    const priceMin = priceMinRaw !== null ? Number(priceMinRaw) : NaN;
    const priceMax = priceMaxRaw !== null ? Number(priceMaxRaw) : NaN;
    const tagsCsv = String(sp.get("tags") || "").trim();
    const tagsMode = String(sp.get("tagsMode") || "any").toLowerCase(); // "any" | "all"
    const packFilter = String(sp.get("pack") || "").trim().toLowerCase(); // industry pack filter
    const sortField = String(sp.get("sort") || "updatedAt");
    const order = String(sp.get("order") || "desc").toLowerCase(); // "asc" | "desc"
    const limitRaw = sp.get("limit");
    const pageRaw = sp.get("page");
    const limit = limitRaw !== null ? Number(limitRaw) : NaN;
    const page = pageRaw !== null ? Number(pageRaw) : 0;

    let arr = Array.isArray(items) ? items.slice() : [];

    if (q) {
      arr = arr.filter((it) => {
        const fields = [it.sku, it.name, it.description, it.category]
          .map((v) => String(v || "").toLowerCase());
        const tags = Array.isArray(it.tags)
          ? it.tags.map((t: any) => String(t || "").toLowerCase())
          : [];
        return fields.some((f) => f.includes(q)) || tags.some((t: string | string[]) => t.includes(q));
      });
    }

    if (category) {
      arr = arr.filter((it) => String(it.category || "").toLowerCase() === category);
    }

    if (taxableParam === "true" || taxableParam === "false") {
      const target = taxableParam === "true";
      arr = arr.filter((it) => !!it.taxable === target);
    }

    if (stock === "in") {
      arr = arr.filter((it) => Number(it.stockQty) === -1 || Number(it.stockQty || 0) > 0);
    } else if (stock === "out") {
      arr = arr.filter((it) => Number(it.stockQty || 0) === 0);
    }

    if (Number.isFinite(priceMin)) {
      arr = arr.filter((it) => Number(it.priceUsd || 0) >= Math.max(0, priceMin));
    }
    if (Number.isFinite(priceMax)) {
      arr = arr.filter((it) => Number(it.priceUsd || 0) <= Math.max(0, priceMax));
    }

    const tagsInput = tagsCsv
      ? tagsCsv.split(",").map((s: string) => s.trim().toLowerCase()).filter(Boolean)
      : [];
    if (tagsInput.length) {
      arr = arr.filter((it) => {
        const itemTags = Array.isArray(it.tags)
          ? it.tags.map((t: any) => String(t || "").toLowerCase())
          : [];
        if (tagsMode === "all") {
          return tagsInput.every((t: string) => itemTags.includes(t));
        }
        return tagsInput.some((t: string) => itemTags.includes(t));
      });
    }

    if (packFilter && packFilter !== "any") {
      arr = arr.filter((it) => {
        const itemPack = String(it.industryPack || "general").toLowerCase();
        return itemPack === packFilter;
      });
    }

    const dir = order === "asc" ? 1 : -1;
    const cmp = (a: any, b: any) => {
      let av: any = a?.[sortField];
      let bv: any = b?.[sortField];
      // String sorts for name/sku/category
      if (sortField === "name" || sortField === "sku" || sortField === "category") {
        av = String(av || "").toLowerCase();
        bv = String(bv || "").toLowerCase();
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      }
      // Numeric/date sorts
      const an = Number(av || 0);
      const bn = Number(bv || 0);
      if (an < bn) return -1 * dir;
      if (an > bn) return 1 * dir;
      // Stable tie-breakers: updatedAt desc, then name asc
      const s1 = Number(a?.updatedAt || 0);
      const s2 = Number(b?.updatedAt || 0);
      if (s1 !== s2) return s1 < s2 ? 1 : -1;
      const na = String(a?.name || "").toLowerCase();
      const nb = String(b?.name || "").toLowerCase();
      if (na < nb) return -1;
      if (na > nb) return 1;
      return 0;
    };
    arr.sort(cmp);

    const total = arr.length;
    const pageSize = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : total;
    const pageNum = Number.isFinite(page) && page >= 0 ? Math.floor(page) : 0;
    const start = pageNum * pageSize;
    const sliced = arr.slice(start, start + pageSize);

    return { items: sliced, total, page: pageNum, pageSize };
  } catch {
    return {
      items: Array.isArray(items) ? items : [],
      total: Array.isArray(items) ? items.length : 0,
      page: 0,
      pageSize: Array.isArray(items) ? items.length : 0,
    };
  }
}

function jsonResponse(
  obj: any,
  init?: { status?: number; headers?: Record<string, string> }
) {
  try {
    const json = JSON.stringify(obj);
    const len = new TextEncoder().encode(json).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    };
    headers["Content-Length"] = String(len);
    return new NextResponse(json, { status: init?.status ?? 200, headers });
  } catch {
    return NextResponse.json(obj, init as any);
  }
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);

    // Check for platform admin mode (for Publications Panel)
    const isPlatformAdmin = req.headers.get("x-platform-admin") === "true";
    let isAdmin = false;
    let wallet = "";

    // For GET requests, prioritize x-wallet header for public shop viewing
    const xWalletHeader = req.headers.get("x-wallet");

    if (xWalletHeader) {
      // Validate the x-wallet header
      const w = String(xWalletHeader || "").toLowerCase();
      wallet = /^0x[a-f0-9]{40}$/.test(w) ? w : "";
    }

    // If no valid x-wallet header, try authentication (for merchant's own inventory management)
    if (!wallet) {
      try {
        const caller = await requireApimOrJwt(req, ["inventory:read"]);
        wallet = caller.wallet;
        isAdmin = (caller.roles || []).includes("admin");
      } catch (e: any) {
        return jsonResponse(
          { error: e?.message || "unauthorized" },
          { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // Platform admin mode - fetch ALL pending books from ALL users
    if (isPlatformAdmin && isAdmin) {
      try {
        const container = await getContainer();
        const adminSpec = {
          query: "SELECT * FROM c WHERE c.type='inventory_item' AND (c.isBook=true OR c.industryPack='publishing') ORDER BY c.updatedAt DESC",
          parameters: []
        };
        const { resources } = await container.items.query(adminSpec).fetchAll();
        const items = Array.isArray(resources) ? resources : [];
        console.log("[inventory] Platform admin query returned", items.length, "items");
        return jsonResponse({ items, total: items.length }, { headers: { "x-correlation-id": correlationId } });
      } catch (e: any) {
        console.error("[inventory] Platform admin query error:", e);
        return jsonResponse(
          { error: "Failed to fetch items", items: [] },
          { status: 500, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    try {
      const container = await getContainer();
      // Determine brand key if configured; safe for platform legacy.
      let brandKey: string | undefined = undefined;
      try {
        brandKey = getBrandKey();
        // No longer remapping basaltsurge -> portalpay since migration sets items to basaltsurge
      } catch {
        brandKey = undefined;
      }
      const spec = (() => {
        const baseSelect =
          "SELECT c.id, c.wallet, c.sku, c.name, c.priceUsd, c.nativePrice, c.currency, c.stockQty, c.category, c.description, c.tags, c.images, c.attributes, c.costUsd, c.taxable, c.jurisdictionCode, c.industryPack, c.metrics, c.createdAt, c.updatedAt, c.isBook, c.bookFileUrl, c.bookCoverUrl, c.approvalStatus, c.contentDetails, c.releaseDate, c.previewUrl, c.allowDownload, c.drmEnabled, c.isSubscription, c.subscriptionPlanId, c.shippingEnabled, c.shippingConfig, c.deliveryEnabled FROM c WHERE c.type='inventory_item' AND c.wallet=@wallet";
        if (brandKey) {
          const partner = isPartnerContext();
          return partner
            ? ({
              query: baseSelect + " AND LOWER(c.brandKey)=@brandKey ORDER BY c.updatedAt DESC",
              parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: String(brandKey).toLowerCase() },
              ],
            } as { query: string; parameters: { name: string; value: any }[] })
            : ({
              query:
                baseSelect +
                " AND (LOWER(c.brandKey)=@brandKey OR NOT IS_DEFINED(c.brandKey)) ORDER BY c.updatedAt DESC",
              parameters: [
                { name: "@wallet", value: wallet },
                { name: "@brandKey", value: String(brandKey).toLowerCase() },
              ],
            } as { query: string; parameters: { name: string; value: any }[] });
        }
        return {
          query: baseSelect + " ORDER BY c.updatedAt DESC",
          parameters: [{ name: "@wallet", value: wallet }],
        } as { query: string; parameters: { name: string; value: any }[] };
      })();
      const { resources } = await container.items.query(spec).fetchAll();
      const items = Array.isArray(resources) ? resources : [];
      const result = applyFiltersAndSort(items, url);
      return jsonResponse(result, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      let items = getInventoryItems(wallet);
      // Strict brand-scoped listing in partner containers
      try {
        const bk = String(getBrandKey() || "").toLowerCase();
        if (bk && isPartnerContext()) {
          items = items.filter((it: any) => String(it?.brandKey || "").toLowerCase() === bk);
        }
      } catch { }
      const result = applyFiltersAndSort(items, url);
      return jsonResponse(
        { ...result, degraded: true, reason: e?.message || "cosmos_unavailable" },
        { headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return jsonResponse(
      { error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = (await req.json().catch(() => ({}))) as InventoryItemBody & { id?: string };
    const url = new URL(req.url);
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["inventory:write"]);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;
    const isAdmin = (caller.roles || []).includes("admin");

    // Ownership/admin enforcement for JWT callers remains; APIM callers are bound by subscription to their wallet.
    if (caller.source === "jwt") {
      try {
        assertOwnershipOrAdmin(caller.wallet, wallet, isAdmin);
      } catch (e: any) {
        return NextResponse.json(
          { error: e?.message || "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // CSRF for JWT only; APIM calls are server-to-server and do not require same-origin
    try {
      if (caller.source === "jwt") requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "inventory_write", wallet), 60, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      return NextResponse.json(
        { error: e?.message || "rate_limited", resetAt },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
      );
    }

    const sku = String(body.sku || "").trim();
    const name = String(body.name || "").trim();
    let priceUsd = Number(body.priceUsd);
    let nativePrice: { amount: number; currency: "USD" | "EUR" } | undefined;
    if (body.price !== undefined) {
      if (body.priceUsd !== undefined) throw new ReceiptCurrencyError("conflicting_inventory_prices", "Use price or priceUsd, not both.");
      const currency = receiptCurrency(body.currency);
      nativePrice = { amount: nativeAmount(body.price), currency };
      const pricing = createReceiptPricing(currency, currency === "USD" ? {} : await fetchUsdRates());
      priceUsd = nativeAmountToUsd(nativePrice.amount, pricing);
    }
    const stockQty = Number(body.stockQty);
    const currencyInput = typeof body.currency === "string" ? body.currency.toUpperCase() : "USD";
    const currency = nativePrice?.currency || (isSupportedCurrency(currencyInput) ? currencyInput : "USD");

    // Allow stockQty === -1 to represent infinite stock
    if (!sku || !name || !Number.isFinite(priceUsd) || priceUsd < 0 || !Number.isFinite(stockQty) || stockQty < -1) {
      return NextResponse.json(
        { error: "invalid_input" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const now = Date.now();
    const id = body.id ? String(body.id) : inventoryIdForSku(sku);
    // Stamp brandKey for partner containers on new/updated items (legacy items remain without brandKey)
    let brandKey: string | undefined = undefined;
    try {
      brandKey = getBrandKey();
    } catch {
      brandKey = undefined;
    }

    // Determine owner wallet:
    // If admin is calling, and body has a wallet, USE IT (preserve original owner).
    // Otherwise use caller's wallet.
    const targetWallet = (isAdmin && (body as any).wallet) ? (body as any).wallet : wallet;

    const doc = {
      id,
      type: "inventory_item",
      wallet: targetWallet,
      sku,
      name,
      priceUsd,
      ...(nativePrice ? { nativePrice } : {}),
      currency,
      stockQty,
      category: typeof body.category === "string" ? body.category : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      tags: Array.isArray(body.tags) ? body.tags.slice(0, 24) : (Array.isArray(body.contentDetails?.tags) ? body.contentDetails?.tags.slice(0, 24) : undefined),
      images: Array.isArray(body.images) ? body.images.slice(0, 3) : undefined,
      attributes: body && typeof body.attributes === "object" ? body.attributes : undefined,
      costUsd: typeof body.costUsd === "number" ? Math.max(0, body.costUsd) : undefined,
      taxable: body.taxable === true,
      jurisdictionCode: typeof body.jurisdictionCode === "string" ? body.jurisdictionCode : undefined,
      industryPack: typeof body.industryPack === "string" ? body.industryPack : "general",
      metrics: undefined,
      createdAt: now,
      updatedAt: now,
      ...(brandKey ? { brandKey: String(brandKey).toLowerCase() } : {}),
      // Book specifics
      bookFileUrl: typeof body.bookFileUrl === "string" ? body.bookFileUrl : undefined,
      bookCoverUrl: typeof body.bookCoverUrl === "string" ? body.bookCoverUrl : undefined,
      isBook: body.isBook === true || body.industryPack === "publishing",
      releaseDate: typeof body.releaseDate === "number" ? body.releaseDate : undefined,
      previewUrl: typeof body.previewUrl === "string" ? body.previewUrl : undefined,
      allowDownload: body.allowDownload === true,
      drmEnabled: body.drmEnabled === true,
      approvalStatus: body.approvalStatus || ((body.isBook || body.industryPack === "publishing") ? 'PENDING' : undefined),
      contentDetails: body.contentDetails || undefined,
      // Subscription-linked item fields
      isSubscription: body.isSubscription === true,
      subscriptionPlanId: typeof body.subscriptionPlanId === "string" ? body.subscriptionPlanId : undefined,
      // Shipping
      shippingEnabled: body.shippingEnabled === true,
      shippingConfig: body.shippingEnabled && body.shippingConfig && typeof body.shippingConfig === "object"
        ? {
          enabled: true,
          weightLbs: typeof body.shippingConfig.weightLbs === "number" ? Math.max(0, body.shippingConfig.weightLbs) : undefined,
          dimensions: body.shippingConfig.dimensions && typeof body.shippingConfig.dimensions === "object" ? {
            length: typeof body.shippingConfig.dimensions.length === "number" ? Math.max(0, body.shippingConfig.dimensions.length) : undefined,
            width: typeof body.shippingConfig.dimensions.width === "number" ? Math.max(0, body.shippingConfig.dimensions.width) : undefined,
            height: typeof body.shippingConfig.dimensions.height === "number" ? Math.max(0, body.shippingConfig.dimensions.height) : undefined,
            unit: body.shippingConfig.dimensions.unit === "cm" ? "cm" : "in",
          } : undefined,
          shippingClass: ["standard", "oversized", "fragile", "hazardous"].includes(body.shippingConfig.shippingClass || "") ? body.shippingConfig.shippingClass : "standard",
          freeShippingThreshold: typeof body.shippingConfig.freeShippingThreshold === "number" ? Math.max(0, body.shippingConfig.freeShippingThreshold) : undefined,
          methodPricing: body.shippingConfig.methodPricing && typeof body.shippingConfig.methodPricing === "object"
            ? Object.fromEntries(
              Object.entries(body.shippingConfig.methodPricing)
                .filter(([k, v]) => ["standard", "express", "overnight", "freight"].includes(k) && typeof v === "number" && (v as number) >= 0)
                .map(([k, v]) => [k, Math.round((v as number) * 100) / 100])
            )
            : undefined,
          handlingTimeDays: typeof body.shippingConfig.handlingTimeDays === "number" ? Math.max(0, Math.floor(body.shippingConfig.handlingTimeDays)) : undefined,
          allowedMethods: Array.isArray(body.shippingConfig.allowedMethods) ? body.shippingConfig.allowedMethods.filter((m: string) => ["standard", "express", "overnight", "freight"].includes(m)) : undefined,
          originCountry: typeof body.shippingConfig.originCountry === "string" ? body.shippingConfig.originCountry.slice(0, 2).toUpperCase() : undefined,
          domesticOnly: body.shippingConfig.domesticOnly === true,
          requiresSignature: body.shippingConfig.requiresSignature === true,
          insuranceRequired: body.shippingConfig.insuranceRequired === true,
        }
        : undefined,
      // Delivery
      deliveryEnabled: body.deliveryEnabled === true,
    };

    try {
      const container = await getContainer();
      await container.items.upsert(doc as any);
      return NextResponse.json({ ok: true, item: doc }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      const saved = upsertInventoryItem(doc as InventoryItemMem);
      return NextResponse.json(
        { ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", item: saved },
        { headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e instanceof ReceiptCurrencyError ? e.code : (e?.message || "failed"), message: e?.message },
      { status: e instanceof ReceiptCurrencyError ? e.status : 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const id = String(url.searchParams.get("id") || "");
    let caller: any;
    try {
      caller = await requireApimOrJwt(req, ["inventory:write"]);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "unauthorized" },
        { status: e?.status || 401, headers: { "x-correlation-id": correlationId } }
      );
    }
    const wallet = caller.wallet;

    if (!id) {
      return NextResponse.json(
        { error: "id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // Ownership/admin enforcement for JWT callers
    if (caller.source === "jwt") {
      try {
        assertOwnershipOrAdmin(caller.wallet, wallet, (caller.roles || []).includes("admin"));
      } catch {
        return NextResponse.json(
          { error: "forbidden" },
          { status: 403, headers: { "x-correlation-id": correlationId } }
        );
      }
    }
    // CSRF and rate limiting
    try {
      if (caller.source === "jwt") requireCsrf(req);
      rateLimitOrThrow(req, rateKey(req, "inventory_delete", wallet), 30, 60 * 1000);
    } catch (e: any) {
      const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
      return NextResponse.json(
        { error: e?.message || "rate_limited", resetAt },
        { status: e?.status || 429, headers: { "x-correlation-id": correlationId } }
      );
    }
    if (!id) {
      return NextResponse.json(
        { error: "id_required" },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    try {
      const container = await getContainer();

      // Retrieve item to check status & handle cleanup
      let doc: any = null;
      try {
        const r = await container.item(id, wallet).read();
        doc = r.resource;
      } catch (e) { /* proceed to delete if read fails */ }

      if (doc) {
        // SAFETY: Approved books are ARCHIVED, not deleted, to preserve "My Library" access for buyers
        if (doc.approvalStatus === "APPROVED") {
          doc.approvalStatus = "ARCHIVED";
          doc.updatedAt = Date.now();
          await container.items.upsert(doc);
          return NextResponse.json({ ok: true, status: "archived" }, { headers: { "x-correlation-id": correlationId } });
        }

        // CLEANUP: Delete associated blobs for non-approved items (Drafts/Pending/Rejected)
        try {
          // Dynamic import to avoid circular deps with uploads or clutter
          const { deleteBlobSharedKey } = await import("@/lib/azure-storage");
          if (typeof doc.bookFileUrl === "string") await deleteBlobSharedKey(doc.bookFileUrl);
          if (typeof doc.bookCoverUrl === "string") await deleteBlobSharedKey(doc.bookCoverUrl);
          if (typeof doc.attributes?.downloadUrl === "string") await deleteBlobSharedKey(doc.attributes.downloadUrl);
        } catch (cleanupErr) {
          console.warn("Failed to clean up blobs for deleted item:", cleanupErr);
        }
      }

      // Cosmos requires partition key on delete
      await container.item(id, wallet).delete();
      return NextResponse.json({ ok: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
      const ok = deleteInventoryItem(id, wallet);
      return NextResponse.json(
        { ok, degraded: true, reason: e?.message || "cosmos_unavailable" },
        { headers: { "x-correlation-id": correlationId } }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
