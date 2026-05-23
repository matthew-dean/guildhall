---
title: Web UI flow audit
help_topic: web.flow_audit
help_summary: |
  Living test plan for walking a real project through Guildhall setup,
  workspace intake, task shaping, execution, and completion from the browser.
---

# Web UI flow audit

This is the active browser test plan for the Guildhall project surface. Keep it
updated while auditing the active test project so another agent can resume
without guessing.

## Test workspace

- Guildhall repo: `/Users/matthew/git/oss/guildhall`
- Test project: `/Users/matthew/git/oss/narrative-harness`
- Browser target: `http://localhost:7777/projects/narrative-harness`
- Expected project shape: a serious product-planning corpus for a commercial
  narrative editor, with specs and reference notes that should import as useful
  project context and task-shaping material instead of being hidden or framed
  as low-value optional sources.

## Current Principle

Thread is the command surface. If the UI asks the user to understand hidden
state, jump across pages for a simple answer, or wait on a vague "agent is
working" card, fix the flow. The user should be able to answer questions,
correct the agent, and ask for direct action from Thread.

Wizard flows must stay narrow. One card should ask one clear question about
one decision. Supporting detail can exist, but it should be collapsible and
secondary. Guildhall should never ask the user to approve a bundled manifesto
that hides a dozen implicit decisions.

Journey design matters as much as copy. A good flow cannot just rename labels;
it must guide the user through discrete steps with one level of abstraction at
a time. Source discovery, source selection, candidate-task review, and final
task creation are different user jobs and should not be collapsed into one
screen.

Screens should reveal the right information at the right time. Default views
should lead with the user's current job, the current state, and the next action;
explanatory copy, implementation detail, rationale, provenance, and edge-case
help should sit behind question-mark help, disclosures, drawers, or drill-in
panels unless that detail changes the decision in front of the user. A dense
screen is a design failure even when all of the text is technically accurate.

Systemic flow note from re-reading the older audit trail: repeated bugs are
not just local copy/control bugs. The same pattern keeps appearing: Guildhall
knows a more specific next surface or remediation path, but renders a generic
task/action and asks the user to infer the route. Prefer coordinator-owned
routing to the right review surface, unified action-queue counts, and
exception-based questions ("this looks stale; exclude it?") over making users
babysit setup/import/provider/release states across multiple pages.

## Current Follow-Ups

- [x] Replace the homepage hero's old project-dashboard screenshot card with
  the generated 3D guild hall illustration and keep the desktop hero as a
  balanced 50/50 copy-and-visual split. The source homepage now uses
  `hall-3d-compressed.png` directly instead of framing the dashboard as a fake
  hero card, and the CSS removes the outer hero-card frame so the illustration
  and copy read as the page hero instead of a screenshot panel. The headline,
  subhead, and proof list now use more room instead of forcing awkward
  short-line wrapping; wide layouts allow the copy side to overhang the old
  strict 50/50 split. The supporting proof items use passive glass-panel
  styling instead of looking like more buttons, then compacted into one-line
  glass proof pills so they stay readable without colliding with the
  illustration. Only the headline is allowed to overhang the visual side; the
  subhead, bullets, CTAs, and proof pills use a safer text measure, and the
  illustration starts lower on desktop so body copy does not overlap the art.
- [x] Link public-doc mentions of Corpus Map to the feature page. Public pages
  now treat Corpus Map like a named product feature with a consistent route to
  the explanation instead of dropping the phrase as unexplained proper-noun
  vocabulary.
- [x] Investigate card surfaces that appeared to lazy-render while scrolling.
  DOM checks showed docs and app cards are already mounted and visible before
  they enter the viewport; the shared issue was repeated `backdrop-filter`
  glass blur on card surfaces, which can make Chromium/WebKit defer expensive
  composited painting until a layer is near the viewport. Repeated cards now
  keep translucent glass fills, reflections, borders, and shadows without
  applying live backdrop blur. The same rule now applies inside Guildhall:
  chrome-like surfaces can stay frosted, but repeated project cards, dashboard
  panels, avatar pips, and question/choice cards do not spend a live blur layer.
- [x] Run a second public-docs copy pass after wiring the Copywriter guild.
  Source docs now avoid the worst internal-instruction tells, including
  "the user/operator" phrasing, policy language where the page means behavior
  settings, "durable artifact" where the page means durable evidence, and
  several lingering "should" constructions that read like acceptance criteria
  instead of product guidance. Frozen 0.6.0 version docs were left alone.
- [x] Refresh the published 0.7 screenshot set into a new asset folder.
  Screenshots were captured from the rebuilt `0.7.0` app fixture at 1440x900
  into `docs/assets/ui-audit/0-7-0/`, docs now reference those cache-safe
  paths, and `inbox.png` references were replaced with the current Thread
  screenshot. The screenshot pass also caught and fixed Release copy that still
  said "Operator summary".
- [x] Integrate the generated icon package into the app chrome. The served app
  HTML now exposes favicon, PNG favicon, Apple touch icon, and web manifest
  links; runtime static routes serve the copied icon assets from `dist/web`;
  and the upper-left app brand uses the 64px mark with a restrained glow beside
  "Guildhall". The 0.7 screenshot set was recaptured after the chrome change.
- [x] Wire Copywriter review into all user-facing surface work. Copywriter
  should not wait for a task to literally say "copy"; docs, UI, settings,
  release notes, onboarding, nav, labels, controls, headings, help text, and
  capitalization choices all need the same review pressure as code quality.
  This should be encoded in guild applicability and reviewer principles, not
  left as an after-the-fact scolding when public copy drifts into internal
  agent-instruction voice. The Copywriter now joins UI surface work and public
  docs work, its spec questions call out small labels/casing/docs tone, and
  the public docs explain that copy review is part of Guildhall's review loop.
- [x] Rewrite public 0.7/Next docs out of internal agent-instruction voice.
  Product-facing docs should talk to the person using Guildhall in direct,
  conversational language: what they see, what they can do, why it matters,
  and what good/bad product behavior feels like. Avoid public-doc phrasing like
  "Guildhall should...", "agents should...", "human input", and long lists of
  internal policy conditions unless the page is explicitly a reference page.
  First pass rewrote the high-traffic guide/home/project pages and added a
  `docs:check-copy` gate to fail future public docs builds on the worst
  internal-instruction phrasing.
- [x] Finish the 0.7 docs/code alignment pass instead of stopping at the
  first dead-link cleanup. The audit checked CLI commands, project-shell
  labels, Settings sections, config/model examples, Corpus Map/context docs,
  docs versioning, and public wording boundaries. Public docs no longer expose
  browser backend route inventories as a supported API surface; `Settings ->
  Memory`, current open-model examples, browser-UI wording, and model catalog
  entries now match the implementation.
- [x] Use the existing `Tooltip` component for project-dashboard visual
  explanations. The projects page was relying on native `title` attributes and
  a short-lived `data-tooltip` pseudo-layer instead of Guildhall's shared
  tooltip component, so hover behavior was invisible/inconsistent. Project
  dashboard metrics, work-mix bars, recent-activity bars, guild avatars,
  project spark cells, chips, and buttons now render through `Tooltip.svelte`,
  and the tooltip itself has the shared light glass treatment.
- [x] Reduce Projects home repaint churn during scrolling. The dashboard does
  not use scroll handlers, but background `/api/service` refreshes were still
  replacing the whole service payload even when nothing changed, forcing the
  project cards and charts to reconcile while the user could be scrolling. The
  home page now skips hidden-tab background refreshes, polls less aggressively,
  keeps refreshes non-overlapping, and only publishes a new service snapshot
  when the material project summary actually changes; always-on dashboard
  animations also respect reduced-motion preferences.
- [ ] Future dashboard performance pass: normalize service/project summary
  state by project id so a refresh can update only the project cards whose
  material summary changed. The current snapshot-signature guard prevents
  identical-payload repaint churn, but a changed service payload still wakes
  the whole Projects home reactive graph. Do this when dashboard activity
  grows enough that per-project diffing is worth the extra state plumbing.
- [x] Remove the invented projects-page details rail and centralize action
  rows. Project cards no longer create a second in-page "Project details"
  rail that re-layouts the dashboard; card inspection now opens the existing
  shared `SideDrawer` details component, while the explicit `Open project`
  action remains the route into the project shell. Repeated card action-row
  markup was replaced with shared `ActionBar.svelte` usage in `Card`, project
  cards, Do This Next, drawer suggestions, attach flow, coordinator routing,
  and workspace-import review cards so future card controls use the same
  spacing and wrapping contract.
- [x] Make the top-level `Needs you` button a fleet inbox, not a random
  project shortcut. `/needs-you` now renders an all-project inbox grouped by
  project, fetches each project inbox with an explicit `projectId`, and routes
  item actions back to the owning project. The projects-page badge opens that
  grouped view instead of jumping to the first project with draft/blocked work.
  The fleet inbox loads project groups progressively with per-project request
  timeouts, so a wedged inbox read can show as one project error instead of
  leaving the whole page stuck on `Loading...`.
- [x] Fix numeric badge vertical alignment on status controls. The shared
  `StatusButton` and `Chip` count pills had a legacy glyph `translateY()` nudge
  that made project-header counts such as `Needs you 1` look like the number
  was sagging/melting under the current font stack. Count pills now use
  grid-centering with no manual glyph offset, preserving the `99+` cap and
  shared badge shape.
- [x] Add a nested-glass treatment for "section within section" UI and reduce
  over-bright question typography. Agent-question cards now use shared
  `--glass-inset-*` tokens, softer body text tokens, lighter prompt/choice
  weights, and more breathable line-height so coordinator questions read like
  inspectable glass panes instead of flat black boxes full of bold white text.
  The design-token docs and frontend agent guidance now name the inset-glass
  pattern and the text intensity ladder.
- [x] Apply the approved guild-glass visual language to the product and docs
  design systems without changing the existing control geometry. The app now
  defines shared glass, reflection, emitted-light, and stronger warning-signal
  tokens; Card/Button/project-dashboard surfaces consume those tokens while
  preserving current button heights, spacing scale, and radii. VitePress uses
  matching glass tokens for nav, hero, cards, screenshots, and CTAs, and the
  token docs now name the "transparent glass catches light / strong controls
  emit light" rule.
- [x] Put real recent-work sparklines on project cards. `/api/service` now
  summarizes task `updatedAt`/`completedAt` timestamps into an 18-bin `Last 30
  days` activity strip, and project cards render that strip below the current
  queue-mix bar. Empty bars stay muted; the UI does not animate or imply work
  happened when the project has no timestamp evidence.
- [x] Fix the 2026-05-21 follow-up audit issues before the next multi-agent
  pass. Looma + Knit now blocks `Start` on imported drafts instead of silently
  doing nothing, under-specified ready tasks say their brief/spec still needs
  cleanup instead of "Approved and queued," Release counts unfinished work,
  missing design-system approval, and Guildhall-owned dirty checkout files as
  release blockers, completed workspace imports reopen as completed summaries
  instead of looping the wizard, workspace/council child-project bootstrap
  contracts are visible in Settings, and completed import status is counted
  from the saved curated spec rather than from a stale detector pass.
- [x] Keep bootstrap-not-required projects out of false-warning readiness.
  `fair-labor-license` style projects whose bootstrap endpoint reports
  `needed: false` now count Bootstrap as ready, show `not required`, and hide
  the mutating `Run bootstrap` action instead of reporting `2/3 ready` with a
  misleading `not set` status.
- [x] Fix the 2026-05-21 multi-agent follow-up findings from the fresh
  rebuild pass. Project ticker copy now surfaces imported drafts as
  `Needs task briefs` instead of saying no actionable work remains, Settings
  no longer counts a stale successful bootstrap as ready when the endpoint says
  `re-run needed`, Release separates total release blockers from unfinished
  task counts, and Facts/memory check-in counts completed workspace-import
  specs instead of understating imported tasks and milestones. A final visible
  FLL pass also caught stale `supervisor_stopped` ticker copy overriding the
  current imported-draft state; current actionable state now wins over stale
  stopped events.
- [x] Fresh rebuild audit on `narrative-harness` confirmed completed import
  opens a completed summary/transcript, Thread/Work/task drawers route
  correctly, and Release is blocked only by real project readiness signals.
- [x] Fix source-note previews for stale and folder references found in the
  FLL imported drafts. Source previews now recover moved references such as
  `database/supabase/migrations` -> `supabase/migrations`, render directory
  references as bounded folder trees, show nearby files for missing references
  like stale `useAuth.ts`, and wrap code files in language fences instead of
  rendering raw source as prose.
- [x] Stop missing-source guardrails from forcing blueprint agents to author
  code. FLL showed a stale imported `useAuth.ts` reference becoming a hard
  mutation instruction for spec agents, then leaking into unrelated listings
  and Stripe blueprint work. The strict "mutate this likely target or
  escalate" rule now stays worker/build-lane scoped; spec/coordinator lanes may
  read nearby evidence, adjust the blueprint, split work, or raise a scoped
  planning escalation instead of being forced to create a stale file.
- [x] Add foreman inspection for stale blueprint/tooling blockers. Before
  dragging the user into a blocked task, the coordinator now recognizes the
  specific class where a spec or planning lane was blocked by an internal
  missing-source / likely-target guardrail, resolves that stale escalation with
  evidence, and reopens the task into spec review or intake. Real owner
  decisions, such as product/billing choices, remain blocked for human input.
- [x] Fold all four running-agent audit reports into the live checklist. The
  2026-05-21 pass covered Looma + Knit, Fair Labor License, Font Something,
  and Narrative Harness. No agent wrote directly to this file; their reports
  were consolidated here to avoid parallel write collisions.
- [x] Reconcile release-readiness blocker math with actionable owner queues.
  Live `looma-knit`, `fair-labor-license`, and `narrative-harness` testing
  showed Release counting done briefs, reserved `task-workspace-import`, and
  shelved/deferred work as `Human blockers`, producing numbers such as
  `Human blockers 56` while Inbox showed `Needs you 1` or `0` actionable
  items. Release readiness now excludes terminal/reserved import briefs from
  unapproved-brief blockers and keeps shelved tasks informational instead of
  adding them to the human-blocker total.
- [x] Fix the fair-labor-license idle-copy contradiction. Live testing showed
  Thread saying `Needs your input before Guildhall can continue` while the
  same screen and Inbox reported no actionable items. Completed
  `review_feedback` turns no longer count as live owner input in Thread's
  caught-up footer.
- [x] Fix Ready provider status so it reflects the project/global provider
  selection. Live `font-something` testing showed `LLM provider: not
  configured` while project provider settings reported an effective
  `preferredProvider`. The Ready checklist now reads the same project-scoped
  provider endpoint as the Providers tab and treats an inherited configured
  provider as ready.
- [x] Normalize worker context-health warnings for isolated subproject
  worktrees. Live `looma-knit` testing showed a Looma task correctly using an
  isolated Guildhall worktree while context health still emitted
  `subproject_scope_mismatch`. Context health now recognizes task-scoped
  isolated worktrees, and worker context gets generic role guidance when no
  specialist engineer persona matches.
- [x] Prove Corpus Map context is actually used, not just generated. Live
  artifacts showed Corpus Map blocks in agent prompt snapshots, but the
  context-debug ledger did not count them. Context debug now records Corpus Map
  as a first-class section and preserves compact evidence (`chars` and
  `readNext` paths), while the context-builder tests compare no-map vs
  with-map prompts and assert the map surfaces existing abstractions such as
  `Command buttons` before implementation guidance.
- [x] Put project-page outside padding in the shared shell, not per-tab spacing.
  Live testing on `commerce-project` showed the Work page card sitting directly
  under the sticky run strip because the actual scroll container
  (`AppShell.app-shell-page`) had no top padding; the intended `.page`
  padding lived in `ProjectView.svelte` and did not reliably style the child
  component boundary. The shared shell page region now owns top/right/bottom/
  left padding and vertical page gap after the sticky band, so Thread, Work,
  Settings, and other project views use the same container model instead of
  ad-hoc first-card margins.
- [x] Cap visual count badges at `99+`. Live Looma + Knit testing showed
  two-digit phase counts squeezing inside circular badges. Status buttons and
  numeric chips now render count-like labels as tabular pill badges, and Thread
  phase counts display `99+` instead of overflowing when a bucket gets huge.
- [x] Centralize friendly labels for runtime identifiers. Live testing on
  `commerce-project` showed Recent Progress leaking raw identifiers such as
  `spec-agent`, `_meta`, `task-002`, and `spec_review`. The web UI now has a
  shared identifier-label map/component, and Work renders progress as
  structured cards with persona/status/domain chips plus task links instead of
  raw log metadata.
- [x] Reframe first-run idea shaping before task creation. Live testing on
  `commerce-project` showed the setup Thread asking the user to `Create the
  first task` immediately after project direction, even when the user is still
  trying to turn a rough business idea into a usable spec. The runtime can keep
  using a task record internally, but the owner-facing first action should read
  as `Shape the idea`, `Draft the product spec`, or similar until there is an
  approved brief/spec and real implementation work exists. The first-work setup
  step now reads `Shape the first spec`, uses `Start shaping`, and explains
  that the input becomes a brief, focused questions, and a buildable spec before
  implementation.
- [x] Stop overstating empty-project meta-intake as repo inference. Live
  testing on an empty `commerce-project` correctly produced generic
  `_meta`/`project-implementation` placeholder slices, but the review card said
  Guildhall “inferred this from the repo.” For empty or scaffold-only projects,
  the card should say these are starter routing placeholders and should name the
  lack of app source/tooling as the reason. Meta-intake review cards now switch
  to starter-lane language for `_meta` + `project-implementation` placeholder
  drafts.
- [x] Clear or replace the first-task form after successful creation. In the
  same setup flow, `First task created` appeared and `task-002` was persisted,
  but the textbox still contained the submitted idea, making it look like the
  action may not have happened. The setup input now clears after successful spec
  shaping submission and the toast says `Spec shaping started.`
- [x] Recover trust after the old staged-answer flow. The `commerce-project`
  intake had four real user answers saved only as `draftAnswer`, so removing
  the section-level `Submit answers` made already-entered answers appear to be
  asked again. Thread now commits all preserved draft answers for the task with
  one primary `Send saved answers` action, checks `/answer-questions` failures
  before clearing UI state, and surfaces the server error in the card instead
  of pretending the answer saved.
- [x] Hide the first-spec setup card once a starter task exists. The same
  `commerce-project` test still showed `Shape the first spec` after the product
  idea task existed because the wizard counted first tasks by excluding the
  `_meta` domain. Empty/starter projects can legitimately route the user's first
  real task through `_meta`, so setup now excludes only reserved housekeeping
  task ids, not the whole domain.
- [x] Replace fragile Thread summary text truncation. In the live
  `commerce-project` thread, the equal-width operation summary tile rendered
  `1 thread card nee...` with an awkward centered ellipsis. The summary now uses
  count-over-short-label metric cells (`Needs you`, `Working`, `Blocked`,
  `Queued`, `Drafts`) and keeps the full phrase in `aria-label`/title instead
  of trying to squeeze a sentence into a narrow tile.
- [x] Make queued Thread cards read as informational, not required user action.
  The `commerce-project` worker card showed `Build`, `Guildhall next`, and
  `Queued` at the same visual weight, while the visible button said `Add note`.
  Queued cards now collapse that chip soup to one primary `Queued` signal, hide
  the construction-stage chip until work is actually running/reviewable, and
  label note-taking as `Add optional note`.
- [x] Run a second multi-agent cross-project UI/user-testing sweep. Started a
  read-only parallel pass across workspace import, Thread / Needs you, Work
  drawers, direct project routes, Release / Providers / Timeline, and shell
  button / rail behavior. Completed reports were folded into the current
  checklist with concrete repro routes and larger IA questions.
- [x] Decide whether workspace import is a context-import flow, a task-import
  flow, or an adaptive blend. Second-pass testing on Narrative Harness found
  the live import has `19` sources, `18` reference notes, `1` goal, and `0`
  task candidates, but the wizard still promises a `Tasks` step and speaks in
  task-import terms. If a pass has no task candidates, either hide/skip the
  Tasks step with a clear reason or reframe the whole pass as "remember this
  project context. The wizard now adapts to a context-only pass by showing
  `Found -> Parts -> Notes -> Save`, using context-first labels, and skipping
  the empty task-review step.
- [x] Fix workspace-import counts and artifact labels. In the Narrative
  Harness notes review, `Docs` says `19 notes in this pass` while the current
  part has `18`, and excluding that part can leave the page saying `1 notes in
  this pass` beside `0 of 18 selected`. The `Project-wide` part also reads as
  `0 reference notes` even though it contains a goal from `README.md`; goals
  need to be first-class review artifacts, not invisible metadata. Counts now
  separate current-area selections from total selected sources, and goals are
  surfaced as review artifacts instead of disappearing behind note counts.
- [x] Decide whether workspace-import details are an inspector or the primary
  review workspace. The source detail drawer now exposes useful summaries, but
  it blocks the underlying review controls and offers no Include/Exclude,
  next/previous, or open-source action of its own. If the drawer is modal, it
  should carry the decision controls; if it is only an inspector, the default
  notes step should keep the source list and provenance easier to scan. The
  drawer now acts as a modal inspector with local Include/Exclude controls and
  a copy-path action, while the default notes step keeps the source list visible
  for scan-and-select review.
- [x] Unify the `Needs you` count model. Second-pass testing found Narrative
  Harness reading as `5 need you` in Thread, `Needs you 2` in the rail/top bar,
  `Needs you (2 items)` plus `Housekeeping (1)` in Notifications, and `2 more
  in Inbox` on Work. The UI needs one count contract, or explicit buckets such
  as decisions, housekeeping, imported drafts, and blocked tasks. First pass:
  Thread now labels broad thread attention as `Input cards`, while the
  project shell/Inbox retain the narrower `Needs you` count for actionable
  owner input. This makes the mismatch explicit instead of presenting
  different units as the same metric.
- [x] Preserve task-route context or make task details a true focused page.
  Opening a task from Work changes the active rail item to Thread and shows the
  task under repeated Thread content. Either task drawers should preserve the
  originating surface through the background route, or `/task/:id` should
  become a focused task page where the selected task appears first. Work,
  Inbox, and `Do this next` now preserve the originating background path, and
  direct project-scoped task URLs open the drawer even with audit query
  parameters instead of falling through to a generic Thread page.
- [x] Collapse the split workspace-import routing model. `Review next draft`
  opens `task-workspace-import`, then the real work lives behind `Open import
  review` on `/workspace-import`. The product needs one canonical entry point:
  either workspace import is a setup/review surface, an inbox item, or a normal
  task with a task-focused review UI. Reserved import work now routes directly
  to `/workspace-import` from Work, Inbox, and runtime inbox actions, with
  `Open import review` language instead of a generic task handoff.
- [x] Separate human next actions from worker runnable state. Narrative Harness
  can show `DO THIS NEXT` for an escalation, `0 active`, `1 imported draft`,
  and "No runnable tasks remain right now" at the same time. This is accurate
  internally, but the user needs a simple queue: what they should do now, what
  becomes runnable afterward, and what is merely waiting. First pass: reserved
  import work points at the import review, escalation copy leads with recovery
  review instead of raw agent diagnosis, Thread uses `Input cards` for broad
  owner-facing items, and the project shell keeps the narrower `Needs you`
  count for direct human input.
- [x] Refresh Thread/Work state immediately after task-shaping actions. Live
  Narrative Harness testing on the latest checkout service (`:7788`) advanced
  imported drafts via `Draft task brief` and `Continue drafting spec`; the task
  data correctly moved `coherence-reviewer-mvp` and `decision-trace-pipeline`
  into `exploring`, but the current Thread card/drawer continued to read like a
  queued or paused partial draft with stale checklist status. After a mutation,
  the visible card/drawer should re-fetch the task, reclassify its phase, and
  explain whether Guildhall is now shaping it, waiting for approval, or asking
  for human input. First pass complete: Thread and Current task drawer now share
  the same imported-draft shaping, queued spec revision, paused work, and
  recovery classification language.
- [x] Make Thread phase buckets reflect task truth instead of stale group
  labels. During the same Narrative Harness pass, the API reported
  `foundation-schema-contracts` as `in_progress` with a worker worktree, while
  Thread briefly grouped it under `Guildhall working Paused 1` and rendered the
  card as queued. Later it corrected to `Guildhall working In flight 1`.
  Transient labels are acceptable for live work, but contradictory bucket text
  makes the user doubt whether the agent is actually doing anything. Thread now
  distinguishes live agent work, paused work, shaping, queued work, and recovery
  before it renders phase groups.
- [x] Surface partial durable progress distinctly from failure/no-progress.
  The Narrative Harness `foundation-schema-contracts` worker timed out after
  120 seconds of inactivity, but the activity stream also showed a real file
  write to the isolated worktree before another empty assistant reply. Thread
  collapsed that into `0 working`, a paused-looking bucket, queued card copy,
  and an error ticker. A task with dirty target files, recent writes, and a
  failed follow-up turn should read as `Needs recovery after partial progress`
  with a clear action, not as both queued and failed. Thread and Current drawer
  now classify durable progress plus a failed worker event as `Needs recovery`
  with explicit recovery copy.
- [x] Align project activity counts across Thread, Work, and ticker. The latest
  Narrative Harness run showed `Working on 2/3/4 tasks` in the ticker while the
  Thread summary and Work summary used different active/working/queued/draft
  counts. These can be different concepts, but the UI needs explicit labels
  such as `active agent work`, `ready for worker`, and `import drafts` rather
  than overloaded `working`, `active`, and `queued` terms. Thread now uses
  `Agent-active`, `Shaping`, `Recovery`, `Queued`, and `Drafts`; Work now uses
  `agent-active`, `ready for worker`, `awaiting approval`, and `import drafts`.
- [x] Make top-bar run controls acknowledge stop immediately. In the latest
  Narrative Harness pass, pressing `Stop` from Thread did not visibly change
  the top-bar button or page state within the next snapshot, while the same
  project-scoped stop API returned `{ ok: true, status: "stopping" }`. The
  shell should optimistically move the control into `Stopping...`/disabled
  state and refresh the ticker so users know the click landed. The project shell
  now enters an optimistic `Stopping...` disabled state as soon as stop is
  requested.
- [x] Make narrow project screens usable or explicitly unsupported. At
  `390px` wide, the collapsed rail still consumes layout width, Thread content
  starts too far right, and primary actions can clip off the viewport. Looma +
  Knit also showed top-bar controls colliding and task titles collapsing into
  unreadable columns. If mobile/narrow is supported, the rail should become
  drawer-only and lower-priority top-bar controls should move into overflow.
  Corrected fix: mobile no longer reserves any rail column. The project rail is
  hidden from layout and accessibility until the hamburger opens the full-screen
  navigation overlay, while medium desktop can still use the collapsed rail.
  Component regression coverage now guards the closed/mobile hidden-rail state,
  open overlay state, Escape close, and navigation close.
- [x] Clarify the project/global provider boundary. Project Settings and the
  project rail can route to global `/providers`, dropping the user out of the
  project shell, while project settings also exposes provider choices locally.
  The UI should distinguish global machine credentials from project provider
  readiness and project model defaults before navigation. Project provider
  controls now stay in the project shell, disabled-provider copy names global
  credentials explicitly, and readiness links distinguish project provider
  choice from global setup.
- [x] Make Timeline an operator activity feed by default. Hiding provider
  health chatter helped, but Looma + Knit and Narrative Harness still expose
  raw `assistant_delta`, `assistant_complete`, JSON payloads, tool inputs,
  token fragments, and internal task ids in the main feed. Raw traces should be
  expandable beneath grouped human-scale state changes. The default Timeline
  now hides raw assistant/tool/line trace events behind an expandable raw-trace
  disclosure, leaving the feed focused on human-scale project activity.
- [x] Reframe blocker copy around the user's recovery action. Release, Thread,
  and Timeline prominently say "Spec agent made no visible progress after 3
  passes." Keep that as diagnostic detail, but lead with the action the user
  can take, such as reviewing or refining the draft task brief. `Do this next`
  now frames open escalations as recovery review and keeps the detailed agent
  diagnosis as supporting evidence.
- [x] Make readiness `Configure` controls consistent and safe. Direct testing
  found bootstrap `Configure` starts running work in place, coordinator
  `Configure` can route to the project list, and provider `Configure` routes
  globally. Readiness should be either a passive checklist with links or an
  operations panel with explicitly labeled side effects like `Run bootstrap`.
  Readiness actions now use explicit verbs (`Run bootstrap`, `Open
  coordinators`, `Choose provider`) and route to project-scoped settings where
  appropriate.
- [x] Decide what `/setup` means after initialization. Direct visits to
  `/projects/{project}/setup` can re-offer first-run bootstrap on projects
  with existing tasks or completed runs. Initialized projects should either
  redirect to readiness/dashboard or show a repair/resume mode instead of
  first-run onboarding. Initialized projects that land on `/setup` without an
  explicit setup step now redirect to project readiness; explicit setup steps
  still render for active onboarding/test flows.
- [x] Run a five-agent cross-project UI/user-testing sweep. Started a
  read-only parallel pass across the available non-Narrative Guildhall
  projects to capture blockers, state contradictions, unclear CTAs, import
  traps, and UI rhythm problems without mutating project state. Completed
  passes covered `looma-knit`, `t-minus-t`, `fair-labor-license`, and
  `font-something` import / non-import surfaces.
- [x] Fix direct project-route blank screens. Parallel testing found direct
  navigation to routes such as `looma-knit/settings/ready`,
  `fair-labor-license/settings`, and `font-something/workspace-import` can
  render an empty or stuck page even though the server and backing APIs still
  respond. Second-pass testing narrowed the current blank-route repros to
  legacy aliases such as `/projects/{project}/routing/agents` and
  `/projects/{project}/coordinators/setup`; the named `/settings/ready` routes
  now render, but the legacy aliases need redirect, content, or removal.
  Legacy `/routing/*` and `/coordinators/*` aliases now resolve to the
  project-scoped coordinator settings surface instead of an unrendered subroute.
- [x] Fix project subpages that hang despite healthy API responses. Parallel
  testing found Release, Providers, and project provider settings can stay on
  `Loading...` states while their backing endpoints return usable data.
  Release now uses project-scoped reads, and provider/model surfaces render
  explicit model-load errors instead of indefinite loading when the model
  endpoint fails.
- [x] Make run-state labels distinguish connection health from execution
  state. Parallel testing found projects simultaneously reading as `LIVE`,
  `CONNECTING...`, `PAUSED`, `stopped`, and `Start`-able, which makes it
  impossible to know whether Guildhall is running or merely connected. The app
  header now reports transport state as `connected` / `connecting`, while the
  project top bar reports open work separately from running agents.
- [x] Elevate hard release blockers into the release verdict. Parallel testing
  found `t-minus-t` showing `Blocked`, `3/3 done`, `0 items waiting on you`,
  and `Human blockers 0`, while the real release blocker was `Design system
  not drafted` deeper in criteria detail. The release verdict now treats an
  undrafted or unapproved design system as the named hard blocker even when no
  human-task blocker count exists.
- [x] Make task drawers explain shelved and checkpointed outcomes. Parallel
  testing found `fair-labor-license` task details stuck on `Loading...` for a
  shelved task, and `t-minus-t` completed tasks using checkpoint / no-merge
  language that leaves the user unsure whether anything remains to do. Task
  drawers now show a top outcome summary for shelved, checkpointed, terminal,
  and no-visible-progress states before the raw diagnostic detail.
- [x] Consolidate duplicate workspace-import entry points. Parallel testing
  found `font-something` surfacing `Review existing work`, `Existing repo
  detected`, and `Review existing project work` as separate-looking CTAs that
  all point at the same import/review lane. Reserved workspace-import work now
  emits one `Review existing project work` action routed to `/workspace-import`
  instead of also surfacing generic setup/spec-fill nags for the same lane.
- [x] Clarify workspace-import reversibility and commit point. Parallel
  testing found Step 1 explains context vs backlog tasks well, but does not say
  whether skipping can be resumed, when selected notes become durable project
  memory, or whether task creation only happens on the final step. Step 1 now
  states that nothing is saved until the final step and the review can be
  resumed later from Needs you or the import page.
- [x] Add accessible names to collapsed project navigation buttons. Parallel
  testing found icon-only rail buttons can appear without useful accessible
  labels when the project rail is collapsed. Collapsed rail items now carry
  explicit accessible labels for project sections and Providers.
- [x] Reduce always-visible mutating controls in read/inspect drawers. Parallel
  testing found task drawers visually crowded by controls like `Pause task`,
  `Put aside`, and `Continue drafting spec` when the user is only trying to
  inspect state. Primary footer actions now keep the current useful path
  visible, while rare destructive/retry controls live under `More task
  actions`.
- [x] Fix pinned project navigation layout at medium desktop widths. Live
  Narrative Harness testing found that pinning the left rail opens the menu,
  but the rest of the app frame can keep the collapsed 56px column instead of
  reserving the expanded rail width. `AppShell` now uses the same 920px
  breakpoint as the rail behavior, and a Playwright regression guards the
  pinned layout at 960px.
- [x] Fix tiny inbox overflow action in `Do this next`. Live Narrative Harness
  testing found `1 more in Inbox ›` rendering as an 18px-high button beside the
  primary task action, so it feels like inline text instead of a control and
  misses the shared button target rhythm. The overflow action now uses the
  shared `Button` component and inherits the same target rhythm as other
  secondary actions.
- [x] Make workspace-import Details drawers inspectable. Live Narrative
  Harness testing on Step 2 found the part drawer lists source titles as dense
  text only; source rows are not clickable and do not expose summaries, paths,
  or a way to inspect the referenced note from the drawer. Part drawers now
  render each source as an inspectable row with title, path, and useful summary
  and clicking a source switches the drawer to that source's detail.
- [x] Make `Needs you` counts match actual actionable blockers. Parallel
  testing found Thread / Needs you showing stale or incomplete counts across
  `t-minus-t`, `fair-labor-license`, `looma-knit`, and `font-something`;
  release blockers, shelved tasks, and import-review work can be hidden even
  when the top bar claims the project needs attention. Thread no longer calls
  its broad count `Needs you`; the top bar count stays tied to the project
  Inbox/actionable-owner queue, while Thread exposes broader input-card volume
  separately.
- [x] Replace contradictory idle copy with a concrete next step. Parallel
  testing found projects showing combinations like `0 working`, `0 blocked`,
  `All caught up — agents are working`, `LIVE`, `Paused`, and `Start` without
  explaining whether the user should answer a question, finish import, draft a
  missing design system, or simply wait. Thread now distinguishes needs-input,
  working, queued, and genuinely idle states in the caught-up copy.
- [x] Filter default Timeline noise. Parallel testing found repeated provider
  health events dominating timelines in multiple projects, burying the events
  that explain current state or project progress. The default Timeline hides
  provider health chatter behind a compact connection-check count so project
  events stay legible.
- [x] Route reserved workspace-import tasks to the import wizard. Parallel
  testing found task drawers and Thread CTAs offering generic actions like
  `Continue drafting spec` or `Create the first task` when the real next step
  is reviewing and approving existing project work. Reserved import work now
  routes to `/workspace-import`, and the task drawer primary action for
  `task-workspace-import` opens the import review instead of presenting normal
  worker-task controls.
- [x] Fix workspace-import task-review detail trapping. Parallel testing on
  `font-something` found Step 4 could reopen the same task detail after
  closing it and clicking `Review next source`, making the import review feel
  non-advancable. The Step 4 drawer footer now advances to the next source or
  final task list and clears detail focus instead of reopening the same task.
- [x] Fix workspace-import Details drawer close behavior. Live Narrative
  Harness testing reopened the Docs part drawer during the second audit and
  found the `Close` button was still intercepted by the app header. The shared
  `SideDrawer` now escapes `AppShell`'s main-column stacking context so it sits
  above the app header and rail/menu layers.
- [x] Reframe workspace-import project docs as included context rather than
  optional sources. Reference-only docs are selected by default, individual
  note review is tucked behind a disclosure, each note card shows a useful
  excerpt, and source/part actions now use calmer `Include` / `Exclude`
  language instead of process-heavy "Use this source" / "Remove from this
  pass" controls.
- [x] Align workspace-import card affordances with question-choice behavior.
  Import cards no longer use hoverable whole-card buttons for details unless
  the card itself changes selection; card bodies are static content, `Details`
  is an explicit action, and Include/Exclude/checkbox controls own selection.
- [x] Restore readable secondary button contrast. The shared secondary button
  now uses a distinct but restrained neutral fill and consistent border instead
  of either disappearing into dark raised panels or overcorrecting into a heavy
  high-contrast slab.
- [x] Reduce top-bar button clutter. Project navigation, work count, inbox,
  provider, and readiness affordances now share one quiet link treatment;
  disabled New Task no longer occupies toolbar space; Start/Stop remains the
  only high-emphasis command and overflow uses a single quiet icon control.
- [x] Condense the project top bar further after live Narrative Harness review.
  `Projects` is a real secondary button again, setup/readiness is a compact
  attention affordance, normal provider text stays out of the bar, and queued
  work / inbox / stuck states use a compact icon-and-label cluster with small
  number badges instead of full prose labels or abstract icon-only controls.
- [x] Remove bespoke top-bar button sizing. Top-bar command actions now rely on
  the shared `Button` component, and semantic state affordances use the shared
  `StatusButton` component for the outlined warn/danger treatment with count
  badges; project-local CSS handles layout, not one-off button padding.
