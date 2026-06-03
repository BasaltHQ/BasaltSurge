# Fee Splits & Immutability Policy

This guide details how fee splits are calculated using Basis Points (bps), how split smart contracts are validated, and the immutability policy enforced after container deployment.

---

## 1. Split Allocation & Basis Points (bps)

BasaltSurge uses basis points (bps) to allocate transaction payouts on-chain, where:
$$100 \text{ bps} = 1.00\%$$
$$10,000 \text{ bps} = 100.00\%$$

When payments are processed, the PaymentSplitter smart contract divides the payouts:
$$\text{merchantBps} = 10,000 - \text{platformFeeBps} - \text{partnerFeeBps}$$

### Resolution Precedence:
1.  **Platform Fee (`platformFeeBps`)**:
    *   *First priority*: Brand configuration override in Cosmos DB (`brand:config.platformFeeBps`).
    *   *Second priority*: Static default brand config (`BRANDS[key].platformFeeBps`).
    *   *Third priority*: Environment defaults (`PLATFORM_SPLIT_BPS`).
    *   *Fallback*: `50 bps` (0.50%).
2.  **Partner Fee (`partnerFeeBps`)**:
    *   *First priority*: Brand configuration override in Cosmos DB (`brand:config.partnerFeeBps`).
    *   *Second priority*: Static brand defaults.
    *   *Fallback*: `0 bps` (0.00%).

---

## 2. Split Validation Audits

During split previews and provisioning flows, the backend validates the active `PaymentSplitter` configuration:
*   The platform recipient address must be present with shares matching the resolved `platformFeeBps`.
*   The partner recipient address must be present with shares matching the resolved `partnerFeeBps`.
*   Total recipient shares must sum to exactly `10,000 bps` (100%).

### Misconfiguration Signals:
If a mismatch is found, the system flags the split as misconfigured and returns a warning:
*   **`platform_bps_mismatch`**: The split contract's platform share doesn't match the resolved database configuration.
*   **`missing_platform_recipient`** or **`missing_partner_recipient`**: Required wallets are missing from the splitter contract.
*   **`needsRedeploy`**: Indicates that the contract must be re-bound or redeployed to resolve the mismatch.

---

## 3. Post-Deployment Immutability Policy

To protect merchants and preserve network transparency, fee structures are locked after container provisioning:

*   **Lock Event**: Once a partner container is deployed (detected when `containerState`, `containerAppName`, or `containerFqdn` is written to the database configuration overrides), fee configurations are locked.
*   **Partner Restrictions**: Partners cannot adjust `platformFeeBps` or `partnerFeeBps` post-deployment. Attempting to modify these fields returns:
    ```json
    { "error": "fees_locked_after_deploy" }
    ```
    (HTTP Status: `403 Forbidden`).
*   **UI Behavior**: In the Branding Panel, the fee input boxes are disabled and show the message *"Locked after partner container deploy"*.
*   **Operational Overrides**: If fees must be altered due to contract adjustments, changes must be performed by a Platform administrator carrying `platform_superadmin` or `platform_admin` credentials.
