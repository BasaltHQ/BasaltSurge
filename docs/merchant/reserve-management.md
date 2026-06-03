# Reserve Management & Offramping Payouts

This guide explains how customer payments are automatically divided on-chain, how to release funds from your Split smart contract to your self-custody wallet, and how to offramp crypto earnings to traditional fiat bank accounts.

---

## 1. On-Chain Revenue Splits

BasaltSurge uses trustless smart contracts on the **Base Network** (Coinbase L2) to divide value the moment a purchase is made. 

Every time a shopper completes checkout, the transaction lands in a custom **PaymentSplitter ("Split")** contract unique to your wallet. The splitter divides funds automatically based on basis points (bps, where 100 bps = 1%):
*   **Merchant Share**: Typically 99.5% (9,950 bps) by default.
*   **Platform Fee**: 0.5% (50 bps) by default.
*   **Partner Fee**: Custom bps set by your partner network.
*   **Total Split**: Always sums to 100% (10,000 bps).

Once funds land in the Split contract, they are locked until released. Your share is reserved for your wallet and cannot be accessed by the platform, partner, or any other third party.

---

## 2. Releasing Accrued Reserves

Balances accrue separately for each supported cryptocurrency (USDC, USDT, cbBTC, cbXRP, ETH). To transfer these funds from the Split contract into your connected admin wallet:

1. Connect your administrator wallet and open the Admin Console.
2. Navigate to **Merchant** → **Reserve** in the sidebar.
3. Review your balances under the **Reserve Analytics** panel. You will see:
    *   **Accumulated Balance**: The total historical earnings received by the Split.
    *   **Due to You**: The amount currently available for withdrawal.
4. Click **Withdraw to Wallet** to batch-release all due token balances. (Alternatively, you can click **Withdraw [Symbol]** next to a specific cryptocurrency to release only that asset).
5. Approve the transaction in your wallet. The status will update to *Submitted* and the funds will move directly into your wallet.

> [!TIP]
> **Gasless Transactions (Account Abstraction)**:
> If you registered using a social login (Google, Email), your account is a smart account. The network gas fees required to run contract withdrawals and admin transfers are sponsored by the platform. You do not need to hold ETH to pay for transaction fees.

---

## 3. Offramping Crypto to Fiat (Cash Out)

Once your earnings are released from the Split contract to your connected wallet, you can cash them out to your bank account using a digital asset exchange (Coinbase is recommended due to its native Base L2 integration).

### Manual Offramping Steps:
1.  **Open Exchange**: Log in to your Coinbase (or other preferred exchange) app or website and click **Receive**.
2.  **Select Asset & Network**:
    *   Select the asset you want to deposit (USDC is highly recommended for low volatility).
    *   **IMPORTANT**: Select the **Base** network. 
3.  **Copy Deposit Address**: Copy the deposit address provided by the exchange.
4.  **Send Funds**: Open your connected admin Web3 wallet, select your USDC balance, click **Send**, paste the copied deposit address, and confirm the transaction.
5.  **Bank Withdrawal**: Once the USDC arrives in your exchange account, sell the USDC for fiat (e.g., USD) and withdraw the funds to your linked bank account, or spend them directly with a debit card (such as the Coinbase Card).

> [!CAUTION]
> **Network Match Warning**:
> Always ensure you copy a **Base network deposit address** and send tokens via the **Base network**. Sending L2 Base tokens to an Ethereum mainnet address or a different blockchain network will result in the permanent loss of your funds.

---

## 4. Feature Roadmap

> [!WARNING]
> **Automated Offramping**:
> Automated Offramping is a feature/function that is coming soon. In a future update, you will be able to configure a linked bank account or exchange deposit endpoint to have your due earnings periodically released and offramped to fiat automatically. Currently, you must complete the steps manually as outlined in Section 3.
