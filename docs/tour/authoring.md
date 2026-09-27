# Add a Panel Guide

Create one Markdown file in **docs/tour/panels/**. Subdirectories are supported. No catalog registration, new tool, build generator, or ElevenLabs upload is needed. A walkthrough references stable `data-tour` bindings in the panel source. Add those small attributes when building a new panel, then author its entire sequence in Markdown.

The panel itself must already be implemented and linked in the admin sidebar with its normal permission checks. Match the document's `panel` to that sidebar key. Documents describe panels; they cannot create routes or grant access.

Copy this template into `docs/tour/panels/yourPanelKey.md`:

```markdown
<!-- tour {"panel":"yourPanelKey","order":75} -->

# Your Panel Name

## Overview

Use {{panelTitle}} to manage this workflow in {{platformName}}.

## Walkthrough

- Identify the main view and its filters.
- Explain one practical workflow, using a hypothetical example.
- Review the effect of saving changes before applying them.

## Takeaway

Know where to return in {{brandName}} for this task.
```

The metadata is JSON in an HTML comment. `panel` is required. `order` is an optional nonnegative number (default 1000): lower numbers appear earlier **within their sidebar section**. Use gaps such as 10, 20, and 30 to make future insertions easy. Equal orders sort by visible panel title. The role-aware section sequence is independent of these numbers.

The title and all three prose headings are required. Put each walkthrough bullet on one line. Add an **Actions** section for a real interactive walkthrough, as described below. Both modes visit every main tab; Brief uses each step's short explanation, while Extended uses its detailed explanation and any extra detail steps. The same content is returned to the AI trainer and published as a readable docs page.

## Structured actions

Add this section after Takeaway. The array order is the teaching order. Each step ends with a highlight. A step may first activate an explicitly approved view switch, then highlight the resulting content. Keep a tab highlight when no separate content container is appropriate.

```json
[
  {
    "id": "overview",
    "title": "Overview",
    "brief": "Review activity in {{platformName}}.",
    "extended": "Start with the activity summary, then compare the visible reporting period before interpreting the totals.",
    "actions": [
      {
        "type": "activate",
        "resource": {
          "target": "example.tab.overview",
          "source": "src/components/admin/ExamplePanel.tsx"
        }
      },
      {
        "type": "highlight",
        "resource": {
          "target": "example.overview",
          "source": "src/components/admin/ExamplePanel.tsx"
        }
      }
    ]
  }
]
```

In the Markdown file, place that JSON inside a single `json` fenced block under `## Actions`. `resource.source` is the real repository-relative TSX path; `resource.target` identifies the actual UI element, not a CSS selector or a translated label.

Bind the view switch and content in the panel:

```tsx
<button
  type="button"
  data-tour="example.tab.overview"
  data-tour-action="activate"
  data-tour-active={tab === 'overview'}
  onClick={() => setTab('overview')}
>
  Overview
</button>
{tab === 'overview' && (
  <section data-tour="example.overview">...</section>
)}
```

Only a **button** marked `data-tour-action="activate"` may be clicked automatically. Its handler must only switch a local view or perform the normal read-only loading for that view. The runner verifies `data-tour-active="true"` after the click. Never place this marker on save, send, payment, publish, delete, signing, provider authorization, or permission controls. Those actions use the existing learner-reviewed action tool. A highlighted control does not need activation permission.

For a catalog card or Back button that disappears when its view opens, an `activate` action may also declare `destination: { "target": "example.workspace", "source": "src/components/admin/ExamplePanel.tsx" }`. Mark the source button with the matching `data-tour-destination="example.workspace"` and the destination container with `data-tour="example.workspace" data-tour-active="true"`. The runner verifies that container after clicking and skips the click if the destination is already active. Both resources use the same validated source/target contract. This handles nested workspaces without pretending a vanished button is still active. Include required workspace navigation before tab activation; do not mark a missing prerequisite optional just to suppress failures. See Plugin Studio's guide for an example.

Mapped tabs can use a template:

```tsx
data-tour={`example.tab.${tab.id}`}
```

All resources must resolve uniquely among visible elements in the current panel. Use separate bindings for repeated rows; do not use account identifiers or private values as tour targets. Put `data-tour-private` on regions that must be excluded from interface inspection and walkthrough targeting.

Optional step fields:

| Field | Meaning |
| --- | --- |
| `mode: "extended"` | Additional detail, omitted from Brief. Do not use it to hide main tabs from Brief. |
| `optional: "Reason this view may be absent"` | A license, permission, provider, selected-record, or empty-state dependency. The guide reports an unavailable result instead of pretending the step ran. |

Required steps that cannot resolve stop with a retryable error. The learner can explicitly skip a highlight or the rest of a panel. The model cannot skip unresolved required steps or enter the question break while steps remain. Outcomes distinguish shown, unavailable and learner-skipped steps. Changing panels or modes cancels pending actions. Highlights follow scrolling, resizing, nested scroll panes and same-origin developer iframe content, then clean up on navigation or tour exit.

For a new feature in an already instrumented panel, editing its Markdown is enough. If the new feature has no binding yet, add the attribute at the source control or container and reference it from the document. A guide without Actions remains a written orientation until its walkthrough is authored.

Supported text placeholders:

| Placeholder | Value |
| --- | --- |
| `{{brandName}}` | Active partner or platform brand |
| `{{platformName}}` | Customer-facing platform name, using the active brand |
| `{{panelTitle}}` | The panel's visible sidebar title |
| `{{sectionTitle}}` | The current sidebar section or merchant workspace; neutral in standalone documentation |

Use placeholders instead of hardcoding PortalPay, BasaltSurge, or a partner name. Brand names are supplied per session, including the spoken welcome. Keep exact UI labels unchanged. Avoid business-specific data, credentials, account values, or instructions that ask the trainer to bypass its tools or permissions.

New documents appear automatically in **Docs → Workspace Tour → Panel Guides**. A new sidebar panel without a document still receives a basic orientation, so missing content does not remove an accessible panel from the route. Duplicate panel keys, invalid metadata, unknown placeholders, and missing sections fail validation with the document path.

Run `node --test src/lib/admin-tour/tour.test.cjs` to validate the documents, full sidebar coverage, role filtering, and partner branding. Deploy the docs with the application, then reopen Take The Tour to load the revised content. Standard Docker deployments already copy the docs directory; standalone tracing also includes the tour files.
