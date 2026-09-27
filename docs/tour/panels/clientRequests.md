<!-- tour {"panel":"clientRequests","order":380} -->

# Client Requests

## Overview

Client Requests is the review workspace for merchant onboarding.

## Walkthrough

- Client requests: Review merchant onboarding requests.
- Request search: Find a merchant request before reviewing it.

## Takeaway

Know how a merchant application moves through review.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Client requests",
    "brief": "Review merchant onboarding requests.",
    "extended": "Use request status and supporting details to distinguish new applications from active merchants.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "clientRequests.client-requests",
          "source": "src/app/(web)/admin/panels/ClientRequestsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Request search",
    "brief": "Find a merchant request before reviewing it.",
    "extended": "Search reduces the chance of applying an action to the wrong merchant. Approval, rejection, blocking and deletion affect live access.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "clientRequests.request-search",
          "source": "src/app/(web)/admin/panels/ClientRequestsPanel.tsx"
        }
      }
    ]
  }
]
```
