<!-- tour {"panel":"modules","order":290} -->

# Modules

## Overview

Modules controls which merchant capabilities are available.

## Walkthrough

- Merchant modules: Modules controls the capabilities offered to merchants.
- Bulk module changes: Enable All applies a broad module change.

## Takeaway

Understand how the available merchant workspace is shaped.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Merchant modules",
    "brief": "Modules controls the capabilities offered to merchants.",
    "extended": "Read the module descriptions and current availability before changing them.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "modules.merchant-modules",
          "source": "src/app/(web)/admin/panels/ModulesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Bulk module changes",
    "brief": "Enable All applies a broad module change.",
    "extended": "Use individual module controls for targeted changes. Bulk enable or disable affects the partner offering; the tour only highlights the control.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "modules.bulk-module-changes",
          "source": "src/app/(web)/admin/panels/ModulesPanel.tsx"
        }
      }
    ]
  }
]
```
