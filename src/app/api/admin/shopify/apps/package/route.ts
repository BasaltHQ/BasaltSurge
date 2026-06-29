import { NextRequest, NextResponse } from "next/server";
import { requireThirdwebAuth } from "@/lib/auth";
import { requireCsrf } from "@/lib/security";
import { auditEvent } from "@/lib/audit";
import JSZip from "jszip";
import { getContainer } from "@/lib/cosmos";

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

/**
 * Build Shopify app.toml content based on plugin config values.
 * This is a stub template; operators may adjust fields in the Shopify Partner UI.
 */
function buildAppToml(brandKey: string, plugin: any, palette?: { primary?: string; accent?: string }) {
  const name = String(plugin?.pluginName || brandKey).trim();
  const redirectUrls = Array.isArray(plugin?.oauth?.redirectUrls) ? plugin.oauth.redirectUrls : [];
  const scopes = Array.isArray(plugin?.oauth?.scopes) ? plugin.oauth.scopes : [];
  const supportUrl = String(plugin?.urls?.supportUrl || "").trim();
  const privacyUrl = String(plugin?.urls?.privacyUrl || "").trim();
  const termsUrl = String(plugin?.urls?.termsUrl || "").trim();

  return `name = "${name}"
client_id = ""
application_url = ""
embedded = true

[auth]
redirect_urls = [${redirectUrls.map((u: string) => `"${u}"`).join(", ")}]
scopes = "${scopes.join(",")}"

[ui]
primary_color = "${palette?.primary || plugin?.extension?.palette?.primary || "#0ea5e9"}"
accent_color = "${palette?.accent || plugin?.extension?.palette?.accent || "#22c55e"}"

[urls]
support = "${supportUrl}"
privacy = "${privacyUrl}"
terms = "${termsUrl}"
`;
}

function buildCheckoutExtensionJson(plugin: any) {
  const enabled = !!plugin?.extension?.enabled;
  const label = String(plugin?.extension?.buttonLabel || "Pay with Crypto").slice(0, 64);
  const minTotal = Number(plugin?.extension?.eligibility?.minTotal || 0);
  const currency = String(plugin?.extension?.eligibility?.currency || "USD").slice(0, 12);
  const primary = String(plugin?.extension?.palette?.primary || "#0ea5e9");
  const accent = String(plugin?.extension?.palette?.accent || "#22c55e");

  return JSON.stringify({
    extension_points: enabled ? ["checkout"] : [],
    settings: {
      button_label: label,
      eligibility: { min_total: minTotal, currency },
      palette: { primary, accent }
    }
  }, null, 2);
}

function buildReadme(brandKey: string, plugin: any) {
  const name = String(plugin?.pluginName || brandKey).trim();
  const short = String(plugin?.shortDescription || plugin?.tagline || "").trim();
  const slug = String(plugin?.shopifyAppSlug || "").trim();
  const listingUrl = String(plugin?.listingUrl || "").trim();

  return [
    `# ${name} — Shopify App Package`,
    ``,
    short ? short : "PortalPay-branded Shopify app with Checkout UI extension for crypto payments.",
    ``,
    `## Contents`,
    `- app.toml (app manifest template)`,
    `- extensions/checkout-ui.json (extension config stub)`,
    `- assets/ (icons/banners/screenshots references)`,
    ``,
    `## Quick Deploy (Shopify CLI)`,
    `1. Authenticate:`,
    `   shopify login --store <dev-store-domain>`,
    `2. Create app (if not exists) and push:`,
    `   shopify app create`,
    `   shopify app config write --from app.toml`,
    `   shopify extension push`,
    `3. Configure OAuth redirect URLs & scopes in app settings if not applied by CLI.`,
    `4. Submit for review via Shopify Partner dashboard.`,
    ``,
    listingUrl ? `Current listing: ${listingUrl}` : (slug ? `Planned slug: ${slug}` : ""),
    ``,
    `## Notes`,
    `- Update app.toml fields (client_id, application_url) as provided by Shopify.`,
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
  zip.file("app.toml", buildAppToml(brandKey, plugin, palette));
  zip.file("extensions/checkout-ui.json", buildCheckoutExtensionJson(plugin));
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
