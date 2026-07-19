# Project Orientation and Proof Paths Plan

> **For agentic workers:** This is a product and architecture plan, not a ready-to-execute implementation checklist. Before implementation, split this into one or more task-level implementation plans with tests, exact files, and verification commands.

**Goal:** Make Guildhall answer, across the product, "what changed, what can I do now, and where do I click or run to prove it?"

**Architecture:** Add durable project-orientation and proof-path concepts, then reshape the project shell around current capability and reproducible proof instead of task status alone. Start with non-executable guidance and copy/open actions, then add safe launch buttons after command lifecycle and safety rules are solid.

**Tech Stack:** TypeScript runtime state, Guildhall task/project persistence, Svelte project shell, existing task Journey / Thread / Inbox / Overview surfaces, Vitest and browser smoke testing.

---

## Problem

Guildhall can show that work happened. It can list done tasks, show progress entries, expose transcripts, and record review/gate evidence. That is useful, but it does not reliably orient the owner to the current project state.

The owner can still end up asking:

- What is true about this project now?
- What capability did this task unlock?
- What can I actually do now that I could not do before?
- Where do I click, run, or look to prove it?
- Is this locally verified, test-only verified, manually verified, or still blocked on an external system?
- If Guildhall split or groomed work behind the scenes, how did the shape of the work change?

The gap is not solved by one "Proof" page. It is a visibility contract that needs to apply throughout the product.

## Product Principle

Every workflow state needs an owner-facing consequence.

Do not make the owner translate internal state such as `done`, `gate_check`, `worker-agent`, `task-alpha`, or "provider config missing" into product meaning. Whenever Guildhall talks about work, it should say what changed, what can be done now, and how to prove it.

Examples:

- Instead of "3 tasks done", say "Checkout can now be tested locally; production webhook routing is still unverified."
- Instead of "Missing Stripe config", say "To prove checkout locally, start Stripe CLI with Connect forwarding."
- Instead of "Task moved to gate_check", say "Guildhall is checking whether the changed code still builds and the planned tests pass."
- Instead of "Seat management done", say "Buy a per-seat license, open Manage seats, invite users, hit the seat cap, and verify the duplicate-invite error."

## First-Class Concepts

### Project Orientation

A durable, synthesized readout of what is currently true about the project.

It should describe:

- current capabilities;
- workflows that are now testable;
- recently unlocked behavior;
- current blockers;
- external setup still needed;
- proof confidence per capability;
- recommended next action.

This should live as project state, not be reconstructed solely from raw transcripts.

### Proof Path

A reproducible path for proving a capability or task outcome.

A proof path should answer:

- What does this prove?
- What must be running?
- Where does the owner go?
- What steps should they take?
- What should they see?
- What did Guildhall already verify?
- What remains unproven?
- What should they try if it fails?

Proof paths can be task-scoped or project-scoped. A task can produce more than one proof path, and one project-level proof path can link several tasks.

### Launch Target

A structured step that Guildhall can present as an action.

Initial launch target kinds:

- `run_command`: Guildhall can run this command in a managed process.
- `open_url`: Guildhall can open this URL.
- `copy_command`: the owner should run this command themselves.
- `manual_step`: the owner must do this in a browser, external app, or dashboard.
- `external_dashboard`: the step points to a provider/admin surface outside the repo.
- `blocked_until_setup`: the proof path cannot continue until a prerequisite is satisfied.

Do not start with executable process management everywhere. The first version should render copy/open/manual guidance safely. Add run buttons only when the command lifecycle is understood.

### Completion Handoff

A compact owner-facing packet generated when a task reaches completion.

Required fields:

- What changed
- What you can do now
- How to prove it
- What Guildhall verified
- What Guildhall did not verify
- Remaining setup or risk
- Suggested next action

This handoff should feed the Task Drawer, Thread, Project Overview, and durable project orientation.

## Proposed Data Shape

This is illustrative, not final schema.

