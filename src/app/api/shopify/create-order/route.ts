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

    // 2. Parse cart items and ensure they exist in inventory without duplicates
    const { resources: existingItems } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'inventory_item' AND c.wallet = @w",
        parameters: [{ name: "@w", value: wallet }]
      })
      .fetchAll();

    const itemByVariantId = new Map<string, any>();
    const itemBySku = new Map<string, any>();
    const itemById = new Map<string, any>();

    for (const it of existingItems) {
      if (it.id) itemById.set(String(it.id), it);
      if (it.shopifyProductVariantId) itemByVariantId.set(String(it.shopifyProductVariantId), it);
      if (it.sku) itemBySku.set(String(it.sku).trim().toLowerCase(), it);
    }

    const orderItems: Array<{ sku: string; qty: number }> = [];

    for (const cartItem of cart.items) {
      const variantId = String(cartItem.variant_id || cartItem.id || "");
      const rawSku = String(cartItem.sku || "").trim();
      const canonicalSku = rawSku || (variantId ? `shopify_${variantId}` : `shopify_${Date.now()}`);
      const qty = Math.max(1, Number(cartItem.quantity) || 1);

      // Check if item already exists by variant ID, SKU, or deterministic ID
      const deterministicId = variantId ? `inventory:${wallet}:${variantId}` : `inventory:${wallet}:${canonicalSku}`;
      const existing = (variantId ? itemByVariantId.get(variantId) : null) ||
                       (rawSku ? itemBySku.get(rawSku.toLowerCase()) : null) ||
                       itemById.get(deterministicId);

      if (existing) {
        orderItems.push({
          sku: existing.sku || canonicalSku,
          qty
        });
      } else {
        const now = Date.now();
        const variantTitle = cartItem.variant_title && cartItem.variant_title !== "Default Title" ? ` - ${cartItem.variant_title}` : "";
        const productName = `${cartItem.product_title || cartItem.title || "Product"}${variantTitle}`;
        const priceUsd = Number(cartItem.price) / 100;
        const imageUrl = cartItem.image ? String(cartItem.image) : undefined;

        const newInventoryDoc = {
          id: deterministicId,
          type: "inventory_item",
          wallet,
          sku: canonicalSku,
          name: productName,
          priceUsd,
          currency: "USD" as const,
          stockQty: -1,
          images: imageUrl ? [imageUrl] : undefined,
          createdAt: now,
          updatedAt: now,
          brandKey: brandKey.toLowerCase(),
          shopifyProductVariantId: variantId || undefined,
          shopifyProductId: cartItem.product_id ? String(cartItem.product_id) : undefined
        };

        await container.items.upsert(newInventoryDoc);

        if (variantId) itemByVariantId.set(variantId, newInventoryDoc);
        if (canonicalSku) itemBySku.set(canonicalSku.toLowerCase(), newInventoryDoc);
        itemById.set(deterministicId, newInventoryDoc);

        orderItems.push({
          sku: canonicalSku,
          qty
        });
        console.log(`[Shopify Create Order] Auto-provisioned item ${canonicalSku} (${productName}) for wallet ${wallet}`);
      }
    }

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
        items: orderItems,
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
