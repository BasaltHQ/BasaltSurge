import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf, rateLimitOrThrow, rateKey } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import { getContainer } from "@/lib/cosmos";
import { deployShopifyApp, isShopifyCliInstalled, getShopifyCliVersion, type ShopifyAppConfig, type DeployResult } from "@/lib/shopify/cli";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300; // 5 minutes for deployment

function headerJson(obj: any, init?: { status?: number; headers?: Record<string, string> }) {
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

function depDocId(brandKey: string): string { return `shopify_app_deployment:${brandKey}`; }
function pluginDocId(brandKey: string): string { return `shopify_plugin_config:${brandKey}`; }

type DeployProgressStep = { step: string; ok: boolean; info?: any; ts?: number };

type DeployDoc = {
  id: string; // shopify_app_deployment:<brandKey>
  wallet: string; // partition key = brandKey
  type: "shopify_app_deployment";
  brandKey: string;
  progress: DeployProgressStep[];
  logs?: string[];
  devStoreUrl?: string;
  appId?: string;
  clientId?: string;
  appUrl?: string;
  lastError?: string;
  updatedAt?: number;
};

async function appendProgress(brandKey: string, step: DeployProgressStep): Promise<DeployDoc> {
  const c = await getContainer();
  const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
  const base: DeployDoc = resource || { id: depDocId(brandKey), wallet: brandKey, type: "shopify_app_deployment", brandKey, progress: [], updatedAt: Date.now() };
  const next: DeployDoc = { ...base, progress: [...(base.progress || []), { ...step, ts: Date.now() }], updatedAt: Date.now() };
  await c.items.upsert(next as any);
  return next;
}

async function updateDeployDoc(brandKey: string, updates: Partial<DeployDoc>): Promise<DeployDoc> {
  const c = await getContainer();
  const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
  const base: DeployDoc = resource || { id: depDocId(brandKey), wallet: brandKey, type: "shopify_app_deployment", brandKey, progress: [], updatedAt: Date.now() };
  const next: DeployDoc = { ...base, ...updates, updatedAt: Date.now() };
  await c.items.upsert(next as any);
  return next;
}

async function appendDeployLogs(brandKey: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  try {
    const c = await getContainer();
    const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
    if (resource) {
      const logs = Array.isArray(resource.logs) ? resource.logs : [];
      logs.push(...lines);
      if (logs.length > 200) logs.splice(0, logs.length - 200);
      const next: DeployDoc = { ...resource, logs, updatedAt: Date.now() };
      await c.items.upsert(next as any);
    }
  } catch {}
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  // RBAC: Admin or Superadmin only
  let caller: { wallet: string; roles: string[] };
  try {
    const c = await requireThirdwebAuth(req);
    const roles = Array.isArray(c?.roles) ? c.roles : [];
    if (!roles.includes("admin") && !roles.includes("superadmin")) {
      return headerJson({ error: "forbidden", correlationId }, { status: 403 });
    }
    caller = { wallet: c.wallet, roles };
  } catch {
    return headerJson({ error: "unauthorized", correlationId }, { status: 401 });
  }

  // CSRF + rate limit
  try {
    requireCsrf(req);
    const url = new URL(req.url);
    const brandKey = String(url.searchParams.get("brandKey") || "").toLowerCase().trim();
    rateLimitOrThrow(req, rateKey(req, "shopify_deploy", brandKey || "global"), 5, 300_000); // 5 per 5 minutes
  } catch (e: any) {
    const resetAt = typeof e?.resetAt === "number" ? e.resetAt : undefined;
    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_deploy", target: "rate_limit", correlationId, ok: false, metadata: { error: e?.message || "rate_limited", resetAt } }); } catch {}
    return headerJson({ error: e?.message || "rate_limited", resetAt, correlationId }, { status: e?.status || 429 });
  }

  // Parse brandKey and optional inputs
  let body: { brandKey?: string; devStoreUrl?: string; applicationUrl?: string } = {};
  try { body = await req.json().catch(() => ({})); } catch {}
  const brandKey = String(body?.brandKey || new URL(req.url).searchParams.get("brandKey") || "").toLowerCase().trim();
  if (!brandKey) {
    return headerJson({ error: "brandKey_required", correlationId }, { status: 400 });
  }

  // Begin audit
  try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_deploy", target: brandKey, correlationId, ok: true }); } catch {}

  // Step 1: Check Shopify CLI availability
  const cliInstalled = await isShopifyCliInstalled();
  if (!cliInstalled) {
    const doc = await appendProgress(brandKey, { 
      step: "cli_check", 
      ok: false, 
      info: { 
        error: "Shopify CLI not installed",
        hint: "Install with: npm install -g @shopify/cli @shopify/theme",
        fallback: "Use the Package endpoint to download a ZIP for manual deployment"
      } 
    });
    return headerJson({ 
      error: "shopify_cli_not_installed", 
      hint: "Install Shopify CLI or use the Package endpoint for manual deployment",
      correlationId, 
      deployment: doc 
    }, { status: 503 });
  }

  const cliVersion = await getShopifyCliVersion();
  await appendProgress(brandKey, { step: "cli_check", ok: true, info: { version: cliVersion } });

  // Step 2: Load plugin config
  let plugin: any = null;
  try {
    const c = await getContainer();
    const { resource } = await c.item(pluginDocId(brandKey), brandKey).read<any>();
    plugin = resource || null;
  } catch {}
  
  if (!plugin) {
    const doc = await appendProgress(brandKey, { step: "config_load", ok: false, info: { hint: "Configure plugin in Plugin Studio before deploy" } });
    return headerJson({ error: "plugin_config_not_found", correlationId, deployment: doc }, { status: 404 });
  }

  await appendProgress(brandKey, { step: "config_load", ok: true, info: { pluginName: plugin?.pluginName || brandKey } });

  const partnersToken = plugin?.cliPartnersToken || "";
  const orgId = plugin?.partnerOrgId || "";

  if (!partnersToken) {
    await appendProgress(brandKey, { 
      step: "env_check", 
      ok: true, 
      info: { 
        warning: "No CLI Token configured. Deploying using active local developer account login session."
      } 
    });
  } else {
    await appendProgress(brandKey, { 
      step: "env_check", 
      ok: true, 
      info: { 
        tokenPresent: true
      } 
    });
  }

  if (!orgId) {
    await appendProgress(brandKey, { 
      step: "env_check", 
      ok: true, 
      info: { 
        warning: "No Organization ID configured. Omitted from command context (App Automation Token does not require it)."
      } 
    });
  } else {
    await appendProgress(brandKey, { step: "env_check", ok: true, info: { orgId } });
  }

  // Step 4: Validate required configuration
  const redirectUrls = Array.isArray(plugin?.oauth?.redirectUrls) ? plugin.oauth.redirectUrls.filter(Boolean) : [];
  const restrictedPaymentScopes = [
    "read_payment_gateways",
    "write_payment_gateways",
    "read_payment_sessions",
    "write_payment_sessions"
  ];
  const scopes = (Array.isArray(plugin?.oauth?.scopes) ? plugin.oauth.scopes.filter(Boolean) : [])
    .filter((s: string) => !restrictedPaymentScopes.includes(s));

  if (redirectUrls.length === 0) {
    const doc = await appendProgress(brandKey, { step: "config_validate", ok: false, info: { missing: "OAuth redirect URLs" } });
    return headerJson({ error: "missing_redirect_urls", hint: "Configure OAuth redirect URLs in Plugin Studio", correlationId, deployment: doc }, { status: 400 });
  }

  if (scopes.length === 0) {
    const doc = await appendProgress(brandKey, { step: "config_validate", ok: false, info: { missing: "Access scopes" } });
    return headerJson({ error: "missing_scopes", hint: "Configure access scopes in Plugin Studio", correlationId, deployment: doc }, { status: 400 });
  }

  await appendProgress(brandKey, { 
    step: "config_validate", 
    ok: true, 
    info: { 
      redirectUrls: redirectUrls.length, 
      scopes: scopes.length,
      extensionEnabled: !!plugin?.extension?.enabled 
    } 
  });

  // Step 5: Build Shopify app config
  let baseUrl = new URL(req.url).origin;
  if (process.env.PLESK_MAIN_DOMAIN) {
    baseUrl = `https://${process.env.PLESK_MAIN_DOMAIN}`;
  } else if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes("localhost")) {
    baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  }
  const applicationUrl = body?.applicationUrl || plugin?.urls?.appUrl || `${baseUrl}/shopify/settings?brandKey=${brandKey}`;

  const appConfig: ShopifyAppConfig = {
    name: String(plugin?.pluginName || brandKey).trim(),
    brandKey,
    clientId: plugin?.shopifyAppId || undefined, // If existing app, link to it
    applicationUrl,
    embedded: true,
    redirectUrls: [
      ...redirectUrls,
      `http://localhost:3001/api/integrations/shopify/brands/${brandKey}/auth/callback`,
      `http://localhost:3000/api/integrations/shopify/brands/${brandKey}/auth/callback`
    ],
    scopes,
    supportUrl: plugin?.urls?.supportUrl || undefined,
    privacyUrl: plugin?.urls?.privacyUrl || undefined,
    termsUrl: plugin?.urls?.termsUrl || undefined,
    partnersToken,
    orgId,
    extension: plugin?.extension?.enabled ? {
      enabled: true,
      buttonLabel: String(plugin?.extension?.buttonLabel || "Pay with Crypto"),
      minTotal: Number(plugin?.extension?.eligibility?.minTotal || 0),
      currency: String(plugin?.extension?.eligibility?.currency || "USD"),
      palette: {
        primary: String(plugin?.extension?.palette?.primary || "#0ea5e9"),
        accent: String(plugin?.extension?.palette?.accent || "#22c55e"),
      }
    } : undefined,
  };

  await appendProgress(brandKey, { 
    step: "config_build", 
    ok: true, 
    info: { 
      appName: appConfig.name, 
      applicationUrl: appConfig.applicationUrl,
      embedded: appConfig.embedded 
    } 
  });

  // Step 6: Deploy using Shopify CLI
  await appendProgress(brandKey, { step: "deploy_start", ok: true, info: { method: "shopify_cli" } });

  let deployResult: DeployResult;
  let logBuffer: string[] = [];
  let flushTimer: NodeJS.Timeout | null = null;

  const flushLogs = async () => {
    if (logBuffer.length === 0) return;
    const lines = [...logBuffer];
    logBuffer = [];
    await appendDeployLogs(brandKey, lines);
  };

  const onLog = (line: string) => {
    logBuffer.push(line);
    if (!flushTimer) {
      flushTimer = setTimeout(async () => {
        flushTimer = null;
        await flushLogs();
      }, 500);
    }
  };

  try {
    // Clear any previous logs before starting
    try {
      const c = await getContainer();
      const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
      if (resource) {
        resource.logs = [];
        await c.items.upsert(resource as any);
      }
    } catch {}

    deployResult = await deployShopifyApp(appConfig, onLog);
    
    if (flushTimer) clearTimeout(flushTimer);
    await flushLogs();
  } catch (e: any) {
    if (flushTimer) clearTimeout(flushTimer);
    await flushLogs();
    const doc = await appendProgress(brandKey, { 
      step: "deploy_execute", 
      ok: false, 
      info: { error: e?.message || "Deployment execution failed" } 
    });
    await updateDeployDoc(brandKey, { lastError: e?.message || "Deployment execution failed" });
    return headerJson({ error: e?.message || "deploy_failed", correlationId, deployment: doc }, { status: 500 });
  }

  // Record deployment result
  await appendProgress(brandKey, { 
    step: "deploy_execute", 
    ok: deployResult.success, 
    info: { 
      logs: deployResult.logs.slice(-10), // Last 10 log entries
      appId: deployResult.appId,
      clientId: deployResult.clientId,
      appUrl: deployResult.appUrl,
      error: deployResult.error
    } 
  });

  if (!deployResult.success) {
    const doc = await updateDeployDoc(brandKey, { lastError: deployResult.error || "Deployment failed" });
    return headerJson({ 
      error: deployResult.error || "deploy_failed", 
      logs: deployResult.logs,
      correlationId, 
      deployment: doc 
    }, { status: 500 });
  }

  // Step 7: Update plugin config with app details
  if (deployResult.appId || deployResult.clientId || deployResult.appUrl) {
    try {
      const c = await getContainer();
      const { resource } = await c.item(pluginDocId(brandKey), brandKey).read<any>();
      if (resource) {
        const updatedPlugin = {
          ...resource,
          ...(deployResult.appId ? { shopifyAppId: deployResult.appId } : {}),
          ...(deployResult.clientId ? { shopifyClientId: deployResult.clientId } : {}),
          ...(deployResult.appUrl ? { shopifyAppUrl: deployResult.appUrl } : {}),
          status: "deployed",
          deployedAt: Date.now(),
          updatedAt: Date.now(),
        };
        await c.items.upsert(updatedPlugin);
        await appendProgress(brandKey, { 
          step: "config_update", 
          ok: true, 
          info: { 
            shopifyAppId: deployResult.appId,
            shopifyClientId: deployResult.clientId,
            status: "deployed"
          } 
        });
      }
    } catch (e: any) {
      // Non-fatal: log but continue
      await appendProgress(brandKey, { step: "config_update", ok: false, info: { error: e?.message } });
    }
  }

  // Step 8: Mark deployment complete
  const finalDoc = await appendProgress(brandKey, { 
    step: "deploy_complete", 
    ok: true, 
    info: { 
      appId: deployResult.appId,
      clientId: deployResult.clientId,
      appUrl: deployResult.appUrl
    } 
  });

  // Update the deployment document with app details
  await updateDeployDoc(brandKey, {
    appId: deployResult.appId,
    clientId: deployResult.clientId,
    appUrl: deployResult.appUrl,
    lastError: undefined,
  });

  return headerJson({ 
    ok: true, 
    brandKey, 
    correlationId, 
    deployment: finalDoc,
    app: {
      appId: deployResult.appId,
      clientId: deployResult.clientId,
      appUrl: deployResult.appUrl,
    },
    logs: deployResult.logs.slice(-20),
  });
}

