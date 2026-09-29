<!-- tour {"panel":"contracts","order":500} -->

# Contracts

## Overview

Contracts is the administration workspace for contract-related operations.

## Walkthrough

- Standard agreement: Find the standard merchant agreement resources.
- Agent agreement: Find the introducer and sales agent agreement.

## Takeaway

Identify the right contract and review it before acting.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Standard agreement",
    "brief": "Find the standard merchant agreement resources.",
    "extended": "Review the agreement for the relevant party and business context. The tour explains where documents live without signing them.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "contracts.standard-agreement",
          "source": "src/app/(web)/admin/panels/ContractsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Agent agreement",
    "brief": "Find the introducer and sales agent agreement.",
    "extended": "This agreement serves a different relationship from the standard merchant agreement. Choose the correct document before sending or signing.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "contracts.agent-agreement",
          "source": "src/app/(web)/admin/panels/ContractsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Agreement reference",
    "brief": "Use the reference information to locate the right agreement.",
    "extended": "Return here when you need agreement context; the tour does not provide a legal interpretation of the contract.",
    "mode": "extended",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "contracts.agreement-reference",
          "source": "src/app/(web)/admin/panels/ContractsPanel.tsx"
        }
      }
    ]
  }
]
```
