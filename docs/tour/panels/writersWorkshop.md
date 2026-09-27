<!-- tour {"panel":"writersWorkshop","order":250} -->

# Writer's Workshop

## Overview

Writer's Workshop supports creating and managing publishing submissions.

## Walkthrough

- Active titles: Review the titles currently on your bookshelf.
- Archived titles: Find titles moved out of the active bookshelf.
- Series management: Organize related titles into a series.

## Takeaway

Know the route from a work in progress to a submission.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Active titles",
    "brief": "Review the titles currently on your bookshelf.",
    "extended": "Title cards expose editing and publishing workflows. Approval status and publication status determine the next real action.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "writersWorkshop.viewTab.active",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "writersWorkshop.viewTab.active",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Archived titles",
    "brief": "Find titles moved out of the active bookshelf.",
    "extended": "Archived publications are separated from current work. Review a title before restoring or changing it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "writersWorkshop.viewTab.archived",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "writersWorkshop.viewTab.archived",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Series management",
    "brief": "Organize related titles into a series.",
    "extended": "Use series management to review grouping and order. Editing or saving a series changes the catalog.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "writersWorkshop.viewTab.series",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "writersWorkshop.viewTab.series",
          "source": "src/app/(web)/admin/panels/WritersWorkshopPanel.tsx"
        }
      }
    ]
  }
]
```
