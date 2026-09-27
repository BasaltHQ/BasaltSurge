<!-- tour {"panel":"integrations","order":130} -->

# Integrations

## Overview

Integrations connects your shop to supported commerce and payment services.

## Walkthrough

- Connected integrations: Review external services available for this shop.
- Provider configuration: Inspect the provider cards before connecting a service.

## Takeaway

Know where to connect the services your shop uses.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Connected integrations",
    "brief": "Review external services available for this shop.",
    "extended": "Provider cards show the integrations this workspace can configure. Availability and setup requirements vary by provider.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "integrations.connected-integrations",
          "source": "src/app/(web)/admin/panels/IntegrationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Provider configuration",
    "brief": "Inspect the provider cards before connecting a service.",
    "extended": "Read provider status and setup options. Connecting, syncing or disconnecting requires a deliberate action by you.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "integrations.provider-configuration",
          "source": "src/app/(web)/admin/panels/IntegrationsPanel.tsx"
        }
      }
    ]
  }
]
```
