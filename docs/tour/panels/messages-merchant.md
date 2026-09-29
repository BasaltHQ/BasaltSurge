<!-- tour {"panel":"messages-merchant","order":110} -->

# Messages

## Overview

Merchant messages collect customer conversations for the active shop.

## Walkthrough

- Conversation search: Find the conversation you need.
- All conversations: All shows your available conversations.
- Unread conversations: Unread focuses on conversations needing attention.

## Takeaway

Respond to customers from the correct business workspace.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Conversation search",
    "brief": "Find the conversation you need.",
    "extended": "Search conversations before choosing a thread. The guide does not read message bodies or send replies.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "messages-buyer.conversation-search",
          "source": "src/app/(web)/admin/panels/MessagesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "All conversations",
    "brief": "All shows your available conversations.",
    "extended": "Use this view to return from a filtered inbox and locate earlier conversations.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "messages.filterMode.all",
          "source": "src/app/(web)/admin/panels/MessagesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "messages.filterMode.all",
          "source": "src/app/(web)/admin/panels/MessagesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Unread conversations",
    "brief": "Unread focuses on conversations needing attention.",
    "extended": "An empty unread view can mean you are caught up. Selecting a conversation may mark messages as read, so choose the actual thread yourself.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "messages.filterMode.unread",
          "source": "src/app/(web)/admin/panels/MessagesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "messages.filterMode.unread",
          "source": "src/app/(web)/admin/panels/MessagesPanel.tsx"
        }
      }
    ]
  }
]
```
