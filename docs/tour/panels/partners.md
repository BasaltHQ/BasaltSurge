<!-- tour {"panel":"partners","order":480} -->

# Partners

## Overview

Partners manages partner brands and their configuration.

## Walkthrough

- Partner management: Manage the brands served by the platform.
- New partner identity: A brand key identifies a partner workspace.
- Partner configuration: Review the selected brand’s operational configuration.

## Takeaway

Manage each partner in its own brand context.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Partner management",
    "brief": "Manage the brands served by the platform.",
    "extended": "Choose the intended partner before reviewing its settings. These controls can affect an entire partner workspace.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "partners.partner-management",
          "source": "src/app/(web)/admin/panels/PartnerManagementPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "New partner identity",
    "brief": "A brand key identifies a partner workspace.",
    "extended": "Creating a brand is separate from configuring its identity, fees and deployment. The tour does not create a partner.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "partners.new-partner-identity",
          "source": "src/app/(web)/admin/panels/PartnerManagementPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Partner configuration",
    "brief": "Review the selected brand’s operational configuration.",
    "extended": "The selected brand has its own fees, identity and deployment settings. Credentials remain private and are never read by the guide.",
    "optional": "Select a configured partner to see its settings.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "partners.partner-configuration",
          "source": "src/app/(web)/admin/panels/PartnerManagementPanel.tsx"
        }
      }
    ]
  }
]
```
