<!-- tour {"panel":"roadmap","order":440} -->

# Roadmap

## Overview

Roadmap shows planned work and product direction.

## Walkthrough

- Product roadmap: Read the published roadmap and updates.
- Release timeline: Read updates in their published date and category context.

## Takeaway

Use the roadmap to understand what is planned.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Product roadmap",
    "brief": "Read the published roadmap and updates.",
    "extended": "Use this panel to understand planned and released work. Roadmap information is descriptive and does not enable unavailable features.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "roadmap.product-roadmap",
          "source": "src/components/admin/panels/roadmap-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Release timeline",
    "brief": "Read updates in their published date and category context.",
    "extended": "Each entry supplies a category, date and description. Use these details to distinguish a new feature from an improvement or announcement.",
    "optional": "The timeline appears when published roadmap entries are available.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "roadmap.timeline",
          "source": "src/components/admin/panels/roadmap-panel.tsx"
        }
      }
    ]
  }
]
```
