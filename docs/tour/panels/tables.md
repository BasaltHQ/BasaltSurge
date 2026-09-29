<!-- tour {"panel":"tables","order":220} -->

# Tables

## Overview

Tables configures restaurant seating and table-linked ordering.

## Walkthrough

- Restaurant tables: Manage the table labels used in service.
- Table naming: New tables can use a number or a descriptive name.

## Takeaway

Connect the physical table with the ordering workflow.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Restaurant tables",
    "brief": "Manage the table labels used in service.",
    "extended": "Review the existing table list before adding or removing a table; these labels connect to restaurant workflows.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "tables.restaurant-tables",
          "source": "src/app/(web)/admin/panels/TablesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Table naming",
    "brief": "New tables can use a number or a descriptive name.",
    "extended": "Use consistent labels such as Patio 2 so staff can identify tables. The tour leaves the table list unchanged.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "tables.table-naming",
          "source": "src/app/(web)/admin/panels/TablesPanel.tsx"
        }
      }
    ]
  }
]
```