```ts
export interface ProjectOrientation {
  updatedAt: string
  summary: string
  capabilities: CapabilitySummary[]
  proofPaths: ProofPath[]
  blockers: OrientationBlocker[]
  recommendedNextActions: OrientationAction[]
}

export interface CapabilitySummary {
  id: string
  title: string
  description: string
  state: 'available' | 'partially_available' | 'blocked' | 'unknown'
  confidence: 'verified_local' | 'verified_automated' | 'manual_walkthrough_needed' | 'external_setup_needed' | 'unknown'
  relatedTaskIds: string[]
  primaryProofPathId?: string
}

export interface ProofPath {
  id: string
  title: string
  purpose: string
  scope: 'task' | 'project'
  relatedTaskIds: string[]
  launchSteps: LaunchStep[]
  walkthroughSteps: WalkthroughStep[]
  expectedEvidence: ExpectedEvidence[]
  troubleshooting: TroubleshootingHint[]
  guildhallVerified: VerificationRecord[]
  unproven: string[]
  confidence: CapabilitySummary['confidence']
  updatedAt: string
}

export interface LaunchStep {
  id: string
  kind: 'run_command' | 'open_url' | 'copy_command' | 'manual_step' | 'external_dashboard' | 'blocked_until_setup'
  label: string
  cwd?: string
  command?: string
  url?: string
  requires?: string[]
  safety: 'safe' | 'confirm' | 'owner_only'
  lifecycle?: 'one_shot' | 'long_running' | 'external'
  inferred: boolean
}
```

## Surface Changes

### Project Overview Becomes Current State

The project overview should become the main orientation surface.

Lead with:

- what is now true;
- what the owner can do next;
- 1-3 primary proof paths;
- live blockers that prevent proof;
- confidence labels.

Avoid leading with raw task counts. Task counts can remain secondary, but they are not the product meaning.

Example:

```text
Current state
Checkout can now be tested locally with Stripe test mode.
Seat management is implemented in-app.
Production webhook routing is not verified.

Try next
[Open local checkout proof path]
[Review production Stripe setup blocker]
```

### Task Cards Lead With Consequence, Not Detail

Task cards should say what completion means without becoming mini reports.
The goal is fast orientation, not maximum information density. Accuracy matters,
but cards should stay calm and scannable; proof detail belongs in the drawer,
tooltip, or an explicit proof-path action.

Default card hierarchy:

1. Outcome line: the owner-facing consequence in one short sentence.
2. Status/confidence chip: done, blocked, needs proof, verified locally, etc.
3. One optional next action when it is clearly the most important action.
4. Everything else moves to Task Drawer Journey or a proof-path disclosure.

Bad:

```text
Done
task-seat-management
```

Good:

```text
Seat management can now be tested locally
[Review proof path]
```

Also good when space is tight:

```text
Seat management is testable locally
Verified by build · Manual proof available
```

Avoid putting full walkthroughs on cards:

```text
Seat management can now be tested locally by starting the frontend, registering
as a buyer, buying a per-seat license, opening Manage seats, inviting users,
testing duplicate invites, hitting the cap, revoking one user, and checking the
Stripe portal.
```

For in-progress tasks, cards should say what state the work is moving toward:

```text
Guildhall is making checkout testable in local Stripe test mode.
```

If a consequence cannot be made short, that is a signal for progressive
disclosure. The card should name the capability or current blocker; the drawer
should explain the proof path, expected evidence, and remaining uncertainty.

### Task Drawer Journey Becomes The Handoff

The Journey tab should become the primary place to understand a task after it has moved.

It should show:

- What changed
- What can be done now
- Proof path
- Launch/open/copy/manual steps
- Expected evidence
- What Guildhall verified
- Files changed
- Review/gate summary
- Remaining uncertainty

History and Transcript should be demoted as source records. They are useful for audit and debugging, but they should not be the normal way to understand completed work.

### Thread Emits Re-Orientation Events

Thread should explain behind-the-scenes shaping in owner terms.

Examples:

```text
I split this into checkout, webhook proof, and seat-management work because they have different proof paths.
```

```text
This task is done locally. Production proof still depends on Stripe dashboard webhook setup.
```

```text
I found the local proof path: start the Stripe listener, start the frontend, then use one author session and one buyer session.
```

Thread should keep acting as the command surface, but it should also prevent disorientation after background grooming, splitting, review, and completion.

