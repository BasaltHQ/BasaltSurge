<!-- tour {"panel":"partnerAnalytics","order":270} -->

# Partner Analytics

## Overview

Partner Analytics summarizes activity within your partner scope.

## Walkthrough

- Overview: Review the analytics overview.
- Conversion: Compare conversion metrics.
- Failures: Investigate failures.
- Transactions: Investigate transactions.

## Takeaway

Understand your partner network before changing its configuration.

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
  }
]
```
