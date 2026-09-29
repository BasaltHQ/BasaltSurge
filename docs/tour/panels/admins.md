<!-- tour {"panel":"admins","order":410} -->

# Admin Users

## Overview

Admin Users manages administrative roles and access.

## Walkthrough

- Admin users: Review who has administrative access.
- Roles and permissions: Inspect the access capability matrix.
- Admin activity: Review recorded administrative activity.

## Takeaway

Keep administrative access aligned with responsibility.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Admin users",
    "brief": "Review who has administrative access.",
    "extended": "Check the assigned role and administrative scope before adding or changing an administrator.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "admins.activeTab.users",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "admins.activeTab.users",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Roles and permissions",
    "brief": "Inspect the access capability matrix.",
    "extended": "Compare system and custom policy roles. A loyalty title and an administrative role are separate concepts.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "admins.activeTab.roles",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "admins.activeTab.roles",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "admins.activeTab.roles.content",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Admin activity",
    "brief": "Review recorded administrative activity.",
    "extended": "Use the activity view when investigating changes. Coverage is limited to the records supplied by the application.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "admins.activeTab.activity",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "admins.activeTab.activity",
          "source": "src/app/(web)/admin/panels/AdminManagementPanel.tsx"
        }
      }
    ]
  }
]
```
