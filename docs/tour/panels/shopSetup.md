<!-- tour {"panel":"shopSetup","order":60} -->

# Shop Configuration

## Overview

Shop Configuration defines how your shop appears and operates.

## Walkthrough

- Basic shop setup: Basic brings together the essential storefront details.
- Advanced shop setup: Advanced exposes additional storefront configuration.
- Portal theme: Portal Theme controls the payment portal presentation.

## Takeaway

Configure your shop before sending customers to it.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Basic shop setup",
    "brief": "Basic brings together the essential storefront details.",
    "extended": "Start with the shop identity and public link, then review the visible setup fields before saving changes.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "shopSetup.shopMode.basic",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "shopSetup.shopMode.basic",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Advanced shop setup",
    "brief": "Advanced exposes additional storefront configuration.",
    "extended": "Review the advanced options for this shop and its industry pack. Only change settings when you understand their storefront effect.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "shopSetup.shopMode.advanced",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "shopSetup.shopMode.advanced",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "shopSetup.shopMode.advanced.content",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Portal theme",
    "brief": "Portal Theme controls the payment portal presentation.",
    "extended": "This view configures checkout presentation for the shop. Distinguish this merchant theme from the {{brandName}} platform brand used by your tour.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "shopSetup.shopMode.portal",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "shopSetup.shopMode.portal",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "shopSetup.shopMode.portal.content",
          "source": "src/components/admin/panels/shop-panel.tsx"
        }
      }
    ]
  }
]
```
