import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { parseJsonBody } from "@/lib/validation";
import { auditEvent } from "@/lib/audit";
import { applyBrandDefaults } from "@/config/brands";
import { WebSiteManagementClient } from "@azure/arm-appservice";
import { DefaultAzureCredential } from "@azure/identity";
import { CdnManagementClient } from "@azure/arm-cdn";
import { ApiManagementClient } from "@azure/arm-apimanagement";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ProvisionRequest = {
  target?: "containerapps" | "appservice" | "k8s" | "plesk";
  image?: string; // e.g. myregistry.azurecr.io/portalpay:latest
  resourceGroup?: string;
  name?: string; // target app/container name (brand-specific)
  location?: string; // optional region
  env?: Record<string, string>; // additional env overrides
  domains?: string[]; // optional domain candidates (for later checker)
  action?: string; // optional action flag, e.g. "deploy"
  azure?: {
    subscriptionId?: string;
    resourceGroup?: string;
    apimName?: string;
    afdProfileName?: string;
    containerAppsEnvId?: string;
  };
};

type ProvisionPlan = {
  brandKey: string;
  brandName: string;
  target: "containerapps" | "appservice" | "k8s" | "plesk";
  image: string;
  resourceGroup?: string;
  name: string;
  env: Record<string, string>;
  domains?: string[];
  steps: string[]; // human-readable steps
  azExamples?: string[]; // sample Azure/Plesk CLI commands (informational)
  sshPublicKey?: string; // public SSH key for Git deploy keys configuration
  artifacts?: {
    apk?: {
      container: string;
      blobPath: string; // e.g., "brands/<brandKey>-signed.apk"
      note?: string;
    };
    zip?: {
      downloadUrl: string;
      note?: string;
    };
  };
};

function json(obj: any, init?: { status?: number; headers?: Record<string, string> }) {
  try {
    const s = JSON.stringify(obj);
    const len = new TextEncoder().encode(s).length;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    };
    headers["Content-Length"] = String(len);
    return new NextResponse(s, { status: init?.status ?? 200, headers });
  } catch {
    return NextResponse.json(obj, init as any);
  }
}

function defaultNameForBrand(brandKey: string, target: string): string {
  const base = brandKey.replace(/[^a-z0-9-]/g, "-");
  if (target === "containerapps") return `pp-${base}`;
  if (target === "appservice") return `pp-${base}`;
  return `pp-${base}`;
}

// Persist incremental deployment progress for the selected brand so the UI can poll and render step-by-step updates.
async function persistProgress(
  brandKey: string,
  correlationId: string,
  progress: Array<{ step: string; ok: boolean; info?: any }>
) {
  try {
    // Write progress snapshots to OS temp directory to avoid filesystem restrictions on App Service
    const tmpPath = path.join(os.tmpdir(), `payportal-progress.tmp.${brandKey}.json`);
    await fs.writeFile(
      tmpPath,
      JSON.stringify({ correlationId, progress, updatedAt: Date.now() }),
      "utf8"
    );
  } catch { }
}


