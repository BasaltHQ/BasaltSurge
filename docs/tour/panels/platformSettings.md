<!-- tour {"panel":"platformSettings","order":490} -->

# Settings

## Overview

Settings contains platform-wide configuration.

## Walkthrough

- Platform feature switches: Review capabilities enabled at platform level.
- Split parameters: Review the debit and credit fee parameters.

## Takeaway

Recognize settings whose effects extend across {{platformName}}.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Platform feature switches",
    "brief": "Review capabilities enabled at platform level.",
    "extended": "Platform switches affect the offering across the workspace. Check scope before changing availability.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "platformSettings.platform-feature-switches",
          "source": "src/app/(web)/admin/panels/PlatformSettingsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Split parameters",
    "brief": "Review the debit and credit fee parameters.",
    "extended": "Read the basis-point units and routing context carefully. Changes influence financial configuration and are not demonstrated automatically.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "platformSettings.split-parameters",
          "source": "src/app/(web)/admin/panels/PlatformSettingsPanel.tsx"
        }
      }
    ]
  }
]
```
