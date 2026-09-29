<!-- tour {"panel":"orders","order":90} -->

# Orders

## Overview

Orders is the operational record of customer purchases and fulfillment.

## Walkthrough

- Order product list: Choose items from the product list when building an order.
- Order product grid: Use the grid to recognize products visually.
- Order categories: Browse by category to narrow the order catalog.

## Takeaway

Find an order and understand its next operational step.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Order product list",
    "brief": "Choose items from the product list when building an order.",
    "extended": "This view helps you scan the catalog. Adding products changes the draft order; the tour does not add items.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "orders.viewMode.list",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "orders.viewMode.list",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "orders.viewMode.list.content",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Order product grid",
    "brief": "Use the grid to recognize products visually.",
    "extended": "The same inventory is shown as cards. Review product and price before adding anything to the order.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "orders.viewMode.grid",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "orders.viewMode.grid",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "orders.viewMode.grid.content",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Order categories",
    "brief": "Browse by category to narrow the order catalog.",
    "extended": "Select a category yourself to find the products you need. The current order remains separate from the catalog view.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "orders.viewMode.categories",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "orders.viewMode.categories",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Tax jurisdiction",
    "brief": "Review the order tax jurisdiction.",
    "extended": "The selected jurisdiction and tax options affect the generated order. Verify the settings for the real transaction before creating it.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "orders.tax-jurisdiction",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  }
]
```
