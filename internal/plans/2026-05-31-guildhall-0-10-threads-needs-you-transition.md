# Guildhall 0.10 Threads + Needs You Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition Guildhall from separate `Thread`/`Inbox` mental models toward `Threads + Work`, keeping a transitional `Needs you` view while conversation-shaped inbox items migrate into durable thread timelines.

**Architecture:** Keep the current runtime stores and routes, but split current inbox items into two families: thread-shaped owner interaction/state-progression items and non-thread project/system alerts. The first phase does not delete `Inbox`; it renames and narrows it into `Needs you`, teaches `Threads` to own lifecycle items, and preserves `attention.json` as a durable alert ledger for non-thread conditions and dismissals.

**Tech Stack:** TypeScript/Node runtime, Svelte UI, Vitest, Guildhall session stores, attention/inbox snapshot pipeline, Thread projection runtime, installed-app browser proof.

---

## Source Context

- `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`
- `internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md`
- `internal/audits/flow-audit.md`
- `src/runtime/inbox.ts`
- `src/runtime/attention.ts`
- `src/runtime/thread.ts`
- `src/web/surfaces/ProjectView.svelte`
- `src/web/surfaces/project/InboxTab.svelte`
- `src/web/surfaces/project/ThreadTab.svelte`

## Scope

This plan covers the transitional `#2` path:

- keep a separate attention surface for now;
- rename/recast `Thread` as `Threads`;
- rename/recast `Inbox` as `Needs you`;
- move conversation-shaped attention items onto the `Threads` model first;
- keep project/runtime alerts in the attention surface;
- preserve current blocker/history behavior while reducing conceptual overlap.

This plan does **not** finish the full `#1` collapse where `Inbox` becomes only a filter over `Threads`. That follow-up should happen after browser proof shows the transitional model is stable.

## Item Taxonomy To Implement

### Move to Threads

- `project_check_in`
- `pressure_test_pending`
- `agent_question_pending`
- `brief_approval`
- `spec_approval`
- `open_escalation`

### Keep in Needs You

- `required_migration`
- `project_understanding`
- `bootstrap_missing`
- `setup_pending`
- `workspace_import_pending`

### Keep as low-priority attention nudges

- `lever_questions`
- `spec_fill_pending`

## UI / Interaction Model

### Core Mental Model

The transition should teach one simple rule:

- `Threads` is where Guildhall and the owner work through ideas, questions,
  approvals, and state progressions.
- `Work` is where shaped work lives once it is structurally executable or
  reviewable.
- `Needs you` is the transitional alert view for project/system
  conditions and durable attention history.

Users should no longer need to infer whether a question lives in `Inbox`,
`Thread`, a task drawer, or a setup tab. If Guildhall needs interaction or
judgment, it should appear in `Threads`.

### When A Thread Should Exist

Create or update a thread when Guildhall needs a meaningful progression of
interaction, not just a one-off alert.

Threads are not all the same kind of object. The model should support at
least two families:

- `Outcome threads`: requests, approvals, blocker recovery, spec drafting,
  task shaping, or any interaction expected to converge toward `Ready`,
  `Done`, or another explicit handoff state.
- `Conversation threads`: owner questions about the repo, task state, file
  state, why Guildhall chose something, what changed, or what the current
  evidence says. These may never create work and may never need a formal
  `Done` state.

Use a thread for:

- owner-started requests (`New thread`);
- owner-started questions about the project, a task, a file, or the current
  repo state;
- bounded chat intake and follow-up questions;
- project check-ins and pressure-test questions;
- brief approval and spec approval;
- blocked-work recovery where the user must choose retry, reframe, defer,
  approve setup, or inspect a proposed artifact;
- system-started threads only when Guildhall needs judgment, approval,
  clarification, or artifact review.

Do **not** create a thread for:

- required migration existence alone;
- bootstrap incomplete alone;
- workspace import available alone;
- low-priority hygiene reminders;
- passive state changes that do not ask the owner to do anything.

Those stay as alerts in `Needs you` until a real conversation or review
moment exists.

### Thread Outcome Model

Do not force every thread into the same lifecycle.

For outcome threads, phases can include:

