<!-- tour {"panel":"rewards","order":40} -->

# Rewards

## Overview

Rewards explains your progress and benefits across participating shops.

## Walkthrough

- Reward cards: Cards group your rewards by merchant.
- Reward list: List View provides another way to compare merchant rewards.

## Takeaway

Understand where your rewards come from and how to track progress.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Reward cards",
    "brief": "Cards group your rewards by merchant.",
    "extended": "Review the available merchant reward cards and their progress. Open a particular card yourself for its history, offers and merchant-specific reward rules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "rewards.activeTab.my-rewards",
          "source": "src/app/(web)/admin/panels/RewardsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "rewards.activeTab.my-rewards",
          "source": "src/app/(web)/admin/panels/RewardsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Reward list",
    "brief": "List View provides another way to compare merchant rewards.",
    "extended": "Use the list to locate a merchant and compare the progress information actually shown. Reward availability depends on each program.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "rewards.activeTab.system-breakdown",
          "source": "src/app/(web)/admin/panels/RewardsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "rewards.activeTab.system-breakdown",
          "source": "src/app/(web)/admin/panels/RewardsPanel.tsx"
        }
      }
    ]
  }
]
```
