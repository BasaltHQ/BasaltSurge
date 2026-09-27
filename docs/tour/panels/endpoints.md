<!-- tour {"panel":"endpoints","order":200} -->

# Touchpoints

## Overview

Touchpoints is the launchpad for customer-facing and staff-facing applications.

## Walkthrough

- Core touchpoints: Find the primary interfaces used by your business.
- Logistics and fleet: Locate delivery and driver interfaces.
- Industry modules: Review the apps supplied by your industry pack.

## Takeaway

Choose the right interface for the task and device.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Core touchpoints",
    "brief": "Find the primary interfaces used by your business.",
    "extended": "Touchpoint cards expose launch and configuration options for the enabled interfaces.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "endpoints.core-touchpoints",
          "source": "src/app/(web)/admin/panels/EndpointsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Logistics and fleet",
    "brief": "Locate delivery and driver interfaces.",
    "extended": "Availability depends on the enabled modules and your permissions. Launch links may leave this console.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "endpoints.logistics-and-fleet",
          "source": "src/app/(web)/admin/panels/EndpointsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Industry modules",
    "brief": "Review the apps supplied by your industry pack.",
    "extended": "Industry-specific modules appear according to shop configuration. The tour only covers modules available in your sidebar.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "endpoints.industry-modules",
          "source": "src/app/(web)/admin/panels/EndpointsPanel.tsx"
        }
      }
    ]
  }
]
```
