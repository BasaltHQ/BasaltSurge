<!-- tour {"panel":"cannabisCompliance","order":260} -->

# Compliance

## Overview

Compliance organizes cannabis operations and provider integrations.

## Walkthrough

- Compliance dashboard: Start with compliance status.
- Provider integrations: Review your regulatory provider connection.
- Audit and reconciliation: Review audit and reconciliation tools.
- Plants: Review plant records.
- Packages: Review package records.
- Harvests: Review harvest activity.
- Transfers: Review transfers.
- Sales: Review sales records.
- Lab tests: Review laboratory tests.
- Reports: Locate compliance reports.

## Takeaway

Find the operational records and connected compliance provider.

## Actions

```json
[
  {
    "id": "step-1",
    "title": "Compliance dashboard",
    "brief": "Start with compliance status.",
    "extended": "Review the provider and license context before interpreting the operational data.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.dashboard",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.dashboard",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-2",
    "title": "Provider integrations",
    "brief": "Review your regulatory provider connection.",
    "extended": "Credentials stay private. Connection tests and configuration changes remain your actions.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.integrations",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.integrations",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-3",
    "title": "Audit and reconciliation",
    "brief": "Review audit and reconciliation tools.",
    "extended": "Reconciliation compares records; the tour does not sync, bypass or dismiss entries.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.audit",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.audit",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-4",
    "title": "Plants",
    "brief": "Review plant records.",
    "extended": "Plant workflows depend on the configured license and regulatory provider.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.plants",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.plants",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-5",
    "title": "Packages",
    "brief": "Review package records.",
    "extended": "Inspect package information before making any tracking changes.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.packages",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.packages",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-6",
    "title": "Harvests",
    "brief": "Review harvest activity.",
    "extended": "Harvest and processing workflows depend on the provider and license scope.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.harvests",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.harvests",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-7",
    "title": "Transfers",
    "brief": "Review transfers.",
    "extended": "Transfers may report real regulated movements. No transfer is submitted during training.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.transfers",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.transfers",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-8",
    "title": "Sales",
    "brief": "Review sales records.",
    "extended": "Sales reporting depends on available provider data and configured operations.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.sales",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.sales",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-9",
    "title": "Lab tests",
    "brief": "Review laboratory tests.",
    "extended": "Inspect the available test information before making an operational decision.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.labTests",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.labTests",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  },
  {
    "id": "step-10",
    "title": "Reports",
    "brief": "Locate compliance reports.",
    "extended": "Reports provide operational records for the configured provider and region; the tour does not submit a regulatory filing.",
    "optional": "This tab depends on the configured license, provider and enabled compliance modules.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "cannabisCompliance.activeTab.reports",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "cannabisCompliance.activeTab.reports",
          "source": "src/app/(web)/admin/panels/CannabisCompliancePanel.tsx"
        }
      }
    ]
  }
]
```