### Inbox / Needs You Becomes "To Prove X, Do Y"

External blockers should be phrased around the proof they unlock.

Bad:

```text
Missing provider config
```

Good:

```text
To prove checkout locally, start Stripe CLI with Connect forwarding.
```

Bad:

```text
Supabase credentials missing
```

Good:

```text
The app has local Supabase env vars, but OAuth provider setup still needs dashboard verification before this login path can be proven.
```

Each owner action should include:

- what capability it unlocks;
- the exact owner step;
- how Guildhall will continue afterward;
- whether the action is local, external, or production-facing.

### Progress Feed Is Demoted Or Reframed

The current progress feed is activity-shaped. That is useful, but it can compete with orientation.

Options:

1. Demote Progress to a secondary "Recent activity" rail.
2. Keep it, but group entries under current capabilities and proof paths.
3. Remove it from primary views once Current State and Journey cover the same user job better.

Be willing to remove progress UI if it mostly shows internal movement without helping the owner decide what to do.

### Work Tab Is Re-Evaluated

If Work remains mostly a task-status inventory, it should become secondary to Current State, Thread, and Inbox.

Possible futures:

- reshape Work around capabilities and proof paths;
- keep Work as an archive/search view;
- merge parts of Work into Current State and Inbox;
- remove Work from primary navigation if it creates duplicate task-count framing.

Do not preserve Work just because it already exists. Its user job must earn its place after orientation becomes the main product spine.

### Spec Review Previews The Proof

Before work starts, the spec review should show:

```text
When this is done, you should be able to prove it by...
```

This makes acceptance criteria less abstract and gives the owner a chance to correct the expected proof path before implementation.

## Agent Workflow Changes

### Spec Agent

The spec agent should produce or update a proof path for any non-trivial task.

Required spec behavior:

- identify what capability the task should unlock;
- state how the owner will prove it;
- separate repo-local proof from external/provider proof;
- ask a question if the proof environment is ambiguous;
- split work when implementation and proof have different owners or environments.

The Completion Boundary section should become more actionable by feeding structured proof-path data, not just prose.

### Worker Agent

The worker should treat proof-path maintenance as part of implementation.

Required worker behavior:

- update the proof path when the actual command, route, file, or workflow differs from the spec;
- record exact commands that passed;
- record exact manual walkthroughs that remain;
- avoid handing off with only code evidence when the task asks for visible/product behavior;
- include "what the owner can now do" in the self-critique or checkpoint.

### Reviewer Agent

Review should include a proof-path lane.

Review question:

```text
Can the owner reproduce the claimed outcome from the handoff without reading the transcript?
```

Reviewer should reject or request revision when:

- proof steps are missing;
- expected evidence is vague;
- external setup is flattened into "done";
- local proof and production proof are confused;
- the task claims a capability that the proof path does not exercise.

### Gate Checker

Gate checker should record automated proof, but should not pretend automated proof covers manual/product proof.

It should distinguish:

- tests/build/typecheck passed;
- browser/manual walkthrough not performed;
- external provider setup not verified;
- local command unavailable;
- proof blocked on owner-only action.

### Coordinator

Coordinator should synthesize task-level handoffs into project orientation.

Responsibilities:

- update current capabilities after task completion;
- link related proof paths across tasks;
- identify newly unlocked workflows;
- preserve unresolved external setup as visible project state;
- create re-orientation Thread events when task splitting or background grooming changes the shape of work.

## Launch Button Strategy

Launch buttons are valuable, but they should come after guidance is trustworthy.

### Phase 1: Copy/Open/Manual

Render launch steps as:

- copyable commands;
- openable URLs;
- clearly labeled manual steps;
- blocked prerequisites.

No long-running process management in the first slice.

### Phase 2: Managed Local Commands

Add executable buttons only for commands Guildhall can safely own.

Requirements:

- show working directory;
- show command before running;
- identify long-running versus one-shot commands;
- track process status;
- expose stop/restart;
- avoid leaking secrets into UI logs;
- detect port conflicts;
- keep process output inspectable but not primary;
- persist enough state to recover the UI after reload.

### Phase 3: Multi-Service Proof Paths