- [x] Restore count badges as corner overlays rather than inline label content.
  `StatusButton` now owns the filled red count badge treatment while retaining
  the yellow/red outlined state control colors.
- [x] Clarify the button-system boundary from live review: toolbar and command
  actions should use shared `Button` sizing/variants; larger button-card
  treatments are allowed when they are navigation or choice cards, such as the
  workspace-import step cards, because that is a distinct component concept.
- [x] Fix Settings IA and readiness layout. Live Narrative Harness testing
  found the Settings readiness rows jammed status pills and actions together,
  Advanced settings reading like unstructured text, and a bottom-rail
  `Providers` button promoting a Settings subsection as a top-level project
  destination. Readiness now uses shared `Button` actions in a structured
  status/action column, Advanced settings uses compact grouped cards, and
  Providers stays under Settings instead of the project rail.
- [x] Replace fake lever buttons with real settings controls. Live Narrative
  Harness testing found project behavior "settings" rendered as inert enum
  chips with "Same as global setting" as a separate status label. Lever rows
  now use real select controls with `Same as global setting` as the first
  option, show the current inherited or overridden value below the control, and
  write audited `user-direct` overrides through `/api/config/levers`.
- [x] Audit major project screens for information density. Several views are
  drifting back toward internal-state dumps: too much explanatory text, too
  many parallel counts, and too many secondary details visible by default.
  Each surface needs a primary user job, a one-screen default, and progressive
  disclosure for help text, rationale, provenance, raw diagnostics, and
  rarely-used controls. Current passes tightened Thread high-volume rows,
  Work progress cards, Timeline raw-trace disclosure, Settings grouping,
  task-drawer action density, workspace-import staged review, and source-note
  previews.
- [x] Add a project corpus map for worker context. Current worker prompts
  receive focused task memory, likely target files, checkpoints, design
  summaries, and recent decisions rather than a full source dump, but there is
  no durable architecture/component/function inventory that workers can query
  before editing. Guildhall should build and maintain a codebase map with
  shared primitives, module boundaries, APIs, tests, and known patterns, then
  inject only the task-relevant slice while letting agents ask follow-up
  questions. The Corpus Map engine now generates `memory/codebase-map.yaml`,
  records refresh history, injects compact map guidance into agent context,
  and exposes `guildhall corpus-map`.
- [x] Remove maintainer-only implementation pages from the public VitePress
  surface. The public docs build now excludes `docs/subsystems/**`,
  `docs/web-ui/design-tokens.md`, and `docs/web-ui/help-system.md`; sidebar,
  README, guide, reference, and generated help-topic links were cleaned so
  user docs no longer route people into "how Guildhall is built" internals.
- [x] Make docs version posture visible. The VitePress nav now uses a single
  Version dropdown for `Current (v0.6.0)`, Next, and the version archive
  instead of separate top-level links. Current uses no version in the URL,
  Next tracks unreleased main-branch docs, and archive URLs remain available
  with `noindex,follow` so search engines prefer Current.
- [x] Make Get Started concrete. `docs/guide/quick-start.md` now shows example
  first-run questions, useful answers, runtime blockers, and a full mini
  first-run scenario so new users can feel the product loop before opening
  their own repo.
- [x] Split the "agents need to be smarter" work into immediate `0.5.x`
  decision-point unblockers versus `0.6.0` policy/runtime architecture.
  The 0.6.0 note now combines bounded improvisation, typed recovery playbooks,
  coordinator-routed project/system learning, and model bakeoff work. See
  `docs/design/agent-policy-and-model-bakeoff.md`.
- [x] Capture the house/construction model as a canonical product philosophy
  instead of leaving it in chat. See
  `docs/design/project-construction-manifesto.md` for the guild roles, site
  survey, blueprint, foundation, framing, trade work, inspection, change order,
  punch list, and occupancy model that should guide 0.6.0 planning work.
- [x] Start permeating the public docs with the construction model. Added
  `docs/guide/how-guildhall-builds.md`, linked it from the start/guide
  sidebars, and updated the home page, quick start, introduction, core
  concepts, project walkthroughs, first-task guidance, task lifecycle,
  projects/work guide, many-projects guide, and 0.6.0 release note to use
  blueprint/framing/trade work/inspection/change-order language.
- [x] Add the proportional-process guardrail to the construction model: process
  serves product quality, so Guildhall should infer or recommend routine
  implementation choices and reserve human questions for owner intent,
  audience, user flow, risk, data ownership, and release criteria.
- [x] Start building the construction model into the actual agent behavior.
  Core agent prompts now map spec/coordinator/worker/reviewer roles to
  blueprint/general-contractor/trade-work/inspection modes, require
  proportional owner questions, and tell workers/reviewers to treat spec
  failures as explicit change-order evidence instead of vague blockers.
- [x] Write the construction-runtime integration spec and implementation plan
  before expanding beyond prompt guidance. See
  `docs/superpowers/specs/2026-05-19-guildhall-construction-runtime-integration.md`
  and
  `docs/superpowers/plans/2026-05-19-guildhall-construction-runtime-integration.md`.
- [x] Add derived construction-mode metadata and Thread payload tests. The
  runtime now derives `survey`, `blueprint`, `frame`, `build`, `inspect`,
  `change_order`, and `punch_list` from task state, exports the helper from
  core, and includes `constructionMode` on task-derived Thread turns. Focused
  verification passed for `src/core/__tests__/construction-mode.test.ts` and
  `src/runtime/__tests__/thread.test.ts`.
- [x] Surface construction mode in Thread cards as a compact stage signal so
  the user can tell whether a task is being surveyed, blueprinted, framed,
  built, inspected, changed, or punched down without opening the details pane.
  Thread now renders the construction mode as a neutral chip beside ownership
  and status, with component coverage for visible and collapsed-phase task
  cards.
- [x] Inject construction mode into agent task context so role prompts and
  per-task instructions line up. Workers should see when they are building
  against an accepted blueprint; spec/coordinator/reviewer paths should see
  their equivalent survey/blueprint/frame/inspection/change-order mode.
  `buildContext` now adds the derived mode and responsibility line to the
  Current Task summary; focused context-builder coverage guards the worker
  `build` responsibility.
- [x] Add a pre-worker blueprint sanity review so a `ready` task is not
  blindly claimed by the worker before Guildhall records that the plan is
  worth building. Missing-blueprint `ready` tasks should route back to
  blueprint drafting instead of becoming `in_progress`.
- [x] Collapse same-task draft-review and open-question states into one Thread
  card. A task with an unanswered question should show the question as the
  current task state, not a second card next to its unapproved brief.
- [x] Reject malformed choice questions whose "answers" are actually labels
  for separate questions. Agents must post each concrete question separately
  or infer a default; Thread should not render topic labels like `Extension
  ownership` / `Knit integration` as choose-one answers.
- [x] Suppress expected research-budget refusal tool results from Thread live
  activity. The durable-progress guard still nudges agents to stop reading and
  write a brief/spec/question/escalation, but it should not appear as repeated
  `Failed glob` / `Failed file read` errors.
- [x] Make imported-draft cards name the actual artifact and add a compact
  operations mode for crowded Thread phases. Thread, Current task, project
  summaries, inbox titles, and task drawer copy now say `Needs task brief` /
  `Draft task brief`, and expanded phases with eight or more turns render as
  two-line operation rows with a `Show cards` escape hatch.
- [x] Add the missing high-volume operations summary and priority ordering for
  crowded Thread phases. Thread now leads with compact counts for `need you`,
  `working`, `blocked`, `queued`, and `drafts`, and crowded rows sort by
  attention / live work / blockers / queued work instead of becoming a raw
  chronological wall.
- [x] Reconcile the current `0.6.0` release note against the older planning
  target. The release candidate now explicitly claims the construction/policy
  substrate and leaves the full project-manager release-shaping layer as
  carry-forward work instead of pretending active tranche selection is done.
- [x] Add the missing `pnpm model:bakeoff` gate to the GitHub release workflow
  so tagged release packaging enforces the same validation claimed in the
  `0.6.0` note.
- [x] Add a public open-model recommendations page and CLI entrypoint for the
  model bakeoff replay harness. The docs now separate current tested
  development recommendations from the planned live provider-backed evaluator,
  and `guildhall model-bakeoff` writes JSON plus Markdown replay reports.
- [x] Add the live bakeoff result summary to public docs without cost columns,
  link it from setup/workspace guidance, and verify project-local model
  overrides are absent so the machine-wide DeepSeek/Qwen split remains the
  active source of truth.
- [x] Switch public docs to a stable-by-default version posture. `docs:build`
  now materializes `/versions/0.6.0/` from the published `v0.6.0` tag and
  `/next/` from the current working docs, with root navigation pointing at the
  stable release and Next kept explicit for unreleased main-branch material.
- [x] Add release-script support for docs versioning. Real publishes now bump
  `package.json`, update public docs pointers, cut `docs/versions/<version>`
  from the current docs, run the publish gates, then commit the versioned docs;
  dry runs skip docs versioning and restore the manifest. The standalone
  versioning script can also bootstrap an already-published version from a git
  ref, which keeps `0.6.0` pinned to the npm-shipped release instead of current
  Next docs.
- [x] Re-check the coverage release bar. A release-readiness run on
  `2026-05-19` is back over 90% for statements, lines, and functions
  (`90.20%` statements/lines, `90.15%` functions). The stricter future
  `pnpm test:coverage:90` gate still fails branches at `77.46%`, so the
  all-dimension target remains a larger branch-coverage hardening project
  rather than a blocker for a statements/lines/functions 90% release bar.
- [x] Improve task-scoped question handling after live Looma + Knit testing
  showed jargon-heavy questions (`M6 queue`, migration-status ownership) with
  no context path. Thread now lets the user ask for missing question context
  without marking the question answered, keeps staged answer submission after
  the question stack, and renders imported source references as clickable
  source links on both imported-draft and question cards. Agent/tool guidance
  now requires self-contained owner questions that explain the source fact,
  why the answer matters, and what happens next.
- [x] Re-run the release-readiness sweep after the coverage nudge:
  `pnpm test` passed `2,497` tests, `pnpm typecheck`, `pnpm docs:check-help-sync`,
  `pnpm docs:build`, `pnpm lint:deps`, `pnpm model:bakeoff`, `pnpm build`,
  `pnpm test:ui`, and `git diff --check` all exited cleanly. Known non-blocking
  output: dependency-cruiser orphan warnings and third-party Svelte warnings
  from `svelte-sonner` / `runed`.
- [x] Do a fresh live project walkthrough after the release sweep. Projects home
  loads and scrolls; `fair-labor-license` and `t-minus-t` both show caught-up
  done states. `looma-knit` is not runnable without user input because Thread
  reports six pending answers, including still-jargony task questions. `font-
  something` eventually surfaces a real bootstrap blocker: `cd model && pixi
  install` fails because `pixi` is not on the path; the route also lingers on
  `Loading...` for several seconds before the blocker appears.
- [x] Fix the project Thread `Loading...` hang found on `font-something`.
  Root cause was the project SSE stream opening before route-local data loads,
  which could starve the initial `/api/project/thread` request in the browser.
  Router now closes/debounces the stream on route changes and reconnects after
  initial data gets a lane; Thread also receives the explicit route project id
  instead of falling back through ambient selected-project state. Verified in
  the installed local app: `font-something` now renders its setup/intake/done
  sections instead of hanging, while the remaining `pixi` bootstrap blocker is
  real project state.
- [x] Add a project memory check-in to direction and existing-work review
  without turning temporary evidence into permanent truth. Thread now shows
  "What Guildhall knows right now" as a recomputed snapshot from files, setup
  state, coordinator areas, bootstrap state, and task counts; the editable
  direction remains the durable owner input that guides future task shaping and
  can be revised when project facts change.
- [x] Clean up the readiness language and unblock the current `font-something`
  bootstrap. The confusing `Open Ready` action now says `Open readiness
  checks`; after `pixi` was installed, rerunning bootstrap showed the stale
  failure was replaced by a bad app gate, so `font-something/guildhall.yaml`
  now uses `cd app && pnpm run build` instead of the nonexistent
  `cd app && pnpm run typecheck`. The latest readiness run passed all install
  commands and gates.
- [x] Normalize dirty-repo setup blockers in Thread so the user sees the repo
  name and the concrete commit/stash recovery action instead of raw setup
  prose.
- [x] Reconcile the current 0.5.0 todo list against live project state instead
  of stale chat context.
- [x] Prove the Looma + Knit shaped draft can finish after worker recovery,
  review, and hard gates.
- [x] Confirm `fair-labor-license` and `t-minus-t` do not have hidden runnable
  blockers after the latest recovery fixes.
- [x] Fix the review audit contradiction where procedural-only fan-out dissent
  could advance a task while leaving the review trail ending on `revise`.
- [x] Remove the leftover `Live activity` side rail from the Work list so the
  backlog management surface keeps the full content width. Live browser check
  on `http://127.0.0.1:7777/projects/looma-knit/work` confirmed the Work list
  renders without `Live activity` and the project-level ticker remains visible.
- [x] Make Thread the primary path for imported-task shaping and task-scoped
  questions. Imported notes now show their starting point and source reference
  on the Thread card, expose `Add context` and `Let Guildhall shape this`
  inline, and nest active questions under the task instead of rendering a
  separate peer card. The details pane remains an optional inspection path, not
  the required place to keep a task moving.
- [x] Fix the new-project setup regression where `/setup?step=3` attempted to
  seed meta-intake through `/api/project/meta-intake` without a `projectId`.
- [x] Fix `guildhall serve` hanging after Ctrl+C while the dashboard has live
  HTTP connections open. Shutdown now closes idle connections, force-closes
  lingering active connections such as SSE streams, and has a final timeout so
  the terminal can always finish after printing the shutdown message.
  The setup wizard now keeps an explicit project id after identity creation,
  moves the URL to `/projects/:id/setup?...`, and scopes setup follow-up API
  calls before the route has fully caught up. A route-helper regression test
  covers the `/setup` page posting a project mutation for the newly-created
  project id.
- [x] Tighten project routing after the `font-something` project surfaced from
  the legacy selected-project path. Project pages now pass the route project id
  into project API refresh/start/stop/inbox calls and build top-bar links from
  that explicit id. Legacy `/project/...` pages canonicalize to
  `/projects/:id/...` as soon as the loaded project id is known, so a visible
  project cannot keep using unscoped navigation that falls back to the project
  list or mutable foreground project. The routing setup card also now starts
  meta-intake inline instead of showing a generic `Open` button to `/`.
- [x] Add deterministic route coverage for this failure class. Vitest now
  checks that project action hrefs from runtime payloads normalize into
  `/projects/:id/...` routes, and that every active onboard setup step has a
  real submit endpoint or project-safe href instead of falling through to `/`.
- [x] Add coverage guardrails for the 0.5.1 hardening path. The default
  `pnpm test:coverage` command now enforces the current honest floor
  (`83%` statements/lines/functions, `75%` branches), while
  `pnpm test:coverage:90` and the PR workflow document the future 90% gate.
  New happy-dom coverage protects real user flows across Thread inline setup,
  imported-draft shaping, task-scoped question batching, Current task states,
  provider/global-model settings, workspace import review, and routing-slice
  coordinator screens.
- [x] Run the final focused test/build sweep and push the release-hardening
  batch.
- [x] Prove the `0.6.0` policy/learning loop compounds on the real Looma +
  Knit project without polluting its project memory. On `2026-05-19`, a
  one-off Vitest harness backed up `/Users/matthew/git/oss/looma-knit/memory`,
  exercised the runtime against the real learning store, and restored the
  original files after reset. Evidence: the proof classified a focused Knit
  workspace API typecheck failure as `self_authored_verification_failure`,
  selected bounded playbook `repair_touched_file_failure` with max 2 turns,
  command `cd knit/web && pnpm typecheck`, and allowed path
  `knit/web/server/api/workspaces/members.get.ts`; reflection emitted active
  project learning
  `task-phase7-proof-workspace-api-repair_touched_file_failure-paths`; a failed
  bounded playbook emitted inert product suggestion
  `task-phase7-proof-failed-playbook-repair_touched_file_failure-failure-product`;
  project skill `phase7-proof-workspace-api-skill` was injected into a future
  workspace-members context; and project learning / project skill reset cleared
  all proof records before restoring the original Looma/Knit memory files.

## 0.5.0 Release Threshold

- [x] Prove one real project can complete a task unattended end to end:
  implementation -> authoritative verification -> honest review handoff ->
  done. Looma + Knit `task-import-189j8he` now reached `done` on the live
  service after its typecheck/build gates passed and the over-broad full-suite
  test fallback was removed from narrow source-file success gates.
- [x] Keep the other two live projects truthful while that proof run is
  happening:
  no fake `running` states, no contradictory Thread summaries, and no stale
  blocker narratives outranking current task truth. Live Projects now treats
  Looma + Knit's `75 import_draft` tasks as `Needs shaping` instead of
  `Paused`, and disables the misleading Start affordance while there is no
  executable active task behind those drafts. A fresh state check on
  `2026-05-16` found `fair-labor-license` at `3 done / 1 shelved` with no
  open tasks, and `t-minus-t` at `3 done` with no open tasks.
- [x] Eliminate the remaining checkpoint-lane drift on `t-minus-t` so resumed
  workers stay inside:
  authoritative verification -> focused file read -> focused mutation,
  without falling back into ad hoc shell detours or empty-turn loops. Live
  replay on `2026-05-15` pushed `task-003` through review, gate_check, and
  `done` after the converter package passed build/test/lint. The last runtime
  bug in this family was a stale worker checkpoint blocking an already
  review-ready task; Guildhall now resolves that false blocker and preserves
  the reviewer lane.
- [x] Clear Looma + Knit's current blocked execution seam so its top runnable
  task is a real candidate for unattended progress again, not just a stopped
  backlog with draft-heavy noise. The version-diff task completed; the
  remaining Looma + Knit items are imported drafts that need shaping/release
  planning rather than execution.
- [x] Land the current runtime/test hardening batch cleanly
  (`run-query`, gate-command authority, shell tests, flow audit) and retest on
  the live `127.0.0.1:7777` service before we even discuss cutting `0.5.0`.
  Focused verification on `2026-05-16` passed 419 tests across
  `run-query`, shell, worker-agent, reviewer fan-out, and orchestrator, and
  `npm run build` completed successfully with only existing dependency Svelte
  warnings from `svelte-sonner` / `runed`.
- [x] Prove Looma + Knit imported drafts can move through human shaping into
  real runnable work. Live replay on `2026-05-15` found two blockers on the
  first legitimate draft (`Proper invite flow (Supabase Auth invite by
  email)`): approval narrowed the task to the `knit` subproject but left
  imported references as `knit/PROJECT_STATE.md`, causing the spec agent to
  look for `knit/knit/PROJECT_STATE.md`; after that was fixed, the spec agent
  authored a meta brief about exploring the codebase instead of the invite-flow
  outcome. The importer now normalizes evidence paths against the narrowed
  project root, and the product-brief/spec-agent layer is being hardened so
  imported-draft shaping produces a product/task outcome or a focused question,
  not Guildhall-process copy. A later live replay shaped the draft into real
  runnable work and advanced it through worker recovery, review, gate_check,
  and `done`.
- [x] Finish the Looma + Knit invite-flow worker recovery loop. The same live
  replay proved that shaping can now produce a runnable spec, but worker
  execution exposed three runtime issues: likely-target hints were being treated
  as exact create paths (`server/api/...` instead of `web/server/api/...`),
  bootstrap gates blocked dirty task worktrees before the worker could repair
  its own typecheck failures, and the current DeepInfra/Qwen worker lane can
  time out without a first tool call even after a concrete verification failure
  is injected. Guildhall now normalizes Nuxt `server/` hints under `web/server`,
  treats missing likely targets as paths to validate instead of blindly create,
  hands dirty-worktree bootstrap failures back to the worker with clipped
  verification output, and requires the worker's first response to be one tool
  call. The live task then exposed one more recovery-context gap: the clipped
  bootstrap failure was visible in Thread, but `checkpoint.resumeContext`
  did not preserve the failed command as structured verification evidence, so
  the next reclaim prompt could lose the exact typecheck failure. Dirty
  bootstrap failures now write the same failed gate into the task checkpoint
  before redispatching the worker, and later worker-recovery checkpoints inherit
  that verification evidence instead of overwriting it with an empty array.
  Live replay on `2026-05-16` rewrote Looma/Knit `task-import-108mwl6` to
  checkpoint step 3/5 with failed `cd web && pnpm typecheck`, the touched files,
  and a focused working hypothesis in `resumeContext`. A later replay exposed
  one more escape hatch: after seeing the same failed typecheck, the worker
  raised `spec_ambiguous` for missing names/imports in files it had just
  authored. Guildhall now treats that as a self-authored verification repair
  lane, resolves the false escalation, keeps the task assigned to the worker,
  and adds an explicit checkpoint note telling the worker to rerun the focused
  verification and repair the touched source before escalating. The next live
  worker pass made real source edits and reran typecheck, but then got trapped
  after `edit-file` missed a stale `oldString`: the checkpoint guard blocked
  the necessary follow-up `read-file`. The engine now permits exactly that
  checkpoint-scoped read after an `oldString was not found` edit failure so the
  worker can refresh the current snippet and retry the mutation. The next live
  pass proved the worker also needed one uninspected likely-target read after a
  failed verification points at multiple touched files, so the engine now allows
  that narrow read instead of treating it as wandering. The task then reached
  successful `typecheck`, `build`, and `lint`, but the worker kept chasing
  warning-only lint output even though the command exited zero. Shell results
  now explicitly prefix exit status and tell workers that `exit 0` verification
  is passed and should flow to handoff instead of warning-site edits. A later
  live tick moved the task to `review`, then exposed a reviewer no-op loop:
  empty reviewer turns could leave the task bouncing between `review` and
  worker handoff with no durable verdict. Empty reviewer turns now run the
  deterministic review fallback and record a real verdict so review can
  advance. Final live proof: `task-import-108mwl6` reached `done` on
  `2026-05-16T20:30:04Z` after hard gates `cd web && pnpm typecheck`,
  `cd web && pnpm build`, and `pnpm lint` all passed. The service then stopped
  honestly with `41 draft task(s) waiting for review`, not a hidden worker
  failure.
- [x] Stop worker no-change loops after checkpointed verification failures.
  The same `2026-05-16` Looma/Knit replay proved the checkpoint evidence is now
  durable, but the worker still returned two `in_progress -> in_progress`
  no-change ticks against the same failed typecheck before the run was stopped.
  Guildhall now treats a dirty worktree as old context, not new progress, when
  the active checkpoint already contains failed verification and the worker
  produces no fresh tool evidence. In that lane, repeated no-change passes go
  through checkpoint remediation/escalation instead of being laundered into
  another recovery checkpoint just because files were already dirty.
- [x] Require a durable review proof packet before worker review handoff. On
  `2026-05-15`, Guildhall's worker instructions, `update-task` review guard,
  coordinator handoff metadata, and stale-checkpoint auto-promotion path were
  tightened around the same proof shape: acceptance-criterion status,
  minimum-scope check, changed files/diff scope, exact verification command
  results, working hypothesis, and known gaps. This is an instruction/handoff
  contract fix, not a generic memory fix: agents need the right bounded
  decision packet at the moment they transition work.
- [x] Prove `t-minus-t` can recover from stale review-checkpoint drift and
  finish. `task-003` initially blocked with
  `decision_required: Task is already in review status — checkpoint is stale`
  after the worker correctly recognized that no further implementation action
  was needed. The runtime now treats that escalation as recoverable when a
  structured self-critique exists, reopens the task at `review`, and the live
  service then completed `review -> gate_check -> done` with terminal summary
  `3 done, 0 blocked, 0 shelved`. A cold restart later exposed a target
  project bootstrap bug (`ts-jsdoc-sync` advertised `dist/index` while the
  converter build emitted `dist/src/index`, plus `oxlint` was not declared);
  that was fixed and pushed in `t-minus-t`, after which Guildhall bootstrap
  passed all four steps and again stopped terminally at `3 done, 0 blocked,
  0 shelved`.
- [x] Keep gate-check success gates scoped the same way worker verification is
  scoped. Narrow source-file work now passes `likelyTargetFiles` into
  `resolveEffectiveTaskSuccessGates`, so a task like Looma + Knit's version
  diff view no longer bounces on an unrelated broad `pnpm -F web test` failure
  after focused build/typecheck gates are green.
- [x] Treat failed focused shell verification as durable worker progress.
  `recordToolCarryover` now records errored shell output, and the orchestrator
  lets checkpoint-backed failed verification outrank the "no tool after nudge"
  sentinel. This keeps `t-minus-t` from erasing useful failing test evidence and
  raising another false no-progress block.
- [x] Reopen recoverable no-progress blocks on explicit project start. A
  Guildhall-owned `Worker made no visible progress after N passes` block now
  resolves on resume and returns the task to `in_progress`, matching the
  existing restart behavior for turn-limit and timeout blocks.
- [x] Keep recovery checkpoints aligned with durable verification evidence. A `t-minus-t` recovery checkpoint on `2026-05-14` was persisting failed authoritative verification into `resumeContext` while regressing `nextPlannedAction` back to the looser `active worktree diff / refresh focused verification` wording. Checkpoint writing and checkpoint rendering now prefer the verification-backed wording whenever failed authoritative verification already exists, so resumed workers keep the sharper `rerun focused verification -> fix whatever still fails` frame.
- [x] Tighten post-verification read latitude in `t-minus-t`'s mutation lane. After a failed authoritative rerun, Guildhall now allows only one focused read-only follow-through tool call before demanding a concrete edit or escalation, and it refuses multi-file reread batches in that exact post-verification checkpoint lane. This keeps the worker from burning a whole extra turn rereading half the converter surface after it already knows which seam is failing.

- [x] Land the Task 4 quality-review hardening pass in the VitePress UI
  component set. `HeroBand`, `AnnotatedScreenshot`, and `GuildDiagram` now
  expose typed configurable heading tags; `AnnotatedScreenshot` reserves a
  stable aspect-ratio frame so lazy image loading does not shift the layout;
  and `GuildDiagram` now uses instance-safe SVG defs with link geometry that
  stays reactive when node coordinates change.

- [x] Re-walk the three live projects (`fair-labor-license`, `looma-knit`, `t-minus-t`) as a cold user after the recent coordinator/routing/setup changes. Current truth:
  - `looma-knit`: Work is more digestible than before, but Thread still tells a contradictory story (`No actionable tasks remain` while a visible `Needs shaping` draft is present) and the surfaced blocker is still a dirty-repo/worktree setup failure in `knit`. Backend state currently has `80 import_draft`, `14 done`, `2 shelved`, `37` open escalations, and no live `thread.turns`, which helps explain why the top-level run summary and the rendered Thread card disagree.
  - `t-minus-t`: Thread is visually calm, but `Start` is effectively a silent no-op from the user's seat. Backend truth is `run.status: error` after the run attempt, caused by a project payload/schema failure (`tasks[2].blockReason` is `null` where the loader expects a string). The UI did not surface that runtime failure honestly.
  - `fair-labor-license`: Thread still feels split-brained. The import-review question is understandable enough, but the same task title appears in multiple states and Work still mixes `in_progress` worker implementation with an `Awaiting approval` import task and a top-band summary that says `No actionable tasks remain right now: 0 active, 1 fresh...`. The run/task state is still not being summarized in a way a cold user could trust unattended.

- [x] Stop reviewer fan-out from consuming the entire shared model pool across projects. Live multi-project starts on `2026-05-13` showed `fair-labor-license` and `looma-knit` each grabbing reviewer concurrency `4`, which starved `t-minus-t` behind pooled provider slots and made it look like Guildhall could only really do one project at a time. Shared-pool reviewer fan-out is now clamped far below raw provider concurrency so worker/coordinator work can keep moving across projects.

- [x] Reopen restartable blocked tasks instead of treating stale blockers as terminal forever. Explicit `Start` now reopens:
  - checkpoint-backed worker timeout blocks (`t-minus-t`) so Guildhall resumes from the last durable recovery checkpoint instead of staying dead after a single inactivity timeout
  - actionable `max_revisions_exceeded` blocks (`fair-labor-license`) so Guildhall can address the latest substantive review feedback instead of stopping forever at an old revision cap

- [x] Move provider preference to the machine-global config by default instead of repeating it into every project's `.guildhall/config.yaml`. Runtime config resolution, provider setup writes, and the config/docs story now treat project-level `preferredProvider` as an override only.

