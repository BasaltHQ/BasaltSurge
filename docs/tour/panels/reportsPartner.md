<!-- tour {"panel":"reportsPartner","order":420} -->

# Reports

## Overview

Partner Reports provides detailed records across your partner scope.

## Walkthrough

- Reporting dashboard: Review revenue and entity breakdowns for this scope.
- Transaction report: Trace on-chain transactions in this reporting scope.

## Takeaway

Produce a report for the right partner and period.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Reporting dashboard",
    "brief": "Review revenue and entity breakdowns for this scope.",
    "extended": "Check the date range and merchant or partner filters before comparing totals. Export only the report you intend to share.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reportsPartner.viewMode.dashboard",
          "source": "src/app/(web)/admin/panels/ReportsPanelPartner.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPartner.viewMode.dashboard",
          "source": "src/app/(web)/admin/panels/ReportsPanelPartner.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Transaction report",
    "brief": "Trace on-chain transactions in this reporting scope.",
    "extended": "Read transaction type and indexing information before interpreting completeness. Individual account actions are outside this walkthrough.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reportsPartner.viewMode.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelPartner.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPartner.viewMode.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelPartner.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPartner.viewMode.transactions.content",
          "source": "src/app/(web)/admin/panels/ReportsPanelPartner.tsx"
        }
      }
    ]
  }
]
```
