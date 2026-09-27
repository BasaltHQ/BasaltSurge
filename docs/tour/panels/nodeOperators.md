<!-- tour {"panel":"nodeOperators","order":590} -->

# Node Operators

## Overview

Node Operators manages the infrastructure operator network.

## Walkthrough

- Overview: Review network utilization.
- Applications: Review operator applications.
- Active nodes: Review registered operators.
- Decommissions: Review node decommissions.
- Rewards: Review node rewards.
- Staking: Review staking information.

## Takeaway

Understand who operates capacity and where it is available.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Overview",
    "brief": "Review network utilization.",
    "extended": "Use the overview to understand regional capacity and node status.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.overview",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.overview",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Applications",
    "brief": "Review operator applications.",
    "extended": "Approval and rejection affect operator access and remain under your control.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.applications",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.applications",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Active nodes",
    "brief": "Review registered operators.",
    "extended": "Inspect the operator list before changing status or decommissioning a node.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.active",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.active",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Decommissions",
    "brief": "Review node decommissions.",
    "extended": "Decommissioning changes network participation and is not performed by the tour.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.decommissions",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.decommissions",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Rewards",
    "brief": "Review node rewards.",
    "extended": "Read reward status and eligibility information before taking action.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.rewards",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.rewards",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-6",
    "title": "Staking",
    "brief": "Review staking information.",
    "extended": "Staking controls affect real assets. The tour only opens the view.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "nodeOperators.tab.staking",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "nodeOperators.tab.staking",
          "source": "src/app/(web)/admin/panels/NodeOperatorsPanel.tsx"
        }
      }
    ]
  }
]
```
