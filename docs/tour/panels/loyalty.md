<!-- tour {"panel":"loyalty","order":140} -->

# Loyalty Config

## Overview

Loyalty Config defines your merchant rewards program.

## Walkthrough

- Configuration: Set the structure of the reward program.
- Leaderboard: Compare participation in the loyalty program.
- Discounts: Manage automatic offers.
- Coupons: Manage code-based offers.
- Level Rewards: See rewards unlocked at particular levels.
- Level Art: Review the visual identity of program levels.
- Roles & Titles: Review the titles attached to loyalty levels.

## Takeaway

Connect customer incentives to a clear merchant program.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Configuration",
    "brief": "Set the structure of the reward program.",
    "extended": "Review the XP earning curve and level progression. The editor, simulator and recommendation views help you evaluate changes before saving.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.config",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.config",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Leaderboard",
    "brief": "Compare participation in the loyalty program.",
    "extended": "Rankings reflect the available program data; do not treat rank alone as a measure of revenue.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.leaderboard",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.leaderboard",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Discounts",
    "brief": "Manage automatic offers.",
    "extended": "Review discount scope, eligibility and dates before publishing an offer.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.discounts",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.discounts",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Coupons",
    "brief": "Manage code-based offers.",
    "extended": "Coupon codes, usage limits and validity dates control redemption. The tour never creates or redeems a code.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.coupons",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.coupons",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Level Rewards",
    "brief": "See rewards unlocked at particular levels.",
    "extended": "Match reward thresholds to the program curve and review fulfillment details before saving.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.rewards",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.rewards",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-6",
    "title": "Level Art",
    "brief": "Review the visual identity of program levels.",
    "extended": "Art gives levels a recognizable appearance. Choose assets that fit your brand and remain readable.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.art",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.art",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-7",
    "title": "Roles & Titles",
    "brief": "Review the titles attached to loyalty levels.",
    "extended": "Loyalty titles describe progression and should not be confused with admin permission roles.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "loyalty.activeTab.roles",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "loyalty.activeTab.roles",
          "source": "src/app/(web)/admin/panels/LoyaltyPanel.tsx"
        }
      }
    ]
  }
]
```
