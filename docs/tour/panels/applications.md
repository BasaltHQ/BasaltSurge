<!-- tour {"panel":"applications","order":470} -->

# Applications

## Overview

Applications manages applications for partner experiences.

## Walkthrough

- Partner applications: Review partner applications and their status.
- Application synchronization: Sync All Approved applies changes across approved applications.

## Takeaway

Understand the route into the partner ecosystem.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Partner applications",
    "brief": "Review partner applications and their status.",
    "extended": "Administrative decisions can change partner access. Review the relevant application before approving, rejecting or syncing it.",
    "optional": "The application management view is available to authorized administrators.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "applications.partner-applications",
          "source": "src/app/(web)/admin/panels/ApplicationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Application synchronization",
    "brief": "Sync All Approved applies changes across approved applications.",
    "extended": "This is a bulk operational action. The guide highlights it to explain its scope without running it.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "applications.application-synchronization",
          "source": "src/app/(web)/admin/panels/ApplicationsPanel.tsx"
        }
      }
    ]
  }
]
```
