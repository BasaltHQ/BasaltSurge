<!-- tour {"panel":"pms","order":240} -->

# PMS

## Overview

PMS opens the property management workflow for hotel operations.

## Walkthrough

- Property management: PMS organizes your hotel properties.
- Property setup: New accounts begin by creating a property.

## Takeaway

Find the hotel workflow relevant to your role.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Property management",
    "brief": "PMS organizes your hotel properties.",
    "extended": "Property cards lead into the property application. This console tour explains the available entry points without leaving your admin session.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "pms.property-management",
          "source": "src/components/admin/PMSPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Property setup",
    "brief": "New accounts begin by creating a property.",
    "extended": "Use the setup control when you have the real property information ready. No property is created by the tour.",
    "optional": "This introduction is shown only when there are no properties.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "pms.property-setup",
          "source": "src/components/admin/PMSPanel.tsx"
        }
      }
    ]
  }
]
```
