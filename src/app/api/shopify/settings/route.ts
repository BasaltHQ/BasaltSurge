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

    if (!shopConfig) {
      return NextResponse.json({
        ok: true,
        connected: false,
        message: "No connected merchant profile found."
      });
    }

    // Check if there is a pending oauth token for this store that needs completion
    let hasPendingToken = false;
    if (shop) {
      const pendingDocId = `shopify_pending_auth:${shop}`;
      const { resources } = await container.items
        .query({
          query: "SELECT VALUE COUNT(1) FROM c WHERE c.id = @id",
          parameters: [{ name: "@id", value: pendingDocId }]
        })
        .fetchAll();
      hasPendingToken = resources[0] > 0;
    }

    return NextResponse.json({
      ok: true,
      connected: !!shopConfig.shopify?.accessToken,
      hasPendingToken,
      config: {
        shop: shopConfig.shopify?.shop || shop || "",
        apiKey: shopConfig.shopify?.apiKey || "",
        syncInventory: shopConfig.shopify?.syncInventory ?? true,
        syncOrders: shopConfig.shopify?.syncOrders ?? true,
        enabled: shopConfig.shopify?.enabled ?? false,
        buttonLabel: shopConfig.shopify?.buttonLabel || "Pay with Crypto",
        minTotal: shopConfig.shopify?.minTotal ?? 0
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
        { error: "invalid_api_key", message: "Invalid API Key. Please make sure the key is active and generated from your PortalPay dashboard." },
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
      const { resource: pending } = await container.item(pendingDocId, brandKey).read<any>();
      if (pending?.accessToken) {
        accessToken = pending.accessToken;
        brandKey = pending.brandKey || brandKey;
        // Clean up pending document
        await container.item(pendingDocId, brandKey).delete();
      }
    } catch {
      // Fallback to existing token
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "oauth_required", message: "OAuth authorization is missing. Please uninstall and reinstall the Shopify app." },
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

    // 7. Save Shopify connection parameters
    shopDoc.shopify = {
      shop,
      accessToken,
      apiKey,
      enabled: true,
      buttonLabel: "Pay with Crypto",
      minTotal: 0,
      syncInventory: true,
      syncOrders: true,
      updatedAt: now
    };

    if (!shopDoc.brandKey) {
      shopDoc.brandKey = brandKey;
    }

    await container.items.upsert(shopDoc);
    console.log(`[Shopify Settings] Linked shop ${shop} to wallet ${wallet}`);

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
