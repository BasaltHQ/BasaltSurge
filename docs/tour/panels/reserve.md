<!-- tour {"panel":"reserve","order":160} -->

# Reserve

## Overview

Reserve brings together settlement configuration and reserve analytics.

## Walkthrough

- Configuration: Review processing fees and reserve targets.
- Reserve analytics: Inspect reserve balances and performance.
- Transactions: Inspect the reserve transaction history.
- Tax: Find jurisdiction and tax configuration.
- Tips: Review tipping presets.
- Fiat Offramp: Find the fiat withdrawal workflow.

## Takeaway

Know where settlement settings and reserve performance live.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Configuration",
    "brief": "Review processing fees and reserve targets.",
    "extended": "Configuration includes fee settings and the reserve strategy. Some changes apply immediately, so the walkthrough leaves values untouched.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.configuration",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.configuration",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.configuration.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Reserve analytics",
    "brief": "Inspect reserve balances and performance.",
    "extended": "Read the asset labels, units and time context before comparing balances or performance.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.analytics",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.analytics",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.analytics.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Transactions",
    "brief": "Inspect the reserve transaction history.",
    "extended": "Use the ledger to trace displayed activity. A transaction record and an available balance answer different questions.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.transactions",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.transactions",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.transactions.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Tax",
    "brief": "Find jurisdiction and tax configuration.",
    "extended": "Review the default jurisdiction and available tax components for the merchant workflow.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.tax",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.tax",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.tax.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Tips",
    "brief": "Review tipping presets.",
    "extended": "Tip settings determine the presets presented on the payment portal. Changes should reflect your operational policy.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.tips",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.tips",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.tips.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  },
  {
    "id": "step-6",
    "title": "Fiat Offramp",
    "brief": "Find the fiat withdrawal workflow.",
    "extended": "Review the provider and withdrawal requirements. The tour does not initiate transfers, connect financial accounts or submit withdrawal requests.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "reserve.activeTab.offramp",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.offramp",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "reserve.activeTab.offramp.content",
          "source": "src/components/admin/reserve/ReserveTabs.tsx"
        }
      }
    ]
  }
]
```
