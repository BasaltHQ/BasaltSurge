<!-- tour {"panel":"plugins","order":360} -->

# Plugins

## Overview

Plugins manages the integrations available to the partner ecosystem.

## Walkthrough

- Full plugin grid: Review available integrations in full plugin grid.
- Compact plugin grid: Review available integrations in compact plugin grid.
- Plugin list: Review available integrations in plugin list.

## Takeaway

Make the appropriate integrations available to your merchants.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Full plugin grid",
    "brief": "Review available integrations in full plugin grid.",
    "extended": "Catalog status distinguishes availability from configuration. Select an enabled provider yourself when you are ready to configure it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "plugins.viewMode.grid-full",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "plugins.viewMode.grid-full",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Compact plugin grid",
    "brief": "Review available integrations in compact plugin grid.",
    "extended": "Catalog status distinguishes availability from configuration. Select an enabled provider yourself when you are ready to configure it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "plugins.viewMode.grid-compact",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "plugins.viewMode.grid-compact",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Plugin list",
    "brief": "Review available integrations in plugin list.",
    "extended": "Catalog status distinguishes availability from configuration. Select an enabled provider yourself when you are ready to configure it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "plugins.viewMode.list",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "plugins.viewMode.list",
          "source": "src/app/(web)/admin/panels/PartnerPluginsPanel.tsx"
        }
      }
    ]
  }
]
```
