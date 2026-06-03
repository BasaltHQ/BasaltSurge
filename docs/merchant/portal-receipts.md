# Shopper Portal, Receipts & Refunds

This guide explains the shopper checkout experience, payment options, the lifecycle of digital receipts, and how merchants process customer refunds.

---

## 1. The Shopper Portal Checkout Experience

When a customer scans a terminal QR code or completes an online cart, they are redirected to the **Shopper Checkout Portal**:
`https://<your-branded-domain>/portal/<receipt-id>`

The checkout page automatically displays:
*   Your dynamic storefront branding (logo, name, colors).
*   Itemized line items, applied sales tax, and processing fees.
*   The final USD check total.

---

## 2. Social Logins & Smart Accounts

To make payments simple for non-crypto users, BasaltSurge integrates **Smart Accounts (Account Abstraction)**:

*   **No Web3 Wallet Required**: Shoppers can log in instantly using standard social credentials (such as Google or Email) or a phone number.
*   **Automated Account Creation**: The system creates a secure smart contract wallet linked to their social identity under the hood. 
*   **Funding & Paying**: Customers can easily fund this smart account or connect an existing browser extension wallet (such as Coinbase Wallet or MetaMask) to execute the payment in one click.

---

## 3. Supported Payout Currencies

Shoppers can complete checkouts using multiple assets on the **Base L2 network**:
*   **USDC** & **USDT**: Stablecoins pegged directly to USD (highly recommended for predictable transaction values).
*   **ETH**: Native Ethereum.
*   **cbBTC**: Coinbase Wrapped Bitcoin.
*   **cbXRP**: Coinbase Wrapped XRP.

The portal automatically fetches real-time oracle exchange rates to calculate the exact crypto amount required to cover the USD checkout total.

---

## 4. Understanding Receipt Lifecycles

Every checkout progresses through distinct statuses in your **Orders** and **Receipts** tables:

| Status | Description | Action Required |
| :--- | :--- | :--- |
| **`generated`** | The order is created in the admin panel/API and is awaiting shopper checkout. | Awaiting customer action. |
| **`pending`** | The customer has submitted the transaction. It is detected on the Base blockchain. | Wait. The transaction is resolving. |
| **`paid`** | The payment transaction has been confirmed on-chain. | Safe to hand over products or services. |
| **`completed`** | The splitter contract has successfully split the payment. | Funds are now available in your Split Reserve. |
| **`refunded`** | The transaction has been returned to the customer. | Completed. Order marked as returned. |

---

## 5. Processing Refunds

Because blockchain transactions are final and irreversible, refunds must be initiated manually by the administrator:

1. Open the Admin Console and navigate to **Merchant** → **Orders** (or **Reports**).
2. Locate the transaction you wish to refund and click to expand details.
3. Click the **Refund Order** button.
4. Confirm the action. The system will reverse the merchant share and return the tokens from your account directly back to the customer's on-chain wallet address.
5. The receipt status will update to **`refunded`**.
