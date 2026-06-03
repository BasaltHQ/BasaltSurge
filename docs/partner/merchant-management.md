# Merchant Management & Onboarding

This guide covers how partners manage merchant applications, approve registrations, override default split values, and monitor network analytics.

---

## 1. Onboarding Pipelines & Approvals

If your partner container is configured with the registration regime enabled (`NEXT_PUBLIC_PLATFORM_REGISTRATION_REGIME = "true"`):

1.  New merchant signups are redirected to an application form (`/apply`).
2.  Once submitted, their status is set to `pending`. They cannot access the merchant console until approved.
3.  As a Partner Admin, navigate to **Partner/Admin** → **Client Requests** in the sidebar.
4.  Review the merchant details, wallet address, business name, and catalog metadata.
5.  Click **Approve** to activate their account, or **Deny** to reject the application. Upon approval, their status updates to `approved`, allowing them to log in to the merchant dashboard.

---

## 2. Managing Merchant Sub-accounts

To review or modify registered merchants:
1. Navigate to **Partner/Admin** → **Merchants** in the sidebar.
2. Here you will see a list of all onboarded store profiles, wallet addresses, and status details.
3. You can click a merchant row to:
    *   *Deactivate / Suspend*: Revoke access temporarily.
    *   *Custom Split configuration*: View or override split rules (subject to the [Basis Points & Split Config](./split-config.md) guidelines).

---

## 3. Reporting & Audit Logs

Under the **Partner/Admin** → **Reports** panel, you can access aggregated network audits:
*   **Total Volume (USD)**: Net revenue processed across all stores.
*   **Active Terminals**: The number of provisioned touchpoints currently online.
*   **Token Distribution**: Charting checkout volume split by token type (USDC vs ETH vs others).
*   **Admin Activity Log**: Auditing admin actions (e.g., branding edits, registration approvals, and unlock PIN resets) for compliance.
