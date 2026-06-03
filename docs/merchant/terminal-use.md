# Point-of-Sale Terminal Use

This guide details how cashiers and storefront staff use the built-in **Terminal** tab to build customer carts, generate checkout QR codes, check transaction status, and review order history.

---

## 1. Building a Cart

To create an in-person order:
1. Navigate to **Merchant** → **Terminal** in the Admin Sidebar.
2. The **Inventory Item Catalog** is displayed on the left. Search or filter by categories.
3. Click items to add them to the cart:
    *   Adjust quantities using the **`+`** and **`−`** buttons, or enter the quantity directly.
    *   To customize an item (e.g., adding modifications for coffee or food), select the appropriate **Modifiers** in the item details before adding it to the cart.
    *   Click **Remove** to delete an item.

---

## 2. Setting Taxes and Generating the Order

Once the cart is ready, configure the transaction summary:
1. In the **Taxes & Checkout** panel on the right, select the active **Jurisdiction** (or leave it blank to apply your default rate).
2. To apply a unique tax rate for this specific checkout, enter a value in the **Override Tax Rate** field (value must be between `0` and `1`, where `0.08` represents `8.00%`).
3. Review the **Summary**:
    *   *Items Subtotal*: Cumulative cost of products.
    *   *Tax*: Calculated on taxable products.
    *   *Processing Fee*: Total network/processing fee.
    *   *Total*: Final USD check total.
4. Click **Generate Order**. The terminal will compile the cart and display a digital receipt.

---

## 3. Completing the Customer Payment

Upon order generation:
1. The terminal displays a **Payment QR Code** linked to the unique receipt (e.g., `https://<branded-domain>/portal/<receipt-id>`).
2. Instruct the customer to scan the QR code using their mobile phone camera or Web3 wallet.
3. The customer will be directed to the checkout page, where they select their preferred cryptocurrency (USDC, USDT, ETH, cbBTC, cbXRP) and authorize payment.
4. **Terminal Status Updates**:
    *   *Awaiting Payment*: Customer has not sent the transaction.
    *   *Pending*: Payment has been detected on the Base network and is awaiting block confirmations.
    *   *Completed*: Split successfully distributed on-chain. The terminal plays a success sound, and cashiers can safely hand over the products.
    *   *Failed / Timeout*: Payment failed or the 5-minute checkout timer expired.

---

## 4. Reviewing Previous Orders

If you need to check past transactions:
*   Open the **Merchant** → **Orders** tab to view a running history of all generated carts, customer payment statuses, and transaction timestamps.
*   Click a specific receipt row to view line items, print a duplicate thermal paper receipt, or initiate a refund.
