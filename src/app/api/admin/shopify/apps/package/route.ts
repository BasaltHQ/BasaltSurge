import { NextRequest, NextResponse } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import JSZip from "jszip";
import { getContainer } from "@/lib/cosmos";
import { generateCartExtensionFiles } from "@/lib/shopify/cart-extension";
import { generateAppToml, generateExtensionToml, generateCheckoutExtensionCode, generateExtensionPackageJson, type ShopifyAppConfig } from "@/lib/shopify/cli";

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

type PackageRequest = {
  brandKey?: string;
  palette?: { primary?: string; accent?: string };
};

function buildReadme(brandKey: string, plugin: any) {
  const name = String(plugin?.pluginName || brandKey).trim();
  const short = String(plugin?.shortDescription || plugin?.tagline || "").trim();
  const slug = String(plugin?.shopifyAppSlug || "").trim();
  const listingUrl = String(plugin?.listingUrl || "").trim();

  return [
    `# ${name} — Shopify App Package`,
    ``,
    short ? short : "Shopify app with a cart payment option and optional checkout UI extension.",
    ``,
    `## Contents`,
    `- shopify.app.toml (app configuration)`,
    `- extensions/cart-payment/ (Cart payment option app embed)`,
    `- extensions/checkout-ui/ (when enabled)`,
    `- assets/ (icons/banners/screenshots references)`,
    ``,
    `## Quick Deploy (Shopify CLI)`,
    `1. Verify client_id, application_url, redirect URLs, and scopes in shopify.app.toml match your existing app.`,
    `2. Run npm install, then npx shopify app deploy. Review the app version before releasing it.`,
    `3. In the published theme editor, open App embeds, enable Cart payment option, and Save.`,
    `4. Test the new payment button and the regular Checkout button with an unpaid test cart.`,
    `5. Remove the legacy cart ScriptTag only after the app embed is active and tested.`,
    ``,
    listingUrl ? `Current listing: ${listingUrl}` : (slug ? `Planned slug: ${slug}` : ""),
    ``,
    `## Notes`,
    `- Deploy the matching Surge backend and public assets before enabling the embed.`,
    `- This adds a cart button; it does not register a Shopify payment provider.`,
    `- Palette and copy are derived from brand plugin config; adjust as needed in the Partner UI.`,
  ].filter(Boolean).join("\n");
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

  // CSRF
  try { requireCsrf(req); } catch (e: any) {
    return headerJson({ error: e?.message || "bad_origin", correlationId }, { status: e?.status || 403 });
  }

  // Parse body
  let body: PackageRequest;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const brandKey = String(body?.brandKey || "").toLowerCase().trim();
  if (!brandKey) {
    return headerJson({ error: "brandKey_required", correlationId }, { status: 400 });
  }

  // Load plugin config for brand
  let plugin: any = null;
  try {
    const c = await getContainer();
    const { resource } = await c.item(`shopify_plugin_config:${brandKey}`, brandKey).read<any>();
    plugin = resource || null;
  } catch { }
  if (!plugin) {
    return headerJson({ error: "plugin_config_not_found", correlationId }, { status: 404 });
  }

  // Build ZIP
  const zip = new JSZip();
  const palette = body?.palette;
  const baseUrl = process.env.PLESK_MAIN_DOMAIN ? `https://${process.env.PLESK_MAIN_DOMAIN}`
    : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
  const appConfig: ShopifyAppConfig = {
    name: String(plugin.pluginName || brandKey), brandKey,
    clientId: plugin.shopifyAppId || undefined,
    applicationUrl: plugin.urls?.appUrl || `${baseUrl}/shopify/settings?brandKey=${brandKey}`,
    embedded: true,
    redirectUrls: Array.isArray(plugin.oauth?.redirectUrls) ? plugin.oauth.redirectUrls : [],
    scopes: (Array.isArray(plugin.oauth?.scopes) ? plugin.oauth.scopes : []).filter((scope: string) =>
      !["read_payment_gateways", "write_payment_gateways", "read_payment_sessions", "write_payment_sessions"].includes(scope)),
    extension: {
      enabled: !!plugin.extension?.enabled,
      buttonLabel: plugin.extension?.buttonLabel || "Pay with Crypto",
      minTotal: Number(plugin.extension?.eligibility?.minTotal || 0),
      currency: plugin.extension?.eligibility?.currency || "USD",
      palette: { primary: palette?.primary || plugin.extension?.palette?.primary || "#0ea5e9",
        accent: palette?.accent || plugin.extension?.palette?.accent || "#22c55e" }
    }
  };
  zip.file("shopify.app.toml", generateAppToml(appConfig));
  zip.file("package.json", generateExtensionPackageJson(appConfig));
  for (const [file, contents] of Object.entries(await generateCartExtensionFiles(appConfig))) zip.file(file, contents);
  if (appConfig.extension?.enabled) {
    zip.file("extensions/checkout-ui/shopify.extension.toml", generateExtensionToml(appConfig));
    zip.file("extensions/checkout-ui/src/Checkout.tsx", generateCheckoutExtensionCode(appConfig));
  }
  zip.file("README.md", buildReadme(brandKey, plugin));

  // Reference assets (we store references as text pointers; operators can replace with binaries as needed)
  const assetsTxt = [
    plugin?.assets?.iconUrl ? `icon: ${plugin.assets.iconUrl}` : null,
    plugin?.assets?.squareIconUrl ? `squareIcon: ${plugin.assets.squareIconUrl}` : null,
    plugin?.assets?.bannerUrl ? `banner: ${plugin.assets.bannerUrl}` : null,
    Array.isArray(plugin?.assets?.screenshots) ? `screenshots:\n${plugin.assets.screenshots.map((s: string) => `- ${s}`).join("\n")}` : null,
  ].filter(Boolean).join("\n");
  zip.file("assets/REFERENCES.txt", assetsTxt || "No asset references configured.");

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });

  // Upload to Azure Blob Storage
  // Upload to Storage
  const { storage } = await import("@/lib/azure-storage");
  const container = String(process.env.PP_PACKAGES_CONTAINER || "shopify-packages").trim();


  try {
    const blobName = `${brandKey}/${brandKey}-shopify-app.zip`;
    const fullPath = `${container}/${blobName}`;

    const url = await storage.upload(fullPath, zipBuffer, "application/zip");

    // SAS/Presigned URL (24h)
    let sasUrl: string | undefined;
    try {
      sasUrl = await storage.getSignedUrl(fullPath, 24 * 3600);
    } catch { }

    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_package", target: brandKey, correlationId, ok: true }); } catch { }

    return headerJson({ ok: true, brandKey, packageUrl: url, sasUrl, size: zipBuffer.byteLength, correlationId });
  } catch (e: any) {
    try { await auditEvent(req, { who: caller.wallet, roles: caller.roles, what: "shopify_app_package", target: brandKey, correlationId, ok: false, metadata: { error: e?.message || "upload_failed" } }); } catch { }
    return headerJson({ error: e?.message || "upload_failed", correlationId }, { status: 500 });
  }
}
