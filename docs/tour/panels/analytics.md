<!-- tour {"panel":"analytics","order":170} -->

# Analytics

## Overview

Merchant analytics helps you understand the performance of the selected shop.

## Walkthrough

- Sales analytics: Use analytics to understand merchant activity.
- Reporting window: Choose a custom starting point for analysis.

## Takeaway

Read each metric in its shop and time context.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Sales analytics",
    "brief": "Use analytics to understand merchant activity.",
    "extended": "Read the visible measures together with their date range. A missing metric may reflect unavailable data rather than zero activity.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.sales-analytics",
          "source": "src/components/admin/panels/analytics-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Reporting window",
    "brief": "Choose a custom starting point for analysis.",
    "extended": "Preset windows and Custom since define the period being compared. The guide highlights the selector without changing your query.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "analytics.reporting-window",
          "source": "src/components/admin/panels/analytics-panel.tsx"
        }
      }
    ]
  }
]
```
