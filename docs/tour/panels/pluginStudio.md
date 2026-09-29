<!-- tour {"panel":"pluginStudio","order":510} -->

# Plugin Studio

## Overview

Plugin Studio manages integration settings for each brand in {{platformName}}. This tour keeps the selected brand and opens Shopify as a worked example of the complete provider workspace. Other providers can have fewer tabs or show unfinished features.

## Walkthrough

- Choose the brand you administer: The Brand selector determines whose plugin settings you are viewing. Check this before configuring an integration: a partner brand and the platform brand have separate settings.
- Find an integration in the catalog: The catalog shows providers, integration descriptions, categories and Enabled or Disabled badges for the selected brand. Opening a card only opens its workspace; it does not enable that integration. We will use Shopify to explore the complete setup workflow.
- Open the Shopify workspace: We have opened Shopify as our worked example. Overview summarizes the selected brand, enabled state, plugin name, tagline, features and categories. These are configuration summaries, not a live connection test.
- Understand the plugin configuration: Configuration contains the plugin availability switch, name, descriptions and listing details. The fields start in viewing mode; Edit allows changes and Save persists them for the selected brand.
- Review the authorization setup: OAuth groups redirect URLs and access scopes. Redirect URLs identify where an authorization flow returns, while scopes describe the access requested. Review these settings here before editing them.
- Understand the checkout extension: Extension controls the checkout payment-method presentation: whether it is enabled, its button label, eligibility minimum and currency, and primary and accent colors.
- Locate the deployment controls: Deploy separates Save Configuration from Deploy App. Saving records setup; Deploy App starts the external deployment workflow. Progress and CLI output appear here when a deployment runs. The tour only opens this view.
- Find deployment status: Status contains Refresh Status and the latest deployment response when one has been loaded. No status yet means this view has no response to display; it is not a success or failure result.
- Review the readiness checklist: Verification organizes readiness records into Business & Legal, Technical Requirements and App Listing Details. It includes domain and business checks, webhook and performance records, demo links and review submission status.
- Understand the publishing handoff: Publish brings together the configuration checklist, provider app identifiers, install and listing links, and Save Publish Info. Saving publish information is separate from obtaining provider approval or making an app publicly available.

## Takeaway

Check the selected brand, open a provider workspace, and distinguish configuration, authorization, checkout presentation, deployment status and publishing preparation. Viewing a tab does not enable a plugin, save changes or deploy an app.

## Actions

