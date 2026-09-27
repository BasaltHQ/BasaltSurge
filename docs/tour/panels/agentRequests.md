<!-- tour {"panel":"agentRequests","order":390} -->

# Agent Requests

## Overview

Agent Requests manages sales-agent applications and registration.

## Walkthrough

- Agent requests: Review the agents applying to participate.
- Agent search: Locate an agent by name, email or wallet.

## Takeaway

Support the agent onboarding workflow deliberately.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Agent requests",
    "brief": "Review the agents applying to participate.",
    "extended": "Check the applicant details and current status before approving, rejecting or revoking access.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "agentRequests.agent-requests",
          "source": "src/app/(web)/admin/panels/AgentRequestsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Agent search",
    "brief": "Locate an agent by name, email or wallet.",
    "extended": "Use the request filters to focus review. The tour does not submit a decision.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "agentRequests.agent-search",
          "source": "src/app/(web)/admin/panels/AgentRequestsPanel.tsx"
        }
      }
    ]
  }
]
```
