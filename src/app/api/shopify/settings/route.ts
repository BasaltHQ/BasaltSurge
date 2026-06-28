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
    const wallet = String(body.wallet || "").trim().toLowerCase();
    const shop = String(body.shop || "").trim().toLowerCase();
    const apiKey = String(body.apiKey || "").trim();
    const syncInventory = body.syncInventory !== false;
    const syncOrders = body.syncOrders !== false;
    const enabled = body.enabled === true;
    const buttonLabel = String(body.buttonLabel || "Pay with Crypto").trim().slice(0, 64);
    const minTotal = Math.max(0, Number(body.minTotal) || 0);

    if (!wallet || !shop) {
      return NextResponse.json(
        { error: "missing_parameters", message: "Wallet address and Shopify shop domain are required." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const container = await getContainer();

    // 1. Find merchant's shop_config document
    const { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.wallet) = @w",
        parameters: [{ name: "@w", value: wallet }]
      })
      .fetchAll();

    if (resources.length === 0) {
      return NextResponse.json(
        { error: "merchant_profile_missing", message: "No merchant shop configuration found. Please create a storefront profile first." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    const shopDoc = resources[0];
    let accessToken = shopDoc.shopify?.accessToken || "";
    let brandKey = shopDoc.brandKey || "basaltsurge";

    // 2. Retrieve pending oauth token if available
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
      // No pending document, fallback to existing token
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "oauth_required", message: "Please install the app in Shopify first to authorize access." },
        { status: 400, headers: { "x-correlation-id": correlationId } }
      );
    }

    // 3. Register or Remove Shopify ScriptTag
    const hostUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${req.headers.get("host")}`;
    const scriptSrc = `${hostUrl.replace(/\/$/, "")}/js/shopify-cart-hijack.js`;

    let scriptOk = false;
    if (enabled) {
      scriptOk = await registerScriptTag(shop, accessToken, scriptSrc);
    } else {
      scriptOk = await deregisterScriptTag(shop, accessToken, scriptSrc);
    }

    if (!scriptOk) {
      console.warn(`[Shopify Settings] Failed to sync script tag state with Shopify: enabled=${enabled}`);
    }

    // 4. Update settings in the shop config document
    shopDoc.shopify = {
      shop,
      accessToken,
      apiKey,
      syncInventory,
      syncOrders,
      enabled,
      buttonLabel,
      minTotal,
      updatedAt: Date.now()
    };

    await container.items.upsert(shopDoc);
    console.log(`[Shopify Settings] Saved configuration for shop ${shop} (wallet: ${wallet})`);

    return NextResponse.json({
      ok: true,
      connected: true,
      scriptSynced: scriptOk,
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