Support named proof paths with multiple launch steps.

Example:

```text
Local checkout proof
1. Start Stripe listener
2. Start frontend dev server
3. Open author browser session
4. Open buyer browser session
5. Copy Stripe test card
```

Only the relevant path should be primary in context. Do not dump every launchable thing onto Project Overview.

## Additional Visibility And Launch Primitives

These are not all first-slice requirements, but they are important to keep in
the product model so proof paths do not become shallow "run this command" cards.

### Readiness Checks

Before showing a launch action as runnable, Guildhall should be able to explain
whether the environment is ready.

Examples:

- required env vars are present by name, with values redacted;
- required CLIs are installed;
- local ports are free or already owned by the expected process;
- dependency install state looks current enough;
- required external accounts or provider dashboards remain owner-only;
- required test data exists or needs seeding.

This should prevent buttons that fail immediately for predictable reasons.

### Reset And Seed Paths

Many proof paths need a known starting state.

Guildhall should eventually distinguish:

- launch the app;
- seed demo/test data;
- reset local state;
- clear generated artifacts;
- create a test account or fixture;
- restore the project after a destructive proof run.

For flows like Stripe checkout, auth, migrations, importers, or onboarding,
"how do I get back to the start?" is part of proof.

### Multi-Persona Or Multi-Session Proof

Some features cannot be proven from one browser session.

Proof paths should be able to say:

- use an author session and a buyer session;
- use admin and member roles;
- use two browsers/incognito windows;
- use a connected account view versus platform account view;
- use seeded users with known roles.

Do not hide this inside prose if the task depends on it. Model it as part of
the proof path so the owner understands why multiple sessions are needed.

### Live Status And Stop Controls

Once Guildhall can launch things, it must also show what is currently running
and how to stop it.

Minimum eventual behavior:

- process is starting/running/stopped/failed;
- command, cwd, and port are visible;
- logs are inspectable behind disclosure;
- stop/restart is available;
- stale processes after reload are reconciled;
- a failed launch suggests the next fix.

A Launch button without a matching Stop/status story will create new
disorientation.

### Evidence Freshness

Proof can go stale.

Guildhall should record when evidence was last collected and what code/config it
matched:

- commit or dirty-worktree summary;
- command output timestamp;
- URL or route checked;
- provider environment, when known;
- manual walkthrough timestamp;
- whether relevant files changed since proof.

This lets the UI say "verified just now", "verified before the last change", or
"proof likely stale" instead of treating all old evidence as equally current.

### Scope Labels

Every proof path should be explicit about where the proof applies.

Useful labels:

- local;
- staging;
- production;
- test provider mode;
- live provider mode;
- docs preview;
- generated artifact;
- unit/integration/browser/manual.

This matters because "works locally" and "ready in production" are different
truths.

### Observability Links

Some proof lives outside the app UI.

Proof paths should support links or instructions for:

- webhook listener output;
- provider dashboard events;
- logs;
- database rows;
- generated files;
- CI runs;
- deployment previews;
- screenshots or recordings later.

The point is not to make every proof visual. The point is to make the evidence
findable.

### Failure Playbooks

Good proof guidance should include the first few likely failure branches.

Examples:

- "If the success page polls forever, the checkout webhook did not reach localhost."
- "If onboarding does not complete, check for the `account.updated` event."
- "If the preview URL 404s, rebuild docs and use the static preview route."

This should be concise and contextual. Do not turn every proof path into a
support encyclopedia.

### Confidence And Inference Labels

Guildhall should distinguish facts from guesses.

Examples:

- confirmed from repo config;
- confirmed by a passing command;
- inferred from package scripts;
- suggested by an agent;
- owner-confirmed;
- stale or unverified.

This is especially important for launch targets. A button inferred from
`package.json` should not feel as authoritative as a proof path that Guildhall
already ran successfully.

## Prioritization

### Slice 1: Durable Proof Paths And Task Handoffs

Goal: completed work becomes understandable without transcript archaeology.

Build:

- proof-path schema;
- task completion handoff structure;
- spec-agent instructions;
- worker self-critique/checkpoint instructions;
- Task Drawer Journey rendering;
- tests for proof-path parsing/rendering.

