<!-- tour {"panel":"dashboard","order":50} -->

# Dashboard

## Overview

The dashboard is your starting point for the selected merchant workspace.

## Walkthrough

- Merchant overview: Start with the current merchant workspace.
- At a glance: Review the available business metrics.
- Merchant tools: These shortcuts lead to the tools available to you.

## Takeaway

Start the working day in the correct merchant context.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Merchant overview",
    "brief": "Start with the current merchant workspace.",
    "extended": "The dashboard summarizes the selected shop or team workspace. Changing team context changes what this overview represents.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "dashboard.merchant-overview",
          "source": "src/components/admin/panels/merchant-dashboard.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "At a glance",
    "brief": "Review the available business metrics.",
    "extended": "Read each metric label and reporting period before comparing performance. Permissions and data availability can limit the metrics shown.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "dashboard.at-a-glance",
          "source": "src/components/admin/panels/merchant-dashboard.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Merchant tools",
    "brief": "These shortcuts lead to the tools available to you.",
    "extended": "Use the dashboard shortcuts to return to common workflows. The tour visits the full accessible sidebar, including tools outside these shortcuts.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "dashboard.merchant-tools",
          "source": "src/components/admin/panels/merchant-dashboard.tsx"
        }
      }
    ]
  }
]
```
