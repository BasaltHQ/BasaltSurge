<!-- tour {"panel":"emailConfig","order":310} -->

# Email Settings

## Overview

Email Settings configures branded outbound email.

## Walkthrough

- Sender configuration: Set the identity used for outgoing email.
- Sender verification: Review the email verification state.

## Takeaway

Know how a brand establishes its email sender identity.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Sender configuration",
    "brief": "Set the identity used for outgoing email.",
    "extended": "The sender name and sender email or domain should match the active partner brand.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "emailConfig.sender-configuration",
          "source": "src/app/(web)/admin/panels/EmailConfigPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Sender verification",
    "brief": "Review the email verification state.",
    "extended": "DNS verification and provider status determine whether the sender is ready. Checking status differs from sending a test message.",
    "optional": "Verification details appear after a sender is configured.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "emailConfig.sender-verification",
          "source": "src/app/(web)/admin/panels/EmailConfigPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "DNS records",
    "brief": "Use the supplied DNS records to verify the sender.",
    "extended": "Copy the exact records into your domain provider when configuring email. This tour does not edit external DNS.",
    "mode": "extended",
    "optional": "DNS records are available after sender configuration.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "emailConfig.dns-records",
          "source": "src/app/(web)/admin/panels/EmailConfigPanel.tsx"
        }
      }
    ]
  }
]
```