Do not build:

- process runner;
- screenshots;
- rich HTML artifacts;
- project-wide synthesis.

### Slice 2: Project Current State

Goal: the project overview answers what is true now.

Build:

- project-orientation schema;
- coordinator synthesis from completed tasks and proof paths;
- Project Overview redesign around current capabilities;
- confidence labels;
- primary proof path cards.

Reassess:

- whether Work remains primary nav;
- whether Progress belongs on Overview.

### Slice 3: Inbox And Thread Re-Orientation

Goal: background grooming and blockers do not leave the owner lost.

Build:

- Thread re-orientation events for splits, completion, and proof discovery;
- Inbox blocker copy that says "to prove X, do Y";
- external checklist rendering tied to proof paths;
- tests for owner-facing blocker text.

### Slice 4: Launch Step Actions

Goal: proof guidance becomes action where safe.

Build:

- copy command action;
- open URL action;
- manual step rendering;
- blocked prerequisite rendering;
- launch target safety metadata;
- tests for action ranking and labels.

Do not run commands yet.

### Slice 5: Managed Launch Buttons

Goal: Guildhall can safely start local proof services.

Build:

- process lifecycle manager;
- long-running command state;
- stop/restart;
- output inspection;
- port conflict handling;
- command confirmation for risky steps;
- browser smoke coverage.

### Slice 6: Evidence Artifacts

Goal: attach richer proof when useful.

Build later:

- screenshots;
- browser recordings;
- generated reports;
- rich artifacts;
- proof-path evidence gallery.

Do not start here. Orientation comes first.

## UI Kill List

Be willing to remove or demote these if they compete with orientation:

- raw Progress as a primary project-state surface;
- Transcript as a normal understanding surface;
- History as a top-level mental model;
- task-count-heavy Overview cards;
- Work as primary nav if it remains a status inventory;
- repeated labels that surface internal role/status identifiers instead of owner consequences.

The replacement is not more UI. The replacement is a clearer product spine:

```text
Current State -> Proof Path -> Launch / Walkthrough -> Evidence -> Remaining Risk
```

## Decisions

### Orientation Storage

Store current project orientation in checked-in `.guildhall/` project state, and
store the append-only evidence trail in local history.

Rationale:

- top-level orientation should generally stay synced across systems;
- the project UI needs a clean current snapshot without replaying transcripts;
- bulky evidence, transcripts, older snapshots, and detailed proof history can
  live in local history;
- checked-in orientation should avoid secrets and raw transcript material.

### Proof Path Authorship

Agents should author as much of the proof path as they are capable of authoring,
with Guildhall validating and normalizing the result into structured project
state.

Rationale:

- proof-path thinking is part of doing the work, not a post-processing afterthought;
- the spec agent should propose the intended proof path before implementation;
- the worker should refine it when reality differs from the spec;
- the reviewer should evaluate whether the path is reproducible and honest;
- Guildhall should still own the schema, safety checks, confidence labels, and
  display shape so a freeform agent paragraph does not become the canonical
  contract.

### Owner Edits To Proof Paths

Keep owner controls simple.

Owners should be able to:

- pin the proof path that best represents the current project workflow;
- add a short note or correction;
- hide/archive proof paths that are no longer useful.

Owner changes should be recorded as owner input rather than silently rewriting
agent evidence, but this should not become a complex proof-path editing system.

### Launch Target Discovery And Tool Suggestions

Use both deterministic discovery and agent judgment.

This follows the broader product philosophy in
`internal/design-notes/project-construction-manifesto.md`: Guildhall should
suggest better-fit tools, libraries, shared abstractions, and visibility helpers
when they would make the work clearer, safer, more repeatable, or less bespoke.

Guildhall should discover obvious launch candidates from project configuration,
such as package scripts, docs preview commands, Storybook commands, Docker
Compose files, devcontainer config, Procfiles, known framework ports, and
existing test/smoke commands.

Agents should also be allowed to propose helpful visibility tools when the
project would benefit from them, such as a docs preview, Storybook, seed script,
smoke test command, webhook replay helper, local fixture generator, browser
walkthrough, screenshot capture, or deployment preview link.

