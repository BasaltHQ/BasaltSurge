import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getContainer } from "@/lib/cosmos";
import { isShopifyCliInstalled, getShopifyCliVersion, getAppInfo } from "@/lib/shopify/cli";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
  id: string;
  wallet: string;
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

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();

  const url = new URL(req.url);
  const brandKey = String(url.searchParams.get("brandKey") || "").toLowerCase().trim();
  
  if (!brandKey) {
    return headerJson({ error: "brandKey_required", correlationId }, { status: 400 });
  }

  // Get deployment document
  let deployment: DeployDoc | null = null;
  try {
    const c = await getContainer();
    const { resource } = await c.item(depDocId(brandKey), brandKey).read<DeployDoc>();
    deployment = resource || null;
  } catch {
    // Document may not exist
  }

  // Get plugin config
  let plugin: any = null;
  try {
    const c = await getContainer();
    const { resource } = await c.item(pluginDocId(brandKey), brandKey).read<any>();
    plugin = resource || null;
  } catch {
    // Document may not exist
  }

  // Check environment readiness
  const cliInstalled = await isShopifyCliInstalled();
  const cliVersion = cliInstalled ? await getShopifyCliVersion() : null;
  const hasPartnersToken = !!process.env.SHOPIFY_CLI_PARTNERS_TOKEN;
  const hasOrgId = !!process.env.SHOPIFY_ORG_ID;

  const skipInfo = url.searchParams.get("skipInfo") === "true";

  // Compute deployment status
  let status: "not_configured" | "draft" | "ready_to_deploy" | "deploying" | "deployed" | "failed" = "not_configured";
  
  if (!plugin) {
    status = "not_configured";
  } else if (plugin?.status === "deployed" || deployment?.appId) {
    status = "deployed";
  } else if (deployment?.lastError) {
    status = "failed";
  } else if (deployment?.progress?.some((p: DeployProgressStep) => p.step === "deploy_start" && !deployment?.progress?.some((p2: DeployProgressStep) => p2.step === "deploy_complete"))) {
    status = "deploying";
  } else if (plugin && hasPartnersToken && hasOrgId && cliInstalled) {
    const hasRedirects = (plugin?.oauth?.redirectUrls?.length || 0) > 0;
    const hasScopes = (plugin?.oauth?.scopes?.length || 0) > 0;
    status = hasRedirects && hasScopes ? "ready_to_deploy" : "draft";
  } else {
    status = "draft";
  }

  // Try to get app info from Shopify if we have a client ID (skip if deploying or requested)
  let shopifyAppInfo: any = null;
  if (!skipInfo && status !== "deploying") {
    const clientId = deployment?.clientId || plugin?.shopifyClientId;
    if (clientId) {
      try {
        shopifyAppInfo = await getAppInfo(clientId);
      } catch {
        // App info fetch failed
      }
    }
  }

  // Compute checklist items
  const checklist = [
    {
      id: "cli_installed",
      label: "Shopify CLI installed",
      completed: cliInstalled,
      info: cliVersion ? `Version: ${cliVersion}` : "Install with: npm install -g @shopify/cli",
    },
    {
      id: "partners_token",
      label: "Partner API token configured",
      completed: hasPartnersToken,
      info: hasPartnersToken ? "Token configured" : "Set SHOPIFY_CLI_PARTNERS_TOKEN",
    },
    {
      id: "org_id",
      label: "Organization ID configured",
      completed: hasOrgId,
      info: hasOrgId ? "Organization ID set" : "Set SHOPIFY_ORG_ID",
    },
    {
      id: "plugin_name",
      label: "App name configured",
      completed: !!(plugin?.pluginName || "").trim(),
      info: plugin?.pluginName || "Configure in Plugin Studio",
    },
    {
      id: "redirect_urls",
      label: "OAuth redirect URLs configured",
      completed: (plugin?.oauth?.redirectUrls?.length || 0) > 0,
      info: `${plugin?.oauth?.redirectUrls?.length || 0} URLs configured`,
    },
    {
      id: "scopes",
      label: "Access scopes configured",
      completed: (plugin?.oauth?.scopes?.length || 0) > 0,
      info: `${plugin?.oauth?.scopes?.length || 0} scopes configured`,
    },
  ];

  // Recent deployment progress (last 10 steps)
  const recentProgress = (deployment?.progress || []).slice(-10).map((p: DeployProgressStep) => ({
    step: p.step,
    ok: p.ok,
    info: p.info,
    timestamp: p.ts ? new Date(p.ts).toISOString() : null,
  }));

  // Links
  const links: { label: string; url: string }[] = [];
  
  if (deployment?.appUrl) {
    links.push({ label: "Shopify Partners Dashboard", url: deployment.appUrl });
  }
  
  if (plugin?.listingUrl) {
    links.push({ label: "App Store Listing", url: plugin.listingUrl });
  }
  
  const orgId = process.env.SHOPIFY_ORG_ID;
  if (orgId) {
    links.push({ 
      label: "Shopify Partners Dashboard", 
      url: `https://partners.shopify.com/${orgId}/apps` 
    });
  }

  return headerJson({
    ok: true,
    correlationId,
    brandKey,
    status,
    deployment: deployment ? {
      appId: deployment.appId,
      clientId: deployment.clientId,
      appUrl: deployment.appUrl,
      lastError: deployment.lastError,
      logs: deployment.logs || [],
      updatedAt: deployment.updatedAt ? new Date(deployment.updatedAt).toISOString() : null,
    } : null,
    plugin: plugin ? {
      pluginName: plugin.pluginName,
      status: plugin.status,
      shopifyAppId: plugin.shopifyAppId,
      shopifyClientId: plugin.shopifyClientId,
      listingUrl: plugin.listingUrl,
      deployedAt: plugin.deployedAt ? new Date(plugin.deployedAt).toISOString() : null,
      updatedAt: plugin.updatedAt ? new Date(plugin.updatedAt).toISOString() : null,
    } : null,
    environment: {
      cliInstalled,
      cliVersion,
      hasPartnersToken,
      hasOrgId,
      ready: cliInstalled && hasPartnersToken && hasOrgId,
    },
    checklist,
    recentProgress,
    shopifyAppInfo,
    links,
  });
}
