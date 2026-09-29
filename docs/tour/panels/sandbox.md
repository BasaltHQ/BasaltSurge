<!-- tour {"panel":"sandbox","order":610} -->

# Sandbox

## Overview

Sandbox exposes environment-specific diagnostic and testing controls.

## Walkthrough

- Sandbox brand context: Choose the brand context used by the sandbox.
- Merchant override: The sandbox can target a merchant wallet for testing.
- Diagnostics: Review the available health and diagnostic information.

## Takeaway

Keep diagnostic work in the intended environment.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Sandbox brand context",
    "brief": "Choose the brand context used by the sandbox.",
    "extended": "The sandbox selection is separate from the live partner brand greeting in this tour. Verify the environment before testing.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "sandbox.sandbox-brand-context",
          "source": "src/app/(web)/admin/panels/SandboxPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Merchant override",
    "brief": "The sandbox can target a merchant wallet for testing.",
    "extended": "Use a known test context. The tour does not replace the merchant wallet or change sandbox settings.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "sandbox.merchant-override",
          "source": "src/app/(web)/admin/panels/SandboxPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Diagnostics",
    "brief": "Review the available health and diagnostic information.",
    "extended": "Use diagnostics to distinguish configuration issues from application errors before testing an integration.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "sandbox.diagnostics",
          "source": "src/app/(web)/admin/panels/SandboxPanel.tsx"
        }
      }
    ]
  }
]
```
