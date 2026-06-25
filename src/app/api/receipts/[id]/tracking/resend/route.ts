import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import { requireThirdwebAuth } from "@/lib/auth";
import { sendEmail } from "@/lib/aws/ses";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { isBasaltSurge } from "@/lib/branding";
import { readBrandOverridesFromCosmos } from "@/lib/brand-config";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const correlationId = crypto.randomUUID();
    const { id } = await params;
    if (!id) {
        return NextResponse.json({ error: "missing_id" }, { status: 400, headers: { "x-correlation-id": correlationId } });
    }

    let wallet = "";
    try {
        const caller = await requireThirdwebAuth(req);
        const xWallet = req.headers.get("x-wallet");
        if (xWallet && /^0x[a-f0-9]{40}$/i.test(xWallet)) {
            wallet = xWallet.toLowerCase();
        } else {
            wallet = caller.wallet;
        }
    } catch (e: any) {
        return NextResponse.json(
            { error: e?.message || "unauthorized" },
            { status: 401, headers: { "x-correlation-id": correlationId } }
        );
    }

    try {
        const container = await getContainer();

        const { resources } = await container.items.query({
            query: "SELECT * FROM c WHERE c.type='receipt' AND c.receiptId=@id AND c.wallet=@wallet",
            parameters: [
                { name: "@id", value: id },
                { name: "@wallet", value: wallet },
            ],
        }).fetchAll();

        const receipt = Array.isArray(resources) && resources[0] ? resources[0] : null;
        if (!receipt) {
            return NextResponse.json({ error: "receipt_not_found" }, { status: 404, headers: { "x-correlation-id": correlationId } });
        }

        const buyerEmail = receipt.buyerEmail || receipt.shippingAddress?.email;
        if (!buyerEmail) {
            return NextResponse.json({ error: "no_email", message: "Customer did not provide an email address." }, { status: 400, headers: { "x-correlation-id": correlationId } });
        }

        const trackingNumber = receipt.tracking?.trackingNumber;
        const carrier = receipt.tracking?.carrier || "Standard Carrier";
        const trackingUrl = receipt.tracking?.trackingUrl || "";

        if (!trackingNumber) {
            return NextResponse.json({ error: "no_tracking", message: "Receipt does not have tracking information to send." }, { status: 400, headers: { "x-correlation-id": correlationId } });
        }
        
        let senderName = "PortalPay Tracking";
        let senderEmail = "no-reply@portalpay.io";
        let brandName = "PortalPay";
        let logoUrl: string | undefined = undefined;
        let brandColor = "#111827";

        const siteConfig = await getSiteConfigForWallet(wallet, undefined, req);
        const brandKey = siteConfig?.brandKey || "";
        brandName = siteConfig?.theme?.brandName || brandName;
        logoUrl = siteConfig?.theme?.brandLogoUrl || undefined;
        if (siteConfig?.theme?.primaryColor) brandColor = siteConfig.theme.primaryColor;

        if (brandKey && brandKey.toLowerCase() !== "portalpay") {
            const brandDoc = await readBrandOverridesFromCosmos(brandKey);
            if (brandDoc?.email?.senderEmail) {
                senderEmail = brandDoc.email.senderEmail;
                senderName = brandDoc.email.senderName || brandDoc.name || senderName;
            } else if (isBasaltSurge(brandKey)) {
                senderName = "BasaltSurge Tracking";
                senderEmail = "tracking@surge.basalthq.com";
                brandName = "BasaltSurge";
                logoUrl = "https://surge.basalthq.com/Surge.png";
                brandColor = "#22c55e";
            }
            if (brandDoc?.name) brandName = brandDoc.name;
            if (brandDoc?.logos?.app) logoUrl = brandDoc.logos.app;
            if (brandDoc?.theme?.primaryColor) brandColor = brandDoc.theme.primaryColor;
        }

        const { resources: shopDocs } = await container.items.query({
            query: "SELECT * FROM c WHERE LOWER(c.wallet) = @w AND c.type = 'shop_config'",
            parameters: [{ name: "@w", value: wallet.toLowerCase() }]
        }).fetchAll();
        
        if (shopDocs?.[0]?.theme) {
            const theme = shopDocs[0].theme;
            if (shopDocs[0].name || theme.brandName) brandName = shopDocs[0].name || theme.brandName;
            if (theme.brandLogoUrl) logoUrl = theme.brandLogoUrl;
            if (theme.primaryColor) brandColor = theme.primaryColor;
        }

        if (typeof logoUrl === "string" && logoUrl.startsWith("/")) {
            logoUrl = `${req.nextUrl.origin}${logoUrl}`;
        }

        let itemsHtml = "";
        if (Array.isArray(receipt.lineItems) && receipt.lineItems.length > 0) {
            itemsHtml = `
            <div style="margin-top: 24px; border-top: 1px solid #eaeaea; padding-top: 20px;">
                <h3 style="margin-top: 0; font-size: 16px; color: #111;">Order Details</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                    ${receipt.lineItems.map((it: any) => `
                        <tr>
                            <td style="padding: 8px 0; border-bottom: 1px solid #f5f5f5; color: #333;">
                                <strong style="color: #666;">${it.qty || 1}x</strong> ${it.label || "Item"}
                            </td>
                            <td style="padding: 8px 0; border-bottom: 1px solid #f5f5f5; text-align: right; color: #333;">
                                $${Number(it.priceUsd || 0).toFixed(2)}
                            </td>
                        </tr>
                    `).join('')}
                </table>
                <div style="text-align: right; margin-top: 12px; font-weight: bold; font-size: 16px; color: #111;">
                    Total: $${Number(receipt.totalUsd || 0).toFixed(2)}
                </div>
            </div>
            `;
        }

        const htmlContent = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background: #ffffff;">
                <div style="background-color: ${brandColor}; padding: 24px; text-align: center;">
                    ${logoUrl ? `<img src="${logoUrl}" alt="${brandName}" style="max-height: 64px; max-width: 64px; border-radius: 50%; margin-bottom: 16px; display: inline-block; object-fit: cover; border: 2px solid rgba(255,255,255,0.2);" />` : ""}
                    <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 600;">Your Order Has Shipped</h1>
                </div>
                <div style="padding: 32px; color: #333333; line-height: 1.6;">
                    <p style="font-size: 16px; margin-top: 0;">Great news! Your order (Receipt: <strong>${id}</strong>) has been shipped via <strong>${carrier}</strong>.</p>
                    
                    <div style="margin: 24px 0;">
                        <p style="margin: 0 0 8px 0; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Tracking Number</p>
                        <div style="background-color: #f8fafc; padding: 14px 18px; border-radius: 6px; border: 1px solid #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 16px; color: #0f172a; font-weight: 500;">
                            ${trackingNumber}
                        </div>
                    </div>
                    
                    ${trackingUrl ? `<div style="margin-top: 24px;"><a href="${trackingUrl}" style="background-color: ${brandColor}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 15px;">Track Your Package</a></div>` : ""}

                    ${itemsHtml}

                    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eaeaea; font-size: 14px; color: #64748b; text-align: center;">
                        Thank you for your purchase from <strong>${brandName}</strong>!
                    </div>
                </div>
            </div>
        `;

        await sendEmail({
            to: buyerEmail,
            subject: `Your ${brandName} order has shipped! (Update)`,
            html: htmlContent,
            fromName: senderName,
            fromEmail: senderEmail,
        });

        return NextResponse.json({ ok: true, sent: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
        console.error("Resend API failed:", e);
        return NextResponse.json(
            { error: e?.message || "server_error" },
            { status: 500, headers: { "x-correlation-id": correlationId } }
        );
    }
}
