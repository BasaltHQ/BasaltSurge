<!-- tour {"panel":"terminal","order":80} -->

# Terminal

## Overview

The terminal is your point of sale for creating customer checkouts.

## Walkthrough

- Take a payment: Terminal starts a payment for a custom charge.
- Describe the charge: Give a custom charge a useful item name.
- Payment currency: Review the currency before entering an amount.

## Takeaway

Know the route from selecting items to presenting a checkout.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Take a payment",
    "brief": "Terminal starts a payment for a custom charge.",
    "extended": "Confirm the merchant context, currency and amount before creating a payment. We will only inspect the controls.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "terminal.take-a-payment",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Describe the charge",
    "brief": "Give a custom charge a useful item name.",
    "extended": "A clear description helps the payer recognize the charge and makes the resulting receipt easier to understand.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "terminal.describe-the-charge",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Payment currency",
    "brief": "Review the currency before entering an amount.",
    "extended": "Changing currency can affect how an amount is interpreted. The tour does not create a receipt or initiate a payment.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "terminal.payment-currency",
          "source": "src/app/(web)/admin/page.tsx"
        }
      }
    ]
  }
]
```