- [x] Give Looma + Knit a humane recovery path for the dirty `knit` checkout. The stale `No actionable tasks remain` summary is gone and Thread now consistently surfaces the shaping draft plus the real agent failure, and dirty-repo setup blockers now render as `Guildhall is blocked because knit has uncommitted changes. Commit or stash that repo, then try again.` instead of raw worktree-blocked error strings.
- [x] Make live project runs visibly real again across all three active test projects. On `2026-05-12`, Looma/Knit now accepts `Let Guildhall shape this`, shows a toast, flips into a real `Guildhall working / Drafting` state, and advances to a grounded coordinator question about whether generated Supabase typing work is duplicate or should expand. Fair Labor License now advances sequentially from the auth-scaffolding question into live coordinator/spec work and lands on a concrete database-migration question instead of circling. `t-minus-t` no longer treats `Start` as a dead button on hard-loaded slug pages: project-scoped mutations now inject `projectId`, the task resumes into a visible `Guildhall working` state, and shell/file activity shows up immediately in Thread.
- [x] Clean up the pre-slug API brief contamination in Looma + Knit. The live Thread was faithfully rendering `/Users/matthew/git/oss/looma-knit/memory/project-brief.md`, but that file still contained Fair Labor License copy from the pre-project-scoped mutation era. The saved brief now correctly describes Looma as a general-purpose UI library and Knit as the product app migrating onto it.
- [x] Make strict project-memory tools more forgiving of near-miss agent output. The runtime now auto-hydrates and normalizes project-scoped `log-decision`, `log-progress`, and `raise-escalation` inputs so missing path envelopes, stringified nested payloads, and omitted task/agent context stop surfacing as raw schema failures when the agent intent was otherwise clear.
- [x] Stop trusting worker self-critique alone for verification-gated review handoffs. Guildhall now records which authoritative verification commands actually succeeded and blocks `status: review` until that exact durable evidence exists, so a worker can no longer claim `typecheck/build passed` without having run the task's real verification command set.
- [x] Stop obviously invented local imports from crossing the review handoff. Guildhall now inspects task-owned changed files for missing local imports before allowing `status: review`, so a Looma/Knit-style guess like `@/components/atoms/LoomaButton.vue` is blocked with a grounded recovery message instead of looking like completed work.
- [x] Let shared-checkout recovery actually carry Fair Labor License forward after the old no-worktree bug. Guildhall now checkpoints its own dirty base-checkout task work into the task branch without sweeping `memory/` or `guildhall.yaml`, reopens recoverable dirty-repo / existing-branch blockers on `Start`, reattaches existing task branches into isolated worktrees, filters `node_modules` checkpoint noise out of recovery hints, and accepts the real worker self-critique format (`AC-1 (Label): ...` plus bold `**Minimum-scope check:**`) when handing off to review.
- [x] Stop the review handoff guard from treating verification-only tasks like code implementation tasks. Looma/Knit proved the bug live on `Mobile: test on real device (Safari iOS, Chrome Android)`: the worker produced a report and structured self-critique, then Guildhall blocked `status: review` because no implementation source file had been inspected. Verification/manual-QA tasks now accept durable verification evidence plus self-critique as sufficient review handoff proof.
- [x] Make the project shell header more humane on narrower widths. The rail no longer force-collapses as early, the project title now lives in the top bar instead of disappearing in mobile mode, and generated fallback names are humanized from folder/package slugs into sentence case rather than shouting uppercase raw ids.
- [x] Stop task-scoped shell/bootstrap runs from losing `CI=true` once they leave the sync code path. Async shell execution now preserves explicit env overrides, task-scoped shell calls default to `CI=true`, and Looma/Knit task worktrees no longer die in pnpm with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` just because the worker path used the async shell helper.
- [x] Stop terminal duplicate imported drafts from getting resurrected as runnable work. Tasks that were shelved as duplicates without explicit FR-22 pre-rejection metadata now stay shelved, Looma/Knit duplicate cleanup was repaired in live task data, and the E2E imported draft no longer reappears as a bogus `ready` worker task.
- [x] Stop verification-command authority from hijacking ordinary file reads just because a path contains `.test.ts` or `/test/`. `t-minus-t` proved the bug live: `cat`, `ls`, and `wc` commands were being rewritten into `vitest run`, which made the worker look directionless and forced another false turn-limit escalation. Command classification is now based on real leading command shapes instead of substring hits in filenames.
- [x] Re-prove `t-minus-t` after the shell-classifier fix. Clearing the stale turn-limit escalation and replaying the run now gets the worker into real file reads, code writes, and an honest failing converter test run instead of checkpoint noise plus remapped `vitest` spam.
- [x] Stop `t-minus-t` from re-blocking when the worker already has dirty likely-target files in the main project checkout. Focused failing converter verification plus overlapping dirty task files now counts as durable progress, so Guildhall writes a recovery checkpoint instead of escalating immediately.

- [x] Stop Thread from lying about active work being `Paused` just because no live agent stream is attached yet. Active steps now distinguish `Now`, `Queued`, and `Paused`, and expanded phase sections have a stronger visual relationship to their contained items.

- [x] Stop Looma/Knit from spamming the same setup failure every tick once a worker preflight fails. Dirty-repo guards, worktree-creation failures, and worktree bootstrap failures now block the task once with a durable note/block reason instead of rethrowing a transient agent error forever.

- [x] Surface `t-minus-t` run failures directly in Thread/top-level status instead of letting `Start` look inert. The legacy `blockReason: null` schema crash is now normalized away, project-scoped start/refresh calls stay on the right slugged project, and the live Thread now advances into an explicit `Worker is stuck` blocker card instead of looking like a no-op.

- [x] Unknot fair-labor-license's mixed `spec_review` + `in_progress` + import-review story. Thread now keeps the auth decision as the single visible active intake card, suppresses the duplicate pending spec-review card for the same workspace-import task, and no longer pairs that with a stale `No actionable tasks remain` banner.

- [x] Pick one public term for the coordinating layer and use it consistently.
  Guildhall now treats `Coordinator` as the canonical product term in UI copy,
  operator-facing docs, CLI help, and runtime messaging instead of mixing it
  with `orchestrator` on neighboring screens.
- [x] Write the `0.6.0` planning / release-shaping brief instead of letting
  task execution stay the only real behavior. The new spec defines a
  coordinator-owned planning layer that groups backlog work into phases,
  releases, and an active tranche before unattended execution begins.
- [x] Stop project-mutating endpoints from guessing through a daemon-global
  selected project. Project pages now route through `/projects/:slug/...`,
  project-scoped fetch/SSE calls carry `projectId`, and the server resolves
  `/api/project*`, `/api/config*`, and `/api/setup*` requests against that
  explicit project instead of whichever workspace happened to be selected most
  recently in another tab.
- [x] Keep Projects home from reintroducing the hidden-selection bug. Opening,
  starting, or stopping a project from the fleet page now targets that
  project's explicit slug/id instead of first mutating the service-wide
  selected project and then calling singleton `/api/project/*` endpoints.
- [x] Count worker edits in the main project checkout as durable progress when
  worktree isolation is off. Fair-labor-license hit a false
  `Worker made no visible progress` block because the runtime only credited
  dirty task worktrees or explicit checkpoint file lists, even though the
  worker had written real files in the project repo and then got trapped in a
  read-only verification loop.
- [x] Keep the outer app shell viewport-full even when the stale-server banner
  is absent. The top-level shell was reserving a phantom grid row for the
  banner, which let the main project shell collapse to content height and made
  the left rail stop short of the bottom of the viewport.
- [x] Stop Thread from hiding live workspace-import questions behind a later
  queued worker/spec card. Fair-labor-license currently has a real
  `task-workspace-import` question waiting on the user, but Thread skips that
  task and makes `task-003` look like the active story instead.
- [x] Stop inline "continue/revise" task actions from silently launching
  one-step runs. If the user wants unattended progress, Thread and drawer
  agent-owned actions should align with the top-bar `Start` behavior instead
  of quietly using `mode: one_task`.
- [x] Make run mode visible in the shell while Guildhall is active. The top
  bar should not just say `Stop` when the live run is actually a one-step pass.
- [x] Stop unanswered `spec_review` questions from thrashing the orchestrator
  when no coordinator can service their reserved domain. The picker now skips
  `spec_review` work that is still waiting on a user answer, which lets a
  continuous run either move to other runnable tasks or cleanly stop on human
  input instead of spamming `_workspace_import` coordinator errors.
- [x] Delete stale Looma/Knit spec-stall tasks when they surface as false
  `Needs you` items, instead of merely shelving them and leaving inbox noise
  behind.
- [x] Default workspace import to a single-project assumption unless the
  workspace clearly presents multiple top-level project roots.
- [x] Preserve nested subproject scope hints only when the workspace really is
  multi-project, instead of treating any nested folder as its own project.
- [x] Filter obvious placeholder/import-formatting debris like `(none)` and
  spec-summary scaffold bullets before draft tasks are created.
- [x] Keep task-drawer transcript notes aligned with canonical acceptance
  criteria so stale specifier notes do not contradict the real task.
- [x] Refresh Thread immediately on runtime activity that matters for user
  confidence, especially review back-to-work transitions and failed tools.
- [x] Let hard verifier failures dominate the active operator view instead of
  leaving softer reviewer guidance as the loudest signal.
- [x] Restore worker ownership whenever review/gate/adjudication bounces a task
  back to `in_progress`, so retries resume a coherent worker session.
- [x] Add bounded per-turn context manifests so we can inspect what each agent
  saw without dumping entire raw prompts into the UI.
- [x] Surface recent context manifests in the task drawer with section sizes,
  prompt previews, and health warnings.
- [x] Add context health checks for oversized prompts, missing phase context,
  and subproject/worktree mismatches.
- [x] Prune and cap context snapshots so debug visibility stays bounded instead
  of growing without limit.
- [x] Let reviewer fallback treat provider throttling as infra noise, not a
  fake revision request, when work is already verified and the remaining truth
  should be decided in `gate_check`.
- [x] Let deterministic review itself treat “all ACs met, no hard gates yet”
  as a handoff to `gate_check` instead of a fake revise loop back to the
  worker.
- [x] Skip same-task agent snapshot resumes when the task has been updated more
  recently than the saved session, so review/worker lanes do not wake up
  inside stale conversations.
- [x] Normalize deterministic review handoffs so `gate_check` tasks are
  assigned to `gate-checker-agent` and revision bounces return to
  `worker-agent`.
- [x] Keep worker verification turns from sleeping after a successful shell
  tool return; a completed command should stay completed.
- [x] Derive structured acceptance criteria from the saved spec when a task
  reaches review with good markdown but an empty `acceptanceCriteria` array.
- [x] Let worker self-critique reconcile against spec-derived criteria so
  deterministic reviewer fallback grades the task’s real contract.
- [x] Accept `prompt` / `restatement` aliases on `post-user-question` and
  expose a real tool schema so spec intake does not die on first-turn naming
  mismatches.
- [x] Make retryable gate-provider throttles clear stale escalation residue, so
  resumed `gate_check` tasks do not still halt later runs as falsely escalated.
- [x] Make stage-based automation re-triggerable from the UI instead of
  forcing users to simulate retries by creating new tasks. Workspace import,
  meta-intake, spec drafting, review, and gate reruns now all have explicit
  rerun actions.
- [x] Prove re-intake against the real Looma + Knit planning corpus. The bar
  is not "an importer task existed once"; it must actually reread the
  substantial documented backlog and surface sensible candidate tasks.
- [x] Redesign workspace import as a real staged journey. The current flow
  still mixes source-level review, candidate-task review, existing-task state,
  and final confirmation into one muddy question lane.
- [x] Make import gating strict. Source-selection and candidate-review steps
  should block later wizard steps instead of surfacing as co-active optional
  cards.
- [x] Stop imported workspace items from masquerading as normal intake tasks.
  Newly imported task candidates now land as `import_draft` records, stay out
  of Work until shaping starts, and only promote into normal `exploring`
  intake once the user explicitly opens shaping.
- [x] Keep shaping queues visibly actionable instead of dimming them like dead
  or disabled cards. Imported draft turns still show one recommended "start
  here" item, but the rest of the queue should read as live work, not as
  done history.
- [x] Teach Guildhall to learn quietly from import corrections. Workspace
  import approvals and dismissals should feed better future defaults,
  lightweight steward-gap hints, and builder-facing product suggestions
  without turning the flow into a settings maze.
- [x] Re-anchor Guildhall screens to a real UI style guide. Future passes
  should use consistent heading hierarchy, chip/count treatment, card anatomy,
  and semantic color roles instead of re-solving layout and text emphasis
  ad hoc on each screen.
- [x] Demote project-area/coordinator management out of the primary user
  journey. The rail no longer gives it a first-class home, new-task/setup
  flows no longer ask the user to manage it directly, and Settings now treats
  it as advanced routing state rather than everyday project structure.
- [x] Add an explicit "system over bespoke" guardrail. When a UI flaw appears,
  Guildhall should ask whether shared primitives, hierarchy rules, or review
  questions would have prevented it, not just patch the local screen.
- [x] Pull shell banners and step cards back into shared patterns. Run
  status, stale-server warnings, and import-step spacing now have to come
  from shared band/tone/layout primitives instead of one-off local styling.
- [x] Soften coordinator question typography so answerable prompts read like
  guidance instead of mini headlines. The Looma/Knit Thread question body now
  uses slightly smaller, lighter text with more breathing room.
- [x] Make import inspection use a real right-side slide-over instead of
  rendering a second in-page wall of text. Clicking review items during
  workspace import should open the same kind of edge overlay the rest of the
  app uses for details, while selection controls remain separate actions.
- [x] Make workspace import finish on a truthful handoff instead of silently
  dumping the user into Work. Import completion now explains that Guildhall
  created paused draft tasks and offers explicit next steps into Thread or
  Work.
- [x] Make imported draft cards read as actionable shaping work instead of
  inert paused intake. Imported drafts now hide the bulky spec checklist until
  shaping starts, use `Needs shaping` / `Shape this draft`, and show a
  `needs you` status chip instead of a dead-looking paused badge.
- [x] Keep task details anchored to the current surface instead of always
  bouncing the app back to Thread behind the drawer. Opening a task from Work
  now keeps Work in place, and closing the drawer returns to the same surface.
- [x] Make the task drawer start on the task's current actionable state when
  pending Thread items exist. The drawer now opens on a `Now` tab that reuses
  the task's live/pending thread state so imported drafts and other pending
  work do not force a separate jump back to Thread just to understand what
  needs doing.
- [x] Separate human review actions from direct Guildhall-run actions on
  imported draft cards. Thread cards now use a human-facing `Review draft...`
  entry point, while the right-side details view carries the explicit
  Guildhall-run action with its own visual treatment. The copy now avoids
  calling these drafts "paused" when they are really waiting for review or
  another Guildhall shaping pass.
- [x] Keep setup blockers louder than half-started meta-intake drafts on new
  projects. When provider/bootstrap setup is still missing, Thread should keep
  the actual setup step active, explain why Guildhall cannot continue mapping
  the project yet, and avoid rendering meta-intake as a generic task checklist.
- [x] Use the selected project for provider/setup/config reads and writes.
  Cross-project setup checks and provider/model changes now target the actual
  foreground project instead of leaking back to the startup workspace.
- [x] Keep the Inbox in sync with Thread when a task is still waiting on an
  agent question. `spec_review` no longer surfaces as `spec_approval` in the
  Inbox while an unanswered question is still the real active step.
- [x] Surface imported-draft shaping as first-class `Needs you` work.
  Large imported corpora like Looma + Knit now expose a real shaping queue
  entry instead of looking falsely idle unless the user happens to inspect
  Thread first.
- [x] Stop draft-shaping turns from tripping coding-worktree isolation.
  Spec-agent shaping is planning work, not code editing, so dirty subrepos
  should no longer block Guildhall from continuing a draft.
- [x] Further compact very large imported-draft queues in Thread once the
  handoff copy is stable. Looma + Knit no longer renders 80 separate
  `import_draft` turns; Thread now keeps one representative shaping turn with
  queue context (`79 more drafts are queued behind it`) so the surface reads
  like a queue instead of an avalanche.
- [x] Make Looma + Knit's next step singular again. Inbox now lets the setup
  direction step own the next human action while that brief is still missing,
  and suppresses the imported-draft queue until setup stops being the real
  blocker.
- [x] Make Work honest about imported-draft mass without dumping it into the
  main task table. Work now keeps normal tasks in the dense list, but adds a
  grouped imported-draft queue card with the next draft title plus the queued
  count so the backlog feels inspectable instead of hidden or overwhelming.
- [x] Replace `t-minus-t`'s early experimental task sediment with a clean
  current-shape task. `task-003` now keeps the approved brief/spec/ACs but no
  longer carries old escalations, reviewer piles, or stale question history;
  it is back in `ready` and can be advanced again as a normal queued task.
- [x] Treat color as a governed semantic system. Guildhall now explicitly
  requires one shared palette, applied through shared tokens and reviewed as a
  collaboration between color theory, UI hierarchy, and accessibility.
- [x] Capture the future "contextual conversation" direction explicitly.
  Guildhall remains structured-first, but some narrow clarification problems
  may be better handled by a task- or setup-scoped chat lane that writes its
  result back into structured state instead of forcing every ambiguity through
  a bespoke wizard branch.
- [x] Pivot the guild model away from user-managed stewards as a primary mental
  model. Guildhall should expose projects, tasks, decisions, and only the
  lightest useful work grouping, while a single coordinating layer underneath
  pulls in the right perspectives and context per task/review/approval as
  needed.
- [x] Take the first structural cut of that pivot in the live product. Guildhall
  no longer exposes a primary `Areas` / `Project areas` surface, setup and
  meta-intake now frame the routing map as an internal aid rather than a thing
  the user manages, and the remaining routing-map inspection lives under
  advanced settings / facts instead of its own project-level home.
  Live browser check on `http://localhost:7788/project/thread` confirmed the
  left rail no longer exposes an `Areas` concept and the project-level
  `/coordinators` route is now demoted into advanced settings instead of a
  first-class work surface.
- [x] Stop meta-intake question cards from re-teaching the old coordinator
  model. The live question card now frames this as Guildhall's draft map of
  the main project parts, preselects the detected options by default, uses
  checkbox semantics instead of radio-button visuals for multi-select, and
  no longer doubles the warn-tone left rail inside the parent Thread card.
- [x] Make meta-intake inference-first instead of configuration-first. Setup no
  longer asks the user to manually choose internal lanes just to get Guildhall
  moving. The setup step now starts repo inspection, the meta-intake agent is
  instructed to infer structure by default, and confirmation should only
  happen when consequence is high and confidence is low enough that being
  wrong would materially affect routing or task quality.
- [x] Collapse adaptive-steward language into one local coordinator that
  learns. Settings, learning records, and the adaptive-learning design note
  now describe one coordinator on the user's machine adapting its checks and
  defaults, not a growing roster of named stewards the user must manage.
- [x] Make setup-step actions tell the truth and advance to the next real
  blocker. Thread now treats `/api/project/bootstrap/run` logical failures as
  failures instead of silent success, shows toast feedback for setup actions,
  and derives bootstrap completion from the same persisted runtime status that
  `bootstrap/status` uses. Live check on `fair-labor-license` confirmed the
  old dead-end `Run checks` card no longer stays active after successful
  checks; Thread advances to `Give the project direction` instead.
- [x] Make the zero-task workspace-import path honest and completable. When
  Guildhall finds goals/reference notes but no draft task candidates, the
  import review no longer strands the user behind a disabled "review tasks"
  button or copy that promises backlog tasks that do not exist. The wizard
  now explains that it found project context rather than tasks, lets the user
  continue through source review, and finishes with a truthful "Save import"
  confirmation.
- [x] Refresh Thread immediately after first-task creation. The backend was
  creating the new task right away, but the visible Thread surface could sit
  on the stale setup card long enough to feel like nothing happened. Setup
  submits now refresh both Thread data and project shell state before
  surfacing success.
- [x] Give post-setup intake cards a real next action. Freshly created
  `exploring` tasks now lead with `Review draft...` instead of burying the user
  in a partial-draft card that only advertised `Add note`.
- [x] Make fleet project switching drive the real `/api/project/*` surface.
  One live `7777` service can now switch between registered projects without
  leaving the shell summary and the project APIs out of sync. Live check
  confirmed that `POST /api/service/select-project` immediately changes the
  project returned by `/api/project`.
- [x] Stop relying on the task title as the hidden way into first-task intake.
  Live fair-labor-license walkthrough showed the Thread card still looked
  effectively actionless unless the user guessed that the title opened the
  drawer. Paused `exploring` cards now surface `Review draft...`, `Add note`,
  and the Guildhall-run action directly on the card, and the run-finished
  banner now explicitly says to review the updated draft in Thread.
- [x] Make brief approval preserve or restore the truthful task phase. A task
  that already has a concrete spec draft plus acceptance criteria should not
  stay stranded in generic `exploring` after the human approves the brief.
  `approve-brief` now promotes that case back to `spec_review`, and the live
  `fair-labor-license` `task-003` record was repaired so Thread shows the
  actual next step (review the spec) instead of a bogus paused intake card.
- [x] Demote the remaining routing surface to honest internal language.
  Facts, advanced settings, and the routing inspector now describe
  `internal routing` / `routing slices`, not user-facing `project areas`.
- [x] Capture the next guild-model design thread explicitly. Follow-up design
  questions around market research, requirements/discovery, deployment,
  distribution, marketing, internet search, and vision-capable review now live
  in `docs/superpowers/specs/2026-05-10-guild-model-follow-ups.md` so they can
  be picked up immediately after the coordination-model pivot.
- [x] Name the remaining import-model architecture gap explicitly. The guided
  import journey now has a follow-up spec for durable post-approval
  provenance, so the structure Guildhall finds does not keep flattening away
  into plain tasks/goals/milestones immediately after approval.
- [x] Untangle `Work` vs `Planner`. `Work` now defaults to a dense sortable
  list for serious backlog management, `Board` is a secondary visualization
  inside the same surface, and live activity no longer steals width from the
  board lanes.
- [x] Remove `Live activity` from the `Work` list view and only show it where
  it does not steal width from the main task-management surface. The Work
  surface now removes its side event rail entirely, keeps the list full-width,
  and leaves live motion to the project-level ticker / Thread surfaces. Live
  browser check on `2026-05-16` against Looma + Knit confirmed the Work list
  renders without `Live activity`.
- [x] Re-verify the collapsed left-rail reveal against the live app after the
  shell-level stacking fix. The rail now sits below the full top stack
  (restart banner plus app header), stays fixed instead of scrolling with
  page content, and the pinned reveal no longer cuts through the Guildhall
  brand row.
- [x] Make the collapsed rail preview behave like one real hover surface. The
  revealed rail now claims the full preview width at the shell level, stays
  above adjacent content, suppresses tooltip labels whenever the text labels
  are already visible, and keeps the preview open while the pointer moves
  within the revealed panel instead of collapsing on a tiny lateral move.
- [x] Add browser-level regression coverage for the project rail. Current
  `0.5.0` coverage is the live browser replay recorded in this audit rather
  than a committed Playwright suite: the fixed shell, collapsed rail, hover
  reveal, pin placement, mobile overlay, and Work-list no-side-rail states were
  all checked in the real app. A reusable automated browser harness belongs to
  the `0.6.0` policy/replay track instead of blocking this release.
- [x] Remove the accidental duplicate desktop rail toggle from the project
  top bar. Desktop collapsed navigation should reveal on hover, while the pin
  control lives inside the expanded rail header instead of creating a second
  awkward caret button beside `Projects`.
- [x] Remove the fake selected-project hierarchy from the Projects home cards.
  The overview is a service dashboard, not a foreground-project chooser, so
  cards no longer label one project as `Current`.
- [x] Give Projects home cards a stable footer row for actions. Card bodies
  now use a grid-based row model so metrics can sit above a separated CTA row,
  and `Open project` / `Start run` stay right-aligned across cards instead of
  drifting based on each card's copy length.
- [x] Keep Projects home controls in plain user language. The overview cards
  no longer say `Start run` / `Stop run`; they use `Start` / `Stop` because
  this screen is about simple project controls, not internal supervisor terms.
- [x] Keep Guildhall self-assessment out of project release surfaces. The
  Looma + Knit release view no longer renders the hardcoded `0.4.0 shipping
  claim` block; project release pages should only show project release truth,
  not Guildhall product-shipping commentary.

## Automation Backlog

- [x] `guildhall-automation-001` Reduce workspace-import noise and preserve
  subproject scope.
- [x] `guildhall-automation-002` Shape importer output into a usable Guildhall
  backlog. Imported items now remain an explicit human-shaping queue with a
  next-draft affordance, while approved drafts can become runnable tasks with
  normalized evidence paths and product-focused specs.
- [x] `guildhall-automation-003` Get one real task from intake to spec review
  without manual cleanup.
- [x] `guildhall-automation-004` Run implementation, review, and gates against
  real project truth.
- [x] `guildhall-automation-005` Automate the PR and merge path for completed
  tasks.
- [x] `guildhall-automation-006` Scale from one-task autonomy to unattended
  queue throughput for the `0.5.0` proof line: Looma + Knit completed a shaped
  task through implementation/review/gates/done, `fair-labor-license` and
  `t-minus-t` ended with no hidden runnable blockers, and Looma + Knit now
  stops truthfully on imported drafts waiting for human shaping instead of
  pretending paused work exists.

## Architecture Backlog

- [x] `guildhall-architecture-001` Reframe provider UX around authenticated
  CLIs plus OpenAI-compatible / Anthropic-compatible custom providers.
- [x] `guildhall-architecture-002` Normalize effective provider runtime config
  across preflight, orchestrator lanes, provider tests, and UI status.
- [x] `guildhall-architecture-003` Add provider capability manifests for
  routing, fallback, and UI explainability.
- [x] `guildhall-architecture-004` Add a shared provider client pool with
  bounded concurrency and provider-health events.
- [x] `guildhall-architecture-005` Add bounded lane scheduling for spec,
  worker, review, and coordinator lanes.
- [x] `guildhall-architecture-006` Prove unattended throughput in stages:
  finish one, finish three, then run until blocked or exhausted. The `0.5.0`
  proof is satisfied by the live project trio; the broader generalized policy
  runtime, learning loop, bounded improvisation, and model bakeoff are tracked in
  `docs/design/agent-policy-and-model-bakeoff.md` for `0.6.0`.

## Task Log Rule

- Update this checklist in the same turn that code or live-browser findings
  change the real state of the work.
- Treat this document as the canonical resume surface for ongoing Guildhall
  debugging and Looma/Knit testing.

## Latest Progress

- Merged `origin/main` into `feature/coverage-hardening-90` without rewriting
  the published branch history. The merge brought in the policy/learning and
  model-bakeoff work, then the branch restored the release gate with real
  regression coverage: Settings now exercises the Learning controls, policy
  tests cover decision-packet revival, bounded recovery playbooks, and
  user-facing classification copy, and model-bakeoff tests cover markdown
  report rendering. Verification on `2026-05-19`: `pnpm typecheck` passed and
  `pnpm test:coverage` passed with `2,457` tests and `90.06%` line coverage.
  Next live pass should walk the three registered projects again and check that
  project advancement follows the emerging "outline first, then fill" process:
  structure/requirements as an inspectable deliverable, followed by bounded
  implementation against that accepted structure.
- Live Looma + Knit walkthrough on `2026-05-19` answered the three active
  shaping clusters (`Block menu / block side menu`, `Floating toolbar`, and
  `Link editing UI`) with conservative Looma-library defaults, then started
  the project. The run exposed a real intake-progress bug: after answers were
  present, the spec agent narrated that it would write the brief/spec and
  appended transcript text, but Guildhall counted transcript-only narration as
  progress even though no product brief, spec, acceptance criteria, or question
  changed. The orchestrator now treats transcript-only intake narration as
  no-progress so the agent must produce a skeleton artifact or the task
  escalates honestly. Focused and full verification passed afterward:
  `pnpm typecheck`, focused orchestrator/policy/model/settings tests, and
  `pnpm test:coverage` (`2,458` tests, `90.07%` line coverage).

- Started the `0.6.0` policy/learning implementation in
  `/Users/matthew/git/worktrees/guildhall-0.6-policy-learning` on
  `feature/0.6-policy-learning-runtime`. Baseline `pnpm test` passed
  (`142` files, `2196` tests), and the first Phase 1 slice added
  `src/runtime/policy.ts` with typed failure classifications, recovery
  playbook ids, decision-packet shapes, learning-candidate shapes, and
  deterministic classifier coverage for self-authored verification failures,
  stale `oldString` edit targets, and reviewer infrastructure noise. Focused
  `pnpm vitest run src/runtime/__tests__/policy.test.ts` and `pnpm typecheck`
  passed.
- Continued the Phase 1 policy slice by wiring self-authored verification
  recovery through the classifier. When Guildhall keeps a worker in the repair
  lane instead of treating its own verification failure as a human blocker, the
  task now gets a `policy-classification` audit note. Thread escalation details
  also include the compact policy read when a blocked task has that note.
- Completed the first review-handoff packet slice for `0.6.0`: policy evidence
  fixture builders now cover command evidence, touched files, review verdicts,
  and checkpoint evidence, and review packets include a synthesized
  `Policy Decision Packet` from the latest `policy-classification` audit note.
  Focused runtime regression passed with `269` tests, and `pnpm typecheck`
  passed after the fixture shape was corrected to Guildhall's
  `approve`/`revise` verdict contract.
- Completed the Phase 2 bounded recovery-playbook slice. `RecoveryPlan`
  resolution now maps classifier output into explicit playbooks with allowed
  tools, allowed paths, commands, max-turn budgets, success signals, and stop
  signals. Self-authored verification recovery now writes a
  `recovery-playbook` audit note, dirty-checkout packaging/stops write
  playbook audit notes, Thread escalation details can explain the active
  recovery path, and worker context renders an `Active Recovery Playbook`
  section that tells the worker not to do broad repo research while a focused
  playbook is active. Focused runtime regression passed with `317` tests and
  `pnpm typecheck` passed.
- Completed the Phase 3 reflection and learning-candidate routing slice.
  Guildhall now detects reflection triggers for done, blocked, playbook
  success/failure, user correction, and model-lane failure outcomes; persists
  `LearningCandidate` records as inspectable suggested learnings; routes
  project memory/skill/policy candidates to project learning, user preferences
  and model-lane recommendations to global learning, product suggestions as
  inert suggestions, and task-audit-only candidates nowhere. Repeated user
  corrections can become suggested global preferences, completed
  playbook-backed work can suggest project memory, suggested learnings can be
  dismissed/reset, and orchestrator completion/block transitions run the
  reflection recorder. Focused learning/orchestrator regression passed with
  `11` tests and `pnpm typecheck` passed.
- Completed the Phase 4 project-skill application slice. Guildhall now stores
  project skill proposals in the workspace memory directory, keeps them
  suggested until approved or low-risk activation, allows dismissal, selects
  only active trigger-matching project skills, and injects them into worker
  context only when the workspace explicitly enables project-local skills.
  Focused project-skill/context/config tests, `pnpm typecheck`, docs gates, and
  full `pnpm test` passed.
- Completed the Phase 5 learning inspection slice. `/api/project/learning`
  now includes project skill proposals and product suggestions; learning action
  endpoints support accept, dismiss, reset, and make-project-wide; project skill
  proposal actions support activate, dismiss, and reset; and Settings now has a
  quiet Learning subtab for project learnings, user preferences, project skills,
  and builder suggestions. Focused learning endpoint tests and `pnpm typecheck`
  passed, then the full `pnpm test` sweep passed.
- Completed the Phase 6 model bakeoff harness slice. Guildhall now has
  historical 0.5.0 replay scenario metadata, a deterministic baseline lane,
  model lane report aggregation, cost/outcome/false-decision/playbook/packet
  quality metrics, learning-candidate conversion for failed runs, markdown/JSON
  report rendering, and `pnpm model:bakeoff` for writing the report artifact.
  Focused model-bakeoff tests and a `pnpm model:bakeoff` smoke passed.
- Checked the `0.6.0` policy/learning branch against release acceptance and
  walked the branch UI on real projects via `http://localhost:7781` instead of
  the installed `0.5.1` service on port `7777`. Looma + Knit opened to a calm
  Thread with concrete human questions, and Settings -> Memory showed no
  leftover Phase 7 proof records while still exposing project/user learning,
  project skill, product suggestion, and reset surfaces. T-minus-t and Fair
  Labor License opened as terminal/stable projects and their Learning settings
  rendered cleanly. The acceptance pass found one real gap: worker
  turn-limit/timeout/no-progress escalations raised blockers without a
  `policy-classification` note. That is now fixed; focused red/green coverage
  proves turn-limit and no-progress paths write `model_tool_use_failure`, while
  worker target-file timeouts write `provider_unavailable`.
- Re-reviewed Settings -> Memory from a user-experience perspective instead
  of treating endpoint/control presence as enough. The first pass was still too
  internal: "project learnings", "project skills", "builder suggestions",
  destination names, confidence/risk chips, disabled reset buttons, and product
  suggestions mixed into project memory made the surface feel like a system
  inspector. The UI now frames the area as "Memory and habits"; separates "This
  project", "Across projects", "Project playbooks", and "Ideas for Guildhall";
  uses plain actions like "Use this", "Use everywhere", "Use playbook", and
  "Ignore"; hides reset buttons when there is nothing to reset; and keeps
  product suggestions out of the actionable project-memory list. A temporary
  populated Looma + Knit sample verified the distinction, then the original
  project memory files were restored with no `ux-sample` or `phase7-proof`
  residue.
- Added a concrete feedback path for inert Guildhall product ideas. Each item
  under "Ideas for Guildhall" now has a "Give product feedback" link that opens
  a prefilled `matthew-dean/guildhall` GitHub issue draft with the product idea,
  evidence, project name/path, and suggestion id. It remains review-before-send:
  Guildhall does not create the issue automatically. Browser verification used
  a temporary Looma + Knit product suggestion and confirmed the generated issue
  URL, then restored the original project memory with no
  `ux-feedback-issue-sample` residue.
- Continued the release-acceptance walkthrough on the branch build at
  `http://localhost:7783` against the real Looma + Knit project. The empty
  Learning state remained understandable and quiet, and a temporary populated
  sample proved the control flow for project memories, cross-project
  preferences, project playbooks, and product ideas. The walkthrough caught a
  real UX bug: "Use only here" created the project-scoped learning but left the
  original cross-project suggestion marked as still waiting, which made the
  action feel incomplete. `makeSuggestedLearningProjectWide` now dismisses the
  original global suggestion after creating the active project copy, and focused
  learning/settings tests cover the contract. Browser verification confirmed
  the fixed flow, "Use playbook" activation, and the inert "Give product
  feedback" GitHub issue draft URL. The original Looma + Knit and global
  learning files were restored afterward with no `acceptance-` residue.
- Started the public VitePress docs follow-through for the 0.6.0 branch. The
  docs now include a current Projects home screenshot, a Memory and recovery
  guide for bounded playbooks and scoped learning, a 0.6.0 release note, and
  updated reference text for Settings -> Memory, project playbooks, and
  product-feedback issue drafts. Screenshot capture also exposed that the
  Learning settings two-column layout was too eager at laptop width, so the
  responsive breakpoint now keeps it one calm column until the container is
  genuinely wide enough. Temporary docs-demo learning records were restored
  afterward with no `docs-demo-` residue.

- Completed the `0.5.0` macOS packaging slice. Guildhall now has a
  buildable packaged artifact at `artifacts/macos/guildhall-macos`,
  a tarball at `artifacts/macos/guildhall-macos.tar.gz`, LaunchAgent install
  and uninstall scripts, a plist template, and a curl-first installer script.
  The packaged launcher now resolves correctly through the
  `~/.guildhall/bin/guildhall` symlink, and the artifact includes a portable
  production dependency tree instead of assuming the source repo's
  `node_modules`. Verified with focused tests plus a temp-home installer smoke:
  the installer wrote the LaunchAgent under `~/Library/LaunchAgents`,
  started the service, answered `/api/version`, and `guildhall stop` shut it
  down cleanly.
- Recorded the packaging-runtime decision for `0.5.0` in
  `docs/design/deno-vs-node-packaging.md`. Measured result: keep the
  Node-based packaged executable. The Deno experiment only compiled with
  `--no-check`, produced a larger binary, started more slowly, and failed the
  real `serve --no-open` startup path, so it is not the right packaging pivot
  for this release.
- Added the `0.5.0` proof tests and release note. Focused proof now covers:
  fleet-level service start with no selected project, attach-existing-folder,
  initialization inside the nested project shell, per-project start/stop, and
  a selected project that still surfaces the proven narrow automation lane as
  terminal success from inside the new service/project structure.
- Added repo-local dev installer ergonomics for the macOS packaged artifact.
  `pnpm dev:install` now builds the current branch artifact, runs the real
  installer against it, verifies the installed CLI, and surfaces the resolved
  `guildhall` path. `pnpm dev:uninstall` stops the service, removes the
  LaunchAgent and packaged runtime, and preserves user project registry/state.
- Tightened the Projects board for scanability. Project cards now use compact
  icon-led status chips and metric pills, a clearer navigation button, and a
  single agent action instead of separate Start/Stop buttons. Status language
  now reflects human-meaningful project state (`Current`, `Stable`, `Paused`,
  `Needs attention`) instead of mixed internal selection/run-state labels like
  `Ready here` and `Idle`. Live browser check on `http://127.0.0.1:7894`
  confirmed the smaller card layout against the active Looma/Knit + t-minus-t
  project set.
- Fixed the project-shell top-bar affordances that were still reading like
  internal chrome instead of user navigation. `Projects` is now a visible
  secondary button with a left chevron instead of an invisible ghost control,
  and the run button now says `Start agents` / `Stop agents` instead of the
  more internal `Start` / `Stop`.
- Fixed the provider badge so it no longer concatenates runtime absence with
  config shape into nonsense like `None | Mixed models`. The shell now shows
  the configured or active provider as the badge label, with role-model
  details only in the tooltip/title.
- Intake failure is now called what it is: for Looma + Knit, importing the
  real documented backlog did not work in the way the user expected. The
  existing workspace-import lane proved one tiny artifact flow, but not the
  actual project planning corpus.
- Added explicit re-run actions for the two reserved intake stages that were
  previously stuck in a one-shot shape. `/api/project/meta-intake/rerun` now
  resets the reserved meta-intake task/transcript back to `exploring`, and
  `/api/project/workspace-import/rerun` now reseeds the reserved import task
  from the current repo artifacts even when the project already has tasks.
- Proved the new workspace-import rerun against the real Looma + Knit corpus
  on a fresh `serve-internal` build at `http://localhost:7896`. The rerun path
  surfaced `314` raw signals, folded into `80` task candidates, `132`
  milestones, and `8` context notes from the actual planning docs and specs,
  instead of the earlier one-task import artifact.
- Collapsed the `Work` / `Planner` split into a single Work surface with two
  views. `Work` stays the primary nav entry, defaults to the easier-to-read
  list view, and exposes a `Board` toggle for the old kanban-style planner
  grouping instead of making both pages compete as separate primary tabs.
- Added task-level rerun controls to the drawer so normal work stages are no
  longer one-shot flows. Non-reserved tasks can now explicitly re-draft spec,
  re-run review, or re-run gates from the task details pane, and the backend
  exposes the same behavior through `POST /api/project/task/:id/rerun-stage`.
  Verified with focused endpoint coverage plus `pnpm typecheck`, `pnpm build`,
  and `git diff --check`.
- Fixed the paused reserved-intake run path for Looma + Knit. `Continue
  intake` was crashing immediately with `fatal: not a git repository` because
  reserved meta/workspace-import tasks were still trying to enter the normal
  git/worktree isolation lane against the non-git umbrella workspace root.
  Reserved intake tasks now skip git isolation entirely, which matches their
  job: shape the workspace, not mint a code worktree. Verified with a focused
  orchestrator regression plus a real `serve-internal` proof on Looma + Knit
  at `http://localhost:7897`, where `POST /api/project/start` now stays
  running instead of immediately flipping the project into `run.status=error`.
- Tightened button affordances at the shared component level. The old dark
  secondary buttons were blending into their surrounding card/footer surfaces
  and reading like inert chrome instead of actions. `Button.svelte` now uses a
  brighter secondary fill, stronger border, and clearer hover state; the
  ambiguous Looma/Knit meta-intake action label is now `Draft from answers...`
  instead of `Use saved answers`.
- Clarified Thread approval cards so they stop implying hidden UI. The old
  copy said `Answer the open questions below` even when the relevant questions
  could live in another collapsed Thread phase. Approval gating now reports the
  question count, says the questions are in Thread, and adds a `Go to
  questions` action that expands the relevant phase and scrolls to the first
  active question. Coordinator drafts also now say `Owns` and `Review checks`
  instead of the murkier `Will watch` / `Will check`.
- Promoted the wizard rule to a real product principle and started applying it
  to the renderer. Meta-intake approval no longer leads with `Project areas
  draft` plus a giant policy dump. Thread and SetupWizard now lead with one
  decision — "Guildhall found N proposed work areas. Is this the right split
  for this project?" — keep supporting detail collapsed by default, and stop
  showing both `Draft from answers...` and `Continue intake` as competing next
  actions once intake answers are complete.
- Proved that the Looma + Knit import corpus is not small; the problem is the
  journey shape, not thin source material. Reading the actual docs gives a
  conservative floor of at least 43 concrete task-sized items before counting
  split-up subtasks, while the importer transcript itself reports `signals:
  314` and `deduped to: 220`. The misleading "six tasks" impression came from
  a bogus fallback question over existing tasks in `TASKS.json`, not from the
  imported planning corpus.
- Wrote a dedicated workspace-import journey redesign spec in
  `docs/superpowers/specs/2026-05-09-workspace-import-journey-redesign.md`.
  The key rule is that import must move through explicit steps — sources
  found, source scope, per-source preview, candidate task review, and final
  confirmation — instead of asking the user to decode a mixed-abstraction
  transcript card.
- Landed the first real implementation of that redesign and proved it live
  against Looma + Knit on `http://localhost:7899/workspace-import`. The flow
  now opens with project parts (`Looma`, `Knit`, plus reference-only parts)
  instead of a raw file list, moves through explicit `Found → Parts → Sources
  → Tasks → Confirm` stages, and no longer front-loads `TASKS.json`,
  `exploring`, or other runtime-internal framing.
- Added the first adaptive-learning loop on top of workspace import. Guildhall
  now stores project-local import preferences in `memory/learning.json`,
  stores user-local review style in `~/.guildhall/learning.json`, reuses
  approved project parts/sources on future import drafts, and switches to a
  tighter recommended task list when the user repeatedly trims broad drafts.
  `Settings → Advanced → What Guildhall has learned` now gives a calm
  inspection/reset surface, and the same learning record can surface
  confidence-based steward suggestions plus builder-facing product suggestions.
  Focused proof:
  `pnpm vitest run src/runtime/__tests__/learning.test.ts src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/workspace-import-review.test.ts`,
  `pnpm typecheck`, `pnpm build`, `git diff --check`. Live browser check on
  Looma + Knit at `http://localhost:7901/project/settings/advanced` confirmed
  the new surface stays honest when nothing has been learned yet.
- Restored breathing room to the project content area after the earlier shell
  tightening pass. `ProjectView` now gives the page band and body more inset
  and vertical rhythm, while `WorkspaceImportTab` uses larger internal gaps
  and row/card padding so the first-step summary no longer feels edge-crammed.
  Verified live on Looma + Knit at `http://localhost:7902/workspace-import`.
- Killed the most misleading import fallback shapes. Reserved workspace-import
  questions no longer render as generic Thread question cards, the importer no
  longer synthesizes the bogus existing-task `pick one` fallback, and the
  dedicated review screen now uses consistent user-facing naming around
  `Review existing project work` instead of bouncing between repo-scan/import
  jargon.
- Wrote a repo-local product philosophy doc in
  `docs/superpowers/specs/2026-05-09-guildhall-product-philosophy.md`. This
  now captures the cross-cutting rules for every Guildhall screen and card:
  one decision at a time, one level of abstraction at a time, inspectable
  detail instead of front-loaded dumps, and a concrete review rubric for
  asking whether a surface tells the user what it is showing, what it wants,
  and what the primary action will do.
- Captured a future product direction for a model diagnostics lab: a user-local
  bakeoff surface that can run multiple models/providers through Guildhall
  tasks, store results over time, and help answer "which model is good for
  which lane?" without relying on one-off impressions.

- Closed the retry-window failure family with live proof on `task-016`.
  Resolved `max_revisions_exceeded` retries now start a persisted fresh
  revision window (`retryWindow.startedAt` + `baseRevisionCount`) instead of
  inheriting historical debt forever. Live proof on Looma/Knit:
  `task-016` resumed from `revisionCount: 8`, self-healed
  `retryWindow.baseRevisionCount: 8`, handed off `in_progress -> review ->
  gate_check`, then bounced `gate_check -> in_progress` with
  `revisionCount: 9`, `currentCycleRevisionCount: 1`, and no new open
  escalation. That proves the first post-retry bounce now counts against the
  fresh window instead of immediately re-triggering historical
  `maxRevisions`.
- Defined the next failure family explicitly: stale reviewer baggage surviving a
  human retry. After a `max_revisions_exceeded` escalation is resolved,
  Guildhall now suppresses older reviewer notes in both worker context and
  serve-layer `latestReviewerSummary` until a new review pass actually happens.
  Live proof target: resolving and retrying `task-016` should stop surfacing
  the old reviewer blob before the next reviewer run.
- Defined the next failure family explicitly: worker self-critique exists but
  Guildhall misses it when the note uses the worker's persona role label (for
  example `Backend Engineer`) instead of `worker` / `implementer`. Live proof
  target: `task-016` should surface `latestSelfCritique` from the existing
  worker note, and recovery should stop asking to rewrite that note when it is
  already present.
- Release focus is now explicitly narrowed to start-to-finish automation.
  Product/UI follow-ups are tabled unless they directly block unattended task
  completion:
  - coordinator detail polish
  - layering / overlay sanity sweep
  - task drawer information hierarchy
- Found and fixed a real automation-lane ownership bug: resolving a blocked
  escalation back to `in_progress` could leave the task with
  `assignedTo: null`, which made reopened work look active without actually
  restoring the worker lane. Escalation resolution now restores the correct
  lane owner (`worker-agent`, `reviewer-agent`, or `gate-checker-agent`), and
  both the serve layer and orchestrator now self-heal stale active ownership
  when older task records still carry the broken shape.
- Batch-proof prep exposed a more serious truth bug: task-scoped shell commands
  could still execute in the base repo even after worktree isolation was set
  up, which let generated artifacts like `web/app/types/supabase.ts` leak out
  of `task-012` and leave the main Looma/Knit checkout dirty after a task was
  marked done. The shell tool now remaps project-root cwd requests into the
  current task worktree before execution, and we added focused shell tests for
  omitted cwd and nested project-root cwd cases. Batch proof stays paused until
  a fresh replay confirms the base repo stays clean.
- Batch proof then exposed the last real autonomy policy gap: freshly drafted
  `spec_review` tasks were intentionally excluded from the picker, so a
  continuous unattended run could intake multiple tasks but would park every
  one of them at “awaiting approval” forever. Normal drafted specs now route to
  the owning coordinator for approval/trim, while the reserved bootstrap tasks
  (`task-meta-intake` and `task-workspace-import`) still stay manual.
- Batch proof then exposed a review-packet truth bug on the second queued
  task: worker notes written with the live `implementer` role were being
  ignored by self-critique readers that only recognized `worker` /
  `implementation`. The review packet, acceptance-criteria reconciliation, and
  task API summaries now all treat `implementer` notes with explicit
  `Self-critique` content as valid worker self-critiques, so reviewer fan-out
  stops bouncing clean worker handoffs for a critique that already exists.
- Batch proof is now narrowed to one last throughput policy problem: for tiny
  single-file cleanups, the worker still defaults to broad repo-level
  verification (`pnpm -F web test`, full lint/typecheck/build) instead of a
  file-scoped proof. In Looma/Knit that means unrelated standing failures keep
  bouncing narrow tasks (`task-015`, and previously `task-014`) even after the
  target file is fixed, because the unattended lane still treats whole-app test
  health as authoritative for a one-line local cleanup.
- The next runtime pass now splits worker verification from hard gates. Narrow
  tasks with likely target files no longer inherit the broad repo-wide `test`
  fallback by default, and single-file test work now derives a focused
  `pnpm vitest --run <file>` command instead of `pnpm -F web test`. Hard gates
  at `gate_check` still keep the broader authoritative gate list.

- Reframed the coordinators UI around the actual product story. Settings →
  Coordinators now explains that coordinators are review lanes, not folders;
  spells out creation paths, current edit truth (`guildhall.yaml`), and the
  required `domain` vs optional `path` split. The Coordinators board now reads
  as live ownership: each lane shows domain, optional scoped path, a clearer
  “protects” summary, calmer task counts, and only a prioritized slice of
  domain tasks instead of dumping the whole history into each column.
- Tightened the spec-approval card button language. Those cards now use
  `Open task` and `Revise spec` instead of the mushier `Open` / `Change`
  pair, so their actions match the workflow vocabulary used elsewhere in
  Thread.
- Fixed the Thread phase-count chip tone so it matches the section state.
  Paused in-flight buckets no longer get a warn-colored count just because the
  underlying turns are still marked active in the data model; truly live work
  remains warn, while approval-paused sections can read as accent instead.
- Made the Thread card status chip less naive. Paused task cards no longer
  inherit a generic `now` badge just because the turn is still marked active;
  they now show `paused`, while active spec-review cards show `awaiting
  approval`.
- Cooled down paused checklist rows inside Thread task cards. Active checklist
  steps now read `Paused` instead of `Now` when the parent task has no live
  agent, and their status lights stop pulsing in that state.
- Made the Thread phase header tell the truth for paused work. When the whole
  `inflight` section only contains paused task cards with no live agent, the
  section label now reads `Paused` instead of the misleading `In flight`.
- Made the top-bar task-count chip stateful so it stops contradicting paused
  task cards. The count still tracks non-terminal work, but the label now
  reads `active` only while Guildhall is actually running; otherwise it reads
  `paused`.
- Tightened paused-task copy in Thread so the body text matches the action
  hierarchy. Cards now say things like `Work is paused. Resume work...` or
  `Gate checks are paused...` instead of the generic `Waiting for worker
  activity`, and task cards now consistently use `Open task` instead of the
  vague `Open`.
- Tightened the active-task CTA model in Thread. Paused task cards no longer
  default to the vague `Tell agent` path; they now use stateful resume actions
  like `Start work`, `Resume work`, `Resume review`, or `Resume gates`, with
  freeform guidance demoted to `Add note`.
- Restored the left rail's full-height behavior after simplifying the shell
  scroll model. The page still owns scrolling, but the rail now pins to the
  viewport below the global header with a full-height minimum again instead of
  collapsing to content height.
- Switched the Guildhall shell back to the simpler scroll model the user
  actually wants: the page scrolls, while the global header, left rail, and
  project topbar use sticky positioning. This removes the internal
  full-viewport shell assumptions that had been fighting the browser and makes
  the chrome behavior match a more normal document flow.
- Fixed the top-level app shell sizing that was still making the page a little
  too tall. The real overflow source was `Header + full-height ProjectView`
  stacked together, not missing `box-sizing`. `App.svelte` now owns the
  viewport height with a two-row shell, and `ProjectView` fills the remaining
  row instead of claiming another full viewport for itself.
- Simplified the topbar run controls again. `Start` and `Stop` now share the
  same primary button slot, and the overflow menu no longer duplicates visible
  actions like `New task` or `Stop`.
- Normalized the web shell height contract again after the toolbar refactor.
  The app already had global `box-sizing: border-box`, but `ProjectView`
  was still mixing `calc(100vh - 44px)` on the shell with `height: 100vh` on
  the sticky rail. The shell now uses a single `100dvh` viewport baseline,
  and the root app nodes are explicitly normalized to full height so we stop
  getting the annoying one-screen-plus-a-few-pixels overflow that lets the
  toolbar drift off-screen.
- Shrunk reclaimed worker prompts again by replacing the full markdown spec
  body with a clipped `Spec Overview` summary section while keeping the
  structured acceptance-criteria list separate below. This removes duplicated
  spec AC/out-of-scope prose from long task contexts.
- Tightened reclaimed worker context for noisy review loops. Context building no
  longer treats command-shaped backticks or wildcard test globs as exact likely
  target files, and worker task summaries now trim generic agent notes plus
  avoid duplicating giant reviewer prose in both `Latest Required Revisions`
  and `Agent Notes`.
- Blocked tasks no longer surface `spec_fill_pending` inbox nags. The spec-fill
  wizard now treats `blocked` / `shelved` as terminal for intake-completeness
  nudges, which removes stale "Missing product brief" noise from tasks that are
  already truthfully blocked for another reason.
- Pointed the live Looma/Knit project back at `openai-api` after DeepInfra
  billing was restored, replacing the stale project-local `llama-cpp`
  preference/model override that had been forcing Codex CLI fallback.
- `guildhall-automation-001` is complete.
- Added a design note for protocol-first provider abstraction and bounded queue
  throughput in `docs/design/provider-abstraction-and-throughput.md`.
- Seeded a matching Guildhall architecture backlog covering provider taxonomy,
  runtime normalization, capability manifests, shared client pooling, lane
  scheduling, and staged throughput proof.
- `guildhall-architecture-001` is complete: provider/setup docs and UI now
  speak in protocol families instead of treating LM Studio as a first-class
  provider concept.
- `guildhall-architecture-002` is in progress: shared provider metadata and
  preferred-provider family classification now exist in the runtime layer as
  groundwork for fuller status/routing normalization.
- `guildhall-architecture-002` now also drives a shared provider-status
  snapshot into `/api/project` and live run status, including provider family
  and label fields for preferred and active providers.
- `guildhall-architecture-002` is now complete: reviewer fanout resolves
  through the same provider-aware runtime policy in both orchestrator dispatch
  and provider status, so requested vs effective reviewer concurrency is
  normalized instead of guessed independently.
- `guildhall-architecture-003` is now complete: provider status carries a
  capability manifest for preferred and active providers, including
  streaming/tool-call support, resumability, reasoning-side-channel shape, and
  recommended concurrency.
- `guildhall-architecture-003` also uses those manifests for real routing and
  explainability:
  reviewer fanout is clamped through provider-aware policy, and structured
  routing decisions now explain why a provider was selected, rejected, or had
  its model assignment swapped.
- `guildhall-architecture-004` is now in progress: next step is replacing
  bespoke provider-client construction with a shared pool keyed by normalized
  runtime identity.
- `guildhall-architecture-004` has started landing in code: equivalent
  OpenAI-compatible and local-server runtime configs now reuse pooled clients,
  while resumable-session providers like Claude remain intentionally unpooled
  until we add session-aware pool semantics.
- `guildhall-architecture-004` now also has provider-health tracking at the
  pool boundary: pooled clients record recent success/failure state and
  consecutive failures, and the Project view can warn when a pooled provider
  has degraded.
- `guildhall-architecture-004` now also emits provider health into the live
  workspace runtime: pooled-provider health changes update active run status
  and appear on the event stream as `provider_health_changed`, so the UI can
  react without waiting for a full refresh cycle.
- `guildhall-architecture-004` now also makes degraded stateless clients
  operationally matter: after repeated retryable failures or a fatal failure,
  the next equivalent pooled acquisition recycles that client instead of
  reusing the same poisoned transport instance forever.
- `guildhall-architecture-004` is now complete: the shared pool handles
  stateless client reuse, provider-level concurrency limits, health tracking,
  live `provider_health_changed` events, and degraded-client recycling.
- `guildhall-architecture-005` is now complete: Guildhall resolves explicit
  spec/worker/review/coordinator lane settings, clamps them against dispatch
  capacity and provider policy, uses those budgets during task selection, and
  exposes the effective lane plan in provider status.
- `guildhall-architecture-006` is now in progress: next step is staged
  unattended-throughput proof on top of the bounded lane scheduler.
- Gate execution is now stricter than the model. When a task has an
  authoritative `current_task_success_gates` list, the `run-gates` tool
  reconciles or overrides stale model-supplied commands instead of trusting
  copied bootstrap/spec text. This closes the live bug where `task-006`
  reached `done` with `No projects matched the filters...` stored for
  typecheck/build even though the real `knit/web` commands passed.
- Worker recovery on Looma/Knit `task-011` is now stricter after malformed
  `write-file` calls: the query loop injects an immediate path-specific retry
  instruction after the first empty `write-file` payload instead of waiting
  for a second failure and only giving a generic "do not repeat that" nudge.
- Focused malformed `write-file` repair is now less brittle: the repair path
  feeds the prior tool error back into the retry prompt and lets the actual
  `write-file` tool recover alias-shaped inputs like `path` / `text` instead
  of rejecting them early in the query loop.
- Reclaimed worker turns now carry an explicit `Resume From Current Worktree`
  block listing the active task worktree and its changed files, and the worker
  prompt now tells resumed tasks to start from those changed files or the exact
  failing verification target before broad repo research. Live Looma/Knit
  replay confirmed one concrete improvement: `task-011` no longer reopens raw
  `MEMORY.md` on reclaim. The remaining blocker is narrower: the worker still
  spends too much early budget on test-layout discovery instead of immediately
  opening the changed worktree test file it already owns.
- Reclaimed worker context now also derives `Likely Target Files` from the
  task spec and automated verification commands, resolved against the active
  worktree when present. This gives tasks like Looma/Knit `task-011` a concrete
  source-file and test-file pair even when the worktree is clean, so the next
  live question is whether the worker starts from those exact files instead of
  root-level directory browsing.
- Repaired `task-006`'s stored Looma/Knit gate record so its persisted
  typecheck/build outputs now reflect the real `pnpm --dir web ...` commands
  that pass on `knit/main`, rather than the earlier stale filter-based output.
- `guildhall-architecture-006` now has a real stop-summary contract:
  unattended runs no longer just go idle and disappear; they can now report
  whether they stopped because the queue is all terminal, waiting on humans,
  blocked on escalations, dependency-stalled, or explicitly stopped.
- The paused shell now surfaces that stop summary directly in ProjectView, so
  operators can see why a run ended without digging through raw event lines.
- Hardened the live shell against stale run state: dynamic `/api/*` responses
  now send `Cache-Control: no-store`, the shared project/inbox fetches opt out
  of cache reuse, and the shared project store now ignores out-of-order refresh
  responses so a late "still running" fetch cannot overwrite a newer stopped
  snapshot.
- Did a shell clarity pass too: Thread copy is shorter, setup direction
  language is plainer, and paused-stop notices now summarize outcomes in
  operator language (`Run finished`, `Waiting on input`, `Blocked`) instead of
  echoing full orchestrator sentences with duplicated counts.
- Optional setup no longer masquerades as a blocker. In Thread, a setup phase
  made only of skippable steps now labels itself `Optional`, and skippable
  setup cards carry an explicit `optional` chip instead of reading like hard
  prerequisites.
- Low-severity policy cleanup is now quieter. `Do this next` ignores inbox
  items that are only low severity, so the home shell can go calm when the
  only remaining work is optional/project-policy housekeeping.
- Notifications now mirrors that calmer model: high/medium items stay in the
  main `Needs you` list, while low-severity items move to a separate
  `Housekeeping` section with a clear “nothing is blocked right now” state
  when only optional cleanup remains.
- Thread now defaults optional setup out of the way. When the only setup turns
  are skippable, the setup phase collapses by default so the first viewport is
  not dominated by advisory cleanup.
- Live Looma/Knit verification confirmed the backend stop summary on
  `/api/project` after unattended runs. Browser-use remains a noisy verifier
  for long-lived background refresh because its injected async fetch layer can
  error after the node-repl exec frame ends, so `guildhall-architecture-006`
  stays open until we prove the same behavior in a cleaner live browser pass.
- Seeded a fresh grounded Looma/Knit task for the next autonomy proof:
  `task-006` — `Add E2E login -> create page -> edit -> search flow`.
  This task is scoped to `/Users/matthew/git/oss/looma-knit/knit`, starts in
  `exploring`, and is meant to exercise the newly cleaned publication lane on
  a real product-facing happy path rather than another helper-only test.
- A new grounded Looma/Knit autonomy run exposed a different intake stall:
  the spec-agent had enough repo context and did use tools, but it spent too
  many turns on read-only research and then hit the max-turn limit without
  writing a brief, posting a question, drafting a spec, or raising a scoped
  escalation.
- Hardened the shared query engine against that failure mode. Roles can now
  declare "durable progress" tools; after repeated research-only tool turns,
  Guildhall injects a corrective nudge that tells the agent to stop
  researching and record a brief, question, spec, or escalation instead of
  drifting into turn-limit exhaustion.
- The spec-agent now uses that new guardrail and its prompt explicitly says
  that once repo evidence shows the task may already be partly or fully done,
  it must convert that evidence into a brief, focused question, remaining
  delta spec, or scoped escalation within the next turn or two.
- Preserved-progress hardening landed too: if a spec turn hits the max-turn
  limit after already writing durable task state, Guildhall now preserves that
  state instead of blindly escalating over it. Writing a spec from `exploring`
  without an explicit status now promotes the task to `spec_review`.
- Tightened startup session hydration so a fresh task no longer resumes an old
  pending spec conversation unless the persisted snapshot names the same task
  id. Live Looma/Knit restart confirmed the noisy `Resumed spec agent from
  prior snapshot` cross-task bleed is gone on a fresh task.
- Cold-start local-model reality check: even with the cross-task resume bug
  fixed, a fresh grounded Looma/Knit task (`task-006`) still hit the spec
  turn limit with no brief, question, or spec written. So the next bottleneck
  is no longer stale session contamination; it is the local model/provider
  path still failing to convert a real intake into durable output from a cold
  start.
- Live Looma/Knit proof advanced meaningfully: `task-008` reached `done`
  through Guildhall, but the remaining trust gap is still real gate truth.
  The workspace-root bootstrap snapshot says `no package.json`, while the
  task itself belongs to `/Users/matthew/git/oss/looma-knit/knit`, which has
  the real package manager and gate scripts. The next fix is to make
  `gate_check` derive authoritative gates from the task's own project path
  instead of blindly inheriting the outer workspace bootstrap block.
- Provider-scoped model resolution exposed another real config bug during the
  DeepInfra switch: if a workspace had exactly one provider-scoped model block
  left (for example only `llama-cpp`), Guildhall would wrongly reuse that lone
  block for an explicit different preferred provider. Fixed by making
  provider-specific resolution return empty when the requested provider has no
  matching block, instead of falling through to the sole unrelated entry.
- Root cause on `task-006` is now sharper: the cold-start local model *did*
  try to write durable progress, but it sent near-miss tool payloads like
  `append-exploring-transcript { item: ... }` and `update-product-brief
  { productBrief: ... }`. The next hardening slice is to make those tools
  recover from common nested/stringified payload shapes instead of rejecting
  them and burning the turn budget.
- That hardening landed, and a follow-up runtime guard now refuses repeated
  read-only research tool turns after Guildhall has already nudged the
  spec-agent to record durable progress. Fresh Looma/Knit intake `task-008`
  then reached `spec_review` on the NVIDIA provider in a single `one_task`
  pass.
- Remaining polish from that live pass: the fallback brief path was too happy
  to treat an evidence preamble ("Based on the grep results...") as the
  userJob. Tightened the inference to fall back to a cleaner verification /
  remaining-delta framing when the assistant prose is just narrating evidence.
- The next unattended-run blocker appeared immediately after that: once
  `task-008` moved from `ready` to `in_progress`, `/api/project` timed out
  while the worker was running. Sampling the live process showed the server
  blocked inside a synchronous child-process spawn from the shell tool.
- Fixed that by making the worker-facing `shell` tool run asynchronously via
  spawn instead of `execSync`, while leaving the bootstrap runner on its
  existing sync helper for now. The next live check is to confirm a running
  worker no longer freezes project/status API reads.
- DeepInfra/Qwen3.6 bring-up exposed one more shell-tool brittleness: the
  worker could issue a correct command but omit `cwd`, and the tool would fail
  before execution even though runtime context already knew the task project
  path. The shell tool now defaults `cwd` from the active tool context so
  real task runs do not die on that omission.
- Another live Looma/Knit review leak surfaced right after that: `task-005`
  had a good saved markdown spec with acceptance criteria, but its structured
  `acceptanceCriteria` array was empty, so deterministic reviewer fallback
  graded it like "no contract defined" and bounced verified work back to
  `in_progress`. Guildhall now derives criteria from `## Acceptance Criteria`
  in the saved spec when structured ACs are missing, and worker self-critique
  can reconcile against those derived criteria before fallback review runs.
- Fresh DeepInfra/Qwen3.6 intake on `task-009` surfaced a cleaner spec-lane
  contract bug: the model tried to post a structured user question with a
  natural `prompt` field, but `post-user-question` only accepted `body` and
  advertised an empty JSON schema, so the turn died and escalated. The tool
  now accepts `prompt` / `restatement` aliases and exposes the real argument
  shape to models.
- Notifications `Loading...` on Looma/Knit turned out to be a client-side crash,
  not a hung inbox endpoint. `/api/project/inbox` returned immediately, but
  InboxTab keyed rows by `kind + title`, and multiple escalations shared that
  tuple. Svelte threw `each_key_duplicate`, leaving Notifications stuck at
  Loading until refresh. Inbox row keys now include escalation/task identity,
  with a small web-lib regression test for duplicate-title escalations.
- The same pass exposed stale-shell caching during local restarts: after a
  successful rebuild/restart, the browser could still reuse an older
  `/web/app.js`, replaying already-fixed client crashes. The SPA shell and web
  assets now send no-store headers, and dashboardHtml appends a build-derived
  `?v=` stamp to `app.js` and `app.css` so fresh reloads pick up the actual
  current bundle.
- Notifications now reuses the shell's already-loaded inbox state instead of
  maintaining a second independent fetch lifecycle. Live Looma/Knit verification
  on `http://localhost:7844/notifications` now shows the real inbox rows
- Latest Looma/Knit proof on `task-008` got further again: review no longer
  collapses immediately into bogus persona dissent, and `/api/project` stays
  responsive during worker turns. The next truthful blockers are narrower:
  reviewer fallback still bounces already-verified work back to `in_progress`
  when provider 429s arrive before gate data exists, and the worker can still
  waste turns by narrating that a finished shell command might be "still
  running" and then calling `sleep`.
- That runtime slice is now fixed. Review fallback reconciles acceptance
  criteria from the latest worker self-critique and, on reviewer
  infrastructure failures, can advance already-verified work to `gate_check`
  instead of fabricating a worker revision. The worker no longer gets a
  `sleep` tool, so it cannot burn turns pretending a completed shell command
  might still be running.
- Fresh Looma/Knit proof on `task-008` confirmed the new behavior live:
  `review -> gate_check via reviewer-deterministic-fallback`. The remaining
  blocker moved one lane later: `gate-checker-agent` still hard-fails the run
  on NVIDIA `429 Too Many Requests`, leaving the task correctly parked in
  `gate_check` but stopping the one-task run with an agent-error outcome.
- Gate-check backoff is now being hardened the same way: retryable provider
  throttling during `gate_check` is being converted from a generic agent-error
  into a resumable provider-backoff state so one-task runs stop honestly while
  preserving `gate_check` as the source of truth.
- Fresh Looma/Knit rerun from `gate_check` finished cleanly: `task-008` reached
  `done` in a one-task run on the NVIDIA path. So the immediate review →
  gate-check → completion proof now exists for a real grounded task, even
  though the project still needs better explicit gate truth than the current
  empty-root bootstrap fallback.
  immediately, with `Loading...` gone and the repeated escalation titles rendered
  safely.
- `guildhall-automation-003` is now complete in the live Looma/Knit flow. The
  spec lane preserves durable progress after turn-limit churn, answered intake
  questions no longer strand a task in `exploring`, and grounded `task-006`
  moved from a fresh ask through structured questioning into `spec_review`
  without manual queue cleanup.
- Review handoff is stricter now too: when the only remaining unmet acceptance
  criteria are automated hard-verification steps, Guildhall bypasses persona
  review churn and hands the task straight to `gate_check` instead of treating
  runnable verification as implementation debt.
- `guildhall-automation-005` is now complete too. Grounded Looma/Knit
  `task-006` ran in a dedicated task worktree on `knit/`, replayed through
  narrowed task-scoped gates, and recorded a successful local ff-only merge
  back to `main` without manual PR bookkeeping.
- The next staged-throughput pass exposed two honest blockers on fresh
  Looma/Knit tasks: worktree setup treated untracked `.guildhall/` repo-local
  state as a dirty subrepo, and spec-agent max-turn recovery still escalated
  even when the assistant had already written enough plain-text brief/question
  content to preserve.
- Both are now hardened. `NodeGitDriver.isClean()` ignores untracked
  `.guildhall/` bookkeeping while still treating real source changes as dirty,
  and spec max-turn recovery now salvages the latest assistant prose more
  defensively, persists fallback brief/question state before escalation, and
  recognizes "my read ..." preambles where the actual user job lives on the
  following bullet.
- Live replay immediately found the next qualitative gap: the fallback brief
  path could still fossilize agent research narration like "let me check the
  worktree" as the task's `userJob`. Tightened inference so research/audit
  chatter is ignored for brief authorship while preserving any structured
  question cards from the same turn.
- Fresh staged-throughput replay now gets meaningfully farther live: `task-010`
  and `task-011` both reached `spec_review`, both were approved into `ready`,
  and `task-010` was claimed into a real worker worktree with concrete edits to
  `web/tests/unit/shared/subdomain.test.ts`.
- The new blocker is the worker-side analogue of the old spec-turn problem:
  `task-010` hit the worker turn limit after making real file edits, but
  Guildhall still escalated it straight to `blocked` instead of preserving that
  durable code progress for review or resumable revision. `task-011` was
  claimed next, so the queue itself is moving; the durability gap has simply
  shifted from spec-intake to worker completion.
- Worker-side turn-limit preservation is now implemented and test-covered. If
  an `in_progress` task hits the worker turn limit but its task worktree is
  already dirty with real code edits, Guildhall preserves the task in
  `in_progress` instead of escalating immediately to `blocked`.
- Live Looma/Knit replay now shows that worker preservation fix paying off:
  `task-010` resumed from its old blocked state, finished the subdomain test
  expansion, passed its scoped Vitest run and typecheck, and handed off into
  `review` instead of getting trapped by the old turn-limit path.
- The next honest gap is reviewer durability. A reviewer can emit a real
  plain-text verdict without successfully calling `update-task`, which used to
  leave the task stuck in `review`. Guildhall now preserves that reviewer note
  and applies the deterministic review decision so the queue keeps moving.
- The next staged-throughput blocker is inside reviewer fanout itself. A
  persona reviewer was able to hang inside a bare `agent.generate()` call with
  almost no operator visibility, which left the whole one-task run parked in
  `review` despite the worker having already completed real work. Persona
  fanout calls are now bounded by a per-persona timeout and convert timeout
  hangs into infrastructure-only revise verdicts, so fanout can fall through to
  the single-reviewer path instead of freezing the review lane forever.
- Live replay then exposed the same class of hang one step later: once fanout
  fell through, the single reviewer path still had no wall-clock timeout around
  the main `generateWithEvents()` turn. The core dispatch path now applies a
  per-agent turn timeout, treats `timed out after ...ms` as infrastructure-like
  reviewer failure, and lets deterministic fallback absorb a hung reviewer turn
  instead of leaving `task-010` silently parked in `review`.
- The next gate-truth issue turned out to be command-shape drift, not product
  code failure. `task-010` still carried the common `pnpm --filter @knit-app
  test -- <file>` shape, which expanded back out to unrelated suite failures.
  Task-scoped gate normalization now rewrites that form into direct single-file
  Vitest runs, and `run-gates` persists its hard-gate results back onto the
  task immediately.
- Live Looma/Knit proof: `task-010` now completes cleanly end to end. Review
  reaches `gate_check`, the authoritative gates run as `pnpm --dir web
  typecheck`, `pnpm build`, `cd web && pnpm vitest --run
  tests/unit/shared/subdomain.test.ts`, and `pnpm lint`, all four pass, and
  the task transitions `gate_check -> done` with recorded gate results.
- The next live task (`task-011`, use-presence lifecycle tests) is now the
  active throughput proof. It is no longer stuck in setup or intake; the worker
  is actively reading the composable, existing test patterns, and Nuxt/Vitest
  environment before writing the new unit test file.
- Thread column width now uses a real target width again. The column had been
  using `max-width: 680px`, which let it shrink unexpectedly; it now uses
  `width: 680px; max-width: 100%` so desktop stays stable while smaller
  viewports still collapse safely.
- `guildhall-architecture-003` now also uses those manifests for a real routing
  decision: provider capability policy can clamp reviewer fanout to a safe
  effective concurrency, and the UI surfaces that adjustment as an info notice
  instead of a vague warning.
- Workspace import now defaults to a single-project interpretation and only
  preserves subproject scope when multiple top-level project roots are clearly
  present.
- Importer heuristics now filter migration-guide/spec-template/group-header
  junk, keep explanatory planning bullets as context, and fuzzily dedupe
  near-identical tasks from the same planning file.
- Live Looma/Knit draft improved from `677 / 583` to `312 / 219`
  (`inputSignals / drafted`).

## Current 20-Item Push List

- [x] Preserve the latest meaningful assistant prose across later tool-only turns.
- [x] Stop empty tool-only assistant turns from wiping `last_assistant_text`.
- [x] Let `append-exploring-transcript` recover from `{}` using runtime metadata.
- [x] Let `post-user-question` recover from `{}` using runtime metadata.
- [x] Teach `post-user-question` to infer structured choice payloads from prior assistant prose.
- [x] Verify inferred `post-user-question` payloads can post multiple questions in sequence.
- [x] Teach fallback question parsing to handle simple `Pick one: X or Y` prose.
- [x] Teach fallback question parsing to split numbered questionnaire prose into multiple `choice` cards.
- [x] Teach fallback question parsing to handle markdown-headed numbered sections.
- [x] Stop gating fallback question creation on narrow phrase matching when structured drafts are inferable.
- [x] Auto-persist plain spec-agent exploring prose into the exploring transcript.
- [x] Add a fallback `productBrief` draft when spec-agent prose clearly states a “best read/guess”.
- [x] Teach fallback brief parsing to understand “my read of this task title” phrasing.
- [x] Normalize bulleted “my read” lines so fallback brief inference still works.
- [x] Verify live Looma/Knit runs now preserve transcript plus structured questions after sloppy tool turns.
- [x] Verify a live Looma/Knit run now preserves both a drafted brief and a structured question.
- [x] Reduce over-batching when the inferred questionnaire is too broad for a first intake turn.
- [x] Make spec-agent question inference prefer the highest-signal 1-3 questions instead of 6-8.
- [x] Add an explicit live/browser check that Thread renders the inferred brief and question cards coherently.
  Covered by the Looma + Knit invite-flow replay: the first draft-shaping bug
  produced Guildhall-process copy, then the hardened product-brief/spec-agent
  layer generated the task outcome/focused question needed to advance.
- [x] Re-run a real Knit task from intake toward implementation using the hardened exploring flow.
  `task-import-108mwl6` was shaped from an imported draft into runnable Knit
  work, recovered from worker/typecheck/review edge cases, passed `typecheck`,
  `build`, and `lint`, and reached `done` on `2026-05-16T20:30:04Z`.

## Pass Checklist

1. Setup
   - Walk first-run setup in the browser.
   - At each step, ask what a new user would know, what they would not know,
     and whether the next action is obvious.
   - Verify provider detection, restart banners, and meta-intake status reflect
     real state.

2. Project spec
   - Run or resume meta-intake.
   - Verify it detects `t-minus-t` as a VSCode extension for converting
     on-disk JSDoc JavaScript into in-view TypeScript and back.
   - Confirm coordinators, bootstrap, levers, and project brief match the repo.

3. Workspace import
   - Review detected goals and tasks.
   - Verify imported README bullets do not duplicate title/rationale.
   - Verify imported TODO comments do not become worker-ready tasks without
     spec-agent shaping.

4. Task setup
   - Use Thread to guide Guildhall toward tasks covering TypeScript features.
   - Try direct Thread replies/tool-like commands when the provided card does
     not fit the need.
   - Verify user answers immediately change visible project/task state.

5. Execution and completion
   - Push at least one task through intake, spec review, ready, worker,
     review, gates, and done when feasible.
   - At each transition, verify Thread, drawer, Work, and Notifications agree.
   - Check that "done" means a concrete repo change plus passing verification,
     not just an agent claim.

6. Reset rule
   - If the test project state becomes too tangled to reason about, stop and
     request action-time confirmation before deleting Guildhall state files.
   - Candidate reset files are expected to be under
     `/Users/matthew/git/oss/t-minus-t/guildhall.yaml`,
     `/Users/matthew/git/oss/t-minus-t/.guildhall/`, and
     `/Users/matthew/git/oss/t-minus-t/memory/`.

## Findings So Far

- Workspace import previously inserted imported TODO comments as `ready`
  tasks. That made Thread show "Agent is working" for vague TODO crumbs before
  the spec agent had shaped them. Fixed by importing candidates as
  `exploring`.
- `resume` previously appended a message but did not reliably move a task back
  into spec-agent intake. Fixed so a human reply on a non-terminal task returns
  it to `exploring`.
- Thread single-question replies staged an answer behind a separate footer,
  which felt like "Send did nothing." Fixed so a single active question submits
  immediately; multi-question batches still stage and submit as a group.
- Thread in-flight cards now expose a direct "Tell agent" action so the user
  can correct or redirect the agent without opening the drawer.
- While meta-intake was running, Thread still marked the next setup step as the
  active turn and showed the meta-intake card as "next." Fixed by making
  remaining setup turns pending while the reserved meta-intake task is active.
- Meta-intake asked "Pick all that apply" using a `choice` question, but the
  UI behaved like single-select. Fixed AgentQuestion to switch to multi-select
  when the prompt asks for all/select all/all that apply.
- After answering meta-intake questions, Thread showed the task as shaping but
  the top Start button stayed disabled because bootstrap was incomplete. Fixed
  ProjectView so the reserved meta-intake task can resume the orchestrator even
  while bootstrap is still blocking ordinary work.
- Answering a question while the orchestrator was also writing `TASKS.json`
  corrupted the file with trailing bytes. Fixed the hot runtime/task answer
  write paths to use atomic replace writes, and repaired the test workspace
  `TASKS.json`.
- Agent questions displayed raw Markdown in prompts (`**converter-core**`).
  Fixed AgentQuestion to render prompts/restatements through Markdown.
- Meta-intake kept interviewing coordinator-by-coordinator and repeatedly hit
  the max-turn limit instead of drafting. Tightened the seed prompt: draft
  from repo evidence by default, ask at most two questions, and avoid
  one-question-per-coordinator mandate collection.
- Resetting project-local Guildhall state while role sessions still existed in
  `~/.guildhall/data/sessions` caused meta-intake to resurrect an old draft and
  present it as fresh output. Fixed by refusing meta-intake session recovery
  from snapshots older than the newly seeded meta-intake task.
- The spec agent could still load an old same-workspace role session and
  regenerate the stale draft. Fixed by adding a per-project `memory/.session-epoch`
  namespace to role session ids; deleting `memory/` now creates fresh agent
  sessions.
- The setup identity endpoint kept stale initialized state when files were
  deleted while `guildhall serve` was still running. Fixed by refreshing the
  project before handling setup identity writes.
- In-progress work looked static unless the user already knew the orchestrator
  was running. Added a shared pulsing status light for live agent work without
  animating the whole card.
- Coordinator review copy assumed the user knew what a coordinator was. Fixed
  the Thread and setup review cards to explain that coordinators route future
  tasks to specialists and review work in their area.
- Agent-question cards rendered agent ids and slug choices directly. Fixed the
  UI to display friendly role names and title-cased choice labels, and updated
  meta-intake instructions to ask about project areas/review lanes instead of
  "coordinator domains".
- Multiple-choice question cards were visually weak and treated labels as raw
  strings. Fixed choices to render as full-width selectable rows with
  title/detail treatment, markdown formatting, and a clear selected state.
- "Coordinator" was still Guildhall jargon. Added `guide.coordinators` as a
  docs-backed help topic, wired the circled question-mark help icon into
  coordinator review cards, and lengthened the copy to explain review lanes,
  routing, reviewers, and autonomous handling.
- The task drawer's "Spec fill" checklist answered what the agent was doing,
  but Thread only showed a vague in-flight summary. Thread now projects the
  spec-fill wizard into the in-flight card as live-updating title,
  description, brief, and acceptance-criteria steps.
- Internal ids leaked into user-facing cards (`goal-...`, `task-import-...`,
  `_meta`, `_workspace_import`). Fixed the first visible pass by hiding raw ids
  on Workspace Import and task cards, formatting reserved domains as friendly
  labels, and switching newly generated import ids to compact deterministic
  hashes instead of title-length slugs.
- Native `title` popups are not enough for collapsed navigation. Added a
  reusable `Tooltip` component and wired the collapsed left rail plus docs help
  icons through it.
- Project direction copy sounded like agents start from nothing unless the user
  writes the perfect paragraph. Softened the step copy and prefilled an editable
  draft from README context when no saved direction exists.
- Workspace Import still showed "Approve & import" after approval. Fixed the
  imported state to show "Imported findings" and hide the approval actions.
- Thread thought setup was complete because the reserved meta-intake/import
  tasks counted as the first user task. Fixed first-task progress to ignore
  reserved system tasks, then created a real first task for the TypeScript
  round-trip workflow.
- Pressing Start after that looked inert: the orchestrator started, ran
  bootstrap, and stopped because the test project build failed. Fixed the shell
  and Inbox to surface the failed bootstrap gate from `memory/bootstrap.json`
  instead of leaving the user to infer it from a stopped run.
- Ready still made the blocker harder to act on: it hid command output, skipped
  to policy levers in the "Do this next" banner, and read provider status from
  a non-existent endpoint. Fixed Ready so it shows llama.cpp as configured,
  shows the failed command output inline, labels the bootstrap action "Run
  again", and suppresses lower-priority nudges while the top inbox item is
  already the current page.
- After bootstrap passed and Start worked, the run still looked inert during a
  long spec-agent model call because the supervisor only emitted an event after
  the agent returned. Added `agent_started` / `agent_finished` lifecycle
  events and taught Thread to show "Model call in progress" immediately.

## Verification Log

- `pnpm vitest run src/runtime/workspace-import/__tests__/hypothesis.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/intake.test.ts`
  passed: 3 files, 60 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- After the spec-agent hit its step budget, `/api/project` 500ed because
  `memory/TASKS.json` contained a complete JSON object followed by an
  interleaved duplicate tail. Patched TASKS-writing agent tools to use
  `atomicWriteText` instead of direct `fs.writeFile` so concurrent tool writes
  cannot leave partial/interleaved task state.
- Repaired the local `t-minus-t/memory/TASKS.json` by removing the duplicate
  tail after the first complete JSON object; `node -e "JSON.parse(...)"` now
  succeeds and `/api/project` returns again.
- `pnpm vitest run src/tools/__tests__/product-brief.test.ts src/tools/__tests__/task-queue.test.ts src/tools/__tests__/escalation.test.ts src/tools/__tests__/report-issue.test.ts src/tools/__tests__/proposal.test.ts`
  passed: 59 tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- Browser walkthrough exposed another in-progress clarity gap: after Start,
  `agent_started` was emitted but Thread still showed only the active brief
  approval card, so a user could not tell the spec agent was in a model call.
  Added `liveAgent` to brief/question turns and render the same pulsing
  "Model call in progress" line on active interaction cards.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts src/runtime/__tests__/wire-events.test.ts`
  passed: 29 tests.
- `pnpm build` passed again with existing Svelte warnings.
- Provider deep-dive found `OpenAICompatibleClient` had no timeout around the
  OpenAI-compatible `/chat/completions` fetch. Added a 5-minute request timeout
  that reports `OpenAI-compatible API timed out after 300s` instead of leaving
  Guildhall in an indefinite model call.
- `pnpm vitest run src/providers/__tests__/openai-client.test.ts` passed: 14
  tests.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing Svelte warnings.
- `pnpm docs:extract-help` generated `guide.coordinators` in
  `src/web/generated/help-topics.json`.
- `pnpm vitest run src/runtime/__tests__/serve-meta-intake.test.ts` passed: 9
  tests.
- `pnpm vitest run src/runtime/workspace-import/__tests__/hypothesis.test.ts src/runtime/__tests__/workspace-importer.test.ts src/runtime/__tests__/serve-meta-intake.test.ts`
  passed: 45 tests.
- Browser check at `/planner` showed friendly task card labels ("Workspace
  import", "Setup") with no raw task ids or underscored domains.
- Browser check at `/workspace-import` showed no visible goal/task ids and an
  imported state without the stale "Approve & import" action.
- Restarted linked `t-minus-t` server on `http://localhost:4177`; loaded build
  `2026-04-25T16:01:48.399Z`.
- Browser check at `http://localhost:4177/thread` showed the active intake card
  with the pulsing status light beside the `NOW` badge.
- Browser walk reached fresh setup, provider selection, meta-intake questions,
  multi-select answers, direct Thread guidance, and orchestrator resume.
- Current state after deterministic meta-intake fallback: `task-meta-intake`
  is done, five coordinator roles are merged, and Thread is on the active
  setup step "Give the project direction".
- `pnpm vitest run src/runtime/__tests__/wizards.test.ts src/runtime/__tests__/serve-wizards.test.ts`
  passed: 28 tests.
- Browser check after the first-task fix showed Thread on "Seed the first
  task"; submitting the TypeScript round-trip task created `task-003` in
  `exploring` with a live Spec Fill checklist.
- Direct `/api/project/start` returned running, then the run stopped after the
  bootstrap gate failed. Reproduced the underlying project failure with
  `pnpm run build` in `t-minus-t`:
  `src/customEditorProvider.ts(6,8): error TS2307: Cannot find module 'ts-jsdoc-sync'`.
- Repaired the local test project's converter package metadata so
  `ts-jsdoc-sync` resolves. Build and tests now pass, but bootstrap is still
  blocked by lint because `packages/extension` calls `oxlint` and the tool is
  not installed.
- Browser check at `/settings/ready` now shows New Task disabled as "Fix the
  bootstrap failure before adding tasks", LLM provider as `llama-cpp`, inline
  failed-output detail for `pnpm run lint`, and no lower-priority policy-lever
  banner above the active bootstrap failure.
- User approved adding the missing lint dependency. Added `oxlint` to
  `packages/extension`, reran Guildhall bootstrap through the app endpoint, and
  all bootstrap steps passed: install, build, test, lint.
- Browser check at `/thread` after Start now shows "Spec author is working on
  this now" and "Model call in progress" while `task-003` is inside the
  spec-agent LLM call.
- The model call later exhausted its step budget and restarted without making
  visible spec progress. Root cause found: `guildhall.yaml` still referenced
  default `qwen2.5-coder-*` role models while LM Studio only had
  `qwen/qwen3.6-35b-a3b` loaded. Patched Guildhall so saving LM Studio copies
  the loaded model into the workspace role assignments, and Start now fails
  fast if LM Studio does not have the configured project model loaded.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts` passed: 18
  tests, including the new model mismatch preflight.
- Browser walkthrough exposed a choice-question bug: the spec question asked
  "which of these should support?" but rendered as "Pick one"; clicking the
  first option immediately answered and removed the question. Added explicit
  `selectionMode` support to agent questions, taught the spec-agent prompt to
  say `selectionMode: 'multiple'` for pick-all choices, and added a UI fallback
  so older "which of these should..." prompts render as multi-select.
- Live Looma/Knit testing exposed a stale transcript problem: `Transcript`
  could show old `Added acceptance criterion: ...` notes that no longer matched
  the task's canonical `acceptanceCriteria`. Fixed the drawer endpoint to
  filter specifier acceptance-note echoes against the live criteria list.
- Thread updates lagged during active work because the surface only refreshed
  on coarse lifecycle events. It now also reloads on `tool_started`,
  `tool_completed`, `line_complete`, and `error`, which makes review bounces
  and verifier failures show up fast enough to trust.
- Review feedback could stay visually "in flight" even after a newer hard
  verifier failure had become the more important operator signal. Thread now
  demotes stale review-feedback cards once a later danger-level activity exists
  for the same task, letting the failed verifier output dominate the active
  card.
- Review/gate/adjudication bounce paths could return a task to `in_progress`
  without restoring `assignedTo='worker-agent'`, which encouraged no-op retry
  loops and prevented clean worker session resume. Fixed every bounce path to
  restore worker ownership before persisting the task.
- `pnpm typecheck` passed.
- `pnpm vitest run src/runtime/__tests__/serve-providers.test.ts src/core/__tests__/models.test.ts`
  passed: 40 tests.
- `pnpm build` passed with existing Svelte warnings.

## Resume Notes

- Continue from the browser at `http://localhost:4177/`.
- Current test workspace state:
  - `task-meta-intake` is done.
  - Five coordinator roles are present in `guildhall.yaml`.
  - Project direction was saved from Thread.
  - Workspace Import was approved: 0 tasks, 6 goals, 1 milestone.
  - `task-003` is the first real task and is still in spec intake.
  - Bootstrap is passing after adding `oxlint`.
  - Orchestrator run status is running, with `task-003` inside a spec-agent
    model call at the time of this checkpoint.
- Before resetting `t-minus-t`, ask for explicit confirmation and list the
  exact files/directories to remove.
- After source changes, run `pnpm build` in Guildhall before testing the linked
  package from `t-minus-t`.
- Next likely check: wait for the spec-agent call to finish. If it remains
  stuck, check whether LM Studio is actually generating tokens for the loaded
  model. The app now catches model-id mismatches before starting.
- The accidental "Primitive types" answer on `task-003` was corrected via
  `/api/project/task/task-003/answer-questions`: primitives, union types, array
  types, object literal types, and generic types; arrow functions left out for
  a later task. The run was restarted and Thread now shows "Model call in
  progress" on the active brief card while the spec agent is inside LM Studio.
- The latest run ended in `error` after the spec agent exhausted its 8-step
  budget again; with TASKS.json repaired, restart the server on the rebuilt
  Guildhall before continuing.
- Live Looma/Knit cleanup: deleted stale false-positive human-input tasks
  `task-003`, `task-004`, `task-006`, and `task-007` from `memory/TASKS.json`,
  removed their exploring transcripts, and filtered their stale history from
  `memory/PROGRESS.md` and `memory/recent-events.jsonl` so Notifications stops
  surfacing bogus `Needs you` work.
- Fixed another false-positive inbox path: `brief_approval` now only surfaces
  while a task is still in intake (`exploring` / `awaiting_human`), so `review`
  and `done` tasks with an old draft brief no longer pollute Notifications.
- Fixed review/gate assignment normalization at the task-queue write boundary:
  tasks moved into `review` now default to `assignedTo='reviewer-agent'`, and
  tasks moved into `gate_check` default to `assignedTo='gate-checker-agent'`,
  which prevents finished worker tasks from getting stranded in `review` under
  `worker-agent` ownership.
- Hardened the worker's revise-followup loop: the task context now surfaces a
  dedicated `Latest Required Revisions` block from the newest reviewer note,
  and the worker prompt explicitly treats concrete reviewer change requests as
  binding unless it raises a spec conflict. This targets the live `task-009`
  failure where the worker kept re-verifying finished code instead of adding
  the missing tests the reviewer requested.
- Deterministic review now treats “all ACs met, no hard gates yet” as a
  handoff to `gate_check` instead of a fake revise loop back to the worker,
  which let Looma/Knit `task-009` move past the old review dead-end.
- Startup session hydration now skips same-task snapshots when the task has
  been updated more recently than the saved session, which stopped worker and
  reviewer lanes from reviving stale conversations after human resets.
- Deterministic review handoffs now normalize ownership too: approved review
  passes assign `gate-checker-agent`, and revise outcomes assign
  `worker-agent`, so `gate_check` no longer strands under reviewer ownership.
- Live Looma/Knit proof is now blocked by truthful project gate state rather
  than orchestration confusion: `task-009` reached `gate_check`, ran the real
  test gate, and escalated because the workspace-wide `pnpm test` suite has
  unrelated pre-existing failures outside the task's scope.
- `guildhall-automation-004` is now actively on the narrow gate-truth fix:
  when a task carries explicit automated acceptance-criteria commands,
  Guildhall now treats those commands as the authoritative hard gates for that
  category and only falls back to broader project defaults for categories the
  task did not specify. That lets `task-009` keep its targeted callback test
  gate instead of regressing to the broader repo test suite by default.
- Follow-on hardening for `guildhall-automation-004` is now partly landed too:
  pnpm-based automated gate commands are normalized before use, including
  `pnpm <script> --filter ...` reordering and single-child-package fallback to
  `pnpm --dir <pkg> <script> ...` when the filter token does not resolve.
  Rerun hygiene is now better too: an unresolved escalation stops counting as
  active once the task has clearly moved forward after it was raised and is no
  longer blocked, so stale gate escalations stop freezing reruns or inflating
  `Needs you` / `stuck` UI surfaces. The remaining live blocker is command
  trust: some agent-authored automated commands still need runtime validation
  against the repo layout before they should be treated as authoritative hard
  gates.
- The next command-trust slice is now in place too. When a pnpm `test` script
  is really just `vitest`, and an automated gate carries a unique file token
  like `login-callback-index.flow.test.ts`, Guildhall now rewrites the hard
  gate to the exact single-file Vitest invocation that the repo actually
  honors. That keeps task-scoped callback gates from silently widening back
  into the whole test suite.
- Latest live blocker is narrower now: the gate checker can finish the real
  targeted test work, but `update-task` was still failing when the model
  omitted `taskId`. Guildhall now lets `update-task` infer
  `metadata.current_task_id`, matching the rest of the task tools, so review
  and gate turns can persist state without having to restate the active task
  id perfectly.
- Live Looma/Knit proof moved again in the good direction: after the
  `update-task` metadata fix and the gate-command freshness checks, `task-009`
  replayed from `gate_check` and reached `done` in a single fresh `one_task`
  run on DeepInfra Qwen 3.6. The saved gate results now reflect the real
  narrowed task contract: `pnpm --dir web typecheck`, `pnpm build`, a direct
  single-file Vitest run for `login-callback-index.flow.test.ts`, and
  `pnpm lint`.
- The next autonomy gap is now explicit instead of implicit: Looma/Knit is not
  currently allocating task branches/worktrees, so `task-009` reached `done`
  without any merge/publication record. Guildhall now records a
  `mergeRecord.result = skipped` entry whenever a task finishes while merge
  dispatch is unavailable because worktree isolation or branch metadata never
  existed, so the shell stops implying that PR/merge automation already ran.
- The real multi-repo publication bug is now fixed too. Looma/Knit’s workspace
  root is not itself a git repo — `knit/` and `looma/` are. Guildhall now
  routes worktree setup, base-branch lookup, merge dispatch, and worktree
  cleanup through the task’s effective project repo instead of always using
  the workspace root, so subproject tasks can actually reach the branch/merge
  lane they belong to.
- Publication truth is tighter now too: when worktree isolation is enabled but
  the target repo already has uncommitted changes, Guildhall now stops before
  minting a task worktree and surfaces a clear repo-dirty error instead of
  silently blending prior local edits into a supposedly autonomous task run.
- The current unattended-throughput slice is now targeting worker file authoring
  resilience. `write-file` no longer hard-fails immediately on common
  near-miss payloads like nested `{ item: { path, text } }` calls, and when a
  worker still emits `write-file {}` after inspecting a source file, the tool
  now returns a concrete likely target path plus the exact `{ filePath,
  content }` call shape required. This is meant to unstick Looma/Knit
  `task-011`, where the worker had enough repo context to write
  `use-presence.test.ts` but fell off the tool contract instead.
- That file-authoring resilience now covers malformed `edit-file` turns too.
  Guildhall will do one focused file-mutation repair after `edit-file {}` and
  can recover either into a valid `edit-file` call or a whole-file
  `write-file` call when that is the safer move. Live Looma/Knit replay also
  proved that likely-target normalization is better now: a `web/app/...`
  source hint plus a bare `tests/...` command now resolves to `web/tests/...`
  instead of the repo root. The remaining blocker is more behavioral than
  pathing: once the worker opens the right `web/` source and test surfaces, it
  still burns extra discovery/listing turns before mutating the file.
- Resume dispatch is sharper now too. For `in_progress` worker turns with
  likely target files, the orchestrator injects an explicit `Immediate Resume
  Instructions` block into the actual dispatch prompt: open or edit those
  exact files first, and if a likely target file does not exist yet, create it
  at that exact path instead of searching for alternate directories. Live
  Looma/Knit replay confirmed the worker now reads the exact missing
  `web/tests/unit/composables/use-presence.test.ts` path before any broader
  listing. The next blocker is narrower again: after confirming the target
  file is missing, the worker still falls back to `list-files`/`glob` instead
  of creating it immediately.
- The next repair slice hardened that authoring boundary further. Focused
  `write-file` repair now carries the prior tool error, the exact likely
  target path, and recent read-file hints, and it runs under a short dedicated
  timeout instead of quietly consuming the whole worker turn budget. The
  LLM-facing `write-file` schema now also advertises `filePath` and `content`
  as required, while the backend still accepts alias-shaped recovery payloads
  when a model gets close but not quite right.
- Live Looma/Knit replay on `task-011` crossed a real threshold after that
  change: the worker no longer only dies in the `write-file {}` trap. Once it
  had re-read the exact source and test target, it eventually emitted a real
  `write-file` call with concrete `filePath` + `content`, and the query loop
  stayed alive instead of timing out immediately. The remaining blocker is now
  a later-step worker loop: once the test file exists and has been inspected,
  Guildhall still needs a cleaner handoff from “I know what is wrong” to
  “finish the rewrite and hand off for review,” instead of cycling
  `in_progress` turns around the same file.
- The next replay removed another source of drift: `write-file` target
  inference now prefers `current_missing_likely_target_file` and
  `current_task_likely_target_files` before any project-root heuristics, so
  repair prompts no longer fall back to `/knit/web/...` when the task is
  actually working inside `/knit/.guildhall/worktrees/task-011/...`. Focused
  tests now lock that behavior in. Live Looma/Knit replay on `task-011`
  matched the healthier shape: the worker reopened the exact worktree source
  and exact worktree test target, and it did not regress to the old repo-root
  write suggestion. The remaining blocker is now cleaner still: worker
  continuation can end a step after rereading the right files without yet
  taking the concrete mutation step.
- The next repair slice hardened the no-tool path after those exact-file
  rereads. When a reclaimed worker has already inspected the exact likely
  target file and still replies without a tool call, Guildhall now replaces
  the generic nudge with a stricter mutation-or-escalation demand: the next
  response must be exactly one tool call and no prose, either a concrete
  `edit-file` / `write-file` mutation or an explicit `raise-escalation`.
- The worker loop now also refuses to silently absorb repeated no-op reclaimed
  turns. For in-progress worker tasks with likely target files, two
  consecutive passes with no transition, no note, and no worktree edits now
  produce a structured escalation instead of another invisible in-progress
  loop. Focused `run-query` and `orchestrator` coverage are green, so the
  next live Looma/Knit replay for `task-011` should either mutate the test
  file or surface a truthful stuck reason instead of quietly spinning.
- Live replay answered the next question: `task-011` now reaches a concrete
  failing test diagnosis instead of wandering, but DeepInfra Qwen can still
  burn the whole worker turn after that diagnosis and die as a timeout.
  Guildhall now converts that specific resumed-worker timeout shape into a
  structured escalation when the task still has likely target files and no
  visible worktree edits, so the next run should stop as “worker is stuck”
  rather than a vague `agent-error`.
- The next repair closed the worktree-isolation leak that showed up once
  `task-011` finally emitted a real `write-file`. `write-file` and
  `edit-file` now reconcile near-miss absolute paths back onto the
  authoritative likely target file from task metadata, so a model that tries
  to write `/knit/web/tests/...` after working inside
  `/knit/.guildhall/worktrees/task-011/...` is snapped back into the task
  worktree instead of mutating the main repo. Focused file-tool tests now
  lock that behavior in, and a fresh Looma/Knit replay on the rebuilt server
  proved the execution-time behavior: the worker still requested the main-repo
  `.../knit/web/tests/unit/composables/use-presence.test.ts` path, but
  Guildhall completed the `write-file` against
  `/knit/.guildhall/worktrees/task-011/web/tests/unit/composables/use-presence.test.ts`.
- The next worker-tempo slice now stops intra-turn read-only churn earlier.
  After Guildhall has already refused exact-target read-only exploration twice
  in the same worker pass, `runQuery` now ends that turn immediately instead
  of continuing to donate model budget until a timeout. Focused `run-query`
  and orchestrator coverage are green. A fresh live replay attempt on
  2026-05-05 was blocked before it could exercise the new loop because the
  DeepInfra-backed provider returned HTTP 402 (`positive balance` required),
  so the next live proof needs provider credit or a different provider.
- The next live proof switched Looma/Knit to prefer `llama-cpp`, but the
  local server did not have the assigned model loaded, so Guildhall
  truthfully fell back to `codex-oauth`. That replay proved two useful things:
  `task-011` still mutated the real worktree test file, and the next blocker
  is no longer path drift or provider balance. It is worker-side verification
  command truth: after the edit, the worker still asked `shell` to run stale
  `pnpm --filter @knit-app test` commands that do not match the task worktree
  package layout.
- Closed that verification-command truth gap under one shared abstraction.
  Authoritative task-scoped success gates now live in a reusable helper used by
  both `run-gates` and `shell`, and `in_progress` worker prompts now surface
  those same normalized commands explicitly. That means one stale worker shell
  turn can no longer slip back to `@knit-app` filter commands after gate-check
  has already learned the correct `web`-scoped shape. Focused shell,
  run-gates, and orchestrator regressions are green; the next live Looma/Knit
  replay should answer whether `task-011` now clears verification instead of
  ending on empty-assistant/provider weirdness.
- Live Looma/Knit replay answered that question well. On `task-011`, the worker
  no longer ran `pnpm --filter @knit-app test`; it executed the normalized
  `cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts`
  command and surfaced a real failure in the task worktree test file:
  `~/app/composables/use-presence` did not resolve under Vitest. The worker
  then fixed that import path inside the worktree test file and continued.
- The next blocker is now a policy/instruction bug, not command truth. After
  making the valid test-only fix, the worker later escalated because Guildhall's
  stricter resumed-worker lane demanded mutation of the exact likely target
  source file (`web/app/composables/use-presence.ts`) or escalation, even
  though the real progress path was still test-only. The next repair slice is
  to distinguish “must mutate one of the likely target files” from “must mutate
  that exact source file,” so valid test-only progress is not turned into a
  false decision_required escalation.
- That policy repair is now live-verified. After resolving the old false
  escalation and replaying `task-011`, the worker no longer escalated about
  needing to edit `use-presence.ts`. It stayed on the valid test-only path,
  reran the normalized focused Vitest command, and exposed the next honest
  blocker: the worktree test still bootstraps enough Nuxt/Vite app context to
  fail on a missing `@looma/vue` import from `SidebarContent.vue` before test
  collection. So the next repair slice is no longer worker orchestration. It
  is deciding whether Guildhall should install/provide that dependency in the
  task worktree or let the worker isolate the unit test runner/setup so the
  file can execute without full app bootstrap.
- That supposed `@looma/vue` bootstrap blocker turned out to be a bad Knit
  unit-test harness, not another Guildhall runtime gap. The worktree test was
  importing `~/app/composables/use-presence` (a path Vitest/Nuxt does not
  expose), and its mock/setup path never mounted the composable inside a real
  Vue setup context. Reworking the test onto the repo's `mockNuxtImport(...)`
  pattern and a mounted harness made the focused command pass cleanly:
  `cd web && pnpm vitest --run tests/unit/composables/use-presence.test.ts`.
  The next live replay for `task-011` should now tell us whether the worker can
  continue through review/gates instead of stalling on a phantom environment
  problem.
- The next replay exposed a second, more systemic multi-repo worktree bug.
  `task-011` still blocked inside its task worktree because Knit's
  `link:../../looma/packages/vue` dependency no longer resolves once `knit/`
  is nested under `.guildhall/worktrees/task-011/`. Manually adding the sibling
  anchor `knit/.guildhall/worktrees/looma -> ../../../looma` made the exact
  worktree command pass, proving the root cause. Guildhall now creates these
  sibling repo anchors automatically for nested multi-repo worktrees, so
  cross-repo `link:` dependencies keep the same shape they had in the original
  workspace. Focused `worktree-manager` coverage and a fresh Guildhall build are
  green. The next live replay should show `task-011` getting past worker
  verification instead of re-raising the same stale harness/environment block.
- The next replay got past that nested worktree dependency failure and exposed
  a smaller, meaner runtime gap: after real worker edits and successful focused
  verification, some providers can start returning empty assistant replies
  during checkpoint/review handoff. Guildhall now lets the orchestrator inspect
  worker carryover metadata and preserve that state as resumable in-progress
  work when the task already has dirty worktree edits plus handoff evidence,
  instead of collapsing into a fake hard failure just because the provider
  ghosted during the last mile.
- The next real review blocker is evidence shape, not worker execution. Reviewer
  fanout was bouncing `task-011` because it could only see narrated self-report,
  not a real packet with changed file content. Guildhall now writes live review
  packets at `review`/`gate_check`, including changed-file summaries, numbered
  file excerpts, the latest self-critique, and the latest checkpoint, and it
  injects that packet into reviewer context so reviewers can inspect the actual
  task artifact instead of asking the worker to re-describe its own diff.
- Empty-provider last-mile flakiness now leaves a durable worker checkpoint
  behind instead of only a vague resumable state. When a worker has already
  produced dirty-worktree edits plus verified-work handoff evidence and then
  starts returning empty assistant replies, Guildhall writes a recovery
  checkpoint with the changed files and next planned action before preserving
  the task in `in_progress`. If the worker already raised a real blocker and
  the provider ghosts immediately afterward, Guildhall now still writes that
  checkpoint before leaving the task's `blocked` state intact. Focused
  `orchestrator` regressions and a fresh build are green. The next live
  Looma/Knit replay should tell us whether that checkpoint discipline is enough
  to get `task-011` cleanly back into review, or whether the next real blocker
  remains broader verification truth around unrelated repo-red files.
- The next replay clarified that blocker: `task-011` is repeatedly surfacing a
  broader `pnpm --dir web typecheck` failure in unrelated file
  `web/app/composables/use-presence.test.ts`, then rediscovering that as a
  fresh human decision on the next worker turn. Guildhall now injects the most
  recent resolved escalations directly into task context as
  `Resolved Human Decisions To Honor`, with explicit guidance not to reopen
  those questions unless new evidence appears in the same touched files or
  verification scope. Focused `context-builder` coverage and a fresh build are
  green. The next live replay should tell us whether that scoped decision now
  actually sticks inside resumed worker turns instead of reappearing as false
  `Needs you` work.
- That scoped decision is now sticking better, and the next blocker moved
  again. On the fresh Looma/Knit replay, `task-011` no longer bounced straight
  back into the same unrelated typecheck escalation; it stayed in `review`.
  Guildhall also now recognizes review-ready worker prose with verified
  evidence as a handoff problem instead of a “you must mutate again” problem,
  and the worker followed that nudge by issuing a real `update-task` call on
  the live run. The remaining flake is later: the provider can still ghost
  immediately after that handoff tool call, so the next repair slice is making
  post-handoff empty replies stop reading like active run churn when the task
  is already durably in `review`.
- That post-handoff slice is now in too. Empty assistant replies are no longer
  allowed to trigger deterministic reviewer fallback first when the task is
  already durably in `review`; Guildhall now preserves the review state before
  that fallback can bounce the task back into a bogus revise loop. It also
  normalizes ownership to `reviewer-agent` when review was still carrying a
  stale worker assignee. Focused `orchestrator` coverage and a fresh build are
  green. The next live replay should tell us whether the stop summary now reads
  as a calm preserved review state instead of an `agent-error`.
- Fresh Looma/Knit replay moved the live blocker again. The old
  post-handoff-review ghost path no longer dominates: `task-011` now lands on a
  real reviewer revision about `any` usage in the new test file and returns to
  `in_progress` with concrete feedback. The remaining runtime noise is lower in
  the stack now: after that legitimate bounce, the worker can still drift into
  read-only retry churn while addressing the revision. So the next repair slice
  is resumed-worker revision discipline, not review-handoff truth.
- Review ownership truth now holds even while Guildhall is paused. The
  orchestrator normalizes stale `review` ownership before picking lanes, and
  the serve layer also repairs persisted `review + worker-agent` rows when
  `/api/project` or `/api/project/task/:id` reads `TASKS.json`. Live
  Looma/Knit verification on `task-011` now shows `status: review` together
  with `assignedTo: reviewer-agent` in both endpoints without needing another
  tick to clean it up. That clears one more misleading UI/runtime state leak;
  the next honest blocker is still resumed-worker revision discipline after a
  legitimate reviewer bounce.
- The next live replay pushed `task-011` one stage farther: it finally cleared
  review and reached `gate_check` on Codex fallback. That exposed the next
  missing handoff rule. Guildhall had already persisted the hard gate results,
  but a gate-checker prose verdict could still leave the task churning in
  `gate_check` instead of converting those saved results into a durable status
  transition. Guildhall now treats fresh hard gate results as authoritative in
  that lane too: all-pass auto-completes to `done`, any hard-gate failure
  bounces back to `in_progress`, and stale `gate_check` ownership is
  normalized onto `gate-checker-agent` in both orchestrator and serve reads.
- The next blocker after that was finally the real scoped-decision leak:
  `task-011` kept failing `pnpm --dir web typecheck` on unrelated stale file
  `web/app/composables/use-presence.test.ts` even after the human had already
  resolved that broader repo-red was out of scope for this task's changed
  target. Guildhall now classifies that exact gate shape as a scoped exception
  when three conditions all hold: the failure paths do not touch the task's
  likely target files, the failing hard gate is the authoritative typecheck
  lane, and the task already has a resolved human decision explicitly keeping
  unrelated repo-red out of scope. Focused orchestrator coverage now locks
  that behavior in before the next live Looma/Knit replay.
- Live Looma/Knit replay on the fresh build confirmed the new rule: after
  resolving the stale `max_revisions_exceeded` escalation back to `gate_check`,
  `task-011` replayed once and went `gate_check -> done` in a single tick.
  The gate-checker still narrated the broad typecheck failure in its prose, but
  the orchestrator now correctly treats that failure as a scoped exception
  because it only touched unrelated file
  `web/app/composables/use-presence.test.ts` while the task target remained
  `web/tests/unit/composables/use-presence.test.ts`.
- The next cleanup slice pushed that scoped-exception rule down into the
  tool/runtime boundary itself. `run-gates` now receives the same resolved
  scope-decision context as the orchestrator and reports a scoped unrelated
  typecheck failure as an effective pass instead of a generic hard failure.
  That keeps the gate-checker model from being handed contradictory evidence in
  the first place and aligns tool narration with the orchestrator's final lane
  decision.
- The next spec-intake slice closed a quieter but real leak: once a spec-agent
  had already used transcript/file tools, a later no-tool reply that only said
  "I'll draft the spec now" could still end the turn because the generic
  no-tool nudge only applied before the first tool call. The query loop now
  detects future-step planning prose and reissues the same durable-step demand
  even after earlier tools ran, so planning narration has to turn into
  `update-task`, `update-product-brief`, `post-user-question`, or
  `raise-escalation` instead of silently ending intake. Focused `run-query`
  coverage is green, and the live Looma/Knit server is restarted on the fresh
  build while `task-007` now sits in truthful `spec_review`.
- Spec-review ownership now tells the truth while paused. A task waiting for
  human spec approval should not still claim `worker-agent`, so both the
  orchestrator normalization pass and the serve-layer task reader now clear
  stale `assignedTo` values on `spec_review`. Focused orchestrator coverage is
  green, and live Looma/Knit verification shows `task-007` at
  `status: spec_review` with `assignedTo: null` on the fresh build.
- Terminal task ownership now tells the truth too. Older Looma/Knit rows were
  still surfacing `worker-agent` or `gate-checker-agent` on `done` tasks even
  though no active lane owned them anymore. Guildhall now normalizes
  `done`/`blocked`/`shelved` tasks to `assignedTo: null` in both the
  orchestrator queue-normalization pass and the serve-layer task reader, and
  the task schema now accepts that paused/terminal truth instead of insisting
  on a string owner. Focused orchestrator coverage is green, and live
  Looma/Knit readback now shows every `done` task with `assignedTo: null`.
- Spec approval now reads as a paused approval state in the UI, not fake live
  activity. Task cards no longer treat `spec_review` as an active lane just
  because the orchestrator is running, and the Coordinators view now counts
  those tasks separately as `awaiting approval` instead of rolling them into
  the active total. The fresh Looma/Knit browser build is up on port 7844.
- The top-bar task indicator now matches that same truth. `spec_review` no
  longer inflates the `N active` chip in ProjectView; approval-paused work is
  counted separately as `awaiting approval`, alongside any real `active` and
  `stuck` counts.
- The top-bar inbox badge now counts actionable notifications, not only
  high-severity alarms. Medium-severity items like spec approval remain visible
  in the header even when nothing is on fire; the badge stays danger-colored
  for high severity and drops to warn-only when the outstanding action is
  medium.
- Approval-paused wording is now aligned across the remaining browser surfaces.
  `spec_review` now renders as `Awaiting approval` in the shared status label,
  the Thread card headline, the escalation resume picker, and the Release tab
  empty state, so the paused lane no longer flips between `review` and
  `approval` language depending on which surface the operator is looking at.
- `/api/project` and `/api/project/inbox` now read from the same inbox snapshot
  builder, including the same workspace-import self-healing path and blocker
  flags, so the main project payload no longer drops inbox state while the
  dedicated inbox endpoint still shows it. Hardening this also surfaced a raw
  task-read edge: `activeEscalations()` now treats missing `escalations` arrays
  as empty instead of throwing, which keeps lighter or older TASKS rows from
  crashing the project shell.
- Ready-state Thread cards now behave like queue cards instead of pseudo-chat.
  When a task has been approved into `ready` with no live agent yet, Thread now
  says it is approved and queued, offers `Start work` as the primary action,
  demotes freeform follow-up to `Add note`, and labels the secondary nav button
  `Open task`. This directly fixes the post-approval confusion where the card
  still looked open but made `Tell agent` the default next action.
- The project header now uses a clearer action hierarchy instead of just
  wrapping everything. Status and provider chips stay visible, `New Task` is a
  compact `+` affordance, `Start` / `Stop` remain the obvious main run control,
  and lower-frequency actions like `Finish one` move into an overflow actions
  menu so the header reads more like a product and less like a crowded control
  panel.
- Worker file-mutation discipline is tighter now. When a live coding task
  already has authoritative file-tool context (active worktree and likely
  target files), shell commands that try to write file contents directly via
  redirection / heredocs / tee are blocked and redirected back toward
  `write-file` / `edit-file`. Shell stays available for builds, tests, lint,
  and other focused verification, but the worker can no longer slide from a
  correct worktree file write into “let me rewrite that file through shell
  instead.”
- Agent-turn timeouts are now inactivity-based for streaming turns instead of
  hard wall-clock kills. If DeepInfra (or another provider) is still emitting
  assistant deltas or tool activity, Guildhall resets the turn timer and lets
  the agent keep working. A timeout now means “no streamed activity arrived
  for the configured interval,” which is a much truer signal than “the whole
  turn lasted longer than N ms.”
- Worker turns with real dirty-worktree progress no longer disappear as
  “no change” just because the model failed to move status on the same pass.
  When a worker finishes a turn, leaves verified work metadata behind, and the
  task worktree is dirty, Guildhall now writes a recovery checkpoint and bumps
  the task timestamp even if the task remains `in_progress`. That gives the
  queue a durable trace of progress instead of pretending the turn was empty.
- Agent request sampling is now role-aware instead of silently inheriting
  provider defaults. Guildhall threads an explicit optional temperature through
  the engine/provider contract, uses conservative defaults by role
  (`spec/coordinator=0.2`, `worker=0.1`, `reviewer/gate=0.0`), and only emits
  it on provider paths that actually support it today (OpenAI-compatible and
  Claude). Codex keeps its existing tuned default behavior for now.
- Context debug snapshots now record the effective temperature alongside the
  model id, so when a lane gets weird later we can distinguish “provider/model
  issue” from “sampling issue” without reconstructing runtime defaults from
  source.
- The first live DeepInfra split-model replay exposed a file-tool truth bug,
  not a model-availability one. `task-007` really did reclaim under
  `worker=Qwen/Qwen3-235B-A22B-Instruct-2507`, reached shell verification, and
  wrote progress far enough to attempt a review handoff. The real failure was
  that write/edit path reconciliation treated a file path already inside the
  task worktree as if it still needed project-root remapping, which created a
  bogus nested `.guildhall/worktrees/task-007/...` target and confused the
  review guard about whether the worker had touched the real file.
- The same live replay also showed the task-scoped verification command needed
  one more normalization pass. `pnpm --filter @knit-app test --
  tests/unit/composables/use-collections*.test.ts` was being rewritten into a
  shell command that still left Vitest with a fuzzy glob, which in practice
  ran far more of Knit's suite than intended. Task-gate normalization now
  expands wildcard test targets into explicit file arguments, so the worker and
  gate lanes can run the concrete `use-collections` unit files instead of
  widening into unrelated component/server failures.
- Inbox truth is tighter again for live tasks. The low-severity `spec_fill`
  wizard no longer applies once a task has moved into `in_progress`, `review`,
  or `gate_check`, so Looma/Knit tasks like `task-007` stop showing bogus
  `Missing product brief` nags while real worker/reviewer work is already in
  flight. Intake/approval stages still keep the spec-fill nudges.
- Reviewer-lane evidence is now visible from the same live API payload the UI
  already reads. `/api/project` task rows and `/api/project/task/:id` now
  derive `latestReviewerSummary`, `latestSelfCritique`, and
  `latestCheckpoint` from the newest reviewer/self-critique notes plus the
  per-task checkpoint file, so a Looma/Knit replay that bounces `task-007`
  back out of review can be diagnosed from the served task payload instead of
  digging through raw `memory/TASKS.json` and `checkpoint.json` by hand.
- That same review packet is now visible in the browser instead of living only
  in the API. Task cards can show the latest reviewer bounce or next
  checkpoint action inline, and the drawer Spec tab now renders a `Latest
  handoff packet` card with the newest reviewer summary, self-critique, and
  checkpoint details. When `task-007` churns again, the operator can inspect
  the current handoff packet from the queue and drawer without leaving the app.
- Reviewer-fanout summaries now separate actual requested changes from reviewer
  availability failures. Persona timeouts / 429-style infra misses are still
  preserved for audit, but they land in a `Reviewer availability notes`
  section instead of inflating the `Aggregated revisions from N personas`
  headline. That keeps the next `task-007` review bounce from reading like
  five distinct code-change asks when some of the noise is really provider
  flakiness.
- Review-packet generation itself is less likely to undersell valid worker
  evidence now. The packet treats `implementation` notes that contain a real
  self-critique as review evidence, and changed-file rendering filters out
  obvious command-shaped junk paths left over from earlier resume/write bugs.
  That should stop `task-007`-style replays from getting bounced for “no
  self-critique” or bogus command-path diff entries when the worker actually
  did the right thing.
- Fresh-task proof is finally cleaner now. `task-007` has been shelved as a
  contaminated regression fixture, a new `task-012` Supabase type-generation
  task can start from a fresh worktree again after cleaning the dirty `knit`
  base repo, and the next honest blocker is narrower: the spec-agent was still
  able to churn on repeated read-only tool calls after the intake research
  budget was exhausted. `runQuery` now ends the turn after repeated
  intake-budget refusals instead of looping forever on the same refusal.
- The same fresh-task replay exposed one more intake escape hatch and we
  tightened that too. After Guildhall has already demanded durable intake
  progress, `append-exploring-transcript` alone no longer counts as a viable
  next step; `runQuery` now ends the turn if the agent tries to use a
  transcript-only carryover after a durable-progress nudge. In parallel,
  `update-product-brief` now accepts the common near-miss shape where
  `antiPatterns` arrives as one multiline string, normalizing it into the
  expected array instead of bouncing the brief update.
- Reclaimed worker context is now sharper for fresh-task replays. `task-012`
  already had a real checkpoint on disk after successfully falling back from
  local `pnpm db:types` to `pnpm db:types:remote`, but the injected resume
  packet was still abstract enough that the worker's first move on reclaim was
  `read-tasks`. Context assembly now surfaces the latest checkpoint as its own
  block, folds checkpoint `filesTouched` into Likely Target Files, and the
  worker prompt explicitly says not to reread `TASKS.json` on the first resume
  turn when the checkpoint already names the next step. The next live replay
  should tell us whether that turns the first reclaimed step into focused
  verification/mutation instead of queue rehydration.
- The next live `task-012` replay proved that checkpoint-first reclaim is
  working. The worker now resumes straight into `pnpm db:types`, sees the
  expected local Docker failure, and falls back to `pnpm db:types:remote`
  without rereading queue state. After that, Guildhall now refuses pure
  read-only follow-up turns using the checkpoint's own next action as the
  reason, which is better than letting the worker silently spiral. The next
  blocker is one layer later: the worker is still choosing the wrong post-
  generation move and burning against the checkpoint guard instead of turning
  that checkpoint into a concrete verification or code change.
- Provider header copy is a bit more honest now for split-model experiments.
  When the live run has different models assigned by role, the top bar no
  longer shows the worker model as if it were the whole runtime; it now says
  `Mixed models`, with the per-role breakdown still available in the provider
  tooltip/details text. That keeps the DeepInfra A/B setup from looking like a
  single-model run when spec/worker/reviewer lanes are intentionally split.
- Checkpoint-directed worker reclaim is less blunt now. If a checkpoint's next
  action is exploratory, Guildhall still refuses broad read-only drift, but it
  now permits `read-file` on the checkpoint-touched files themselves before
  demanding the next focused verification or mutation step. That gives task-012
  just enough room to inspect the exact generated-types surfaces without
  reopening repo-wide search.
- Relative checkpoint file paths now reconcile against the task's real repo
  root/worktree instead of the Guildhall process cwd. That closes the Looma/
  Knit mismatch where `task-012` could ask for `web/app/types/supabase.ts`
  after `db:types:remote`, but `read-file` would resolve it against the parent
  workspace and fail before the worker ever reached the actual generated file.
- Fresh bounded `task-012` replay shows the center of gravity has moved again.
  The path/root mismatch is no longer the loudest failure. The worker is still
  choosing broad `grep` probes after `db:types:remote` instead of taking the
  now-permitted exact-file `read-file` step, so the remaining blocker is
  checkpoint-follow-through behavior, not file-tool rooting.
- Tightened checkpoint-follow-through on reclaimed worker turns. When a worker
  drifts into broad read-only search after an exploratory checkpoint, the first
  refusal now appends a strict one-tool follow-up demand that names an exact
  checkpoint file to read next. Fresh bounded `task-012` replay proved the
  change is doing useful work: after `db:types:remote`, the worker finally
  opened the exact generated `web/app/types/supabase.ts` file instead of
  grepping the repo again.
- Chunk 2 has started in the worker-handoff lane. Recovery checkpoints are no
  longer limited to dirty worktrees; if a worker has real verified progress but
  no dirty diff (for example, successful generation/verification plus an exact
  inspected file) Guildhall now preserves that progress with a recovery
  checkpoint instead of acting like the turn had no durable value.
- Fresh bounded `task-012` replay on the latest build completed the chunk-2
  proof. After the tightened checkpoint-follow-through, the worker advanced
  from generated Supabase types to the exact `use-workspace.ts` surface, then
  wrote a new recovery checkpoint and bumped the task timestamp even though the
  task remained `in_progress`. The live blocker has moved again: worker
  follow-through is now specific to when read-only checkpoint steps trip the
  generic research-budget refusal logic, not to whether progress gets preserved
  at all.
- Fresh `task-012` replay after the reclaim fixes exposed the next precise
  worker-handoff leak. When a non-exploratory checkpoint already says "write
  the self-critique and hand off to review", the worker still tends to start
  with a reflexive `read-file`. Guildhall now distinguishes that handoff-shaped
  checkpoint from exploratory ones and appends a stricter one-tool nudge that
  demands an `update-task` self-critique note (or escalation) instead of
  letting the turn stall on a generic "don't read more" refusal.
- Fresh `task-012` replay then proved the worker was really writing the
  self-critique, but the live API/review packet still failed to surface it
  because those derivations only accepted `role: self-critique` or
  `implementation`. Guildhall now recognizes worker-authored notes whose
  content is explicitly labeled `Self-critique`, which made the live
  `/api/project` and `/api/project/task/:id` payloads line up with the actual
  task state again.
- The next live blocker moved one step later: after persisting self-critique
  and a review-handoff checkpoint, the worker could still satisfy the handoff
  loop by writing another checkpoint instead of flipping the task to `review`.
  Tightening that loop let the latest bounded replay move `task-012` back into
  real `review` on the fresh build. The remaining throughput gap is now in the
  reviewer reclaim lane: the task is visible as a reclaim candidate, but the
  reviewer turn is not yet being resumed cleanly from that paused `review`
  state.
- The top toolbar action cluster has been re-normalized around one button
  system. On wide screens `New task` is a labeled secondary action again,
  `Start` / `Stop` stays the primary control, and the overflow trigger is now
  a proper ellipsis icon button with a circular active state instead of the
  mismatched sliders/chevron hybrid. The left/right header content is also
  vertically centered again.
- Reviewer fanout is now explicitly task-bounded. Persona reviewers are told
  to anchor blocking findings to unmet ACs, changed files, or scope violations
  only; broader architecture/perf/API ideas must be emitted as non-blocking
  follow-ups instead of forcing a revise. The aggregate revision packet now
  preserves those follow-up ideas in a separate section so the worker can see
  them without treating them as required for task acceptance.
- Worker handoff now asks for an explicit minimum-scope self-review before
  `review`: list files changed, answer whether the diff is the smallest useful
  change, and name anything that should be reverted before review. That pushes
  scope-trimming back onto the worker instead of leaving reviewers to police
  avoidable extras after the fact.
- Thread review-feedback cards no longer inline the full reviewer packet as a
  giant wall of Markdown. The card now stays compact: short revision summary,
  pass count, and an `Open task` affordance that sends the user to the drawer
  where the full handoff packet already lives.
- Task worktrees now inherit runtime dependency directories when Guildhall
  creates them and when it reuses an older worktree. The worktree manager
  mirrors root `node_modules` plus nested package-level `node_modules` (like
  `knit/web/node_modules`) into the task worktree so bounded worker runs can
  execute `typecheck` / `vitest` without failing on missing local runtime
  dependencies.
- Fresh task-012 proof is healthier now. After the worktree runtime-link fix
  and a task-local `use-workspace.ts` typing cleanup, the live Looma/Knit
  replay ran `db:types:remote`, passed focused `typecheck`, persisted a new
  self-critique, and moved task-012 back to real `review` on the fresh build.
  The worker-side blocker is no longer dependency setup or handoff amnesia; the
  next throughput gap is reviewer-lane reclaim / verdict quality on that fresh
  task.
- Worker no-progress nudges are now a little smarter around review handoff
  checkpoints. When the latest checkpoint already says "set status to review",
  Guildhall no longer falls back only to the generic "make durable progress"
  message after extra non-progress turns; it can now nudge the worker toward
  the exact `update-task { status: "review" }` handoff step instead.
- Concurrency is now less knob-happy in the live product path. Reviewer fanout
  auto-derives from the active provider's recommended capacity by default,
  instead of requiring a project-local `reviewerFanoutConcurrency` tweak. The
  Looma/Knit override was removed, the live `/api/project` payload still
  reports reviewer fanout `4/4` on DeepInfra, and the top-bar/provider payload
  no longer emits config-clamp chatter for concurrency tuning.
- Blocked Thread cards no longer dump raw reviewer novels. Escalation details
  are now compacted in the thread projection into one short blocker sentence
  plus reviewer-timeout count, and the card copy explicitly points the user to
  `Open task` for the full packet. Live Looma/Knit thread payload for
  `task-012` now reads as a compact blocker summary instead of the full
  aggregated markdown blob.
- Coordinators now have a cleaner drill-in path. `Settings -> Coordinators`
  explains the model and source of truth, `/coordinators` shows live lane
  ownership, and `/coordinators/:id` no longer needs to repeat the selected
  lane as both a policy panel and a second board column. The detail route now
  focuses on lane policy plus a scoped `Tasks in this lane` stack so the flow
  reads like a real detail view instead of a duplicated board.
- `ProjectView` now tracks route props reactively instead of holding onto
  stale "initial" sub-route values. That closes a real live-shell bug where a
  coordinator detail route could render the policy drill-in at the top while
  still leaking the old all-lanes board branch lower on the page.
- Layering now follows shared z-index tokens instead of component-local magic
  numbers. Shell chrome, banners, popovers, drawer overlays, and modals all
  now map onto one explicit order in `src/web/tokens.css`, which fixes cases
  like the stale-server alert bleeding through an open task drawer.
- Release focus is now explicitly narrowed to start-to-finish automation.
  Product/UI follow-ups like coordinator-detail polish, broader overlay sanity
  sweep, and task-drawer information hierarchy are intentionally tabled in
  favor of proving fresh-task throughput end to end.
- Reviewer-lane ownership truth is now healthier on fresh tasks. Resolving an
  escalation back to active work no longer leaves `in_progress` tasks orphaned
  at `assignedTo: null`; escalation resolution plus serve/orchestrator
  normalization restore the correct active assignee before the next dispatch.
  Live Looma/Knit replay pushed `task-012` through review and into
  `gate_check`, which moved the next honest blocker downstream into hard-gate
  truth instead of reviewer reclaim mush.
- Hard-gate scope exceptions now generalize beyond `typecheck` to broader
  task-scoped repo red. Guildhall now classifies gate kind from the real gate
  payload instead of trusting friendly ids like `test`, so authoritative
  gate-check runs with generic ids like `gate-3` can still exempt unrelated
  repo-red `test`/`lint` failures when they are outside the task's likely
  target files. This closes the live Looma/Knit failure where `task-012`
  reached `gate_check` but broad unrelated `pnpm -F web test` failures still
  blocked the task despite being outside the actual Supabase-types change set.
- Live proof: after replaying `task-012` on the fresh build and resolving the
  final escalation back to `gate_check`, Looma/Knit now completes the task in
  one bounded tick: `gate_check -> done via gate-checker-agent`. The task ends
  terminal with `assignedTo: null`, no open escalation in inbox, and the broad
  unrelated `pnpm -F web test` failure preserved only as raw gate evidence
  instead of blocking the bounded Supabase-types task.
- Terminal/publish truth is now explicit in the served task contract. The
  API derives a concise terminal summary from each task's `mergeRecord`, so
  done/pending-PR cards can say whether the task merged locally, pushed,
  opened a PR, or skipped merge, and the drawer Provenance tab now exposes
  the full terminal outcome record for audit.

- Worker review handoff now ends the turn cleanly after a durable lane-exit status update instead of reapplying mutation nudges to the old lane. Added run-query metadata for lane handoff completion and a regression that covers `task-015` style worker -> review transitions with likely-target context.
- Live fresh-build proof: with the lane-exit handoff fix in place, a bounded Looma/Knit replay took `task-015` from `review` to `gate_check` to `done` in one run. The worker no longer kept orbiting after a durable `update-task { status: "review" }` handoff, reviewer fanout reclaimed the task, and gate-check completed under task-scoped rules.
- Batch-proof follow-through exposed one last worker-verification authority leak on fresh `task-016`: the worker prompt already had narrower task-scoped verification commands, but shell reconciliation was still deriving authority from broad hard gates. Guildhall now loads `current_task_verification_commands` into tool metadata and shell authority prefers that list over `current_task_success_gates`, so narrow cleanups stop drifting into whole-app verification during `in_progress` while hard gates remain authoritative later in `gate_check`.
- Fresh `task-016` replay proved the worker-side verification clamp: the worker stayed on task-scoped `lint`/`typecheck`/`build` verification instead of falling into broad `pnpm -F web test`. The next truthful blocker was reviewer spillover on a one-line cleanup, so reviewer fanout now demotes broad standards-only asks (versioning, idempotency, observability, boundary validation) into non-blocking follow-up ideas when the reviewer itself says the task already meets the functional acceptance criteria and the remaining feedback is rubric spillover rather than a task-local regression.
- Persona reviewer instructions now carry a much stronger pragmatism contract. Reviewers are explicitly told to ask whether the diff actually made the code worse, left the stated job undone, or introduced a new meaningful risk before blocking; to treat pre-existing imperfections in touched files as follow-up ideas unless the task explicitly asked to fix them; and to distinguish internal first-party routes from true public API contracts so small local changes do not trigger doctrinal versioning/idempotency/platform-ceremony demands.
- Persona reviewer language is now less absolutist: reviewers are told they are not the final project owner, to avoid decree phrasing like "what must change", and to frame revise feedback as recommended task-local revisions for coordinator/project-owner judgment rather than persona-level commandments.
- Persona reviewer ownership boundaries are now explicit in the prompt: each expert is a contributor to the decision, not the sole decision maker, so acceptance judgment belongs to the coordinator/project-owner layer even when a persona sees a legitimate concern in its lane.
- Reviewer output is now shifting toward a lighter ADR-style frame: recommended task-local revisions, concrete risk if accepted as-is, and non-blocking follow-up ideas. The goal is to preserve expert trade-off thinking without turning every persona comment into a pseudo-order or a full architecture record.
- Persona review output now also supports a small advisory scoring block: recommendation priority, expected value if taken, and risk if deferred. These scores are explicitly from the persona's perspective and are meant to help the coordinator weigh trade-offs, not to let any one expert dictate the final call.
- The drawer review packet now surfaces persona advisory scoring as colored pills instead of leaving those rankings buried in markdown prose. Each reviewer section can show priority, expected value, and deferred risk at a glance while preserving the full underlying narrative below.
- [x] Runtime: demote broad reviewer doctrine on narrow cleanup tasks when it does not overlap the task itself.
  - Added task-aware reviewer demotion hints so one-file cleanup tasks no longer let versioning/idempotency/observability/boundary-validation sermons block unless they actually overlap the requested change.
  - Kept direct task-overlap findings blocking, so a reviewer can still stop the task when the actual cleanup was not applied.
- Reviewer/gate adjudication now share the same scoped hard-gate worldview. Deterministic review accepts a task-scoped context (`projectPath`, likely target files, resolved scope decisions) and credits `no-regressions` when the only hard-gate failures are unrelated repo-red already exemptable by gate-check policy. This closes the logic gap where review could bounce a tiny cleanup for `gate-3` before the gate adjudicator ever got a chance to apply the scoped exception.
- Live Looma/Knit replay after that change showed the old deterministic blocker disappearing: `task-016` no longer re-escalated on `Deterministic review: ... failing signals: no-regressions`. The next failure family is sharper now: the latest LLM reviewer note explicitly approved the task and called the unrelated test failures non-blocking, but the persisted review transition still landed as `review -> in_progress`.
- Added a guard for that new contradiction: when an LLM reviewer note contains an explicit structured verdict (`**Verdict:** Approved` / `Revise`), Guildhall now trusts that verdict over an ambiguous status transition when recording the review result and normalizes the post-review state accordingly. Focused tests pass, but the live `task-016` specimen still needs a clean fresh replay on the new build to fully prove this family end to end because the current task state was already carrying the pre-fix contradictory review record.
- Live proof: on the fresh Looma/Knit build, `task-016` now replays cleanly from `in_progress -> review -> gate_check`, and the persisted reviewer records are truthful: the latest fan-out pass lands as `approve`, the task status stays `gate_check`, and `assignedTo` becomes `gate-checker-agent` instead of bouncing back to `worker-agent`. This completes the reviewer-approval normalization family.
- Live proof: the follow-on gate-check family is also now complete on the same fresh replay. `task-016` proceeded from `gate_check -> done`, preserved the unrelated broad `gate-3` web-test failure as raw gate evidence, applied the scoped gate-check exception instead of bouncing the task, and merged locally into `main` with terminal outcome `Merged locally into main.` This confirms that the whole narrow-cleanup path now survives review, gates, and terminal merge truth end to end.
- Release pivot: bumped Guildhall to `0.4.0`, added a repo-local `docs/releases/0.4.0.md` note, updated README publish commands/examples, and added a concise Release-tab shipping-claim card so the product now states the honest release story directly: proven end-to-end automation for the narrow cleanup lane, not all task shapes yet.
- Release hardening for `0.4.0` is now in progress at the repo/runtime layer, not just docs. The dry release surfaced real blockers, and this pass cleared them by (1) restoring sane "few knobs, smart defaults" lane concurrency behavior so worker fanout is not silently forced back to serial by project-config defaults, (2) preserving serial picker priority semantics under lane-capacity fanout so coordinator pre-rejection policy work is not starved behind ordinary worker tasks, (3) updating reviewer-dispatch reasoning tests to the current structured return contract, and (4) making git-driver integration tests hermetic against this machine's global git hook path by neutralizing global git config during throwaway repo commits.
- PR follow-up hardening for release prep: restored `src/**/__tests__/**` to TypeScript coverage, aligned the orchestrator's lane-capacity fallback with the same project-config defaulting story exposed by `/api/project`, and stabilized idle provider-status snapshots so `selectedAt` no longer churns on every poll when a project is not actively running. Probing a full `exactOptionalPropertyTypes` re-enable still explodes into a much broader runtime cleanup, so that remains explicit follow-up debt rather than getting smuggled into this release-prep fix set.
- 0.5.0 implementation is now pivoting the product from a single-project-feeling dashboard to a Projects-first local service UX. The active scope is no longer "polish the current shell" — it is "make Guildhall behave like a macOS-first service over many projects while preserving the proven narrow-lane task flow inside each project."
- The next implementation families are now explicit: (1) project-aware service lifecycle commands and `guildhall serve` semantics, (2) a true top-level Projects shell with per-project start/stop state, (3) attach-existing-folder as the only new-project path with uninitialized-project handling inside the project shell, and (4) a packaging/installer path built around a packaged executable plus LaunchAgent support.
- UI architecture cleanup is part of the 0.5.0 release work, not a separate cleanup fantasy. The Projects shell and nested project shell should be assembled from clearer reusable layout, summary-card, and data-shaping pieces rather than layering more bespoke project-only view logic onto the current single-project surfaces.
- First 0.5.0 service-lifecycle slice is now in place. The CLI understands `guildhall start`, `guildhall stop`, and `guildhall open`, while `guildhall serve` now acts like the friendly "ensure the service is running, then open Guildhall" path instead of blocking as the server process itself.
- The runtime now exposes a service-level `/api/service` contract separate from `/api/project`. It reports the optional preferred project bias, the current foreground project used by the still-legacy project-scoped API surfaces, and the list of registered projects, which gives the upcoming Projects home a truthful root payload instead of forcing it to infer service state from one project's data.
- The product story is now cleaner even before the Projects shell lands: background service state is tracked explicitly, `serve` logs talk about a local Guildhall service plus foreground project rather than pretending the whole server *is* one project, and docs now teach `serve`/`start`/`open`/`stop` as a family instead of only the old single-command dashboard story.
- The Projects-first shell now has real runtime footing instead of being a mockup. `/` routes to a dedicated Projects home, `/project/...` is the explicit namespace for the current nested project shell, and the router still accepts the older project-relative paths during transition so we do not have to rewrite every tab/link in one scary pass.
- The service API now supports real project selection. `/api/service` returns card-ready project summaries (selection state, task counts, and run posture), and `/api/service/select-project` can switch the foreground project for the existing `/api/project*` surfaces. That means project cards can actually `Open`, `Start`, and `Stop` a chosen project instead of faking fleet control off one project's payload.
- Live smoke on the fresh build: a local service run at `http://localhost:7890` served the new Projects root, `/api/service` returned both Looma/Knit and `t-minus-t` with task counts, and selecting `t-minus-t` through `/api/service/select-project` immediately moved both `selectedProject` and `foregroundProject` to that repo. This completes the Projects-first shell slice well enough to move on to attach/uninitialized flow next.
- Attach-existing-folder is now a real top-level flow instead of a setup-side escape hatch. `/api/service/attach-project` registers the chosen folder against the live local registry, switches the service foreground project immediately, and opens uninitialized folders inside the project shell rather than auto-bouncing them away to `/setup`. When setup identity later finishes, the temporary uninitialized registry entry is reconciled into the final project id/name/tags so the Projects screen stays truthful across machine-local re-attachment and first-run initialization.
- Live smoke on a temp HOME proved the full attach flow end to end: a blank local service attached an existing uninitialized folder, `/api/project` surfaced `initializationNeeded` against that attached path, setup identity promoted the temporary registry entry into a final `attach-smoke` project, and `/api/service` plus `~/.guildhall/registry.yaml` both reflected the final initialized project without manual cleanup.
- The next 0.5.0 UI slice is now pulling structure out of the surfaces instead of letting the new Projects shell and project shell accrete more bespoke markup. Shared `AppShell` / `ProjectShell` / `ProjectsShell` wrappers now own the outer chrome, while a pure `project-data` module owns coordinator columns, work-surface state, event sorting, and thread phase grouping that used to live inline inside `ProjectView`, `WorkTab`, `CoordinatorsTab`, and `ThreadTab`.
- Visual check on the fresh local service (`http://localhost:7892`) passed: the Projects home now renders as a calmer service-level dashboard with reusable project cards, and the nested project Work view still holds together under the new shell/layout wrappers without the refactor scrambling the rail, top bar, or task grid.
- Project cards now carry a much better at-a-glance story. The service payload includes tags, a short project blurb, and lightweight task highlights (current active task, current blocked task, or latest completed task), and the card UI now frames those into `Stage`, `Activity`, and `Recent` lines instead of forcing the user to reverse-engineer everything from raw counts alone.
- Visual check on the refreshed Projects home (`http://localhost:7893`) passed: cards now show whether agents are actively working, whether the project is paused/blocked/stable/needs setup, what the project broadly is, and the most relevant recent task title, while still staying compact enough to scan as a real top-level fleet dashboard.
- The next `0.5.0` runtime cleanup slice is now explicitly about isolated task workspace placement and lifecycle. The current repo-local `.guildhall/worktrees/...` shape is deterministic but wrong for the product: it clutters editor trees, pollutes normal `git status`, and makes ephemeral runtime sandboxes look like project-owned state. The approved direction is now:
  - move new isolated task workspaces to `~/.guildhall/worktrees/<project-id>/<task-id>`
  - keep the main settings story calm: `Shared project workspace` vs `Isolated task workspaces`
  - show exact sandbox paths only in task details/provenance
  - keep workspaces until work has actually landed, especially for PR-backed flows
- First-time-user live audit on `http://localhost:7895` exposed a still-open
  language/safety problem across the active project shell. Biggest blockers:
  the global stale-serve banner speaks in raw operator commands instead of
  user-facing recovery language; project entry still mixes safe navigation with
  ambiguous state-changing actions like `Start agents`; Notifications,
  Thread, and the task drawer all re-describe the same approval state with
  different verbs; and approval/question flows still leak Guildhall internals
  (`Spec author`, `RESTATING`, `coordinator`, `lever positions`,
  `stopAfterOneTask`) at the exact moment a new user most needs plain language
  and confidence about what happens next.
- Naive-user audit against the live `0.5.0` shell (`http://localhost:7895`) confirmed that the remaining friction is still mostly language + routing, not missing features. The sharpest blockers were: approval items landing in the wrong surface, multi-question answers feeling staged-but-not-submittable, and approval copy slipping back into Guildhall jargon (`Spec author`, `coordinator`, `Approve areas`, etc.) right when a first-time user needs plain-English reassurance.
- Approval routing is more direct for real Thread decisions now. Brief/spec approvals from `Do this next` and `Inbox` route into `Thread` and use `Review in Thread`, instead of dropping the user into task/work views that do not actually contain the approve affordance.
- That routing rule turned out to be too blunt for reserved workspace import. The Looma + Knit inbox still surfaced `task-workspace-import` as work that needed a human decision, but `Open in Thread` landed on a dead-looking Thread view because the real action lived in `/workspace-import`, not in any open Thread turn. The fix was to keep brief/spec approvals on `Thread`, but send the reserved import item straight to `/workspace-import` with a truthful `Review import` verb.
- Thread setup sections also stopped auto-collapsing themselves when the only pending setup work was skippable. That "helpful" collapse made `Optional` feel unopenable because the click immediately got undone by state. Setup phases now stay under direct user control: if a section is visible and the user clicks it, it actually opens.
- [x] Remove duplicate answer confirmation from Thread intake questions. Per-question `Send` now posts the answer directly and resumes the task, while legacy saved drafts show their own `Send`/`Change` controls. The old section-level `Submit answers` footer is gone, so the UI no longer asks the user to send and then submit the same answer.
- New-task language is calmer for first-time users. The task prompt now says Guildhall will ask follow-up questions before work starts, the field is `Project area (optional)`, and the selector defaults to `Let Guildhall choose` instead of silently preselecting the first coordinator domain.
- Approval copy is getting more consistent across Thread and the drawer: `Project areas draft`, `Use these areas`, and `Guildhall's draft of your task` now replace some of the older internal phrasing that made the same approval state sound different in each surface.
- Project-level action language is a little clearer too: the overflow action now says `Run one task` instead of `Finish one`, and the empty inbox state now reads `nothing is waiting on you right now` rather than coordinator-internal wording.

- SetupWizard still had older coordinator-approval copy hard-coded (`Will watch`, `Will check`, `Approve and merge`). That was not stale generated data; it was a stale renderer path. It now matches the newer Thread language: `Project areas draft`, `Purpose`, `Checks on work here`, and `Use these areas`.
- The next naive-user pass exposed a second layer of "this still feels like an operator console" friction. The main fixes in this batch were: (1) the provider badge now explains configuration vs active runtime in human terms (`This project is set to use ... when you start a run`, `Current run is using ...`) instead of `Configured preferred provider`, (2) project-level run controls now say `Start run` / `Stop run` and task-drawer controls say `Run this task`, `Pause task`, and `Put aside`, and (3) the stale-build banner no longer opens with a panic-y kill command. It now says Guildhall needs a restart to show recent code changes and tucks the exact restart steps behind `Show restart steps`.
- Workspace import inspection had drifted into another product violation:
  instead of opening the app's actual right-edge details overlay, clicking a
  project part or note injected a second column full of prose directly into
  the page. That made the core flow denser, broke the "no wall of text"
  rule, and confused "inspect" with "layout." The fix was to remove the
  inline pane completely and move import inspection onto a real slide-over
  drawer, while keeping selection actions (`Use this source`, `Leave out`,
  etc.) separate from inspection clicks.
- Live fresh-build proof on `http://127.0.0.1:7898`: the top-bar no longer showed raw `stopAfterOneTask reached task-meta-intake (processed).` text. The fallback stop-summary path now normalizes that case to the human-facing `One task finished.` when the richer idle counts payload is absent.
- The import path is now less state-mushy in the middle steps. Workspace
  import uses a shared `NoticeBand` family for shell/status messaging, the
  stale-server warning now sits at the real top of the app instead of below
  the header, and the source-review step no longer asks the user to parse
  `Included` as an action. Selected sources now show state on-card (`In this
  pass`) while the buttons say what will actually happen (`Use this source`,
  `Leave out`). The step also now carries compact summary chips for sources
  and kept tasks so the user can feel progress without reading long prose.
- Shared-component alignment is now starting to bite. The import journey no
  longer owns a bespoke stepper widget; it uses a reusable `WizardStepper`
  primitive, and shell/status messaging now shares one `NoticeBand` family.
  This is the intended direction: the product should make good-looking common
  patterns easy to reuse instead of letting each flow invent its own local
  version.
- Added a short design sketch to the `0.5.0` spec for a future action layer plus companion chat/control surface. The important constraint is that navigation still has to make sense without chat: the app remains the primary product, while MCP-callable actions and a future chat pane should sit on top of the same canonical verbs rather than becoming a substitute for understandable product structure.
- 2026-05-09 20:45 PDT: user called out a deeper labeling bug, not just stale copy on one screen. Coordinator/steward display labels had been written into config/drafts (`Looma Coordinator`, `Knit Coordinator`) and then re-rendered as if those strings were source-of-truth product state. Cleanup in progress now derives visible steward labels from `domain`/`id`, removes generated coordinator names from live Looma + Knit config plus repo seed configs, and relaxes the config/meta-intake schema so legacy `name` fields are tolerated but no longer required or written back for the normal product path.
- Fresh cold-user walkthrough on `http://localhost:7908/workspace-import` is finally much closer to a guided review than a dossier. The flow now narrows in a humane sequence (`Found -> Parts -> Sources -> Tasks -> Confirm`), and the user is no longer asked to manage hidden inclusion state before they understand what the choice means. `Choose parts to review`, `Review Looma`, `Review sources in Looma`, and `Create 80 draft tasks?` all read as concrete forward moves instead of vague approval over a blob.
- The remaining UX gap is no longer primary structure; it is inspectability and confidence. Step 3 (`Review sources in Looma`) still mostly asks for trust because the user can keep or leave out a source without previewing why Guildhall extracted tasks from it. Step 4 improves that by exposing actual task candidates as checkboxes, but the flow still needs a better "show me the source / summary / provenance for this task" affordance so the user is confirming prepared work rather than taking the model's grouping on faith.
- The import path is now back at a truthful handoff point for real user testing. On the fresh build, a user can start at `Review existing project work`, step through parts, sources, tasks, and the final confirmation screen without the old contradictory button labels or hidden state transitions blocking comprehension. The next meaningful product pass should focus on source/task inspectability and durable provenance rather than another wholesale journey rewrite.
- Tightened the import journey around one rule: card-level actions refine the
  current pass, while the bottom primary button is the only forward move.
  The old flow let "review this thing", "advance to the next thing", and
  "skip ahead to final review" compete on the same screen. The new pass now
  makes parts selection explicit (`Add to this pass` / `Remove from this pass`
  + `Review 2 selected parts`), moves notes one part at a time (`Review Knit
  next`), removes task pagination, and turns the final step into an actual
  final task list instead of a count summary with a confusing `Re-read project
  notes` escape hatch.
- Import review items are now gaining a real inspectability pattern. The
  journey should let the user click almost any meaningful item without losing
  their place: card bodies and file paths open the right-side details pane,
  while `Use this source` / `Leave out` and similar buttons only change
  whether something belongs in the current pass. Also fixed the misleading
  selected-state drift where optional/reference source cards could say `In
  this pass` without adopting the same selected background as primary sources.
- Work now behaves more like a real task manager instead of a card pile.
  `List` is the primary default with a dense sortable table (`Task`, `Stage`,
  `Steward`, `Priority`, `Revisions`, `Updated`), `Board` is a secondary
  full-width view with horizontally scrollable lanes, and live activity stays
  with the list view instead of crushing the board. The project rail also now
  has an explicit collapse toggle with remembered desktop preference instead
  of only collapsing as a hidden media-query side effect.
- The left rail now behaves like two intentional patterns instead of one
  broken compromise: on desktop, a collapsed rail can reveal its labels on
  hover/focus without being buried under adjacent surfaces; on smaller
  windows, the hamburger opens a full-height scrollable navigation overlay
  instead of a cramped side sheet.
- The `aside.rail` preview no longer gets to influence unrelated project
  header controls. The shell was previously coupling rail preview state to the
  top bar's layout and z-layer, which let pin/reveal behavior hide buttons in a
  different panel for no product reason. The rail is now treated as fixed app
  chrome below the header stack, while the project top bar keeps its own layout
  instead of shifting when the rail preview opens.
- Setup/meta-intake cards now obey `startReadiness` truth before rendering
  their primary action. If Guildhall already knows the next step is human setup
  (`Connect provider...`, `Load model...`, or another setup fix), Thread suppresses
  the Guildhall-run button and shows the setup action instead of offering a
  dead "let Guildhall keep setting this up" path.
- Coordinator/routing cleanup is now leaning harder on the agreed product
  model: setup/help/reference copy treats `coordinators:` as an internal
  routing map for one local coordinator, not a user-managed roster. The
  project-map confirmation affordance now speaks in repo-structure terms
  instead of pretending the user is configuring review lanes by hand.
- Accepted-work landing now has a more honest runtime shape. Guildhall can
  read an explicit per-project `landingBranch`, defaults to the repo's current
  branch when unset, and the landing path now cherry-picks accepted task
  commits back onto that branch before optional push/PR handling. Legacy
  `merge_policy` settings still load, but the product/docs/runtime are moving
  toward `landing strategy` language instead of pretending parallel task
  worktrees are just fast-forward merges.
- Follow-up cleanup: Advanced Settings now exposes the two user-legible knobs
  that actually matter for this git story — `landingBranch` and
  `landing_strategy` — instead of leaving them buried in YAML and lever docs.
  At the same time, the ready checklist and setup/reference copy were scrubbed
  again so we stop teaching "Project map" / "draft coordinators" language
  after the product pivot to one local coordinator with internal routing.
- Remaining cleanup pass tightened the user-facing routing story again: the
  Facts screen and Settings now link to `/settings/routing`, not
  `/settings/coordinators`, the dashboard/docs stop describing a coordinator
  board as part of the normal product surface, and setup/thread test fixtures
  now reflect inference-first confirmation instead of "pick project areas".
- The stop-summary semantics are also less misleading now. When a project is
  full of `import_draft` tasks waiting on human review, Guildhall no longer
  reports `No actionable tasks remain`; the idle summary classifies those as
  human-blocked draft review work so the shell can say what is actually true.
- Project-unblock cleanup pass: Guildhall now ignores stale historical intake
  questions when the underlying task is already terminal, and it also ignores
  old meta-intake "pick project areas / review lanes" questions once a valid
  inferred routing draft already exists on the task. This keeps old task data
  from blocking Thread/Inbox after the coordinator-model pivot.
- Live project data cleanup followed immediately after that guardrail:
  `looma-knit` had a completed workspace-import task still carrying obsolete
  unanswered questions, so the import-draft shaping queue was being suppressed;
  those stale questions were cleared. `fair-labor-license` had an obsolete
  meta-intake question plus no inferred routing written back yet; that project
  now has approved internal routing, inferred levers, and verified bootstrap
  recorded from real commands (`pnpm install`, `pnpm --dir frontend build`).
- Service-model cleanup is now removing the last "project-launched Guildhall"
  lie. `guildhall serve` still uses `process.cwd()` as a one-shot initial
  selection hint so the browser can land on that project's Thread or setup,
  but the running process and `~/.guildhall/service.json` no longer treat that
  folder as the service identity. `guildhall start` is now explicitly
  fleet-level: it starts the single background service on `7777` and leaves the
  UI on Projects instead of binding the daemon to the invoking folder.
- Facts cleanup: `Identity -> Edit` was pointing at generic Settings instead of
  the actual identity editor in Advanced Settings, and Environment was
  overstating a single bootstrap package manager as though it described the
  whole repo. Facts now links identity edits to Advanced Settings and reports a
  detected package-manager list across the repo so mixed ecosystems like
  `pnpm` + `NuGet` read honestly.
- Facts spacing cleanup landed: the Facts screen now uses shared Stack rhythm
  for the heading block and the card column instead of mixing wrapper gaps,
  header margins, and one-off card spacing. The `Do this next` handoff and the
  Facts cards now read as one vertical system on the live `7777` page.
- Fair-labor-license first-task intake is less self-defeating now. Guildhall
  no longer treats a broad kickoff question like `What should this first
  starter task focus on?` as load-bearing once it has already written a
  concrete `spec_review` draft with acceptance criteria. Thread and Inbox now
  ignore that stale question shape, and the spec-agent prompt now tells the
  agent to choose the strongest repo-backed interpretation of a starter task
  ask instead of bouncing the user back into a generic scope-selection loop.
- Live walkthrough follow-up on `2026-05-11`: `t-minus-t` is now in a clean
  post-setup state — Thread shows one `ready` task as `Approved and queued for
  work`, Inbox only has low-severity lever-default nudges, and the next move
  is obvious. `looma-knit` is still not humane: Inbox says `Give the project
  direction` while Thread's active turn is an import draft, and the Thread
  feed expands into a giant wall of 80 pending `import_draft` cards. The next
  fix there is structural, not copy: setup gating should outrank the draft
  queue when project direction is still missing, and imported drafts need a
  denser grouped/threaded representation instead of one pending turn per draft.
- Orchestrator cleanup now matches the Thread/Inbox cleanup for first-task
  intake. Once a task has a concrete `spec_review` draft with acceptance
  criteria, Guildhall prunes the obsolete `What should this first starter task
  focus on?` question from task state itself instead of merely hiding it in
  the projection layers. Legitimate spec-review questions still remain.
- Feedback-path cleanup on `2026-05-11`: human follow-up buttons can no longer
  be note-only dead ends. Thread/drawer feedback that preserves the current
  task phase now still appends to `memory/exploring/<task-id>.md`, so the next
  Guildhall start can actually consume that guidance instead of silently
  dropping it into task notes.
- Start-story cleanup on `2026-05-11`: the project-level topbar control now
  needs to teach project advancement, not unattended automation. User-facing
  labels have been reduced from `Start run` / `Stop run` to `Start` / `Stop`,
  and one-task actions are being reframed as focused advancement rather than
  generic "runs."
- Left-rail shell hardening: the project shell now stretches the rail/main
  columns explicitly as viewport-sized shell blocks instead of relying on
  fragile percentage-height propagation, so short content should no longer
  shrink the rail below the visible page height.
- Project-direction draft copy no longer leaks inference notes into the
  editable brief itself. The setup textarea now starts from the strongest
  README-derived project sentence it can infer, while the "this is editable"
  guidance stays in the surrounding setup card instead of saying things like
  `From the README...` or `Guildhall should treat...` inside the user's brief.
- Agent-question state now survives refreshes and duplicate asks better.
  Unsubmitted Thread answers persist as per-question draft state instead of
  living only in browser memory, the `post-user-question` path now refuses to
  append a duplicate unanswered question with the same prompt/options, and the
  Thread projection defensively collapses old duplicate question records so one
  bad task state does not render two identical cards forever.
- Spec-revision queue cleanup on `2026-05-11`: when a starter task already
  has a concrete spec draft plus the user's latest answer, Thread should stop
  pretending that state is generic intake. Queued revision work now projects
  as spec-phase `Guildhall next` work, hides the intake checklist, and derives
  a human-readable title from the draft summary instead of repeating the old
  placeholder `Draft a first starter task...` title.
- Task-drawer follow-up on `2026-05-11`: `Review draft...` must open the draft,
  not the same `Now` card the user already sees in Thread. The drawer now
  defaults to the Spec tab for queued spec-revision states so opening details
  lands on the actual draft content.
- Worktree default correction on `2026-05-11`: Guildhall should not quietly
  default new projects into shared-checkout execution. `worktree_isolation`
  now defaults to `per_task`, `fair-labor-license` was corrected off the old
  inherited `none` setting, and the orchestrator harness now pins its own
  intended isolation mode explicitly so runtime tests no longer depend on the
  product default.
- Agent-question hierarchy cleanup on `2026-05-11`: question cards were
  over-signaling everything at once. `Needs you`, `Now`, and `Choose one`
  were all chip-styled with the same warn color, which made ownership,
  temporal state, and input mode look equivalent. The fix is to keep real
  task state chips grouped in the card header, demote question mode to a quiet
  eyebrow label, shrink the question prompt copy, and lighten the option rows
  so the question reads like a decision, not a stack of nested alert panels.
- Lever invariant enforcement on `2026-05-11`: `concurrent_task_dispatch:
  fanout_N` is now a hard error when `worktree_isolation` is `none`. The
  invariant is enforced in lever load/save validation, `/api/project/start`
  now returns a clear `invalid_lever_combo` error instead of drifting into a
  broken run, and Advanced Settings surfaces the mismatch inline if an older
  project file still carries the bad combination.
- Looma/Knit imported-draft shaping no longer round-trips back to "needs
  shaping" after the user explicitly hands a draft to Guildhall. The
  `shape-draft` path now records a durable shaping-request marker on the task,
  imported-draft normalization refuses to collapse those promoted drafts back
  to `import_draft`, and the drawer start path now leaves a toast breadcrumb
  if Guildhall starts and immediately stops with a concrete reason.
- Looma/Knit subrepo bootstrap hardening on `2026-05-12`: task worktrees that
  point at a subproject (for example `looma-knit/knit`) can no longer blindly
  replay workspace-root bootstrap commands like `cd knit && pnpm install`.
  Guildhall now rewrites workspace-scoped bootstrap/gate commands relative to
  the task project root before the worker bootstraps the worktree, so the
  coordinator can advance past the bogus `cd knit` failure and reach real task
  work again.
- Agent context hardening on `2026-05-12`: the coordinator/worker prompt now
  carries the task's current blocker directly in the task summary instead of
  relying on the model to rediscover it from buried notes. That keeps retries
  task-scoped and gives each specialist more durable local context about what
  just failed and what should change next.
- Bootstrap runner CI hardening on `2026-05-12`: worktree bootstrap commands
  now run with `CI=true`, which fixes pnpm's non-TTY install abort inside
  task worktrees (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Looma/Knit
  now gets past the bogus install wrapper failure and reaches real spec/task
  decisions instead of dying in setup.
- Project activity ticker pass on `2026-05-12`: project pages now get a slim,
  always-on bottom ticker driven by real project events plus current run state,
  and project cards get a compact matching activity strip. The goal is to make
  "alive, waiting, blocked, or idle" legible at a glance without turning the
  UI into a noisy console.
- Thread stale-live cleanup on `2026-05-12`: a stopped project could still
  project an old task-level event stream as `Guildhall working` even though
  the coordinator was no longer running. Thread now suppresses task `liveAgent`
  hints when the current run is stopped, while still showing the recent
  activity history for context.
- Imported-draft duplicate cleanup on `2026-05-12`: when a user explicitly
  asks Guildhall to shape an imported draft and that draft is an obvious
  duplicate of already-finished work in the same subproject/domain, the
  `shape-draft` path now shelves it immediately as `duplicate` instead of
  sending it back through another spec pass.
- Project-shell/mobile cleanup on `2026-05-12`: the project rail should stay
  expanded until a genuinely narrow viewport instead of collapsing into mobile
  mode too early. The shell now keeps the side menu open down to a narrower
  breakpoint, adds a centered top-bar project title so the current project
  stays visible in compact layouts, drops the old all-caps treatment, and
  humanizes generated names from folder/package slugs into sentence case.
- Worker resume targeting hardening on `2026-05-12`: `t-minus-t` exposed that
  likely-target inference was resolving ambiguous spec paths like
  `typescriptToJsdoc.ts` against the repo root instead of the real tracked
  files under `packages/converter/src/...`. Likely target inference now
  resolves ambiguous suffixes against the actual repo tree and also picks up
  success-metric file names from the product brief, so resumed workers point
  at real source/test files and dirty-file progress can match those targets.
- Handoff-checkpoint read latitude on `2026-05-12`: once a worker checkpoint
  said "move to review", Guildhall was forbidding even one scoped source read
  pass to verify that the checkpoint was still valid. The engine now allows a
  single likely-target read-only follow-through pass on stale handoff
  checkpoints before re-tightening, which gives the worker enough room to
  sanity-check real implementation state without reopening broad exploration.
- Review-handoff recovery hardening on `2026-05-13`: Fair Labor License
  exposed a second flavor of the review validator bug. Even after the worker
  persisted a valid self-critique, the task could stay blocked under a
  `gate_hard_failure` summary that still claimed the review transition tool
  was broken. Explicit project restart now treats that stale validator-failure
  block the same way as the older review-handoff tool loop and reopens the
  task cleanly.
- Checkpoint-next-step realism on `2026-05-13`: `t-minus-t` showed that
  Guildhall was writing over-eager worker recovery checkpoints that told the
  worker to hand off for review just because some files had changed, even
  though focused verification was still failing and no self-critique existed.
  Recovery checkpoints now stay implementation-focused until a structured
  self-critique actually exists, which should stop workers from falling into a
  fake handoff loop while the task still needs real code/test repair.
- Placeholder checkpoint cleanup on `2026-05-13`: Looma surfaced a nastier
  variant where an old worker checkpoint literally persisted `nextPlannedAction:
  "None"`. Guildhall was then treating that placeholder as a real mutation
  checkpoint, blocking reads and rendering a bogus "latest step" hint. Runtime
  checkpoint consumers now treat placeholder values like `None` / `null` /
  `n/a` as empty guidance instead of enforcing or displaying them.
- Cross-task checkpoint contamination on `2026-05-13`: Looma's
  `task-import-kj0cyz` was being resumed with checkpoint intent and touched
  files from the earlier `task-import-189j8he` version-diff task because
  long-lived agents merged new `current_task_*` metadata on top of stale
  task-scoped keys. `QueryEngine.loadToolMetadata()` now clears the previous
  `current_task_*` snapshot whenever a new `current_task_id` is loaded so a
  resumed task cannot inherit another task's checkpoint, touched files, or
  self-critique flags.
- Explicit referenced-test targeting on `2026-05-13`: after the metadata leak
  was fixed, Looma still re-blocked because the coordinator could not find the
  already-existing `web/tests/unit/composables/use-collections-auth.test.ts`
  baseline file. Our likely-target inference was discarding backticked
  `.test.ts` references unless they appeared on an "actionable" line, so the
  existing auth test never showed up in task context. `resolveLikelyTaskFiles()`
  now keeps explicit backticked test/spec file references, which should stop
  this exact false `spec_ambiguous` escalation shape.
- Worktree install isolation on `2026-05-13`: Looma exposed that Guildhall's
  task worktrees were pre-symlinking both root and package-level
  `node_modules` back into the base repo. That made `pnpm install` inside the
  task worktree mutate the source checkout's package links, and Vitest then
  resolved `@nuxt/test-utils` back outside the worktree and failed before any
  real task work could continue. Task worktrees now prune stale
  `node_modules` symlinks instead of creating them, so bootstrap/install can
  create a task-local dependency graph and keep test/runtime resolution inside
  the isolated worktree.
- Mutation-checkpoint guidance on `2026-05-13`: `t-minus-t` showed that a
  worker with a resume checkpoint plus authoritative verification commands
  could still get trapped in vague "rerun focused verification" nudges and
  drift back into file reads. Mutation-checkpoint nudges now surface the exact
  authoritative shell commands when they exist, so resumed workers get a
  concrete next verification step instead of an abstract instruction.
- Verification follow-through on `2026-05-13`: once `t-minus-t` actually ran
  the authoritative checkpoint verification commands, Guildhall was still
  cutting the worker off before it could inspect the concrete failing source
  and test files in the same recovery lane. After an authoritative
  checkpoint-scoped verification command runs, Guildhall now grants a bounded
  read-only follow-through window so the worker can inspect the real failing
  implementation/test files before being forced into a mutation or
  escalation.
- Resumed verification support-file latitude on `2026-05-13`: `t-minus-t`
  also showed that resumed workers sometimes need to inspect adjacent helper
  files before they can safely rerun verification, even when the last
  checkpoint was already implementation-focused. The checkpoint guard now
  distinguishes between broad drift and narrowly scoped support-file reads, so
  resumed workers can inspect likely-target companion files without reopening
  general exploration or tripping the mutation-checkpoint blocker again.
- Projects-home mobile scroll on `2026-05-13`: the projects page was rendered
  inside the fixed app shell without claiming its own scrollable body, so at
  smaller/mobile widths the lower project cards were clipped and unreachable.
  `ProjectsShell.svelte` now owns a real height-bounded body with `overflow-y:
  auto`, which restores vertical scrolling for the projects list inside the
  app frame.
- Durable resume-context checkpoints on `2026-05-13`: long-running worker
  tasks were still restarting with only `nextPlannedAction` and touched files,
  so they lost the narrower picture they had already earned. Recovery
  checkpoints now persist a structured `resumeContext` with authoritative
  verification history, companion files, a working hypothesis, and the safe
  next mutation surface, and resumed workers get that context back in both the
  prompt and task-scoped metadata.
- Shared-checkout ownership on `2026-05-13`: tasks that ran with
  `worktree_isolation: none` were still ending with a passive "merge skipped"
  record even when Guildhall itself had left dirty edits behind. Guildhall now
  checkpoints those shared-checkout edits into a task branch before marking
  the task complete, and the git driver resolves the true git toplevel for
  nested project paths so repo-root Guildhall state files do not poison
  cleanliness checks or get swept into the checkpoint commit.
- Fair Labor License review-handoff recovery on `2026-05-13`: after durable
  verification history started persisting in checkpoints, FLL still got stuck
  because the review handoff guard only trusted same-run verification evidence
  and the coordinator did not recognize the newer blocker wording
  (`Task blocked from transitioning to review despite passing all
  verification`). Guildhall now counts durable checkpoint verification history
  toward review handoff on resume, and the coordinator reopens that stale
  blocker family so `task-003` returns to `in_progress` instead of stopping the
  whole project as terminal.
- Recovery checkpoint mutation-surface ranking on `2026-05-13`: resumed
  `t-minus-t` work was still inheriting a misleading "safe next mutation
  surface" because recovery checkpoints simply kept the first touched files,
  which often put `.gitignore` and `package.json` ahead of the actual
  converter source/tests. Recovery checkpoints now rank test and source files
  ahead of repo metadata before storing the mutation surface, so resumed
  workers get pointed back at the real implementation/test seam instead of the
  repo scaffolding.
- Mutation-checkpoint nudge alignment on `2026-05-13`: even after the recovery
  checkpoint stored a better safe mutation surface, the runtime's strict
  mutation-checkpoint nudge was still reading the older raw `filesTouched`
  order, which could keep telling the worker to mutate repo metadata before
  the actual code/tests. `run-query` now prefers the checkpoint's safe
  mutation surface when it demands the next exact mutation, so the guard and
  the checkpoint finally agree on the same converter files.
- Verification-backed reread allowance on `2026-05-14`: resumed `t-minus-t`
  work could rerun the focused failing test, then immediately get rejected for
  rereading the exact checkpointed source file it needed to patch next when
  that read came back through the project-root path instead of the worktree
  path. `run-query` now keeps the verification-backed follow-through window
  active for checkpoint-scoped reads tied to that recovery action, so the
  worker can inspect the focused mutation file once before making the next
  edit instead of falling into an empty-turn/read-file refusal loop.
- Repeated checkpoint blank-turn handling on `2026-05-14`: `t-minus-t`
  showed the worker could receive the exact mutation/verification nudge, then
  answer with more prose and no tool call until the model turn quietly stopped.
  `run-query` now emits an explicit checkpoint no-progress status after the
  checkpoint no-tool nudge limit is exhausted, so the coordinator can see that
  the agent failed to act instead of treating the stop as an ordinary empty
  response.
- Cross-turn checkpoint no-progress handling on `2026-05-14`: live replay
  then showed the coordinator could still restart a fresh worker pass after
  each checkpoint blank turn because old dirty task files were counted as
  progress every time. The orchestrator now treats the explicit checkpoint
  no-progress stop statuses as no progress even when stale dirty files remain,
  so repeated blank or read-only-refusal checkpoint passes escalate instead of
  spinning forever.
- Live `t-minus-t` replay on `2026-05-14`: after rebuilding and restarting
  the service, `task-003` no longer spun forever in the checkpoint lane. The
  first checkpoint no-progress pass returned as `in_progress -> in_progress`
  with no recovery checkpoint rewrite, the second pass escalated
  `esc-task-003-9` (`Worker made no visible progress after 2 passes.`), and
  the project shut down truthfully with `2 done, 1 blocked`. This is not the
  0.5 unattended-completion proof yet, but it closes the silent-spin failure
  mode that was hiding the real blocker.
- Autonomous checkpoint remediation on `2026-05-14`: a truthful block is still
  too early for unattended operation when Guildhall has a durable checkpoint
  and the recovery action is non-destructive. Repeated checkpoint
  no-progress stops now get one coordinator-owned remediation attempt before
  human escalation: Guildhall records a `restart_from_checkpoint` decision,
  resolves a scoped `stuck` issue, resets the worker conversation, and resumes
  the task from the latest checkpoint. If the worker repeats the same
  no-progress pattern after that single reset, the task escalates normally.
- Live autonomous remediation replay on `2026-05-14`: after resolving the
  previous `t-minus-t` block for a clean replay, tick 2 used
  `coordinator-remediation` instead of escalating immediately. It wrote
  `memory/DECISIONS.md` with `Remediation: restart_from_checkpoint`, resolved
  a scoped `stuck` issue on `task-003`, reset the worker conversation, and
  resumed the task. The worker repeated the same read-only/no-tool drift after
  that one recovery attempt, so tick 4 escalated `esc-task-003-10` and the
  project shut down truthfully. This proves the remediation loop now exists,
  but `t-minus-t` still does not satisfy the 0.5 unattended-completion proof.
- Nested worktree verification command scoping on `2026-05-14`: FLL proved
  that the verifier was still handing nested tasks commands that only worked
  from the task subdirectory, while shell/gate execution defaulted to the
  isolated worktree root. Task gates now rewrite nested package commands into
  worktree-root-safe forms such as `pnpm --dir frontend build` and
  `pnpm --dir frontend exec tsc --noEmit`, and shell/run-gates remap stale
  main-checkout cwd values into the matching worktree paths.
- Stale checkpoint vs fresh reviewer feedback on `2026-05-14`: after FLL
  passed verification, the Security Engineer requested a new dashboard
  middleware fix, but the worker was still constrained by an older checkpoint
  about `useAuthSession.ts`. Newer reviewer feedback now invalidates the
  checkpoint next-action, and likely-target detection includes recent reviewer
  file references, so the worker can patch the new review target instead of
  being forced back to an obsolete mutation surface.
- Landing hygiene on `2026-05-14`: FLL reached `done` but the first
  cherry-pick tried to land Guildhall runtime files (`guildhall.yaml`,
  `memory/**`) from the task branch and collided with local runtime state.
  The git driver now lands only meaningful product paths from a task branch,
  ignores Guildhall runtime state during cherry-pick landing, and uses
  `--no-verify` for the generated landing commit so unrelated repo hooks do
  not block an accepted task.
- Superseded merge-fixup cleanup on `2026-05-14`: after the corrected FLL
  landing succeeded, the old merge-conflict fixup task from the failed
  landing attempt remained runnable and was picked up. Successful parent
  landing now shelves open `parent-fixup-*` tasks as duplicate/superseded, so
  stale fixups do not keep a completed project artificially active.
- Live FLL completion replay on `2026-05-14`: after the fixes above and one
  state repair for the previously-created stale fixup, Fair Labor License
  reached `3 done, 0 blocked, 1 shelved` and shut down with `all_terminal`.
  This is the first real project-flow proof in this loop: work moved from
  implementation through review, gate check, landing, and terminal shutdown
  without a remaining active/blocking task.
- Looma/Knit import-draft triage on `2026-05-15`: the 75-draft wall was not a
  valid review queue. The importer had flattened nested support bullets,
  duplicated component-roadmap/audit lines, and treated `PROJECT_STATE.md`
  `Current Focus` framing as backlog. The detector now keeps nested
  explanatory bullets as context, preserves named missing primitive children
  as task candidates, routes Current Focus to context, and dedupes
  high-overlap `planning-docs` echoes across files. Current Looma/Knit state
  was reviewed in place: 33 support/duplicate/context drafts were shelved with
  explicit `import-draft-review` notes, leaving 42 gated `import_draft`
  candidates for human shaping rather than auto-promoting anything into the
  runnable queue.
- Release-gate cleanup on `2026-05-17`: the 0.5.0 pre-publish run exposed
  stale tests around project-scoped mutating APIs, optional `blockReason`,
  task-bootstrap metadata, and temp-workspace git-driver assumptions. The
  suite now passes with explicit project ids on mutating route tests,
  in-memory git drivers for lifecycle-only fixtures, and shared gate-command
  authority moved into core so the engine no longer imports from tools.
- Release artifact truth on `2026-05-17`: the curl installer no longer depends
  on an undocumented/manual asset assumption. A tag-triggered GitHub Actions
  workflow now builds the macOS package on a macOS runner, uploads
  `guildhall-macos.tar.gz` and `guildhall-macos.tar.gz.sha256` to the GitHub
  Release, verifies the checksum in the installer before unpacking, and the
  quick-start docs explain both latest and pinned installs.
- Release detector fallback on `2026-05-17`: the workspace-import learning
  endpoint tests could fail in release environments where `rg` was unavailable
  or returned no file list, because nested planning-doc detection silently
  returned no `sourceGroups`. `planning-docs` now falls back to a deterministic
  Node filesystem walk for Markdown files, preserving Looma/Knit nested
  roadmap detection without making release tests depend on ripgrep.
- Release package deploy compatibility on `2026-05-17`: the first real
  `pnpm release 0.5.0` attempt reached macOS packaging and failed because the
  active pnpm rejected `deploy --legacy`. The packaging script now starts with
  the portable `pnpm deploy --prod` form and only retries with `--legacy` when
  pnpm explicitly reports the v10 non-injected workspace requirement, clearing
  the partial deploy target before retrying.
- Docs IA and route-contract alignment on `2026-05-17`: the VitePress guide
  was reworked from a new-user information architecture perspective. The
  getting-started path now starts with short journey pages for new projects,
  existing projects, first task sets, and many-project operation before
  sending readers into deeper reference material. The UI-reference nav no
  longer renders as accidental Markdown list buttons, and docs were checked
  against current route/provider/task-drawer code. During that audit the
  Settings tab's project/config/setup calls were switched to `projectFetch`
  so project-scoped pages follow the same explicit `projectId` contract as
  the browser service.
- CLI surface simplification on `2026-05-17`: task mutation commands were
  removed from the shipped human-facing CLI (`intake`, `approve-spec`,
  `resume`, `meta-intake`, `approve-meta-intake`). The CLI now stays focused
  on service lifecycle, project registry/setup, and headless debug runs while
  task creation, approval, and interview flows remain in the browser UI.
  Added a CLI surface test to keep the smaller command list and help
  output intentional.
- Public docs/code audit on `2026-05-22`: the 0.7/Next docs were checked
  against the current CLI, app labels, config schema, Corpus Map behavior,
  and visible project workflows. Product-visible behavior stays documented in
  guide/reference pages; the HTTP route inventory was removed from public
  docs because browser backend routes are internal BE-to-FE implementation
  details, not a supported user/API surface.
- 0.5.1 release prep on `2026-05-17`: public docs no longer describe removed
  task-shaping CLI commands as active entrypoints, the runtime subsystem page
  now frames intake/meta-intake as dashboard-driven flows, and the pinned
  installer example/test now follows the package version so the release docs
  do not drift during the next patch release.
- Coverage baseline on `2026-05-18`: `pnpm test:coverage` now measures
  `src/**/*.{ts,svelte}` only, excluding test files and declarations. The
  current honest baseline is intentionally low because browser-rendered Svelte
  surfaces are counted but not covered by Vitest yet; the gate now prevents
  regression from that baseline instead of reporting packaged artifacts or
  pretending the repo already meets an 80% source-wide floor.
- Rendered UI coverage on `2026-05-18`: added the first repo-owned Playwright
  suite for the dashboard. It boots deterministic fixture projects on an
  isolated home/port, then checks mobile Projects scrolling, explicit project
  route opening, legacy `/project/thread` canonicalization, task-scoped
  questions, and answer-control vertical centering. The option rows now center
  the checkbox/radio mark with the option text instead of pinning the mark to
  the top of tall choices.
- Component coverage split on `2026-05-19`: Svelte components now mount inside
  Vitest through `@testing-library/svelte` and `happy-dom`, so UI components
  contribute real executed lines to `pnpm test:coverage` instead of only
  appearing in the denominator. The first component-level coverage targets the
  task-question affordance in `AgentQuestion.svelte`; browser-only truths such
  as scroll behavior and visual centering remain in Playwright.
- Guild coverage policy on `2026-05-19`: the Test Engineer persona now treats
  coverage as an explicit guild contract. Specs must name the declared coverage
  floor, the command that enforces it, and any intentional exemptions; UI work
  must split component-level state tests from real-browser layout/routing tests
  instead of hiding behind vague "best practices."
- PR gates on `2026-05-19`: added a minimal GitHub PR workflow for install,
  typecheck, help-doc sync, dependency-boundary linting, unit/integration
  tests, build, and rendered UI checks. The 90% source-wide coverage gate is
  represented by `pnpm test:coverage:90` and documented in the workflow as the
  command to swap in once the current 82.4% baseline reaches the guild target.
- Coverage push on `2026-05-19`: `pnpm test:coverage` now reaches the 90%
  source-wide line target with real added coverage around setup/provider flows, task-drawer
  approvals, Thread inline approvals/questions/load errors, project event
  streams, project-scoped fetch wrapping, search/gate helpers, intake modal
  creation and bug filing, project provider/model overrides, Settings
  bootstrap/identity/levers/design-system flows, Inbox agent-handled/dismiss
  flows, Projects start/stop/attach failure handling, Workspace Import source
  and task narrowing, ProjectView bootstrap/mobile/uninitialized states,
  drawer provenance/history/transcript/experts audit trails, SetupWizard
  validation/provider/meta-intake approval states, TaskCard navigation/status
  summaries, and the agent settings persistence tool. The last stretch added
  real endpoint, provider, session-storage, network/web guard, drawer checklist,
  suggestion, and tooltip behavior coverage instead of inert line-touching.
  The new IntakeModal tests caught a real shared `Select`
  binding bug; `Select.svelte` now updates its bound value in its explicit
  change handler. The expanded Thread tests also caught a real meta-intake
  control-flow bug where a "Create split proposal" button could render while
  still calling the generic project start endpoint; Thread now routes that
  completed meta-intake path to `/api/project/meta-intake/synthesize`.
  The `DoThisNext.svelte` coverage caught another real UI flow bug: when the
  highest-priority inbox item pointed at the current page, the banner hid all
  actions instead of showing the next actionable item. Latest verification:
  `pnpm test:coverage` passed with 2,415 tests and 90.00% lines, and
  `pnpm typecheck` passed.

## Active Path Display Audit

- [x] Normalize user-home project paths in visible UI to `~`, including
  Windows-style user profile paths in tests.
- [x] Keep product feedback issue drafts from pasting absolute user-home paths
  into GitHub.
- [x] Rebuild and retake the projects screenshot after the UI shows
  user-relative paths, then audit docs screenshots for `/Users/...` leakage.

Completion note on `2026-05-19`: Projects home cards, project attach/facts
surfaces, and product feedback issue drafts now pass user-home paths through the
shared `formatUserPath` display helper. The focused tests cover macOS, Linux,
and Windows-style `C:\Users\...` normalization to slash-separated `~/...`
display paths. The rebuilt Projects page was inspected in-browser with no
`/Users/...` or `C:\Users...` strings in the rendered DOM, then
`docs/assets/ui-audit/projects.png` was retaken from that page. The later
0.7 docs refresh moved published references to
`docs/assets/ui-audit/0-7-0/projects.png` to avoid stale browser image caches.

Follow-up on `2026-05-19`: the Projects screenshot now has an AVIF sibling and
docs pages render it through `<picture>` with the PNG retained as fallback.

Navigation follow-up on `2026-05-19`: the docs sidebar should only change when
the reader intentionally changes top-level sections. Guide now stays focused on
journey and operating concepts; UI-specific pages live only under the top-level
Web UI reference section instead of being duplicated into Guide.

Navigation orientation follow-up on `2026-05-19`: Guide has at most one
section-jump link to the UI reference, marked with a jump icon. The top
navigation now has explicit active-match rules, and doc pages render
breadcrumbs so the active section is visible even when the top nav is collapsed
at narrower widths.

Public docs boundary follow-up on `2026-05-19`: internal design notes,
Superpowers plans/specs, and this live flow audit are excluded from the
VitePress source set. Public docs may use sanitized UI assets from
`docs/assets/ui-audit/`, but repo-local planning and audit notes should not be
published as product documentation.

Navigation simplification follow-up on `2026-05-19`: top-level docs nav now
uses reader-intent labels only: Get started, Guide, and Reference. CLI, app
pages, levers, subsystems, releases, and config schema pages live under
Reference instead of competing as separate top-level product surfaces, and the
app docs are labeled as Guildhall app pages rather than UI reference.

Guide IA follow-up on `2026-05-19`: first-run pages are isolated under Get
started, while Guide is organized around product domains: Projects, Tasks,
Specs & policy, and Concepts. Get started breadcrumbs now identify those pages
as Get started rather than Guide, so setup, day-to-day operation, and technical
reference no longer reuse the same orientation labels.

Reference IA follow-up on `2026-05-19`: Reference now uses one stable sidebar
across app pages, CLI pages, config/state pages, levers, subsystems, and
releases. Clicking within Reference should not collapse into a tiny sub-nav or
swap the whole left rail without breadcrumb context.

Deep reference follow-up on `2026-05-19`: levers, subsystems, and releases are
still allowed to use their own detailed sidebars, but Reference marks them as
section jumps and breadcrumbs keep them under the Reference top-level context.

Content polish follow-up on `2026-05-19`: public docs copy was swept for
meta-explanatory scaffolding such as "this page exists" and "use this path."
Guide, first-run, app, dashboard, and workspace intros now lead with the
product behavior or user job instead of explaining the page's purpose.

Release-prep follow-up on `2026-05-20`: 0.6.0 docs were reconciled with the
current runtime surface before release. `docs/releases/0.6.0.md` now names the
construction substrate that actually landed in this line: clearer imported-task
brief language, compact crowded Thread rows, task-scoped context follow-ups,
the project memory check-in, readiness-label cleanup, and release packaging
proof. The construction manifesto now treats the larger planning/release-shaping
layer as 0.6.x follow-up instead of claiming it is fully landed in 0.6.0. The
pinned macOS installer examples in README and Quick Start now point at
`GUILDHALL_VERSION=0.6.0`, matching `package.json`. Verification completed:
`pnpm docs:check-help-sync`, `pnpm docs:build`, `pnpm typecheck`,
`pnpm model:bakeoff`, `pnpm lint:deps`, `pnpm test`, `pnpm build`,
`pnpm test:ui`, `git diff --check`, and
`pnpm release:dry 0.6.0 --allow-branch --allow-dirty` all passed. The dry run
built the npm tarball and macOS package artifact; it used the branch/dirty
overrides only because this was a release-prep branch with pending changes.

Thread source-context follow-up on `2026-05-20`: imported source references in
Thread cards now open an in-app Source note preview instead of pretending a
`file://` link is a useful app action. The preview endpoint is project-scoped
and rejects paths outside the project. The question context affordance is now a
visible secondary action with explicit copy about asking Guildhall to explain
the source note/current assumption before the human answers.

