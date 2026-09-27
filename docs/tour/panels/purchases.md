<!-- tour {"panel":"purchases","order":20} -->

# My Purchases

## Overview

My Purchases brings together your purchases and digital bookshelf.

## Walkthrough

- My Purchases: Find receipts and past purchases here.
- Bookshelf: Your purchased digital titles live in the Bookshelf.

## Takeaway

Return here to find what you bought and its receipt.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "My Purchases",
    "brief": "Find receipts and past purchases here.",
    "extended": "Use purchase records to follow order details, receipts and available review actions. Empty history means this account has no matching purchases.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "purchases.activeTab.purchases",
          "source": "src/app/(web)/admin/panels/MyPurchasesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "purchases.activeTab.purchases",
          "source": "src/app/(web)/admin/panels/MyPurchasesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "purchases.activeTab.purchases.content",
          "source": "src/app/(web)/admin/panels/MyPurchasesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Bookshelf",
    "brief": "Your purchased digital titles live in the Bookshelf.",
    "extended": "The Bookshelf separates reading access from transaction history. Open an owned title yourself when you want to read it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "purchases.activeTab.bookshelf",
          "source": "src/app/(web)/admin/panels/MyPurchasesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "purchases.activeTab.bookshelf",
          "source": "src/app/(web)/admin/panels/MyPurchasesPanel.tsx"
        }
      }
    ]
  }
]
```
