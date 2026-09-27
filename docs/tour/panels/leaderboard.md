<!-- tour {"panel":"leaderboard","order":150} -->

# Loyalty Leaderboard

## Overview

The loyalty leaderboard shows engagement and customer progress.

## Walkthrough

- Loyalty rankings: See participation in your merchant loyalty program.
- Rankings and progress: Compare the displayed rank, XP and spending information.

## Takeaway

Use rankings to understand participation in your loyalty program.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Loyalty rankings",
    "brief": "See participation in your merchant loyalty program.",
    "extended": "Compare the displayed rank and progress measures. Rankings follow the program rules and available data.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "leaderboard.loyalty-rankings",
          "source": "src/components/admin/panels/leaderboard-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Rankings and progress",
    "brief": "Compare the displayed rank, XP and spending information.",
    "extended": "The ranking list includes available buyer profiles and program progress. An empty list means no matching buyers are available; it does not prove a program is disabled.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "leaderboard.rankings",
          "source": "src/components/admin/panels/leaderboard-panel.tsx"
        }
      }
    ]
  }
]
```
