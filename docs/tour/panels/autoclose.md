<!-- tour {"panel":"autoclose","order":430} -->

# Autoclose

## Overview

Autoclose monitors scheduled payment completion and recovery workflows.

## Walkthrough

- Settlement scheduling: Review the automatic settlement workflow.
- Stuck payment recovery: Find the recovery workflow for stuck payments.

## Takeaway

Know where to investigate payment completion issues.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Settlement scheduling",
    "brief": "Review the automatic settlement workflow.",
    "extended": "The scheduler summarizes settlement activity. Manual closes and recovery actions operate on live payments.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "autoclose.settlement-scheduling",
          "source": "src/app/(web)/admin/panels/AutoclosePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Stuck payment recovery",
    "brief": "Find the recovery workflow for stuck payments.",
    "extended": "Investigate the payment state before attempting recovery. The tour does not close or retry payments.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "autoclose.stuck-payment-recovery",
          "source": "src/app/(web)/admin/panels/AutoclosePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Pending bank transfers",
    "brief": "Review pending ACH transfers separately.",
    "extended": "Bank transfer timing differs from on-chain settlement. Follow the displayed status and operational procedure.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "autoclose.pending-bank-transfers",
          "source": "src/app/(web)/admin/panels/AutoclosePanel.tsx"
        }
      }
    ]
  }
]
```
