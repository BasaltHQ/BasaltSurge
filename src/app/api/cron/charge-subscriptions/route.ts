import { NextRequest, NextResponse } from "next/server";
import { getDueSubscriptions } from "@/lib/subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/cron/charge-subscriptions
 *
 * Batch charge all active subscriptions that are due.
 * Secured with CRON_SECRET header — called by Azure Timer Trigger daily.
 *
 * For each due subscription, calls POST /api/subscriptions/charge internally.
 */
export async function POST(req: NextRequest) {
    const correlationId = crypto.randomUUID();
    const startTime = Date.now();

    try {
        // Auth: CRON_SECRET
        const body = await req.json().catch(() => ({}));
        const cronSecret =
            req.headers.get("x-cron-secret") || body.cronSecret;
        const envSecret = process.env.CRON_SECRET;

        if (!envSecret || cronSecret !== envSecret) {
            return NextResponse.json(
                { error: "unauthorized" },
                { status: 401, headers: { "x-correlation-id": correlationId } }
            );
        }

        // Get all due subscriptions
        let dueSubs = await getDueSubscriptions();

        // Brand Isolation: Filter subscriptions by brand if running in a dedicated partner container
        const envBrandKey = String(process.env.BRAND_KEY || process.env.NEXT_PUBLIC_BRAND_KEY || "").trim().toLowerCase();
        const containerType = String(process.env.CONTAINER_TYPE || process.env.NEXT_PUBLIC_CONTAINER_TYPE || "platform").trim().toLowerCase();
        const isPartnerContainer = containerType === "partner" || (!!envBrandKey && envBrandKey !== "portalpay" && envBrandKey !== "basaltsurge");

        if (isPartnerContainer && envBrandKey) {
            try {
                const { getContainer } = await import("@/lib/cosmos");
                const container = await getContainer();
                const siteConfigsQuery = {
                    query: "SELECT c.wallet FROM c WHERE c.type = 'site_config' AND (c.brandKey = @brand OR c.config.brandKey = @brand)",
                    parameters: [{ name: "@brand", value: envBrandKey }]
                };
                const { resources: configs } = await container.items.query(siteConfigsQuery).fetchAll();
                const partnerWallets = new Set((configs || []).map(c => String(c.wallet || "").trim().toLowerCase()).filter(Boolean));
                
                dueSubs = dueSubs.filter(sub => partnerWallets.has(String(sub.merchantWallet || "").trim().toLowerCase()));
                console.log(`[cron/charge-subscriptions] Scoped due subscriptions to brand ${envBrandKey}. Found ${dueSubs.length} matching subscriptions.`);
            } catch (err) {
                console.error("[cron/charge-subscriptions] Failed scoping subscriptions to brand:", err);
            }
        }

        if (dueSubs.length === 0) {
            return NextResponse.json(
                {
                    success: true,
                    message: "No subscriptions due",
                    processed: 0,
                    durationMs: Date.now() - startTime,
                },
                { headers: { "x-correlation-id": correlationId } }
            );
        }

        console.log(
            `[cron/charge-subscriptions] Processing ${dueSubs.length} due subscription(s)`
        );

        // Process each subscription sequentially to avoid overwhelming the Engine
        const results: Array<{
            subscriptionId: string;
            success: boolean;
            error?: string;
        }> = [];

        // Build the internal charge URL
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

        for (const sub of dueSubs) {
            try {
                const chargeRes = await fetch(`${baseUrl}/api/subscriptions/charge`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-cron-secret": envSecret,
                    },
                    body: JSON.stringify({ subscriptionId: sub.subscriptionId }),
                });

                const chargeResult = await chargeRes.json().catch(() => ({}));

                results.push({
                    subscriptionId: sub.subscriptionId,
                    success: chargeRes.ok && chargeResult.success === true,
                    error: chargeResult.error || undefined,
                });

                // Small delay between charges to be respectful to the Engine
                await new Promise((r) => setTimeout(r, 500));
            } catch (err: any) {
                results.push({
                    subscriptionId: sub.subscriptionId,
                    success: false,
                    error: err?.message || "fetch_failed",
                });
            }
        }

        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;

        console.log(
            `[cron/charge-subscriptions] Done: ${succeeded} succeeded, ${failed} failed, ${Date.now() - startTime}ms`
        );

        return NextResponse.json(
            {
                success: true,
                processed: dueSubs.length,
                succeeded,
                failed,
                durationMs: Date.now() - startTime,
                results,
            },
            { headers: { "x-correlation-id": correlationId } }
        );
    } catch (err: any) {
        console.error("[cron/charge-subscriptions] error:", err);
        return NextResponse.json(
            { error: "internal", message: err?.message || "Unknown error" },
            { status: 500, headers: { "x-correlation-id": correlationId } }
        );
    }
}
