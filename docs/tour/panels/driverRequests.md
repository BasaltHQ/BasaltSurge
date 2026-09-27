<!-- tour {"panel":"driverRequests","order":400} -->

# Driver Requests

## Overview

Driver Requests is the driver approval board.

## Walkthrough

- Pending drivers: Start with applications awaiting approval.
- Active drivers: Review drivers already approved for service.
- All driver requests: Use All to see the wider application history.

## Takeaway

Find a driver's application and its supporting records.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Pending drivers",
    "brief": "Start with applications awaiting approval.",
    "extended": "Review the driver’s information and policy documents before activating a license.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "driverRequests.activeFilter.pending",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "driverRequests.activeFilter.pending",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Active drivers",
    "brief": "Review drivers already approved for service.",
    "extended": "A suspension or activation changes operational access; the tour only opens the list.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "driverRequests.activeFilter.approved",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "driverRequests.activeFilter.approved",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "All driver requests",
    "brief": "Use All to see the wider application history.",
    "extended": "Search by driver, wallet or vehicle class to locate a specific record.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "driverRequests.activeFilter.all",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "driverRequests.activeFilter.all",
          "source": "src/app/(web)/admin/panels/DriverRequestsPanel.tsx"
        }
      }
    ]
  }
]
```
