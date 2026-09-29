# Take The Tour

General → Take The Tour builds a learning path from the sidebar's resolved navigation. Roles are additive, team merchant workspaces remain separate, and industry apps, nodes, developer resources, and manuals are included when visible. Both Brief and Extended cover the full route. Extended adds walkthrough points and examples; Brief focuses on purpose, workflow, and takeaway.

The guide stays mounted across admin panel changes. Every lesson ends in a question break. A client-side gate prevents the model from advancing to an unvisited panel: the learner must choose Continue, a requested destination, or a chapter. The final panel also has a question break. Progress is saved per wallet, brand key, and browser origin; transcripts are kept only in component memory. Permissions remain enforced by existing panels and APIs.

## ElevenLabs configuration

Start and Resume first open a branded welcome form. Daniel introduces himself as the AI guide and asks for a preferred name. Cancelling leaves the tour unopened. Names support international spelling, are bounded to 60 characters, and remain in component memory for the current wallet/workspace; they are not added to the account profile or saved progress. Changing wallet or partner clears the name and closes the session. Voice/text connections pass `tour_learner_name` alongside the branding variables, and `getTourContext` includes `learner.preferredName`. Names are untrusted display data, never agent instructions.

The first `APP_WALKTHROUGH_STEP` includes the personalized introduction from `learner.ts`. Daniel greets the learner, introduces his role and the branded platform, explains highlights, interruptions and panel question breaks, then teaches the first highlight in the same turn. The existing playback coordinator times the entire response, including the introduction, before advancing. Subsequent steps omit the introduction. The welcome form itself does not open the microphone; the learner still chooses voice or text.

Run `node scripts/provision-admin-tour.mjs` with the existing `ELEVENLABS_API` or `ELEVENLABS_API_KEY`. The script creates a dedicated authenticated agent and seven client tools. Its default voice is Daniel — Steady Broadcaster, with speed 0.92, stability 0.65 and similarity 0.8. `ELEVENLABS_TOUR_VOICE_ID` can override the voice. It does not alter the concierge or its tools. An ignored `.env.tour-provision.json` checkpoint makes retries update the same resources. The new ID is written to the ignored `.env.local` as `ELEVENLABS_AGENT_ID_TOUR`.

For a deployed environment, set **ELEVENLABS_AGENT_ID_TOUR** to the provisioned ID and restart/redeploy the application. Keep the API credential server-side. Each partner deployment using the tour needs these server environment settings. Do not use a `NEXT_PUBLIC_` API key.

Run `node scripts/provision-admin-tour.mjs --verify` to check the remote agent's authentication, tool names, and both WebRTC token and signed WebSocket availability without starting a conversation. Run provisioning again after editing `src/lib/admin-tour/agent-config.mjs` to update the remote prompt or tools.

Voice uses private WebRTC sessions; text uses signed WebSocket sessions. The browser requests microphone permission from the Connect voice guide action before reserving usage. Preflight tracks are immediately released, and the ElevenLabs SDK owns call audio. Failed SDK startup releases audio and commits zero session seconds. Cancelled permission prompts cannot start a late session. Server credentials stay on the server; session credentials are returned with `Cache-Control: no-store`.

`src/proxy.ts` allows `microphone=(self)` for `/admin` and its child routes, as well as the existing shop routes. The former `microphone=()` header on admin pages prevented the browser from even prompting. Deploy this header change and reload the document to apply it. Voice requires HTTPS (localhost also works). A browser or operating-system denial still requires the learner to allow microphone access in site/device settings. An embedding parent can also block microphones; open the admin workspace in its own tab. Text chat never requests microphone permission.

The dock and translucent highlights inherit the active theme and partner accent. Mute, connection state, live signal level, and Disconnect remain available when the guide minimizes. Audio settings include guide volume and microphone selection; playback follows the system output device. Recovery messages distinguish permission denial, policy blocks, missing/busy microphones, sign-in, rate limits, configuration, and network errors. Written training remains available throughout.

