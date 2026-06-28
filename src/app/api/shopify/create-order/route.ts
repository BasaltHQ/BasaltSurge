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

    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const returnUrl = `https://${shop}/cart/clear?return_to=${encodeURIComponent("/")}`;

    // Call /api/orders
    const ordersUrl = `${hostUrl.replace(/\/$/, "")}/api/orders`;
    const ordersRes = await fetch(ordersUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wallet": wallet,
        "x-correlation-id": correlationId
      },
      body: JSON.stringify({
        items: cart.items.map((item: any) => ({
          sku: item.sku || `shopify_${item.variant_id}`,
          qty: Math.max(1, Number(item.quantity) || 1)
        })),
        redirectUrl: returnUrl,
        returnUrl: returnUrl,
        brandKey: brandKey.toLowerCase(),
        paymentMethod: "stripe_headless",
        source: "shopify",
        shopifyShop: shop,
        ttl: 3600
      })
    });

    if (!ordersRes.ok) {
      const errText = await ordersRes.text();
      throw new Error(`Orders API returned status ${ordersRes.status}: ${errText}`);
    }

    const ordersData = await ordersRes.json();
    if (!ordersData.ok || !ordersData.portalLink) {
      throw new Error(ordersData.message || "Failed to generate portalLink from orders API");
    }

    const receiptId = ordersData.receipt?.receiptId || ordersData.receiptId;
    const paymentUrl = ordersData.portalLink;

    console.log(`[Shopify Create Order] Successfully generated checkout order ${receiptId} via Orders API`);

    return NextResponse.json({
      ok: true,
      receiptId,
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
