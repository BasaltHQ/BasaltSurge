<!-- tour {"panel":"publications","order":530} -->

# Publications

## Overview

Publications is {{platformName}} review desk for publishing workflows.

## Walkthrough

- Publication submissions: Review titles awaiting approval.
- Publication catalog: Browse the approved publication catalog.
- USBN contracts: Find publication contract deployment and verification.
- Publication revisions: Review changes submitted to existing titles.

## Takeaway

Know how content is reviewed and managed.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Publication submissions",
    "brief": "Review titles awaiting approval.",
    "extended": "Inspect the title, files, rights and identifiers before making a publishing decision.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "publications.activeTab.submissions",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.submissions",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Publication catalog",
    "brief": "Browse the approved publication catalog.",
    "extended": "Search by title, author or ISBN and verify the item before changing it.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "publications.activeTab.catalog",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.catalog",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.catalog.content",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "USBN contracts",
    "brief": "Find publication contract deployment and verification.",
    "extended": "Contract deployment is an on-chain action. The tour opens this view without deploying or verifying a contract.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "publications.activeTab.contracts",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.contracts",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Publication revisions",
    "brief": "Review changes submitted to existing titles.",
    "extended": "Compare the current live version with the proposed revision before approving changes.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "publications.activeTab.revisions",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.revisions",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "publications.activeTab.revisions.content",
          "source": "src/app/(web)/admin/panels/PublicationsPanel.tsx"
        }
      }
    ]
  }
]
```
