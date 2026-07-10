import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { getPlatformAdminWallets } from "@/lib/authz-server";
import { requireCsrf } from "@/lib/security";
import { sendEmail } from "@/lib/aws/ses";

export const dynamic = "force-dynamic";

function getBrandKey(req?: NextRequest): string {
    const ct = String(process.env.NEXT_PUBLIC_CONTAINER_TYPE || process.env.CONTAINER_TYPE || "platform").toLowerCase();
    const envKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").toLowerCase();
    const headerKey = req?.headers.get("x-brand-key");
    if (headerKey) return headerKey.toLowerCase();
    if (ct === "partner") return envKey;
    return envKey || "basaltsurge";
}

function json(obj: any, init?: { status?: number }) {
    return NextResponse.json(obj, init);
}

export async function POST(req: NextRequest) {
    try {
        // CSRF Check
        try { requireCsrf(req); } catch (e: any) {
            return json({ error: e?.message || "bad_origin" }, { status: 403 });
        }

        const caller = await requireThirdwebAuth(req).catch(() => null as any);
        const roles = Array.isArray(caller?.roles) ? caller.roles : [];

        // Platform admin access
        const callerWallet = String(caller?.wallet || "").toLowerCase();
        const platformAdminWallets = await getPlatformAdminWallets();
        const isPlatformAdmin = platformAdminWallets.includes(callerWallet);

        if (!isPlatformAdmin && !roles.includes("admin") && !roles.includes("superadmin")) {
            return json({ error: "forbidden" }, { status: 403 });
        }

        const brandKey = getBrandKey(req);
        if (!brandKey) {
            return json({ error: "missing_brand_key" }, { status: 500 });
        }

        const body = await req.json().catch(() => ({} as any));
        const requestId = String(body?.requestId || "").trim();

        if (!requestId) {
            return json({ error: "request_id_required" }, { status: 400 });
        }

        const container = await getContainer();

        // 1. Fetch the request
        const findQuery = {
            query: `SELECT * FROM c WHERE c.type = 'client_request' AND c.id = @id AND c.brandKey = @brand`,
            parameters: [
                { name: "@id", value: requestId },
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: requests } = await container.items.query(findQuery).fetchAll();
        const request = requests[0] as any;

        if (!request) {
            return json({ error: "request_not_found" }, { status: 404 });
        }

        const clientEmail = request.email || request.contactEmail || request.billingEmail;
        if (!clientEmail) {
            return json({ error: "client_email_missing", message: "No email address found for this client request." }, { status: 400 });
        }

        const customDomain = String(request.customDomain || "").trim();
        if (!customDomain) {
            return json({ error: "custom_domain_not_configured", message: "Please configure a custom domain before sending instructions." }, { status: 400 });
        }

        // 2. Fetch Brand Configuration for Premium Email Styling
        const configQuery = {
            query: `SELECT * FROM c WHERE c.type = 'site_config' AND StringEquals(c.brandKey, @brand, true)`,
            parameters: [
                { name: "@brand", value: brandKey }
            ]
        };
        const { resources: configs } = await container.items.query(configQuery).fetchAll();
        const activeConfig = configs[0] as any;
        const theme = activeConfig?.config?.theme || {};
        const brandName = theme.brandName || activeConfig?.name || "PortalPay";
        const primaryColor = theme.primaryColor || "#0ea5e9";
        const logoUrl = theme.brandLogoUrl || theme.symbolLogoUrl || "";

        // 3. Resolve DNS parameters
        const hasCloudflare = !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
        const hostingProvider = hasCloudflare
            ? "cloudflare"
            : (process.env.HOSTING_PROVIDER || "azure").toLowerCase();
        const cnameTarget = (hostingProvider === "plesk" || hostingProvider === "cloudflare")
            ? (process.env.PLESK_MAIN_DOMAIN || "surge.basalthq.com")
            : (req.headers.get("host") || "surge.basalthq.com");

        const expectedTxtRecord = `${brandKey}-verification=${request.wallet.toLowerCase()}`;

        // Determine subdomain or apex domain
        const parts = customDomain.toLowerCase().split(".");
        let subdomain = "@";
        if (parts.length > 2) {
            subdomain = parts[0];
        }

        // 4. Construct Branded HTML Email
        const emailHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                        color: #1f2937;
                        line-height: 1.6;
                        background-color: #f9fafb;
                        margin: 0;
                        padding: 0;
                    }
                    .container {
                        max-width: 600px;
                        margin: 40px auto;
                        background: #ffffff;
                        border-radius: 16px;
                        border: 1px solid #e5e7eb;
                        overflow: hidden;
                        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
                    }
                    .header {
                        background-color: #ffffff;
                        padding: 32px 24px;
                        border-bottom: 1px solid #f3f4f6;
                        text-align: center;
                    }
                    .logo {
                        max-height: 48px;
                        margin-bottom: 12px;
                    }
                    .brand-name {
                        font-size: 20px;
                        font-weight: 800;
                        color: #111827;
                        margin: 0;
                    }
                    .content {
                        padding: 32px 24px;
                    }
                    h1 {
                        font-size: 20px;
                        font-weight: 700;
                        color: #111827;
                        margin-top: 0;
                        margin-bottom: 16px;
                    }
                    p {
                        font-size: 14px;
                        color: #4b5563;
                        margin-top: 0;
                        margin-bottom: 24px;
                    }
                    .dns-table {
                        width: 100%;
                        border-collapse: separate;
                        border-spacing: 0;
                        margin-bottom: 24px;
                        border: 1px solid #e5e7eb;
                        border-radius: 12px;
                        overflow: hidden;
                    }
                    .dns-table th {
                        background-color: #f9fafb;
                        padding: 12px 16px;
                        font-size: 11px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        color: #4b5563;
                        text-align: left;
                        border-bottom: 1px solid #e5e7eb;
                    }
                    .dns-table td {
                        padding: 14px 16px;
                        font-size: 13px;
                        color: #1f2937;
                        border-bottom: 1px solid #f3f4f6;
                    }
                    .dns-table tr:last-child td {
                        border-bottom: none;
                    }
                    code {
                        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                        font-size: 12px;
                        background-color: #f3f4f6;
                        padding: 4px 8px;
                        border-radius: 6px;
                        color: #111827;
                    }
                    .footer {
                        background-color: #f9fafb;
                        padding: 24px;
                        text-align: center;
                        border-top: 1px solid #f3f4f6;
                        font-size: 12px;
                        color: #9ca3af;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header">
                        ${logoUrl ? `<img src="${logoUrl}" alt="${brandName}" class="logo" />` : ""}
                        <h2 class="brand-name">${brandName}</h2>
                    </div>
                    <div class="content">
                        <h1>Set up your custom domain</h1>
                        <p>To finish connecting your custom domain <strong>${customDomain}</strong> to your checkout shop, please log in to your domain registrar (e.g., GoDaddy, Namecheap, or Cloudflare) and add the following two DNS records:</p>
                        
                        <table class="dns-table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Host / Name</th>
                                    <th>Value / Target</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td><strong>CNAME</strong></td>
                                    <td><code>${subdomain}</code></td>
                                    <td><code>${cnameTarget}</code></td>
                                </tr>
                                <tr>
                                    <td><strong>TXT</strong></td>
                                    <td><code>_verify${subdomain === "@" ? "" : "." + subdomain}</code></td>
                                    <td><code>${expectedTxtRecord}</code></td>
                                </tr>
                            </tbody>
                        </table>

                        <p>Once you have configured these records, our systems will detect the settings and activate your secure SSL certificate. This process usually takes anywhere from a few minutes up to 24 hours.</p>
                        <p>If you have any questions or require assistance, please reply to this email.</p>
                    </div>
                    <div class="footer">
                        &copy; ${new Date().getFullYear()} ${brandName}. All rights reserved.
                    </div>
                </div>
            </body>
            </html>
        `;

        // 5. Dispatch email
        await sendEmail({
            to: clientEmail,
            subject: `Action Required: Configure DNS for ${customDomain}`,
            html: emailHtml,
            fromName: brandName,
            brandKey: brandKey
        });

        return json({ ok: true });
    } catch (e: any) {
        console.error("[send-dns-email] POST Error:", e);
        return json({ error: e?.message || "Internal server error" }, { status: 500 });
    }
}
