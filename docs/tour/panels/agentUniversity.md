<!-- tour {"panel":"agentUniversity","order":560} -->

# Agent University

## Overview

Agent University organizes training resources for sales agents.

## Walkthrough

- Training library: Find the training resources available to agents.
- Training uploads: Authorized users can add training videos here.

## Takeaway

Know where agent education continues after this tour.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Training library",
    "brief": "Find the training resources available to agents.",
    "extended": "Choose a course according to the skill you want to practice. Available videos depend on the published training library.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "agentUniversity.training-library",
          "source": "src/app/(web)/admin/panels/AgentUniversityPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Training uploads",
    "brief": "Authorized users can add training videos here.",
    "extended": "Uploads require a course title, category and video package. The tour does not upload or publish training material.",
    "optional": "This view depends on your permissions, enabled module, or existing records. If unavailable, the guide will identify it and continue only when you choose.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "agentUniversity.training-uploads",
          "source": "src/app/(web)/admin/panels/AgentUniversityPanel.tsx"
        }
      }
    ]
  }
]
```
