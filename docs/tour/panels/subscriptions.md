<!-- tour {"panel":"subscriptions","order":100} -->

# Subscriptions

## Overview

Subscriptions organizes recurring plans and their subscribers.

## Walkthrough

- Subscription plans: Manage recurring offerings from this panel.
- Your plans: Review the plans currently offered by this merchant.
- Subscribers: Find the subscriptions attached to your plans.

## Takeaway

Distinguish a subscription plan from an individual subscriber.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Subscription plans",
    "brief": "Manage recurring offerings from this panel.",
    "extended": "Plan setup and subscriber management are separate workflows. Creating or cancelling a plan affects real subscriptions.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "subscriptions.subscription-plans",
          "source": "src/app/(web)/admin/panels/SubscriptionsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Your plans",
    "brief": "Review the plans currently offered by this merchant.",
    "extended": "Compare the displayed price, billing period and status before editing a plan.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "subscriptions.your-plans",
          "source": "src/app/(web)/admin/panels/SubscriptionsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Subscribers",
    "brief": "Find the subscriptions attached to your plans.",
    "extended": "Use subscriber records to understand who is subscribed and the status shown. Cancellation is a live action.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "subscriptions.subscribers",
          "source": "src/app/(web)/admin/panels/SubscriptionsPanel.tsx"
        }
      }
    ]
  }
]
```
