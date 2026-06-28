import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const wallet = String(body.wallet || "").trim().toLowerCase();
    const shop = String(body.shop || "").trim().toLowerCase();

    if (!wallet || !shop) {
      return NextResponse.json(
        { error: "missing_parameters", message: "Wallet address and Shopify shop domain are required." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // 1. Fetch merchant's shop_config
    const { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @w",
        parameters: [{ name: "@w", value: wallet }]
      })
      .fetchAll();

    if (resources.length === 0 || !resources[0].shopify?.accessToken) {
      return NextResponse.json(
        { error: "not_connected", message: "Shopify integration is not configured or connected for this wallet." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const shopDoc = resources[0];
    const accessToken = shopDoc.shopify.accessToken;
    const brandKey = shopDoc.brandKey || "basaltsurge";

    // 2. Fetch products from Shopify
    // We request the limit of 250 products
    const shopifyUrl = `https://${shop}/admin/api/2024-10/products.json?limit=250`;
    console.log(`[Shopify Sync] Pulling product catalog from: ${shopifyUrl}`);
    
    const shopifyRes = await fetch(shopifyUrl, {
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      }
    });

    if (!shopifyRes.ok) {
      const errBody = await shopifyRes.json().catch(() => ({}));
      console.error("[Shopify Sync] Shopify API catalog pull failed:", errBody);
      return NextResponse.json(
        { error: "shopify_api_failed", message: "Shopify API returned an error during catalog retrieval." },
        { status: 502, headers: { "x-correlation-id": correlationId } }
      );
    }

    const data = await shopifyRes.json();
    const shopifyProducts = Array.isArray(data.products) ? data.products : [];

    // 3. Loop and import product variants
    let syncedCount = 0;
    const now = Date.now();

    for (const prod of shopifyProducts) {
      const title = String(prod.title || "").trim();
      const desc = String(prod.body_html || "").trim();
      const imageUrl = prod.images && prod.images.length > 0 ? String(prod.images[0].src) : undefined;
      const category = String(prod.product_type || "").trim();

      const variants = Array.isArray(prod.variants) ? prod.variants : [];
      for (const variant of variants) {
        const sku = String(variant.sku || "").trim() || `shopify_${variant.id}`;
        const name = variant.title === "Default Title" ? title : `${title} - ${variant.title}`;
        const price = Number(variant.price) || 0;
        const stock = variant.inventory_quantity !== undefined ? Number(variant.inventory_quantity) : -1;

        const itemId = `inventory:${wallet}:${variant.id}`;
        const inventoryItem = {
          id: itemId,
          type: "inventory_item",
          wallet,
          sku,
          name,
          priceUsd: price,
          currency: "USD",
          stockQty: stock,
          category: category || undefined,
          description: desc || undefined,
          images: imageUrl ? [imageUrl] : undefined,
          createdAt: now,
          updatedAt: now,
          brandKey: brandKey.toLowerCase(),
          shopifyProductVariantId: String(variant.id),
          shopifyProductId: String(prod.id)
        };

        // Upsert variant to Cosmos DB
        await container.items.upsert(inventoryItem);
        syncedCount++;
      }
    }

    console.log(`[Shopify Sync] Successfully synced ${syncedCount} variants for shop: ${shop}`);

    return NextResponse.json({
      ok: true,
      syncedCount
    }, { headers: { "x-correlation-id": correlationId } });
  } catch (e: any) {
    console.error("[Shopify Sync POST] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Sync execution failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
