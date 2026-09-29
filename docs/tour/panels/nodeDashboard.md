<!-- tour {"panel":"nodeDashboard","order":600} -->

# Dashboard

## Overview

The node dashboard describes regional node activity and traffic routing.

## Walkthrough

- Network: Explore the node network.
- Routing: Understand traffic routing.
- Become a Node Operator: Find the operator application.

## Takeaway

Connect regional capacity with the routing overview.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Network",
    "brief": "Explore the node network.",
    "extended": "Review the regional distribution and node status before selecting a node.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeDashboard.view.network",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeDashboard.view.network",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeDashboard.view.network.content",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Routing",
    "brief": "Understand traffic routing.",
    "extended": "Review the routing explanation and available network information.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeDashboard.view.routing",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeDashboard.view.routing",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeDashboard.view.routing.content",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Become a Node Operator",
    "brief": "Find the operator application.",
    "extended": "Review the operator information required before submitting an application. The tour does not apply or stake assets.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeDashboard.view.apply",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeDashboard.view.apply",
          "source": "src/app/(web)/admin/panels/NodeDashboardPanel.tsx"
        }
      }
    ]
  }
]
```
