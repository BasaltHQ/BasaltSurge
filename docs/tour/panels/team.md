<!-- tour {"panel":"team","order":120} -->

# Team

## Overview

Team manages the people and permissions behind merchant operations.

## Walkthrough

- Team roster: The roster shows the people working in this merchant workspace.
- Roles and permissions: Roles define which merchant tools teammates may use.
- Sessions and payouts: Review shift sessions and payout information together.

## Takeaway

Give colleagues the access required for their work.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Team roster",
    "brief": "The roster shows the people working in this merchant workspace.",
    "extended": "Use the roster to locate a member. A member detail screen has its own Overview, Sessions, Tips, Performance and Settings views; choose the person yourself before exploring their records.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "team.mainTab.roster",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "team.mainTab.roster",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Roles and permissions",
    "brief": "Roles define which merchant tools teammates may use.",
    "extended": "Compare system roles and custom roles before assigning access. Permissions apply to this merchant workspace, not every shop on the platform.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "team.mainTab.roles",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "team.mainTab.roles",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Sessions and payouts",
    "brief": "Review shift sessions and payout information together.",
    "extended": "Session and payout actions affect staff records and money. The tour opens this view without ending shifts or paying tips.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "team.mainTab.sessions_payouts",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "team.mainTab.sessions_payouts",
          "source": "src/app/(web)/admin/panels/TeamPanel.tsx"
        }
      }
    ]
  }
]
```