- `intake`
- `clarifying`
- `drafting spec`
- `awaiting approval`
- `ready`
- `launched`
- `done`

For conversation threads, lighter states are enough:

- `Active`
- `Waiting on Guildhall`
- `Waiting on you` only when a follow-up is actually needed
- `Answered` or `Resolved` optionally

Conversation threads should be allowed to age out of the active list without
pretending they became tasks or landed in a formal `Done` phase.

The key product rule is:

- a thread is the container for interaction;
- work should appear only when the interaction has shaped something into an
  executable or reviewable state.

### Thread List Behavior

The left column should behave more like an email/chat inbox than a task queue.

Each row should show:

- auto-title or request title;
- 1 compact status chip;
- 1 source/type chip when useful (`Owner`, `System`, `Approval`, `Blocked`);
- last meaningful update time;
- one-line summary of the latest state, not the whole transcript.

Default ordering:

- reverse chronological by latest update;
- active and waiting-on-you threads float above done threads;
- done threads are hidden by default behind a filter toggle.
- when a thread receives a new message, status change, progress update,
  approval transition, or working-state update, the list should re-sort
  immediately by the new `lastUpdatedAt` value without waiting for a full page
  reload.

Timestamp display should be compact and relative:

- `< 60m`: `12m`
- `< 24h`: `1h`, `8h`
- `>= 24h`: `3d`, `12d`

The thread row should bind to a single canonical `lastUpdatedAt` field so the
same value drives both ordering and the visible relative-time chip.

Suggested chip vocabulary:

- `Waiting on you`
- `Drafting spec`
- `Approval needed`
- `Ready`
- `Blocked`
- `Done`

### Entry And Resume Behavior

Entering `Threads` should usually feel like returning to the place you left
off, not landing on a generic empty state every time.

Recommended rule:

- if the most recently active thread was updated within a freshness window,
  reopen that thread directly;
- otherwise start in a draft `New thread` composer state.

The draft `New thread` state should:

- look like a thread in the detail pane;
- allow the owner to type immediately;
- not create a durable thread record until the first message is actually sent.

The freshness window should be explicit and testable. Start with something
like `30 minutes`, then tune from live use if needed.

Additional rules:

- if a thread is actively waiting on the owner or Guildhall, prefer reopening
  it even if a different older thread exists;
- if the last selected thread is `Done` and outside the freshness window,
  prefer the draft `New thread` composer;
- if the owner opens Threads from a specific alert or task-linked affordance,
  that explicit target should win over generic resume behavior.

### Thread Detail Behavior

The right column is not a giant feed of full-size cards. It is a compact
timeline of state progression.

The detail view should contain:

- a compact thread header with title, chips, source, and timestamps;
- one active composer/input region only when Guildhall is waiting for owner
  input;
- a scrollable progression of mini-cards and status lines;
- expandable artifact cards only when the owner needs to inspect a durable
  document or proposal.

When Guildhall is actively working inside a thread, the detail should show a
live working state rather than a static card.

Examples:

- processing the owner’s latest answer;
- drafting a spec;
- reviewing a proposed split;
- waiting for the current agent pass to finish;
- building or verifying linked work.

These should render as animated status lines or compact live rows, not giant
cards. The existing pulse/working treatment already used in project and thread
status rows is the right visual direction.

### Mini-Card Rules

Mini-cards should replace the current large all-purpose cards for most thread
states.

Mini-cards are appropriate for:

- owner question asked;
- answer recorded;
- bounded chat receipt;
- phase transition (`Intake finished`, `Drafting spec`, `Review complete`);
- recovery decision summary;
- small thread-local proposal summaries;
- done/blocked receipts.

Mini-cards should look like:

- title line;
- one or two short explanatory lines;
- optional chips;
- one primary action when needed;
- optional `Inspect` secondary action when an artifact exists.

They should **not** contain:

- full long-form spec markdown inline by default;
- giant prose explanations;
- multiple stacked button rows;
- duplicated task metadata already visible elsewhere.

### Status-Line Rules

Some phases should not even render as cards. They should be one-line timeline
status rows that update in place.

Use status lines for:

