<!-- tour {"panel":"customAuthWallets","order":370} -->

# Custom Auth Wallets

## Overview

Custom Auth Wallets manages explicit authentication-to-wallet mappings.

## Walkthrough

- Authentication wallet links: Review the wallets connected to custom authentication.
- Locate a wallet link: Search by email or wallet address.

## Takeaway

Treat identity mappings as access configuration.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Authentication wallet links",
    "brief": "Review the wallets connected to custom authentication.",
    "extended": "These links affect how users access the workspace. Investigate the correct user before considering an unlink action.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "customAuthWallets.authentication-wallet-links",
          "source": "src/app/(web)/admin/panels/CustomAuthWalletsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Locate a wallet link",
    "brief": "Search by email or wallet address.",
    "extended": "Use a precise identifier to locate the intended link. The tour does not unlink identities.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "customAuthWallets.locate-a-wallet-link",
          "source": "src/app/(web)/admin/panels/CustomAuthWalletsPanel.tsx"
        }
      }
    ]
  }
]
```
