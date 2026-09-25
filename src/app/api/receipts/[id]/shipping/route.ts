import { recalculateReceiptForCardFunding } from "@/lib/receipts";
import { getSiteConfigForWallet } from "@/lib/site-config";
import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";

/**
 * POST /api/receipts/[id]/shipping
 * Updates shipping address, method, and cost on a receipt before payment.
 * Called by the portal checkout widget when the customer fills in shipping details.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!id) {
        return NextResponse.json({ error: "invalid_request", message: "receipt_id_required" }, { status: 400 });
    }

    // Validate shipping address
    const addr = body?.shippingAddress;
    if (!addr || typeof addr !== "object") {
        return NextResponse.json({ error: "invalid_request", message: "shipping_address_required" }, { status: 400 });
    }
    const shippingAddress = {
        name: typeof addr.name === "string" ? addr.name.slice(0, 120) : "",
        email: typeof addr.email === "string" ? addr.email.toLowerCase().slice(0, 200) : "",
        line1: typeof addr.line1 === "string" ? addr.line1.slice(0, 200) : "",
        line2: typeof addr.line2 === "string" ? addr.line2.slice(0, 200) : "",
        city: typeof addr.city === "string" ? addr.city.slice(0, 100) : "",
        state: typeof addr.state === "string" ? addr.state.slice(0, 100) : "",
        zip: typeof addr.zip === "string" ? addr.zip.slice(0, 20) : "",
        country: typeof addr.country === "string" ? addr.country.slice(0, 2).toUpperCase() : "US",
    };

    if (!shippingAddress.line1 || !shippingAddress.city || !shippingAddress.zip || !shippingAddress.email) {
        return NextResponse.json({ error: "invalid_request", message: "incomplete_address" }, { status: 400 });
    }

    // Validate shipping method
    const validMethods = ["standard", "express", "overnight", "freight"];
    const shippingMethod = validMethods.includes(body?.shippingMethod) ? body.shippingMethod : "standard";

    // Shipping cost
    const shippingCostUsd = typeof body?.shippingCostUsd === "number" && Number.isFinite(body.shippingCostUsd) && body.shippingCostUsd >= 0
        ? Math.round(body.shippingCostUsd * 100) / 100
        : 0;

    try {
        const container = await getContainer();
        const query = `SELECT * FROM c WHERE c.receiptId = @id`;
        const { resources } = await container.items.query({
            query,
            parameters: [{ name: "@id", value: id }]
        }).fetchAll();

        if (!resources || resources.length === 0) {
            return NextResponse.json({ error: "receipt_not_found" }, { status: 404 });
        }

        const receipt = resources[0];

        // Don't allow shipping updates on already-paid receipts
        const settledStatuses = ["paid", "checkout_success", "confirmed", "reconciled", "tx_mined"];
        if (settledStatuses.includes((receipt.status || "").toLowerCase())) {
            return NextResponse.json({ error: "receipt_already_settled" }, { status: 409 });
        }

        // Remove any existing shipping cost line item
        const lineItems = (receipt.lineItems || []).filter((it: any) => !/^shipping/i.test(it.label || ""));

        // Add shipping cost as a line item if > 0
        if (shippingCostUsd > 0) {
            const methodLabel = shippingMethod.charAt(0).toUpperCase() + shippingMethod.slice(1);
            lineItems.push({
                label: `Shipping (${methodLabel})`,
                priceUsd: shippingCostUsd,
                qty: 1,
            });
        }

        // Recalculate total
        const newTotalUsd = Math.round(lineItems.reduce((sum: number, it: any) => sum + Number(it.priceUsd || 0), 0) * 100) / 100;

        // Capture buyer wallet if provided (login-first shipping)
        const buyerWallet = typeof body?.buyerWallet === "string" && /^0x[a-f0-9]{40}$/i.test(body.buyerWallet)
            ? body.buyerWallet.toLowerCase()
            : undefined;

        // Ensure buyerEmail is at the root for easier querying if provided in shipping
        const buyerEmail = shippingAddress.email || receipt.buyerEmail;

        let updatedReceipt = {
            ...receipt,
            shippingAddress,
            shippingMethod,
            shippingCostUsd,
            lineItems,
            totalUsd: newTotalUsd,
            lastUpdatedAt: Date.now(),
            ...(buyerWallet ? { buyerWallet } : {}),
            ...(buyerEmail ? { buyerEmail } : {}),
        };

        if (receipt.crypto === true || receipt.detectedCardFunding === "crypto" || receipt.detectedCardFunding === "us_bank_account") {
            const cfg = receipt.splitRoutingSnapshot || await getSiteConfigForWallet(receipt.wallet, receipt.brandKey);
            if (!cfg?.feeMinusEnabled) updatedReceipt = recalculateReceiptForCardFunding(updatedReceipt, receipt.crypto === true ? "crypto" : receipt.detectedCardFunding, cfg || {});
        }

        await container.items.upsert(updatedReceipt);

        return NextResponse.json({ ok: true, receipt: updatedReceipt });
    } catch (e: any) {
        return NextResponse.json({ error: e?.message || "server_error" }, { status: 500 });
    }
}