/**
 * POST /api/platform/brands/[brandKey]/provision
 * Admin-only. Generates a provisioning plan to spawn a Partner container using the same image,
 * with BRAND_KEY=<brandKey> and brand-specific app URL and logos. This endpoint does not perform cloud operations;
 * it returns an actionable plan and sample Azure CLI commands that you can run in your environment.
 *
 * Body:
 * {
 *   "target": "containerapps" | "appservice" | "k8s",
 *   "image": "myregistry.azurecr.io/portalpay:latest",
 *   "resourceGroup": "rg-portalpay",
 *   "name": "pp-paynex",
 *   "location": "westus2",
 *   "env": { "ANY_EXTRA": "VALUE" },
 *   "domains": ["https://partner.example.com"]
 * }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ brandKey: string }> }) {
  const correlationId = crypto.randomUUID();
  const { brandKey } = await ctx.params;
  const key = String(brandKey || "").toLowerCase();

  // Admin-only (JWT)
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c.roles) ? c.roles : [];
    if (!roles.includes("admin")) {
      return json({ error: "forbidden", correlationId }, { status: 403, headers: { "x-correlation-id": correlationId } });
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return json({ error: "unauthorized", correlationId }, { status: 401, headers: { "x-correlation-id": correlationId } });
  }

  // CSRF + rate limit
  try {
    requireCsrf(req);
    rateLimitOrThrow(req, rateKey(req, "brand_provision_plan", key), 20, 60_000);
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    try {
      await auditEvent(req, {
        who: caller.wallet,
        roles: caller.roles,
        what: "brand_provision_plan",
        target: brandKey,
        correlationId,
        ok: false,
        metadata: { error: e?.message || "rate_limited", resetAt }
      });
    } catch { }
    return json(
      { error: e?.message || "rate_limited", resetAt, correlationId },
      { status: e?.status || 429, headers: { "x-correlation-id": correlationId, "x-ratelimit-reset": resetAt ? String(resetAt) : "" } }
    );
  }

  // Parse request body
  let body: ProvisionRequest;
  try {
    body = await parseJsonBody(req);
  } catch (e: any) {
    return json({ error: e?.message || "invalid_body", correlationId }, { status: 400, headers: { "x-correlation-id": correlationId } });
  }

  const action = String((body as any)?.action || "").toLowerCase();
  const target = (body.target as any) === "plesk" ? "plesk" : ((body.target as any) === "appservice" ? "appservice" : (body.target === "k8s" ? "k8s" : "containerapps"));
  // Default partner container registry: prefer AZURE_PARTNER_CONTAINER_REGISTRY
  const defaultRegistry = (process.env.AZURE_PARTNER_CONTAINER_REGISTRY || "").trim();
  const defaultImage = defaultRegistry
    ? `${defaultRegistry.replace(/\/+$/, "")}/payportal:latest`
    : "myregistry.azurecr.io/payportal:latest";
  const image = typeof body.image === "string" && body.image ? body.image : defaultImage;
  const resourceGroup = typeof body.resourceGroup === "string" ? body.resourceGroup : undefined;
  const name = typeof body.name === "string" && body.name ? body.name : defaultNameForBrand(key, target);
  const location = typeof body.location === "string" ? body.location : undefined;
  const extras = (body.env && typeof body.env === "object") ? body.env : {};
  const domains = Array.isArray(body.domains) ? body.domains.filter((d) => typeof d === "string" && d) : undefined;

  const brandBase = (() => {
    // Neutral base; avoid hardcoded BRANDS. Defaults will be hydrated via applyBrandDefaults (env overrides).
    const stub: any = {
      key,
      name: "",
      colors: { primary: "#0a0a0a", accent: "#6b7280" },
      logos: { app: "", favicon: "/favicon-32x32.png" },
      platformFeeBps: 50,
      partnerFeeBps: 0,
      defaultMerchantFeeBps: 0,
      partnerWallet: "",
      apimCatalog: [],
    };
    return applyBrandDefaults(stub);
  })();

  // Load saved brand config (name, logos, appUrl, partnerWallet) to prefer over static defaults
  // Direct Cosmos DB lookup to bypass multi-worker loopback fetch caching issues
  let brandConfig: any = null;
  let dbOverrides: any = null;
  try {
    const { readBrandOverridesFromCosmos, toEffectiveBrand } = require("@/lib/brand-config");
    dbOverrides = await readBrandOverridesFromCosmos(key);
    brandConfig = toEffectiveBrand(key, dbOverrides);
  } catch (e) {
    console.error("[provision] Failed to load brand config directly from DB:", e);
  }

  // Compute final branding overrides, falling back to body.env overrides if provided
  const brandNameOverride = String(
    extras.BRAND_NAME || extras.NEXT_PUBLIC_BRAND_NAME || brandConfig?.name || brandBase.name || key
  );
  const brandLogoOverride = String(
    extras.BRAND_LOGO_URL || extras.NEXT_PUBLIC_BRAND_LOGO_URL || brandConfig?.logos?.app || ""
  );
  const brandFaviconOverride = String(
    extras.BRAND_FAVICON_URL || extras.NEXT_PUBLIC_BRAND_FAVICON_URL || brandConfig?.logos?.favicon || ""
  );
  const brandSymbolOverride = String(
    extras.PP_BRAND_SYMBOL || brandConfig?.logos?.symbol || brandLogoOverride || ""
  );
  const computedSymbol = String(brandSymbolOverride || brandLogoOverride || "");
  const brandPartnerWallet = String(
    extras.PARTNER_WALLET || extras.NEXT_PUBLIC_PARTNER_WALLET || brandConfig?.partnerWallet || ""
  );
  const brandAppUrl = String(
    (domains && domains.length > 0
      ? domains[0]
      : (extras.BRAND_APP_URL || extras.NEXT_PUBLIC_BRAND_APP_URL || brandConfig?.appUrl || brandBase.appUrl || process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ""))
  );
  const cleanDomain = brandAppUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");

  // Extract brand colors
  const brandPrimaryColor = String(
    extras.BRAND_PRIMARY_COLOR || extras.NEXT_PUBLIC_BRAND_PRIMARY_COLOR || brandConfig?.colors?.primary || brandBase.colors?.primary || ""
  ).trim();
  const brandAccentColor = String(
    extras.BRAND_ACCENT_COLOR || extras.NEXT_PUBLIC_BRAND_ACCENT_COLOR || brandConfig?.colors?.accent || brandBase.colors?.accent || ""
  ).trim();

  // Extract Thirdweb parameters directly from raw Cosmos DB overrides
  const thirdwebClientId = String(dbOverrides?.thirdwebClientId || "");
  const thirdwebSecretKey = String(dbOverrides?.thirdwebSecretKey || "");
  const thirdwebAuthEndpointSecret = String(dbOverrides?.thirdwebAuthEndpointSecret || "");

  // Extract default agent settings
  const agentsList = Array.isArray(brandConfig?.agents) ? brandConfig.agents : [];
  const firstAgent = agentsList[0];
  const agentWallet = firstAgent ? String(firstAgent.wallet || "") : "";
  const agentFeeBps = firstAgent && typeof firstAgent.bps === "number" ? firstAgent.bps : 0;
  const agentsJson = JSON.stringify(agentsList);

  // For deployment, include env vars by allowlist and valid key pattern (avoid OS/reserved variables)
  const baseEnv: Record<string, string> = {};
  // Always include env vars by allowlist for both planning preview and deployment
  {
    const allowPrefixes = [
      "NEXT_PUBLIC_", "AZURE_", "COSMOS_", "THIRDWEB_", "PORTALPAY_", "MONGODB_",
      "APIM_", "AFD_", "UNISWAP_", "ETHERSCAN_", "BLOCKSCOUT_", "SEVENSHIFTS_",
      "TOAST_", "VARUNI_", "JWT_", "RESERVE_", "DEFAULT_", "PP_BRAND_", "AGENT_",
      "DB_", "S3_", "CLOUDFLARE_", "STRIPE_", "LINK_", "ELEVENLABS_", "PLESK_"
    ];
    const allowExact = [
      "JWT_SECRET", "NODE_ENV", "PORT", "WEBSITES_PORT", "BRAND_NAME", "BACKOFFICE_NAME",
      "DEMO_MODE", "DEMO_STUBS", "NEXT_PUBLIC_DEMO_MODE", "ADMIN_WALLETS", "PARTNER_WALLET",
      "NEXT_PUBLIC_PARTNER_WALLET", "NEXT_PUBLIC_APP_URL", "BRAND_KEY", "NEXT_PUBLIC_BRAND_KEY",
      "NEXT_PUBLIC_BRAND_NAME", "BRAND_APP_URL", "NEXT_PUBLIC_BRAND_APP_URL", "PP_BRAND_NAME",
      "PP_BRAND_LOGO", "PP_BRAND_FAVICON", "PP_BRAND_SYMBOL", "AGENT_WALLETS_JSON",
      "NEXT_PUBLIC_AGENT_WALLETS_JSON", "embedded", "DEBUG", "HOSTING_PROVIDER",
      "STORAGE_PROVIDER", "WEBSITES_ENABLE_APP_SERVICE_STORAGE"
    ];
    const denyKeys = new Set([
      "Path", "ComSpec", "PATHEXT", "ProgramFiles", "ProgramData", "CommonProgramFiles", "CommonProgramFiles(x86)",
      "SystemRoot", "WINDIR", "USERPROFILE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_IDENTIFIER"
    ]);
    const validKey = (k: string) => /^[A-Z0-9_]+$/.test(k); // App Service app settings must be simple keys
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v !== "string") continue;
      if (denyKeys.has(k)) continue;
      if (!validKey(k)) continue;
      if (allowExact.includes(k) || allowPrefixes.some((p) => k.startsWith(p))) {
        baseEnv[k] = v;
      }
    }
  }

  const env: Record<string, string> = {
    ...baseEnv,
    // Brand-specific overrides
    BRAND_KEY: key,
    NEXT_PUBLIC_BRAND_KEY: key,
    CONTAINER_TYPE: key === "portalpay" ? "platform" : "partner",
    NEXT_PUBLIC_CONTAINER_TYPE: key === "portalpay" ? "platform" : "partner",
    NEXT_PUBLIC_APP_URL: brandAppUrl,

    // Branding identity overrides (supporting current, legacy, and theme patterns)
    BRAND_NAME: brandNameOverride,
    NEXT_PUBLIC_BRAND_NAME: brandNameOverride,
    PP_BRAND_NAME: brandNameOverride,

    BRAND_APP_URL: brandAppUrl,
    NEXT_PUBLIC_BRAND_APP_URL: brandAppUrl,

    BRAND_PRIMARY_COLOR: brandPrimaryColor,
    NEXT_PUBLIC_BRAND_PRIMARY_COLOR: brandPrimaryColor,
    BRAND_ACCENT_COLOR: brandAccentColor,
    NEXT_PUBLIC_BRAND_ACCENT_COLOR: brandAccentColor,

    BRAND_LOGO_URL: brandLogoOverride,
    NEXT_PUBLIC_BRAND_LOGO_URL: brandLogoOverride,
    PP_BRAND_LOGO: brandLogoOverride,

    BRAND_FAVICON_URL: brandFaviconOverride,
    NEXT_PUBLIC_BRAND_FAVICON_URL: brandFaviconOverride,
    PP_BRAND_FAVICON: brandFaviconOverride,

    PP_BRAND_SYMBOL: computedSymbol,

    // Plesk Main Domain override (same as app URL origin)
    PLESK_MAIN_DOMAIN: cleanDomain,

    // Thirdweb Keys mapping (guaranteeing fallback to parent environment variables if brand overrides are empty)
    THIRDWEB_CLIENT_ID: thirdwebClientId || process.env.THIRDWEB_CLIENT_ID || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || "",
    NEXT_PUBLIC_THIRDWEB_CLIENT_ID: thirdwebClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || process.env.THIRDWEB_CLIENT_ID || "",
    THIRDWEB_SECRET_KEY: thirdwebSecretKey || process.env.THIRDWEB_SECRET_KEY || "",
    THIRDWEB_AUTH_ENDPOINT_SECRET: thirdwebAuthEndpointSecret || process.env.THIRDWEB_AUTH_ENDPOINT_SECRET || "",
    THIRDWEB_ADMIN_PRIVATE_KEY: process.env.THIRDWEB_ADMIN_PRIVATE_KEY || "",
    THIRDWEB_SERVER_WALLET_ADDRESS: process.env.THIRDWEB_SERVER_WALLET_ADDRESS || "",
    THIRDWEB_WAIT_UNTIL: process.env.THIRDWEB_WAIT_UNTIL || "confirmed",
    THIRDWEB_ENGINE_WALLET: process.env.THIRDWEB_ENGINE_WALLET || "",
    NEXT_PUBLIC_THIRDWEB_ENGINE_WALLET: process.env.NEXT_PUBLIC_THIRDWEB_ENGINE_WALLET || "",
    // Agent mapping
    ...(agentWallet ? {
      AGENT_WALLET: agentWallet,
      NEXT_PUBLIC_AGENT_WALLET: agentWallet
    } : {}),
    ...(agentFeeBps ? {
      AGENT_SPLIT_BPS: String(agentFeeBps),
      NEXT_PUBLIC_AGENT_SPLIT_BPS: String(agentFeeBps)
    } : {}),
    AGENT_WALLETS_JSON: agentsJson,
    NEXT_PUBLIC_AGENT_WALLETS_JSON: agentsJson,
    // Wallets configuration
    ADMIN_WALLETS: brandPartnerWallet,
    PARTNER_WALLET: brandPartnerWallet,
    NEXT_PUBLIC_PARTNER_WALLET: brandPartnerWallet,
    NEXT_PUBLIC_OWNER_WALLET: brandPartnerWallet,
    NEXT_PUBLIC_RECIPIENT_ADDRESS: brandPartnerWallet,
    NEXT_PUBLIC_PLATFORM_WALLET: String(
      (extras as any)?.NEXT_PUBLIC_PLATFORM_WALLET || process.env.NEXT_PUBLIC_PLATFORM_WALLET || ""
    ),

    // App Service container defaults
    PORT: String((extras as any)?.PORT || process.env.PORT || "3000"),
    WEBSITES_PORT: String((extras as any)?.WEBSITES_PORT || process.env.WEBSITES_PORT || "3000"),
    WEBSITES_CONTAINER_START_TIME_LIMIT: String(process.env.WEBSITES_CONTAINER_START_TIME_LIMIT || "1800"),
    // User-provided extras (from request body)
    ...extras,
  };

  // Backfill PP_BRAND_* keys from request extras when brand config values were not yet persisted.
  try {
    const nameFromExtras = String((extras as any)?.BRAND_NAME || (extras as any)?.NEXT_PUBLIC_BRAND_NAME || "").trim();
    const logoFromExtras = String((extras as any)?.BRAND_LOGO_URL || (extras as any)?.NEXT_PUBLIC_BRAND_LOGO_URL || "").trim();
    const faviconFromExtras = String((extras as any)?.BRAND_FAVICON_URL || (extras as any)?.NEXT_PUBLIC_BRAND_FAVICON_URL || "").trim();
    const symbolFromExtras = String((extras as any)?.BRAND_SYMBOL_URL || (extras as any)?.NEXT_PUBLIC_BRAND_SYMBOL_URL || "").trim();
    if (!env.PP_BRAND_NAME && nameFromExtras) env.PP_BRAND_NAME = nameFromExtras;
    if (!env.PP_BRAND_LOGO && logoFromExtras) env.PP_BRAND_LOGO = logoFromExtras;
    if (!env.PP_BRAND_FAVICON && faviconFromExtras) env.PP_BRAND_FAVICON = faviconFromExtras;
    if (!env.PP_BRAND_SYMBOL && (symbolFromExtras || logoFromExtras)) env.PP_BRAND_SYMBOL = symbolFromExtras || logoFromExtras;
  } catch { }
  // Fallback partner wallet: if brand config partnerWallet is empty, use extras/ENV to set owner/recipient and admin list
  try {
    const partnerCandidate = (() => {
      const ex = extras as any;
      const cand = String(ex?.NEXT_PUBLIC_PARTNER_WALLET || ex?.PARTNER_WALLET || process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "").toLowerCase();
      return /^0x[a-f0-9]{40}$/i.test(cand) ? cand : "";
    })();
    if (!/^0x[a-fA-F0-9]{40}$/.test(brandPartnerWallet) && partnerCandidate) {
      env.PARTNER_WALLET = partnerCandidate;
      env.NEXT_PUBLIC_PARTNER_WALLET = partnerCandidate;
      // Set recipient/owner to partner for partner containers
      env.NEXT_PUBLIC_RECIPIENT_ADDRESS = partnerCandidate;
      env.NEXT_PUBLIC_OWNER_WALLET = partnerCandidate;
      // Merge into ADMIN_WALLETS
      try {
        const currentAdmins = String(env.ADMIN_WALLETS || process.env.ADMIN_WALLETS || "").trim();
        const list = currentAdmins ? currentAdmins.split(/[,\s]+/).map(s => String(s || "").toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/i.test(s)) : [];
        const final = Array.from(new Set([...list, partnerCandidate])).join(",");
        env.ADMIN_WALLETS = final;
      } catch {
        env.ADMIN_WALLETS = partnerCandidate;
      }
    }
  } catch { }

  // Partner container overrides: use partner wallet as recipient identity
  const isPartner = key !== "portalpay";
  if (isPartner && /^0x[a-fA-F0-9]{40}$/.test(brandPartnerWallet)) {
    // Partner identity: route receipts and admin gates to partner wallet
    env.NEXT_PUBLIC_RECIPIENT_ADDRESS = brandPartnerWallet;
    env.NEXT_PUBLIC_OWNER_WALLET = brandPartnerWallet;

    // Initialize ADMIN_WALLETS to include partner wallet for immediate admin access
    try {
      const adminsRaw = String((env as any).ADMIN_WALLETS || process.env.ADMIN_WALLETS || "").trim();
      const list = adminsRaw
        ? adminsRaw.split(/[,\s]+/).map((s) => String(s || "").toLowerCase()).filter((s) => /^0x[a-f0-9]{40}$/i.test(s))
        : [];
      const final = Array.from(new Set([...list, String(brandPartnerWallet).toLowerCase()])).join(",");
      env.ADMIN_WALLETS = final;
    } catch {
      env.ADMIN_WALLETS = String(brandPartnerWallet).toLowerCase();
    }
  }

  let sshPublicKey: string | undefined = undefined;
  if (target === "plesk") {
    try {
      const sshDir = "/var/www/vhosts/basalthq.com/.ssh";
      const pubKeyPath = `${sshDir}/id_rsa.pub`;
      const privKeyPath = `${sshDir}/id_rsa`;

      // Try reading the public key
      try {
        const pubKey = await fs.readFile(pubKeyPath, "utf8");
        sshPublicKey = pubKey.trim();
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // If it doesn't exist, try to generate it
          const { exec } = require("node:child_process");
          const { promisify } = require("node:util");
          const execAsync = promisify(exec);
          
          await fs.mkdir(sshDir, { recursive: true });
          await execAsync(`ssh-keygen -t rsa -b 4096 -f "${privKeyPath}" -N "" -q`);
          const pubKey = await fs.readFile(pubKeyPath, "utf8");
          sshPublicKey = pubKey.trim();
        } else {
          throw err;
        }
      }
    } catch (e: any) {
      console.error("[Plesk] Failed to resolve SSH key:", e.message);
      sshPublicKey = "Error: Could not read/generate SSH key. Ensure /var/www/vhosts/basalthq.com/.ssh is writeable.";
    }
  }

  let steps: string[] = [];
  let azExamples: string[] = [];

  const nextPublicThirdwebClientId = thirdwebClientId || process.env.NEXT_PUBLIC_THIRDWEB_CLIENT_ID || process.env.THIRDWEB_CLIENT_ID || "";
  const nextPublicAppUrl = brandAppUrl || "";
  const nextPublicChainId = process.env.NEXT_PUBLIC_CHAIN_ID || "8453";
  const nextPublicBrandKey = key || "";
  const nextPublicOwnerWallet = brandPartnerWallet || process.env.NEXT_PUBLIC_OWNER_WALLET || "";
  const nextPublicDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE || "true";
  const nextPublicRecipientAddress = brandPartnerWallet || process.env.NEXT_PUBLIC_RECIPIENT_ADDRESS || "";
  const nextPublicPlatformWallet = process.env.NEXT_PUBLIC_PLATFORM_WALLET || "";
  const nextPublicSpawncampFactoryAddress = process.env.NEXT_PUBLIC_SPAWNCAMP_FACTORY_ADDRESS || "";
  const nextPublicDiscordUrl = process.env.NEXT_PUBLIC_DISCORD_URL || "";
  const nextPublicGraphqlUrl = process.env.NEXT_PUBLIC_GRAPHQL_URL || "";
  const nextPublicBaseUsdcAddress = process.env.NEXT_PUBLIC_BASE_USDC_ADDRESS || "";
  const nextPublicBaseUsdcDecimals = process.env.NEXT_PUBLIC_BASE_USDC_DECIMALS || "";
  const nextPublicBaseUsdtAddress = process.env.NEXT_PUBLIC_BASE_USDT_ADDRESS || "";
  const nextPublicBaseUsdtDecimals = process.env.NEXT_PUBLIC_BASE_USDT_DECIMALS || "";
  const nextPublicBaseCbbtcAddress = process.env.NEXT_PUBLIC_BASE_CBBTC_ADDRESS || "";
  const nextPublicBaseCbbtcDecimals = process.env.NEXT_PUBLIC_BASE_CBBTC_DECIMALS || "";
  const nextPublicBaseCbxrpAddress = process.env.NEXT_PUBLIC_BASE_CBXRP_ADDRESS || "";
  const nextPublicBaseCbxrpDecimals = process.env.NEXT_PUBLIC_BASE_CBXRP_DECIMALS || "";
  const nextPublicBaseSolAddress = process.env.NEXT_PUBLIC_BASE_SOL_ADDRESS || "";
  const nextPublicBaseSolDecimals = process.env.NEXT_PUBLIC_BASE_SOL_DECIMALS || "";
  const nextPublicBearCloudApiUrl = process.env.NEXT_PUBLIC_BEAR_CLOUD_API_URL || "";
  const nextPublicBearCloudAuthUrl = process.env.NEXT_PUBLIC_BEAR_CLOUD_AUTH_URL || "";
  const nextPublicBearCloudApiKey = process.env.NEXT_PUBLIC_BEAR_CLOUD_API_KEY || "";
  const nextPublicBearCloudSecret = process.env.NEXT_PUBLIC_BEAR_CLOUD_SECRET || "";
  const nextPublicBearCloudScope = process.env.NEXT_PUBLIC_BEAR_CLOUD_SCOPE || "";
  const nextPublicDemoFreezeTime = process.env.NEXT_PUBLIC_DEMO_FREEZE_TIME || "";
  const nextPublicBearCloudTimeout = process.env.NEXT_PUBLIC_BEAR_CLOUD_TIMEOUT || "";
  const nextPublicRoboticsEnabled = process.env.NEXT_PUBLIC_ROBOTICS_ENABLED || "true";
  const nextPublicRoboticsUseMockFallback = process.env.NEXT_PUBLIC_ROBOTICS_USE_MOCK_FALLBACK || "true";
  const nextPublicThirdwebEngineWallet = process.env.NEXT_PUBLIC_THIRDWEB_ENGINE_WALLET || "";
  const nextPublicStripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
 
  const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN || "";
  const cloudflareZoneId = process.env.CLOUDFLARE_ZONE_ID || "";
  const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  const serverThirdwebSecretKey = thirdwebSecretKey || process.env.THIRDWEB_SECRET_KEY || "";
  const stripeApiKey = process.env.STRIPE_API_KEY || "";
  const nextPublicStripeHeadless = process.env.NEXT_PUBLIC_STRIPE_HEADLESS || "TRUE";

  const envLines = [
    "# Export the critical NEXT_PUBLIC vars so next build can inline them",
    `export NEXT_PUBLIC_THIRDWEB_CLIENT_ID="${nextPublicThirdwebClientId}"`,
    `export NEXT_PUBLIC_APP_URL="${nextPublicAppUrl}"`,
    `export NEXT_PUBLIC_CHAIN_ID="${nextPublicChainId}"`,
    `export NEXT_PUBLIC_BRAND_KEY="${nextPublicBrandKey}"`,
    `export NEXT_PUBLIC_OWNER_WALLET="${nextPublicOwnerWallet}"`,
    `export NEXT_PUBLIC_DEMO_MODE="${nextPublicDemoMode}"`,
    `export NEXT_PUBLIC_RECIPIENT_ADDRESS="${nextPublicRecipientAddress}"`,
    `export NEXT_PUBLIC_PLATFORM_WALLET="${nextPublicPlatformWallet}"`,
    `export NEXT_PUBLIC_SPAWNCAMP_FACTORY_ADDRESS="${nextPublicSpawncampFactoryAddress}"`,
    `export NEXT_PUBLIC_DISCORD_URL="${nextPublicDiscordUrl}"`,
    `export NEXT_PUBLIC_GRAPHQL_URL="${nextPublicGraphqlUrl}"`,
    `export NEXT_PUBLIC_BASE_USDC_ADDRESS="${nextPublicBaseUsdcAddress}"`,
    `export NEXT_PUBLIC_BASE_USDC_DECIMALS="${nextPublicBaseUsdcDecimals}"`,
    `export NEXT_PUBLIC_BASE_USDT_ADDRESS="${nextPublicBaseUsdtAddress}"`,
    `export NEXT_PUBLIC_BASE_USDT_DECIMALS="${nextPublicBaseUsdtDecimals}"`,
    `export NEXT_PUBLIC_BASE_CBBTC_ADDRESS="${nextPublicBaseCbbtcAddress}"`,
    `export NEXT_PUBLIC_BASE_CBBTC_DECIMALS="${nextPublicBaseCbbtcDecimals}"`,
    `export NEXT_PUBLIC_BASE_CBXRP_ADDRESS="${nextPublicBaseCbxrpAddress}"`,
    `export NEXT_PUBLIC_BASE_CBXRP_DECIMALS="${nextPublicBaseCbxrpDecimals}"`,
    `export NEXT_PUBLIC_BASE_SOL_ADDRESS="${nextPublicBaseSolAddress}"`,
    `export NEXT_PUBLIC_BASE_SOL_DECIMALS="${nextPublicBaseSolDecimals}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_API_URL="${nextPublicBearCloudApiUrl}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_AUTH_URL="${nextPublicBearCloudAuthUrl}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_API_KEY="${nextPublicBearCloudApiKey}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_SECRET="${nextPublicBearCloudSecret}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_SCOPE="${nextPublicBearCloudScope}"`,
    `export NEXT_PUBLIC_DEMO_FREEZE_TIME="${nextPublicDemoFreezeTime}"`,
    `export NEXT_PUBLIC_BEAR_CLOUD_TIMEOUT="${nextPublicBearCloudTimeout}"`,
    `export NEXT_PUBLIC_ROBOTICS_ENABLED="${nextPublicRoboticsEnabled}"`,
    `export NEXT_PUBLIC_ROBOTICS_USE_MOCK_FALLBACK="${nextPublicRoboticsUseMockFallback}"`,
    `export NEXT_PUBLIC_THIRDWEB_ENGINE_WALLET="${nextPublicThirdwebEngineWallet}"`,
    `export NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="${nextPublicStripePublishableKey}"`,
    "",
    "# Also export server-side vars needed during build",
    `export CLOUDFLARE_API_TOKEN="${cloudflareApiToken}"`,
    `export CLOUDFLARE_ZONE_ID="${cloudflareZoneId}"`,
    `export CLOUDFLARE_ACCOUNT_ID="${cloudflareAccountId}"`,
    `export THIRDWEB_SECRET_KEY="${serverThirdwebSecretKey}"`,
    `export NODE_ENV="production"`,
    `export STRIPE_API_KEY="${stripeApiKey}"`,
    `export NEXT_PUBLIC_STRIPE_HEADLESS="${nextPublicStripeHeadless}"`
  ];
  const envContent = envLines.join("\n");

  if (target === "plesk") {
    steps = [
      "Ensure the domain CNAME is pointed to your Plesk server.",
      "Verify the Plesk server API key and endpoint are set correctly in the environment.",
      "Run the provision API with action=deploy to automatically create the domain and link the Git repository.",
      "Copy the Plesk subscription SSH public key shown below and add it as a Deploy Key on the BasaltSurge GitHub repository (one-time setup).",
      "Configure Next.js build-time variables in .env.production inside the domain root folder.",
      "Configure Passenger runtime variables via Plesk panel or nodetool.",
      "Run git pull to download the source, trigger npm install, and run npm run build.",
      "Restart the passenger Node.js process by touching tmp/restart.txt inside the domain root."
    ];

    azExamples = [
      `# --- Plesk CLI Commands (Run via SSH on VPS or automated via deploy action) ---`,
      `# 1. Create the domain under basalthq.com webspace`,
      `plesk bin site --create ${cleanDomain} -webspace-name basalthq.com`,
      `# 2. Configure Git SSH deployment repository`,
      `plesk bin extension --call git --create -domain ${cleanDomain} -name BasaltSurge -remote-url git@github.com:BasaltHQ/BasaltSurge.git -active-branch production -run-actions true -actions "export PATH=/opt/plesk/node/24/bin:$PATH && npm install && npm run build && mkdir -p tmp && touch tmp/restart.txt"`,
      `# 3. Create build-time .env.production file inside domain root`,
      `mkdir -p /var/www/vhosts/basalthq.com/${cleanDomain}`,
      `cat << 'EOF' > /var/www/vhosts/basalthq.com/${cleanDomain}/.env.production\n${envContent}\nEOF`,
      `# 4. Inject Passenger Runtime Environment Variables`,
      ...Object.entries(env).map(([k, v]) => `plesk bin extension nodejs --nodetool -s -domain ${cleanDomain} -env-val "${k}=${v}"`),
      `# 5. Secure the domain with Let's Encrypt SSL`,
      `plesk bin extension --exec letsencrypt cli.php -d ${cleanDomain}`
    ];
  } else {
    steps = [
      "Ensure the target environment has network access to existing APIM/AFD instances (no new APIM/AFD will be created).",
      `Deploy the container using the same image: ${image}.`,
      `Set environment variables: BRAND_KEY=${brandKey}, NEXT_PUBLIC_APP_URL=${env.NEXT_PUBLIC_APP_URL}, PP_BRAND_NAME, PP_BRAND_LOGO, PP_BRAND_FAVICON.`,
      "Bind the custom domain in Azure Front Door (existing profile). Ensure origin points to the new container endpoint.",
      "Run the domain checker in Platform Admin to verify DNS CNAME/AFD binding and HTTPS health.",
      "Populate Partner Developer catalog via /api/platform/brands/[brandKey]/catalog PATCH (aliasName/aliasDescription/visible/docsSlug).",
      "Build brand-specific Android APK artifact as part of deploy pipeline:",
      ` - Rebuild launcher sources under android/launcher/recovered/src-${key} with apktool`,
      " - Zipalign and sign with keystore (keystore path/alias/pass from secure secrets)",
      " - Upload signed APK to Azure Blob Storage container (e.g., 'apks') at blob path 'brands/<brandKey>-signed.apk'",
      "Configure app settings for APK serving endpoint:",
      " - PP_APK_CONTAINER=apks",
      " - PP_APK_BLOB_PREFIX=brands",
      " - AZURE_STORAGE_CONNECTION_STRING (or provide SAS-based proxy) — used server-side to read APK",
      "Access policy: only Admin/Superadmin can stream APKs; partner containers see their own brand APK only; platform sees all.",
      "Installer ZIP download: GET /api/admin/apk/zips/{app} (portalpay|paynex) — dynamic ZIP containing APK and Windows .bat installer; gated to Admin/Superadmin; partner containers limited to own brand.",
    ];

    if (target === "containerapps") {
      azExamples.push(
        `az containerapp create --name ${name} --resource-group ${resourceGroup || "<rg>"} --image ${image} --environment <aca-env> --ingress external --target-port 3000 --cpu 0.5 --memory 1Gi`,
        ...Object.entries(env).map(([k, v]) => `az containerapp env vars set --name ${name} --resource-group ${resourceGroup || "<rg>"} --environment-variables ${k}='${v}'`),
        `# Bind custom domain in AFD (existing), then verify:`,
        `curl -s '${env.NEXT_PUBLIC_APP_URL || "https://partner.example.com"}' -I`
      );
    } else if (target === "appservice") {
      azExamples.push(
        `az webapp create --name ${name} --resource-group ${resourceGroup || "<rg>"} --plan <appservice-plan> --runtime 'NODE:18-lts'`,
        `az webapp config container set --name ${name} --resource-group ${resourceGroup || "<rg>"} --docker-custom-image-name ${image}`,
        ...Object.entries(env).map(([k, v]) => `az webapp config appsettings set --name ${name} --resource-group ${resourceGroup || "<rg>"} --settings ${k}='${v}'`),
        `# Bind custom domain with AFD route; confirm HTTPS health:`,
        `curl -s '${env.NEXT_PUBLIC_APP_URL || "https://partner.example.com"}' -I`
      );
    } else {
      // k8s illustrative snippet
      azExamples.push(
        `kubectl create deployment ${name} --image=${image}`,
        `kubectl set env deployment/${name} ${Object.entries(env).map(([k, v]) => `${k}='${v}'`).join(" ")}`,
        `kubectl expose deployment/${name} --type=LoadBalancer --port=80 --target-port=3000`,
        `# Bind domain in AFD and verify:`,
        `curl -s '${env.NEXT_PUBLIC_APP_URL || "https://partner.example.com"}' -I`
      );
    }

    // APK build and upload examples (run in CI/CD or operator workstation)
    {
      const apkContainer = String(process.env.PP_APK_CONTAINER || "apks");
      const apkPrefix = String(process.env.PP_APK_BLOB_PREFIX || "brands");
      const unsignedOut = `dist/${key}-unsigned.apk`;
      const alignedOut = `dist/${key}-aligned.apk`;
      const signedOut = `dist/${key}-signed.apk`;
      const blobPath = `${apkPrefix}/${key}-signed.apk`;

      azExamples.push(
        `# --- Build brand APK (${key}) ---`,
        `mkdir -p dist`,
        `tools/apktool.bat b android/launcher/recovered/src-${key} -o ${unsignedOut}`,
        `# If zipalign available in PATH:`,
        `zipalign -v -p 4 ${unsignedOut} ${alignedOut}`,
        `# Sign with apksigner (use secret keystore + alias + passwords):`,
        `apksigner sign --ks %ANDROID_KEYSTORE% --ks-key-alias %ANDROID_KEY_ALIAS% --ks-pass pass:%ANDROID_KEY_PASS% --key-pass pass:%ANDROID_KEY_PASS% --out ${signedOut} ${alignedOut}`,
        `# --- Upload to Azure Blob (using connection string) ---`,
        `az storage blob upload --connection-string "$AZURE_STORAGE_CONNECTION_STRING" --container-name ${apkContainer} --name ${blobPath} --file ${signedOut} --overwrite true`,
        `# Set app settings so the runtime can stream from Blob:`,
        `az webapp config appsettings set --name ${name} --resource-group ${resourceGroup || "<rg>"} --settings PP_APK_CONTAINER=${apkContainer} PP_APK_BLOB_PREFIX=${apkPrefix}`
      );
    }
  }

  const plan: ProvisionPlan = {
    brandKey: key,
    brandName: brandNameOverride,
    target,
    image,
    resourceGroup,
    name,
    env,
    domains,
    steps,
    azExamples,
    sshPublicKey,
    artifacts: {
      apk: {
        container: String(process.env.PP_APK_CONTAINER || "apks"),
        blobPath: `${String(process.env.PP_APK_BLOB_PREFIX || "brands")}/${key}-signed.apk`,
        note: "The runtime will stream from Blob if AZURE_STORAGE_CONNECTION_STRING, PP_APK_CONTAINER, PP_APK_BLOB_PREFIX are configured."
      },
      zip: {
        downloadUrl: `/api/admin/apk/zips/${key}`,
        note: "Dynamic ZIP (APK + install .bat + README). Admin/Superadmin only; partner containers limited to their brand."
      }
    }
  };

  try {
    await auditEvent(req, {
      who: caller.wallet,
      roles: caller.roles,
      what: "brand_provision_plan",
      target: key,
      correlationId,
      ok: true,
      metadata: { target, name, resourceGroup, image },
    });
  } catch { }

  // Optional one-click deployment using service principal credentials
  // Requires environment variables:
  // - AZURE_SUBSCRIPTION_ID (subscription)
  // - AZURE_RESOURCE_GROUP (APIM resource group)
  // - AZURE_APIM_NAME (existing APIM instance name)
  // - AZURE_AFD_PROFILE_NAME (existing Azure Front Door profile name)
  // - AZURE_CONTAINERAPPS_ENV_ID (managed environment resource ID for Azure Container Apps)
  // action already parsed above

  if (action === "deploy") {
    if (target === "plesk") {
      const cleanDomain = brandAppUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      if (!cleanDomain || cleanDomain.includes("localhost")) {
        return json(
          {
            error: "invalid_domain",
            correlationId,
            message: `Plesk deployment requires a valid domain. Got: ${cleanDomain}`,
            plan
          },
          { status: 400, headers: { "x-correlation-id": correlationId } }
        );
      }

      const progress: Array<{ step: string; ok: boolean; info?: any }> = [];
      try {
        const { PleskClient } = require("@/lib/hosting/plesk/client");
        const plesk = new PleskClient();
        progress.push({ step: "auth", ok: true });
        await persistProgress(key, correlationId, progress);

        // Step 1: Create domain (site) under webspace basalthq.com
        progress.push({ step: "creating_site", ok: true, info: { domain: cleanDomain } });
        await persistProgress(key, correlationId, progress);
        
        const siteResult = await plesk.callCli("site", [
          "--create", cleanDomain,
          "-webspace-name", "basalthq.com"
        ]);
        
        if (siteResult.code !== 0 && !siteResult.stderr.includes("already exists") && !siteResult.stdout.includes("already exists")) {
          throw new Error(`Plesk site creation failed: ${siteResult.stderr || siteResult.stdout}`);
        }
        
        progress.push({ step: "site_created", ok: true, info: { domain: cleanDomain } });
        await persistProgress(key, correlationId, progress);

        // Step 2: Configure Git SSH Repository
        progress.push({ step: "configuring_git", ok: true });
        await persistProgress(key, correlationId, progress);
        
        const gitResult = await plesk.callCli("extension", [
          "--call", "git",
          "--create",
          "-domain", cleanDomain,
          "-name", "BasaltSurge",
          "-remote-url", "git@github.com:BasaltHQ/BasaltSurge.git",
          "-active-branch", "production",
          "-run-actions", "true",
          "-actions", "export PATH=/opt/plesk/node/24/bin:$PATH && npm install && npm run build && mkdir -p tmp && touch tmp/restart.txt"
        ]);
        
        if (gitResult.code !== 0 && !gitResult.stderr.includes("already exists") && !gitResult.stdout.includes("already exists")) {
          throw new Error(`Plesk Git configuration failed: ${gitResult.stderr || gitResult.stdout}`);
        }
        
        progress.push({ step: "git_configured", ok: true });
        await persistProgress(key, correlationId, progress);

        // Step 3: Write Build-Time environment variables (.env.production)
        progress.push({ step: "writing_env", ok: true });
        await persistProgress(key, correlationId, progress);
        
        const targetDir = `/var/www/vhosts/basalthq.com/${cleanDomain}`;
        await fs.mkdir(targetDir, { recursive: true });
        await fs.writeFile(`${targetDir}/.env.production`, envContent, "utf8");
        
        progress.push({ step: "env_written", ok: true });
        await persistProgress(key, correlationId, progress);

        // Step 4: Inject Runtime Passenger Variables
        progress.push({ step: "injecting_runtime_env", ok: true });
        await persistProgress(key, correlationId, progress);
        
        for (const [k, v] of Object.entries(env)) {
          try {
            await plesk.callCli("extension", [
              "--call", "nodejs",
              "--nodetool",
              "-s",
              "-domain", cleanDomain,
              "-env-val", `${k}=${v}`
            ]);
          } catch (envErr: any) {
            console.warn(`[Plesk] Warning: Failed to inject runtime variable ${k}:`, envErr.message);
          }
        }
        
        progress.push({ step: "runtime_env_injected", ok: true });
        await persistProgress(key, correlationId, progress);

        // Step 5: Secure domain with Let's Encrypt
        progress.push({ step: "requesting_ssl", ok: true });
        await persistProgress(key, correlationId, progress);
        
        try {
          await plesk.callCli("extension", [
            "--exec", "letsencrypt", "cli.php",
            "-d", cleanDomain
          ]);
          progress.push({ step: "ssl_completed", ok: true });
        } catch (sslErr: any) {
          console.warn("[Plesk SSL] Best-effort SSL setup failed:", sslErr.message);
          progress.push({ step: "ssl_completed", ok: false, info: { warning: sslErr.message } });
        }
        await persistProgress(key, correlationId, progress);

        // Step 6: Restart Node.js application
        progress.push({ step: "restarting_app", ok: true });
        await persistProgress(key, correlationId, progress);
        
        await plesk.callCli("extension", [
          "--call", "nodejs",
          "--nodetool",
          "-restart",
          "-domain", cleanDomain
        ]);
        
        progress.push({ step: "app_restarted", ok: true });
        await persistProgress(key, correlationId, progress);

        return json(
          {
            ok: true,
            correlationId,
            plan,
            deployment: {
              target: "plesk",
              domain: cleanDomain,
              url: `https://${cleanDomain}`,
              sshPublicKey,
              state: "active"
            },
            progress
          },
          { headers: { "x-correlation-id": correlationId } }
        );

      } catch (err: any) {
        return json(
          {
            ok: false,
            correlationId,
            error: "deployment_failed",
            message: err.message || "Failed to deploy Plesk site",
            progress
          },
          { status: 500, headers: { "x-correlation-id": correlationId } }
        );
      }
    }

    // Only support App Service deployment via Azure SDK (target=appservice)
    if (target !== "appservice") {
      return json(
        {
          error: "unsupported_target",
          correlationId,
          message: `Direct deployment is only supported for target=appservice. For ${target}, use the generated plan and run the commands manually.`,
          plan
        },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const subscription = String(body?.azure?.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || "").trim();
    const deployRg = String(resourceGroup || body?.azure?.resourceGroup || process.env.AZURE_RESOURCE_GROUP || "").trim();
    const appServicePlanRg = String(process.env.AZURE_APP_SERVICE_RESOURCE_GROUP || deployRg).trim();

    const missing: string[] = [];
    if (!subscription) missing.push("AZURE_SUBSCRIPTION_ID (or body.azure.subscriptionId)");
    if (!deployRg) missing.push("AZURE_RESOURCE_GROUP (or body.resourceGroup or body.azure.resourceGroup)");
    if (!appServicePlanRg) missing.push("AZURE_APP_SERVICE_RESOURCE_GROUP (resource group containing App Service Plan)");
    if (!process.env.AZURE_TENANT_ID) missing.push("AZURE_TENANT_ID");
    if (!process.env.AZURE_CLIENT_ID) missing.push("AZURE_CLIENT_ID");
    if (!process.env.AZURE_CLIENT_SECRET) missing.push("AZURE_CLIENT_SECRET");

    if (missing.length) {
      return json(
        {
          error: "missing_env",
          correlationId,
          required: [
            "AZURE_SUBSCRIPTION_ID",
            "AZURE_RESOURCE_GROUP",
            "AZURE_APP_SERVICE_RESOURCE_GROUP",
            "AZURE_TENANT_ID",
            "AZURE_CLIENT_ID",
            "AZURE_CLIENT_SECRET"
          ],
          missing,
          hint: "Set these environment variables or pass via body.azure to enable programmatic deployment."
        },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const progress: Array<{ step: string; ok: boolean; info?: any }> = [];
    try {
      const credential = new DefaultAzureCredential();
      progress.push({ step: "auth", ok: true });
      await persistProgress(key, correlationId, progress);
      const client = new WebSiteManagementClient(credential, subscription);

      // List all App Service Plans in the specified resource group to find one to use
      const plans = await client.appServicePlans.listByResourceGroup(appServicePlanRg);
      const plansList = [];
      for await (const plan of plans) {
        // Check for Linux plans - kind can be "linux", "app,linux", etc.
        const isLinux = plan.kind?.toLowerCase().includes("linux") || plan.reserved === true;
        if (isLinux) {
          plansList.push(plan);
        }
      }

      if (plansList.length === 0) {
        // Get all plans for debugging
        const allPlans = await client.appServicePlans.listByResourceGroup(appServicePlanRg);
        const allPlansList = [];
        for await (const p of allPlans) {
          allPlansList.push({ name: p.name, kind: p.kind, reserved: p.reserved });
        }
        return json(
          {
            error: "no_linux_plan_found",
            correlationId,
            message: `No Linux App Service Plans found in resource group '${appServicePlanRg}'.`,
            hint: `Run: az appservice plan create --name ASP-PortalPay-Partners --resource-group ${appServicePlanRg} --location westus2 --is-linux --sku B1`,
            debug: {
              resourceGroup: appServicePlanRg,
              allPlansFound: allPlansList
            }
          },
          { status: 400, headers: { "x-correlation-id": correlationId } }
        );
      }

      // Use the first available Linux plan
      const selectedPlan = plansList[0];
      progress.push({ step: "plan_selected", ok: true, info: { name: selectedPlan.name, location: selectedPlan.location } });
      await persistProgress(key, correlationId, progress);

      // Parse registry from image
      const imageParts = image.split("/");
      const registry = imageParts.length > 1 ? imageParts[0] : "docker.io";
      const imageNameTag = imageParts.slice(1).join("/") || image;

      // Step 1: Create or update web app with basic configuration
      progress.push({ step: "creating_site", ok: true, info: { name, resourceGroup: deployRg } });
      await persistProgress(key, correlationId, progress);
      const site = await client.webApps.beginCreateOrUpdateAndWait(deployRg, name, {
        location: location || selectedPlan.location || "westus2",
        kind: "app,linux,container",
        serverFarmId: selectedPlan.id,
        httpsOnly: true,
        siteConfig: {
          alwaysOn: true,
          http20Enabled: true,
          appCommandLine: "",
        }
      });
      progress.push({ step: "site_created", ok: true, info: { name: site.name, host: site.defaultHostName } });
      await persistProgress(key, correlationId, progress);

      // Ensure NEXT_PUBLIC_APP_URL defaults to the origin hostname to align auth cookie scope during initial deploy
      try {
        const defaultUrl = site?.defaultHostName ? `https://${site.defaultHostName}` : "";
        if (defaultUrl) {
          env.NEXT_PUBLIC_APP_URL = defaultUrl;
          progress.push({ step: "app_settings_default_url_set", ok: true, info: { NEXT_PUBLIC_APP_URL: defaultUrl } });
          await persistProgress(key, correlationId, progress);
        }
      } catch { }

      // Attempt to configure System Assigned Managed Identity for ACR pulls when credentials are not provided
      // This avoids repeated startup failures and temporary site blocking due to ImagePullFailure.
      const imageParts2 = image.split("/");
      const registry2 = imageParts2.length > 1 ? imageParts2[0] : "docker.io";
      let acrMiConfigured = false;
      if (registry2.includes("azurecr.io")) {
        // Allow passing ACR credentials via request body env overrides as well as process env
        const acrUserCheck = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_USERNAME ||
          (extras as any)?.ACR_USERNAME ||
          process.env.DOCKER_REGISTRY_SERVER_USERNAME ||
          process.env.ACR_USERNAME ||
          ""
        ).trim();
        const acrPassCheck = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_PASSWORD ||
          (extras as any)?.ACR_PASSWORD ||
          process.env.DOCKER_REGISTRY_SERVER_PASSWORD ||
          process.env.ACR_PASSWORD ||
          ""
        ).trim();
        if (!acrUserCheck || !acrPassCheck) {
          try {
            // Enable system-assigned identity on the web app
            await client.webApps.update(deployRg, name, { identity: { type: "SystemAssigned" } as any });
            const refreshed = await client.webApps.get(deployRg, name);
            const principalId = refreshed?.identity?.principalId;

            // Optionally assign AcrPull role if registry resource ID is provided
            const acrResId = String(process.env.ACR_REGISTRY_RESOURCE_ID || "").trim();
            if (principalId && acrResId) {
              // Assigning AcrPull via code requires @azure/arm-authorization; skipping here.
              // Ensure ACR has AcrPull for this web app's system-assigned identity (principalId) out-of-band.
              acrMiConfigured = false;
            }
          } catch {
            // ignore MI configuration errors; fall back to explicit credentials if present
          }
        }
      }

      // Step 2: Set app settings (environment variables) including registry if ACR
      const appSettings: Record<string, string> = { ...env };

      // Ensure container has ephemeral storage flag for Next.js container runtime
      appSettings.WEBSITES_ENABLE_APP_SERVICE_STORAGE = "false";

      if (registry.includes("azurecr.io")) {
        // Prefer credentials provided in request env, then fall back to process env
        const acrUser = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_USERNAME ||
          (extras as any)?.ACR_USERNAME ||
          process.env.DOCKER_REGISTRY_SERVER_USERNAME ||
          process.env.ACR_USERNAME ||
          ""
        ).trim();
        const acrPass = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_PASSWORD ||
          (extras as any)?.ACR_PASSWORD ||
          process.env.DOCKER_REGISTRY_SERVER_PASSWORD ||
          process.env.ACR_PASSWORD ||
          ""
        ).trim();
        appSettings.DOCKER_REGISTRY_SERVER_URL = `https://${registry}`;
        appSettings.DOCKER_ENABLE_CI = "true";
        appSettings.DOCKER_REGISTRY_SERVER_USERNAME = acrUser;
        appSettings.DOCKER_REGISTRY_SERVER_PASSWORD = acrPass;
        progress.push({ step: "acr_credentials_set", ok: !!acrUser && !!acrPass, info: { hasUser: !!acrUser, hasPassword: !!acrPass } });
        await persistProgress(key, correlationId, progress);
      }

      // Merge with existing settings to avoid wiping previously set keys
      let mergedProps: Record<string, string> = { ...appSettings };
      try {
        progress.push({ step: "app_settings_updating", ok: true });
        await persistProgress(key, correlationId, progress);
        const current = await client.webApps.listApplicationSettings(deployRg, name);
        const curProps = (current as any)?.properties || {};
        mergedProps = { ...curProps, ...appSettings };
      } catch { }
      await client.webApps.updateApplicationSettings(deployRg, name, {
        properties: mergedProps
      });
      progress.push({ step: "app_settings_updated", ok: true, info: { count: Object.keys(mergedProps).length } });
      await persistProgress(key, correlationId, progress);
      // Apply container image after credentials are in place to avoid ImagePullFailure
      progress.push({ step: "container_configuring", ok: true, info: { image } });
      await persistProgress(key, correlationId, progress);
      await client.webApps.updateConfiguration(deployRg, name, {
        linuxFxVersion: `DOCKER|${image}`,
      } as any);
      progress.push({ step: "container_configured", ok: true, info: { linuxFxVersion: `DOCKER|${image}` } });
      await persistProgress(key, correlationId, progress);

      // If using Azure Container Registry and neither explicit credentials nor managed identity AcrPull are configured,
      // abort early to avoid ImagePullFailure and temporary site blocking. Return actionable guidance.
      if (registry.includes("azurecr.io")) {
        // Prefer credentials provided in request env, then fall back to process env
        const acrUser = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_USERNAME ||
          (extras as any)?.ACR_USERNAME ||
          process.env.DOCKER_REGISTRY_SERVER_USERNAME ||
          process.env.ACR_USERNAME ||
          ""
        ).trim();
        const acrPass = String(
          (extras as any)?.DOCKER_REGISTRY_SERVER_PASSWORD ||
          (extras as any)?.ACR_PASSWORD ||
          process.env.DOCKER_REGISTRY_SERVER_PASSWORD ||
          process.env.ACR_PASSWORD ||
          ""
        ).trim();
        if ((!acrUser || !acrPass) && !acrMiConfigured) {
          progress.push({ step: "acr_credentials_missing", ok: false, info: { registry, hint: "Provide ACR username/password app settings or grant AcrPull to the web app's managed identity." } });
          await persistProgress(key, correlationId, progress);
          return json(
            {
              error: "acr_credentials_missing",
              correlationId,
              message: "Azure Container Registry credentials are not configured and AcrPull is not granted to the web app's managed identity.",
              hint: "Set DOCKER_REGISTRY_SERVER_USERNAME/DOCKER_REGISTRY_SERVER_PASSWORD app settings (or ACR_USERNAME/ACR_PASSWORD), or grant AcrPull role to the web app's system-assigned managed identity for the target registry.",
              registry,
              plan,
              progress
            },
            { status: 400, headers: { "x-correlation-id": correlationId } }
          );
        }
      }

      // Step 3: Restart the web app to pick up container and env changes
      progress.push({ step: "site_restart_initiated", ok: true });
      await persistProgress(key, correlationId, progress);
      await client.webApps.restart(deployRg, name);
      progress.push({ step: "site_restarted", ok: true });
      await persistProgress(key, correlationId, progress);

      // Give it a moment for the restart to initiate
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get final site info
      const updatedSite = await client.webApps.get(deployRg, name);

      // Probe app for readiness (best-effort)
      let health = { reachable: false, status: 0 };
      try {
        const baseUrl = updatedSite.defaultHostName ? `https://${updatedSite.defaultHostName}` : "";
        if (baseUrl) {
          progress.push({ step: "health_probe_started", ok: true, info: { url: baseUrl } });
          await persistProgress(key, correlationId, progress);
          for (let i = 0; i < 20; i++) {
            try {
              // Try GET / first (some hosts return 405 to HEAD)
              let resp = await fetch(baseUrl, { method: "GET" as any, cache: "no-store" as any });
              if (!resp.ok) {
                // Try HEAD / as fallback
                resp = await fetch(baseUrl, { method: "HEAD" as any, cache: "no-store" as any });
              }
              if (!resp.ok) {
                // Try explicit health path if present
                const hr = await fetch(`${baseUrl}/api/healthz`, { method: "GET" as any, cache: "no-store" as any });
                resp = hr;
              }
              health = { reachable: resp.ok, status: resp.status };
              if (resp.ok) break;
            } catch { }
            progress.push({ step: "health_probe_retry", ok: false, info: { attempt: i + 1 } });
            await persistProgress(key, correlationId, progress);
            await new Promise((r) => setTimeout(r, 5000));
          }
        }
      } catch { }
      progress.push({ step: "health_probe", ok: health.reachable, info: health });
      await persistProgress(key, correlationId, progress);

      // Phase: Azure Front Door (brand-scoped origin/group/route)
      try {
        const afdProfile = String(process.env.AZURE_AFD_PROFILE_NAME || body?.azure?.afdProfileName || "").trim();
        if (afdProfile) {
          const cdn = new CdnManagementClient(credential, subscription);
          // Prefer explicit AFD RG, otherwise fall back to App Service Plan RG (PortalPay) or deploy RG
          const afdRg = String(process.env.AZURE_AFD_RESOURCE_GROUP || process.env.AZURE_APP_SERVICE_RESOURCE_GROUP || body?.azure?.resourceGroup || deployRg).trim();
          let effectiveAfdRg = afdRg;
          // Pick first endpoint under profile if AZURE_AFD_ENDPOINT_NAME not provided
          let endpointName = String(process.env.AZURE_AFD_ENDPOINT_NAME || "").trim();
          if (!endpointName) {
            const tryRgs = Array.from(new Set([
              afdRg,
              String(process.env.AZURE_APP_SERVICE_RESOURCE_GROUP || "").trim() || undefined,
              "PortalPay",
              "rg-portalpay-prod"
            ].filter(Boolean))) as string[];

            let foundEp: any = null;
            let usedRg: string | null = null;
            for (const rgCandidate of tryRgs) {
              try {
                const eps: any[] = [];
                for await (const ep of cdn.afdEndpoints.listByProfile(rgCandidate, afdProfile)) {
                  eps.push(ep);
                }
                if (eps.length > 0) {
                  foundEp = eps[0];
                  usedRg = rgCandidate;
                  break;
                }
              } catch (err) {
                // try next RG candidate
              }
            }
            if (foundEp && usedRg) {
              endpointName = String(foundEp?.name || "");
              effectiveAfdRg = usedRg;
            }
          }
          if (!endpointName) {
            throw new Error("afd_endpoint_not_found");
          }

          const ogName = `og-${key}`;
          const originName = `origin-${name}`;
          const originHost = `${name}.azurewebsites.net`;

          // Create/Update Origin Group
          await cdn.afdOriginGroups.beginCreateAndWait(effectiveAfdRg, afdProfile, ogName, {
            healthProbeSettings: { probePath: "/", probeRequestType: "GET", probeProtocol: "Https", probeIntervalInSeconds: 240 } as any,
            loadBalancingSettings: { sampleSize: 4, successfulSamplesRequired: 3, additionalLatencyInMilliseconds: 50 } as any,
          } as any);

          // Create/Update Origin
          await cdn.afdOrigins.beginCreateAndWait(effectiveAfdRg, afdProfile, ogName, originName, {
            hostName: originHost,
            httpPort: 80,
            httpsPort: 443,
            originHostHeader: originHost,
            enabledState: "Enabled",
            priority: 1,
            weight: 1000,
          } as any);

          // Create/Update Route (map default endpoint domain; custom domains can be bound later in DNS)
          const routeName = `route-${key}`;
          await cdn.routes.beginCreateAndWait(effectiveAfdRg, afdProfile, endpointName, routeName, {
            originGroup: {
              id: `/subscriptions/${subscription}/resourceGroups/${effectiveAfdRg}/providers/Microsoft.Cdn/profiles/${afdProfile}/originGroups/${ogName}`,
            },
            patternsToMatch: ["/*"],
            supportedProtocols: ["Https"],
            httpsRedirect: "Enabled",
            forwardingProtocol: "HttpsOnly",
            compressionSettings: { isCompressionEnabled: true } as any,
            linkToDefaultDomain: "Enabled",
            enabledState: "Enabled",
          } as any);

          progress.push({
            step: "afd_configured",
            ok: true,
            info: { profile: afdProfile, endpoint: endpointName, originGroup: ogName, origin: originName, route: routeName },
          });
          await persistProgress(key, correlationId, progress);

          // If a preferred public domain was provided, update NEXT_PUBLIC_APP_URL to that domain
          try {
            const candidateUrl = (domains && domains.length > 0 && typeof domains[0] === "string" && domains[0]) ? domains[0] : "";
            if (candidateUrl) {
              const current = await client.webApps.listApplicationSettings(deployRg, name);
              const curProps = (current as any)?.properties || {};
              const merged = { ...curProps, NEXT_PUBLIC_APP_URL: candidateUrl };
              await client.webApps.updateApplicationSettings(deployRg, name, { properties: merged });
              progress.push({ step: "app_settings_updated_afd_url", ok: true, info: { NEXT_PUBLIC_APP_URL: candidateUrl } });
              await persistProgress(key, correlationId, progress);
            }
          } catch { }
        } else {
          progress.push({ step: "afd_skipped_no_profile", ok: false });
          await persistProgress(key, correlationId, progress);
        }
      } catch (e: any) {
        const errMsg = String(e?.message || e || "").toLowerCase();
        // Treat existing route/domain/path/protocol configuration as success (AFD already configured)
        if (errMsg.includes("already exists") || errMsg.includes("conflict")) {
          progress.push({ step: "afd_configured", ok: true, info: { reason: "already_exists", message: e?.message || String(e) } });
          await persistProgress(key, correlationId, progress);
        } else {
          progress.push({ step: "afd_configured", ok: false, info: { error: e?.message || String(e) } });
          await persistProgress(key, correlationId, progress);
        }
        // If AFD management operations are temporarily blocked, defer changes gracefully
        if (errMsg.includes("blocked")) {
          // Update app to use its default hostname as the public URL until AFD is available
          try {
            const fallbackUrl = updatedSite?.defaultHostName ? `https://${updatedSite.defaultHostName}` : undefined;
            if (fallbackUrl) {
              const current = await client.webApps.listApplicationSettings(deployRg, name);
              const curProps = (current as any)?.properties || {};
              const merged = { ...curProps, NEXT_PUBLIC_APP_URL: fallbackUrl };
              await client.webApps.updateApplicationSettings(deployRg, name, { properties: merged });
              progress.push({ step: "app_settings_updated_fallback_url", ok: true, info: { NEXT_PUBLIC_APP_URL: fallbackUrl } });
              await persistProgress(key, correlationId, progress);
            }
          } catch { }
          // Record a defer step so operators know to retry later
          progress.push({
            step: "afd_deferred",
            ok: false,
            info: {
              reason: "Azure Front Door changes are temporarily blocked by Microsoft",
              suggestion: "Use the web app's default hostname until AFD management is restored; then bind custom domain and create route."
            }
          });
          await persistProgress(key, correlationId, progress);
        }
      }

      // Phase: APIM (brand-scoped products, policies, subscription; inject key)
      try {
        const apimName = String(body?.azure?.apimName || process.env.AZURE_APIM_NAME || "").trim();
        if (apimName) {
          const apim = new ApiManagementClient(credential, subscription);
          // Prefer explicit APIM RG, otherwise fall back to generic AZURE_RESOURCE_GROUP or deploy RG
          const apimRg = String(process.env.AZURE_APIM_RESOURCE_GROUP || process.env.AZURE_RESOURCE_GROUP || body?.azure?.resourceGroup || deployRg).trim();

          const suffix = key.toLowerCase();
          const products = [
            { id: `portalpay-starter-${suffix}`, displayName: `${brandNameOverride} Starter`, description: `Starter package for brand '${brandNameOverride}'` },
            { id: `portalpay-pro-${suffix}`, displayName: `${brandNameOverride} Pro`, description: `Pro package for brand '${brandNameOverride}'` },
            { id: `portalpay-enterprise-${suffix}`, displayName: `${brandNameOverride} Enterprise`, description: `Enterprise package for brand '${brandNameOverride}'` },
          ];

          for (const p of products) {
            await apim.product.createOrUpdate(apimRg, apimName, p.id, {
              displayName: p.displayName,
              description: p.description,
              subscriptionRequired: true,
              approvalRequired: false,
              subscriptionsLimit: 1000,
              state: "published",
            } as any);

            // Apply product policy if available
            const map: Record<string, string> = {
              [`portalpay-starter-${suffix}`]: "infra/policies/product-portalpay-starter-policy-body.json",
              [`portalpay-pro-${suffix}`]: "infra/policies/product-portalpay-pro-policy-body.json",
              [`portalpay-enterprise-${suffix}`]: "infra/policies/product-portalpay-enterprise-policy-body.json",
            };
            const policyPath = map[p.id];
            try {
              const policyBody = await fs.readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), policyPath), "utf8");
              await apim.productPolicy.createOrUpdate(apimRg, apimName, p.id, "policy", { format: "rawxml", value: policyBody } as any);
            } catch { }
          }

          // Ensure devtest user exists (owner for initial subscription); production can assign real users
          const userId = "devtest";
          await apim.user.createOrUpdate(apimRg, apimName, userId, {
            firstName: "Dev",
            lastName: "Test",
            email: "devtest@ledger1.ai",
            state: "active",
            note: "DevTest user",
          } as any);

          // Create subscription on starter product for the brand
          const subResName = `${suffix}-starter-devtest`;
          const productScope = `/subscriptions/${subscription}/resourceGroups/${apimRg}/providers/Microsoft.ApiManagement/service/${apimName}/products/portalpay-starter-${suffix}`;
          const ownerId = `/subscriptions/${subscription}/resourceGroups/${apimRg}/providers/Microsoft.ApiManagement/service/${apimName}/users/${userId}`;
          await apim.subscription.createOrUpdate(apimRg, apimName, subResName, {
            displayName: `${brandNameOverride} Starter`,
            scope: productScope,
            ownerId,
            state: "active",
          } as any);

          // Fetch subscription secrets (key) and inject into webapp settings
          const secrets = await apim.subscription.listSecrets(apimRg, apimName, subResName);
          const subKey = (secrets as any)?.primaryKey || "";
          if (subKey) {
            try {
              // Merge with existing app settings instead of overwriting
              const current = await client.webApps.listApplicationSettings(deployRg, name);
              const curProps = (current as any)?.properties || {};
              await client.webApps.updateApplicationSettings(deployRg, name, {
                properties: { ...curProps, PORTALPAY_SUBSCRIPTION_KEY: subKey },
              });
            } catch {
              // Fallback: merge with the appSettings we set earlier in this deploy step
              await client.webApps.updateApplicationSettings(deployRg, name, {
                properties: { ...appSettings, PORTALPAY_SUBSCRIPTION_KEY: subKey },
              });
            }
          }

          progress.push({
            step: "apim_configured",
            ok: true,
            info: { products: products.map((p) => p.id), subscription: subResName, hasKey: !!subKey },
          });
          await persistProgress(key, correlationId, progress);
          // Final reconciliation: ensure core brand/app settings are present and not blank
          try {
            const current2 = await client.webApps.listApplicationSettings(deployRg, name);
            const cur2 = (current2 as any)?.properties || {};
            const required: Record<string, string> = {};
            const setIf = (k: string, v?: string) => {
              const vv = (typeof v === "string" ? v : "").trim();
              if (vv) required[k] = vv;
            };

            // Compute robust fallbacks for PP_BRAND_* keys
            const nameFallback = (env.PP_BRAND_NAME || brandNameOverride || key);
            const logoFallback = (env.PP_BRAND_LOGO || brandLogoOverride || String((extras as any)?.BRAND_LOGO_URL || (extras as any)?.NEXT_PUBLIC_BRAND_LOGO_URL || ""));
            const favFallback = (env.PP_BRAND_FAVICON || brandFaviconOverride || String((extras as any)?.BRAND_FAVICON_URL || (extras as any)?.NEXT_PUBLIC_BRAND_FAVICON_URL || ""));
            const symbolFallback = (env.PP_BRAND_SYMBOL || computedSymbol || logoFallback);

            // Partner container required env fallbacks to avoid brand-not-configured
            const ownerFallback =
              (env.NEXT_PUBLIC_OWNER_WALLET ||
                String((extras as any)?.NEXT_PUBLIC_OWNER_WALLET || "") ||
                (brandPartnerWallet ? String(brandPartnerWallet) : "") ||
                "");
            const platformFallback =
              (env.NEXT_PUBLIC_PLATFORM_WALLET ||
                String((extras as any)?.NEXT_PUBLIC_PLATFORM_WALLET || "") ||
                ownerFallback ||
                "");
            const recipientFallback =
              (env.NEXT_PUBLIC_RECIPIENT_ADDRESS ||
                (brandPartnerWallet ? String(brandPartnerWallet) : "") ||
                ownerFallback ||
                "");

            // Compute ADMIN_WALLETS fallback (merge existing + partner wallet candidate)
            let adminFallback = String(env.ADMIN_WALLETS || process.env.ADMIN_WALLETS || "").trim();
            const partnerCandidate2 = (() => {
              const ex = extras as any;
              const cand = String(ex?.NEXT_PUBLIC_PARTNER_WALLET || ex?.PARTNER_WALLET || brandPartnerWallet || process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "").toLowerCase();
              return /^0x[a-f0-9]{40}$/i.test(cand) ? cand : "";
            })();
            try {
              const list = adminFallback ? adminFallback.split(/[,\s]+/).map(s => String(s || "").toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/i.test(s)) : [];
              if (partnerCandidate2) {
                adminFallback = Array.from(new Set([...list, partnerCandidate2])).join(",");
              } else {
                adminFallback = list.join(",");
              }
            } catch { }

            setIf("BRAND_KEY", key);
            setIf("CONTAINER_TYPE", env.CONTAINER_TYPE);
            setIf("NEXT_PUBLIC_CONTAINER_TYPE", env.NEXT_PUBLIC_CONTAINER_TYPE);
            setIf("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL);
            setIf("ADMIN_WALLETS", adminFallback);
            setIf("PP_BRAND_NAME", nameFallback);
            setIf("PP_BRAND_LOGO", logoFallback);
            setIf("PP_BRAND_FAVICON", favFallback);
            setIf("PP_BRAND_SYMBOL", symbolFallback);
            // Ensure partner-required envs are present
            setIf("NEXT_PUBLIC_OWNER_WALLET", ownerFallback);
            setIf("NEXT_PUBLIC_PLATFORM_WALLET", platformFallback);
            setIf("NEXT_PUBLIC_RECIPIENT_ADDRESS", recipientFallback);

            // Preserve existing non-empty values when present
            const reconciled: Record<string, string> = { ...cur2 };
            for (const [k, v] of Object.entries(required)) {
              if (!cur2[k] || String(cur2[k]).trim() === "") {
                reconciled[k] = v;
              }
            }
            await client.webApps.updateApplicationSettings(deployRg, name, { properties: reconciled });
            progress.push({ step: "app_settings_reconciled", ok: true, info: { ensured: Object.keys(required) } });
            await persistProgress(key, correlationId, progress);
          } catch { }
        } else {
          progress.push({ step: "apim_skipped_no_apim", ok: false });
          await persistProgress(key, correlationId, progress);
        }
      } catch (e: any) {
        progress.push({ step: "apim_configured", ok: false, info: { error: e?.message || String(e) } });
        await persistProgress(key, correlationId, progress);
      }

      // Unconditional final reconciliation: ensure PP_BRAND_* and ADMIN_WALLETS are present post-deploy
      try {
        const current3 = await client.webApps.listApplicationSettings(deployRg, name);
        const cur3 = (current3 as any)?.properties || {};
        const requiredFinal: Record<string, string> = {};
        const setIfFinal = (k: string, v?: string) => {
          const vv = (typeof v === "string" ? v : "").trim();
          if (vv) requiredFinal[k] = vv;
        };

        // Recompute robust fallbacks using env/extras/brand overrides
        const nameFallbackF = (env.PP_BRAND_NAME || brandNameOverride || key);
        const logoFallbackF = (env.PP_BRAND_LOGO || brandLogoOverride || String((extras as any)?.BRAND_LOGO_URL || (extras as any)?.NEXT_PUBLIC_BRAND_LOGO_URL || ""));
        const favFallbackF = (env.PP_BRAND_FAVICON || brandFaviconOverride || String((extras as any)?.BRAND_FAVICON_URL || (extras as any)?.NEXT_PUBLIC_BRAND_FAVICON_URL || ""));
        const symbolFallbackF = (env.PP_BRAND_SYMBOL || computedSymbol || logoFallbackF);

        // Partner container required env fallbacks to avoid brand-not-configured
        const ownerFallbackF =
          (env.NEXT_PUBLIC_OWNER_WALLET ||
            String((extras as any)?.NEXT_PUBLIC_OWNER_WALLET || "") ||
            (brandPartnerWallet ? String(brandPartnerWallet) : "") ||
            "");
        const platformFallbackF =
          (env.NEXT_PUBLIC_PLATFORM_WALLET ||
            String((extras as any)?.NEXT_PUBLIC_PLATFORM_WALLET || "") ||
            ownerFallbackF ||
            "");
        const recipientFallbackF =
          (env.NEXT_PUBLIC_RECIPIENT_ADDRESS ||
            (brandPartnerWallet ? String(brandPartnerWallet) : "") ||
            ownerFallbackF ||
            "");

        // ADMIN_WALLETS fallback: merge existing + partner candidate
        let adminFallbackF = String(env.ADMIN_WALLETS || process.env.ADMIN_WALLETS || "").trim();
        const partnerCandidateF = (() => {
          const ex = extras as any;
          const cand = String(ex?.NEXT_PUBLIC_PARTNER_WALLET || ex?.PARTNER_WALLET || brandPartnerWallet || process.env.NEXT_PUBLIC_PARTNER_WALLET || process.env.PARTNER_WALLET || "").toLowerCase();
          return /^0x[a-f0-9]{40}$/i.test(cand) ? cand : "";
        })();
        try {
          const list = adminFallbackF ? adminFallbackF.split(/[,\s]+/).map(s => String(s || "").toLowerCase()).filter(s => /^0x[a-f0-9]{40}$/i.test(s)) : [];
          if (partnerCandidateF) {
            adminFallbackF = Array.from(new Set([...list, partnerCandidateF])).join(",");
          } else {
            adminFallbackF = list.join(",");
          }
        } catch { }

        setIfFinal("BRAND_KEY", key);
        setIfFinal("CONTAINER_TYPE", env.CONTAINER_TYPE);
        setIfFinal("NEXT_PUBLIC_CONTAINER_TYPE", env.NEXT_PUBLIC_CONTAINER_TYPE);
        setIfFinal("NEXT_PUBLIC_APP_URL", env.NEXT_PUBLIC_APP_URL);
        setIfFinal("ADMIN_WALLETS", adminFallbackF);
        setIfFinal("PP_BRAND_NAME", nameFallbackF);
        setIfFinal("PP_BRAND_LOGO", logoFallbackF);
        setIfFinal("PP_BRAND_FAVICON", favFallbackF);
        setIfFinal("PP_BRAND_SYMBOL", symbolFallbackF);
        // Ensure partner-required envs are present
        setIfFinal("NEXT_PUBLIC_OWNER_WALLET", ownerFallbackF);
        setIfFinal("NEXT_PUBLIC_PLATFORM_WALLET", platformFallbackF);
        setIfFinal("NEXT_PUBLIC_RECIPIENT_ADDRESS", recipientFallbackF);

        const reconciledFinal: Record<string, string> = { ...cur3 };
        let changed = false;
        for (const [k, v] of Object.entries(requiredFinal)) {
          if (!cur3[k] || String(cur3[k]).trim() === "") {
            reconciledFinal[k] = v;
            changed = true;
          }
        }
        if (changed) {
          await client.webApps.updateApplicationSettings(deployRg, name, { properties: reconciledFinal });
          progress.push({ step: "app_settings_reconciled_final", ok: true, info: { ensured: Object.keys(requiredFinal) } });
          await persistProgress(key, correlationId, progress);
        }
      } catch { }

      return json(
        {
          ok: true,
          correlationId,
          plan,
          deployment: {
            resourceGroup: deployRg,
            name: updatedSite.name,
            defaultHostName: updatedSite.defaultHostName,
            state: updatedSite.state,
            resourceId: updatedSite.id,
            appServicePlan: selectedPlan.name,
            appServicePlanResourceGroup: appServicePlanRg,
            url: `https://${updatedSite.defaultHostName}`,
            containerImage: image,
            health
          },
          progress
        },
        { headers: { "x-correlation-id": correlationId } }
      );
    } catch (error: any) {
      return json(
        {
          ok: false,
          correlationId,
          error: "deployment_failed",
          message: error?.message || "Failed to deploy web app",
          details: error?.code || error?.statusCode,
        },
        { status: 500, headers: { "x-correlation-id": correlationId } }
      );
    }
  }

  return json(
    { ok: true, correlationId, plan },
    {
      headers: {
        "x-correlation-id": correlationId,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}
