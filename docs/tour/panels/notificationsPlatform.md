<!-- tour {"panel":"notificationsPlatform","order":580} -->

# Notifications

## Overview

Platform notifications controls alerts for platform-level events.

## Walkthrough

- Notification settings: Review alerts for this platform scope.
- Recipient target: Choose who receives these notifications.
- Notification types: Review which events send notifications.

## Takeaway

Route platform events to the people responsible.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Notification settings",
    "brief": "Review alerts for this platform scope.",
    "extended": "Notification scopes can differ. Check this scope before changing recipients or notification types.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "notificationsMerchant.notification-settings",
          "source": "src/app/(web)/admin/panels/NotificationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Recipient target",
    "brief": "Choose who receives these notifications.",
    "extended": "Overall recipients provide the default destination. Verify recipients before enabling delivery.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "notificationsMerchant.recipient-target",
          "source": "src/app/(web)/admin/panels/NotificationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Notification types",
    "brief": "Review which events send notifications.",
    "extended": "Individual types may support recipient overrides. An override can route that event differently from the overall recipient list.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "notificationsMerchant.notification-types",
          "source": "src/app/(web)/admin/panels/NotificationsPanel.tsx"
        }
      }
    ]
  }
]
```
