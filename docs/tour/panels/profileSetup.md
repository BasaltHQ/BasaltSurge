<!-- tour {"panel":"profileSetup","order":10} -->

# My Profile

## Overview

Your profile is your identity across shops and conversations.

## Walkthrough

- Your identity: Your profile is the identity people see across {{platformName}}.
- Edit your profile: Use Edit when you want to change your public profile.

## Takeaway

Know where to keep your customer identity up to date.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Your identity",
    "brief": "Your profile is the identity people see across {{platformName}}.",
    "extended": "Review the displayed identity and profile presentation. Profile settings are personal; they do not grant administrative access.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "profileSetup.your-identity",
          "source": "src/components/admin/panels/profile-panel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Edit your profile",
    "brief": "Use Edit when you want to change your public profile.",
    "extended": "The Edit control opens the profile editor. Review your public information before saving; the tour leaves the current profile intact.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "profileSetup.edit-your-profile",
          "source": "src/components/admin/panels/profile-panel.tsx"
        }
      }
    ]
  }
]
```
