<!-- tour {"panel":"updates","order":540} -->

# Updates

## Overview

Updates manages product news and release communication.

## Walkthrough

- System updates: Review announcements and roadmap communications.
- Newsletter studio: Compose branded email communications here.

## Takeaway

Find where platform changes are communicated.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "System updates",
    "brief": "Review announcements and roadmap communications.",
    "extended": "Published updates should match the intended audience. Creating, editing and publishing remain deliberate actions.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "updates.activeTab.system",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "updates.activeTab.system",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "updates.activeTab.system.content",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Newsletter studio",
    "brief": "Compose branded email communications here.",
    "extended": "Review recipients, subject and content blocks before sending. This tour never broadcasts a message.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "updates.activeTab.newsletter",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "updates.activeTab.newsletter",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "updates.activeTab.newsletter.content",
          "source": "src/components/admin/panels/updates-panel.tsx"
        }
      }
    ]
  }
]
```