Signed sessions use the existing voice usage reservation/commit system and limits, with authenticated-cookie access and a separate session-start rate limit for tours. The UI commits usage on disconnect/page exit and enforces the lesser of the existing session allowance and two hours. The existing shared usage limiter is best effort; it counts finalized usage rather than reserving concurrency atomically.

## Interface tools

- `getTourContext`: sidebar-derived roles, full itinerary, current lesson, mode, and phase.
- `runTourStep`: compatibility status tool. The application executes the Markdown-authored view switches and highlights locally after playback ends. Model calls return `application_managed` and cannot race, batch, reorder or replay highlights.
- `inspectPanel`: visible control labels and ephemeral IDs, including portal dialogs. No input values or free-form page text are extracted. Sensitive fields are omitted.
- `highlightControl`: scroll and spotlight; minimize the guide to expose the control.
- `proposeInterfaceAction`: prepare a click or field edit for the learner's Apply/Dismiss decision. Revalidate the control and current panel before execution. Wallet signing, secret entry, and links leaving the panel are performed directly by the learner.
- `navigateTour`: revisit a learned stop or stage a new destination for learner navigation.
- `finishSegment`: completion check for the exact current stop. Returns a normal `walkthrough_in_progress` status while steps or narration remain. The application opens the question break itself, without relying on this tool.

Controls become invalid when the panel changes, access changes, the DOM removes them, or a fresh inspection replaces their IDs. Stopping the tour disconnects the agent and releases its audio resources. Voice failures leave the authored written tour available. Text chat uses the same ElevenLabs agent without requesting microphone access.

## Curriculum maintenance and validation

Lessons live in `docs/tour/panels/**/*.md`. Add a document with `<!-- tour {"panel":"yourPanelKey","order":75} -->`, a title, Overview, Walkthrough, Takeaway, and structured Actions. Actions reference stable `data-tour` bindings and their actual TSX source files. Add bindings while building the panel, then maintain the sequence entirely in the docs. Match the existing sidebar key; no tour registry or agent update is needed. See [the authoring guide](tour/authoring.md) and [an example](tour/panels/inventory.md).

All 67 existing guides contain source-linked walkthrough steps. Main tab switches are included in both modes; extended-only highlights add detail. Missing required targets stop with a retryable error. Conditional targets report why they are unavailable. Learners can explicitly skip steps, and those outcomes remain distinct from demonstrated steps. Source validation tests check every action against its declared TSX binding. The spotlight follows layout changes, viewport resizing, nested scrolling and same-origin frames, and does not intercept pointer events.

Plugin Studio first returns to its catalog and identifies the selected brand, then opens Shopify as an explicit worked example before visiting all eight workspace tabs. Each workspace step ensures Shopify is open and highlights content, with the publishing checklist as the final focus. Compact Grid and List are extra layout demonstrations in Extended mode. Catalog cards and Back buttons declare a destination binding because they unmount after navigation; the runner verifies the destination instead of waiting for a vanished button. Regression coverage renders the real Plugin Studio navigation from catalog, Shopify and Uber Eats starting states in both modes, and rejects any mutation calls.

The application owns progression. It opens and verifies one highlight, then sends `APP_WALKTHROUGH_STEP` with the mode-specific explanation. WebRTC speaking/listening events reflect active-speaker changes, including sentence pauses; they are not playback completion. Progress instead follows audible output from `onAudio`, with remote output-analyser sampling as a fallback. The coordinator combines a transcript-length timing floor (145 words/minute), two seconds of quiet after the latest audio, and a five-second minimum highlight dwell. New audio extends the deadline. Without any audio evidence, the guide stays on the highlight for manual navigation rather than guessing. This is a conservative playback heuristic because WebRTC does not expose an utterance-level ended event. Text mode allows reading time from when the response arrives. Pause/resume preserves the current audio timing instead of jumping straight to another step.

