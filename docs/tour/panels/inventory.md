<!-- tour {"panel":"inventory","order":70} -->

# Inventory

## Overview

Inventory is the product catalog behind your storefront and selling tools.

## Walkthrough

- Inventory catalog: Inventory is the product catalog behind your selling tools.
- Product grid: The grid gives a visual view of your products.
- Product list: The list makes product details easier to scan.
- Categories: Categories organize the catalog into groups.

## Takeaway

Keep products accurate before taking orders.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Inventory catalog",
    "brief": "Inventory is the product catalog behind your selling tools.",
    "extended": "Review products, categories and stock before building an order. Edits affect the live catalog.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.inventory-catalog",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Product grid",
    "brief": "The grid gives a visual view of your products.",
    "extended": "Use product images and names to identify an item; the guide does not open or modify individual products.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "inventory.viewMode.grid",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.viewMode.grid",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Product list",
    "brief": "The list makes product details easier to scan.",
    "extended": "Compare the visible inventory rows and use available filters to narrow the catalog.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "inventory.viewMode.list",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.viewMode.list",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Categories",
    "brief": "Categories organize the catalog into groups.",
    "extended": "Use this view to understand the grouping shoppers and operators use. Grouping does not change stock quantities.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "inventory.viewMode.categories",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.viewMode.categories",
          "source": "src/app/(web)/admin/page.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.viewMode.categories.content",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Inventory search",
    "brief": "Search by SKU, name, description or tag.",
    "extended": "Combine search with category, stock and price filters when investigating a large catalog.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "inventory.inventory-search",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  }
]
```