Task transcript follow-up on `2026-05-20`: task drawer Transcript now means the
actual exploring conversation, not just durable task notes. `/api/project/task`
returns `memory/exploring/<task>.md`, the drawer renders those system/agent
entries above task notes, and likely-target inference now avoids duplicating a
subproject folder when imported workspace-relative source paths already include
the project area name (for example `looma/docs/...` inside the Looma project).

Thread affordance polish on `2026-05-20`: source-note references keep the
green underlined link treatment because they open readable source content,
while task-title buttons no longer use a dotted underline hover. They now use a
subtle chip hover so navigation controls and document links do not look like
competing hyperlink systems.

0.8.0 rich artifact exploration on `2026-05-21`: captured the HTML-vs-Markdown
idea in `docs/design/html-artifacts-and-agent-ui-protocol.md`. The conclusion:
do not replace ordinary Thread/task prose with raw HTML, but do explore a
validated rich artifact lane for blueprints, design-system views, review
dashboards, diagrams, and bounded micro-editors. While auditing this, the
Markdown renderer was hardened because `marked` preserves raw HTML; current
plain Markdown now sanitizes generated HTML before Svelte renders it.

0.7.0 rich artifact guardrail seed on `2026-05-21`: added the first
non-visual `guildhall-html-v1` protocol in `src/protocol/rich-artifacts.ts`.
It validates required artifact metadata, rejects dangerous raw HTML, recognizes
only the starter `gh-checklist` / `gh-step` / `gh-decision` / `gh-option`
component tags, and compiles accepted agent output into a typed render-tree
summary. This does not render rich artifacts in Thread yet; the remaining
persistence, renderer, event, and browser-proof slices are specified in the
0.8.0 design note.

