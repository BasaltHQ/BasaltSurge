<!-- tour {"panel":"users","order":330} -->

# Merchants

## Overview

Merchants is the administration view of businesses within your scope.

## Walkthrough

- Merchant directory: Find the merchants in your administrative scope.
- Find a merchant: Search by wallet or shop name.

## Takeaway

Find and support the correct merchant.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Merchant directory",
    "brief": "Find the merchants in your administrative scope.",
    "extended": "The directory provides search, filtering and operational information. Opening or changing a merchant record remains a deliberate action.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "users.merchant-directory",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Find a merchant",
    "brief": "Search by wallet or shop name.",
    "extended": "Combine the search with brand and tag filters when reviewing a large merchant directory.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "users.find-a-merchant",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Sort the directory",
    "brief": "Sort to focus your review.",
    "extended": "Choose the appropriate field and order before comparing records. The guide does not release funds or change merchant status.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "users.sort-the-directory",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  }
]
```
