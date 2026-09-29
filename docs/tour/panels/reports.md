<!-- tour {"panel":"reports","order":180} -->

# Reports

## Overview

Reports turns merchant activity into records you can inspect and share.

## Walkthrough

- Z-Report: Review the Z-Report summary.
- X-Report: Open the X-Report view.
- Staff: Review staff reporting.
- Hourly: Review activity by hour.
- On-chain transactions: Trace recorded on-chain activity.

## Takeaway

Use a report when you need detailed operational evidence.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Z-Report",
    "brief": "Review the Z-Report summary.",
    "extended": "Check the selected reporting period and revenue breakdown before printing or downloading a report.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reports.reportType.z-report",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.z-report",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "X-Report",
    "brief": "Open the X-Report view.",
    "extended": "Use this report view to review its operational totals with the currently selected period.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reports.reportType.x-report",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.x-report",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Staff",
    "brief": "Review staff reporting.",
    "extended": "Use the employee filter when you need to investigate one team member; respect the scope of the current merchant workspace.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reports.reportType.employee",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.employee",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Hourly",
    "brief": "Review activity by hour.",
    "extended": "Hourly data helps reveal busy periods. Compare equivalent windows when evaluating staffing needs.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reports.reportType.hourly",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.hourly",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.hourly.content",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "On-chain transactions",
    "brief": "Trace recorded on-chain activity.",
    "extended": "Transaction filters, index status and reporting coverage help explain what the ledger includes. Exporting is optional and remains your action.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reports.reportType.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.transactions",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reports.reportType.transactions.content",
          "source": "src/app/(web)/admin/panels/ReportsPanelMerchant.tsx"
        }
      }
    ]
  }
]
```
