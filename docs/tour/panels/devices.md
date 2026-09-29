<!-- tour {"panel":"devices","order":340} -->

# Devices

## Overview

Devices monitors the touchpoint hardware in your administrative scope.

## Walkthrough

- Device monitoring: Review the devices attached to the workspace.
- Provisioning entry point: Provision Device begins new device enrollment.
- Installer workflow: Touchpoint Provisioning provides the installation workflow.

## Takeaway

Connect device health with the business it serves.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Device monitoring",
    "brief": "Review the devices attached to the workspace.",
    "extended": "Use device status to understand operational readiness. Resetting or deprovisioning a device affects live equipment.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "devices.device-monitoring",
          "source": "src/app/(web)/admin/panels/TouchpointMonitoringPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Provisioning entry point",
    "brief": "Provision Device begins new device enrollment.",
    "extended": "Enrollment requires the correct device, merchant and brand context. The tour does not provision a device.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "devices.provisioning-entry-point",
          "source": "src/app/(web)/admin/panels/TouchpointMonitoringPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Installer workflow",
    "brief": "Touchpoint Provisioning provides the installation workflow.",
    "extended": "Select the intended brand and device interface before installing. Hardware actions remain under your control.",
    "actions": [
      {
        "type": "highlight",
        "resource": {
          "target": "devices.installer-workflow",
          "source": "src/app/(web)/admin/panels/DeviceInstallerPanel.tsx"
        }
      }
    ]
  }
]
```
