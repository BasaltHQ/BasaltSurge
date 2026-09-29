<!-- tour {"panel":"reportsPlatform","order":570} -->

# Reports

## Overview

Platform Reports provides detailed reporting across partners and merchants.

## Walkthrough

- Reporting dashboard: Review revenue and entity breakdowns for this scope.
- Transaction report: Trace on-chain transactions in this reporting scope.

## Takeaway

Move from a platform overview to auditable detail.

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
          "target": "reportsPlatform.viewMode.dashboard",
          "source": "src/app/(web)/admin/panels/ReportsPanelPlatform.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPlatform.viewMode.dashboard",
          "source": "src/app/(web)/admin/panels/ReportsPanelPlatform.tsx"
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
          "target": "reportsPlatform.viewMode.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelPlatform.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPlatform.viewMode.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelPlatform.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reportsPlatform.viewMode.transactions.content",
          "source": "src/app/(web)/admin/panels/ReportsPanelPlatform.tsx"
        }
      }
    ]
  }
]
```