0.8.0 runtime isolation exploration on `2026-05-21`: captured the Podman
project-runtime idea in `docs/design/podman-project-runtime.md`. The current
bias is a Debian-based container per project, live-mounted host source, mounted
host `~/.guildhall` for all durable Guildhall state/evidence, host UI
supervision for lifecycle/ports/logs, an internal container service plus
external host service for brokered tool calls, human-approved extra directory
access, and explicit follow-up proof around macOS bind mounts, permissions,
credentials, nested container use, and dev-server browser access.

Live multi-project testing on `2026-05-21` surfaced a blocking context affordance
bug in Looma + Knit: the spec agent asked the user to choose "Next batch from M6
queue" without explaining what the M6 queue is or making the referenced
`PROJECT_STATE.md` context inspectable enough from the question card. Thread
now makes source references visibly actionable (`Open source note` with the
file name and path) and promotes the fallback from faint `Ask for context` copy
to a primary `Ask Guildhall to explain` action that keeps the question open.
The remaining agent-quality bar is still: project-jargon questions must include
an inline premise summary before the human is asked to choose.

Source-note preview hardening on `2026-05-21`: clicking an imported source note
could look frozen because Thread opened the modal only after the note request
returned and then rendered up to 96k characters through Markdown in one pass.
Thread now opens the source modal immediately with an `Opening source note...`
state, ignores stale responses after close/switch, and bounds the rendered
Markdown preview to keep the scroll frame responsive.