The next highlight opens locally, even if the model tried to finish early. After the last explanation the application enters the question phase, expands the guide and enables Continue before sending `APP_QUESTION_BREAK`. No completion tool call is required, and the application never advances to a different panel on silence.

Genuine interruptions and typed questions suspend advancement until the answer finishes; then the remaining highlights resume. Raw VAD scores do not latch a permanent pause. Explicit Pause walkthrough, panel changes, disconnect and tour exit cancel automatic continuation. Resume walkthrough is required only after an explicit pause or a failed highlight. The remote agent has an empty initial message so its greeting cannot race the first highlight: the first application-led step includes a personal introduction followed by its explanation. Deploy the client changes and run provisioning together, then reconnect existing conversations to use the updated prompt.

`documents.ts` validates the Markdown contract. `documents.server.ts` discovers files recursively. `/api/docs/tour` serves this public documentation, and `useTourContent` loads it when the tour opens. `catalog.ts` contains only access-derived ordering and lesson interpolation. The docs index at `/developers/docs/tour` lists the same files automatically. The docs endpoint never adds navigation permissions. Unknown sidebar panels get a generic orientation until a guide is added; invalid documents fail clearly instead of silently changing the curriculum.

The sidebar supplies resolved branding after its container and partner configuration loads. Partner config names and overrides take precedence; missing partner names fall back to that partner's key, never a platform or merchant theme. The guide waits for branding, then passes `tour_brand_name` and `tour_platform_name` as ElevenLabs session dynamic variables. They personalize the very first spoken greeting. Every context response includes current branding; Markdown supports `{{brandName}}`, `{{platformName}}`, `{{panelTitle}}`, and `{{sectionTitle}}`. The UI and agent share the personalized lesson. Exact UI labels and role names remain unchanged. One remote agent serves multiple brands without storing a partner's name in shared agent configuration.

Panel labels, brand names, and control labels are treated as untrusted display data by the agent. The curriculum describes workflows, not live account values. The interface tools cannot inspect arbitrary canvas content, browser chrome, cross-origin frames, or private field values.

Run:

```text
node --test src/lib/admin-tour/tour.test.cjs "src/app/(web)/admin/panels/customer-service.test.cjs"
```

Live provider checks use only synthetic curriculum and never capture a microphone:

```text
node scripts/smoke-admin-tour.mjs --extended
node scripts/smoke-admin-tour.mjs --voice
```

The extended check asks a mid-panel question, verifies its answer, and continues the sequence. The voice check generates real PCM audio and replays its duration as output activity through the production narration coordinator. It asserts a quiet gap after each playback before requesting another step. Both reject premature question prompts, apologies, or instructions to click Continue during teaching. Local regressions exercise long sentence gaps, delayed packets, continued audio after transcript completion, reading time and pause/resume, and verify that the final Continue button still unlocks.

These checks cover complete sidebar lesson coverage, every declared source binding, action schema validation, approved view activation, stale/cancelled work, narration pacing, additive roles, separate team workspaces, question gates, inaccessible destinations, credential exclusion, authentication, cross-site requests, and existing sidebar/team regressions. Browser fixture checks exercised 17 transitions across real Reserve, Node Operators, My Purchases and Admin Management components with synthetic API data, plus mobile spotlight layout and cleanup. A live text-session smoke check exercised ordered step tools and the final question gate. These do not replace a signed-in browser acceptance pass for microphone permission, voice interruption, a multi-role account, a team-only account, provider-specific views, and the developer portal frame.

Integration references: [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react), [client tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/client-tools), and [agent authentication](https://elevenlabs.io/docs/eleven-agents/customization/authentication).

Audio regression coverage also exercises actual admin security-header generation, denied microphone permission before usage reservation, permission-track cleanup, cancellation before permission resolves, failed SDK startup with zero billed seconds, microphone-free text fallback, authenticated WebRTC token issuance, and redacted upstream failures. Browser previews use simulated audio to check denial recovery, text fallback, compact mute/disconnect controls, partner accents, and mobile sizing. They do not test physical microphone capture or voice quality.
