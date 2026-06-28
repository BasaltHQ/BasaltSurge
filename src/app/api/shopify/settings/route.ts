import { NextRequest, NextResponse } from "next/server";
import { getContainer } from "@/lib/cosmos";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";

// Helper to fetch registered ScriptTags from Shopify
async function getScriptTags(shop: string, token: string): Promise<any[]> {
  try {
    const res = await fetch(`https://${shop}/admin/api/2024-10/script_tags.json`, {
      headers: { "X-Shopify-Access-Token": token }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.script_tags) ? data.script_tags : [];
  } catch {
    return [];
  }
}

// Helper to register ScriptTag on Shopify
async function registerScriptTag(shop: string, token: string, src: string): Promise<boolean> {
  try {
    const tags = await getScriptTags(shop, token);
    const exists = tags.some((t: any) => t.src === src);
    if (exists) return true; // Already registered

    const res = await fetch(`https://${shop}/admin/api/2024-10/script_tags.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        script_tag: {
          event: "onload",
          src
        }
      })
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Helper to remove ScriptTag from Shopify
async function deregisterScriptTag(shop: string, token: string, src: string): Promise<boolean> {
  try {
    const tags = await getScriptTags(shop, token);
    const matched = tags.filter((t: any) => t.src === src);
    if (matched.length === 0) return true; // Already gone

    let ok = true;
    for (const tag of matched) {
      const res = await fetch(`https://${shop}/admin/api/2024-10/script_tags/${tag.id}.json`, {
        method: "DELETE",
        headers: { "X-Shopify-Access-Token": token }
      });
      if (!res.ok) ok = false;
    }
    return ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const url = new URL(req.url);
    const shop = String(url.searchParams.get("shop") || "").trim().toLowerCase();
    const wallet = String(url.searchParams.get("wallet") || "").trim().toLowerCase();

    if (!shop && !wallet) {
      return NextResponse.json(
        { error: "missing_parameters", message: "Either shop or wallet query parameter must be provided." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();
    let shopConfig: any = null;

    if (wallet) {
      // Find shop configuration matching merchant wallet
      const { resources } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @w",
          parameters: [{ name: "@w", value: wallet }]
        })
        .fetchAll();
      if (resources.length > 0) shopConfig = resources[0];
    } else {
      // Find shop configuration matching shopify store domain
      const { resources } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.shopify.shop) = @s",
          parameters: [{ name: "@s", value: shop }]
        })
        .fetchAll();
      if (resources.length > 0) shopConfig = resources[0];
    }

    // Check if there is a pending oauth token for this store that needs completion
    let hasPendingToken = false;
    if (shop) {
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
          if (pending?.accessToken && shopConfig) {
            // Auto-merge the new access token into the shop config
            if (!shopConfig.shopify) {
              shopConfig.shopify = {};
            }
            shopConfig.shopify.accessToken = pending.accessToken;
            shopConfig.shopify.shop = shop;
            shopConfig.shopify.updatedAt = Date.now();

            await container.items.upsert(shopConfig);
            console.log(`[Shopify Settings GET] Auto-merged pending access token for shop: ${shop}`);

            // Clean up the pending document
            const pk = pending.wallet || pending.brandKey;
            try {
              await container.item(pendingDocId, undefined).delete();
            } catch {}
            if (pk) {
              try {
                await container.item(pendingDocId, pk).delete();
              } catch {}
            }
            hasPendingToken = false;
          } else {
            hasPendingToken = true;
          }
        }
      } catch (e) {
        console.error("[Shopify Settings GET] Failed to retrieve/merge pending token:", e);
      }
    }

    if (!shopConfig) {
      return NextResponse.json({
        ok: true,
        connected: false,
        hasPendingToken,
        message: "No connected merchant profile found."
      });
    }

    const walletAddr = shopConfig.wallet;
    const brandKey = shopConfig.brandKey || "basaltsurge";
    let siteConfig: any = null;
    if (walletAddr) {
      const targetDocId = `site:config:${brandKey.toLowerCase()}`;
      const { resources: siteConfigs } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.type = 'site_config' AND c.id = @id AND LOWER(c.wallet) = @w",
          parameters: [
            { name: "@id", value: targetDocId },
            { name: "@w", value: walletAddr.toLowerCase() }
          ]
        })
        .fetchAll();
      if (siteConfigs.length > 0) {
        siteConfig = siteConfigs[0];
      }
    }

    let surgeItemsCount = 0;
    let shopifyItemsCount = 0;

    if (walletAddr) {
      try {
        const { resources: r1 } = await container.items
          .query({
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'inventory_item' AND c.wallet = @w",
            parameters: [{ name: "@w", value: walletAddr.toLowerCase() }]
          })
          .fetchAll();
        surgeItemsCount = r1[0] || 0;

        const { resources: r2 } = await container.items
          .query({
            query: "SELECT VALUE COUNT(1) FROM c WHERE c.type = 'inventory_item' AND c.wallet = @w AND IS_DEFINED(c.shopifyProductId)",
            parameters: [{ name: "@w", value: walletAddr.toLowerCase() }]
          })
          .fetchAll();
        shopifyItemsCount = r2[0] || 0;
      } catch (countErr) {
        console.error("[Shopify Settings GET] Failed to fetch inventory counts:", countErr);
      }
    }

    return NextResponse.json({
      ok: true,
      connected: !!shopConfig.shopify?.accessToken,
      hasPendingToken,
      surgeItemsCount,
      shopifyItemsCount,
      lastSyncTime: shopConfig.shopify?.updatedAt || null,
      config: {
        wallet: shopConfig.wallet,
        shop: shopConfig.shopify?.shop || shop || "",
        apiKey: shopConfig.shopify?.apiKey || "",
        syncInventory: shopConfig.shopify?.syncInventory ?? true,
        syncOrders: shopConfig.shopify?.syncOrders ?? true,
        enabled: shopConfig.shopify?.enabled ?? false,
        buttonLabel: shopConfig.shopify?.buttonLabel || "Pay with Crypto",
        minTotal: shopConfig.shopify?.minTotal ?? 0,
        theme: shopConfig.theme || null,
        defaultPaymentToken: siteConfig?.defaultPaymentToken || "USDC",
        processingFeePct: siteConfig?.processingFeePct ?? 0,
        currencySelectionEnabled: siteConfig?.currencySelectionEnabled !== false,
        tippingEnabled: siteConfig?.tipConfig?.enabled ?? false
      }
    });
  } catch (e: any) {
    console.error("[Shopify Settings GET] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Failed to retrieve settings" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}

export async function POST(req: NextRequest) {
  const correlationId = crypto.randomUUID();
  try {
    const body = await req.json().catch(() => ({}));
    const shop = String(body.shop || "").trim().toLowerCase();
    const apiKey = String(body.apiKey || "").trim();
    const action = String(body.action || "").trim(); // "save" or "disconnect"

    if (!shop) {
      return NextResponse.json(
        { error: "missing_parameters", message: "Shopify shop domain is required." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // 1. Handle Disconnect Action
    if (action === "disconnect") {
      // Find shop configuration matching shopify store domain
      const { resources } = await container.items
        .query({
          query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.shopify.shop) = @s",
          parameters: [{ name: "@s", value: shop }]
        })
        .fetchAll();

      if (resources.length > 0) {
        const shopDoc = resources[0];
        const accessToken = shopDoc.shopify?.accessToken;
        
        // Remove ScriptTag from Shopify if connected
        if (accessToken) {
          const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
          const scriptSrc = `${hostUrl.replace(/\/$/, "")}/js/shopify-cart-hijack.js`;
          await deregisterScriptTag(shop, accessToken, scriptSrc);
        }

        // Reset Shopify fields
        shopDoc.shopify = null;
        await container.items.upsert(shopDoc);
      }

      console.log(`[Shopify Settings] Disconnected shop: ${shop}`);
      return NextResponse.json({ ok: true, connected: false });
    }

    // 2. Validate API Key Input
    if (!apiKey) {
      return NextResponse.json(
        { error: "api_key_required", message: "API Key is required to enable payments." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const bodyBrandKey = String(body.brandKey || "").trim().toLowerCase();
    const brandKeyResolved = bodyBrandKey || "basaltsurge";
    const displayName = brandKeyResolved === "portalpay" ? "PortalPay" : "BasaltSurge";

    // 3. Resolve wallet address from API Key hash lookup
    const keyHash = crypto.createHash("sha256").update(apiKey).digest("hex");
    const { resources: keyDocs } = await container.items
      .query({
        query: "SELECT TOP 1 c.wallet FROM c WHERE c.type = 'api_key' AND c.keyHash = @hash AND c.isActive = true",
        parameters: [{ name: "@hash", value: keyHash }]
      })
      .fetchAll();

    if (keyDocs.length === 0) {
      return NextResponse.json(
        { error: "invalid_api_key", message: `Invalid API Key. Please make sure the key is active and generated from your ${displayName} dashboard.` },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const wallet = keyDocs[0].wallet.toLowerCase();

    // 4. Find or Create shop_config document for this merchant wallet
    const { resources: shopDocs } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @w",
        parameters: [{ name: "@w", value: wallet }]
      })
      .fetchAll();

    let shopDoc: any = null;
    const now = Date.now();
    
    if (shopDocs.length > 0) {
      shopDoc = shopDocs[0];
    } else {
      // Auto-create shop config to ease onboarding if not already present
      shopDoc = {
        id: `shop_config:${wallet}`,
        type: "shop_config",
        wallet,
        name: "Shopify Store",
        slug: shop.replace(".myshopify.com", ""),
        createdAt: now,
        updatedAt: now
      };
    }

    let accessToken = shopDoc.shopify?.accessToken || "";
    let brandKey = shopDoc.brandKey || "basaltsurge";

    // 5. Retrieve pending OAuth access token if available
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
          brandKey = pending.brandKey || brandKey;
          // Clean up pending document. Try both with and without partition key to ensure it is cleared.
          const pk = pending.wallet || pending.brandKey || brandKey;
          try {
            await container.item(pendingDocId, undefined).delete();
          } catch (delErr) {}
          try {
            await container.item(pendingDocId, pk).delete();
          } catch (delErr) {}
        }
      }
    } catch (e) {
      console.error("[Shopify Settings] Failed to retrieve pending oauth token:", e);
    }

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "oauth_required",
          message: "OAuth authorization is missing. Please uninstall and reinstall the Shopify app.",
          debug: {
            shop,
            pendingDocId,
            resolvedBrandKey: brandKey,
            shopDocExists: !!shopDoc,
            shopDocBrandKey: shopDoc?.brandKey || null,
            shopDocWallet: shopDoc?.wallet || null,
            shopifyConfig: shopDoc?.shopify || null
          }
        },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // 6. Register Cart Redirection ScriptTag
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const scriptSrc = `${hostUrl.replace(/\/$/, "")}/js/shopify-cart-hijack.js`;

    const scriptOk = await registerScriptTag(shop, accessToken, scriptSrc);
    if (!scriptOk) {
      console.warn(`[Shopify Settings] Failed to register checkout script tag on ${shop}`);
    }

    const syncInventory = typeof body.syncInventory === "boolean" ? body.syncInventory : true;
    const syncOrders = typeof body.syncOrders === "boolean" ? body.syncOrders : true;
    const buttonLabel = typeof body.buttonLabel === "string" ? body.buttonLabel : "Pay with Crypto";
    const minTotal = typeof body.minTotal === "number" ? body.minTotal : 0;

    // 7. Save Shopify connection parameters
    shopDoc.shopify = {
      shop,
      accessToken,
      apiKey,
      enabled: true,
      buttonLabel,
      minTotal,
      syncInventory,
      syncOrders,
      updatedAt: now
    };

    if (!shopDoc.brandKey) {
      shopDoc.brandKey = brandKey;
    }

    await container.items.upsert(shopDoc);
    console.log(`[Shopify Settings] Linked shop ${shop} to wallet ${wallet}`);

    // 8. Update merchant's site_config document for reserve parameters
    const targetDocId = `site:config:${brandKey.toLowerCase()}`;
    const { resources: siteConfigs } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'site_config' AND c.id = @id AND LOWER(c.wallet) = @w",
        parameters: [
          { name: "@id", value: targetDocId },
          { name: "@w", value: wallet.toLowerCase() }
        ]
      })
      .fetchAll();

    let siteDoc = siteConfigs.length > 0 ? siteConfigs[0] : null;
    const siteDocId = siteDoc?.id || targetDocId;
    
    if (!siteDoc) {
      siteDoc = {
        id: siteDocId,
        type: "site_config",
        wallet: wallet,
        createdAt: now,
        brandKey: brandKey.toLowerCase()
      };
    }

    siteDoc.defaultPaymentToken = typeof body.defaultPaymentToken === "string" ? body.defaultPaymentToken : (siteDoc.defaultPaymentToken || "USDC");
    siteDoc.processingFeePct = typeof body.processingFeePct === "number" ? body.processingFeePct : (siteDoc.processingFeePct ?? 0);
    siteDoc.currencySelectionEnabled = typeof body.currencySelectionEnabled === "boolean" ? body.currencySelectionEnabled : (siteDoc.currencySelectionEnabled !== false);
    
    if (typeof body.tippingEnabled === "boolean") {
      if (!siteDoc.tipConfig) {
        siteDoc.tipConfig = { enabled: false, allowCustom: true, presets: [15, 18, 20], defaultTip: null };
      }
      siteDoc.tipConfig.enabled = body.tippingEnabled;
    }
    
    siteDoc.updatedAt = now;
    await container.items.upsert(siteDoc);
    console.log(`[Shopify Settings] Updated site_config for wallet ${wallet}`);

    return NextResponse.json({
      ok: true,
      connected: true,
      config: shopDoc.shopify
    });
  } catch (e: any) {
    console.error("[Shopify Settings POST] Error:", e);
    return NextResponse.json(
      { error: "failed", message: e?.message || "Settings save failed" },
      { status: 500, headers: { "x-correlation-id": correlationId } }
    );
  }
}
