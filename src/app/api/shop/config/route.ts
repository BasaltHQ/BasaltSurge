import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { IndustryPackType } from "@/lib/industry-packs";
import { requireApimOrJwt } from "@/lib/gateway-auth";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { getBrandKey } from "@/config/brands";
import { isPlatformContext } from "@/lib/env";

/**
 * Resolve the brand key for shop config.
 * Platform context (including localhost) always uses "portalpay".
 * Partner context uses the configured BRAND_KEY.
 */
async function resolveBrandKeyAsync(req?: NextRequest): Promise<string> {
  try {
    const url = req ? new URL(req.url) : null;
    const host = req?.headers.get("host") || url?.hostname || "";
    if (host) {
      const { getContainerIdentity } = require("@/lib/brand-config");
      const containerIdentity = await getContainerIdentity(host);
      if (containerIdentity.brandKey) {
        return containerIdentity.brandKey.toLowerCase();
      }
    }
  } catch {}
  try {
    const k = (getBrandKey(req) || "basaltsurge").toLowerCase();
    return k;
  } catch {
    return "basaltsurge";
  }
}

const DOC_ID = "shop:config";

function getDocIdForBrand(brandKey?: string): string {
  try {
    const key = String(brandKey || "").toLowerCase();
    // basaltsurge / portalpay shop configs use the legacy "shop:config" doc ID
    if (!key || key === "basaltsurge" || key === "portalpay") return DOC_ID;
    return `${DOC_ID}:${key}`;
  } catch {
    return DOC_ID;
  }
}

type ShopTheme = {
  primaryColor?: string;
  secondaryColor?: string;
  textColor?: string;
  accentColor?: string;
  brandLogoUrl?: string;
  coverPhotoUrl?: string;
  fontFamily?: string;
  logoShape?: "square" | "circle";
  heroFontSize?: "microtext" | "small" | "medium" | "large" | "xlarge";
  layoutMode?: "minimalist" | "balanced" | "maximalist";
  maximalistBannerUrl?: string;
  galleryImages?: string[];
  portalGradientEnabled?: boolean;
  portalGradientStart?: string;
  portalGradientEnd?: string;
  discretePayWithCrypto?: boolean;
};


type InventoryArrangement =
  | "grid"              // simple grid (default)
  | "featured_first"    // featured items at top, then grid
  | "groups"            // grouped by category
  | "carousel";         // horizontal carousel(s)

type LinkItem = {
  label: string;
  url: string;
};

export type ShopConfig = {
  id: string;
  wallet: string;
  type: "shop_config";
  brandKey?: string; // Brand namespace for multi-tenant isolation (e.g., "portalpay", "paynex")
  name: string;
  description?: string;
  bio?: string;
  theme: ShopTheme;
  arrangement: InventoryArrangement;
  defaultPaymentToken?: "ETH" | "USDC" | "USDT" | "cbBTC" | "cbXRP" | "SOL";
  accumulationMode?: "fixed" | "dynamic";
  xpPerDollar?: number; // Loyalty: XP multiplier per $1 spent
  loyalty?: {
    baseXP?: number;
    multiplier?: number;
    prestige?: {
      enabled: boolean;
      maxLevel: number;
      maxPrestige: number;
      ranks?: { level: number; title: string; iconUrl?: string }[];
    };
    platformOptIn?: boolean;
    rewards?: {
      id: string;
      level: number;
      type: 'item' | 'discount' | 'coupon';
      value?: string | number;
      prestige?: number;
      active?: boolean;
      industryPack?: string;
    }[];
    art?: import('@/utils/generative-art').PlatformArtConfig; // Merchant-specific art config or override
  };
  slug?: string; // public slug for root link (e.g., /krishnastore)
  links?: LinkItem[]; // merchant weblinks/socials
  industryPack?: IndustryPackType; // Active industry pack
  industryPackActivatedAt?: number; // Timestamp when pack was activated
  customDomain?: string; // Custom domain (e.g. shop.example.com)
  customDomainVerified?: boolean; // Whether the custom domain has been verified via DNS
  setupComplete?: boolean;
  keywords?: string[]; // Up to 5
  categories?: string[]; // Up to 3
  categoryConfig?: Record<string, { order: number; hidden: boolean }>; // Detailed category settings
  portalTheme?: Record<string, any>; // Portal Theme Playground config (opaque blob)
  deliveryEnabled?: boolean;
  deliveryFee?: number;
  deliveryRadius?: number;
  latitude?: number;
  longitude?: number;
  shopAddress?: string;
  createdAt: number;
  updatedAt: number;
};

