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
    let accessToken = shopDoc.shopify.accessToken;
    const brandKey = shopDoc.brandKey || "basaltsurge";

    // Check if there is a pending OAuth token that needs to be merged
    const pendingDocId = `shopify_pending_auth:${shop}`;
    try {
      const { resources: pendings } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.id = @id",
          parameters: [{ name: "@id", value: pendingDocId }]
        })
        .fetchAll();

      if (pendings.length > 0) {
        const pending = pendings[0];
        if (pending?.accessToken) {
          accessToken = pending.accessToken;
          shopDoc.shopify.accessToken = accessToken;
          shopDoc.shopify.updatedAt = Date.now();
          await container.items.upsert(shopDoc);
          console.log(`[Shopify Sync] Auto-merged pending access token for shop: ${shop}`);
          
          // Clean up pending document
          const pk = pending.wallet || pending.brandKey || brandKey;
          try {
            await container.item(pendingDocId, undefined).delete();
          } catch {}
          try {
            await container.item(pendingDocId, pk).delete();
          } catch {}
        }
      }
    } catch (e) {
      console.warn("[Shopify Sync] Failed to retrieve/merge pending token:", e);
    }

    const now = Date.now();
    const encoder = new TextEncoder();
    const transformStream = new TransformStream();
    const writer = transformStream.writable.getWriter();

    // Run the background work
    (async () => {
      let syncedCount = 0;
      try {
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
            throw new Error(`Shopify API catalog pull failed: ${JSON.stringify(errBody)}`);
          }

          const data = await shopifyRes.json();
          const shopifyProducts = Array.isArray(data.products) ? data.products : [];
          
          // Flatten variants to sync
          const itemsToSync: any[] = [];
          for (const prod of shopifyProducts) {
            const title = String(prod.title || "").trim();
            const desc = String(prod.body_html || "").trim();
            const imageUrl = prod.images && prod.images.length > 0 ? String(prod.images[0].src) : undefined;
            const category = String(prod.product_type || "").trim();
            const variants = Array.isArray(prod.variants) ? prod.variants : [];
            for (const variant of variants) {
              itemsToSync.push({ prod, variant, title, desc, imageUrl, category });
            }
          }

          // Pre-fetch all existing inventory items from local DB for this wallet to check for duplicates
          const { resources: existingDbItems } = await container.items
            .query({
              query: "SELECT * FROM c WHERE c.type = 'inventory_item' AND c.wallet = @w",
              parameters: [{ name: "@w", value: wallet }]
            })
            .fetchAll();

          const dbItemMapByVariantId = new Map<string, any>();
          const dbItemMapBySku = new Map<string, any>();

          for (const item of existingDbItems) {
            if (item.shopifyProductVariantId) {
              dbItemMapByVariantId.set(String(item.shopifyProductVariantId), item);
            }
            if (item.sku) {
              dbItemMapBySku.set(String(item.sku).trim().toLowerCase(), item);
            }
          }

          const total = itemsToSync.length;
          await writer.write(encoder.encode(JSON.stringify({ type: "start", total }) + "\n"));

          let current = 0;
          for (const itemToSync of itemsToSync) {
            const { prod, variant, title, desc, imageUrl, category } = itemToSync;
            const sku = String(variant.sku || "").trim();
            const name = variant.title === "Default Title" ? title : `${title} - ${variant.title}`;
            const price = Number(variant.price) || 0;
            const stock = variant.inventory_quantity !== undefined ? Number(variant.inventory_quantity) : -1;

            // Check if item is already in DB by variant ID or by SKU
            const existingItem = dbItemMapByVariantId.get(String(variant.id)) || 
                                 (sku ? dbItemMapBySku.get(sku.toLowerCase()) : null);

            const itemId = existingItem ? existingItem.id : `inventory:${wallet}:${variant.id}`;
            const inventoryItem = {
              ...(existingItem || {}), // Preserve other custom fields if existing
              id: itemId,
              type: "inventory_item",
              wallet,
              sku: sku || `shopify_${variant.id}`,
              name,
              priceUsd: price,
              currency: "USD" as const,
              stockQty: stock,
              category: category || undefined,
              description: desc || undefined,
              images: imageUrl ? [imageUrl] : (existingItem?.images || undefined),
              createdAt: existingItem ? (existingItem.createdAt || now) : now,
              updatedAt: now,
              brandKey: brandKey.toLowerCase(),
              shopifyProductVariantId: String(variant.id),
              shopifyProductId: String(prod.id)
            };

            await container.items.upsert(inventoryItem);
            syncedCount++;
            current++;
            
            await writer.write(encoder.encode(JSON.stringify({ type: "progress", current, total }) + "\n"));
          }

          // Update updatedAt in shopConfig.shopify
          shopDoc.shopify.updatedAt = Date.now();
          await container.items.upsert(shopDoc);

          await writer.write(encoder.encode(JSON.stringify({ type: "complete", syncedCount, direction }) + "\n"));

        } else if (direction === "pull") {
          // Get all inventory items from Surge
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

          // Fetch all products from Shopify to build a map of SKUs already on Shopify
          const shopifySkuMap = new Map<string, { productId: string, variantId: string }>();
          try {
            const fetchProductsUrl = `https://${shop}/admin/api/2024-10/products.json?limit=250`;
            const shopifyProductsRes = await fetch(fetchProductsUrl, {
              headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json"
              }
            });
            if (shopifyProductsRes.ok) {
              const prodData = await shopifyProductsRes.json();
              const prods = Array.isArray(prodData.products) ? prodData.products : [];
              for (const p of prods) {
                const variants = Array.isArray(p.variants) ? p.variants : [];
                for (const v of variants) {
                  if (v.sku) {
                    shopifySkuMap.set(String(v.sku).trim().toLowerCase(), {
                      productId: String(p.id),
                      variantId: String(v.id)
                    });
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[Shopify Sync Pull] Failed to pre-fetch Shopify products for SKU mapping:", err);
          }

          const total = items.length;
          await writer.write(encoder.encode(JSON.stringify({ type: "start", total }) + "\n"));

          let current = 0;
          for (const item of items) {
            // Check if item has a SKU and is not already linked
            if (!item.shopifyProductId && item.sku) {
              const existingShopify = shopifySkuMap.get(String(item.sku).trim().toLowerCase());
              if (existingShopify) {
                item.shopifyProductId = existingShopify.productId;
                item.shopifyProductVariantId = existingShopify.variantId;
                
                // Link the item in local DB
                item.updatedAt = Date.now();
                await container.items.upsert(item);
                console.log(`[Shopify Sync Pull] SKU Match found: Linked Surge item ${item.sku} to Shopify Product ${existingShopify.productId}`);
              }
            }
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
                    inventory_management: item.stockQty !== -1 ? "shopify" : null
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
                      images: itemImages,
                      variants: item.shopifyProductVariantId ? [
                        {
                          id: Number(item.shopifyProductVariantId),
                          price: String(item.priceUsd),
                          sku: item.sku,
                          inventory_management: item.stockQty !== -1 ? "shopify" : null
                        }
                      ] : undefined
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
            current++;
            
            await writer.write(encoder.encode(JSON.stringify({ type: "progress", current, total }) + "\n"));
          }

          // Update updatedAt in shopConfig.shopify
          shopDoc.shopify.updatedAt = Date.now();
          await container.items.upsert(shopDoc);

          await writer.write(encoder.encode(JSON.stringify({ type: "complete", syncedCount, direction }) + "\n"));
        } else {
          throw new Error("Invalid synchronization direction specified.");
        }
      } catch (err: any) {
        console.error("[Shopify Sync POST] Background error:", err);
        await writer.write(encoder.encode(JSON.stringify({ type: "error", message: err.message || "Sync execution failed" }) + "\n"));
      } finally {
        await writer.close();
      }
    })();

    return new NextResponse(transformStream.readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "x-correlation-id": correlationId
      }
    });
  } catch (e: any) {
    console.error("[Shopify Sync POST] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Sync execution failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
