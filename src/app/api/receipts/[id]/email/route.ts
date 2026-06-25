import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
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

    try {
        const body = await req.json().catch(() => ({}));
        const email = body?.email;
        if (!email || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
            return NextResponse.json({ error: "invalid_email", message: "A valid email address is required." }, { status: 400, headers: { "x-correlation-id": correlationId } });
        }

        // Optional wallet for auth-less sending (terminal/kiosk context might not have strong Thirdweb auth)
        // Or we just verify that the receipt exists. Since it's just sending a receipt to an email, it's generally safe.
        // We do require finding the receipt first.
        const container = await getContainer();

        const { resources } = await container.items.query({
            query: "SELECT * FROM c WHERE c.type='receipt' AND c.receiptId=@id",
            parameters: [
                { name: "@id", value: id },
            ],
        }).fetchAll();

        const receipt = Array.isArray(resources) && resources[0] ? resources[0] : null;
        if (!receipt) {
            return NextResponse.json({ error: "receipt_not_found" }, { status: 404, headers: { "x-correlation-id": correlationId } });
        }

        const wallet = receipt.wallet;

        let senderName = "PortalPay Receipts";
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
                senderName = "BasaltSurge Receipts";
                senderEmail = "receipts@surge.basalthq.com";
                brandName = "BasaltSurge";
                logoUrl = "https://surge.basalthq.com/Surge.png";
                brandColor = "#22c55e";
            }
            if (brandDoc?.name) brandName = brandDoc.name;
            if (brandDoc?.logos?.app) logoUrl = brandDoc.logos.app;
            if (brandDoc?.colors?.primary) brandColor = brandDoc.colors.primary;
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

        // Initialize itemsHtml for the receipt
        let itemsHtml = "";
        if (Array.isArray(receipt.lineItems) && receipt.lineItems.length > 0) {
            itemsHtml = `
            <div style="margin-top: 24px; border-top: 1px solid #eaeaea; padding-top: 20px;">
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 15px;">
                    ${receipt.lineItems.map((it: any) => `
                        <tr>
                            <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; color: #333;">
                                <strong style="color: #666;">${it.qty || 1}x</strong> ${it.label || "Item"}
                            </td>
                            <td style="padding: 10px 0; border-bottom: 1px solid #f5f5f5; text-align: right; color: #333; font-weight: 500;">
                                $${Number(it.priceUsd || 0).toFixed(2)}
                            </td>
                        </tr>
                    `).join('')}
                </table>
                ${receipt.taxComponents ? `
                    <div style="display: flex; justify-content: space-between; margin-top: 12px; font-size: 14px; color: #666;">
                        <span>Subtotal</span>
                        <span>$${Number((receipt.totalUsd || 0) - (receipt.taxComponents.totalTax || 0) - (receipt.tipAmount || 0)).toFixed(2)}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 14px; color: #666;">
                        <span>Tax</span>
                        <span>$${Number(receipt.taxComponents.totalTax || 0).toFixed(2)}</span>
                    </div>
                ` : ''}
                ${receipt.tipAmount ? `
                    <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 14px; color: #666;">
                        <span>Tip</span>
                        <span>$${Number(receipt.tipAmount || 0).toFixed(2)}</span>
                    </div>
                ` : ''}
                <div style="text-align: right; margin-top: 16px; font-weight: bold; font-size: 20px; color: #111; border-top: 2px solid #eaeaea; padding-top: 16px;">
                    Total: $${Number(receipt.totalUsd || 0).toFixed(2)}
                </div>
            </div>
            `;
        }

        const dateFormatted = new Date(receipt.createdAt || Date.now()).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const htmlContent = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eaeaea; border-radius: 8px; overflow: hidden; background: #ffffff;">
                <div style="background-color: ${brandColor}; padding: 32px 24px; text-align: center;">
                    ${logoUrl ? `<img src="${logoUrl}" alt="${brandName}" style="max-height: 64px; max-width: 64px; border-radius: 50%; margin-bottom: 16px; display: inline-block; object-fit: cover; border: 2px solid rgba(255,255,255,0.2);" />` : ""}
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">${brandName} Receipt</h1>
                </div>
                <div style="padding: 32px; color: #333333; line-height: 1.6;">
                    <table style="width: 100%; margin-bottom: 24px; border-collapse: collapse;">
                        <tr>
                            <td style="vertical-align: top; text-align: left;">
                                <p style="margin: 0; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Receipt #</p>
                                <p style="margin: 4px 0 0 0; font-size: 16px; font-family: monospace; font-weight: 500;">${id}</p>
                            </td>
                            <td style="vertical-align: top; text-align: right;">
                                <p style="margin: 0; font-size: 14px; color: #666; text-transform: uppercase; letter-spacing: 0.05em; font-weight: bold;">Date</p>
                                <p style="margin: 4px 0 0 0; font-size: 14px; color: #444;">${dateFormatted}</p>
                            </td>
                        </tr>
                    </table>
                    
                    ${receipt.status === 'paid' ? `
                    <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 12px 16px; margin: 24px 0; border-radius: 0 4px 4px 0;">
                        <p style="margin: 0; color: #065f46; font-size: 15px;">
                            <strong>✅ Status: Paid in full.</strong>
                        </p>
                    </div>
                    ` : ''}

                    ${itemsHtml}

                    <div style="margin-top: 32px; text-align: center;">
                        <a href="${req.nextUrl.origin}/portal/${id.replace('receipt:', '')}?recipient=${encodeURIComponent(wallet)}" style="display: inline-block; padding: 14px 28px; background-color: ${brandColor}; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                            View Receipt Online
                        </a>
                    </div>

                    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #eaeaea; font-size: 14px; color: #64748b; text-align: center;">
                        Thank you for your purchase from <strong>${brandName}</strong>!
                    </div>
                </div>
            </div>
        `;

        await sendEmail({
            to: email,
            subject: `Your ${brandName} Receipt (${id})`,
            html: htmlContent,
            fromName: senderName,
            fromEmail: senderEmail,
            brandKey: brandKey,
        });

        return NextResponse.json({ ok: true, sent: true }, { headers: { "x-correlation-id": correlationId } });
    } catch (e: any) {
        console.error("Receipt email API failed:", e);
        return NextResponse.json(
            { error: e?.message || "server_error" },
            { status: 500, headers: { "x-correlation-id": correlationId } }
        );
    }
}
