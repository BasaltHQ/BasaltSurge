# Shopify App Deployment Guide

This guide explains how to deploy Shopify apps for whitelabel brands using the automated deployment pipeline.

## Cart payment option

The app now ships a **Cart payment option** theme app embed. It adds **Pay with Surge**
beside the normal Checkout button on the cart page and in supported cart drawers.
Partner app packages use their configured gateway and a partner button label. This
is a storefront payment button that opens the existing hosted portal; it does not
register a payment provider inside Shopify checkout.

1. Deploy the updated application backend and public assets. The legacy
   `shopify-cart-hijack.js` URL now adds a separate button instead of intercepting
   regular Checkout. Existing ScriptTags use the same behavior during migration.
2. Deploy the existing Shopify app through Plugin Studio. Both automated deployment
   and the downloadable package include `extensions/cart-payment/`, independently
   of the optional checkout UI extension. Verify the existing app client ID and
   public HTTPS gateway URL before releasing the version.
3. In Shopify, open **Online Store → Themes → Edit theme → App embeds** on the
   published theme. Enable **Cart payment option** and save. The label is editable.
   App embeds must be enabled again when publishing a different theme.
4. On the cart page, test a nonempty cart, a quantity update, the new payment button,
   and normal Checkout. Check that the Surge button opens the expected portal.
   Payment failures should keep the cart open with a retry message.
5. Once the embed is active and verified, remove the old cart ScriptTag. Do not
   disconnect the merchant integration to remove it; that would also disable the
   backend connection. The runtime guards against double initialization while both
   installation methods are present.

The button uses named Shopify checkout controls (`name="checkout"` / `id="checkout"`)
and same-store checkout links. Themes with custom controls need an appropriate
selector added to `public/js/shopify-cart-hijack.js`. Assets are bundled with the
extension and do not expose merchant API credentials. The backend remains responsible
for inventory validation and order totals.

Shopify's [storefront ScriptTag migration guide](https://shopify.dev/docs/apps/build/online-store/script-tag-deprecation/storefront)
lists October 1, 2026 as the creation/update cutoff and March 1, 2027 as the removal
of existing storefront injection. Admin-created custom apps that cannot use theme
extensions require a theme-level installation instead.

Run the local regression checks with:

```sh
node --test src/lib/shopify/cart-payment.test.cjs
```

## Prerequisites

### 1. Install Shopify CLI

The deployment pipeline requires Shopify CLI to be installed globally:

```bash
npm install -g @shopify/cli @shopify/theme
```

Verify installation:
```bash
shopify version
```

### 2. Create Partner API Token

