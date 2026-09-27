<!-- tour {"panel":"seoPages","order":350} -->

# SEO Pages

## Overview

SEO Pages manages landing-page content and templates.

## Walkthrough

- SEO pages: Review landing pages and their publication state.
- Base templates: Base Templates holds reusable landing-page content.

## Takeaway

Understand where discoverable landing-page content is managed.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "SEO pages",
    "brief": "Review landing pages and their publication state.",
    "extended": "Inspect page metadata and category filters before enabling or editing a page.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "seoPages.viewMode.pages",
          "source": "src/app/(web)/admin/panels/SEOLandingPagesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "seoPages.viewMode.pages",
          "source": "src/app/(web)/admin/panels/SEOLandingPagesPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Base templates",
    "brief": "Base Templates holds reusable landing-page content.",
    "extended": "A template can affect multiple pages. Review the section and category before saving changes.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "seoPages.viewMode.templates",
          "source": "src/app/(web)/admin/panels/SEOLandingPagesPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "seoPages.viewMode.templates",
          "source": "src/app/(web)/admin/panels/SEOLandingPagesPanel.tsx"
        }
      }
    ]
  }
]
```
