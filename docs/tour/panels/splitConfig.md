<!-- tour {"panel":"splitConfig","order":300} -->

# Split Config

## Overview

Split Config manages the configuration used for revenue distribution.

## Walkthrough

- Split versions: Split Config manages versioned fee-routing configuration.
- Platform fee: Review the platform fee in basis points.

## Takeaway

Review distribution settings in the correct brand context.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Split versions",
    "brief": "Split Config manages versioned fee-routing configuration.",
    "extended": "Review the active version before creating a replacement. Publishing can affect merchant deployment requirements.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "splitConfig.split-versions",
          "source": "src/app/(web)/admin/panels/SplitConfigPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Platform fee",
    "brief": "Review the platform fee in basis points.",
    "extended": "Keep the unit in mind when comparing this value with a percentage. The tour does not create or publish a split version.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "splitConfig.platform-fee",
          "source": "src/app/(web)/admin/panels/SplitConfigPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Version notes",
    "brief": "Describe the reason for a new split version.",
    "extended": "Clear notes make future reviews easier. Verify wallets and fee settings before creating any version.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "splitConfig.version-notes",
          "source": "src/app/(web)/admin/panels/SplitConfigPanel.tsx"
        }
      }
    ]
  }
]
```
