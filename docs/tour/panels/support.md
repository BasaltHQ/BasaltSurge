<!-- tour {"panel":"support","order":620} -->

# Support

## Overview

Support is the place to ask for help or report a problem.

## Walkthrough

- Support center: Review your requests for help.
- New support request: Start a request when you need help with {{platformName}}.

## Takeaway

Know how to reach the team when you need help.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Support center",
    "brief": "Review your requests for help.",
    "extended": "Existing tickets and their status help you follow a support issue over time. Choose the actual ticket yourself.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "support.support-center",
          "source": "src/app/(web)/admin/panels/GetSupportPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "New support request",
    "brief": "Start a request when you need help with {{platformName}}.",
    "extended": "A useful request describes the issue, expected behavior and steps to reproduce it. Do not include credentials. The tour does not submit a ticket.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "support.new-support-request",
          "source": "src/app/(web)/admin/panels/GetSupportPanel.tsx"
        }
      }
    ]
  }
]
```