1. Go to [Shopify Partners Dashboard](https://partners.shopify.com)
2. Navigate to **Settings** → **Partner API clients**
3. Click **Manage Partner API clients**
4. Create a new API client with **Manage apps** permission
5. Copy the access token

### 3. Get Organization ID

Your Organization ID is in the URL when viewing your Partners Dashboard:
```
https://partners.shopify.com/YOUR_ORG_ID/...
```

### 4. Set Environment Variables

Add these to your `.env` or `.env.local`:

```env
# Shopify Deployment Configuration
SHOPIFY_CLI_PARTNERS_TOKEN=your_partner_api_token_here
SHOPIFY_ORG_ID=your_organization_id_here
```

For Azure deployment, add these to your Key Vault or Container App environment variables.

## Deployment Flow

### Step 1: Configure Plugin in Plugin Studio

1. Go to Admin → Plugin Studio
2. Select your brand (e.g., `paynex`)
3. Configure the Shopify plugin:
   - **Configuration tab**: Set app name, tagline, icons, banners
   - **OAuth tab**: Configure redirect URLs and access scopes
   - **Extension tab**: Enable checkout UI extension and customize

### Step 2: Check Deployment Readiness

Call the status endpoint to verify prerequisites:

```bash
curl "https://your-domain.com/api/admin/shopify/apps/status?brandKey=paynex"
```

Response shows a checklist:
```json
{
  "ok": true,
  "status": "ready_to_deploy",
  "checklist": [
    { "id": "cli_installed", "label": "Shopify CLI installed", "completed": true },
    { "id": "partners_token", "label": "Partner API token configured", "completed": true },
    { "id": "org_id", "label": "Organization ID configured", "completed": true },
    { "id": "plugin_name", "label": "App name configured", "completed": true },
    { "id": "redirect_urls", "label": "OAuth redirect URLs configured", "completed": true },
    { "id": "scopes", "label": "Access scopes configured", "completed": true }
  ],
  "environment": {
    "cliInstalled": true,
    "cliVersion": "3.x.x",
    "hasPartnersToken": true,
    "hasOrgId": true,
    "ready": true
  }
}
```

### Step 3: Deploy the App

Click "Deploy App" in Plugin Studio or call the API:

```bash
curl -X POST "https://your-domain.com/api/admin/shopify/apps/deploy" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"brandKey": "paynex"}'
```

The deployment process:
1. Validates CLI and environment setup
2. Loads plugin configuration
3. Generates Shopify app project files
4. Runs `shopify app deploy` with your credentials
5. Extracts app ID/client ID from output
6. Updates database with deployment info

### Step 4: Verify in Shopify Partners

After successful deployment:
1. Go to [Shopify Partners Dashboard](https://partners.shopify.com)
2. Navigate to **Apps**
3. Your new app should appear in the list
4. Click to configure additional settings if needed

## Manual Deployment Alternative

If the automated CLI deployment fails, you can use the Package endpoint to generate a ZIP file:

```bash
curl -X POST "https://your-domain.com/api/admin/shopify/apps/package" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{"brandKey": "paynex"}'
```

This returns a download URL for a ZIP containing:
- `shopify.app.toml` - App configuration
- `extensions/checkout-ui/` - Checkout extension files
- `README.md` - Manual deployment instructions

Then manually deploy using Shopify CLI:

```bash
unzip paynex-shopify-app.zip -d paynex-app
cd paynex-app
npm install
shopify app deploy
```

## Troubleshooting

### "Shopify CLI not installed"

Install the CLI:
```bash
npm install -g @shopify/cli @shopify/theme
```

### "Missing SHOPIFY_CLI_PARTNERS_TOKEN"

Create a Partner API token:
1. Partners Dashboard → Settings → Partner API clients
2. Create new client with "Manage apps" permission
3. Set `SHOPIFY_CLI_PARTNERS_TOKEN` environment variable

### "Missing SHOPIFY_ORG_ID"

Find your organization ID in the Partners Dashboard URL and set `SHOPIFY_ORG_ID`.

### "Deployment failed"

Check the logs in the response. Common issues:
- Invalid token permissions
- CLI authentication expired
- Network issues with Shopify API

Try the manual deployment method as a fallback.

### App not showing in Partners Dashboard

1. Check the status endpoint for `appId` and `clientId`
2. Verify the organization ID is correct
3. Try refreshing the Partners Dashboard
4. Check if the app was created under a different organization

## OAuth Scopes Reference

Common scope presets available in Plugin Studio:

### Payment App
```
write_payment_gateways
write_payment_sessions
read_orders
write_orders
read_customers
```

### Checkout Extension
```
read_products
read_orders
write_orders
read_customers
unauthenticated_write_checkouts
read_checkout_branding_settings
write_checkout_branding_settings
```

### Full Access (for comprehensive apps)
See the OAuth tab in Plugin Studio for the complete list.

## API Reference

### GET /api/admin/shopify/apps/status
Check deployment prerequisites and status.

**Query Parameters:**
- `brandKey` (required): Brand identifier

### POST /api/admin/shopify/apps/deploy
Deploy a Shopify app for a brand.

**Body:**
```json
{
  "brandKey": "paynex",
  "applicationUrl": "https://your-app-url.com" // optional
}
```

### POST /api/admin/shopify/apps/package
Generate a downloadable app package ZIP.

**Body:**
```json
{
  "brandKey": "paynex"
}
```

### POST /api/admin/shopify/apps/publish
Mark an app as published with listing details.

**Body:**
```json
{
  "brandKey": "paynex",
  "listingUrl": "https://apps.shopify.com/your-app",
  "shopifyAppId": "12345",
  "shopifyAppSlug": "your-app"
}
