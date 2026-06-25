import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getContainer } from "@/lib/cosmos";
import { renderToStream } from "@react-pdf/renderer";
import React from "react";
import { EndOfDayPDF } from "@/components/reports/EndOfDayPDF";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { isBasaltSurge } from "@/lib/branding";
import sharp from "sharp";
import { readBrandOverridesFromCosmos } from "@/lib/brand-config";

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY || "re_123");

// Helper to get PDF stream as buffer
async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("error", (err) => reject(err));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
}

export async function POST(req: NextRequest) {
    try {
        const merchantWallet = req.headers.get("x-wallet");
        if (!merchantWallet) {
            return NextResponse.json({ error: "Wallet required" }, { status: 401 });
        }

        const body = await req.json();
        const { email, reportType, startTs, endTs, isTest } = body;

        if (!email) {
            return NextResponse.json({ error: "Email required" }, { status: 400 });
        }

        // 1. Resolve Brand / Sender Identity
        let senderName = "PortalPay Terminal";
        let senderEmail = "terminal@portalpay.io";
        let brandName = "PortalPay";
        let logoUrl: string | undefined = undefined;
        let brandColor = "#111827"; // Default Slate-900

        try {
            const siteConfig = await getSiteConfigForWallet(merchantWallet, undefined, req);
            const brandKey = siteConfig?.brandKey;
            brandName = siteConfig?.theme?.brandName || brandName;
            logoUrl = siteConfig?.theme?.brandLogoUrl || undefined;
            if (siteConfig?.theme?.primaryColor) brandColor = siteConfig.theme.primaryColor;

            if (brandKey && brandKey.toLowerCase() !== "portalpay") {
                const brandDoc = await readBrandOverridesFromCosmos(brandKey);

                if (brandDoc?.email?.senderEmail) {
                    senderEmail = brandDoc.email.senderEmail;
                    senderName = brandDoc.email.senderName || brandDoc.name || senderName;
                } else if (isBasaltSurge(brandKey)) {
                    senderName = "BasaltSurge Terminal";
                    senderEmail = "terminal@surge.basalthq.com";
                    brandName = "BasaltSurge";
                    logoUrl = "https://surge.basalthq.com/Surge.png";
                    brandColor = "#22c55e"; // Force Basalt Green
                }

                if (brandDoc?.name) brandName = brandDoc.name;
                if (brandDoc?.logos?.app) logoUrl = brandDoc.logos.app;
                if (brandDoc?.theme?.primaryColor) brandColor = brandDoc.theme.primaryColor;
            }

            // 1.5. Shop Override (Merchant Specific Branding)
            // This ensures a specific shop's logo/name overrides the generic Brand/Platform theme
            // 1.5. Shop Override via Robust Query
            try {
                const container = await getContainer();
                // Query matches case-insensitive wallet
                const shopQuery = {
                    query: "SELECT * FROM c WHERE LOWER(c.wallet) = @w AND c.type = 'shop_config'",
                    parameters: [{ name: "@w", value: merchantWallet.toLowerCase() }]
                };
                const { resources: shops } = await container.items.query(shopQuery).fetchAll();
                const shopDoc = shops[0];

                console.log(`[EmailReport] Shop Lookup for ${merchantWallet} -> Found: ${!!shopDoc} Name: ${shopDoc?.name}`);

                if (shopDoc) {
                    if (shopDoc.name) brandName = shopDoc.name;
                    if (shopDoc.theme?.brandLogoUrl) logoUrl = shopDoc.theme.brandLogoUrl;
                    if (shopDoc.theme?.primaryColor) brandColor = shopDoc.theme.primaryColor;
                }

                // FIX: Ensure Logo is Absolute URL (especially for PDF generation inside email/server context)
                if (logoUrl && logoUrl.startsWith("/")) {
                    const origin = req.nextUrl.origin;
                    logoUrl = `${origin}${logoUrl}`;
                }

                // FIX: Convert WebP to PNG using Sharp (React-PDF doesn't support WebP)
                if (logoUrl) {
                    try {
                        const response = await fetch(logoUrl);
                        if (response.ok) {
                            const arrayBuffer = await response.arrayBuffer();
                            const buffer = Buffer.from(arrayBuffer);

                            // Convert to PNG using sharp
                            const pngBuffer = await sharp(buffer).png().toBuffer();
                            const base64Info = pngBuffer.toString('base64');
                            logoUrl = `data:image/png;base64,${base64Info}`;
                            console.log(`[EmailReport] Transcoded Logo to PNG (${Math.round(pngBuffer.length / 1024)}KB)`);
                        }
                    } catch (e) {
                        console.warn("[EmailReport] Logo transcoding failed:", e);
                        if (logoUrl.endsWith(".webp")) logoUrl = undefined;
                    }
                }

            } catch (e) {
                console.warn("Failed to resolve shop config:", e);
            }

        } catch (e) {
            console.warn("Failed to resolve custom sender:", e);
        }

        const fromAddress = senderName ? `${senderName} <${senderEmail}>` : senderEmail;

        // 2. Fetch data for the report (or use test data if no receipts)
        let receipts: any[] = [];

        try {
            const container = await getContainer();
            const q = {
                query: `
                    SELECT * FROM c 
                    WHERE c.type = 'receipt' 
                    AND c.recipientWallet = @w 
                    AND c.createdAt >= @startDate AND c.createdAt <= @endDate
                    ORDER BY c.createdAt DESC
                `,
                parameters: [
                    { name: "@w", value: merchantWallet },
                    { name: "@startDate", value: new Date(startTs * 1000) },
                    { name: "@endDate", value: new Date(endTs * 1000) }
                ]
            };
            const result = await container.items.query(q).fetchAll();
            receipts = result.resources || [];
        } catch (e) {
            console.warn("Failed to fetch receipts, using test data:", e);
        }

        // 3. Generate test data ONLY if explicit test mode
        const isTestMode = isTest === true || reportType === "Test";
        let employees: any[] = [];
        let hourly: any[] = [];

        if (isTestMode) {
            // Generate rich dummy data (45+ items)
            receipts = [];
            const staff = ["Alice", "Bob", "Charlie", "Diana"];
            const tokens = ["USDC", "ETH", "cbBTC", "USDT"];
            const now = Date.now();

            // Generate 45 mixed transactions over the last 12 hours
            for (let i = 0; i < 45; i++) {
                const amount = 20 + Math.random() * 150; // $20 - $170
                const timeOffset = Math.floor(Math.random() * 12 * 3600 * 1000);
                receipts.push({
                    id: `test-${i}`,
                    totalUsd: amount,
                    createdAt: now - timeOffset,
                    paymentMethod: tokens[Math.floor(Math.random() * tokens.length)],
                    employeeId: staff[Math.floor(Math.random() * staff.length)]
                });
            }
        }

        // 4. Calculate Stats
        const totalSales = receipts.reduce((sum, r) => sum + (r.totalUsd || 0), 0);
        const stats = {
            totalSales,
            totalTips: 0,
            transactionCount: receipts.length,
            averageOrderValue: receipts.length > 0 ? totalSales / receipts.length : 0,
        };

        // 5. Calculate Payment Methods breakdown
        const paymentMethodsMap: Record<string, number> = {};
        for (const r of receipts) {
            const method = r.paymentMethod || "Unknown";
            paymentMethodsMap[method] = (paymentMethodsMap[method] || 0) + (r.totalUsd || 0);
        }
        const paymentMethods = Object.entries(paymentMethodsMap).map(([method, total]) => ({
            method,
            total
        }));

        // 6. Calculate Employee Performance
        const empMap: Record<string, { sales: number, count: number }> = {};
        for (const r of receipts) {
            const eid = r.employeeId || r.clerkId || "Staff";
            if (!empMap[eid]) empMap[eid] = { sales: 0, count: 0 };
            empMap[eid].sales += (r.totalUsd || 0);
            empMap[eid].count += 1;
        }
        employees = Object.entries(empMap).map(([id, data]) => ({
            id,
            sales: data.sales,
            count: data.count,
            tips: 0,
            aov: data.count > 0 ? data.sales / data.count : 0
        })).sort((a, b) => b.sales - a.sales);

        // 7. Calculate Hourly Breakdown (UTC based)
        const hourMap: Record<number, number> = {};
        for (const r of receipts) {
            const h = new Date(r.createdAt).getHours();
            hourMap[h] = (hourMap[h] || 0) + (r.totalUsd || 0);
        }
        hourly = Object.entries(hourMap).map(([h, amount]) => ({
            hour: parseInt(h),
            amount
        })).sort((a, b) => a.hour - b.hour);

        // STRICT LAYOUT CONTROL: Filter data arrays based on Report Type
        if (reportType?.includes("Sales")) {
            employees = [];
            hourly = [];
        }

        // 8. Render PDF with correct props
        const dateStr = new Date(startTs * 1000).toLocaleDateString();

        // Visibility Logic matching the main route
        // Checks against lower case report title sent from frontend
        const t = reportType.toLowerCase();
        const showPayments = t.includes("end of day") || t.includes("sales snapshot") || t.includes("z-report") || t.includes("x-report");
        const showEmployeeStats = t.includes("end of day") || t.includes("staff") || t.includes("employee") || t.includes("z-report");
        const showHourlyStats = t.includes("end of day") || t.includes("hourly") || t.includes("z-report");

        const pdfStream = await renderToStream(
            <EndOfDayPDF
                brandName={brandName}
                logoUrl={logoUrl}
                brandColor={brandColor}
                date={dateStr}
                generatedBy={merchantWallet}
                stats={stats}
                paymentMethods={paymentMethods}
                employees={employees}
                hourly={hourly}
                reportTitle={isTestMode ? `${reportType} (Test)` : reportType || "End of Day Report"}
                showPayments={showPayments}
                showEmployeeStats={showEmployeeStats}
                showHourlyStats={showHourlyStats}
            />
        );

        const pdfBuffer = await streamToBuffer(pdfStream);

        // 7. Send Email
        const recipients = email.split(",").map((e: string) => e.trim()).filter((e: string) => e.length > 0);
        const { data, error } = await resend.emails.send({
            from: fromAddress,
            to: recipients,
            subject: `${reportType || "Report"} - ${new Date().toLocaleDateString()}`,
            html: `
                <h1>${senderName} Report</h1>
                <p>Please find attached your ${reportType || "report"} for ${dateStr}.</p>
                ${isTestMode ? '<p style="color: orange;"><strong>Note:</strong> This is a test report with sample data.</p>' : ''}
                <p><strong>Summary:</strong></p>
                <ul>
                    <li>Total Sales: $${stats.totalSales.toFixed(2)}</li>
                    <li>Transactions: ${stats.transactionCount}</li>
                    <li>Average Order: $${stats.averageOrderValue.toFixed(2)}</li>
                </ul>
            `,
            attachments: [
                {
                    filename: `${reportType || "report"}.pdf`,
                    content: pdfBuffer
                }
            ]
        });

        if (error) {
            console.error("Resend error", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, isTestMode });

    } catch (e: any) {
        console.error("Email failed", e);
        return NextResponse.json({ error: e.message || "Failed to send email" }, { status: 500 });
    }
}