- `Drafting spec...`
- `Reviewing latest answer...`
- `Waiting for agent run to finish...`
- `Ready for approval`
- `Task moved to Todo`

This keeps the thread readable and prevents the “wall of cards” effect.

Status lines that represent active Guildhall work should be animated with the
same motion language as the rest of the design system:

- soft pulse while actively running;
- immediately settle to a non-pulsing state when complete;
- preserve the line in-place so the owner sees a state progression, not a
  disappearing spinner.

### Reactive State Model

The thread list and detail should not maintain separate competing truth
models.

Use one shared thread projection model that includes at least:

- `threadId`
- `threadType`
- `status`
- `phase`
- `lastUpdatedAt`
- `waitingOn`
- `hasLiveAgent`
- `summary`
- `artifactRefs`

The list and detail should subscribe to the same thread state so these
behaviors stay coherent:

- row reordering on update;
- relative timestamp refresh;
- active-thread selection;
- live working animation;
- done/hidden filtering;
- resume-recent-thread behavior.

Current implementation seam:

- project-wide context already flows through the shared project store;
- incremental updates already flow through the app event bus and thread route
  polling;
- the threads-model pass should extend that existing reactive path rather than
  introducing a disconnected thread-only state system.

### Artifact Review In Threads

Spec approval should happen inline in the thread detail, but not as a giant
full-bleed card by default.

Recommended pattern:

1. status line: `Intake finished`
2. status line: `Drafting spec...`
3. compact review mini-card:
   - title: `Spec draft ready`
   - summary: one-paragraph explanation of what changed
   - actions: `Inspect draft`, `Approve`, `Request changes`
4. expandable spec preview panel or linked modal for full markdown

The same pattern can later apply to:

- brief approval;
- recovery proposals;
- capability proposals;
- settings proposals.

### When To Show The Details Pane

The task/details pane should survive, but it should no longer be the default
answer for every interaction.

Open or emphasize the details pane only when the user needs:

- full task structure and metadata;
- the complete spec, brief, or proof artifacts;
- source/provenance inspection;
- review history or execution history;
- task-local file/workspace/proof context;
- advanced actions that are structurally about work, not conversation.

Do **not** bounce the user into the details pane for:

- answering a thread question;
- approving a brief/spec at a high level;
- acknowledging a bounded-chat receipt;
- choosing among a small set of recovery options;
- seeing basic progress state.

### Which Actions Stay Inline In Threads

Keep inline in the thread detail:

- answer question;
- choose bounded-chat option;
- approve/reject brief at summary level;
- approve/request changes on spec mini-card;
- retry/reframe/defer recovery choices when the options are compact;
- open shaped work once the thread reaches `Ready`.

### Which Actions Still Belong To The Details Pane

Route to the details pane for:

- full spec inspection/editing context;
- large evidence/proof review;
- source-note and provenance drill-ins;
- task execution control once work is in `Todo` / `Ready` / `In progress`;
- complex multi-section task state that needs structured tabs.

### Needs You Surface Behavior

`Needs you` should become visibly different from `Threads`.

It should feel like:

- project/system alerts;
- blocker remediation queue;
- durable attention history and dismissals.

It should **not** feel like:

- a second place where owner questions live;
- a duplicate approval queue;
- the normal way to move work forward.

Recommended sections:

- `Project alerts`
- `Cleanup and defaults`
- `History`

Recommended exclusions from the open list:

- active question sessions;
- brief/spec approvals;
- escalations already visible in Threads.

### Work Surface Boundary

The thread should end its shaping role when Guildhall can honestly say:

- the task has a clarified outcome;
- acceptance criteria and verification direction exist;
- the deliverable boundary is known;
- the next step is execution or structured review, not more intake.

At that point:

- the thread remains the narrative/timeline container;
- `Work` receives the durable structured item in `Todo` or `Ready`;
- `Start` only applies to ready work, not to threads.

### Shared UI Primitive Model

`Threads`, `Work`, and `Needs you` should not continue evolving as three
independent layout languages.

Today the repo is effectively doing this:

- `Card` = generic large surface container
- `TaskCard` = bespoke compact work item surface
- `UtilityPanel` = compact row/panel/list surface
- `InteractionCardLayout` = thread-specific card chrome

