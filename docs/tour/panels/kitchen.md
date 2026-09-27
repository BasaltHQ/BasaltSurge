<!-- tour {"panel":"kitchen","order":210} -->

# Kitchen

## Overview

Kitchen organizes incoming restaurant work for preparation.

## Walkthrough

- Kitchen board: The kitchen board organizes incoming preparation work.
- Kitchen synchronization: Sync refreshes the kitchen board.

## Takeaway

Follow an order through preparation.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Kitchen board",
    "brief": "The kitchen board organizes incoming preparation work.",
    "extended": "Read the station and order-state information before acting on a ticket. Advancing or completing a ticket changes live operations.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "kitchen.kitchen-board",
          "source": "src/components/admin/KitchenDisplayPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Kitchen synchronization",
    "brief": "Sync refreshes the kitchen board.",
    "extended": "Use Sync when you need to refresh operational data. The tour does not change ticket states.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "kitchen.kitchen-synchronization",
          "source": "src/components/admin/KitchenDisplayPanel.tsx"
        }
      }
    ]
  }
]
```
