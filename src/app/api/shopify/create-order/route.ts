import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const cart = body.cart || {};
    const shop = String(body.shop || "").trim().toLowerCase();
    const domain = String(body.domain || "").trim().toLowerCase();

    if (!shop || !cart || !cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
      return NextResponse.json(
        { error: "invalid_payload", message: "Shop domain and valid cart items are required." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // 1. Find the merchant configuration by Shopify shop domain
    let { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND (LOWER(c.shopify.shop) = @s OR LOWER(c.customDomain) = @d)",
        parameters: [
          { name: "@s", value: shop },
          { name: "@d", value: domain || shop }
        ]
      })
      .fetchAll();

    // Fallback: search by shop suffix if not fully matched
    if (resources.length === 0) {
      const cleanShop = shop.replace(".myshopify.com", "");
      const { resources: fallbackRes } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.type = 'shop_config' AND CONTAINS(LOWER(c.shopify.shop), @s)",
          parameters: [{ name: "@s", value: cleanShop }]
        })
        .fetchAll();
      resources = fallbackRes;
    }

    if (resources.length === 0) {
      return NextResponse.json(
        { error: "shop_not_configured", message: `Shop '${shop}' is not linked to any merchant profile on this platform.` },
        { status: 404, headers: { "x-correlation-id": correlationId } }
      );
    }

    const shopDoc = resources[0];
    const wallet = shopDoc.wallet;
    const brandKey = shopDoc.brandKey || "basaltsurge";
    const displayName = brandKey.toLowerCase() === "portalpay" ? "PortalPay" : "BasaltSurge";
    const brandName = shopDoc.name || `${displayName} Store`;

    // 2. Parse cart items
    const lineItems = cart.items.map((item: any) => {
      const variantTitle = item.variant_title ? ` - ${item.variant_title}` : "";
      return {
        sku: item.sku || `shopify_${item.variant_id}`,
        label: `${item.product_title || item.title || "Product"}${variantTitle}`,
        priceUsd: Number(item.price) / 100, // Shopify prices are in cents
        qty: Math.max(1, Number(item.quantity) || 1)
      };
    });

    // Compute total price (Shopify total_price is in cents)
    const totalUsd = Number(cart.total_price || 0) / 100;
    if (totalUsd <= 0) {
      return NextResponse.json(
        { error: "invalid_total", message: "Cart total must be greater than zero." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // 3. Resolve fee splits (Standard platform calculations)
    const now = Date.now();
    const id = crypto.randomUUID().replace(/\-/g, "").slice(0, 16);
    const docId = `receipt:${id}`;

    // Standard fee defaults
    const grossMinor = Math.round(totalUsd * 100);
    const platformFeeBps = 50; // 0.5% default platform fee
    const amountPlatformMinor = Math.round((grossMinor * platformFeeBps) / 10000);
    const amountMerchantMinor = grossMinor - amountPlatformMinor;

    const returnUrl = `https://${shop}/cart/clear?return_to=${encodeURIComponent("/")}`;

    // 4. Construct receipt doc
    const receiptDoc = {
      id: docId,
      type: "receipt",
      wallet,
      receiptId: id,
      totalUsd,
      currency: "USD",
      lineItems,
      createdAt: now,
      brandKey: brandKey.toLowerCase(),
      brandName,
      status: "pending",
      statusHistory: [{ status: "pending", ts: now }],
      paymentMethod: "stripe_headless", // eCommerce checkout mode
      shopifyShop: shop,
      ttl: 3600, // Expires in 1h if unpaid
      redirectUrl: returnUrl,
      returnUrl,
      grossMinor,
      platformFeeBps,
      partnerFeeBps: 0,
      agentFeeBps: 0,
      merchantFeeBps: 0,
      amountPlatformMinor,
      amountPartnerMinor: 0,
      amountAgentMinor: 0,
      amountMerchantMinor,
      effectiveProcessingFeeBps: platformFeeBps
    };

    // 5. Persist in Cosmos DB
    await container.items.upsert(receiptDoc);
    console.log(`[Shopify Create Order] Registered pending receipt ${id} for shop ${shop} (amount: ${totalUsd} USD)`);

    // 6. Return payment landing page URL
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const paymentUrl = `${hostUrl.replace(/\/$/, "")}/portal/${id}`;

    return NextResponse.json({
      ok: true,
      receiptId: id,
      paymentUrl
    }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    console.error("[Shopify Create Order POST] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Failed to create checkout order" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