function defaults(brandKey?: string): Required<Omit<ShopConfig, "wallet" | "id" | "type" | "slug" | "brandKey" | "industryPack" | "industryPackActivatedAt" | "defaultPaymentToken" | "accumulationMode">> {
  // Check if we're in BasaltSurge context - brandKey OR environment variable
  const envBrandKey = (process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
  const isBasalt = brandKey === "basaltsurge" || envBrandKey === "basaltsurge";

  return {
    name: "",
    description: "",
    bio: "",
    theme: {
      primaryColor: isBasalt ? "#22C55E" : "#0ea5e9", // Basalt Green or Portal Sky
      secondaryColor: isBasalt ? "#16A34A" : "#22c55e", // Basalt Dark Green or Portal Green
      textColor: "#0b1020",
      accentColor: "#f59e0b", // amber-500
      brandLogoUrl: isBasalt ? "/BasaltSurgeWideD.png" : "/BasaltSurgeWideD.png",
      coverPhotoUrl: "",
      fontFamily:
        "Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      logoShape: "square",
      heroFontSize: "medium",
      layoutMode: "balanced",
      maximalistBannerUrl: "",
      galleryImages: [],
      portalGradientEnabled: true,
      portalGradientStart: "",
      portalGradientEnd: "",
      discretePayWithCrypto: false,
    },
    arrangement: "grid",
    xpPerDollar: 1,
    loyalty: {
      prestige: {
        enabled: false,
        maxLevel: 55,
        maxPrestige: 10,
        ranks: []
      },
      platformOptIn: false,
      rewards: []
    },
    links: [],
    customDomain: "",
    customDomainVerified: false,
    setupComplete: false,
    keywords: [],
    categories: [],
    categoryConfig: undefined as any,
    portalTheme: undefined as any,
    deliveryEnabled: false,
    deliveryFee: 5.00,
    deliveryRadius: 10,
    latitude: 35.6895,
    longitude: 139.6917,
    shopAddress: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function isValidUrl(u: any): boolean {
  try {
    const v = String(u || "");
    if (!v) return false;
    if (/^https?:\/\//i.test(v)) return true;
    if (/^mailto:/i.test(v)) return true;
    if (/^\//.test(v)) return true;
    return false;
  } catch {
    return false;
  }
}

// Normalizes the shop config, applying defaults and ensuring validity.
function normalize(raw?: any, brandKey?: string): Omit<ShopConfig, "wallet" | "id" | "type"> & { slug?: string } {
  const d = defaults(brandKey);
  const out: any = {
    name: d.name,
    description: d.description,
    bio: d.bio,
    theme: { ...d.theme },
    arrangement: d.arrangement,
    xpPerDollar: 1,
    loyalty: undefined,
    links: [],
    customDomain: "",
    customDomainVerified: false,
    setupComplete: false,
    keywords: [],
    categories: [],
    categoryConfig: undefined,
    portalTheme: undefined,
    deliveryEnabled: d.deliveryEnabled,
    deliveryFee: d.deliveryFee,
    deliveryRadius: d.deliveryRadius,
    latitude: d.latitude,
    longitude: d.longitude,
    shopAddress: d.shopAddress,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    slug: undefined as string | undefined,
  };

  if (raw && typeof raw === "object") {
    if (typeof raw.name === "string") out.name = String(raw.name).slice(0, 64);
    if (typeof raw.description === "string") out.description = String(raw.description).slice(0, 4000);
    if (typeof raw.bio === "string") out.bio = String(raw.bio).slice(0, 2000);

    const t = raw.theme || {};
    out.theme = {
      primaryColor: typeof t.primaryColor === "string" ? t.primaryColor : d.theme.primaryColor,
      secondaryColor: typeof t.secondaryColor === "string" ? t.secondaryColor : d.theme.secondaryColor,
      textColor: typeof t.textColor === "string" ? t.textColor : d.theme.textColor,
      accentColor: typeof t.accentColor === "string" ? t.accentColor : d.theme.accentColor,
      brandLogoUrl: isValidUrl(t.brandLogoUrl) ? String(t.brandLogoUrl) : d.theme.brandLogoUrl,
      coverPhotoUrl: t.coverPhotoUrl === "" ? "" : (isValidUrl(t.coverPhotoUrl) ? String(t.coverPhotoUrl) : d.theme.coverPhotoUrl),
      fontFamily: typeof t.fontFamily === "string" ? t.fontFamily : d.theme.fontFamily,
      logoShape: (t.logoShape === "square" || t.logoShape === "circle") ? t.logoShape : d.theme.logoShape,
      heroFontSize: (t.heroFontSize === "microtext" || t.heroFontSize === "small" || t.heroFontSize === "medium" || t.heroFontSize === "large" || t.heroFontSize === "xlarge") ? t.heroFontSize : d.theme.heroFontSize,
      layoutMode: (t.layoutMode === "minimalist" || t.layoutMode === "balanced" || t.layoutMode === "maximalist") ? t.layoutMode : "balanced",
      maximalistBannerUrl: isValidUrl(t.maximalistBannerUrl) ? String(t.maximalistBannerUrl) : "",
      galleryImages: Array.isArray(t.galleryImages)
        ? [...t.galleryImages.slice(0, 5), ...Array(Math.max(0, 5 - t.galleryImages.length)).fill("")].map((x: any) => isValidUrl(x) ? String(x) : "")
        : Array(5).fill(""),
      portalGradientEnabled: typeof t.portalGradientEnabled === "boolean" ? t.portalGradientEnabled : d.theme.portalGradientEnabled,
      portalGradientStart: typeof t.portalGradientStart === "string" ? t.portalGradientStart : d.theme.portalGradientStart,
      portalGradientEnd: typeof t.portalGradientEnd === "string" ? t.portalGradientEnd : d.theme.portalGradientEnd,
      discretePayWithCrypto: typeof t.discretePayWithCrypto === "boolean" ? t.discretePayWithCrypto : d.theme.discretePayWithCrypto,
    };

    const arr = String(raw.arrangement || "").toLowerCase();
    out.arrangement = (["grid", "featured_first", "groups", "carousel"] as InventoryArrangement[]).includes(arr as any)
      ? (arr as InventoryArrangement)
      : d.arrangement;

    // XP per $ setting
    if (typeof raw.xpPerDollar === "number") {
      const v = Number(raw.xpPerDollar);
      out.xpPerDollar = Number.isFinite(v) && v >= 0 ? Math.min(1000, v) : out.xpPerDollar;
    }

    // Loyalty Settings
    if (raw.loyalty && typeof raw.loyalty === "object") {
      out.loyalty = {
        prestige: {
          enabled: Boolean(raw.loyalty.prestige?.enabled),
          maxLevel: Number(raw.loyalty.prestige?.maxLevel) || 55,
          maxPrestige: Number(raw.loyalty.prestige?.maxPrestige) || 10,
          ranks: Array.isArray(raw.loyalty.prestige?.ranks) ? raw.loyalty.prestige.ranks : []
        },
        platformOptIn: Boolean(raw.loyalty.platformOptIn),
        rewards: Array.isArray(raw.loyalty.rewards) ? raw.loyalty.rewards : []
      };
    }

    if (typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)) out.createdAt = Math.max(0, Math.floor(raw.createdAt));
    if (typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)) out.updatedAt = Math.max(0, Math.floor(raw.updatedAt));
    if (typeof raw.setupComplete === "boolean") out.setupComplete = raw.setupComplete;

    if (typeof raw.slug === "string") {
      const s = String(raw.slug).toLowerCase().trim();
      out.slug = s ? s.slice(0, 32) : undefined;
    }

    // Links
    if (Array.isArray(raw.links)) {
      const arr: any[] = raw.links;
      out.links = arr
        .filter((x) => x && typeof x === "object")
        .map((x) => {
          const label = typeof x.label === "string" ? String(x.label).slice(0, 64) : "";
          const url = typeof x.url === "string" ? String(x.url) : "";
          return { label, url };
        })
        .filter((x) => x.url && isValidUrl(x.url));
    }

    // Industry Pack
    if (typeof raw.industryPack === "string") {
      const validPacks: IndustryPackType[] = ["restaurant", "retail", "hotel", "freelancer", "publishing", "cannabis"];
      const packType = String(raw.industryPack).toLowerCase();
      if (validPacks.includes(packType as IndustryPackType)) {
        out.industryPack = packType as IndustryPackType;
      }
    }
    if (typeof raw.industryPackActivatedAt === "number" && Number.isFinite(raw.industryPackActivatedAt)) {
      out.industryPackActivatedAt = Math.max(0, Math.floor(raw.industryPackActivatedAt));
    }

    // Custom Domain
    if (typeof raw.customDomain === "string") {
      const cd = String(raw.customDomain).trim().toLowerCase();
      // Basic domain validation (loose)
      if (cd && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(cd)) {
        out.customDomain = cd;
      }
    }
    if (typeof raw.customDomainVerified === "boolean") {
      out.customDomainVerified = raw.customDomainVerified;
    }

    if (Array.isArray(raw.keywords)) {
      out.keywords = raw.keywords
        .filter((x: any) => typeof x === "string")
        .map((x: string) => x.trim().slice(0, 32))
        .filter((x: string) => x.length > 0)
        .slice(0, 5);
    }
    if (Array.isArray(raw.categories)) {
      out.categories = raw.categories
        .filter((x: any) => typeof x === "string")
        .map((x: string) => x.trim().slice(0, 32))
        .filter((x: string) => x.length > 0)
        .slice(0, 3);
    }
    
    // Category Config Validation
    if (raw.categoryConfig && typeof raw.categoryConfig === "object") {
      const cc: Record<string, { order: number; hidden: boolean }> = {};
      for (const [key, val] of Object.entries(raw.categoryConfig)) {
        if (typeof key === "string" && val && typeof val === "object") {
          const v = val as any;
          cc[key.trim()] = {
            order: typeof v.order === "number" && Number.isFinite(v.order) ? v.order : 0,
            hidden: typeof v.hidden === "boolean" ? v.hidden : false,
          };
        }
      }
      out.categoryConfig = cc;
    }

    // Portal Theme Playground config — passthrough as opaque blob
    if (raw.portalTheme && typeof raw.portalTheme === 'object') {
      out.portalTheme = raw.portalTheme;
    }

    if (typeof raw.deliveryEnabled === "boolean") out.deliveryEnabled = raw.deliveryEnabled;
    if (typeof raw.deliveryFee === "number") out.deliveryFee = raw.deliveryFee;
    if (typeof raw.deliveryRadius === "number") out.deliveryRadius = raw.deliveryRadius;
    if (typeof raw.latitude === "number") out.latitude = raw.latitude;
    if (typeof raw.longitude === "number") out.longitude = raw.longitude;
    if (typeof raw.shopAddress === "string") out.shopAddress = raw.shopAddress;

  }

  // Clamp colors to strings
  try {
    for (const k of Object.keys(out.theme || {})) {
      if (k === "galleryImages" || k === "portalGradientEnabled" || k === "discretePayWithCrypto") continue; // Preserve array and boolean
      const v = (out.theme as any)[k];
      (out.theme as any)[k] = typeof v === "string" ? v : (d.theme as any)[k];
    }
  } catch { }

  return out as any;
}

function validateWallet(raw: string): string {
  const w = String(raw || "").toLowerCase();
  return /^0x[a-f0-9]{40}$/.test(w) ? w : "";
}

/**
 * Reserved slugs that must never be claimed by shops,
 * to avoid conflicts with top-level routes and system paths.
 * Keep in sync with /api/shop/slug/route.ts
 */
const RESERVED_SLUGS = new Set<string>([
  "admin",
  "console",
  "developers",
  "developer",
  "docs",
  "doc",
  "shop",
  "portal",
  "terminal",
  "vs",
  "locations",
  "crypto-payments",
  "cannabis",
  "get-started",
  "faq",
  "u",
  "api",
  "og-image",
  "robots",
  "sitemap",
  "favicon",
  "team",
  "industry-packs",
  "analytics",
  "leaderboard",
  "inventory",
  "orders",
  "receipts",
  "reviews",
  "site",
  "platform",
  "partners",
  "billing",
  "merchants",
  "users",
  "auth",
  "test"
]);
function isReservedSlug(slug: string): boolean {
  try { return RESERVED_SLUGS.has(String(slug || "").toLowerCase()); } catch { return false; }
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
  try {
    const url = new URL(req.url);
    const referer = req.headers.get("referer") || "";
    const refPath = (() => { try { return referer ? (new URL(referer)).pathname : ""; } catch { return ""; } })();
    const isTerminalRef = refPath.startsWith("/terminal");
    // For GET requests, prioritize x-wallet header or wallet query param for public shop viewing
    const xWalletHeader = req.headers.get("x-wallet");
    const queryWallet = url.searchParams.get("wallet");
    let targetWallet = xWalletHeader ? validateWallet(xWalletHeader) : (queryWallet ? validateWallet(queryWallet) : "");
    let authUsed = false;

    // If no x-wallet header, try authentication (for merchant's own shop management)
    if (!targetWallet) {
      try {
        const caller = await requireApimOrJwt(req, ["shop:read"]);
        targetWallet = caller.wallet;
        authUsed = true;

        // Parse wallet query param for superadmin override
        const queryWallet = url.searchParams.get("wallet");
        const queryBrandKey = url.searchParams.get("brandKey"); // Allow override

        if (queryBrandKey) {
          // If manual brand key provided, use it (assumes caller is authorized to view this brand context)
          // We might want to add stricter checks here, but for now relies on valid JWT/APIM
        }

        if (queryWallet && caller.source === "jwt") {
          const ownerWallet = (process.env.NEXT_PUBLIC_OWNER_WALLET || "").toLowerCase();
          const isSuperadmin = ownerWallet && caller.wallet === ownerWallet;

          if (isSuperadmin || queryBrandKey) { // Allow if superadmin OR explicit brand context provided (e.g. Partner Admin)
            const validatedQueryWallet = validateWallet(queryWallet);
            if (validatedQueryWallet) {
              targetWallet = validatedQueryWallet;
            }
          }
        }
      } catch (e: any) {
        // Authentication failed and no x-wallet header - continue to slug/default handling
      }
    }

    const c = await getContainer();

    // Determine brand key (if configured); safe for platform legacy.
    let brandKey: string | undefined = undefined;
    try {
      const qBrand = url.searchParams.get("brandKey");
      brandKey = qBrand ? String(qBrand).toLowerCase() : await resolveBrandKeyAsync(req);
    } catch {
      brandKey = undefined;
    }

    // If no wallet but slug provided, attempt slug-based resolution
    if (!targetWallet) {
      const slugParamRaw = String(url.searchParams.get("slug") || "").toLowerCase().trim();
      const slugParam = slugParamRaw.replace(/[^a-z0-9\-]/g, "").slice(0, 32);
      // Ignore slug-based resolution when request originates from /terminal to avoid accidental shop context
      if (isTerminalRef) {
        return jsonResponse({ config: normalize(undefined, brandKey) }, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        });
      }
      if (slugParam) {
        // Do not resolve reserved slugs to wallets; treat as no-config/defaults to avoid hijacking top-level routes
        if (isReservedSlug(slugParam)) {
          return jsonResponse({ config: normalize(undefined, brandKey) }, {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
              "Pragma": "no-cache",
              "Expires": "0",
            },
          });
        }
        try {
          const spec = {
            query:
              "SELECT TOP 1 c.id, c.wallet, c.slug FROM c WHERE c.type='shop_config' AND LOWER(c.slug)=@s",
            parameters: [{ name: "@s", value: slugParam }],
          } as { query: string; parameters: { name: string; value: any }[] };
          const { resources } = await c.items.query(spec).fetchAll();
          const row = Array.isArray(resources) && resources.length ? (resources[0] as any) : null;
          const foundWallet = row && typeof row.wallet === "string" ? String(row.wallet).toLowerCase() : "";
          if (foundWallet) {
            // Prefer brand-scoped doc first when brand is configured
            try {
              if (brandKey) {
                const { resource } = await c.item(getDocIdForBrand(brandKey), foundWallet).read<any>();
                if (resource) {
                  // Merge site_config for payment preferences
                  let siteConf: any = null;
                  const siteDocId = getDocIdForBrand(brandKey).replace("shop:config", "site:config");
                  // 1. Try brand-scoped site config
                  try {
                    const { resource: sc } = await c.item(siteDocId, foundWallet).read<any>();
                    siteConf = sc;
                  } catch { }

                  // 2. Fallback: If no result, try legacy "site:config:basaltsurge" (old shared ID) and "site:config" (global)
                  if (!siteConf && siteDocId !== "site:config:basaltsurge") {
                    try {
                      const { resource: sc } = await c.item("site:config:basaltsurge", foundWallet).read<any>();
                      siteConf = sc;
                    } catch { }
                  }
                  if (!siteConf && siteDocId !== "site:config") {
                    try {
                      const { resource: sc } = await c.item("site:config", foundWallet).read<any>();
                      siteConf = sc;
                    } catch { }
                  }

                  const n = normalize(resource, brandKey);
                  // Inject payment tokens
                  if (siteConf) {
                    n.defaultPaymentToken = siteConf.defaultPaymentToken;
                    n.accumulationMode = siteConf.accumulationMode;
                  }

                  return jsonResponse({ config: n }, {
                    headers: {
                      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                      "Surrogate-Control": "no-store",
                      "Pragma": "no-cache",
                      "Expires": "0",
                    },
                  });
                }
              }
            } catch { }
            // In partner containers, try the legacy doc before returning defaults
            // The merchant may have saved their shop config before brand-scoping was added
            if (brandKey && String(brandKey).toLowerCase() !== "portalpay" && String(brandKey).toLowerCase() !== "basaltsurge") {
              try {
                const { resource: legacyRes } = await c.item(DOC_ID, foundWallet).read<any>();
                if (legacyRes) {
                  return jsonResponse({ config: normalize(legacyRes, brandKey) }, {
                    headers: {
                      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                      "Pragma": "no-cache",
                      "Expires": "0",
                    },
                  });
                }
              } catch { }
              return jsonResponse({ config: normalize(undefined, brandKey) }, {
                headers: {
                  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                  "Pragma": "no-cache",
                  "Expires": "0",
                },
              });
            }
            // Platform container: fallback to legacy doc id
            try {
              const { resource } = await c.item(DOC_ID, foundWallet).read<any>();
              if (resource) {
                // Merge site_config for payment preferences (legacy)
                let siteConf: any = null;
                try {
                  // Legacy site config ID is "site:config"
                  const { resource: sc } = await c.item("site:config", foundWallet).read<any>();
                  siteConf = sc;
                } catch { }

                const n = normalize(resource, brandKey);
                if (siteConf) {
                  n.defaultPaymentToken = siteConf.defaultPaymentToken;
                  n.accumulationMode = siteConf.accumulationMode;
                }

                return jsonResponse({ config: n }, {
                  headers: {
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                    "Pragma": "no-cache",
                    "Expires": "0",
                  },
                });
              }
            } catch { }
          }
        } catch {
          // ignore, fall through to defaults
        }
      }
    }

    // Prefer per-wallet config
    if (targetWallet) {
      let found = false;

      // Try brand-scoped doc first when brand is configured
      if (brandKey) {
        try {
          const { resource } = await c.item(getDocIdForBrand(brandKey), targetWallet).read<any>();
          if (resource) {
            found = true;
            return jsonResponse({ config: normalize(resource, brandKey) }, {
              headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
              },
            });
          }
        } catch { }
      }

      // In partner containers, try the legacy doc before returning defaults
      // The merchant may have saved their shop config before brand-scoping was added
      if (brandKey && String(brandKey).toLowerCase() !== "portalpay" && String(brandKey).toLowerCase() !== "basaltsurge") {
        try {
          const { resource: legacyRes } = await c.item(DOC_ID, targetWallet).read<any>();
          if (legacyRes) {
            found = true;
            return jsonResponse({ config: normalize(legacyRes, brandKey) }, {
              headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
              },
            });
          }
        } catch { }
        if (authUsed && !found) {
          // Authenticated path requested a specific wallet but no config exists in this brand
          return jsonResponse({ error: "not_found" }, { status: 404 });
        }
        return jsonResponse({ config: normalize(undefined, brandKey) }, {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        });
      }
      // Platform container: fallback to legacy doc id
      try {
        const { resource } = await c.item(DOC_ID, targetWallet).read<any>();
        if (resource) {
          found = true;
          return jsonResponse({ config: normalize(resource, brandKey) }, {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
              "Pragma": "no-cache",
              "Expires": "0",
            },
          });
        }
      } catch { }

      // Try database query fallback to find shop config for this wallet across all brands
      if (!found) {
        try {
          const spec = {
            query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @w",
            parameters: [{ name: "@w", value: targetWallet }]
          };
          const { resources } = await c.items.query(spec).fetchAll();
          if (Array.isArray(resources) && resources.length > 0) {
            found = true;
            return jsonResponse({ config: normalize(resources[0], brandKey) }, {
              headers: {
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
              },
            });
          }
        } catch { }
      }

      if (authUsed && !found) {
        return jsonResponse({ error: "not_found" }, { status: 404 });
      }
    }

    // No wallet provided or not found: return sane defaults (not globalized)
    return jsonResponse({ config: normalize(undefined, brandKey) }, {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });
  } catch (e: any) {
    let brandKey: string | undefined = undefined;
    try { brandKey = await resolveBrandKeyAsync(req); } catch { }
    return jsonResponse(
      { config: normalize(undefined, brandKey), degraded: true, reason: e?.message || "cosmos_unavailable" },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    // Admin-only: require JWT, do not allow APIM dev subscription writes
    let caller: any;
    try {
      caller = await requireThirdwebAuth(req);
    } catch {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const wallet = caller.wallet;
    // CSRF for UI writes
    try { requireCsrf(req); } catch (e: any) {
      return NextResponse.json({ error: e?.message || "bad_origin" }, { status: e?.status || 403 });
    }

    // Build candidate from previous + updates
    let prev: any = undefined;
    // Prefer brand-scoped doc first when brand is configured; fallback to legacy id
    let brandKey: string | undefined = undefined;
    try { brandKey = await resolveBrandKeyAsync(req); } catch { brandKey = undefined; }
    try {
      const c = await getContainer();
      if (brandKey) {
        try {
          const { resource } = await c.item(getDocIdForBrand(brandKey), wallet).read<any>();
          prev = resource;
        } catch { }
      }
      if (!prev) {
        const { resource } = await c.item(DOC_ID, wallet).read<any>();
        prev = resource;
      }
    } catch { }

    const base = normalize(prev);

    const name = typeof body.name === "string" ? String(body.name).slice(0, 64) : base.name;
    const description = typeof body.description === "string" ? String(body.description).slice(0, 4000) : base.description;
    const bio = typeof body.bio === "string" ? String(body.bio).slice(0, 2000) : base.bio;

    let theme = base.theme;
    if (body && typeof body.theme === "object" && body.theme) {
      // Merge with base theme to prevent clearing layoutMode/banners if they aren't in the partial update
      theme = normalize({ theme: { ...base.theme, ...body.theme } }).theme;
    }

    let arrangement: InventoryArrangement = base.arrangement;
    if (typeof body.arrangement === "string") {
      const v = String(body.arrangement).toLowerCase();
      arrangement = (["grid", "featured_first", "groups", "carousel"] as InventoryArrangement[]).includes(v as any)
        ? (v as InventoryArrangement)
        : base.arrangement;
    }

    // Loyalty: XP per $1
    let xpPerDollar = typeof base.xpPerDollar === "number" ? base.xpPerDollar : 1;
    if (typeof body.xpPerDollar === "number") {
      const v = Number(body.xpPerDollar);
      xpPerDollar = Number.isFinite(v) && v >= 0 ? Math.min(1000, v) : xpPerDollar;
    }

    // Loyalty
    let loyalty = base.loyalty;
    if (body.loyalty && typeof body.loyalty === "object") {
      loyalty = {
        // Save curve settings
        baseXP: Number(body.loyalty.baseXP) || (base.loyalty?.baseXP ?? 100),
        multiplier: Number(body.loyalty.multiplier) || (base.loyalty?.multiplier ?? 1.5),
        prestige: {
          enabled: Boolean(body.loyalty.prestige?.enabled),
          maxLevel: Number(body.loyalty.prestige?.maxLevel) || 50,
          maxPrestige: Number(body.loyalty.prestige?.maxPrestige) || 10,
          ranks: Array.isArray(body.loyalty.prestige?.ranks) ? body.loyalty.prestige.ranks : (base.loyalty?.prestige?.ranks || [])
        },
        platformOptIn: typeof body.loyalty.platformOptIn === "boolean" ? body.loyalty.platformOptIn : (base.loyalty?.platformOptIn || false),
        rewards: Array.isArray(body.loyalty.rewards) ? body.loyalty.rewards : (base.loyalty?.rewards || []),
        art: body.loyalty.art ?? base.loyalty?.art
      };
    }

    let slug = base.slug;
    if (typeof body.slug === "string") {
      const s = String(body.slug || "").toLowerCase().trim();
      const cleaned = s.replace(/[^a-z0-9\-]/g, "").replace(/^-+|-+$/g, "");
      const candidate = cleaned ? cleaned.slice(0, 32) : undefined;
      if (candidate && isReservedSlug(candidate)) {
        return NextResponse.json({ error: "reserved_slug" }, { status: 400 });
      }
      slug = candidate;
      // Note: actual reservation/uniqueness is handled by /api/shop/slug
    }

    // Links
    let links: LinkItem[] = Array.isArray(base.links) ? base.links : [];
    if (Array.isArray(body.links)) {
      links = body.links
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => {
          const label = typeof x.label === "string" ? String(x.label).slice(0, 64) : "";
          const url = typeof x.url === "string" ? String(x.url) : "";
          return { label, url };
        })
        .filter((x: LinkItem) => x.url && isValidUrl(x.url));
    }

    // Industry Pack
    let industryPack = base.industryPack;
    let industryPackActivatedAt = base.industryPackActivatedAt;
    if (typeof body.industryPack === "string") {
      const validPacks: IndustryPackType[] = ["restaurant", "retail", "hotel", "freelancer", "publishing", "cannabis"];
      const packType = String(body.industryPack).toLowerCase();
      if (validPacks.includes(packType as IndustryPackType)) {
        industryPack = packType as IndustryPackType;
        // Only update timestamp if pack is changing
        if (industryPack !== base.industryPack) {
          industryPackActivatedAt = Date.now();
        }
      }
    }

    // Custom Domain - only allow setting the domain string here. Verification status is handled by verify endpoint.
    // However, if domain changes, we must reset verification status.
    let customDomain = base.customDomain;
    let customDomainVerified = base.customDomainVerified;

    if (typeof body.customDomain === "string") {
      const cd = String(body.customDomain).trim().toLowerCase();
      if (cd !== customDomain) {
        customDomain = cd;
        customDomainVerified = false; // Reset verification on change
      }
    } else if (body.customDomain === null || body.customDomain === "") {
      customDomain = "";
      customDomainVerified = false;
    }

    const now = Date.now();
    const setupComplete = typeof body.setupComplete === "boolean" ? (body.setupComplete === true) : !!(name && slug);

    const deliveryEnabled = typeof body.deliveryEnabled === "boolean" ? body.deliveryEnabled : base.deliveryEnabled;
    const deliveryFee = typeof body.deliveryFee === "number" ? Math.max(0, body.deliveryFee) : base.deliveryFee;
    const deliveryRadius = typeof body.deliveryRadius === "number" ? Math.max(0, body.deliveryRadius) : base.deliveryRadius;
    const latitude = typeof body.latitude === "number" ? body.latitude : base.latitude;
    const longitude = typeof body.longitude === "number" ? body.longitude : base.longitude;
    const shopAddress = typeof body.shopAddress === "string" ? body.shopAddress : base.shopAddress;
    // Write to brand-scoped doc id only for partner brands (not 'portalpay'); keep legacy id on platform to avoid disrupting existing data.
    const docId = (brandKey && String(brandKey).toLowerCase() !== "portalpay" && String(brandKey).toLowerCase() !== "basaltsurge")
      ? getDocIdForBrand(brandKey)
      : DOC_ID;

    // Compute normalized brand key for the document
    const normalizedBrand = String(brandKey || "basaltsurge").toLowerCase();

    const doc: ShopConfig = {
      id: docId,
      wallet,
      type: "shop_config",
      brandKey: normalizedBrand,
      name,
      description,
      bio,
      theme,
      arrangement,

      xpPerDollar,
      loyalty,
      slug,
      links,
      industryPack,
      industryPackActivatedAt,
      customDomain,
      customDomainVerified,
      setupComplete,
      keywords: Array.isArray(body.keywords) ? normalize(body).keywords : base.keywords,
      categories: Array.isArray(body.categories) ? normalize(body).categories : base.categories,
      categoryConfig: typeof body.categoryConfig === "object" ? normalize({ categoryConfig: body.categoryConfig }).categoryConfig : base.categoryConfig,
      portalTheme: (body.portalTheme && typeof body.portalTheme === 'object')
        ? body.portalTheme
        : (body.portalTheme === null ? undefined : ((prev as any)?.portalTheme || (base as any).portalTheme || undefined)),
      deliveryEnabled,
      deliveryFee,
      deliveryRadius,
      latitude,
      longitude,
      shopAddress,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
    };

    try {
      const c = await getContainer();
      await c.items.upsert(doc as any);

      // ── Sync theme/name/slug to site_config documents ──
      // The admin's Save Config (PATCH /api/partner/client-requests) updates ALL
      // config docs. Do the same here so merchant edits propagate to site:config
      // which terminal, KDS, and other touchpoints may read from.
      try {
        const siteConfigQuery = {
          query: `SELECT * FROM c WHERE c.type = 'site_config' AND c.wallet = @w AND c.brandKey = @brand`,
          parameters: [
            { name: "@w", value: wallet },
            { name: "@brand", value: normalizedBrand }
          ]
        };
        const { resources: siteConfigs } = await c.items.query(siteConfigQuery).fetchAll();

        for (const sc of siteConfigs) {
          const updated = {
            ...sc,
            name: name || sc.name,
            slug: slug || sc.slug,
            theme: { ...(sc.theme || {}), ...theme },
            portalTheme: (doc as any).portalTheme ?? sc.portalTheme,
            updatedAt: now,
          };
          await c.item(sc.id, sc.wallet).replace(updated);
        }
      } catch (syncErr: any) {
        // Non-fatal: shop:config was saved successfully, site_config sync is best-effort
        console.warn("[shop/config] site_config sync failed (non-fatal):", syncErr?.message);
      }

      return NextResponse.json({ ok: true, config: doc });
    } catch (e: any) {
      return NextResponse.json({ ok: true, degraded: true, reason: e?.message || "cosmos_unavailable", config: doc });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "failed" }, { status: 500 });
  }
}