// GET endpoint to check deployment prerequisites
export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  // No auth required for status check
  const url = new URL(req.url);
  const brandKey = String(url.searchParams.get("brandKey") || "").toLowerCase().trim();

  const checks: { name: string; ok: boolean; info?: any }[] = [];

  // Check CLI
  const cliInstalled = await isShopifyCliInstalled();
  const cliVersion = cliInstalled ? await getShopifyCliVersion() : null;
  checks.push({ 
    name: "shopify_cli", 
    ok: cliInstalled, 
    info: cliInstalled ? { version: cliVersion } : { hint: "Install with: npm install -g @shopify/cli" } 
  });

  // Check environment
  const hasPartnersToken = !!process.env.SHOPIFY_CLI_PARTNERS_TOKEN;
  const hasOrgId = !!process.env.SHOPIFY_ORG_ID;
  checks.push({ 
    name: "partners_token", 
    ok: hasPartnersToken, 
    info: hasPartnersToken ? {} : { hint: "Set SHOPIFY_CLI_PARTNERS_TOKEN" } 
  });
  checks.push({ 
    name: "org_id", 
    ok: hasOrgId, 
    info: hasOrgId ? {} : { hint: "Set SHOPIFY_ORG_ID" } 
  });

  // Check plugin config if brandKey provided
  if (brandKey) {
    try {
      const c = await getContainer();
      const { resource: plugin } = await c.item(pluginDocId(brandKey), brandKey).read<any>();
      checks.push({ 
        name: "plugin_config", 
        ok: !!plugin, 
        info: plugin ? { 
          pluginName: plugin.pluginName,
          hasRedirectUrls: (plugin?.oauth?.redirectUrls?.length || 0) > 0,
          hasScopes: (plugin?.oauth?.scopes?.length || 0) > 0,
          extensionEnabled: !!plugin?.extension?.enabled
        } : { hint: "Configure plugin in Plugin Studio" } 
      });
    } catch {
      checks.push({ name: "plugin_config", ok: false, info: { hint: "Error loading plugin config" } });
    }
  }

  const allOk = checks.every(c => c.ok);

  return headerJson({
    ok: allOk,
    correlationId,
    brandKey: brandKey || null,
    checks,
    ready: allOk,
  });
}