That is enough raw material to unify the surfaces, but not enough shared
primitives yet. The next UI passes should define a common hierarchy:

#### Foundation primitives

- `Card`
  - default large sectional surface
  - used for page sections, drawers, inspections, and heavy artifacts
- `Panel`
  - compact informational surface
  - today this is effectively `UtilityPanel`
  - should remain the base for dense rows, alerts, and sub-panels
- `StatusLine`
  - one-line live or settled state row
  - used consistently across `Threads`, `Work`, and `Needs you`
- `Chip`
  - shared status, source, and count language

#### Interaction language

The design system also needs a first-class distinction between:

- `Info card`
  - a surface you read
  - used for summaries, receipts, artifact previews, runtime facts, and
    passive history
- `Selectable card`
  - a surface you can pick, open, or act on
  - used for list rows, thread rows, alert rows, draft/task picks, and
    preview items that behave like buttons

These should not rely on ad hoc cursor changes alone. They need a shared
design language across all project surfaces.

Recommended differences:

- `Info card`
  - calmer border and background
  - no hover lift that implies clickability
  - no selected state unless explicitly embedded in another control
  - action buttons, if any, are subordinate controls inside the card
- `Selectable card`
  - stronger hover/focus state
  - clear selected state
  - keyboard/button semantics by default
  - title/meta layout optimized for scanning and choosing
  - may still contain secondary actions, but the whole surface reads as an
    affordance

This distinction should be shared by:

- `Threads` left-column rows
- `Needs you` rows
- `Work` list rows and draft-pick rows
- workspace import selection rows
- any future “open this thing” surface

It should also influence naming:

- `Card` should remain the broad informational surface
- `CardListItem` should default to the selectable-row primitive
- domain-specific extensions should declare whether they are informational or
  selectable instead of inventing bespoke middle states

#### Collection primitives

- `CardList`
  - shared vertical collection shell
  - handles gap, selection spacing, row separators, and empty/loading states
- `CardListItem`
  - shared row primitive for dense index/list views
  - supports:
    - title
    - summary
    - leading status affordance
    - trailing meta (`12m`, count, status chip)
    - selected / interactive / dense variants

These should back:

- thread list rows in `Threads`
- item rows in `Needs you`
- list-mode rows in `Work`
- any future project-level inbox/index views

#### Domain extensions

- `TaskCard`
  - should become an extension of the shared list/card language, not a
    separate visual species
  - it can stay specialized, but should inherit the same title/meta/status
    anatomy as `CardListItem`
- `ThreadCard`
  - active/history thread timeline surface
  - should extend `Card` plus `InteractionCardLayout`
  - compact by default, expandable for artifacts
- `ActiveThreadDock`
  - pinned active-thread footer module
  - owns the current thread context plus composer or structured controls
  - this is the right home for task shaping, active questions, approvals, and
    “Guildhall is working” thread states
- `AlertCard`
  - `Needs you` project/system alert row or card
  - should extend `Panel`/`CardListItem`, not invent new chrome

#### Surface-specific composition rules

- `Threads`
  - left column uses `CardList` + `CardListItem`
  - right timeline uses compact `ThreadCard` / `StatusLine`
  - active state uses `ActiveThreadDock`
- `Work`
  - list mode should use the same `CardList` row anatomy as Threads/Needs you
  - board/columns can stay structurally different, but task tiles should still
    reuse shared title/meta/status primitives
- `Needs you`
  - should use the same `CardList` + `CardListItem` primitives as the Threads
    list, but with alert tones and less conversation-specific metadata

#### Unification rule

The same data shape should be able to drive any dense project row:

- `title`
- `summary`
- `statusLabel`
- `statusTone`
- `sourceLabel`
- `updatedAt`
- `selected`
- `href` or click handler

If a surface needs a row and cannot express itself through that shared shape,
that should be treated as an exception to justify rather than the default path.

#### Immediate implementation consequence

Before doing more one-off `Threads` styling, extract and adopt shared list
primitives first:

