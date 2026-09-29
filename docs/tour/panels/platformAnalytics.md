<!-- tour {"panel":"platformAnalytics","order":460} -->

# Platform Analytics

## Overview

Platform Analytics provides an overview of the wider platform.

## Walkthrough

- Overview: Review the analytics overview.
- Conversion: Compare conversion metrics.
- Failures: Investigate failures.
- Transactions: Investigate transactions.
- Treasury: Review treasury information.
- Audit and Reconcile: Review audit and reconciliation.

## Takeaway

Move from platform trends to the relevant operational detail.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Overview",
    "brief": "Review the analytics overview.",
    "extended": "Read reporting completeness and filters before comparing performance.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.overview",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.overview",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Conversion",
    "brief": "Compare conversion metrics.",
    "extended": "Checkout completion, receipt completion and resolved outcomes measure different parts of the payment flow.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.conversion",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.conversion",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Failures",
    "brief": "Investigate failures.",
    "extended": "Failure reasons and combinations help identify recurring issues without retrying payments.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.failures",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.failures",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Transactions",
    "brief": "Investigate transactions.",
    "extended": "The transaction workspace focuses on individual payment records. Search within the intended scope.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.transactions",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.transactions",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Treasury",
    "brief": "Review treasury information.",
    "extended": "Treasury has an independent on-chain history and valuation scope. It is distinct from receipt revenue.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.treasury",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.treasury",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-6",
    "title": "Audit and Reconcile",
    "brief": "Review audit and reconciliation.",
    "extended": "Compare reporting evidence and investigate discrepancies before taking corrective action.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "analytics.workspace.audit",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.workspace.audit",
          "source": "src/app/(web)/admin/panels/PlatformAnalyticsPanel.tsx"
        }
      }
    ]
  }
]
```
