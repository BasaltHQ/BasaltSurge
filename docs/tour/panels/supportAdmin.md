<!-- tour {"panel":"supportAdmin","order":550} -->

# Support Admin

## Overview

Support Admin is the service desk for incoming support conversations.

## Walkthrough

- Support inbox search: Find the support request you want to investigate.
- Support conversation: Select a ticket to work on its conversation.

## Takeaway

Follow a support request from triage to response.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Support inbox search",
    "brief": "Find the support request you want to investigate.",
    "extended": "Search and status filters help prioritize work. Ticket bodies and user attachments are not read by the interface tools.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "supportAdmin.support-inbox-search",
          "source": "src/app/(web)/admin/panels/SupportAdminPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Support conversation",
    "brief": "Select a ticket to work on its conversation.",
    "extended": "The inbox opens a ticket detail view after you choose it. Replying and changing status affect the real support case.",
    "optional": "This orientation is displayed when no support ticket is selected.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "supportAdmin.support-conversation",
          "source": "src/app/(web)/admin/panels/SupportAdminPanel.tsx"
        }
      }
    ]
  }
]
```