1. create `CardList`
2. create `CardListItem`
3. make its `kind` or variant explicit: informational vs selectable
4. make `Needs you` use them
5. migrate `Threads` left column to them
6. migrate `Work` list rows toward the same row anatomy
7. only then keep tightening the docked active-thread experience

### Transitional UX Rule

During the `#2` soft-merge phase, every thread-shaped inbox item should either:

- already be visible in `Threads`, or
- carry an explicit CTA that says `Open in Threads`,

but it should never be the **only** place where the owner can complete the
interaction.

## Files To Touch

### Runtime

- Modify: `src/runtime/inbox.ts`
- Modify: `src/runtime/attention.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/serve.ts`

### Web UI

- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/web/surfaces/project/InboxTab.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/DoThisNext.svelte`
- Add: `src/web/lib/CardList.svelte`
- Add: `src/web/lib/CardListItem.svelte`
- Modify: `src/web/lib/router.ts`
- Modify: `src/web/lib/project-summary.ts` only if label/copy assumptions break tests

### Tests

- Modify: `src/runtime/__tests__/inbox.test.ts`
- Modify: `src/runtime/__tests__/thread.test.ts`
- Modify: `src/runtime/__tests__/serve-settings.test.ts`
- Modify: `src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts`
- Modify: `src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts`
- Modify: `src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts`
- Modify: `src/web/surfaces/__tests__/ProjectView.svelte.test.ts`
- Modify: `src/web/surfaces/__tests__/DoThisNext.svelte.test.ts`
- Modify: `src/web/lib/__tests__/router.test.ts`

### Docs / Tracking

- Modify: `internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md`
- Modify: `internal/audits/flow-audit.md`
- Modify: `.guildhall/PROGRESS.md`

---

### Task 1: Add explicit attention-vs-thread classification in the runtime

**Files:**
- Modify: `src/runtime/inbox.ts`
- Test: `src/runtime/__tests__/inbox.test.ts`

- [ ] **Step 1: Write the failing classification test**

Add a focused test that proves conversation-shaped inbox kinds are identifiable as thread-owned while project/runtime alerts remain attention-owned.

```ts
it('classifies conversation-shaped inbox items as thread-owned attention', async () => {
  const items = buildInbox({ projectPath: tmpDir })
  const question = items.find(item => item.kind === 'agent_question_pending')
  const migration = items.find(item => item.kind === 'required_migration')

  expect(question && isThreadOwnedInboxItem(question)).toBe(true)
  expect(migration && isThreadOwnedInboxItem(migration)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/inbox.test.ts --reporter=dot`
Expected: FAIL with `isThreadOwnedInboxItem is not defined` or equivalent missing export failure.

- [ ] **Step 3: Write minimal classification helpers**

Add explicit sets instead of ad-hoc `switch` logic so the taxonomy is reviewable.

```ts
const THREAD_OWNED_KINDS: ReadonlySet<InboxItem['kind']> = new Set([
  'project_check_in',
  'pressure_test_pending',
  'agent_question_pending',
  'brief_approval',
  'spec_approval',
  'open_escalation',
])

const ATTENTION_OWNED_KINDS: ReadonlySet<InboxItem['kind']> = new Set([
  'required_migration',
  'project_understanding',
  'bootstrap_missing',
  'setup_pending',
  'workspace_import_pending',
  'lever_questions',
  'spec_fill_pending',
])

export function isThreadOwnedInboxItem(item: Pick<InboxItem, 'kind'>): boolean {
  return THREAD_OWNED_KINDS.has(item.kind)
}

export function isAttentionOwnedInboxItem(item: Pick<InboxItem, 'kind'>): boolean {
  return ATTENTION_OWNED_KINDS.has(item.kind)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/__tests__/inbox.test.ts --reporter=dot`
Expected: PASS with the new classification test green and no regressions in existing item-kind tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/inbox.ts src/runtime/__tests__/inbox.test.ts
git commit -m "feat: classify thread-owned attention items"
```

### Task 2: Narrow the project attention snapshot to a true Needs You view

**Files:**
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/attention.ts`
- Test: `src/runtime/__tests__/serve-settings.test.ts`

- [ ] **Step 1: Write the failing snapshot test**

Add a server-level test that proves `/api/project/inbox` excludes thread-owned items from the open `Needs you` list while preserving them in history if previously recorded.

```ts
it('returns only attention-owned items in the open needs-you snapshot', async () => {
  const res = await app.fetch(new Request(scoped('/api/project/inbox')))
  const body = await res.json() as { items?: Array<{ kind?: string }> }

  expect(body.items?.some(item => item.kind === 'agent_question_pending')).toBe(false)
  expect(body.items?.some(item => item.kind === 'required_migration')).toBe(true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/serve-settings.test.ts --reporter=dot`
Expected: FAIL because `/api/project/inbox` still returns thread-shaped items in `items`.

- [ ] **Step 3: Filter the open snapshot, keep the ledger**

Keep `attention.json` reconciliation behavior for durable records, but return only attention-owned items in the open list. Do **not** delete historical records for thread-owned items yet.

```ts
const computedItems = [
  ...await buildProjectMigrationAdvisories(input.projectPath),
  ...buildProjectUnderstandingAdvisories(input.projectPath),
  ...buildInbox({ projectPath: input.projectPath }),
]
const attention = reconcileAttentionRecords({
  projectPath: input.projectPath,
  openItems: computedItems,
})
const visibleItems = attention.openItems.filter(isAttentionOwnedInboxItem)
const blockers = buildInboxBlockers(visibleItems)
return { items: visibleItems, history: attention.history, blockers }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/inbox.test.ts --reporter=dot`
Expected: PASS with the new filter behavior and no blocker/history regressions.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/serve.ts src/runtime/attention.ts src/runtime/__tests__/serve-settings.test.ts src/runtime/__tests__/inbox.test.ts
git commit -m "feat: narrow inbox snapshot to attention-owned items"
```

### Task 3: Promote thread-owned attention items into explicit Thread turns

**Files:**
- Modify: `src/runtime/thread.ts`
- Test: `src/runtime/__tests__/thread.test.ts`

- [ ] **Step 1: Write failing projection tests**

Add tests proving all thread-owned attention kinds already represented by tasks/intakes appear as `Thread`/`Threads` turns without relying on Inbox visibility.

```ts
it('projects spec approval as a thread turn even when inbox filtering hides it', async () => {
  const thread = buildThread({ projectPath, snapshot })
  expect(thread.turns.some(turn => turn.kind === 'spec_review')).toBe(true)
})

it('projects open escalations as thread turns even when inbox filtering hides them', async () => {
  const thread = buildThread({ projectPath, snapshot })
  expect(thread.turns.some(turn => turn.kind === 'escalation')).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify failures are real**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts --reporter=dot`
Expected: FAIL only if any thread-owned inbox kind was still depending on Inbox rather than Thread projection.

- [ ] **Step 3: Patch projection gaps minimally**

If any missing category is found, patch `buildThread` to project it from task/intake state directly instead of consulting the inbox snapshot. Use existing turn kinds before inventing new ones.

```ts
if (task.status === 'spec_review' && !hasVisibleQuestions(task)) {
  turns.push(specReviewTurn(task))
}
if (activeEscalations(task).length > 0) {
  turns.push(escalationTurn(task, escalation))
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/runtime/__tests__/thread.test.ts --reporter=dot`
Expected: PASS with no regressions in task, setup, bounded-chat, or recovery turns.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/thread.ts src/runtime/__tests__/thread.test.ts
git commit -m "feat: make thread own approval and escalation lifecycles"
```

### Task 4: Rename the primary surfaces in the UI without breaking routes

**Files:**
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/web/lib/router.ts`
- Test: `src/web/surfaces/__tests__/ProjectView.svelte.test.ts`
- Test: `src/web/lib/__tests__/router.test.ts`

- [ ] **Step 1: Write failing UI label tests**

Update/add tests that expect the nav labels to read `Threads` and `Needs you` while old routes keep working.

```ts
expect(screen.getByRole('button', { name: 'Threads' })).toBeInTheDocument()
expect(screen.getByText('Needs you')).toBeInTheDocument()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/lib/__tests__/router.test.ts --reporter=dot`
Expected: FAIL because the nav still renders `Thread` / `Inbox`.

- [ ] **Step 3: Apply copy-only navigation changes**

Keep URLs stable for this slice. Change labels, not route contracts.

```ts
subs: [
  { id: 'inbox', label: 'Needs you', path: currentProjectHref('/overview/inbox', activeProjectId) },
],
{ id: 'thread', label: 'Threads', icon: 'sparkles', suffix: '/thread' },
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/lib/__tests__/router.test.ts --reporter=dot`
Expected: PASS with route parsing unchanged and nav copy updated.

- [ ] **Step 5: Commit**

```bash
git add src/web/surfaces/ProjectView.svelte src/web/lib/router.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/lib/__tests__/router.test.ts
git commit -m "feat: rename thread and inbox surfaces for transition"
```

### Task 5: Recast InboxTab into a transitional Needs You view

**Files:**
- Modify: `src/web/surfaces/project/InboxTab.svelte`
- Test: `src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts`

- [ ] **Step 1: Write the failing grouping test**

Add UI tests that expect the page to lead with project/system alerts, explain that conversation work now lives in Threads, and still show attention history.

```ts
expect(screen.getByRole('heading', { name: /needs you/i })).toBeInTheDocument()
expect(screen.getByText(/project alerts/i)).toBeInTheDocument()
expect(screen.getByText(/thread-owned conversations now live in threads/i)).toBeInTheDocument()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts --reporter=dot`
Expected: FAIL because the tab still renders the generic `Needs you` table with no grouped framing.

- [ ] **Step 3: Implement grouped rendering**

Keep one component for now, but split the items into:

- `projectAlerts`
- `cleanupNudges`
- `history`

Suggested helper shape:

```ts
const projectAlerts = $derived(items.filter(item =>
  ['required_migration', 'project_understanding', 'bootstrap_missing', 'setup_pending', 'workspace_import_pending'].includes(item.kind),
))
const cleanupNudges = $derived(items.filter(item =>
  ['lever_questions', 'spec_fill_pending'].includes(item.kind),
))
```

Add a small top note:

```svelte
<Card tone="neutral">
  <p class="muted">Threads now carries active conversations, approvals, and question sessions. Needs you stays focused on project alerts and durable attention history during the transition.</p>
</Card>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts --reporter=dot`
Expected: PASS with grouped rendering and preserved dismiss/agent-action behavior for remaining alert kinds.

- [ ] **Step 5: Commit**

```bash
git add src/web/surfaces/project/InboxTab.svelte src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts
git commit -m "feat: recast inbox tab as transitional needs-you view"
```

### Task 6: Make Overview, Work, and Do This Next use the narrowed attention model cleanly

**Files:**
- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/DoThisNext.svelte`
- Test: `src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts`
- Test: `src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts`
- Test: `src/web/surfaces/__tests__/DoThisNext.svelte.test.ts`

- [ ] **Step 1: Write failing behavior tests**

Add/update tests to lock these rules:

- overview `next action` still shows real blockers from `Needs you`;
- work setup nudge still works for bootstrap/import alerts;
- `Do This Next` does not depend on thread-shaped inbox items for conversation flows.

```ts
expect(screen.getByText(/needs you/i)).toBeTruthy()
expect(screen.queryByText(/answer question/i)).toBeNull()
expect(screen.getByRole('link', { name: /open threads/i })).toBeInTheDocument()
```

- [ ] **Step 2: Run tests to verify failures**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts --reporter=dot`
Expected: FAIL anywhere these surfaces still assume question/approval/escalation items come from Inbox.

- [ ] **Step 3: Patch each surface to use the right source**

Guidelines:

- Overview:

```ts
const nextAlert = actionableInbox[0] ?? null
const threadsHref = currentProjectHref('/thread', activeProjectId)
```

- Work:

```ts
const setupInboxItem = inboxItems.find(item =>
  ['required_migration', 'bootstrap_missing', 'workspace_import_pending', 'setup_pending'].includes(item.kind),
)
```

- Do This Next:
  keep project alerts from Inbox; use a `Threads` CTA instead of pretending conversation items are still inbox rows.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm vitest run src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts --reporter=dot`
Expected: PASS with no dead-end CTA regressions.

- [ ] **Step 5: Commit**

```bash
git add src/web/surfaces/project/ProjectOverviewTab.svelte src/web/surfaces/project/WorkTab.svelte src/web/surfaces/DoThisNext.svelte src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts
git commit -m "feat: align overview and work with needs-you transition"
```

### Task 7: Add browser proof for the transitional IA

**Files:**
- Modify: `internal/audits/flow-audit.md`
- Modify: `.guildhall/PROGRESS.md`

- [ ] **Step 1: Prepare the installed app**

Run:

```bash
pnpm build
pnpm dev:install
guildhall stop
guildhall start
curl -s http://localhost:7777/api/stale-server
```

Expected: `stale:false`

- [ ] **Step 2: Verify Threads / Needs you behavior in the browser**

Check:

- project nav shows `Threads` and `Needs you`;
- `Threads` contains active question/approval/escalation flows;
- `Needs you` contains only project/system alerts plus cleanup/history;
- no active question is only reachable from `Needs you`;
- a done bounded chat still appears as a completed thread item;
- start blockers still point to the right `Needs you` alert when bootstrap/migration/import is incomplete.

- [ ] **Step 3: Capture focused verification commands**

Run:

```bash
pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-settings.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/lib/__tests__/router.test.ts --reporter=dot
pnpm typecheck
```

Expected: all green

- [ ] **Step 4: Record results in the living docs**

Add a flow-audit note that documents:

- which inbox kinds moved conceptually into Threads;
- which alert kinds remain in Needs you;
- any browser-observed mismatch still left for the later `#1` collapse.

- [ ] **Step 5: Commit**

```bash
git add internal/audits/flow-audit.md .guildhall/PROGRESS.md
git commit -m "docs: record threads and needs-you transition proof"
```

### Task 8: Queue the follow-up collapse to a single Threads surface

**Files:**
- Modify: `internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md`
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Add the explicit follow-up note**

Document that the transitional slice is complete only when:

- thread-owned items no longer depend on Inbox visibility;
- user-path proof is green;
- remaining `Needs you` items are clearly only alerts/ledger entries.

- [ ] **Step 2: Record the next collapse questions**

Add explicit follow-up prompts:

- Should `Needs you` become only a filter over Threads?
- Should required migration/bootstrap remain outside Threads permanently?
- Should resolved attention history move to a thread/event ledger instead of `attention.json`?

- [ ] **Step 3: Commit**

```bash
git add internal/plans/2026-05-31-guildhall-0-10-implementation-tracker.md internal/audits/flow-audit.md
git commit -m "docs: queue full threads collapse follow-up"
```

---

## Verification Matrix

Run these at the end of the full plan:

```bash
pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-settings.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/lib/__tests__/router.test.ts --reporter=dot
pnpm typecheck
pnpm build
```

Browser proof target:

```bash
pnpm dev:install
guildhall stop
guildhall start
open http://localhost:7777/projects/narrative-harness/thread
```

Expected browser outcomes:

- `Threads` shows the active owner-facing flow;
- `Needs you` shows only project/system alerts plus durable history;
- no owner question/approval is stranded outside `Threads`;
- Start is still gated by the correct blocker;
- done threads can be filtered/collapsed later, but remain visible in timeline order.

## Spec Coverage Check

- Bounded chat replacing scattered owner-input cards: covered by Tasks 2, 3, 6, and 7.
- Transitional `#2` model (`Threads + Work`, separate attention view): covered by Tasks 1 through 7.
- Preserving a path toward `#1` full merge: covered by Task 8.
- Durable alert/attention history not lost during the transition: covered by Task 2 and Task 7.
- Reverse-chronological thread-centric owner experience: covered by Tasks 3, 4, 6, and 7.

## Notes For The Implementer

- Do not invent a new persistence model in this slice.
- Do not rewrite `attention.json` into thread storage yet.
- Do not break existing URLs in this slice; label and behavior changes are enough.
- Prefer surfacing existing Thread turns over inventing new inbox-only rows.
- If a test reveals a category that is still inbox-only but should become a thread, patch Thread projection first, not Inbox copy.