Human confirmation is required before Guildhall installs, adopts, or runs a new
tooling path that is not already part of the project contract.

Confidence labels should distinguish:

- discovered from existing config;
- proposed by an agent;
- confirmed by a successful run;
- owner-confirmed or owner-pinned.

### Long-Running Command Safety Baseline

Before Guildhall can expose a button that runs a long-lived local command, it
needs a clear safety and lifecycle model.

Minimum baseline:

- show the exact command and working directory before first run;
- require owner confirmation for new or inferred commands;
- distinguish one-shot commands from long-running processes;
- show running, stopped, and failed states;
- provide Stop and Restart;
- detect port conflicts;
- keep logs inspectable but not front-and-center;
- redact obvious secrets from command output;
- persist enough process state to recover after UI reload;
- never run destructive, reset, or seed commands without explicit confirmation.

A Launch button is not acceptable unless Guildhall can also answer what is
running, where it is running, whether it failed, and how to stop it.

### Overview Remains The Landing Surface

"Current State" is the job of the existing Overview surface, not a new competing
tab.

The default project landing experience should remain Overview, but Overview
should be reshaped around current project truth:

- what changed recently;
- what the owner can do now;
- primary proof paths;
- live blockers;
- confidence and scope labels;
- the next useful action.

Thread remains the active interaction surface for questions, approvals,
corrections, and agent turns. Overview can deep-link to Thread when the next
useful action is an active conversation item.

If the landing area grows sub-navigation, the top-level nav label should become
Project, with Overview as the first subview. Do not create a top-level
"Overview" item that then contains several nested overview-like views.

Project-level views with overlapping concerns, especially Work, Timeline, Facts,
and Release, should be reassessed as possible Project subviews, sections, or
secondary drill-ins rather than separate always-primary navigation entries.
Some may remain distinct if they serve a clear owner job; others may collapse
into different views of the same project-state model.

Initial reassessment:

- **Work:** keep the capability, but likely stop treating it as a separate
  primary project nav item. It is a task/backlog management view, so it can
  become a Project subview such as `Project -> Work` or `Project -> Tasks`.
  It should remain reachable for sorting, board/list modes, and backlog
  management, but it should not compete with Overview as the answer to "where
  are we?"
- **Timeline:** demote from primary nav. The current surface is a coordinator
  event log and belongs as Activity/Audit under Project, or as a debugging
  drill-in from specific events. It is not a normal orientation surface.
- **Facts:** fold into Project details/readiness/settings. The current surface
  is project identity, environment, gates, workspace discoveries, coordinators,
  and design-system facts. Those are useful, but they are supporting context
  for Overview, readiness, and Settings rather than a primary destination.
- **Release:** keep only if it owns a distinct release-readiness job. If the
  user is actively preparing to ship, Release can stay as a primary or promoted
  Project subview. If not, its criteria should appear as part of Overview's
  confidence/readiness model, with a drill-in for the full release checklist.
- **Import / workspace import:** keep contextual. It should appear when there
  is importable workspace state or an unresolved import decision, not as an
  always-primary mental model after setup is complete.

One possible future project IA is:

```text
Project
  Overview
  Work / Tasks
  Activity
  Readiness / Release
  Facts / Details

Thread
Inbox
Settings
```

This is a hypothesis, not a settled decision. A tidy semantic hierarchy is not
automatically better product navigation. Some project-related surfaces may still
deserve top-level placement if they represent frequent owner jobs, high-urgency
attention, or a distinct mode of work.

Alternative IA shapes to consider:

```text
Overview
Work
Thread
Inbox
Release
Settings
```

This keeps frequent jobs top-level and demotes only lower-frequency support
surfaces such as Timeline/Activity and Facts/Details.

```text
Project
Work
Thread
Inbox
Release
Settings
```

This makes Project the orientation/details home while keeping Work and Release
top-level because they are distinct owner modes.

The decision should come from user jobs and navigation frequency, not from the
word "project" swallowing every project-related thing.

Preferred direction after IA review:

```text
Project
  Overview
  Memory

Thread
Work
Release
Activity

Settings
```

In this shape:

