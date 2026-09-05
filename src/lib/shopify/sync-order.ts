import { getContainer } from "@/lib/cosmos";

/**
 * Checks if a receipt corresponds to a Shopify checkout and synchronizes the paid status back by creating a paid order.
 */
export async function checkAndSyncShopifyOrder(receipt: any, nextStatus: string): Promise<any> {
  // 1. Check if status is a paid/settled status
  const paidStatuses = ["paid", "paid - ach pending", "ach_pending", "checkout_success", "tx_mined", "reconciled"];
  if (!paidStatuses.includes(String(nextStatus).toLowerCase())) {
    return receipt;
  }

  // 2. Check if this is a Shopify checkout and has not been synced yet
  const shop = receipt.shopifyShop || receipt.shopify?.shop || (receipt.metadata && receipt.metadata.shopifyShop);
  if (!shop || receipt.shopifyOrderId) {
    return receipt;
  }

  console.log(`[Shopify Sync] Found unsynced paid Shopify receipt ${receipt.receiptId} for shop: ${shop}`);

  try {
    const container = await getContainer();

    // 3. Retrieve Shopify credentials from the merchant's shop_config document
    const { resources } = await container.items
      .query({
        query: "SELECT * FROM c WHERE c.type = 'shop_config' AND LOWER(c.shopify.shop) = @s",
        parameters: [{ name: "@s", value: String(shop).toLowerCase() }]
      })
      .fetchAll();

    if (resources.length === 0 || !resources[0].shopify?.accessToken) {
      console.error(`[Shopify Sync] Failed to retrieve access token for shop: ${shop}`);
      return receipt;
    }

    const merchantDoc = resources[0];
    const accessToken = merchantDoc.shopify.accessToken;

    // 4. Construct the Shopify order payload
    const lineItems = Array.isArray(receipt.lineItems) ? receipt.lineItems : [];
    const shopifyLineItems = lineItems.map((item: any) => ({
      title: item.label || item.name || "Product",
      price: String(item.priceUsd || "0.00"),
      quantity: Number(item.qty || 1),
      sku: item.sku || undefined
    }));

    const orderPayload = {
      order: {
        line_items: shopifyLineItems,
        financial_status: "paid",
        email: receipt.customerEmail || receipt.stripeEmail || undefined,
        transactions: [
          {
            kind: "sale",
            status: "success",
            amount: String(receipt.totalUsd || "0.00")
          }
        ],
        note: `Paid with Cryptocurrency via PortalPay. Transaction Hash: ${receipt.transactionHash || "Pending"}`,
        tags: "PortalPay, Crypto Payment"
      }
    };

    // 5. Post to Shopify's Orders API
    const shopifyUrl = `https://${shop}/admin/api/2024-10/orders.json`;
    console.log(`[Shopify Sync] Registering paid order on Shopify: ${shopifyUrl}`);
    
    const res = await fetch(shopifyUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(orderPayload)
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      console.error(`[Shopify Sync] Shopify API returned error:`, errBody);
      return receipt;
    }

    const resData = await res.json();
    const shopifyOrder = resData.order;

    if (shopifyOrder && shopifyOrder.id) {
      console.log(`[Shopify Sync] Successfully created Shopify Order ID: ${shopifyOrder.id} (${shopifyOrder.name})`);
      
      // 6. Record generated order details in the receipt
      receipt.shopifyOrderId = String(shopifyOrder.id);
      receipt.shopifyOrderName = String(shopifyOrder.name);
      
      // Update receipt in database immediately
      try {
        await container.items.upsert(receipt);
      } catch (dbErr) {
        console.error("[Shopify Sync] Failed to update receipt with shopifyOrder details in DB:", dbErr);
      }
    }
  } catch (err) {
    console.error("[Shopify Sync] Critical synchronization error:", err);
  }

  return receipt;
}
