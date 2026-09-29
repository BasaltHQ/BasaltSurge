<!-- tour {"panel":"delivery","order":230} -->

# Delivery

## Overview

Delivery connects restaurant operations with delivery services.

## Walkthrough

- Delivery dashboard: The dashboard summarizes your connected delivery integration.
- Connect a delivery store: An unconnected shop shows the integration setup entry point.
- Recent delivery orders: Review incoming delivery orders.

## Takeaway

Understand the connection between your menu and delivery channel.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Delivery dashboard",
    "brief": "The dashboard summarizes your connected delivery integration.",
    "extended": "A connected store enables order and health views. If no store is connected, start with the setup explanation instead.",
    "optional": "The delivery dashboard requires a connected store.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "delivery.delivery-dashboard",
          "source": "src/app/(web)/admin/panels/DeliveryPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Connect a delivery store",
    "brief": "An unconnected shop shows the integration setup entry point.",
    "extended": "Use Get Started when you are ready to connect your actual store. The tour does not authorize an integration.",
    "optional": "The setup introduction is hidden once the store is connected.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "delivery.connect-a-delivery-store",
          "source": "src/app/(web)/admin/panels/DeliveryPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Recent delivery orders",
    "brief": "Review incoming delivery orders.",
    "extended": "Order actions affect live fulfillment. Confirm the order and current status before accepting or changing it.",
    "optional": "Recent orders are shown for a connected delivery store.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "delivery.recent-delivery-orders",
          "source": "src/app/(web)/admin/panels/DeliveryPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Integration health",
    "brief": "Check the connection health when orders stop arriving.",
    "extended": "Use the health information to distinguish integration issues from a quiet ordering period.",
    "mode": "extended",
    "optional": "Integration health is shown for connected stores.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "delivery.integration-health",
          "source": "src/app/(web)/admin/panels/DeliveryPanel.tsx"
        }
      }
    ]
  }
]
```
