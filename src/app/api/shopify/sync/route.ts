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
    const direction = String(body.direction || "push").trim().toLowerCase(); // "push" (Shopify -> Surge) or "pull" (Surge -> Shopify)

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
    const now = Date.now();

    // ─── DIRECTION: PUSH (Shopify -> Surge) ───
    if (direction === "push") {
      const shopifyUrl = `https://${shop}/admin/api/2024-10/products.json?limit=250`;
      console.log(`[Shopify Sync] Pushing from Shopify to Surge catalog: ${shopifyUrl}`);
      
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
      let syncedCount = 0;

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

          await container.items.upsert(inventoryItem);
          syncedCount++;
        }
      }

      return NextResponse.json({
        ok: true,
        direction,
        syncedCount
      }, { headers: { "x-correlation-id": correlationId } });
    }

    // ─── DIRECTION: PULL (Surge -> Shopify) ───
    if (direction === "pull") {
      console.log(`[Shopify Sync] Pulling from Surge to Shopify catalog for wallet: ${wallet}`);

      let items: any[] = [];
      const apiKey = shopDoc.shopify?.apiKey;

      if (apiKey) {
        console.log(`[Shopify Sync] Fetching inventory from live Surge API for wallet: ${wallet}`);
        try {
          const surgeRes = await fetch("https://surge.basalthq.com/api/inventory", {
            headers: {
              "x-api-key": apiKey,
              "Accept": "application/json"
            }
          });
          if (surgeRes.ok) {
            const data = await surgeRes.json();
            items = Array.isArray(data.items) ? data.items : [];
          } else {
            console.error(`[Shopify Sync] Live Surge API inventory fetch failed with status ${surgeRes.status}`);
          }
        } catch (fetchErr) {
          console.error("[Shopify Sync] Failed to fetch inventory from live Surge API:", fetchErr);
        }
      }

      // Fallback to local DB if live API fetch was empty or failed
      if (items.length === 0) {
        console.log(`[Shopify Sync] Falling back to local DB query for wallet: ${wallet}`);
        const { resources } = await container.items
          .query({
            query: "SELECT * FROM c WHERE c.type = 'inventory_item' AND c.wallet = @w",
            parameters: [{ name: "@w", value: wallet }]
          })
          .fetchAll();
        items = resources;
      }

      if (items.length === 0) {
        return NextResponse.json({
          ok: true,
          direction,
          syncedCount: 0,
          message: "No inventory items found on Surge to synchronize."
        });
      }

      let syncedCount = 0;

      for (const item of items) {
        const itemImages = Array.isArray(item.images) && item.images.length > 0
          ? item.images.map((img: string) => {
              const src = img.startsWith("http") ? img : `https://surge.basalthq.com${img.startsWith("/") ? "" : "/"}${img}`;
              return { src };
            })
          : undefined;

        const payload = {
          product: {
            title: item.name,
            body_html: item.description || "",
            product_type: item.category || "",
            images: itemImages,
            variants: [
              {
                sku: item.sku,
                price: String(item.priceUsd),
                inventory_management: item.stockQty !== -1 ? "shopify" : undefined
              }
            ]
          }
        };

        let shopifyProduct: any = null;

        // Try updating existing product if references exist
        if (item.shopifyProductId) {
          const putUrl = `https://${shop}/admin/api/2024-10/products/${item.shopifyProductId}.json`;
          try {
            const putRes = await fetch(putUrl, {
              method: "PUT",
              headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                product: {
                  id: Number(item.shopifyProductId),
                  title: item.name,
                  body_html: item.description || "",
                  product_type: item.category || "",
                  images: itemImages
                }
              })
            });

            if (putRes.ok) {
              const resData = await putRes.json();
              shopifyProduct = resData.product;
            }
          } catch (err) {
            console.warn(`[Shopify Sync] Failed to update product ${item.shopifyProductId}, falling back to create:`, err);
          }
        }

        // If no existing product or update failed, create a new one
        if (!shopifyProduct) {
          const postUrl = `https://${shop}/admin/api/2024-10/products.json`;
          const postRes = await fetch(postUrl, {
            method: "POST",
            headers: {
              "X-Shopify-Access-Token": accessToken,
              "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
          });

          if (postRes.ok) {
            const resData = await postRes.json();
            shopifyProduct = resData.product;
            
            // Save the newly created Shopify IDs back to Surge database document
            item.shopifyProductId = String(shopifyProduct.id);
            if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
              item.shopifyProductVariantId = String(shopifyProduct.variants[0].id);
            }
            item.updatedAt = Date.now();
            await container.items.upsert(item);
          } else {
            const errBody = await postRes.json().catch(() => ({}));
            console.error(`[Shopify Sync] Failed to create product in Shopify for SKU ${item.sku}:`, errBody);
          }
        }

        if (shopifyProduct) {
          syncedCount++;
        }
      }

      return NextResponse.json({
        ok: true,
        direction,
        syncedCount
      }, { headers: { "x-correlation-id": correlationId } });
    }

    return NextResponse.json(
      { error: "invalid_direction", message: "Invalid synchronization direction specified." },
      { status: 400, headers: { "x-correlation-id": correlationId } }
    );
  } catch (e: any) {
    console.error("[Shopify Sync POST] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Sync execution failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