- **Project -> Overview** is the landing page. It owns current-state
  orientation, recently changed capabilities, primary proof paths, and the first
  visible "Needs you" list when anything is blocked on the owner.
- **Project -> Memory** absorbs Facts/Details: project identity, environment,
  gates, design-system notes, durable project knowledge, coordinator/routing
  context, and other "what Guildhall knows" material.
- **Thread** stays top-level because it is the active conversation and command
  surface.
- **Work** stays top-level because task/backlog operations are a distinct mode,
  not merely a detail under Project.
- **Release** stays top-level when release readiness is important enough to
  deserve its own mode. It can still be revisited later if release signals fold
  cleanly into Overview.
- **Activity** replaces/demotes Timeline as an audit/debug/event-log surface.
  It is useful, but lower priority than Overview, Thread, Work, or Release.
- **Settings** remains utility navigation.

This direction folds Inbox into Overview instead of keeping it as a standalone
primary nav item. Blocked owner actions should be rare and high-signal; when
they exist, they should be the first list on Overview. A separate Inbox is only
worth restoring if owner-attention items become frequent enough to need their
own management surface.

### Navigation Scope Boundaries

Keep project-level navigation and task-detail navigation separate when making
orientation decisions.

Project-level surfaces include:

- Overview
- Thread
- Inbox
- Work
- Import / workspace import
- Facts
- Timeline
- Release
- Settings

Task-drawer surfaces include:

- Summary (rename the current task-drawer `Overview` tab so it does not
  collide with project Overview)
- Spec
- Journey
- Transcript
- Experts
- History
- Origin / provenance

This plan should not talk about deleting or demoting "surfaces" without naming
which navigation layer it means. Project-level navigation decides how the owner
orients to the whole project. Task-drawer navigation decides how the owner
understands one piece of work.

Task-level "Overview" should become "Summary" as part of this direction. The
word Overview should be reserved for the project-level landing surface.

### Task Drawer IA

Reduce task-drawer tabs and rename them around owner jobs rather than internal
storage categories.

Preferred task-drawer shape:

```text
Summary
Spec
Journey
Review
Evidence
```

Mapping:

- **Summary:** rename the current task-level Overview. This is the default task
  view: current status, what changed, what can be done now, and the next useful
  action.
- **Spec:** keep the accepted blueprint, acceptance criteria, scope, and
  non-goals.
- **Journey:** keep the existing label, but make it absorb Proof: proof path,
  launch steps, manual walkthrough, expected evidence, completion handoff, and
  remaining uncertainty.
- **Review:** absorb Experts and the readable parts of review/gate history:
  reviewer coverage, verdicts, unresolved concerns, and deterministic checks.
- **Evidence:** collapse Transcript, lower-level History, and Origin/provenance
  into one secondary audit/source area.

The goal is fewer tabs, clearer labels, and less exposure of internal storage
categories. Small tasks should often be understandable from Summary alone.

## Open Questions

All initial open questions are resolved. Add new questions here only when they
need an explicit product decision before implementation.

## Acceptance Criteria For The Overall Direction

This direction is working when:

1. A user can open a project cold and understand what changed recently without reading transcripts.
2. A done task says what capability it unlocked, not just that it is done.
3. Every meaningful done task has a proof path or an explicit "not directly previewable" explanation.
4. External blockers are phrased as proof blockers with concrete owner steps.
5. Automated verification and manual/product proof are visibly distinct.
6. Project Overview summarizes current capability and confidence, not just task inventory.
7. Launch actions appear only when they are contextually relevant and safe enough to trust.

## Suggested First Implementation Plan

Write a separate implementation plan for Slice 1:

- Add `ProofPath` and `CompletionHandoff` types to the task model or adjacent runtime evidence model.
- Add pure helpers to derive display summaries from those structures.
- Extend spec-agent and worker-agent prompts to require proof-path fields.
- Render proof paths in `JourneyTab.svelte`.
- Add tests around:
  - task with proof path;
  - task with no direct preview;
  - task blocked on external provider setup;
  - task with automated verification but manual walkthrough still needed.

Only after Slice 1 feels right should the project overview be reshaped around Current State.
