<!-- tour {"panel":"branding","order":280} -->

# Branding

## Overview

Branding controls the identity and presentation of the partner experience.

## Walkthrough

- Workspace identity: Brand Name is the customer-facing identity of {{brandName}}.
- Brand colors: Primary and accent colors establish the workspace palette.

## Takeaway

Maintain a consistent experience for your merchants and customers.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Workspace identity",
    "brief": "Brand Name is the customer-facing identity of {{brandName}}.",
    "extended": "This identity should be consistent with the welcome message, application URL and customer communications.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "branding.workspace-identity",
          "source": "src/app/(web)/admin/panels/BrandingPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Brand colors",
    "brief": "Primary and accent colors establish the workspace palette.",
    "extended": "Review contrast and readability before applying a brand palette. Tour highlights use a separate training accent.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "branding.brand-colors",
          "source": "src/app/(web)/admin/panels/BrandingPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Social presentation",
    "brief": "Open Graph settings control shared-link presentation.",
    "extended": "Review the title, description and imagery used when links are shared. Updating the brand is a live configuration change.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "branding.social-presentation",
          "source": "src/app/(web)/admin/panels/BrandingPanel.tsx"
        }
      }
    ]
  }
]
```