Workspace-import approval regression on `2026-05-21`: live font-something and
narrative-harness testing showed that approving an agent-curated import spec
could still behave like approving the raw detector output (font-something added
90 drafts from detector notes; narrative-harness marked the import done while
adding zero useful tasks). Added endpoint coverage that approves an existing
curated `task-workspace-import` spec with an empty request body and proves only
the curated YAML task/goal/milestone are imported.

Workspace-import schema hardening on `2026-05-21`: font-something also exposed a
half-success import bug where a malformed `tasks` YAML fence could be silently
dropped while valid goals/milestones were recorded and the import was marked
done. `approveWorkspaceImport` now rejects malformed YAML fences before changing
task state. The live font-something state was repaired from the 90 detector
drafts back to the curated six-task import, and narrative-harness was reapproved
from its valid eight-task curated import instead of staying as a zero-task done
import.

Spec fallback-question hardening on `2026-05-21`: narrative-harness exposed a
bogus owner-question generator case where process narration ("I'll now finalize
by..." and "required YAML fences for...") became Thread questions. Fallback
question inference now skips those operational checklist prompts. The live
narrative-harness meta-intake task was repaired by removing the two bogus
fallback questions and returning the saved spec to `spec_review`.

Work recent-progress scoping fix on `2026-05-21`: live navigation showed
commerce-project progress cards ("Amazon competitor...") while the app was on a
Looma/Knit route. The project files and Thread API were correctly scoped, so
the bug was stale `WorkTab` component state: it fetched progress once using the
current route project at mount time and did not reload when the rendered
project changed. `WorkTab` now fetches progress with the explicit `detail.id`,
resets to loading during project switches, ignores stale responses, and has a
regression covering project-switch progress isolation.

## Narrative Harness Product Walkthrough — 2026-05-20

Test target: `/Users/matthew/git/oss/narrative-harness`, opened through the
local 0.7 release-candidate build at `http://localhost:7777/projects/narrative-harness/thread`.

- [x] App header still shows `v0.6.0` while testing the 0.7 release candidate.
  This may be technically correct because `package.json` is not bumped until
  publish, but it makes the test session feel stale. Consider an RC/dev build
  indicator when running from an unpublished branch. Product decision on
  `2026-05-21`: this is fine for now because the header should reflect the
  package version until publish.
- [x] The setup checklist initially reads well, but after `Run checks` passes
  the next visible item becomes a blocked imported/setup task. The transition
  from successful environment verification to "Worker is stuck" feels abrupt
  and does not explain what Guildhall actually accomplished. Setup recovery
  cards now route to setup/readiness when that is the real blocker, and
  no-visible-progress copy describes the recovery path before the agent
  diagnostic.
- [x] Blocked task copy is too implementation-shaped for a product user:
  "Spec agent made no visible progress after 3 passes" and "Task remained in
  exploring with no saved spec, note, or status transition" are useful audit
  facts, but the card should lead with a plain recovery explanation and keep
  the internal reason secondary. Thread, Why Stuck, and Task Drawer now use
  recovery copy for this lane: useful context may exist, but Guildhall needs
  to retry or convert it into a durable draft.
- [x] The blocked task drawer has no recovery path beyond `Pause task` and
  `Put aside`. For setup/import failures it needs an obvious next action such
  as retry, ask for context, continue with a simpler scan, or convert the
  partial context into a manually editable brief. First pass: open
  escalations now surface `Retry blocker` and `Resolve blocker` in the drawer
  footer, and meta-intake human-judgment escalations default to retrying from
  transcript notes.
- [x] The remaining setup cards ("Let Guildhall inspect the repo", "Give the
  project direction", "Review existing work", "Create the first task") show no
  visible action controls. Clicking the card title did nothing. The cards need
  explicit buttons or a clearly clickable card treatment. Thread and Work now
  expose explicit setup/review controls (`Open setup`, `Open import review`,
  review/draft actions) instead of relying on hidden title clicks.
- [x] The top-level `Start` button appears clickable in the blocked/setup
  state, but produced no visible state change or explanation. If blocked tasks
  prevent starting, the button should explain that; if it starts a background
  attempt, the page should show the attempt. First pass: the top bar now shows
  a visible blocker pill beside the action buttons.
- [x] `New task` is disabled in this state, but the UI does not say why. This
  removes the obvious escape hatch when setup/import is blocked.
- [x] After import, `New task` remains disabled with only hidden title/aria
  copy: "Bootstrap the project first." The visible UI should explain what
  bootstrap step is required and offer a direct path to do it, especially when
  the bootstrap/setup lane is blocked. First pass: the visible blocker pill
  links to setup or readiness as appropriate.
- [x] The project setup route has the real recovery action (`Resume`
  meta-intake because the coordinator is paused), but Thread and Work do not
  route the user there. Disabled `New task`, blocked setup cards, and
  escalation banners should link to this setup recovery state when bootstrap is
  the blocker. Setup blockers now route to `/setup` when meta-intake is still
  pending and to readiness when setup is initialized.
- [x] Clicking `Resume` on the setup route did not visibly change the
  meta-intake state after several seconds. The page still showed
  "Coordinator paused", the same `LAST UPDATE`, and the same `No draft yet`
  output. Resume needs immediate feedback, error surfacing, or a visible
  running state if work was actually restarted. Resume now sets an immediate
  visible notice while the coordinator restart is requested and replaces it
  with success/error feedback.
- [x] The setup route labels the blocked meta-intake state as "Coordinator
  paused" and offers `Resume`, but backend state shows an unresolved
  `human_judgment_required` escalation. The page should name the actual blocker
  and route to escalation resolution or retry, not frame it as a paused
  coordinator.
- [x] Inbox `RESOLVE` for the meta-intake escalation only opens the task
  drawer. The drawer still has no resolve, retry, explain, or continue action,
  so the `RESOLVE` label overpromises and leaves the user stuck.
- [x] The escalation summary says the spec agent made "no visible progress",
  but the Transcript shows useful analysis: it identified Narrative Harness as
  a docs-only project and named the library-first / harness-prototype staging.
  The UI should distinguish "agent made useful observations but failed to save
  a durable draft" from "no progress", and offer to convert the transcript into
  a draft or retry from the last useful note. The recovery copy now makes this
  distinction explicit and the runtime reopens stale spec no-progress blocks
  into intake from preserved transcript notes.
- [x] `Put aside` on the blocked meta-intake drawer appeared to do nothing:
  the drawer stayed open, the task remained blocked, and no toast/error/saved
  state appeared. Destructive or state-changing controls now refresh project
  state, toast success, and close the drawer after shelving.
- [x] The Inbox housekeeping item `18 levers at system defaults` routes
  straight to dense Advanced settings. The review entry point should offer a
  digestible summary first: which defaults are fine, which few settings might
  matter for this project, and why the user would change them. Inbox now adds a
  short defaults digest before sending the user into detailed settings.
- [x] Advanced settings is not acceptable as a user-facing settings page in
  its current form. It exposes the internal lever registry almost raw:
  snake_case labels, monospace names, weak form structure, cramped typography,
  and rows of `SYSTEM-DEFAULT` tags. The page needs real setting groups,
  human-readable labels, short descriptions, current-value summaries, and
  friendly enum controls instead of making the user parse implementation keys.
- [x] Settings drifted back into primary project navigation and exposed its
  subsections in the rail. Settings is a utility destination: keep it pinned at
  the bottom of the project rail with a separator, and put Ready / Providers /
  Coordinators / Facts / Memory / Advanced navigation inside the Settings view
  where it can wrap naturally on mobile.
- [x] Lever settings need purpose-built controls. Enum values should render as
  segmented controls, selects, radios, or menus depending on option count;
  global/project inheritance should be a clear state ("Same as global" versus
  "Project override"); and destructive or high-risk settings should explain
  tradeoffs inline. The user should not need to know the YAML key names to make
  a sensible choice.
- [x] Settings typography and rhythm need a full pass. The page currently has
  little hierarchy between section titles, setting names, descriptions, values,
  provenance labels, and controls. It should read like a calm preferences
  screen, not a diagnostic table.
- [x] The `Needs you` page header and the `Do this next` banner do not have
  enough whitespace clearance from surrounding chrome/content. In the
  workspace-import flow the alert stack crowds the page title, making the top
  of the page feel visually jammed instead of calm and scannable.
- [x] Workspace import makes including reference notes tedious and hard to
  discover. Narrative Harness had 18 useful spec notes hidden under
  "Optional milestone and reference notes", and the only path was clicking
  `Use this source` one at a time. Add a bulk action such as `Use all 18
  sources`, make the optional/reference distinction explain itself, and clarify
  what including those sources changes in the import.
- [x] Workspace import Step 1 rendered an empty primary-source summary block
  when a project only had reference-only parts, leaving a large dead gap before
  `Show reference-only parts`. Empty layout sections should not reserve space;
  show the reference-only details directly after the intro when there are no
  task-bearing parts.
- [x] Import completion has contradictory next-step copy when no tasks were
  created. It says "Guildhall created 0 draft tasks" but still offers
  `Shape imported drafts in Thread`. When zero drafts exist, the primary next
  action should be something like `Use this context to create a first task` or
  `Go to Thread`, not shape nonexistent drafts.
- [x] Clicking `Shape imported drafts in Thread` from project-scoped import
  completion navigated to `/thread` instead of
  `/projects/narrative-harness/thread`, dropping the project name from the
  header. Project-scoped navigation must preserve the current project route.
- [x] The Thread import-complete banner repeats the zero-draft contradiction:
  "Guildhall created 0 draft tasks" is followed by "These drafts still need
  shaping" and a `Jump to first draft` button. Zero-result states need their
  own copy and controls.
- [x] `Jump to first draft` is a no-op when the import created zero drafts.
  Disabled or impossible actions should not be rendered as primary recovery
  actions.

## 0.7.0 unattended project recovery pass — 2026-05-21

- [x] Run another multi-agent user-testing pass with the main agent visible in
  the Codex in-app browser. The 2026-05-21 pass covered Looma + Knit, Fair
  Labor License, Font Something, and Narrative Harness. The main walkthrough
  visibly inspected Looma + Knit Thread/Release, Fair Labor License Thread,
  and Font Something Thread; subagents supplied read-only audits for the same
  projects plus Narrative Harness.
- [x] Load the shared UI package tokens before rendering shared package
  components. Live Looma + Knit Release testing showed the Release page
  falling back to raw text-like layout because `FrameCard`, `NoticeBand`,
  `SectionHeader`, and related package components referenced `--gh-*` tokens
  that the app bundle had not loaded. The app entrypoint now imports the UI
  package stylesheet before local tokens.
- [x] Make source-note failures visible instead of leaving the modal on
  `Opening source note...` forever. Narrative Harness testing found a source
  note modal stuck even though the backing endpoint could return content. The
  Thread source-note loader now clears the loading state and renders the
  bounded error path when a request fails or is interrupted.
- [x] Align Work task-count semantics with Thread. Looma + Knit and Narrative
  Harness testing showed Work counting `exploring` tasks as `agent-active`,
  while Thread correctly treated them as shaping/queued work. Work now counts
  only `in_progress`, `review`, and `gate_check` as agent-active and exposes
  `exploring` as a separate shaping count.
- [x] Release readiness should name unfinished work before design-system
  absence when the backlog is still large. Looma + Knit showed `18/96 done`
  but led with `Design system is not drafted yet`, hiding 38 unfinished
  nonterminal tasks. Release now prioritizes unfinished task work in the
  verdict reason, and keeps the design-system state in the summary/criteria.
- [x] Completed workspace imports should render a completed/imported-context
  summary or an explicit rerun mode. Narrative Harness currently opens
  `/workspace-import` as an unsaved active wizard even though
  `task-workspace-import` is done and imported drafts already exist. Covered
  by the current follow-up pass: completed imports now reopen as completed
  summaries instead of restarting the wizard.
- [x] Approved workspace-import specs must not drop task-like proposed work.
  Fair Labor License has a done workspace import and approved spec text with
  proposed next tasks, but the persisted task queue has only 3 done tasks and
  one shelved fixup. Guildhall should either materialize the approved tranche
  as imported drafts/proposed tasks or surface an Inbox recovery item that the
  import produced no runnable backlog. Covered by the current follow-up pass:
  completed import status is counted from the saved curated spec and task-like
  proposed work is preserved for review.
- [x] Release/readiness should account for Guildhall-owned dirty checkout
  residue on otherwise terminal projects. Fair Labor License reads caught up
  and release-ready, but the target repo still contains Guildhall-created
  metadata changes (`guildhall.yaml`, `memory/`, `.gitignore`). The UI should
  either explain that residue as safe bookkeeping or route it to cleanup.
  Covered by the current follow-up pass: release readiness now counts
  Guildhall-owned dirty checkout files as release blockers.
- [x] Start controls should explain import-draft review blockers before
  attempting unattended work. Font Something has six imported drafts waiting
  for review and no runnable tasks; the primary Start affordance should make
  that reason explicit instead of implying Guildhall can just continue.
  Covered by the current follow-up pass: project ticker copy and Start
  blocking now surface imported drafts as task briefs that need review.
- [x] Workspace/council readiness should distinguish workspace-shell checks
  from child-project gates. Looma + Knit has a real workspace/child-project
  contract, but root-level detected bootstrap metadata can still say package
  manager or gates are unavailable at the workspace root, which makes the
  healthy child setup contract look broken. Covered by the current follow-up
  pass: Settings exposes workspace/council child-project bootstrap contracts.
- [x] Looma + Knit shows `38 blocked, 40 shelved`, which is a terminal pile,
  not an unattended project. Diagnose the shared blocker, repair the runtime
  behavior that produced it, and re-run the project so useful work resumes.
  The live project now normalizes old excess `in_progress` tasks back to
  `ready` under serial dispatch and keeps only one worker-owned task active.
- [x] Looma-domain tasks are inheriting the workspace-level Knit bootstrap
  (`cd knit && pnpm install`) even though their task worktrees contain the
  Looma subproject. Task-local worktree bootstrap should only keep workspace
  commands that target the task project, and should fall back to that task
  project's own install/gates when the workspace commands point elsewhere.
- [x] Stale task-bootstrap blockers should be recoverable automatically once
  the effective task bootstrap passes; Start should not keep reporting
  `all_terminal` while a large set of Guildhall-created blocked tasks can now
  be safely reopened. Recovery now also retries blockers that were already
  rewritten to "project setup contract changed" after an earlier failed retry.
- [x] Add first-class workspace shape without forcing the concept into normal
  project setup: a workspace may contain child projects with separate paths and
  bootstrap/gate contracts, plus an optional council that coordinates how those
  projects influence each other.
- [x] Several previously-reopened Looma tasks were blocked on agent/tool
  context errors because immediate-resume instructions mixed main-checkout
  files with task-worktree files. Resume target files are now translated into
  the active task worktree before being shown to workers.
- [x] Existing Looma tasks that were already blocked by the old mixed-path
  prompts still need a recovery pass after the prompt fix; verify that one
  previously affected task can resume without raising another path-mismatch
  escalation. Fresh live proof on `2026-05-21`: `node dist/cli.js run
  looma-knit --max-ticks 1` reopened the old path-mismatch blockers into the
  runnable queue, normalized excess stale worker/spec claims, left Looma with
  `0 blocked`, and advanced one previously affected worker task through a real
  Codex tick without raising another path-mismatch escalation.
- [x] Thread phase sticky labels regressed after the fixed shell padding pass:
  labels pinned to the scrollport edge instead of the padded content edge.
  The shell page and Thread both contribute padding, so phase headers now
  subtract the shell/thread padding from the sticky inset instead of
  double-counting the gap.
- [x] Rework Projects home into a full-screen live-at-a-glance Guild hall
  dashboard. The page no longer renders project descriptions in overview
  cards, avoids ellipsized guild-member labels by using avatar icons with
  tooltips, uses icon/count metrics with accessible labels, widens project
  tiles to two columns on the desktop test viewport, removes ambiguous activity
  squares, and only animates guild avatars when a project run is actually live.
  Transient browser fetch failures now render as an explanatory service-restart
  message instead of raw `Failed to fetch`.
- [x] Let isolated task worktrees inherit explicit local runtime config.
  Guildhall now detects likely local config filenames such as `.env.local` and
  `appsettings.local.yaml` without reading their contents, asks during setup
  which ones may be copied, exposes the same newline-separated include list in
  Settings → Advanced, persists it under `worktree.include`, and copies those
  files/globs into task worktrees before bootstrap.
- [x] Keep worktree local-file includes project-scoped inside workspaces.
  Looma + Knit exposed the bug: parent workspace candidates like `knit/.env`
  would be saved as parent settings, then a Knit task would resolve them from
  the Knit project root and look for `knit/knit/.env`. Worktree includes now
  live on `projects[].worktree.include` for multi-project workspaces, Settings
  requires a child project selection before saving, dispatch reads includes
  from the task's resolved child project, and candidate discovery excludes
  files tracked by nested Git roots instead of matching example filenames.
- [x] Harden the project shell mobile/collapsed-rail layout. The in-app
  browser reproduced a stale/specificity failure where `rail-collapsed`
  left the main content in grid column 2 on a one-column mobile shell, crushing
  Thread into a narrow strip. `mobile-rail-mode` now explicitly forces a
  one-column grid, hides the rail, and places main content in column 1 outside
  the breakpoint cascade; verified at the user's 773px CSS viewport with a
  fresh in-app browser screenshot.
- [x] Standardize count badges on the Projects home `Needs you` badge
  geometry. Project-view status buttons and count-only chips no longer use
  floating red bubbles or separate circle sizing; counts now cap at `99+` and
  share the same inline pill shape used by the home action count.
- [x] Fix wrapped project action bar / Thread sticky alignment. The project
  action bar already lives as a real shell row, but Thread phase headers still
  used a negative sticky offset that double-counted the shell and Thread
  padding, tucking the header under a two-row action bar. Phase headers now
  subtract only the shell page padding so they pin to the top of the content
  scrollport without exposing a gap, and compact/detail timeline borders align
  with the phase header left edge instead of starting indented.
- [x] Fix Work list responsive layout at wrapped-toolbar widths. The Work
  table still clipped right-side columns on mobile/tablet widths, so task rows
  now switch to stacked scan cards up through 860px and keep Stage/Part/
  Priority/Revisions/Updated visible without horizontal overflow.
- [x] Regenerate the 0.7.0 Projects screenshot from representative fixture
  data. The first refreshed asset proved the cards were compact, but the
  screenshot still rendered only four all-paused projects in a single row and
  made the dashboard look like a broken flat line. The fixture now needs
  varied task states and enough projects to prove intrinsic cards wrap. The
  regenerated asset uses representative task states, stretches every overview
  row horizontally without vertical card stretching, and gives every
  per-project work-bar segment title/ARIA labels.
- [x] Split project-card selection from project navigation. Clicking the card
  now selects it and opens an in-page project details panel; only the explicit
  `Open project` action leaves the Projects & Workspaces dashboard.
- [x] Make Projects & Workspaces dashboard signals explainable. Aggregate
  metrics, color bars, legend dots, per-project work bars, activity bars,
  guild avatars, chips, action buttons, and project sparks now expose
  explanatory hover text/ARIA labels instead of relying on color alone. Project
  cards and the details panel also surface Guildhall's inferred development
  maturity state, such as Setup, Intake, Blueprint, Build, Inspect, Stable, or
  Mixed.
- [x] Make recovery cards actionable directly in Thread. A Narrative Harness
  user-test showed `Needs recovery` cards told the user to review durable
  worktree changes or restart, but exposed only `Add optional note` until the
  task drawer was opened. Recovery cards now show `Inspect recovery`, `Add
  recovery note`, and `Resume work` inline, and `Resume work` starts Guildhall
  scoped to that task.
- [x] Stop spec-agent completion narration from becoming fake owner questions.
  Fresh Fair Labor License and Font Something audit passes showed fallback
  recovery treating prose such as `Done — I took the durable blueprint steps`
  and `Posted a focused scope question` as choice-card prompts, then rendering
  implementation notes as if they were decisions for the user. The fallback
  parser now rejects completed-work and already-posted-question narration while
  preserving real `Pick one` / structured question recovery.
- [x] Tighten reviewer/worker recovery loop after Narrative Harness resume.
  Live retry from Thread successfully moved `foundation-schema-contracts` from
  `Needs recovery` to `In flight`, then to `review`, but reviewer fanout sent
  it back to `in_progress` and the worker kept producing no-change / empty
  reply ticks until the run was stopped at tick 23. The UI path is now
  discoverable, but unattended completion still needs a loop breaker that
  turns repeated reviewer-returned work into a concrete diff, checkpoint, or
  scoped blocker. Reviewer fan-out now routes repeated same-persona dissent
  through coordinator adjudication even under strict policy, and escalates as a
  scoped `review_worker_handoff_loop` if the same dissent returns after
  coordinator adjudication instead of bouncing worker/reviewer forever.
- [x] Extend the guild-glass treatment into project chrome and sticky phase
  bars. The Thread phase headers now use translucent glass, backdrop blur,
  reflected color highlights, soft internal etching, and light rounding while
  preserving the existing sticky offset and layout. The global app header,
  project toolbar, left rail, active rail stripe, and actions menu now share
  the same glass/chrome language so cards are no longer the only polished
  surfaces.
- [x] Replace sticky phase header flash with a real pulse. The live sticky
  header animation no longer snaps between a flat and glowing state at the
  midpoint; it now uses a slower breathe animation plus a translucent internal
  light layer so active sections feel alive without reading as an alert flash.
- [x] Give overlapping dashboard hero panels the same glass contract as other
  sticky chrome. The projects/workspaces hero now has translucent glass fill,
  backdrop blur, a soft lower edge, and local sticky z-index so content can
  scroll under it without looking like a hard opaque slab.
- [x] Strengthen project-card hierarchy on the dashboard. Project names now
  use the same larger display tier as dashboard metric labels, and project
  cards get a slightly stronger glass-card contract so they read as the
  primary sections instead of blending into the surrounding dashboard panels.
- [x] Fix dashboard tooltip behavior instead of adding tooltip noise. The
  shared tooltip now measures its bubble, flips/clamps placement inside the
  viewport, and keeps glass styling without allowing off-screen bubbles.
  Labeled buttons and visible legend text no longer spawn redundant tooltips;
  tooltips stay on compact visual-only signals such as icons, avatars, count
  metrics, work-mix segments, and sparklines.
- [x] Make home project details use the room in the drawer. Project details
  now show the full project summary instead of a cropped card blurb, use
  status/maturity chips and chip-like count pills, and surface current status,
  recently completed work, and the next likely work item from the same
  highlights used by project cards.
- [x] Give the shared side drawer a glass overlay treatment. Project details
  now sit in the existing side drawer with translucent glass fill, backdrop
  blur, soft reflected highlights, a lighter page scrim, and glass header/footer
  chrome so overlapping dashboard content remains visible without feeling
  blacked out.
- [x] Move learning/memory docs out of the task-only IA. The Guide now places
  Memory, learning, and recovery under How it works, the main How Guildhall
  works page explains how Guildhall learns reusable habits, and the memory page
  frames recovery as one use of the broader learning system instead of a task
  subsection.
- [x] Clarify blocked-task recovery actions and repair stale blocker state.
  Fair Labor License user testing showed the task drawer exposing `Retry
  blocker` and `Resolve blocker` as adjacent actions with unclear semantics,
  while `task-listings-discovery` still carried a stale `useAuth.ts`
  cross-task blocker after the underlying context-pollution bug was addressed.
  The drawer should separate utility actions, manual resolution, and the
  recommended recovery action; already-persisted stale blocker records must be
  repaired or auto-resolved instead of making the user rediscover fixed bugs.
  The drawer footer now separates utility actions on the left from
  `Mark resolved...` and the reason-aware primary recovery action on the right,
  the resolution modal explains the selected path, and the persisted FLL task
  was repaired back to normal intake with its false auth blocker cleared.
- [x] Add durable artifact IDs for checked-in project references. The live flow
  audit moved from public docs to `internal/audits/flow-audit.md`, but stale
  hardcoded references to `docs/web-ui/flow-audit.md` made the checklist feel
  missing. Guildhall now carries a checked-in `.guildhall/artifacts.yaml`
  registry with `artifact:flow-audit`, and AGENTS points to that ID instead of
  an absolute path. The next, lighter-weight follow-up is to resolve artifact
  IDs and warn on deprecated paths when Guildhall loads active agent context,
  rather than policing historical or generated docs in CI.
- [x] Keep the project topbar to one row at medium widths. The project chrome
  now keeps labels visible through medium widths, collapses labels behind
  tooltips only once the toolbar is genuinely tight, keeps status counts
  visible, and moves `New task` into the overflow menu on narrow widths. Added
  regression coverage for both the compact-label state and the overflow-menu
  handoff so the screenshot case does not drift back.
- [x] Hide stale operational receipts from user-question surfaces. Fair Labor
  License still had a persisted fallback question asking the user to choose
  which internal coordinator step happened (`Updated the product brief`, `Set
  task status to spec_review`, etc.). Runtime question visibility now treats
  these as operational receipts, so Thread, Inbox, approval gating, and task
  picking do not render or wait on them as owner decisions. Added regressions
  across Thread, Inbox, and orchestrator picking.
- [x] Clear the remaining Fair Labor License `useAuth.ts` cross-task blocker.
  `task-stripe-integration` still carried an active stale `blockReason` and
  unresolved scope-boundary escalation that forced the unrelated auth composable
  into a Stripe task. Repaired the project queue by resolving that escalation,
  reopening the task to `exploring`, and recording a state-repair note. The
  live Inbox no longer returns any `useAuth.ts` blocker items.
- [x] Add automatic stale internal-blocker repair. Guildhall now runs a cheap
  queue-health pass before Inbox/Thread projection and before orchestrator task
  picking. High-confidence internal/tooling blockers, such as cross-task path
  guardrails or stale source-file mutation requirements, are resolved and the
  task is reopened from its own scope. Ordinary scope questions remain blocked
  for the user instead of being auto-dismissed.
- [x] Deep-link real Inbox questions to the question surface and clarify
  `.guildhall/` ownership. Question notifications now target
  `/task/<id>?tab=current` so a legitimate "Answer question" action opens the
  Now tab with the answer affordance visible instead of dumping the user into a
  generic task drawer. The drawer honors that tab request even when the spec
  tab would otherwise be preferred. The project-local ignore helper now ignores
  only `.guildhall/config.yaml` and `.guildhall/worktrees/`, leaving
  checked-in Guildhall metadata such as `.guildhall/artifacts.yaml` trackable.
- [x] Promote `.guildhall/*.yaml` to the shared metadata lane. The config
  helper now applies one consistent project file policy: unignore
  `.guildhall/` and `.guildhall/*.yaml`, then ignore only local/private
  `.guildhall/config.yaml` and `.guildhall/worktrees/`. Artifact registry
  writes use that same helper instead of carrying a separate gitignore story,
  docs describe the split, and all registered local projects were repaired on
  disk with the same entries.
- [x] Normalize Thread brief decision buttons. Fair Labor License showed
  brief-confirmation actions as bespoke choice buttons with the affirmative
  action on the left and a dashed "No, change it" treatment on the right.
  Brief decisions now use the shared button primitive: secondary correction on
  the left, primary confirmation on the right, with no one-off dashed hover
  state.
- [x] Rewrite task-brief approval cards for human readers. The Thread brief
  card no longer asks "Is this what you want?" and then answers with
  "What it thinks you want." It now presents "Review this task brief" with
  Scope / Done when / Out of scope fields. Operational receipt text such as
  "Done — I persisted concrete progress with tools" is filtered out before it
  reaches the card, with the task title used as the fallback scope. The drawer
  Spec tab uses the same labels and filtering.
- [x] Remove the remaining double-heading smell from active question cards.
  The Thread question card no longer adds the generic "Question about this
  task" heading above the actual question component. It now says "Before
  Guildhall continues" / "N questions before Guildhall continues," while the
  nested question component owns the specific prompt and answer controls.
- [x] Replace repeated project-avatar filler tooltips. Home project cards no
  longer say every inactive avatar is "assigned or relevant." Each role avatar
  now explains the concrete project signal that made it appear: blockers for
  coordinators, draft briefs for spec, active tasks for builders, and blocked
  plus completed work for reviewers.
- [x] Add a stable role avatar palette. Dashboard and project-card avatars now
  use shared role tones instead of the same mint accent everywhere:
  coordinator violet, spec amber, builder mint, reviewer blue, gate green,
  human orchid, and system slate. The role-to-tone mapping lives in
  `avatar-palette.ts`, and the colors live in design tokens so future avatar
  surfaces can reuse the palette consistently.
- [x] Fix the `Start work` placebo path from Needs You/task drawers. Live FLL
  testing showed a ready task with an incomplete checklist offering `Start
  work`; targeted starts also returned a successful-looking response when the
  project was already running, because the supervisor dropped the requested
  task and returned the existing run. The drawer and Thread now label these
  cases as `Needs task brief` / `Review checklist` or `Queued for Guildhall` /
  `Already queued`, `/api/project/start` returns `409 run_already_active` for
  targeted starts while a run is active, inbox brief/spec actions deep-link to
  the task Now tab, and brief approvals are suppressed while a real unanswered
  question owns the task.
- [x] Tighten top-level start affordances for done-only projects. Project cards
  no longer show a `Start` action when every task is already done; idle new
  projects and blocked projects can still expose a start/recovery path, but
  stable completed projects do not pretend there is runnable work.
- [x] Separate real Needs You decisions from optional cleanup. The project
  inbox no longer duplicates a task's real unanswered question with a
  lower-priority spec-fill reminder. Low-severity task brief gaps now live
  under `Optional cleanup`, use `Review checklist`, and deep-link directly to
  the task Spec/checklist tab instead of implying a blocking owner decision.
- [x] Stop task-local run buttons from racing active project runs. Thread and
  task drawers now block targeted task starts while the project run is already
  active, show `Already queued` where a task is waiting for the coordinator,
  and treat `run_already_active` as an informational queued state rather than
  a scary duplicate error.
- [x] Fix Needs You navigation and optional-cleanup wording. Browser testing
  reproduced a rail click that visually selected `Needs you` but landed back
  on `/thread`; rail targets are now resolved at click time and covered by a
  regression test. Optional checklist cleanup rows also stopped saying
  `Missing ...` in the primary detail line, so non-blocking brief cleanup no
  longer reads like a hard human-input blocker.
- [x] Align grouped Needs You and paused-work state after the latest
  cross-project audit. The projects dashboard now counts the top-level
  `Needs you` badge as projects with attention, matching the grouped fleet
  inbox instead of summing every draft. Done-only projects read as `Stable`
  with no project-card Start action and no warning-shaped readiness chip in
  the project top bar. Work and Thread no longer call stopped in-progress
  tasks `agent-active`, `queued`, or `in flight`; they render as paused work
  until an actual project run is active again.
- [x] Finish the paused/queued vocabulary cleanup across cards, Thread,
  Work, and task drawers. Stopped projects with unfinished work now use
  `Paused` maturity and `Resume` instead of `Queued`/`Start`; blocked-only
  projects no longer show a project-card run button that implies the blocker
  will magically resolve. The project ticker says paused work instead of
  queued-to-resume, Work table rows label stopped `in_progress`/review/gate
  tasks as `Paused`, Thread phase grouping no longer leaves mixed stopped
  work under `In flight`, imported-draft CTAs say `Draft task brief`, and
  drawer `Copy link` is a real copy action rather than a misleading
  navigation link.
- [x] Surface blocked tasks even when the persisted task only has a
  `blockReason`. Font Something showed `1 blocked task` in project summaries
  but Thread and Needs You omitted it because no unresolved escalation object
  existed. Thread and Inbox now synthesize a recovery item from a blocked
  task's block reason, so blocked project state and actionable surfaces agree.
- [x] Rework docs onboarding around first-reader concepts. A new reader should
  not meet `guild hall`, `guild`, `agent harness`, `blueprint`, or unattended
  work claims as unexplained marketing fog. The homepage now defines Guildhall
  as a local AI agent harness, explains the name before using the metaphor,
  and states the real laptop/sleep constraint. The guide sidebar now puts
  Introduction, Core concepts, Start here, and How Guildhall works in the
  first-read path instead of burying concepts at the end.
- [x] Keep docs navigation inside the selected version family. Source docs keep
  canonical unversioned links so they become Current cleanly when 0.7 is
  published. Generated Next docs receive `/next` links during version prep, and
  shared theme helpers preserve `/next` or `/versions/<x>` while a reader is
  already inside that family. Version picker entries remain explicit escape
  hatches and are not rewritten.
- [x] Make the docs onboarding journey less dense and more reader-shaped. The
  homepage now acts as a lighter front door with short "why use it" lanes for
  developers, product-minded builders, and messy real projects. The deeper
  explanation moved into Introduction and Start here, including what problem
  Guildhall solves, why a developer would trust it, and how a non-coding
  project owner with clear product intent can use it without pretending to know
  the implementation.
- [x] Reframe the 0.8.0 intake spec around Pressure-Test Intake instead of
  shallow deep-intake fallback. The internal practices spec now describes an
  LLM operating contract for domain maps, inspect-first evidence gathering,
  one-question-at-a-time interviews, follow-up heuristics, domain closeout
  prompts, persistent intake state, active-domain context framing, and a
  completion bar for airtight specs.
- [x] Add the interviewer/producer pressure model to the 0.8.0 intake spec.
  The live interviewer owns the calm one-question-at-a-time conversation,
  while the producer challenges missed follow-ups, vague answers,
  contradictions, and premature domain closure before the intake moves on.
- [x] Capture the implementation bias for Pressure-Test Intake: start with a
  single agent plus an explicit producer self-critique step, but allow a later
  split into two agents or a reviewer pass if live evidence shows better
  results.
- [x] Add later-intake routing to the 0.8.0 Pressure-Test Intake spec. The
  `New Task` entry point can stay, but it now needs an intent branch that
  reflows release ideas like `0.9.0`, feature specs, bugs, investigations,
  memory candidates, notes, and concrete implementation tasks into the right
  intake lane before creating work.
- [x] Define practice/persona participation rules in the 0.8.0 practices spec.
  Practices and personas now match against structured task/project signals,
  record suggested/automatic/manual/suppressed decisions with reasons, and
  expose friendly `Used when...` / `Not used when...` summaries before raw
  predicate editing.
- [x] Add built-in Practice Designer and Persona Designer guardrail personas to
  the 0.8.0 practices spec. Practice Designer reviews proposed practices for
  reusable loops, scope, triggers, evidence, duplication, prompt cost, and exit
  criteria; Persona Designer reviews proposed personas for distinctive
  judgment, evidence needs, participation rules, rubric quality, overreach,
  duplication, and cost before activation.
- [x] Add user-requested persona assignment to the 0.8.0 practices spec.
  Automatic guild applicability remains the default, but users can add an
  extra task-scoped review lens for spec, worker, review, gate, or all relevant
  phases without removing automatically required reviewers.
- [x] Add persona roster preview to spec approval in the 0.8.0 practices spec.
  Specs now carry a planned persona roster with auto-selected, user-requested,
  and suggested lenses, phase labels, reasons, and a smooth add-persona path
  before work starts.
- [x] Remove ambiguous public-doc path references. Project/workspace-local docs
  now use `./...` for repo-root paths like `./memory/TASKS.json`,
  `./guildhall.yaml`, `./.guildhall/config.yaml`, and `./src/...`; global
  machine paths stay under `~/.guildhall/...`. The docs scan intentionally
  excludes generated `docs/current`, generated `docs/next`, and legacy
  `docs/superpowers` planning material.
- [x] Treat Core concepts as a glossary in the onboarding IA. The First read
  sidebar and guide overview now put the concepts page after the practical
  first-run path, while the homepage and quick-start page still link to it
  when vocabulary support is useful.
- [x] Freeze versioned docs navigation by version family. VitePress still uses
  one shared top nav shell, but `Current (v0.6.0)` and `/versions/0.6.0/`
  now receive the 0.6 sidebar IA for Guide, Reference, Web UI, CLI, Releases,
  and Subsystems, while `/next/` receives the 0.7/Next IA. Archived pages no
  longer inherit every current-source sidebar change.
- [x] Run a 2026-05-23 deep unattended-flow audit across registered projects.
  Six audit agents each took one registered project through the local 0.7.0
  service and pushed until Guildhall stopped, needed the user, or hit the
  audit timebox. `t-minus-t` and `commerce-project` correctly self-stopped as
  all-terminal projects, but their API/start affordance still briefly reports
  `running` and `startReadiness.canStart: true` despite zero actionable work.
  `font-something` started and stopped after about 24 seconds with only owner
  questions, import-draft review, and one Rust bootstrap blocker remaining.
  `fair-labor-license` ran about four minutes, shaped three tasks into owner
  questions, added a real Supabase credential/project-link blocker, and
  stopped with no runnable work. `narrative-harness` ran about thirteen
  minutes and made the strongest progress: one task moved to done, two specs
  became ready, one implementation advanced into review/gate-check, and one
  product task stopped on a scope question. `looma-knit` ran about thirteen
  minutes in an isolated worktree, changed `packages/editor/src/index.ts` and
  `packages/editor/src/floating-toolbar.ts`, ran lint/build/typecheck, then
  escalated on upstream `@looma/core` build/typecheck failures plus local
  floating-toolbar type/lint issues.
- [x] Follow up on the 2026-05-23 unattended audit failure modes. Repeated
  Codex-backed turns produced empty assistant messages after real tool work;
  Guildhall recovered with retries/checkpoints, but the loop was noisy and
  sometimes stale-looking in `/api/project/activity` or Thread. Specific UI/API
  follow-ups: hide or preflight `Start` for all-terminal projects instead of
  flashing `running`; keep Thread recent activity consistent with Timeline for
  immediate all-terminal start/stop runs; investigate activity/thread freshness
  during long worker loops; suppress fallback "questions" that are really tool
  receipts or output promises; verify why one Fair Labor License header showed
  `connecting` while APIs were healthy; and restart the served bundle before
  the next release smoke so the stale-server banner is not part of the signal.
  Implementation plan: `internal/plans/2026-05-23-flow-audit-followups.md`.
  Task 1 is covered in code and focused tests: all-terminal projects now report
  `startReadiness.code: all_terminal`, `POST /api/project/start` returns a
  synchronous stopped no-op with an all-terminal stop summary, and ProjectView
  plus Thread surface the finished-state message without offering Start.
  Task 2 is covered in code and focused tests: project tickers now label
  supervisor stops as a finished run while preserving the all-terminal detail,
  and Thread adds a recent run activity turn when an immediate start/stop run
  only emits supervisor-level events.
  Task 3 is covered in code and focused tests: `/api/project/activity` now
  attaches the latest supervisor event metadata to each in-flight task row as
  `lastActivityAt`, `lastActivityLabel`, and `lastActivityTone`, and the web
  project data helper preserves those fields for consumers.
  Task 4 is covered in code and focused tests: runtime question visibility now
  suppresses output-promise choice lists such as `I will draft the blueprint`,
  `I will update the product brief`, and `I will persist progress with tools`;
  Thread, Inbox, and orchestrator picking all share that predicate.
  Task 5 is covered in code and focused tests: after one ordinary retry and
  one conversation reset, repeated empty assistant replies with verified
  tool/file/checkpoint progress now write the recovery checkpoint and move the
  task into a resumable blocked state with the explicit reason `empty assistant
  reply after verified progress`; wire-event copy uses the calmer recovery
  checkpoint wording instead of repeating raw provider text.
  Task 6 is covered in code and focused tests: the web SSE status now
  distinguishes first connection from a dropped live stream, reports
  `reconnecting` only after a previously live stream errors, and restores
  `live` on the next open or message so the header shows connected,
  reconnecting, or connecting without collapsing those states.
  Task 7 is covered in release-smoke discipline: `pnpm smoke:release` checks
  `/api/stale-server` and `/api/version` before browser release smoke, and the
  runtime now exposes `/api/stale-server` as the freshness preflight used by
  the release checklist.
- [x] Before release smoke, restart the served bundle and verify
  `/api/stale-server` reports `stale: false`; do not treat browser findings as
  release signal while the stale-server banner is visible or
  `pnpm smoke:release` fails. Verified on `2026-05-23`: rebuilt with
  `pnpm build`, restarted the background service with `node dist/cli.js stop`
  and `node dist/cli.js start`, then `pnpm smoke:release` passed against
  Guildhall `0.7.0`; `/api/stale-server` returned `stale:false`.
- [x] Final regression pass for the `2026-05-23` flow-audit follow-ups is
  complete. `pnpm typecheck`, `pnpm test -- --runInBand` (`194` files,
  `2702` tests passed, `2` skipped), `pnpm build`, and `git diff --check`
  passed. Browser smoke on the fresh served bundle covered
  `t-minus-t`, `commerce-project`, `font-something`, `fair-labor-license`,
  `narrative-harness`, and `looma-knit`; the two done-only projects showed the
  finished run state without a Start affordance, their Timeline views showed
  run-finished events instead of "No recent activity", active projects still
  exposed real question/input cards and Start, headers showed `CONNECTED`, and
  no stale-server banner was visible.
- [x] Follow up on the second `2026-05-23` multi-agent release-flow audit.
  Six read-only audit agents re-tested the fresh `0.7.0` service after the
  follow-up fixes. All agents verified `/api/version` as `0.7.0`,
  `/api/stale-server` as JSON with `stale:false`, connected headers, and no
  stale-server banner. `font-something` passed the Guildhall-flow audit: its
  real blockers, owner questions, import drafts, Timeline, Release, and Work
  surfaces agreed. The other five projects found shared release risks:
  `t-minus-t` done task drawers still expose an enabled `Run this task`;
  `commerce-project` completed run rows in Thread can still render as
  `IN FLIGHT` while Timeline and API say done/stopped; `fair-labor-license`,
  `narrative-harness`, and `looma-knit` still surface fake or duplicate
  fallback questions such as operational receipts or "I will produce the spec"
  promises as required user choices; `fair-labor-license` can show stopped
  runtime work as `GUILDHALL WORKING` / `Agent-active`; `narrative-harness`
  shows a `gate_check` task as `PAUSED` in Work while Timeline/API say checking
  gates; and `looma-knit` labels many tasks `READY FOR WORKER` even when some
  lack approved brief/acceptance material. Ship confidence after fixing those
  shared state/label/question issues is medium-high; without them, do not ship
  `0.7.0` as final.
  Follow-up completed with four subagent-owned fix lanes: fake/fallback
  question filtering and dedupe, terminal task drawer run-action removal,
  Thread stopped/done/gate-check status truth, and Work readiness/gate-waiting
  labeling. Verification passed on focused suites (`420` tests),
  `pnpm typecheck`, the full suite (`2713` passed, `2` skipped), `pnpm build`,
  `pnpm smoke:release`, and fresh `/api/stale-server` + `/api/version` checks.
  Browser/API smoke on the served bundle verified: `t-minus-t` completed task
  drawers no longer show `Run this task`; `commerce-project` completed Thread
  rows no longer show `IN FLIGHT`; fake persisted-progress and output-promise
  questions are hidden while real owner questions remain; stopped Fair Labor
  work no longer presents as live Guildhall work; `narrative-harness` Work shows
  `Gates waiting` instead of `Paused`; and `looma-knit` splits thin ready tasks
  into `need brief cleanup` with only one Emoji inbox card.
