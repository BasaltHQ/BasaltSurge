<!-- tour {"panel":"onramps","order":320} -->

# Onramps

## Overview

Onramps configures supported ways for customers to fund their payment journey.

## Walkthrough

- Onramp providers: Review the funding providers offered by this workspace.
- Stripe and Stripe Link: Review the provider’s configuration and availability.
- Coinbase Pay: Review the provider’s configuration and availability.

## Takeaway

Find the provider settings behind the funding experience.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Onramp providers",
    "brief": "Review the funding providers offered by this workspace.",
    "extended": "Provider availability and configuration determine the payment options shown to users.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "onramps.onramp-providers",
          "source": "src/app/(web)/admin/panels/OnrampsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Stripe and Stripe Link",
    "brief": "Review the provider’s configuration and availability.",
    "extended": "Read the provider-specific setup and fee controls before enabling or changing this payment option.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "onramps.stripe-and-stripe-link",
          "source": "src/app/(web)/admin/panels/OnrampsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Coinbase Pay",
    "brief": "Review the provider’s configuration and availability.",
    "extended": "Read the provider-specific setup and fee controls before enabling or changing this payment option.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "onramps.coinbase-pay",
          "source": "src/app/(web)/admin/panels/OnrampsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Transak",
    "brief": "Review the provider’s configuration and availability.",
    "extended": "Read the provider-specific setup and fee controls before enabling or changing this payment option.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "onramps.transak",
          "source": "src/app/(web)/admin/panels/OnrampsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Rampnow and Ramp",
    "brief": "Review the provider’s configuration and availability.",
    "extended": "Read the provider-specific setup and fee controls before enabling or changing this payment option.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "onramps.rampnow-and-ramp",
          "source": "src/app/(web)/admin/panels/OnrampsPanel.tsx"
        }
      }
    ]
  }
]
```