```json
[
  {
    "id": "brand",
    "title": "Choose the brand you administer",
    "brief": "The Brand selector determines whose plugin settings you are viewing. Check this before configuring an integration: a partner brand and the platform brand have separate settings.",
    "extended": "Plugin Studio administers integrations per brand. The Brand selector stays available in both the catalog and provider workspaces. Confirm the intended brand before making changes. This walkthrough keeps your current selection and uses Shopify as a concrete example of the configuration workflow.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.backToCatalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.brand",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "catalog",
    "title": "Find an integration in the catalog",
    "brief": "The catalog shows providers, integration descriptions, categories and Enabled or Disabled badges for the selected brand. Opening a card only opens its workspace; it does not enable that integration. We will use Shopify to explore the complete setup workflow.",
    "extended": "Full Grid gives each provider room for its description and category tags. Enabled describes availability for this brand, not proof of a working connection. Some provider workspaces have fewer tabs or are marked Coming soon. Shopify provides the complete example we will walk through, without changing the selected brand or saving settings.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.backToCatalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.viewMode.grid-full",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "compact",
    "title": "Scan the compact catalog",
    "mode": "extended",
    "brief": "Compact Grid fits more provider cards on screen while retaining their names, categories and availability badges.",
    "extended": "Compact Grid is useful when you know the provider name and want to scan more integrations at once. This changes only the catalog layout; it does not change plugin configuration or availability.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.backToCatalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.viewMode.grid-compact",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "list",
    "title": "Compare providers in a list",
    "mode": "extended",
    "brief": "List arranges the same providers in rows with descriptions and availability badges.",
    "extended": "List keeps provider names, descriptions and statuses aligned in rows. Use it to compare integrations across the catalog. Choosing a row opens the same workspace as choosing its card in either grid layout.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.backToCatalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.viewMode.list",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.catalog",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "overview",
    "title": "Open the Shopify workspace",
    "brief": "We have opened Shopify as our worked example. Overview summarizes the selected brand, enabled state, plugin name, tagline, features and categories. These are configuration summaries, not a live connection test.",
    "extended": "The workspace header identifies Shopify and the selected brand. Overview gathers the saved or currently loaded listing information so you can check the integration you are administering before editing it. The navigation separates configuration, authorization, checkout presentation, deployment and publishing. Other providers can expose a smaller set of tabs.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.overview",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.overview",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "configuration",
    "title": "Understand the plugin configuration",
    "brief": "Configuration contains the plugin availability switch, name, descriptions and listing details. The fields start in viewing mode; Edit allows changes and Save persists them for the selected brand.",
    "extended": "Use Configuration to prepare how this integration is presented and made available under the selected brand. The Enable Plugin control affects whether partners and merchants can see and configure it. Name, tagline, descriptions and other listing fields belong to this setup. Edit and Save are separate actions. Opening this tab does not change any of these settings.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.configuration",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.configuration",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "oauth",
    "title": "Review the authorization setup",
    "brief": "OAuth groups redirect URLs and access scopes. Redirect URLs identify where an authorization flow returns, while scopes describe the access requested. Review these settings here before editing them.",
    "extended": "Start with OAuth Setup Requirements, then locate the redirect URL and scope settings below it. The callback addresses connect the provider authorization flow to the app, and scopes determine the requested access. Auto-populate controls change configuration fields; they are not part of this demonstration. Credential values remain private and are not read by the guide.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.oauth",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.oauth",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "extension",
    "title": "Understand the checkout extension",
    "brief": "Extension controls the checkout payment-method presentation: whether it is enabled, its button label, eligibility minimum and currency, and primary and accent colors.",
    "extended": "This tab separates the checkout experience from the plugin listing. For example, a button label changes the wording shown to a shopper, while the eligibility minimum and currency describe when the method should be offered. The color fields control its palette. Review these fields in viewing mode; Edit and Save are the deliberate configuration workflow.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.extension",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.extension",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "deploy",
    "title": "Locate the deployment controls",
    "brief": "Deploy separates Save Configuration from Deploy App. Saving records setup; Deploy App starts the external deployment workflow. Progress and CLI output appear here when a deployment runs. The tour only opens this view.",
    "extended": "Read CLI Deployment Flow first, then locate the two action buttons. Save Configuration persists the setup, while Deploy App initiates the server-driven deployment to the provider account. The panel can display progress, a current stage and CLI output. We are locating these controls, not saving configuration, generating a package or launching a deployment.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.deploy",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.deploy",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "status",
    "title": "Find deployment status",
    "brief": "Status contains Refresh Status and the latest deployment response when one has been loaded. No status yet means this view has no response to display; it is not a success or failure result.",
    "extended": "Use Refresh Status when you want to retrieve the current deployment response. The results area shows the returned status details for the selected brand. Opening the tab alone does not run that check. If no response is displayed, avoid drawing conclusions about whether the integration is working.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.status",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.status",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "verification",
    "title": "Review the readiness checklist",
    "brief": "Verification organizes readiness records into Business & Legal, Technical Requirements and App Listing Details. It includes domain and business checks, webhook and performance records, demo links and review submission status.",
    "extended": "This is the workspace checklist for recording preparation and supporting links. The groups help you find domain and business records, technical checks, and the demo-store and screencast URLs. A checkbox records configuration in this app; it does not itself obtain external approval. We leave all checkboxes, including Bypass App Verification, unchanged.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.verification",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.content.verification",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  },
  {
    "id": "publish",
    "title": "Understand the publishing handoff",
    "brief": "Publish brings together the configuration checklist, provider app identifiers, install and listing links, and Save Publish Info. Saving publish information is separate from obtaining provider approval or making an app publicly available.",
    "extended": "The Configuration Checklist distinguishes incomplete fields, pending local changes and completed saved sections. Below it are provider organization and app identifiers, installation and listing URLs, and private credentials. Save Publish Info records this information; it does not prove that provider review has succeeded. The tour does not edit credentials, save publish information or follow external dashboard links.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.open.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        },
        "destination": {
          "target": "pluginStudio.workspace.shopify",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "activate",
        "resource": {
          "target": "pluginStudio.workspaceSection.publish",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "pluginStudio.publishChecklist",
          "source": "src/app/(web)/admin/panels/PlatformPluginsPanel.tsx"
        }
      }
    ]
  }
]
```
