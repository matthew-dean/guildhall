# Guildhall Cognitive Overhead Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. As each step is completed, update this file in the same commit by changing that step to `- [x]` and adding the exact evidence command, result, or commit note requested by the step.

**Goal:** Reduce Guildhall's cognitive overhead by removing wrong legacy shapes, collapsing duplicate owner-input surfaces, shrinking Settings into a real configuration surface, and moving product/project-specific knowledge out of generic runtime code.

**Architecture:** Prefer hard conversions over long-lived compatibility shims. Existing persisted shapes that are wrong should be detected by required project migrations, converted into the correct model, and then removed from runtime, UI, and schema paths. Generic runtime modules should consume typed hierarchy, owner-input, thread, policy profile, and domain-adapter contracts rather than knowing about old task statuses, project-specific product names, or raw lever/card details. Bounded chat must become the durable owner-input session model, backed by the shared state-machine substrate and receipts, instead of a bespoke status object projected differently by every surface.

**Tech Stack:** TypeScript, Svelte 5, Vitest, existing Guildhall migration ledger, Guildhall MCP/artifact state, no new runtime dependency.

---

## Source Context

- `artifact:flow-audit`
- `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`
- `internal/plans/2026-05-31-guildhall-0-10-threads-needs-you-transition.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-05-27-guildhall-0-9-flexible-work-hierarchy-and-work-list.md`
- `internal/plans/2026-05-31-guildhall-generalization-overfitting-hardening.md`
- `internal/constitutions/design-system-governance.md`
- `src/core/task.ts`
- `src/runtime/state-machine.ts`
- `src/runtime/project-graph.ts`
- `src/runtime/structural-map.ts`
- `src/runtime/capability-request-machine.ts`
- `src/runtime/work-hierarchy.ts`
- `src/runtime/bounded-chat.ts`
- `src/runtime/thread.ts`
- `src/runtime/inbox.ts`
- `src/runtime/evidence-work-graph-intake.ts`
- `src/runtime/design-feedback.ts`
- `src/web/surfaces/project/SettingsTab.svelte`

## Latest Commit Reincorporation: `d508302f`

Reviewed current `HEAD` on 2026-06-01:

```text
d508302f Merge branch 'feature/0.10-structural-domain-intelligence' into 0.10.0
```

First-parent diff from the prior reduction-plan commit adds the structural
domain/project graph work:

- `src/runtime/state-machine.ts`
- `src/runtime/capability-request-machine.ts`
- `src/runtime/project-graph.ts`
- `src/runtime/structural-map.ts`
- graph and structural endpoints in `src/runtime/serve.ts`
- structural context slices in `src/runtime/context-builder.ts`,
  `src/runtime/context-observability.ts`, and
  `src/runtime/effective-memory-packet.ts`
- project graph UI in `src/web/surfaces/project/SettingsTab.svelte`
- focused tests for state machines, capability grants, project graph, settings,
  context, effective memory, and structural map behavior

Reduction conclusions from the merge:

1. **Keep the generic state-machine substrate.** It is the right abstraction for
   reducing lifecycle sprawl. Task status cleanup should reuse
   `src/runtime/state-machine.ts` instead of creating a parallel transition
   primitive.
2. **Keep structural map and project graph as product-core concepts.** They
   clarify authority, routing, and cross-project work boundaries. They are not
   chopping-block candidates by default.
3. **Cut the UI placement, not the model.** The merge put Project graph state,
   API calls, assignment picker state, request actions, and rendering into
   `SettingsTab.svelte`, expanding the already overloaded Settings cockpit.
   Project graph review/assignment should move to a focused project-structure
   panel. Settings may show readiness or a link, but not own graph behavior.
4. **Owner-review decisions belong with owner input.** Structural-map questions
   and graph assignment choices may be summarized in a project-structure panel,
   but discussion and clarification should route through Threads/bounded chat.
5. **Design-system governance is now constitutional.** The plan no longer treats
   UI cleanup as "add more tokens." `internal/constitutions/design-system-governance.md`
   is the source of law for token roles, component contracts, variant budgets,
   deletion criteria, and deterministic checks.
6. **Use the merged state-machine substrate for bounded chat.** The merge's
   `src/runtime/state-machine.ts` is the right shared abstraction for lifecycle
   cleanup. Bounded chat must reuse it with receipts instead of continuing as a
   bespoke `status` object with ad hoc mutation paths.

## Plan Tracking Discipline

This document is the execution checklist, not a static design note.

Rules for agents implementing this plan:

1. Before starting a task, read the whole task and confirm no newer checked item
   contradicts it.
2. When a step is completed, update that exact checkbox from `- [ ]` to
   `- [x]` in the same commit as the work.
3. Under the completed step, add an `Evidence:` bullet with the command run,
   test result, migration result, browser proof, or commit hash.
4. Do not mark a step checked because code was edited. Mark it checked only
   after the step's expected verification passes.
5. If a step is intentionally deferred, leave it unchecked and add a `Blocked:`
   or `Deferred:` bullet explaining the specific reason and the next owner.
6. Do not keep private scratch checklists that drift from this file. If the work
   changes, update this plan.

## Reduction Policy

1. **Wrong persisted shapes get conversion scripts, not compatibility architecture.**
   The migration layer may detect old fields and rewrite them. Normal runtime and UI code must stop inferring from those old fields after the migration lands.

2. **Required migrations block normal project work.**
   If a project still has `status: "parent"` tasks, hierarchy encoded in `parentGoalId`, or task-level `openQuestions`, Guildhall should report a required migration through the existing migration ledger and route the owner to migration review before Start or New request continues.

3. **Generic runtime code cannot mention sample products.**
   `src/runtime/*` generic modules must not hardcode `Looma`, `Knit`, `AlertDialog`, `Dialog`, or `Drawer` as project-specific branches. If those examples remain useful, they belong in fixtures, examples, or a configured adapter outside the generic path.

4. **Settings is not a dump zone.**
   Settings should answer: "Can this project run, who coordinates it, which provider/config is active, and which operating profile is selected?" Memory review, re-intake, design feedback, codebase-map diagnostics, raw lever editing, and local development hooks should move into narrower tools or hidden developer surfaces.

5. **A smaller file is not automatically a better abstraction.**
   Every split must give a module one clear responsibility, a typed boundary, and focused tests. Do not create a folder of tiny components that still share one tangled state object.

6. **Design tokens and UI components need governance, not just more tokens.**
   A component that uses tokens can still be sprawling if every surface chooses its own size, weight, density, radius, or variant vocabulary. Typography, spacing, radius, elevation, tone, and component variants must have named roles and budgets. Surface-local styling should compose those roles, not invent one-off scales.

   Source of law: `internal/constitutions/design-system-governance.md`.

7. **Owner input is a linked session, not a local question card.**
   Structural map, task shaping, project graph, capability request, request
   intake, recovery, and settings flows must create or reuse an
   `OwnerInputRequest` linked to one bounded-chat session. Thread, Needs You,
   Overview, Settings, Work, and Structure surfaces may project that same
   session; they must not each invent their own question model, inbox item, card
   branch, or status field.

8. **Bounded chat is not a pressure-test question.**
   Projecting a bounded-chat session as `pressure_test_question` hides the real
   domain model and spreads special cases through Thread, Inbox, and UI tests.
   Bounded chat needs a first-class `bounded_chat`/`owner_input` projection
   family. Any future pressure-test-specific UI must be a separate, explicit
   domain, not the generic wrapper for owner input.

## Non-Goals

- Do not remove bounded chat, Threads, MCP/artifacts, evidence-backed completion, the task/work hierarchy model, or release proof. Those are core product concepts.
- Do not rewrite the entire orchestrator in one pass. Add a transition boundary where it reduces current risk, then migrate hot paths.
- Do not turn raw levers into public product concepts. Keep the lever engine, but stop asking owners to scan every knob by default.
- Do not preserve `parent` as a status or `openQuestions` as a normal task field after the conversion migration.

## Cutover Acceptance Matrix

| Area | Old shape to remove | New shape | Acceptance |
| --- | --- | --- | --- |
| Work hierarchy | `status: "parent"` | `task.hierarchy` links plus completion boundary/readiness | `TaskStatus` has no `parent`; conversion rewrites old queues; picker never dispatches containing work as runnable implementation. |
| Hierarchy source | `parentGoalId` as containment | `hierarchy.parentId` and `hierarchy.childIds` | Runtime and UI hierarchy builders do not infer containment from `parentGoalId`. |
| Business envelope | `parentGoalId` name | `businessEnvelope.goalId` or `scopeEnvelope.goalId` | Business-envelope code no longer uses a field name that implies hierarchy. |
| Owner questions | `task.openQuestions`, `StructuralMapDraft.ownerQuestions`, graph/local question arrays, and surface-local prompt cards | `OwnerInputRequest` records linked to bounded-chat sessions | Required migrations and source adapters create one linked session per owner decision; source models keep refs/status summaries, not local question state. |
| Bounded-chat lifecycle | bespoke `status` object and direct mutation helpers | `boundedChatMachine` backed by `src/runtime/state-machine.ts` receipts | Bounded-chat transitions use `transition`/`applyTransitionCommand`; sessions persist receipts; tests cover idempotent command replay and rejected illegal transitions. |
| Thread projection | bounded chats disguised as `pressure_test_question` | first-class `bounded_chat` or `owner_input` turn family | `src/runtime/thread.ts` and `ThreadTab.svelte` never map bounded-chat sessions to `pressure_test_question`; tests fail on that string for bounded chat fixtures. |
| Owner-input projections | Thread, Inbox, Overview, Settings, Work, and Structure each invent question cards | every surface projects the same linked bounded-chat session | Thread owns conversation; Needs You owns alerts; Overview/Settings/Structure/Work show links/status only and do not mutate owner-input state directly. |
| Attention | Inbox as conversation plus alert queue | Threads for conversations, Needs You for alerts | `InboxItem` no longer includes thread-owned conversation kinds. |
| Settings | 4,258-line all-purpose surface | small shell plus focused panels | `SettingsTab.svelte` is below 400 lines and owns only section routing/composition. |
| Levers | raw list of every lever | operating profiles plus changed overrides | Owner sees profile summary by default; raw editor is developer-only/hidden. |
| Work graph | Looma/Knit/Dialog/Drawer branches | configured domain adapters | Generic runtime tests fail on leaked sample-product vocabulary. |
| State machines | one-off transition helpers per lifecycle | shared `src/runtime/state-machine.ts` plus lifecycle-specific machines | Task transition cleanup reuses the generic state-machine substrate and does not add another transition framework. |
| Project graph UI | Settings owns graph state/API/rendering | focused project-structure graph panel plus Settings readiness link | `SettingsTab.svelte` has no `ProjectGraphView`, graph assignment picker state, or `/api/project/project-graph` calls. |
| Structural map review | hidden diagnostics or Settings branch | focused structure review with Thread-owned questions | Owner questions route to Threads/bounded chat; structure panel shows review state and actions only. |
| Design tokens | `--fs-*`, `--s-*`, raw weights, raw clamp sizes, duplicate type roles | one canonical `--gh-*` token family plus named text/spacing/elevation roles | Token audit reports no unmanaged font sizes, font weights, spacing, radii, or negative letter spacing outside the token/component layer. |
| Component options | bespoke cards, panels, chips, status rows, and ad hoc bolding | governed component contracts with variant budgets | Component audit documents every primitive, owner, allowed variants, and replacement path for duplicates. |
| UI primitives | parallel local/package card/notice systems | package UI foundation plus temporary wrappers | New or touched surfaces import the canonical primitive family. |

## File Structure

### Migrations and Model Cutovers

- Create `src/runtime/task-hierarchy-migration.ts`
  - Detects old hierarchy encodings in raw `.guildhall/TASKS.json`.
  - Converts `status: "parent"` and hierarchy-shaped `parentGoalId` into explicit `task.hierarchy`.
  - Rewrites containing work to non-dispatchable readiness without adding a new lifecycle status.
- Create `src/runtime/__tests__/task-hierarchy-migration.test.ts`
  - Covers dry-run, apply, idempotency, old parent status removal, hierarchy link creation, and cycle rejection.
- Create `scripts/migrations/0.10.0-task-hierarchy.mjs`
  - Wrapper that builds first and shells to `guildhall migrate apply --migration 0.10.0/task-hierarchy-links`.
- Modify `src/runtime/migrations.ts`
  - Adds required migration `0.10.0/task-hierarchy-links`.
- Modify `src/core/task.ts`
  - Removes `parent` from `TaskStatusValue`.
  - Keeps `WorkHierarchy` and `WorkCompletionBoundary`.
  - Adds the replacement business-envelope field before removing `parentGoalId`.
- Modify `src/runtime/work-hierarchy.ts`
  - Removes `legacyParentTaskId`.
  - Treats only explicit `hierarchy` fields as containment.
- Modify `src/web/lib/work-hierarchy.ts`
  - Mirrors the runtime explicit-link behavior.
- Modify `src/tools/task-queue.ts`
  - `materializeRequiredSplitChildren` writes hierarchy links and readiness, not `parent` status.
- Modify `src/runtime/orchestrator-picker.ts`
  - Ensures containing work is not picked as runnable worker work unless a future explicit event says the containing work itself is ready for review/closure.

### Owner Input and Threads

- Create `src/runtime/owner-input.ts`
  - Defines `OwnerInputRequest`, `OwnerInputSource`, `OwnerInputTarget`,
    `OwnerInputRequestStatus`, and source-link helpers.
  - Owns "one owner decision, one bounded-chat session link" semantics.
  - Source kinds include `task`, `structural_map`, `project_graph`,
    `capability_request`, `request_intake`, `project_check_in`,
    `recovery_decision`, and `settings`.
- Create `src/runtime/owner-input-store.ts`
  - Persists owner-input request records under `.guildhall/owner-input/`.
  - Provides idempotent create-or-link behavior keyed by source kind/id/question
    id, so migrations and refreshes do not duplicate sessions.
- Create `src/runtime/bounded-chat-machine.ts`
  - Defines `boundedChatMachine` using `src/runtime/state-machine.ts`.
  - Events include `activate`, `wait_for_owner`, `submit_owner_response`,
    `request_coordinator_review`, `fulfill`, `block`, and `cancel`.
  - Exports transition helpers that append receipts to bounded-chat sessions.
- Create `src/runtime/task-question-migration.ts`
  - Converts unanswered `task.openQuestions` into `OwnerInputRequest` records
    linked to bounded-chat sessions.
  - Removes answered task questions after preserving answer evidence in task
    notes or bounded-chat accepted state.
- Create `src/runtime/__tests__/task-question-migration.test.ts`
  - Proves conversion, idempotency, no duplicate owner-input records, and no
    duplicate bounded-chat sessions.
- Create `src/runtime/__tests__/owner-input.test.ts`
  - Proves every source kind can create one owner-input request linked to one
    bounded-chat session.
- Create `src/runtime/__tests__/bounded-chat-machine.test.ts`
  - Proves legal/rejected transitions, receipt persistence, and command
    idempotency.
- Add migration `0.10.0/task-open-questions-to-bounded-chat` in `src/runtime/migrations.ts`.
- Modify `src/core/task.ts`
  - Removes `openQuestions` from the normal `Task` schema after migration is active.
- Modify or remove `src/tools/post-user-question.ts`
  - Replace task question writes with an owner-input start API/tool.
- Modify `src/runtime/bounded-chat.ts`
  - Remove direct lifecycle mutation as the primary path.
  - Persist transition receipts on sessions.
  - Keep schema compatibility only inside migration readers, not normal
    mutation code.
- Modify `src/runtime/structural-map.ts`
  - Replace durable `ownerQuestions` arrays with owner-input request refs or a
    review summary that points to linked sessions.
  - Structural-map review state may require owner input, but questions live in
    bounded chat.
- Modify `src/runtime/project-graph.ts`
  - Create owner-input requests for assignment/review choices that need owner
    discussion rather than local graph-specific question state.
- Modify `src/runtime/capability-request-machine.ts`
  - Use owner-input requests for owner decisions about capability grants when a
    coordinator cannot decide alone.
- Modify `src/runtime/thread.ts`
  - Add a first-class `bounded_chat` or `owner_input` turn family instead of
    projecting bounded chat as `pressure_test_question`.
  - Thread turn ids should link back to the `OwnerInputRequest.id` and
    `BoundedChatSession.id`.
- Modify `src/runtime/inbox.ts`
  - Delete thread-owned conversation item kinds from `InboxItem`.
- Modify `src/runtime/attention.ts`
  - Summarize waiting owner-input sessions as alert links only when something is
    actionable; do not duplicate conversation state.
- Modify `src/web/surfaces/project/ThreadTab.svelte`
  - Split into smaller components while keeping Threads as the canonical owner-input surface.
- Modify `src/web/surfaces/project/ProjectOverviewTab.svelte`,
  `src/web/surfaces/project/WorkTab.svelte`,
  `src/web/surfaces/project/SettingsTab.svelte`, and
  `src/web/surfaces/project/structure/*`
  - Show status and navigation links to the linked bounded-chat session.
  - Do not create surface-local question cards or local question status fields.
- Modify `src/web/surfaces/project/InboxTab.svelte`, `src/web/surfaces/FleetNeedsYou.svelte`, and `src/web/surfaces/DoThisNext.svelte`
  - Remove conversation-kind branching and stale Inbox copy.

### Settings Reduction

- Create `src/web/surfaces/project/settings/types.ts`
  - Shared typed payloads for settings panels.
- Create `src/web/surfaces/project/settings/settings-store.svelte.ts`
  - Loads and mutates settings data by concern instead of one component owning all endpoint state.
- Create `src/web/surfaces/project/settings/SettingsReadyPanel.svelte`
  - Bootstrap/runtime/provider/coordinator readiness only.
- Create `src/web/surfaces/project/settings/SettingsIdentityPanel.svelte`
  - Project name, slug, and worktree include files.
- Create `src/web/surfaces/project/settings/SettingsCoordinatorsPanel.svelte`
  - Coordinator list/readout.
- Create `src/web/surfaces/project/settings/OperatingProfilePanel.svelte`
  - Owner-facing profile plus changed overrides.
- Create `src/web/surfaces/project/settings/DeveloperToolsPanel.svelte`
  - Migrations, codebase-map diagnostics, raw lever editor, and local development hooks behind an explicit developer affordance.
- Create `src/web/surfaces/project/structure/project-graph-store.svelte.ts`
  - Loads project graph data and owns graph mutations, assignment picker state,
    and request actions outside Settings.
- Create `src/web/surfaces/project/structure/ProjectStructurePanel.svelte`
  - Focused project-structure shell for structural map and project graph review.
- Create `src/web/surfaces/project/structure/ProjectGraphPanel.svelte`
  - Renders domain responsibility assignment, inbound/outgoing requests, and
    delivery review without embedding that logic in Settings.
- Create `src/web/surfaces/project/structure/StructuralMapReviewPanel.svelte`
  - Shows map state, conflicts, accepted authority roots, and Thread links for
    owner questions.
- Modify `src/web/surfaces/project/SettingsTab.svelte`
  - Reduce to a shell under 400 lines.
  - Render only Settings sections, not memory/re-intake/design-intelligence internals.
  - Remove the `graph` section, `ProjectGraphView` interface, graph fetches,
    assignment picker state, and graph action handlers.
- Modify `src/web/surfaces/ProjectView.svelte`
  - Routes the focused project-structure panel from the project surface, separate
    from Settings.
- Create or move to `src/web/surfaces/project/intelligence/`
  - `ProjectMemoryPanel.svelte`
  - `ProjectReintakePanel.svelte`
  - `DesignIntelligencePanel.svelte`
  - These become project-intelligence/review tools, not Settings sections.
- Create `src/levers/profiles.ts`
  - Defines operating profiles and maps them to lever positions.
- Create `src/levers/__tests__/profiles.test.ts`
  - Proves profile application and override summaries.
- Modify `src/levers/schema.ts`, `src/levers/storage.ts`
  - Remove deprecated `merge_policy` after a migration rewrites it to `landing_strategy`.

### Generic Runtime Adapter Extraction

- Create `src/runtime/work-graph-domain-adapters.ts`
  - Generic adapter contract for target labels, proof paths, consumer surfaces, integration task titles, and deliverable normalization.
- Create `src/runtime/__tests__/work-graph-domain-adapters.test.ts`
  - Proves generic output for UI component, backend API, CLI, docs, migration, bugfix, and single-edit units.
- Modify `src/runtime/evidence-work-graph-intake.ts`
  - Remove product-specific branches and call the adapter contract.
- Modify `src/runtime/design-feedback.ts`
  - Rename Looma-specific records to generic design-system improvement records.
  - Replace `discoverLoomaDevelopmentHook` with configured design-system development targets.
- Modify `src/runtime/design-system-discovery.ts`
  - Keep detected design systems as data, not runtime branches.
- Modify `src/runtime/serve.ts`
  - Return generic design-system development hook status.
- Move `src/runtime/guildhall.config.ts`
  - If still useful, move to `internal/fixtures/looma-knit/guildhall.config.ts` or `examples/looma-knit/guildhall.config.ts`.
  - Generic runtime imports must not depend on it.
- Modify `src/runtime/init.ts` and `src/tools/agent-settings-tool.ts`
  - Replace Looma/Knit examples with neutral coordinator examples.

### UI Primitive Consolidation

- Create `internal/audits/2026-06-01-ui-component-token-governance.md`
  - Documents the current component/token sprawl, duplicate primitives, raw font/spacing/weight patterns, and the intended component ownership map.
- Create `packages/ui/src/component-constitution.ts`
  - Defines canonical component roles, variant budgets, tone vocabulary, typography roles, spacing roles, and allowed exceptions.
- Create `scripts/design-token-audit.mjs`
  - Fails on unmanaged font sizes, font weights, line heights, spacing, radius, negative letter spacing, old token families, and local component lookalikes.
- Create `scripts/design-token-audit.test.ts`
  - Proves the scanner catches raw typography/spacing and permits token definitions.
- Modify `packages/ui/src/styles.css` and the token source that generates it.
  - Add named typography roles and component role tokens instead of letting every component choose scale numbers directly.
- Modify `src/web/tokens.css`
  - Replace old `--fs-*`, `--s-*`, and `--r-*` as public app tokens with aliases to canonical `--gh-*` only during migration, then delete app-local scale ownership.
- Modify package UI components.
  - Remove one-off values such as local line-height numbers, arbitrary rem padding, and component-specific font-weight choices unless they are backed by a named role.
- Modify high-sprawl app surfaces.
  - Start with `SettingsTab.svelte`, `ThreadTab.svelte`, `ProjectView.svelte`, `WorkspaceImportTab.svelte`, `FleetNeedsYou.svelte`, and `DoThisNext.svelte`.
- Create `src/web/lib/ui-compat/`
  - Temporary wrappers for old local primitives that delegate to `packages/ui` components.
- Modify touched surfaces to import canonical package UI primitives.
- Remove duplicate local primitives once no callers remain:
  - `src/web/lib/NoticeBand.svelte`
  - local card wrappers that duplicate `packages/ui/src/components/FrameCard.svelte`
- Create `scripts/ui-primitive-scan.mjs`
  - Fails on new direct imports of deprecated local primitives.

### Lifecycle Transition Boundary

- Create `src/runtime/task-transition.ts`
  - Provides an event-based wrapper around high-risk task transitions by reusing
    `src/runtime/state-machine.ts`.
  - First events: `mark_ready`, `start_worker`, `request_review`, `start_gate_check`, `complete`, `block`, `shelve`.
  - Do not add `hold`/`resume` in this pass. Current task records have hold
    metadata but no clean held lifecycle state; model that separately only if a
    later migration creates a real state.
- Create `src/runtime/__tests__/task-transition.test.ts`
  - Proves legal and rejected transitions for the wrapped hot paths.
- Modify writer hot paths incrementally:
  - `src/runtime/orchestrator.ts`
  - `src/runtime/intake.ts`
  - `src/tools/task-queue.ts`
  - `src/runtime/import-drafts.ts`
  - `src/runtime/merge-dispatcher.ts`
- Keep this aligned with `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`.

### Guardrails

- Create `scripts/reduction-guardrails.mjs`
  - Fails when generic runtime code regresses into known bad shapes.
- Add `pnpm lint:reductions`.
- Run it in release smoke after the migration lands.

## Task 1: Add Reduction Guardrails

**Files:**
- Create: `scripts/reduction-guardrails.mjs`
- Create: `src/runtime/__tests__/reduction-guardrails.test.ts`
- Modify: `package.json`

- [x] **Step 1: Write the failing test**
  - Evidence: Created `src/runtime/__tests__/reduction-guardrails.test.ts` with the specified `execFileSync(process.execPath, ['scripts/reduction-guardrails.mjs'])` assertion.

Create `src/runtime/__tests__/reduction-guardrails.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'

describe('reduction guardrails', () => {
  it('keeps generic runtime free of sample-product branches', () => {
    expect(() => {
      execFileSync(process.execPath, ['scripts/reduction-guardrails.mjs'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      })
    }).not.toThrow()
  })
})
```

- [x] **Step 2: Run test to confirm current red**
  - Evidence: `pnpm vitest run src/runtime/__tests__/reduction-guardrails.test.ts --reporter=dot` failed with `MODULE_NOT_FOUND` for `scripts/reduction-guardrails.mjs`, the expected red state.

Run:

```bash
pnpm vitest run src/runtime/__tests__/reduction-guardrails.test.ts --reporter=dot
```

Expected: FAIL because `scripts/reduction-guardrails.mjs` does not exist.

- [x] **Step 3: Add the guardrail script**
  - Evidence: Created `scripts/reduction-guardrails.mjs` with forbidden runtime vocabulary and legacy task-shape checks from this plan, allowing nested runtime `__tests__` fixtures so the guardrail focuses on shipping/runtime paths.

Create `scripts/reduction-guardrails.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

const forbiddenRuntimeWords = [
  /\bLooma\b/,
  /\bKnit\b/,
  /\bAlertDialog\b/,
]

const allowedWordPaths = [
  /^internal\//,
  /^examples\//,
  /^src\/runtime\/(?:.*\/)?__tests__\//,
  /^src\/runtime\/release-proof-matrix\.ts$/,
  /^src\/runtime\/app-spec-smoke\.ts$/,
]

const forbiddenTaskShapes = [
  {
    path: /^src\/core\/task\.ts$/,
    pattern: /['"]parent['"]/,
    message: 'TaskStatus must not contain parent. Use task.hierarchy links and readiness.',
  },
  {
    path: /^src\/runtime\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Runtime hierarchy must not infer containment from parentGoalId after migration.',
  },
  {
    path: /^src\/web\/lib\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Web hierarchy must not infer containment from parentGoalId after migration.',
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|svelte|js|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const failures = []
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  if (rel.startsWith('src/runtime/') && !allowedWordPaths.some(pattern => pattern.test(rel))) {
    for (const pattern of forbiddenRuntimeWords) {
      if (pattern.test(text)) failures.push(`${rel}: generic runtime contains ${pattern}`)
    }
  }
  for (const rule of forbiddenTaskShapes) {
    if (rule.path.test(rel) && rule.pattern.test(text)) failures.push(`${rel}: ${rule.message}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
```

- [x] **Step 4: Add package script**
  - Evidence: Added `"lint:reductions": "node scripts/reduction-guardrails.mjs"` to `package.json`.

Add to `package.json` scripts:

```json
"lint:reductions": "node scripts/reduction-guardrails.mjs"
```

- [x] **Step 5: Run and keep red until the reduction tasks land**
  - Evidence: `pnpm lint:reductions` failed with expected existing violations in `src/core/task.ts`, generic runtime sample-product leaks, runtime/web hierarchy inference, and exit code 1.

Run:

```bash
pnpm lint:reductions
```

Expected before the reduction tasks land: FAIL on current generic-runtime leaks and legacy hierarchy inference.

Commit:

```bash
git add package.json scripts/reduction-guardrails.mjs src/runtime/__tests__/reduction-guardrails.test.ts
git commit -m "test: add cognitive overhead guardrails"
```

## Task 2: Convert Task Hierarchy and Delete `parent` Status

**Files:**
- Create: `src/runtime/task-hierarchy-migration.ts`
- Create: `src/runtime/__tests__/task-hierarchy-migration.test.ts`
- Create: `scripts/migrations/0.10.0-task-hierarchy.mjs`
- Modify: `src/runtime/migrations.ts`
- Modify: `src/core/task.ts`
- Modify: `src/runtime/work-hierarchy.ts`
- Modify: `src/web/lib/work-hierarchy.ts`
- Modify: `src/tools/task-queue.ts`
- Modify: `src/runtime/orchestrator-picker.ts`
- Modify tests that construct `status: 'parent'`

- [x] **Step 1: Write migration tests**
  - Evidence: Added `src/runtime/__tests__/task-hierarchy-migration.test.ts` covering old `status: "parent"` conversion, hierarchy-shaped `parentGoalId` links, non-hierarchy `businessEnvelope.goalId`, idempotency, and cycle rejection.

Create `src/runtime/__tests__/task-hierarchy-migration.test.ts`:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateTaskHierarchyState } from '../task-hierarchy-migration.js'

const now = '2026-06-01T12:00:00.000Z'

async function projectWithTasks(tasks: unknown[]) {
  const root = await mkdtemp(path.join(tmpdir(), 'guildhall-hierarchy-'))
  const state = path.join(root, '.guildhall')
  await writeFile(path.join(root, 'guildhall.yaml'), 'name: Demo\n')
  await import('node:fs/promises').then(fs => fs.mkdir(state, { recursive: true }))
  await writeFile(path.join(state, 'TASKS.json'), JSON.stringify({ version: 1, lastUpdated: now, tasks }, null, 2))
  return root
}

describe('task hierarchy migration', () => {
  it('rewrites parent status and parentGoalId containment into explicit hierarchy links', async () => {
    const root = await projectWithTasks([
      { id: 'feature-shell', title: 'Feature shell', description: 'Container', domain: 'product', projectPath: rootMarker(), status: 'parent', priority: 'normal', parentGoalId: 'goal-task-feature-shell', notes: [], dependsOn: [] },
      { id: 'child-a', title: 'Child A', description: 'Do A', domain: 'product', projectPath: rootMarker(), status: 'ready', priority: 'normal', parentGoalId: 'goal-task-feature-shell', notes: [], dependsOn: [] },
      { id: 'child-b', title: 'Child B', description: 'Do B', domain: 'product', projectPath: rootMarker(), status: 'blocked', priority: 'normal', parentGoalId: 'goal-task-feature-shell', notes: [], dependsOn: [] },
    ])

    const dryRun = await migrateTaskHierarchyState({ projectRoot: root, apply: false, now })
    expect(dryRun.changedTasks).toEqual(['feature-shell', 'child-a', 'child-b'])

    const applied = await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    expect(applied.changedTasks).toEqual(['feature-shell', 'child-a', 'child-b'])

    const raw = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    const feature = raw.tasks.find((task: { id: string }) => task.id === 'feature-shell')
    const childA = raw.tasks.find((task: { id: string }) => task.id === 'child-a')
    const childB = raw.tasks.find((task: { id: string }) => task.id === 'child-b')

    expect(feature.status).toBe('ready')
    expect(feature.parentGoalId).toBeUndefined()
    expect(feature.hierarchy.childIds).toEqual(['child-a', 'child-b'])
    expect(feature.taskReadiness.recommendation).toBe('split')
    expect(feature.completionBoundary.requiredChildPolicy).toBe('all_required_done')
    expect(childA.parentGoalId).toBeUndefined()
    expect(childA.hierarchy.parentId).toBe('feature-shell')
    expect(childB.parentGoalId).toBeUndefined()
    expect(childB.hierarchy.parentId).toBe('feature-shell')
  })

  it('is idempotent after the first apply', async () => {
    const root = await projectWithTasks([
      { id: 'feature-shell', title: 'Feature shell', description: 'Container', domain: 'product', projectPath: rootMarker(), status: 'parent', priority: 'normal', parentGoalId: 'goal-task-feature-shell', notes: [], dependsOn: [] },
      { id: 'child-a', title: 'Child A', description: 'Do A', domain: 'product', projectPath: rootMarker(), status: 'ready', priority: 'normal', parentGoalId: 'goal-task-feature-shell', notes: [], dependsOn: [] },
    ])
    await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    const second = await migrateTaskHierarchyState({ projectRoot: root, apply: true, now })
    expect(second.changedTasks).toEqual([])
  })
})

function rootMarker() {
  return '/repo/demo'
}
```

- [x] **Step 2: Run tests and confirm red**
  - Evidence: `pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts --reporter=dot` initially failed because `src/runtime/task-hierarchy-migration.ts` did not exist.

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts --reporter=dot
```

Expected: FAIL because `task-hierarchy-migration.ts` does not exist.

- [x] **Step 3: Implement `migrateTaskHierarchyState`**
  - Evidence: Added `src/runtime/task-hierarchy-migration.ts`; `pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts --reporter=dot` passed after implementation.

Create `src/runtime/task-hierarchy-migration.ts` with these exported types and behavior:

```ts
export interface TaskHierarchyMigrationInput {
  projectRoot: string
  apply: boolean
  now?: string
}

export interface TaskHierarchyMigrationResult {
  changedTasks: string[]
  backupPath?: string
  affectedPaths: string[]
}
```

Implementation rules:

- Read `.guildhall/TASKS.json` as raw JSON so old shapes can be converted before the new `Task` schema rejects them.
- Accept both array and `{ version, lastUpdated, tasks }` queue shapes.
- Build a task map by `id`.
- Treat `parentGoalId: "goal-task-<id>"` as an old containment pointer only when `<id>` resolves to an existing task id after checking exact id and `task-` prefix removal.
- For each old containing task:
  - set `status` to `ready`;
  - set `hierarchy.childIds` to the sorted children found from old pointers plus any existing explicit children;
  - set `workKind` to existing value or `feature_spec`;
  - set `taskReadiness.recommendation` to `split`;
  - add `completionBoundary` with `requiredChildPolicy: "all_required_done"` if missing;
  - remove `parentGoalId`.
- For each child:
  - set `hierarchy.parentId`;
  - set `hierarchy.order`;
  - remove `parentGoalId` when it was used only as hierarchy containment.
- Write a backup file next to `TASKS.json` before applying:
  - `.guildhall/TASKS.before-0.10.0-task-hierarchy-links.json`.
- Reject cycles by throwing an error before writing.

- [x] **Step 4: Register the required migration**
  - Evidence: Registered required migration `0.10.0/task-hierarchy-links` in `src/runtime/migrations.ts` with dry-run detection and apply summary.

Add to `BUILT_IN_PROJECT_MIGRATIONS` in `src/runtime/migrations.ts`:

```ts
{
  id: '0.10.0/task-hierarchy-links',
  title: 'Convert parent task status into explicit work hierarchy links',
  introducedIn: '0.10.0',
  scope: 'project',
  safety: 'prompt',
  requirement: 'required',
  summary: 'Rewrites status: parent and hierarchy-shaped parentGoalId fields into task.hierarchy links.',
  async detect(projectRoot) {
    const result = await migrateTaskHierarchyState({ projectRoot, apply: false })
    return {
      needed: result.changedTasks.length > 0,
      affectedPaths: result.affectedPaths,
    }
  },
  async apply(projectRoot) {
    const result = await migrateTaskHierarchyState({ projectRoot, apply: true })
    return {
      summary: `Converted ${result.changedTasks.length} task hierarchy record${result.changedTasks.length === 1 ? '' : 's'} into explicit links.`,
      affectedPaths: result.affectedPaths,
    }
  },
}
```

- [x] **Step 5: Add migration wrapper**
  - Evidence: Added `scripts/migrations/0.10.0-task-hierarchy.mjs` to run the built CLI migration after `pnpm build`.

Create `scripts/migrations/0.10.0-task-hierarchy.mjs`:

```js
#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cli = join(root, 'dist', 'cli.js')

if (!existsSync(cli)) {
  console.error('[guildhall] dist/cli.js not found. Run `pnpm build` before using this migration script.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [
  cli,
  'migrate',
  'apply',
  '--migration',
  '0.10.0/task-hierarchy-links',
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
```

- [x] **Step 6: Remove `parent` from the task status schema**
  - Evidence: Removed `parent` from `TaskStatusValue`, added the hierarchy migration comment above `Task.hierarchy`, and updated project-manager prompt text to `businessEnvelope.goalId`.

Modify `src/core/task.ts`:

- Remove the lifecycle diagram branch that says `parent`.
- Remove `'parent'` from `TaskStatusValue`.
- Add a comment above `hierarchy`:

```ts
// Work containment is represented by hierarchy links, never by task status.
// Required migration 0.10.0/task-hierarchy-links converts old status: parent
// records before normal runtime paths parse task queues.
```

- [x] **Step 7: Stop writing parent status**
  - Evidence: `materializeRequiredSplitChildren` now writes explicit hierarchy links, keeps containing work in a non-terminal normal status, sets split readiness with a complete typed record, and copies `businessEnvelope` to children.

Modify `materializeRequiredSplitChildren` in `src/tools/task-queue.ts`:

- Delete `parent.status = 'parent'`.
- Ensure `parent.hierarchy.childIds` includes all planned child ids.
- Ensure each child has `hierarchy.parentId = parent.id`.
- Set `parent.taskReadiness.recommendation = 'split'` or keep the existing readiness if it already says split.
- Keep parent status unchanged if it was already `blocked`, `review`, `gate_check`, `done`, or `shelved`; otherwise use `ready`.

- [x] **Step 8: Remove hierarchy compatibility inference**
  - Evidence: Removed `parentGoalId`/`legacyParentTaskId` fallback from runtime and web hierarchy builders; updated TaskDrawer/Overview projections to use `hierarchy` and `businessEnvelope` separately.

Modify both hierarchy modules:

- Delete `legacyParentTaskId`.
- Delete `parentGoalId` fallback in `parentIdForTask`.
- Keep cycle handling.
- `isContainingWork` is true when explicit child links exist, `workKind` is `app_spec` or `feature_spec`, or a completion boundary requires children.

- [x] **Step 9: Rename business envelope**
  - Evidence: Added `Task.businessEnvelope.goalId`, migrated old non-hierarchy goal values in `task-hierarchy-migration`, and moved runtime/proposal/context/merge-dispatcher callers off normal `parentGoalId`.

Modify `src/core/task.ts` and business-envelope callers:

- Add:

```ts
businessEnvelope: z.object({
  goalId: z.string(),
}).optional(),
```

- Migrate non-hierarchy `parentGoalId` values into `businessEnvelope.goalId`.
- Remove `parentGoalId` from normal schema once all call sites are moved.
- Update guild prompt files under `src/guilds/project-manager/` to say `businessEnvelope.goalId`.

- [x] **Step 10: Update tests**
  - Evidence: `pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts src/runtime/__tests__/work-hierarchy.test.ts src/tools/__tests__/task-queue.test.ts src/runtime/__tests__/business-envelope.test.ts src/core/__tests__/task.test.ts src/runtime/__tests__/intake.test.ts src/runtime/__tests__/serve-task-endpoints.test.ts src/runtime/__tests__/merge-dispatcher.test.ts src/tools/__tests__/proposal.test.ts src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/drawer/__tests__/drawer-tabs.svelte.test.ts --reporter=dot` passed: 12 files, 290 tests. `pnpm typecheck` passed. `pnpm lint:reductions` now fails only on planned generic-runtime product vocabulary leaks in `design-feedback.ts`, `design-system-discovery.ts`, `evidence-work-graph-intake.ts`, and `guildhall.config.ts`.

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts src/runtime/__tests__/work-hierarchy.test.ts src/tools/__tests__/task-queue.test.ts src/runtime/__tests__/business-envelope.test.ts --reporter=dot
```

Expected: PASS after test fixtures no longer construct `status: 'parent'`.

Commit:

```bash
git add src/runtime/task-hierarchy-migration.ts src/runtime/__tests__/task-hierarchy-migration.test.ts scripts/migrations/0.10.0-task-hierarchy.mjs src/runtime/migrations.ts src/core/task.ts src/runtime/work-hierarchy.ts src/web/lib/work-hierarchy.ts src/tools/task-queue.ts src/runtime/orchestrator-picker.ts src/guilds/project-manager src/runtime/__tests__/work-hierarchy.test.ts src/tools/__tests__/task-queue.test.ts src/runtime/__tests__/business-envelope.test.ts
git commit -m "refactor: convert work hierarchy away from parent status"
```

## Task 3: Build Owner-Input Linkage, Convert Task Questions, and Remove `openQuestions`

**Files:**
- Create: `src/runtime/owner-input.ts`
- Create: `src/runtime/owner-input-store.ts`
- Create: `src/runtime/bounded-chat-machine.ts`
- Create: `src/runtime/__tests__/owner-input.test.ts`
- Create: `src/runtime/__tests__/bounded-chat-machine.test.ts`
- Create: `src/runtime/task-question-migration.ts`
- Create: `src/runtime/__tests__/task-question-migration.test.ts`
- Create: `scripts/migrations/0.10.0-task-questions.mjs`
- Modify: `src/runtime/migrations.ts`
- Modify: `src/core/task.ts`
- Modify: `src/runtime/bounded-chat.ts`
- Modify: `src/runtime/structural-map.ts`
- Modify: `src/runtime/project-graph.ts`
- Modify: `src/runtime/capability-request-machine.ts`
- Modify: `src/tools/post-user-question.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/inbox.ts`
- Modify: `src/runtime/attention.ts`
- Modify: `src/web/surfaces/TaskDrawer.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/ProjectOverviewTab.svelte`
- Modify: `src/web/surfaces/project/WorkTab.svelte`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Modify: `src/web/surfaces/project/structure/*`
- Modify tests that assert `openQuestions`

- [x] **Step 1: Write owner-input and bounded-chat state-machine tests**
  - Evidence: Added `src/runtime/__tests__/bounded-chat-machine.test.ts` and `src/runtime/__tests__/owner-input.test.ts`; `pnpm vitest run src/runtime/__tests__/bounded-chat-machine.test.ts src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat.test.ts --reporter=dot` passed: 3 files, 23 tests.

Create `src/runtime/__tests__/owner-input.test.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createOwnerInputRequest, listOwnerInputRequests } from '../owner-input-store.js'
import { listBoundedChatSessions } from '../bounded-chat.js'

const now = '2026-06-01T12:00:00.000Z'

describe('owner input requests', () => {
  it('creates one linked bounded-chat session for a task question source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-'))
    const first = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-1:q1',
      now,
      actor: 'migration',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      target: { kind: 'thread' },
      prompt: 'Which billing policy should Guildhall follow?',
      choices: ['A', 'B'],
      objective: {
        kind: 'task_shaping',
        label: 'Clarify billing policy',
        successCriteria: ['Owner chooses the billing policy.'],
      },
    })

    const second = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: 'task-question:task-1:q1',
      now,
      actor: 'migration',
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      target: { kind: 'thread' },
      prompt: 'Which billing policy should Guildhall follow?',
      choices: ['A', 'B'],
      objective: {
        kind: 'task_shaping',
        label: 'Clarify billing policy',
        successCriteria: ['Owner chooses the billing policy.'],
      },
    })

    expect(second.request.id).toBe(first.request.id)
    expect(second.session.id).toBe(first.session.id)

    const requests = await listOwnerInputRequests(root)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      boundedChatSessionId: first.session.id,
      status: 'waiting_for_owner',
    })

    const sessions = listBoundedChatSessions(path.join(root, '.guildhall'))
    expect(sessions).toHaveLength(1)
    expect(sessions[0].id).toBe(first.session.id)
  })

  it.each([
    [{ kind: 'structural_map', mapId: 'draft', questionId: 'confirm-domain-routing' }],
    [{ kind: 'project_graph', edgeId: 'edge-1', questionId: 'assign-authority' }],
    [{ kind: 'capability_request', requestId: 'cap-1', questionId: 'grant-or-deny' }],
    [{ kind: 'request_intake', intakeId: 'intake-1', questionId: 'clarify-scope' }],
  ] as const)('supports source %j without inventing a local question model', async (source) => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-owner-input-source-'))
    const result = await createOwnerInputRequest({
      projectRoot: root,
      projectId: 'demo',
      commandId: `${source.kind}:source-test`,
      now,
      actor: 'test',
      source,
      target: { kind: 'thread' },
      prompt: 'Owner decision needed.',
      objective: {
        kind: 'task_shaping',
        label: 'Owner decision',
        successCriteria: ['Owner answers the linked bounded chat.'],
      },
    })
    expect(result.request.boundedChatSessionId).toBe(result.session.id)
  })
})
```

Create `src/runtime/__tests__/bounded-chat-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyBoundedChatTransition, boundedChatMachine } from '../bounded-chat-machine.js'
import { transitionTable } from '../state-machine.js'

const now = '2026-06-01T12:00:00.000Z'

describe('bounded chat state machine', () => {
  it('documents the allowed lifecycle table', () => {
    expect(transitionTable(boundedChatMachine)).toContainEqual({
      from: 'waiting_for_owner',
      event: 'submit_owner_response',
      to: 'coordinator_review',
    })
  })

  it('applies transitions with receipts and rejects illegal transitions', () => {
    const applied = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'waiting_for_owner',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: ['response:1'],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })

    expect(applied.kind).toBe('applied')
    if (applied.kind !== 'applied') throw new Error('expected applied')
    expect(applied.nextState).toBe('coordinator_review')
    expect(applied.receipt).toMatchObject({
      machineId: 'bounded-chat',
      entityId: 'chat-1',
      commandId: 'response-1',
      from: 'waiting_for_owner',
      event: 'submit_owner_response',
      to: 'coordinator_review',
    })

    const rejected = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'fulfilled',
      event: 'submit_owner_response',
      commandId: 'response-2',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: [],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })
    expect(rejected).toMatchObject({ kind: 'rejected', reason: 'terminal_state' })
  })

  it('returns already_applied for repeated command ids', () => {
    const first = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'waiting_for_owner',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [],
      actor: 'owner',
      evidenceRefs: ['response:1'],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })
    if (first.kind !== 'applied') throw new Error('expected applied')

    const second = applyBoundedChatTransition({
      sessionId: 'chat-1',
      currentStatus: 'waiting_for_owner',
      event: 'submit_owner_response',
      commandId: 'response-1',
      priorReceipts: [first.receipt],
      actor: 'owner',
      evidenceRefs: ['response:1'],
      now,
      context: { activeSubObjectiveId: 'q1', ownerResponsePresent: true },
    })
    expect(second).toMatchObject({ kind: 'already_applied', currentState: 'coordinator_review' })
  })
})
```

Run:

```bash
pnpm vitest run src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat-machine.test.ts --reporter=dot
```

Expected: FAIL because `owner-input-store.ts` and `bounded-chat-machine.ts` do not exist.

- [x] **Step 2: Write task question conversion tests**
  - Evidence: Added `src/runtime/__tests__/task-question-migration.test.ts` covering unanswered question conversion, linked owner-input/bounded-chat sessions, answered-question note preservation, and idempotency.

Create `src/runtime/__tests__/task-question-migration.test.ts`:

```ts
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateTaskQuestionsToBoundedChat } from '../task-question-migration.js'
import { listOwnerInputRequests } from '../owner-input-store.js'

const now = '2026-06-01T12:00:00.000Z'

describe('task question migration', () => {
  it('moves unanswered task questions into owner-input linked bounded chat and removes openQuestions', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guildhall-questions-'))
    await mkdir(path.join(root, '.guildhall'), { recursive: true })
    await writeFile(path.join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      lastUpdated: now,
      tasks: [{
        id: 'task-1',
        title: 'Clarify billing policy',
        description: 'Needs owner direction.',
        domain: 'product',
        projectPath: root,
        status: 'exploring',
        priority: 'normal',
        notes: [],
        dependsOn: [],
        openQuestions: [{
          id: 'q1',
          kind: 'choice',
          prompt: 'Which policy should Guildhall follow?',
          choices: ['A', 'B'],
          askedBy: 'spec-agent',
          askedAt: now,
        }],
      }],
    }, null, 2))

    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot: root, projectId: 'demo', apply: true, now })
    expect(result.createdOwnerInputRequests).toHaveLength(1)
    expect(result.createdSessions).toHaveLength(1)

    const queue = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    expect(queue.tasks[0].openQuestions).toBeUndefined()

    const requests = await listOwnerInputRequests(root)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      source: { kind: 'task', taskId: 'task-1', questionId: 'q1' },
      boundedChatSessionId: result.createdSessions[0],
      status: 'waiting_for_owner',
    })

    const session = JSON.parse(await readFile(path.join(root, '.guildhall', 'bounded-chat', `${result.createdSessions[0]}.json`), 'utf8'))
    expect(session.objective.kind).toBe('task_shaping')
    expect(session.source).toBe('migration:0.10.0/task-open-questions-to-bounded-chat:task-1:q1')
    expect(session.subObjectives[0].prompt).toBe('Which policy should Guildhall follow?')
    expect(session.subObjectives[0].choices).toEqual(['A', 'B'])
    expect(session.receipts).toEqual(expect.arrayContaining([
      expect.objectContaining({ machineId: 'bounded-chat', event: 'wait_for_owner', to: 'waiting_for_owner' }),
    ]))
  })
})
```

- [ ] **Step 3: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-question-migration.test.ts --reporter=dot
```

Expected: FAIL because `task-question-migration.ts`, `owner-input-store.ts`, and
`bounded-chat-machine.ts` do not exist.

- [x] **Step 4: Implement owner-input request records**
  - Evidence: Added `src/runtime/owner-input.ts` with source, target, objective, request status, deterministic source-key helpers, and request receipt shape.

Create `src/runtime/owner-input.ts` with these exported types:

```ts
export type OwnerInputSource =
  | { kind: 'task'; taskId: string; questionId: string }
  | { kind: 'structural_map'; mapId: string; questionId: string }
  | { kind: 'project_graph'; edgeId?: string; domainId?: string; questionId: string }
  | { kind: 'capability_request'; requestId: string; questionId: string }
  | { kind: 'request_intake'; intakeId: string; questionId: string }
  | { kind: 'project_check_in'; checkInId: string; questionId: string }
  | { kind: 'recovery_decision'; recoveryId: string; questionId: string }
  | { kind: 'settings'; settingId: string; questionId: string }

export type OwnerInputTarget =
  | { kind: 'thread' }
  | { kind: 'project_structure'; href: string }
  | { kind: 'work_item'; taskId: string }

export type OwnerInputRequestStatus =
  | 'waiting_for_owner'
  | 'coordinator_review'
  | 'fulfilled'
  | 'blocked'
  | 'cancelled'

export interface OwnerInputRequest {
  id: string
  projectId: string
  source: OwnerInputSource
  target: OwnerInputTarget
  boundedChatSessionId: string
  status: OwnerInputRequestStatus
  prompt: string
  choices?: string[]
  createdAt: string
  updatedAt: string
  receipts: Array<import('./state-machine.js').TransitionReceipt<OwnerInputRequestStatus, string>>
}
```

Rules:

- `OwnerInputRequest.id` must be deterministic from project id and source identity.
- Source models may store this id as a reference. They must not copy prompt,
  choices, or answer state back into local question arrays.
- A source that asks the same owner decision twice must reuse the same request
  and bounded-chat session unless it deliberately creates a new `questionId`.

- [x] **Step 5: Implement bounded-chat lifecycle with `state-machine.ts`**
  - Evidence: Added `src/runtime/bounded-chat-machine.ts`, moved normal bounded-chat writes to `waiting_for_owner` vocabulary, appended transition receipts to sessions, and verified `pnpm vitest run src/runtime/__tests__/bounded-chat-machine.test.ts src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/serve-intake.test.ts --reporter=dot` passed: 5 files, 103 tests.

Create `src/runtime/bounded-chat-machine.ts`:

```ts
import {
  applyTransitionCommand,
  defineStateMachine,
  type TransitionCommandResult,
  type TransitionReceipt,
} from './state-machine.js'

export type BoundedChatLifecycleStatus =
  | 'active'
  | 'waiting_for_owner'
  | 'coordinator_review'
  | 'fulfilled'
  | 'blocked'
  | 'cancelled'

export type BoundedChatLifecycleEvent =
  | 'activate'
  | 'wait_for_owner'
  | 'submit_owner_response'
  | 'request_coordinator_review'
  | 'fulfill'
  | 'block'
  | 'cancel'

export interface BoundedChatLifecycleContext {
  activeSubObjectiveId?: string | null
  ownerResponsePresent?: boolean
  coordinatorSummaryPresent?: boolean
  blockReasonPresent?: boolean
}

export const boundedChatMachine = defineStateMachine<BoundedChatLifecycleStatus, BoundedChatLifecycleEvent, BoundedChatLifecycleContext>({
  id: 'bounded-chat',
  version: 1,
  initial: 'active',
  terminal: ['fulfilled', 'blocked', 'cancelled'],
  states: {
    active: {
      on: {
        wait_for_owner: { to: 'waiting_for_owner', require: ['activeSubObjectiveId'] },
        fulfill: { to: 'fulfilled', require: ['coordinatorSummaryPresent'] },
        block: { to: 'blocked', require: ['blockReasonPresent'] },
        cancel: { to: 'cancelled' },
      },
    },
    waiting_for_owner: {
      on: {
        submit_owner_response: { to: 'coordinator_review', require: ['ownerResponsePresent'] },
        block: { to: 'blocked', require: ['blockReasonPresent'] },
        cancel: { to: 'cancelled' },
      },
    },
    coordinator_review: {
      on: {
        wait_for_owner: { to: 'waiting_for_owner', require: ['activeSubObjectiveId'] },
        fulfill: { to: 'fulfilled', require: ['coordinatorSummaryPresent'] },
        block: { to: 'blocked', require: ['blockReasonPresent'] },
        cancel: { to: 'cancelled' },
      },
    },
    fulfilled: { on: {} },
    blocked: { on: {} },
    cancelled: { on: {} },
  },
})

export function applyBoundedChatTransition(input: {
  sessionId: string
  currentStatus: BoundedChatLifecycleStatus
  event: BoundedChatLifecycleEvent
  commandId: string
  priorReceipts: Array<TransitionReceipt<BoundedChatLifecycleStatus, BoundedChatLifecycleEvent>>
  actor: string
  evidenceRefs: string[]
  now: string
  context: BoundedChatLifecycleContext
}): TransitionCommandResult<BoundedChatLifecycleStatus, BoundedChatLifecycleEvent> {
  return applyTransitionCommand(boundedChatMachine, {
    commandId: input.commandId,
    priorReceipts: input.priorReceipts,
    transition: {
      entityId: input.sessionId,
      currentState: input.currentStatus,
      event: input.event,
      context: input.context,
      actor: input.actor,
      evidenceRefs: input.evidenceRefs,
      now: input.now,
    },
  })
}
```

Then modify `src/runtime/bounded-chat.ts` so normal mutation paths:

- call `applyBoundedChatTransition`;
- append successful receipts to `session.receipts`;
- reject illegal lifecycle changes instead of writing arbitrary statuses;
- preserve legacy sessions only through migration/read compatibility, not direct
  write paths.

- [x] **Step 6: Implement owner-input create-or-link store**
  - Evidence: Added `src/runtime/owner-input-store.ts` with deterministic create-or-link behavior, `.guildhall/owner-input/` persistence, `listOwnerInputRequests`, `listOwnerInputRequestsSync`, and `findOwnerInputRequestBySource`; `pnpm typecheck` passed.

Create `src/runtime/owner-input-store.ts`:

- `createOwnerInputRequest(input)` creates or reuses a deterministic request.
- It creates a linked bounded-chat session with the requested prompt when no
  existing request exists.
- It uses `applyBoundedChatTransition(... event: 'wait_for_owner' ...)` so the
  session starts with a receipt.
- It writes request records under `.guildhall/owner-input/<requestId>.json`.
- It exports `listOwnerInputRequests(projectRoot)` and
  `findOwnerInputRequestBySource(projectRoot, source)`.

Do not let source-specific callers choose storage paths or session ids.

- [x] **Step 7: Implement migration**
  - Evidence: Added `src/runtime/task-question-migration.ts`, converting raw `TASKS.json` `openQuestions` into owner-input requests and bounded-chat sessions before normal task parsing; `pnpm vitest run src/runtime/__tests__/task-question-migration.test.ts src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat-machine.test.ts src/runtime/__tests__/bounded-chat.test.ts --reporter=dot` passed: 4 files, 25 tests.

Create `src/runtime/task-question-migration.ts` with:

```ts
export interface TaskQuestionMigrationInput {
  projectRoot: string
  projectId: string
  apply: boolean
  now?: string
}

export interface TaskQuestionMigrationResult {
  changedTasks: string[]
  createdOwnerInputRequests: string[]
  createdSessions: string[]
  affectedPaths: string[]
}
```

Rules:

- Read raw `.guildhall/TASKS.json`.
- For every unanswered question, call `createOwnerInputRequest` to create one
  owner-input request linked to one bounded-chat session with:
  - `objective.kind = "task_shaping"`;
  - `objective.label = "Clarify <task title>"`;
  - `source = "migration:0.10.0/task-open-questions-to-bounded-chat:<taskId>:<questionId>"`;
  - `initialSubObjective.id = <questionId>`;
  - `initialSubObjective.prompt = question.prompt`;
  - `initialSubObjective.choices = question.choices` when present.
- For answered questions, append a task note that preserves the answer summary if no equivalent note already exists.
- Remove `openQuestions` from every task.
- Do not create duplicate owner-input requests or sessions when applied twice.

- [x] **Step 8: Register required migration**
  - Evidence: Registered required project migration `0.10.0/task-open-questions-to-bounded-chat` in `src/runtime/migrations.ts` and added wrapper `scripts/migrations/0.10.0-task-questions.mjs`; `pnpm typecheck` passed.

Add built-in project migration:

```ts
{
  id: '0.10.0/task-open-questions-to-bounded-chat',
  title: 'Move task questions into owner-input bounded chat',
  introducedIn: '0.10.0',
  scope: 'project',
  safety: 'prompt',
  requirement: 'required',
  summary: 'Converts task.openQuestions into owner-input requests linked to bounded-chat sessions and removes task-local question state.',
  async detect(projectRoot) {
    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot, projectId: path.basename(projectRoot), apply: false })
    return { needed: result.changedTasks.length > 0, affectedPaths: result.affectedPaths }
  },
  async apply(projectRoot) {
    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot, projectId: path.basename(projectRoot), apply: true })
    return {
      summary: `Moved ${result.createdOwnerInputRequests.length} task question${result.createdOwnerInputRequests.length === 1 ? '' : 's'} into owner-input bounded chat.`,
      affectedPaths: result.affectedPaths,
    }
  },
}
```

- [ ] **Step 9: Convert source-specific owner questions into owner-input refs**

Update source models so they create or link `OwnerInputRequest` records instead
of owning local question state:

- `src/runtime/structural-map.ts`
  - Replace durable `ownerQuestions` persistence with `ownerInputRequestIds` or
    a review summary that links to owner-input records.
  - `structuralMapReviewMachine` may require owner input before accepting a map,
    but the prompt/answer lifecycle belongs to bounded chat.
- `src/runtime/project-graph.ts`
  - Use owner-input requests when domain authority assignment, dependency edge
    acceptance, return, redelivery, or conflicting ownership needs discussion.
  - The graph may store the linked request id and current decision state; it must
    not store another prompt/choices/answer object.
- `src/runtime/capability-request-machine.ts`
  - Use owner-input requests for owner approval when capability grant policy
    cannot be decided by configured coordinator authority.
- `src/runtime/request-intake.ts`
  - Replace `openQuestion?: AgentQuestion` with an owner-input request ref or a
    bounded-chat start result.

Focused tests must assert that these source records contain refs to
owner-input/bounded-chat sessions rather than embedded question arrays.

- [x] **Step 10: Replace question writer path**

Change `src/tools/post-user-question.ts` from a task mutator into one of these:

- a thin compatibility CLI/tool that calls `createOwnerInputRequest`, or
- a removed tool replaced by `start-owner-input-thread`.

The resulting code must not assign `task.openQuestions`.

Evidence, 2026-06-01 coordinator slice:

- `src/tools/post-user-question.ts` now verifies the target task exists, then
  creates or links an `OwnerInputRequest` plus bounded-chat session via
  `createOwnerInputRequest`.
- The tool no longer constructs or assigns `task.openQuestions`.
- Question context is carried as bounded-chat sub-objective helper text.
- `src/tools/__tests__/post-user-question.test.ts` now asserts owner-input and
  bounded-chat records are created while `TASKS.json` remains free of new
  task-local questions.
- Evidence command: `pnpm vitest run src/tools/__tests__/post-user-question.test.ts --reporter=dot`
  passed with 15 tests.
- Evidence command: `pnpm typecheck` passed.

- [ ] **Step 11: Remove normal `openQuestions` schema**

Modify `src/core/task.ts`:

- Delete `openQuestions: z.array(AgentQuestion).optional()`.
- Keep `AgentQuestion` type only if bounded-chat migration or old transcript readers still need to parse old records outside normal task parsing.
- Update `src/web/lib/types.ts` after UI payloads stop including `openQuestions`.

- [ ] **Step 12: Remove UI and Inbox question paths**

- Delete `agent_question_pending` from `InboxItem`.
- Delete `visibleOpenQuestions` calls from Inbox construction.
- Delete task drawer question answer UI or replace it with a Threads link to the bounded chat.
- Replace `ThreadTab` pressure-test/question branches with a `bounded_chat` or
  `owner_input` branch.
- Delete code that maps bounded-chat sessions to `pressure_test_question`.
- Add a test fixture with an active bounded-chat session and assert:

```ts
expect(thread.turns).toContainEqual(expect.objectContaining({ kind: 'bounded_chat' }))
expect(thread.turns).not.toContainEqual(expect.objectContaining({ kind: 'pressure_test_question' }))
```

- `ProjectOverviewTab.svelte`, `WorkTab.svelte`, `SettingsTab.svelte`, and
  `src/web/surfaces/project/structure/*` may show linked status and navigation,
  but they must not render independent question cards or mutate answers.

Partial evidence, 2026-06-01 coordinator slice:

- `src/runtime/thread.ts` now emits active bounded-chat sessions as
  `kind: 'bounded_chat'` with `sessionId` and `subObjectiveId`.
- `src/web/surfaces/project/ThreadTab.svelte` accepts `bounded_chat` as the
  owner-input question branch instead of relying on the pressure-test turn
  shape.
- `src/runtime/__tests__/thread.test.ts` includes an active bounded-chat
  fixture asserting `bounded_chat` is present and the matching
  `pressure_test_question` turn is absent.
- Evidence command: `pnpm vitest run src/runtime/__tests__/thread.test.ts --reporter=dot`
  passed with 60 tests.
- Evidence command: `pnpm typecheck` passed.

- [ ] **Step 13: Add projection guardrails**

Add or extend `scripts/reduction-guardrails.mjs` so it fails when:

- `boundedChatTurns` or equivalent code emits `kind: 'pressure_test_question'`;
- `src/runtime/inbox.ts` emits `agent_question_pending`,
  `pressure_test_pending`, or `project_check_in`;
- `src/runtime/structural-map.ts` persists a durable `ownerQuestions` array
  after owner-input refs are introduced;
- app surfaces introduce local answer/question card branches for source-specific
  owner decisions instead of linking to Thread.

Partial evidence, 2026-06-01 coordinator slice:

- `scripts/reduction-guardrails.mjs` now fails if `boundedChatTurns` emits
  `kind: 'pressure_test_question'`.
- The remaining inbox, structural-map, and app-surface projection guardrails
  are still open.

- [ ] **Step 14: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat-machine.test.ts src/runtime/__tests__/task-question-migration.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/serve-intake.test.ts src/runtime/__tests__/structural-map.test.ts src/runtime/__tests__/project-graph.test.ts src/runtime/__tests__/capability-request-machine.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts --reporter=dot
```

Expected: PASS with:

- no tests asserting task-local `openQuestions`;
- no bounded-chat fixture projected as `pressure_test_question`;
- source-specific owner decisions linked through `OwnerInputRequest`.

Commit:

```bash
git add src/runtime/owner-input.ts src/runtime/owner-input-store.ts src/runtime/bounded-chat-machine.ts src/runtime/__tests__/owner-input.test.ts src/runtime/__tests__/bounded-chat-machine.test.ts src/runtime/task-question-migration.ts src/runtime/__tests__/task-question-migration.test.ts scripts/migrations/0.10.0-task-questions.mjs src/runtime/migrations.ts src/core/task.ts src/runtime/bounded-chat.ts src/runtime/structural-map.ts src/runtime/project-graph.ts src/runtime/capability-request-machine.ts src/runtime/request-intake.ts src/tools/post-user-question.ts src/runtime/orchestrator.ts src/runtime/thread.ts src/runtime/inbox.ts src/runtime/attention.ts src/web/lib/types.ts src/web/surfaces/TaskDrawer.svelte src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/project/ProjectOverviewTab.svelte src/web/surfaces/project/WorkTab.svelte src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/structure scripts/reduction-guardrails.mjs
git commit -m "refactor: route owner input through bounded chat"
```

## Task 4: Collapse Inbox/Needs You to Alert Ownership

**Files:**
- Modify: `src/runtime/inbox.ts`
- Modify: `src/runtime/attention.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/web/lib/inbox-item-key.ts`
- Modify: `src/web/surfaces/project/InboxTab.svelte`
- Modify: `src/web/surfaces/FleetNeedsYou.svelte`
- Modify: `src/web/surfaces/DoThisNext.svelte`
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify tests for these files

- [x] **Step 1: Write runtime test for alert-only inbox**

Update `src/runtime/__tests__/inbox.test.ts`:

```ts
it('does not expose conversation-owned items through project inbox', async () => {
  const items = await buildInbox({ projectPath })
  expect(items.map(item => item.kind)).not.toContain('agent_question_pending')
  expect(items.map(item => item.kind)).not.toContain('pressure_test_pending')
  expect(items.map(item => item.kind)).not.toContain('project_check_in')
  expect(items.map(item => item.kind)).not.toContain('brief_approval')
  expect(items.map(item => item.kind)).not.toContain('spec_approval')
  expect(items.map(item => item.kind)).not.toContain('open_escalation')
})
```

Evidence:

- Added alert-only/non-emission coverage in `src/runtime/__tests__/inbox.test.ts`.
- `pnpm vitest run src/runtime/__tests__/inbox.test.ts --reporter=dot` passed
  31 tests.

- [x] **Step 2: Delete thread-owned item kinds**

In `src/runtime/inbox.ts`:

- Delete `THREAD_OWNED_INBOX_KINDS`.
- Delete `isThreadOwnedInboxItem`.
- Remove these union members from `InboxItem`:
  - `project_check_in`
  - `pressure_test_pending`
  - `agent_question_pending`
  - `brief_approval`
  - `spec_approval`
  - `open_escalation`
- Keep only alert-owned kinds.

Evidence:

- Removed thread-owned `InboxItem` union members, `THREAD_OWNED_INBOX_KINDS`,
  and `isThreadOwnedInboxItem` from `src/runtime/inbox.ts`.
- Removed `agent_question_pending` and `open_escalation` attention ids from
  `src/runtime/attention.ts`.
- Added reduction guardrails that prevent reintroducing conversation-owned
  inbox kinds in `src/runtime/inbox.ts` and `src/web/lib/inbox-item-key.ts`.
- `pnpm lint:reductions` passed.

- [ ] **Step 3: Move conversation routing to Thread**

In `src/runtime/thread.ts`:

- Ensure project check-in, task shaping, approvals, escalations, structural-map
  review, project-graph review, capability decisions, and recovery decisions
  project as Thread turns from linked owner-input/bounded-chat sessions.
- Add action hrefs that target `/thread?thread=<id>` instead of `/overview/inbox`.
- Do not synthesize thread turns from each source's local question shape. The
  linked bounded-chat session is the projection source.

Partial evidence:

- `src/runtime/serve.ts` now builds owner-input start blockers from
  `.guildhall/owner-input` via `listOwnerInputRequestsSync`, rather than
  looking for thread-owned rows inside `buildInbox`.
- Remaining work: finish source-specific conversion so project check-in, task
  shaping, approvals, escalations, structural-map review, project-graph review,
  capability decisions, and recovery decisions all project from linked
  owner-input/bounded-chat sessions.

- [ ] **Step 4: Reduce UI duplication**

- `DoThisNext.svelte` should choose between:
  - top alert item from Needs You, or
  - top waiting Thread from Thread summary.
- `FleetNeedsYou.svelte` should fetch one canonical fleet attention summary endpoint. It should not locally synthesize inbox groups and then replace them with project inbox results.
- `InboxTab.svelte` should become `NeedsYouTab.svelte` or a narrow alert/history component.

Partial evidence:

- Removed conversation-kind branches and synthetic project check-in/escalation
  rows from `DoThisNext.svelte`, `FleetNeedsYou.svelte`,
  `ProjectOverviewTab.svelte`, `WorkTab.svelte`, and `InboxTab.svelte`.
- Remaining work: rename/split `InboxTab.svelte` into a dedicated Needs You
  alert surface and make fleet attention read one canonical summary endpoint.

- [x] **Step 5: Run tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/surfaces/__tests__/FleetNeedsYou.svelte.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts --reporter=dot
```

Evidence:

- `pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/surfaces/__tests__/FleetNeedsYou.svelte.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/project/__tests__/ProjectOverviewTab.svelte.test.ts src/web/surfaces/project/__tests__/WorkTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts --reporter=dot`
  passed 8 files / 177 tests.
- `pnpm lint:reductions` passed.
- `pnpm typecheck` passed.

Commit:

```bash
git add src/runtime/inbox.ts src/runtime/attention.ts src/runtime/thread.ts src/web/lib/inbox-item-key.ts src/web/surfaces/project/InboxTab.svelte src/web/surfaces/FleetNeedsYou.svelte src/web/surfaces/DoThisNext.svelte src/web/surfaces/ProjectView.svelte
git commit -m "refactor: narrow needs-you to alert-owned items"
```

## Task 5: Make Settings Small and Move Specialist Tools Out

**Files:**
- Create: `src/web/surfaces/project/settings/types.ts`
- Create: `src/web/surfaces/project/settings/settings-store.svelte.ts`
- Create: `src/web/surfaces/project/settings/SettingsReadyPanel.svelte`
- Create: `src/web/surfaces/project/settings/SettingsIdentityPanel.svelte`
- Create: `src/web/surfaces/project/settings/SettingsCoordinatorsPanel.svelte`
- Create: `src/web/surfaces/project/settings/OperatingProfilePanel.svelte`
- Create: `src/web/surfaces/project/settings/DeveloperToolsPanel.svelte`
- Create: `src/web/surfaces/project/structure/project-graph-store.svelte.ts`
- Create: `src/web/surfaces/project/structure/ProjectStructurePanel.svelte`
- Create: `src/web/surfaces/project/structure/ProjectGraphPanel.svelte`
- Create: `src/web/surfaces/project/structure/StructuralMapReviewPanel.svelte`
- Create: `src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts`
- Create: `src/levers/profiles.ts`
- Create: `src/levers/__tests__/profiles.test.ts`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/levers/schema.ts`
- Modify: `src/levers/storage.ts`
- Modify: `src/runtime/migrations.ts`

- [ ] **Step 1: Write structure test**

Create `src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SettingsTab structure', () => {
  it('stays a small composition shell', () => {
    const source = readFileSync('src/web/surfaces/project/SettingsTab.svelte', 'utf8')
    expect(source.split('\n').length).toBeLessThanOrEqual(400)
    expect(source).not.toMatch(/interface DesignFeedbackStore/)
    expect(source).not.toMatch(/interface LearningSnapshot/)
    expect(source).not.toMatch(/interface ReintakeDraft/)
    expect(source).not.toMatch(/interface ProjectGraphView/)
    expect(source).not.toContain('/api/project/project-graph')
    expect(source).not.toMatch(/selectedProjectGraphDomainId/)
    expect(source).not.toMatch(/looma/i)
  })
})
```

Run:

```bash
pnpm vitest run src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts --reporter=dot
```

Expected: FAIL because the current file is 4,258 lines and owns all specialist types.

- [ ] **Step 2: Define Settings IA**

Change `SettingsTab.svelte` sections to:

```ts
type SettingSection = 'ready' | 'providers' | 'coordinators' | 'identity' | 'profile' | 'developer'
```

Owner-facing defaults:

- `ready`: local runtime/bootstrap/provider/coordinator status.
- `providers`: model provider selection.
- `coordinators`: coordinator readout.
- `identity`: project name, slug, worktree include files.
- `profile`: operating profile and changed overrides.
- `developer`: migrations, codebase map, raw lever editor, local development hooks.

Remove Settings sections:

- `facts` moves to the existing Facts surface.
- `learning` moves to project intelligence.
- `reintake` starts from Threads or Work as a review flow.
- design feedback/codebase map details move to developer/project intelligence.
- `graph` moves to a focused project-structure surface. Settings can show a
  readiness warning or link, but it cannot own graph data, assignment picker
  state, request actions, or graph rendering.

- [ ] **Step 3: Extract typed settings store**

Create `settings-store.svelte.ts` with one loader per concern:

```ts
export function createSettingsStore(projectFetch: typeof import('../../../lib/project-routes.js').projectFetch) {
  let readiness = $state<SettingsReadiness | null>(null)
  let identity = $state<ProjectIdentity | null>(null)
  let profile = $state<OperatingProfileReadout | null>(null)
  let developer = $state<DeveloperToolsReadout | null>(null)

  return {
    get readiness() { return readiness },
    get identity() { return identity },
    get profile() { return profile },
    get developer() { return developer },
    async loadReadiness() {
      const [bootstrap, providers, runtime, migrations] = await Promise.all([
        projectFetch('/api/bootstrap/status').then(r => r.json()),
        projectFetch('/api/setup/providers').then(r => r.json()),
        projectFetch('/api/project/runtime/setup').then(r => r.json()),
        projectFetch('/api/project/migrations').then(r => r.json()),
      ])
      readiness = { bootstrap, providers, runtime, migrations }
    },
    async loadIdentity() {
      const config = await projectFetch('/api/config').then(r => r.json())
      identity = { name: config.name ?? '', id: config.id ?? '' }
    },
    async loadProfile() {
      profile = await projectFetch('/api/config/operating-profile').then(r => r.json())
    },
    async loadDeveloper() {
      developer = await projectFetch('/api/project/developer-tools').then(r => r.json())
    },
  }
}
```

Use the existing endpoint names shown in the store snippet unless a task also changes the corresponding route and updates the same test in that commit.

- [ ] **Step 4: Extract project graph into a project-structure surface**

Move the newly merged graph UI out of `SettingsTab.svelte` before continuing to
shrink the rest of Settings:

- `project-graph-store.svelte.ts` owns:
  - `/api/project/project-graph` loading;
  - domain authority selection;
  - assignment picker query and selected responsibility;
  - project graph mutation/action payload defaults;
  - busy and error state.
- `ProjectGraphPanel.svelte` renders:
  - detected domains;
  - assigned authority;
  - searchable project assignment picker;
  - inbound/outgoing request cards or rows;
  - delivery review, return, redelivery, and acceptance actions.
- `StructuralMapReviewPanel.svelte` renders:
  - accepted/draft structural map status;
  - conflicts and ignored Git roots;
  - owner-question links to Threads/bounded chat.
- `ProjectStructurePanel.svelte` composes the structural map and graph panels.

Add `src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts`
covering:

```ts
expect(settingsSource).not.toMatch(/ProjectGraphView/)
expect(settingsSource).not.toContain('/api/project/project-graph')
expect(settingsSource).not.toMatch(/assignmentPicker/)
```

The Settings route may keep one compact readiness notice that links to the
project-structure surface when structural graph review blocks work.

- [ ] **Step 5: Add lever operating profiles**

Create `src/levers/profiles.ts`:

```ts
export type OperatingProfileId = 'balanced' | 'conservative' | 'autonomous' | 'release_hardening'

export interface OperatingProfile {
  id: OperatingProfileId
  label: string
  summary: string
  leverPositions: Record<string, string>
}

export const OPERATING_PROFILES: OperatingProfile[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    summary: 'Guildhall asks for owner judgment when product meaning or risk changes, and otherwise keeps moving with proof.',
    leverPositions: {},
  },
  {
    id: 'conservative',
    label: 'Conservative',
    summary: 'Guildhall asks before high-risk starts, completion approval, and ambiguous scope changes.',
    leverPositions: {
      start_policy: 'human_required',
      completion_approval: 'human_required',
      escalation_on_ambiguity: 'always',
    },
  },
  {
    id: 'autonomous',
    label: 'Autonomous',
    summary: 'Guildhall proceeds when configured gates and coordinator checks are enough.',
    leverPositions: {
      start_policy: 'coordinator_sufficient',
      completion_approval: 'gates_sufficient',
      task_origination: 'agent_proposed_coordinator_approved',
    },
  },
  {
    id: 'release_hardening',
    label: 'Release hardening',
    summary: 'Guildhall favors stricter review, broader proof, and slower completion around release work.',
    leverPositions: {
      reviewer_fanout_policy: 'strict',
      completion_approval: 'human_required',
      pre_rejection_policy: 'coordinator_reviews',
    },
  },
]
```

Create tests that assert every profile only references known lever names and valid positions.

- [ ] **Step 6: Build `OperatingProfilePanel`**

Panel behavior:

- Shows current profile.
- Shows changed overrides as a short list.
- Shows raw lever editor only inside `DeveloperToolsPanel`, not the default Settings path.
- Provides one "Reset project overrides" action.

- [ ] **Step 7: Remove deprecated `merge_policy`**

Add migration `0.10.0/merge-policy-to-landing-strategy`:

- Detect project config containing `merge_policy`.
- Copy value to `landing_strategy` when `landing_strategy` is absent.
- Delete `merge_policy`.
- Mark migration required if any project still has `merge_policy`.

Then remove `merge_policy` from `src/levers/schema.ts` and `src/levers/storage.ts`.

- [ ] **Step 8: Move remaining specialist panels**

Move logic out of Settings:

- Memory/suggested learnings -> project intelligence surface.
- Re-intake -> bounded-chat/review thread entry point plus specialist review panel.
- Design feedback/design-system/codebase map -> project intelligence or developer tools, depending on whether the owner is making a decision or debugging Guildhall.
- Project graph/structural-map review -> project-structure surface. Do not
  recreate this as a hidden developer section.

- [ ] **Step 9: Run tests**

Run:

```bash
pnpm vitest run src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts src/levers/__tests__/profiles.test.ts src/runtime/__tests__/serve-settings.test.ts src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts --reporter=dot
```

Expected: PASS, with `SettingsTab.svelte` under 400 lines.

Commit:

```bash
git add src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/settings src/web/surfaces/project/structure src/web/surfaces/ProjectView.svelte src/levers/profiles.ts src/levers/__tests__/profiles.test.ts src/levers/schema.ts src/levers/storage.ts src/runtime/migrations.ts
git commit -m "refactor: shrink settings into focused panels"
```

## Task 6: Remove Product-Specific Branches From Generic Runtime

**Files:**
- Create: `src/runtime/work-graph-domain-adapters.ts`
- Create: `src/runtime/__tests__/work-graph-domain-adapters.test.ts`
- Modify: `src/runtime/evidence-work-graph-intake.ts`
- Modify: `src/runtime/design-feedback.ts`
- Modify: `src/runtime/design-system-discovery.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/runtime/init.ts`
- Modify: `src/tools/agent-settings-tool.ts`
- Move: `src/runtime/guildhall.config.ts`

- [x] **Step 1: Write adapter tests**

Create `src/runtime/__tests__/work-graph-domain-adapters.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { genericWorkGraphDomainAdapter } from '../work-graph-domain-adapters.js'

describe('work graph domain adapters', () => {
  it('does not inject sample product names into generic UI component proof', () => {
    const proof = genericWorkGraphDomainAdapter.proofPaths({
      name: 'Reusable confirmation primitive',
      targetArea: 'design-system',
      workShape: 'ui-component',
      consumerSurfaces: ['admin destructive confirmation flow'],
      sharedFoundations: ['tokens'],
      statusHint: 'missing',
    })
    const serialized = JSON.stringify(proof)
    expect(serialized).not.toMatch(/Looma|Knit|AlertDialog/)
    expect(serialized).toContain('design-system')
  })

  it('uses consumer metadata without renaming it to a known app', () => {
    const label = genericWorkGraphDomainAdapter.primaryConsumerSurface({
      name: 'Saved filter drawer',
      targetArea: 'task-board',
      workShape: 'ui-component',
      consumerSurfaces: ['mobile navigation drawer'],
      sharedFoundations: [],
      statusHint: 'missing',
    })
    expect(label).toBe('mobile navigation drawer')
  })
})
```

Evidence, 2026-06-01 coordinator slice:

- Added `src/runtime/__tests__/work-graph-domain-adapters.test.ts` with
  assertions that generic proof paths do not inject sample product names and
  consumer metadata is not renamed to a known app.

- [x] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts --reporter=dot
```

Expected: FAIL because adapter module does not exist.

Evidence, 2026-06-01 coordinator slice:

- `pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts --reporter=dot`
  failed because `../work-graph-domain-adapters.js` did not exist.

- [x] **Step 3: Add adapter contract**

Create `src/runtime/work-graph-domain-adapters.ts`:

```ts
export interface WorkGraphDomainUnit {
  name: string
  targetArea: string
  workShape: 'ui-component' | 'backend-api' | 'cli-tool' | 'docs' | 'migration' | 'bugfix' | 'single-edit' | string
  consumerSurfaces: string[]
  sharedFoundations: string[]
  statusHint: 'missing' | 'shipped' | 'unknown'
}

export interface WorkGraphDomainAdapter {
  id: string
  normalizeDeliverableName(value: string): string
  primaryConsumerSurface(unit: WorkGraphDomainUnit): string
  integrationTitle(unit: WorkGraphDomainUnit, consumerSurface: string): string
  integrationTargetArea(unit: WorkGraphDomainUnit, consumerSurface: string): string
  needsIntegrationTask(unit: WorkGraphDomainUnit): boolean
  proofPaths(unit: WorkGraphDomainUnit): Array<{ kind: string; command?: string; expectedEvidence: string[] }>
}

export const genericWorkGraphDomainAdapter: WorkGraphDomainAdapter = {
  id: 'generic',
  normalizeDeliverableName(value) {
    return value.trim()
  },
  primaryConsumerSurface(unit) {
    return unit.consumerSurfaces[0] ?? unit.targetArea
  },
  integrationTitle(unit, consumerSurface) {
    return `Integrate ${unit.name} into ${consumerSurface}`
  },
  integrationTargetArea(_unit, consumerSurface) {
    return consumerSurface
  },
  needsIntegrationTask(unit) {
    if (unit.statusHint === 'shipped') return false
    return unit.consumerSurfaces.length > 0
  },
  proofPaths(unit) {
    if (unit.workShape === 'backend-api') {
      return [{ kind: 'command', command: `pnpm test -- ${slugify(unit.name)}.integration`, expectedEvidence: [`${unit.name} integration behavior is covered.`] }]
    }
    if (unit.workShape === 'cli-tool') {
      return [{ kind: 'command', command: `pnpm test -- ${slugify(unit.name)}-cli`, expectedEvidence: [`${unit.name} command output is stable.`] }]
    }
    if (unit.workShape === 'docs') {
      return [{ kind: 'review', expectedEvidence: [`${unit.name} wording is scoped to the requested documentation change.`] }]
    }
    return [
      { kind: 'command', command: `pnpm test -- ${slugify(unit.name)}`, expectedEvidence: [`${unit.name} behavior is covered.`] },
      { kind: 'review', expectedEvidence: [`${unit.name} follows ${unit.targetArea} conventions.`] },
    ]
  },
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
```

Evidence, 2026-06-01 coordinator slice:

- Added `src/runtime/work-graph-domain-adapters.ts` with a generic adapter
  contract for normalization, consumer-surface selection, integration titles,
  integration target areas, integration-task decisions, and proof paths.

- [x] **Step 4: Replace hardcoded work-graph branches**

In `src/runtime/evidence-work-graph-intake.ts`:

- Remove `unit.targetArea === 'looma' ? '@looma/core'`.
- Remove `isKnit`.
- Remove `Knit destructive confirmation flow`.
- Remove `Knit mobile navigation drawer`.
- Remove `Compliance dashboard` rename.
- Remove `AlertDialog`, `Dialog`, `Drawer`, and `Button` normalization.
- Use adapter methods for all of the above.

Evidence, 2026-06-01 coordinator slice:

- `src/runtime/evidence-work-graph-intake.ts` now delegates normalization,
  proof paths, integration titles, consumer surfaces, target areas, and
  integration-task decisions through `genericWorkGraphDomainAdapter`.
- Removed the special `@looma/core`, `isKnit`, known consumer-flow renames,
  compliance-dashboard rename, and component-name normalization branches from
  generic runtime code.

- [x] **Step 5: Generalize design feedback**

In `src/runtime/design-feedback.ts`:

- Rename `LoomaImprovement` to `DesignSystemImprovement`.
- Replace `loomaImprovements` store field with `designSystemImprovements`.
- Replace `discoverLoomaDevelopmentHook` with:

```ts
export async function discoverDesignSystemDevelopmentTargets(input: {
  globalConfig?: Partial<GlobalConfigType>
  env?: NodeJS.ProcessEnv
} = {}): Promise<DesignSystemDevelopmentTargetStatus[]> {
  // Read configured targets from global config and environment.
  // Validate each target by id, path, git worktree status, and optional package markers.
}
```

- Environment support should be generic:
  - `GUILDHALL_DESIGN_SYSTEM_PATH`
  - `GUILDHALL_DESIGN_SYSTEM_ID`

Evidence, 2026-06-01 coordinator slice:

- `src/runtime/design-feedback.ts` now exports
  `DesignSystemImprovement`, `designSystemImprovements`, and
  `discoverDesignSystemDevelopmentTargets`.
- `src/config/schemas.ts` now supports generic
  `experimental.designSystemDevelopment.targets[]` records with optional
  package markers.
- `src/runtime/serve.ts`, `src/mcp-server/project-reader.ts`, and
  `src/web/surfaces/project/SettingsTab.svelte` consume the generic field names.

- [x] **Step 6: Move sample config out of runtime**

Move `src/runtime/guildhall.config.ts` to an internal fixture or example.

Acceptable targets:

- `internal/fixtures/looma-knit/guildhall.config.ts`
- `examples/looma-knit/guildhall.config.ts`

Update any tests/imports that expected it under `src/runtime`.

Evidence, 2026-06-01 coordinator slice:

- Moved `src/runtime/guildhall.config.ts` to
  `internal/fixtures/looma-knit/guildhall.config.ts`.
- Updated `src/runtime/__tests__/guildhall-config.test.ts` to import the
  fixture from its new non-runtime location.

- [x] **Step 7: Replace examples**

Change examples in:

- `src/runtime/init.ts`
- `src/tools/agent-settings-tool.ts`
- comments and help text under generic runtime paths

Use neutral examples such as `frontend`, `backend`, `docs`, `release`, or `platform`.

Evidence, 2026-06-01 coordinator slice:

- Replaced the setup-domain prompt example in `src/runtime/init.ts` with
  `frontend`.
- Replaced the agent-settings tool coordinator example with `frontend` and
  `backend`.
- Generalized design-system discovery tests to use a neutral scoped foundation
  package.

- [x] **Step 8: Run guardrails and tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts src/runtime/__tests__/generalization-smoke.test.ts src/runtime/__tests__/serve-settings.test.ts --reporter=dot
pnpm lint:reductions
```

Expected: PASS after sample-product vocabulary is gone from generic runtime paths.

Evidence, 2026-06-01 coordinator slice:

- `pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts src/runtime/__tests__/evidence-work-graph-intake.test.ts src/runtime/__tests__/design-feedback.test.ts src/runtime/__tests__/design-system-discovery.test.ts src/runtime/__tests__/serve-design-feedback.test.ts src/config/__tests__/schemas.test.ts src/runtime/__tests__/guildhall-config.test.ts --reporter=dot`
  passed with 67 tests.
- `pnpm lint:reductions` passed.
- `pnpm typecheck` passed.

Commit:

```bash
git add src/runtime/work-graph-domain-adapters.ts src/runtime/__tests__/work-graph-domain-adapters.test.ts src/runtime/evidence-work-graph-intake.ts src/runtime/design-feedback.ts src/runtime/design-system-discovery.ts src/runtime/serve.ts src/runtime/init.ts src/tools/agent-settings-tool.ts internal/fixtures/looma-knit scripts/reduction-guardrails.mjs
git commit -m "refactor: move product-specific work graph logic behind adapters"
```

## Task 7: Audit and Govern UI Components and Design Tokens

**Files:**
- Created: `internal/constitutions/README.md`
- Created: `internal/constitutions/design-system-governance.md`
- Create: `internal/audits/2026-06-01-ui-component-token-governance.md`
- Create: `packages/ui/src/component-constitution.ts`
- Create: `scripts/design-token-audit.mjs`
- Create: `scripts/design-token-audit.test.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: token source that generates `packages/ui/src/styles.css`
- Modify: `src/web/tokens.css`
- Modify: `package.json`

- [x] **Step 0: Enshrine design-system governance**

Created `internal/constitutions/design-system-governance.md` as the source of
law for this task. Implementation work must treat that file as authoritative
for:

- token roles and budgets;
- typography, spacing, radius, elevation, and z-index rules;
- variant vocabulary and deprecated aliases;
- component contract fields;
- surface ownership, including the rule that Project graph/structural-map review
  must not remain inside Settings;
- chopping-block criteria;
- deterministic checks and amendment rules.

`packages/ui/src/component-constitution.ts` should be a machine-readable subset
of this constitution, not a competing policy.

- [x] **Step 1: Write the failing scanner test**

Create `scripts/design-token-audit.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'guildhall-design-audit-'))
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return root
}

function run(root: string): string {
  try {
    execFileSync(process.execPath, [path.join(process.cwd(), 'scripts/design-token-audit.mjs'), root], {
      cwd: root,
      stdio: 'pipe',
    })
    return ''
  } catch (err) {
    return String((err as { stderr?: Buffer }).stderr ?? err)
  }
}

describe('design token audit', () => {
  it('rejects raw typography, legacy app token families, and local component lookalikes', () => {
    const root = repo({
      'src/web/surfaces/Bad.svelte': `
        <style>
          .title { font-size: clamp(1.2rem, 2vw, 2rem); font-weight: 700; letter-spacing: -0.02em; }
          .panel { padding: 14px; border-radius: 10px; gap: 7px; }
          .copy { font-size: var(--fs-2); }
        </style>
      `,
      'src/web/lib/NoticeBand.svelte': '<style>.notice { font-size: var(--gh-type-size-2); }</style>',
    })
    const stderr = run(root)
    expect(stderr).toContain('raw font-size')
    expect(stderr).toContain('raw font-weight')
    expect(stderr).toContain('negative letter-spacing')
    expect(stderr).toContain('raw padding')
    expect(stderr).toContain('legacy token family')
    expect(stderr).toContain('duplicate primitive')
  })

  it('permits canonical package tokens and package primitives', () => {
    const root = repo({
      'packages/ui/src/styles.css': ':root { --gh-type-size-body: 13.5px; --gh-type-weight-strong: 600; }',
      'packages/ui/src/components/FrameCard.svelte': `
        <style>
          .frame { padding: var(--gh-layout-frame-padding-default); border-radius: var(--gh-radius-3); }
          .title { font-size: var(--gh-type-size-title); font-weight: var(--gh-type-weight-strong); }
        </style>
      `,
      'src/web/surfaces/Good.svelte': `
        <style>
          .copy { font-size: var(--gh-type-size-body); font-weight: var(--gh-type-weight-body); }
        </style>
      `,
    })
    expect(run(root)).toBe('')
  })
})
```

  - Evidence: Added `scripts/design-token-audit.test.ts` with fixtures for raw
    typography, raw spacing/radius, legacy token families, duplicate primitives,
    and permitted canonical role-token usage.

- [x] **Step 2: Run the test and confirm red**

Run:

```bash
pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot
```

Expected: FAIL because `scripts/design-token-audit.mjs` does not exist.

  - Evidence: `pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot`
    exited 1 before the script existed with `MODULE_NOT_FOUND` for
    `scripts/design-token-audit.mjs`.

- [x] **Step 3: Add the design-token audit script**

Create `scripts/design-token-audit.mjs`:

```js
#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? process.cwd()

const sourceRoots = [
  'src/web',
  'packages/ui/src',
].map(part => join(root, part)).filter(existsSync)

const allowedTokenDefinitionFiles = [
  /^src\/web\/tokens\.css$/,
  /^packages\/ui\/src\/styles\.css$/,
  /^packages\/ui\/src\/token-definitions\.(js|ts)$/,
]

const duplicatePrimitiveFiles = [
  /^src\/web\/lib\/NoticeBand\.svelte$/,
  /^src\/web\/lib\/Card\.svelte$/,
]

const checks = [
  {
    label: 'raw font-size',
    pattern: /font-size\s*:\s*(?!var\(--gh-type-size-)(?!inherit\b)[^;]+;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'raw font-weight',
    pattern: /font-weight\s*:\s*(?!var\(--gh-type-weight-)(?!inherit\b)[^;]+;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'raw line-height',
    pattern: /line-height\s*:\s*(?!var\(--gh-type-line-height-)(?!inherit\b)[^;]+;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'raw padding',
    pattern: /padding(?:-[a-z-]+)?\s*:\s*(?!var\(--gh-)[^;]*(?:px|rem|em|clamp\()[^;]*;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'raw gap',
    pattern: /gap\s*:\s*(?!var\(--gh-)[^;]*(?:px|rem|em|clamp\()[^;]*;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'raw radius',
    pattern: /border-radius\s*:\s*(?!var\(--gh-radius-)[^;]+;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'negative letter-spacing',
    pattern: /letter-spacing\s*:\s*-[^;]+;/g,
    allowed: allowedTokenDefinitionFiles,
  },
  {
    label: 'legacy token family',
    pattern: /var\(--(?:fs|s|r)-[0-9]/g,
    allowed: allowedTokenDefinitionFiles,
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(svelte|css|ts|js)$/.test(entry)) out.push(full)
  }
  return out
}

function lineFor(source, index) {
  return source.slice(0, index).split('\n').length
}

const failures = []
for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    const rel = relative(root, file)
    const source = readFileSync(file, 'utf8')
    if (duplicatePrimitiveFiles.some(pattern => pattern.test(rel))) {
      failures.push(`${rel}: duplicate primitive; use packages/ui or src/web/lib/ui-compat`)
    }
    for (const check of checks) {
      if (check.allowed.some(pattern => pattern.test(rel))) continue
      for (const match of source.matchAll(check.pattern)) {
        failures.push(`${rel}:${lineFor(source, match.index ?? 0)}: ${check.label}: ${match[0].trim()}`)
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
```

  - Evidence: Created `scripts/design-token-audit.mjs`; reran
    `pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot` and it
    passed with 2 tests.

- [x] **Step 4: Add package script**

Add to `package.json` scripts:

```json
"lint:design": "node scripts/design-token-audit.mjs"
```

  - Evidence: Added `lint:design` to `package.json`; `pnpm lint:design` now runs
    the scanner and reports the existing Step 8 surface/lib debt.

- [x] **Step 5: Create the component constitution**

Create `packages/ui/src/component-constitution.ts`:

```ts
export type ComponentTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'
export type ComponentDensity = 'dense' | 'compact' | 'comfortable'
export type ComponentPadding = 'compact' | 'default' | 'roomy'
export type ComponentMode = 'operator' | 'display'
export type ComponentEmphasis = 'quiet' | 'default' | 'strong'
export type TextRole =
  | 'page-title'
  | 'section-title'
  | 'panel-title'
  | 'body'
  | 'body-strong'
  | 'meta'
  | 'caption'
  | 'eyebrow'
  | 'code'

export interface ComponentContract {
  name: string
  owns: string
  useFor: string[]
  doNotUseFor: string[]
  allowedTones?: ComponentTone[]
  allowedDensities?: ComponentDensity[]
  allowedPadding?: ComponentPadding[]
  allowedModes?: ComponentMode[]
  allowedEmphasis?: ComponentEmphasis[]
  replacementFor?: string[]
  maxVariantAxes: number
}

export const textRoleTokens: Record<TextRole, {
  size: string
  weight: string
  lineHeight: string
}> = {
  'page-title': { size: '--gh-type-size-page-title', weight: '--gh-type-weight-strong', lineHeight: '--gh-type-line-height-tight' },
  'section-title': { size: '--gh-type-size-section-title', weight: '--gh-type-weight-strong', lineHeight: '--gh-type-line-height-tight' },
  'panel-title': { size: '--gh-type-size-panel-title', weight: '--gh-type-weight-strong', lineHeight: '--gh-type-line-height-tight' },
  body: { size: '--gh-type-size-body', weight: '--gh-type-weight-body', lineHeight: '--gh-type-line-height-body' },
 'body-strong': { size: '--gh-type-size-body', weight: '--gh-type-weight-strong', lineHeight: '--gh-type-line-height-body' },
  meta: { size: '--gh-type-size-meta', weight: '--gh-type-weight-body', lineHeight: '--gh-type-line-height-body' },
  caption: { size: '--gh-type-size-caption', weight: '--gh-type-weight-body', lineHeight: '--gh-type-line-height-body' },
  eyebrow: { size: '--gh-type-size-eyebrow', weight: '--gh-type-weight-strong', lineHeight: '--gh-type-line-height-tight' },
  code: { size: '--gh-type-size-code', weight: '--gh-type-weight-body', lineHeight: '--gh-type-line-height-body' },
}

export const componentContracts: ComponentContract[] = [
  {
    name: 'FrameCard',
    owns: 'framed panel geometry and section-level grouping',
    useFor: ['settings panels', 'release criteria', 'contained repeated panels'],
    doNotUseFor: ['page sections', 'nested card stacks', 'buttons disguised as cards'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger'],
    allowedDensities: ['dense', 'compact', 'comfortable'],
    allowedPadding: ['compact', 'default', 'roomy'],
    allowedModes: ['operator', 'display'],
    replacementFor: ['src/web/lib/Card.svelte'],
    maxVariantAxes: 3,
  },
  {
    name: 'NoticeBand',
    owns: 'inline status, warning, and recovery notices',
    useFor: ['blocking setup notices', 'migration warnings', 'empty/error/loading states that need action'],
    doNotUseFor: ['normal section intros', 'decorative callouts', 'success badges'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger'],
    allowedDensities: ['compact', 'comfortable'],
    replacementFor: ['src/web/lib/NoticeBand.svelte'],
    maxVariantAxes: 3,
  },
  {
    name: 'StatusPill',
    owns: 'short status labels with semantic tone',
    useFor: ['state chips', 'count labels', 'readiness labels'],
    doNotUseFor: ['primary actions', 'long prose labels'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger', 'accent'],
    allowedDensities: ['dense', 'compact', 'comfortable'],
    allowedEmphasis: ['quiet', 'default', 'strong'],
    replacementFor: ['src/web/lib/Chip.svelte when the chip is state, not metadata'],
    maxVariantAxes: 3,
  },
]
```

  - Evidence: Created `packages/ui/src/component-constitution.ts` with tone,
    density, padding, mode, emphasis, size, text, spacing, radius, component
    contract, accessibility, protection, replacement, and explicit-exception
    records; `pnpm --filter @guildhall/ui build` passed.

- [x] **Step 6: Add named typography and role tokens**

Update the package token source and generated `packages/ui/src/styles.css` so components can use roles instead of arbitrary scale picks:

```css
:root {
  --gh-type-size-caption: var(--gh-type-size-1);
  --gh-type-size-eyebrow: var(--gh-type-size-1);
  --gh-type-size-meta: var(--gh-type-size-1);
  --gh-type-size-body: var(--gh-type-size-2);
  --gh-type-size-panel-title: var(--gh-type-size-3);
  --gh-type-size-section-title: var(--gh-type-size-4);
  --gh-type-size-page-title: var(--gh-type-size-5);
  --gh-type-size-code: var(--gh-type-size-1);
  --gh-type-weight-body: 400;
  --gh-type-weight-medium: 500;
  --gh-type-weight-strong: 600;
  --gh-type-weight-emphasis: 700;
}
```

Rules:

- `700` is allowed only through `--gh-type-weight-emphasis`.
- `650` and `800` are not allowed.
- Page/surface code should use role tokens, not scale-number tokens.
- Package primitives may use scale-number tokens internally only when the component constitution documents the reason.
- No negative letter spacing.
- No `font-size` based on viewport width in app surfaces.

  - Evidence: Added named role tokens in `packages/ui/src/token-definitions.js`
    and regenerated `packages/ui/src/styles.css`; `pnpm --filter @guildhall/ui build`
    passed.

- [x] **Step 7: Write the governance audit**

Create `internal/audits/2026-06-01-ui-component-token-governance.md` with this structure:

```markdown
# UI Component and Token Governance Audit

## Governing Constitution

This audit implements `internal/constitutions/design-system-governance.md`.
Any exception found here must name the constitutional rule it violates, the
owner, and the removal condition.

## Problem

Guildhall has several overlapping component families and token families. The visible result is inconsistent density, typography, weight, card treatment, notice treatment, and status language across project surfaces.

## Current Signals

- `src/web/tokens.css` owns old app-local `--fs-*`, `--s-*`, and `--r-*` scales.
- `packages/ui/src/styles.css` owns generated `--gh-*` scales.
- App surfaces still use raw font weights such as `600`, `650`, `700`, and `800`.
- Some surfaces use viewport-based type sizing with `clamp(...)`.
- `src/web/lib/NoticeBand.svelte` overlaps with `packages/ui/src/components/NoticeBand.svelte`.
- `src/web/lib/Card.svelte` overlaps with `packages/ui/src/components/FrameCard.svelte`.

## Component Ownership Map

| Need | Canonical component | Non-canonical replacements |
| --- | --- | --- |
| Framed panel | `FrameCard` | `src/web/lib/Card.svelte`, local `.card` classes |
| Notice/status band | `NoticeBand` | `src/web/lib/NoticeBand.svelte`, local alert panels |
| Status chip | `StatusPill` | state-colored `Chip`, ad hoc pill spans |
| Section heading | `SectionHeader` | local `.head h2`, raw heading blocks |
| Action row | `ActionBar` or `Row` with Button | local flex rows with one-off gaps |

## Typography Rules

- Use text roles, not raw font-size values.
- `body` is the default.
- `body-strong` is for labels inside dense operational UI.
- `eyebrow` is uppercase or compact metadata only.
- `panel-title` is the largest title allowed inside cards/panels.
- `page-title` is only for top-level pages.
- Strong weight is `--gh-type-weight-strong`.
- Emphasis weight is rare and must be named by a component contract.

## Spacing and Radius Rules

- Surface code uses `--gh-space-*`, `--gh-radius-*`, and component padding tokens.
- Local `2px`, `7px`, `10px`, `14px`, and arbitrary rem padding are not allowed in surface styles.
- Cards are not nested inside cards.
- Radius stays at 8px or below unless a canonical component owns the exception.

## Variant Budget

Every primitive must name its variant axes and keep them bounded. New variants require updating `component-constitution.ts`, tests, and this audit.

## Deletion List

- Remove `src/web/lib/NoticeBand.svelte` after callers move.
- Remove or wrap `src/web/lib/Card.svelte` after callers move.
- Fold local card, notice, status-row, and pill classes into canonical primitives as surfaces are touched.
```

  - Evidence: Created
    `internal/audits/2026-06-01-ui-component-token-governance.md` with the
    governing constitution link, current signals, ownership map, typography,
    spacing/radius, variant-budget, deletion-list, scanner, and open-exception
    sections.

- [ ] **Step 8: Convert the first surfaces**

Start with the surfaces that showed obvious drift:

- `src/web/surfaces/project/SettingsTab.svelte`
- `src/web/surfaces/project/structure/ProjectStructurePanel.svelte`
- `src/web/surfaces/project/structure/ProjectGraphPanel.svelte`
- `src/web/surfaces/project/ThreadTab.svelte`
- `src/web/surfaces/ProjectView.svelte`
- `src/web/surfaces/project/WorkspaceImportTab.svelte`
- `src/web/surfaces/FleetNeedsYou.svelte`
- `src/web/surfaces/DoThisNext.svelte`
- `packages/ui/src/components/AlertBand.svelte`
- `packages/ui/src/components/FrameCard.svelte`
- `packages/ui/src/components/SectionHeader.svelte`
- `packages/ui/src/components/StatusPill.svelte`

For each touched surface:

- replace `--fs-*` with `--gh-type-size-*` role tokens;
- replace raw font weights with `--gh-type-weight-*`;
- replace negative letter spacing with `0`;
- replace raw local padding/gap/radius with `--gh-*` tokens;
- replace local status/card/notice classes with canonical primitives when a primitive exists.

  - Deferred: Worker A scope for this slice excludes these Svelte surfaces and
    package component implementation files. The scanner, tokens, constitution,
    and audit are in place; the named surface conversion remains for the UI
    surface/component owner.
  - Evidence: Worker E converted the first narrow batch:
    `src/web/surfaces/DoThisNext.svelte`,
    `packages/ui/src/components/AlertBand.svelte`,
    `packages/ui/src/components/FrameCard.svelte`, and
    `packages/ui/src/components/StatusPill.svelte`. `DoThisNext` now composes
    `FrameCard` instead of the local `Card` primitive, and the touched files use
    `--gh-*` spacing, control line-height, notice accent width, and named type
    role tokens. Post-slice `pnpm lint:design` no longer reports any of these
    touched files.
  - Remaining: Step 8 stays open because the whole-repo audit still reports
    unmanaged token/component debt in untouched surfaces.

- [ ] **Step 9: Run the audit and focused UI tests**

Run:

```bash
pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot
pnpm lint:design
pnpm vitest run src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts src/web/surfaces/project/structure/__tests__/ProjectStructurePanel.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/surfaces/__tests__/FleetNeedsYou.svelte.test.ts --reporter=dot
```

Expected: PASS, with the design audit no longer flagging touched surfaces.

  - Evidence: `pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot`
    passed with 2 tests.
  - Deferred: `pnpm lint:design` currently exits 1 because Step 8 is not in
    Worker A scope. It reports existing raw/legacy styling and duplicate
    primitive debt across `src/web/lib/*`, `src/web/surfaces/*`, and the named
    Task 7 surfaces.
  - Evidence: Worker E ran
    `pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot`
    (passed, 2 tests),
    `pnpm vitest run src/web/surfaces/__tests__/DoThisNext.svelte.test.ts --reporter=dot`
    (passed, 6 tests), and
    `pnpm --filter @guildhall/ui typecheck` (passed).
  - Blocked: Worker E reran `pnpm lint:design`; it still exits 1. Touched files
    are clean, but the remaining audit failures are:

```text
369 src/web/surfaces/project/ThreadTab.svelte
145 src/web/surfaces/project/SettingsTab.svelte
119 src/web/surfaces/ProjectView.svelte
118 src/web/surfaces/project/WorkspaceImportTab.svelte
117 src/web/surfaces/ProjectsHome.svelte
93 src/web/lib/AgentQuestion.svelte
89 src/web/surfaces/project/CoordinatorsTab.svelte
84 src/web/surfaces/SetupWizard.svelte
83 src/web/surfaces/project/ProjectOverviewTab.svelte
71 src/web/surfaces/project/WorkTab.svelte
66 src/web/surfaces/TaskDrawer.svelte
60 src/web/surfaces/project/InboxTab.svelte
60 src/web/surfaces/drawer/JourneyTab.svelte
56 src/web/surfaces/project/WorkTreePreview.svelte
56 src/web/surfaces/drawer/SpecTab.svelte
54 src/web/surfaces/ProvidersPage.svelte
53 src/web/lib/ProjectCard.svelte
48 src/web/surfaces/drawer/CurrentTab.svelte
47 src/web/surfaces/FleetNeedsYou.svelte
41 src/web/surfaces/drawer/ExpertsTab.svelte
39 src/web/lib/Markdown.svelte
37 src/web/surfaces/Header.svelte
32 src/web/lib/TaskCard.svelte
30 src/web/surfaces/project/FactsTab.svelte
29 src/web/surfaces/project/PlannerTab.svelte
28 src/web/surfaces/drawer/ProvenanceTab.svelte
27 src/web/surfaces/project/ProjectProvidersSection.svelte
26 src/web/surfaces/project/ReleaseTab.svelte
25 src/web/surfaces/project/TimelineTab.svelte
25 src/web/surfaces/drawer/SpecFillChecklist.svelte
24 src/web/surfaces/drawer/TranscriptTab.svelte
22 src/web/lib/ProviderPicker.svelte
21 src/web/lib/ProgressFeed.svelte
20 src/web/lib/NoticeBand.svelte
19 src/web/surfaces/drawer/OverviewTab.svelte
19 src/web/surfaces/drawer/HistoryTab.svelte
19 src/web/lib/layout/AppShell.svelte
19 src/web/lib/SideDrawer.svelte
19 src/web/lib/Modal.svelte
18 src/web/surfaces/drawer/WhyStuck.svelte
17 src/web/lib/Help.svelte
16 src/web/surfaces/project/ProjectAttachFlow.svelte
16 src/web/surfaces/IntakeModal.svelte
15 src/web/lib/StatusButton.svelte
15 src/web/lib/PageHeader.svelte
14 src/web/lib/Chip.svelte
14 packages/ui/src/components/HeroBand.svelte
13 src/web/lib/WorkMixChart.svelte
13 src/web/lib/UtilityPanel.svelte
13 src/web/lib/Button.svelte
12 src/web/surfaces/drawer/SuggestionCard.svelte
12 src/web/lib/Card.svelte
11 src/web/lib/layout/ProjectsShell.svelte
11 src/web/lib/WizardStepper.svelte
11 src/web/lib/DefinitionList.svelte
10 src/web/lib/Tooltip.svelte
10 src/web/lib/ToastHost.svelte
9 src/web/surfaces/drawer/ResolveEscalationModal.svelte
9 src/web/lib/Tabs.svelte
9 src/web/lib/StateSummary.svelte
9 src/web/lib/StaleServerBanner.svelte
9 src/web/lib/AlignedActionList.svelte
8 src/web/lib/StatusLine.svelte
8 src/web/lib/LogViewer.svelte
7 src/web/lib/SegmentedControl.svelte
7 src/web/lib/OverviewTaskRow.svelte
6 src/web/lib/Textarea.svelte
6 src/web/lib/Select.svelte
6 src/web/lib/Input.svelte
4 src/web/lib/StatusLight.svelte
4 src/web/lib/Section.svelte
4 src/web/lib/InteractionCardLayout.svelte
4 src/web/lib/Field.svelte
4 packages/ui/src/components/AnnotatedScreenshot.svelte
3 packages/ui/src/components/GuildDiagram.svelte
2 src/web/lib/IdentifierChip.svelte
2 src/web/lib/Byline.svelte
1 src/web/lib/StatusDot.svelte
1 src/web/lib/Icon.svelte
1 src/web/lib/CardList.svelte
1 src/web/lib/ActionBar.svelte
1 src/web/App.svelte
1 packages/ui/src/components/NoticeBand.svelte
```

Commit:

```bash
git add internal/audits/2026-06-01-ui-component-token-governance.md internal/constitutions packages/ui/src/component-constitution.ts packages/ui/src/styles.css packages/ui/src/components src/web/tokens.css scripts/design-token-audit.mjs scripts/design-token-audit.test.ts package.json src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/structure src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/ProjectView.svelte src/web/surfaces/project/WorkspaceImportTab.svelte src/web/surfaces/FleetNeedsYou.svelte src/web/surfaces/DoThisNext.svelte
git commit -m "refactor: govern UI components and design tokens"
```

## Task 8: Consolidate UI Primitives

**Files:**
- Create: `scripts/ui-primitive-scan.mjs`
- Create: `src/web/lib/ui-compat/NoticeBand.svelte`
- Create: `src/web/lib/ui-compat/Card.svelte`
- Modify touched Svelte surfaces
- Delete duplicate local primitives after callers move

- [ ] **Step 1: Add scan**

Create `scripts/ui-primitive-scan.mjs`:

```js
#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()
const deprecatedImports = [
  /from ['"]\.\.\/\.\.\/lib\/NoticeBand\.svelte['"]/,
  /from ['"]\.\.\/\.\.\/lib\/Card\.svelte['"]/,
  /from ['"].*\/lib\/NoticeBand\.svelte['"]/,
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

const failures = []
for (const file of walk(join(root, 'src', 'web'))) {
  const rel = relative(root, file)
  const source = readFileSync(file, 'utf8')
  if (deprecatedImports.some(pattern => pattern.test(source))) {
    failures.push(`${rel}: import package UI primitives or ui-compat wrappers instead of old local NoticeBand/Card`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
```

- [ ] **Step 2: Route old primitives through wrappers**

Create wrappers in `src/web/lib/ui-compat/` that delegate to `packages/ui` and preserve only props still needed by existing callers. Then move callers incrementally.

- [ ] **Step 3: Replace touched imports**

For every Svelte file touched by this plan, import canonical primitives from `packages/ui/src/components` or the temporary `ui-compat` wrapper. Do not add new local card/notice CSS.

- [ ] **Step 4: Run tests**

Run:

```bash
node scripts/ui-primitive-scan.mjs
pnpm vitest run src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts --reporter=dot
```

Commit:

```bash
git add scripts/ui-primitive-scan.mjs src/web/lib/ui-compat src/web/surfaces src/web/lib
git commit -m "refactor: consolidate web UI primitives"
```

## Task 9: Add a Task Transition Boundary for Hot Paths

**Files:**
- Create: `src/runtime/task-transition.ts`
- Create: `src/runtime/__tests__/task-transition.test.ts`
- Read/reuse: `src/runtime/state-machine.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/intake.ts`
- Modify: `src/tools/task-queue.ts`
- Modify: `src/runtime/import-drafts.ts`
- Modify: `src/runtime/merge-dispatcher.ts`

- [x] **Step 1: Write transition tests**

Create `src/runtime/__tests__/task-transition.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyTaskTransition } from '../task-transition.js'

describe('task transitions', () => {
  it('applies legal ready to in_progress transition', () => {
    const result = applyTaskTransition({
      task: { id: 'task-1', status: 'ready' },
      event: 'start_worker',
      actor: 'orchestrator',
      now: '2026-06-01T12:00:00.000Z',
      evidenceRefs: ['task:start-worker'],
    })
    expect(result).toMatchObject({
      kind: 'applied',
      nextState: 'in_progress',
      receipt: { from: 'ready', to: 'in_progress', event: 'start_worker' },
    })
  })

  it('rejects worker start for containing work that still needs split children', () => {
    const result = applyTaskTransition({
      task: {
        id: 'feature',
        status: 'ready',
        hierarchy: { childIds: ['child-a'] },
        taskReadiness: { recommendation: 'split' },
      },
      event: 'start_worker',
      actor: 'orchestrator',
      now: '2026-06-01T12:00:00.000Z',
      evidenceRefs: ['task:start-worker'],
    })
    expect(result).toMatchObject({ kind: 'rejected', reason: 'containing_work_not_runnable' })
  })
})
```

  - Evidence: Added `src/runtime/__tests__/task-transition.test.ts` covering
    legal ready-to-worker transitions, split-container worker rejection,
    explicit runnable-container allowance, illegal worker starts, required
    completion evidence, import-draft intake events, and the absence of
    `hold`/`resume` lifecycle events.

- [x] **Step 2: Implement minimal transition boundary**

Create `src/runtime/task-transition.ts`:

```ts
import { defineStateMachine, transition, type TransitionResult } from './state-machine.js'

export type TaskTransitionEvent =
  | 'mark_ready'
  | 'start_worker'
  | 'request_review'
  | 'start_gate_check'
  | 'complete'
  | 'block'
  | 'shelve'

export type TaskTransitionState =
  | 'proposed'
  | 'import_draft'
  | 'exploring'
  | 'spec_review'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'gate_check'
  | 'pending_pr'
  | 'blocked'
  | 'shelved'
  | 'done'

export interface TaskTransitionContext {
  task: {
    id: string
    status: TaskTransitionState
    hierarchy?: { childIds?: string[] }
    taskReadiness?: { recommendation?: string }
  }
  requiredEvidencePresent?: boolean
}

export const taskLifecycleMachine = defineStateMachine<TaskTransitionState, TaskTransitionEvent, TaskTransitionContext>({
  id: 'task-lifecycle',
  version: 1,
  initial: 'proposed',
  terminal: ['done'],
  states: taskLifecycleStates,
})

export function applyTaskTransition(input: {
  task: TaskTransitionContext['task']
  event: TaskTransitionEvent
  actor: string
  evidenceRefs: string[]
  now: string
  requiredEvidencePresent?: boolean
}): TransitionResult<TaskTransitionState, TaskTransitionEvent> {
  return transition(taskLifecycleMachine, {
    entityId: input.task.id,
    currentState: input.task.status,
    event: input.event,
    context: { task: input.task, requiredEvidencePresent: input.requiredEvidencePresent },
    actor: input.actor,
    evidenceRefs: input.evidenceRefs,
    now: input.now,
  })
}
```

Rules:

- Reuse `defineStateMachine`, `transition`, `TransitionResult`, and
  `TransitionReceipt` from `src/runtime/state-machine.ts`.
- Do not define a parallel task-only transition framework.
- Define `taskLifecycleStates` with the same explicit table style used by
  `projectDependencyEdgeMachine` and `structuralMapReviewMachine`.
- Retry idempotency uses `applyTransitionCommand` at command-handling boundaries.
  The pure task transition result remains only `applied` or `rejected`.
- `start_worker` allowed only from `ready`.
- `start_worker` rejected when `task.hierarchy.childIds.length > 0` and readiness is not `ready`.
- `request_review` allowed from `in_progress`.
- `start_gate_check` allowed from `review`.
- `complete` allowed from `gate_check`, `review`, or `pending_pr` only when required evidence is present in context.
- `block` allowed from any non-terminal status.
- `shelve` allowed from `proposed`, `exploring`, `spec_review`, `ready`, or `in_progress`.
- `hold` and `resume` are deliberately out of scope until Guildhall either
  deletes hold metadata or introduces a real `held` state with a conversion
  script.

  - Evidence: Added `src/runtime/task-transition.ts` with `taskLifecycleMachine`
    backed by `defineStateMachine`/`transition`, a pure `applyTaskTransition`
    result, a throwing mutation helper for call sites, explicit lifecycle
    table rows, `start_worker` readiness/hierarchy guards, required completion
    evidence, terminal `done`/`blocked`/`shelved` states, and explicit
    import-draft intake events.

- [ ] **Step 3: Replace direct writes in hot paths**

Use `applyTaskTransition` in:

- orchestrator worker start/review/gate/done/block paths;
- intake promotion to ready/spec_review;
- required split materialization;
- import draft apply;
- merge dispatcher pending PR/done paths.

Do not attempt to migrate every status write in one commit. After each replaced hot path, add or update a focused test.

  - Partial evidence: Routed deterministic ready-claim, worker handoff recovery,
    lean command review, acceptance command gates, guild gates, handoff step
    advance, reviewer fan-out approve/revise/adjudication, spec approval,
    required split materialization, import-draft normalization/promotion, and
    superseded fixup shelving through the task transition boundary.
  - Remaining: generic `update-task` status writes, post-completion landing
    reconciliation, dispatch-merge `pending_pr`/`done`/`blocked` assignments,
    and several legacy orchestrator recovery writes still need follow-up
    migration before this step should be checked off.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-transition.test.ts src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/intake.test.ts src/runtime/__tests__/merge-dispatcher.test.ts src/tools/__tests__/task-queue.test.ts --reporter=dot
```

  - Evidence: `pnpm vitest run src/runtime/__tests__/task-transition.test.ts --reporter=dot`
    passed with 7 tests.
  - Evidence: `pnpm vitest run src/runtime/__tests__/task-transition.test.ts src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/intake.test.ts src/runtime/__tests__/merge-dispatcher.test.ts src/tools/__tests__/task-queue.test.ts --reporter=dot`
    passed with 384 tests.
  - Typecheck note: `pnpm typecheck` currently exits 2 on concurrent Inbox
    type errors in `src/runtime/inbox.ts`, `src/runtime/__tests__/inbox.test.ts`,
    `src/runtime/attention.ts`, and `src/runtime/serve.ts`; those files are
    outside Worker B scope and were already dirty.

Commit:

```bash
git add src/runtime/task-transition.ts src/runtime/__tests__/task-transition.test.ts src/runtime/orchestrator.ts src/runtime/intake.ts src/tools/task-queue.ts src/runtime/import-drafts.ts src/runtime/merge-dispatcher.ts
git commit -m "refactor: route hot task transitions through a boundary"
```

## Task 10: Quarantine Lab and Release Proof Fixtures

**Files:**
- Move: `src/runtime/app-spec-smoke.ts`
- Move: `src/runtime/release-proof-matrix.ts`
- Modify: tests/imports that reference those modules
- Modify: `src/benchmarks/fixtures.ts`

- [x] **Step 1: Decide runtime necessity by import graph**

  - Evidence: `rg -n "app-spec-smoke|release-proof-matrix" src scripts internal` showed the two modules were only code-imported by `src/runtime/__tests__/app-spec-smoke.test.ts` and `src/runtime/__tests__/release-proof-matrix.test.ts`; other hits were fixture-path strings, fixture docs, or older internal plans. No shipped CLI/runtime entrypoint imported either module.
  - Evidence: `src/benchmarks/fixtures.ts` was inspected and does not import either module; it remains the runtime-needed benchmark CLI fixture loader and was left unchanged.

Run:

```bash
rg -n "app-spec-smoke|release-proof-matrix" src scripts internal
```

Expected:

- If only tests, benchmarks, or internal plans import them, move them out of `src/runtime`.
- If shipped CLI commands import them, keep a tiny runtime entrypoint and move fixture data to `internal/fixtures`.

- [x] **Step 2: Move non-shipping proof fixtures**

  - Evidence: moved `src/runtime/app-spec-smoke.ts` to `internal/fixtures/app-spec-smoke/runtime.ts` and `src/runtime/release-proof-matrix.ts` to `internal/fixtures/release-proof-matrix/runtime.ts`.
  - Evidence: updated `src/runtime/__tests__/app-spec-smoke.test.ts` and `src/runtime/__tests__/release-proof-matrix.test.ts` to import the internal fixture runtimes.
  - Evidence: removed the temporary `src/runtime/app-spec-smoke.ts` and `src/runtime/release-proof-matrix.ts` allowlist entries from `scripts/reduction-guardrails.mjs`.
  - Evidence: added a reduction-guardrail assertion that both shipping runtime fixture paths stay absent. Red/green: `pnpm vitest run src/runtime/__tests__/reduction-guardrails.test.ts --reporter=dot` first failed with `expected true to be false` for `src/runtime/app-spec-smoke.ts`; after the move it passed with 1 file, 2 tests.
  - Evidence: `test ! -e src/runtime/app-spec-smoke.ts && test ! -e src/runtime/release-proof-matrix.ts && ...` printed `no shipping runtime fixture files or imports`.

Preferred locations:

- `internal/fixtures/app-spec-smoke/runtime.ts`
- `internal/fixtures/release-proof-matrix/runtime.ts`

Update tests to import from the new internal fixture path.

- [ ] **Step 3: Run tests**

  - Evidence: `pnpm vitest run src/runtime/__tests__/app-spec-smoke.test.ts src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot` passed: 2 files, 14 tests passed, 1 skipped.
  - Evidence: `pnpm lint:reductions` passed.
  - Evidence: `pnpm lint:deps` ran and failed with exit code 10 on existing non-Task-10 dependency-cruiser issues: `src/tools/task-queue.ts -> src/runtime/task-transition.ts`, `src/tools/post-user-question.ts -> src/runtime/owner-input-store.ts`, and existing core/persistence/session circular dependency reports. No failure referenced `app-spec-smoke`, `release-proof-matrix`, or the new internal fixture runtime imports.
  - Evidence: `pnpm typecheck` ran and failed with exit code 2 on existing `openQuestions` type errors across `src/runtime/intake.ts`, `src/runtime/orchestrator.ts`, `src/runtime/run-automation.ts`, and related tests. No failure referenced the moved internal fixture runtime paths or rootDir/import issues.

Run:

```bash
pnpm vitest run src/runtime/__tests__/app-spec-smoke.test.ts src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot
pnpm lint:deps
```

Commit:

```bash
git add internal/fixtures src/runtime/__tests__ src/benchmarks/fixtures.ts
git commit -m "refactor: quarantine release proof fixtures outside runtime"
```

## Task 11: Installed-App Verification and Flow-Audit Closure

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Full verification**

Run:

```bash
pnpm typecheck
pnpm test
pnpm lint:deps
pnpm lint:reductions
pnpm lint:design
pnpm build
pnpm dev:install
```

Expected:

- Typecheck passes.
- Test suite passes.
- Dependency scan has no new unexplained orphan warnings from this plan.
- Reduction guardrails pass.
- Design token/component guardrails pass.
- Build passes.
- Dev install succeeds.

- [ ] **Step 2: Live service proof**

Restart the installed service, then verify freshness:

```bash
curl -s http://localhost:7777/api/stale-server
```

Expected JSON includes:

```json
{ "stale": false }
```

Open the active test project:

```text
http://localhost:7777/projects/narrative-harness
```

Browser proof checklist:

- Settings opens directly to readiness and is not a debug cockpit.
- Settings has profile/identity/provider/coordinator/developer sections only.
- Touched surfaces use governed typography, spacing, radius, and component contracts instead of one-off font sizes, weights, card styles, or notice styles.
- Threads contains owner-input conversations.
- Needs You contains alerts, not task questions or approvals.
- Work hierarchy shows containing work through explicit links.
- No visible "Parent task" copy.
- Starting a containing work item does not dispatch unrelated ready work.
- Required migrations appear when an old queue has old shapes.

- [ ] **Step 3: Update `artifact:flow-audit`**

Update `internal/audits/flow-audit.md` under Current Follow-Ups with:

- the plan path;
- migration evidence;
- test commands run;
- browser proof result;
- any remaining reduction candidates.

Commit:

```bash
git add internal/audits/flow-audit.md
git commit -m "docs: record cognitive overhead reduction proof"
```

## Task 12: Future Feature - Corpus Refresh Design-Governance Diagnostics

**Status:** future feature, not required for the first reduction cutover.

**Why:** The design-system constitution should not only police Guildhall's own
web UI. The same lessons should improve the agent harness for any product
Guildhall manages. Corpus digestion and refresh should detect design-system
governance risks early, then feed them into worker/reviewer context before an
agent creates more local UI sprawl.

**Files:**
- Modify: `src/corpus-map/index.ts`
- Modify: `src/corpus-map/storage.ts`
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/agents/worker-agent.ts`
- Modify: `src/agents/reviewer-agent.ts`
- Modify: `src/agents/spec-agent.ts`
- Create: `src/corpus-map/design-governance-diagnostics.ts`
- Create: `src/corpus-map/__tests__/design-governance-diagnostics.test.ts`
- Modify: `docs/superpowers/specs/2026-05-21-corpus-map-engine-technical-spec.md`

- [ ] **Step 1: Add a corpus-map diagnostic model**

Add design-governance diagnostics to codebase-map/corpus-map output:

```ts
export interface DesignGovernanceDiagnostic {
  id: string
  severity: 'info' | 'warn' | 'blocker'
  kind:
    | 'token_family_split'
    | 'raw_visual_values'
    | 'variant_vocabulary_sprawl'
    | 'duplicate_primitive_family'
    | 'surface_ownership_sprawl'
    | 'missing_component_contract'
    | 'unreviewed_design_exception'
  summary: string
  evidence: Array<{ path: string; line?: number; excerpt?: string }>
  recommendation: string
  appliesToReviewerRoles: Array<'design' | 'accessibility' | 'product' | 'maintainability'>
}
```

- [ ] **Step 2: Detect portable design-system risks during refresh**

Corpus refresh should inspect UI projects for:

- multiple token families serving the same role, such as old app-local scales
  beside canonical package tokens;
- raw font sizes, font weights, line heights, spacing, radii, shadows, z-index,
  and hardcoded colors outside token/component layers;
- variant vocabulary drift, such as `regular` vs `comfortable`, `attention` vs
  `warn`, `default` vs `neutral`, or surface-specific `kind`/`appearance` axes;
- duplicate primitive families, such as local cards, notices, chips, status
  rows, and button-like wrappers;
- route/surface components that own unrelated endpoint state, data fetching,
  specialist workflows, and rendering;
- component libraries without contracts for ownership, variants, accessibility,
  and replacement paths.

- [ ] **Step 3: Produce a design-governance packet for workers and reviewers**

When a task is UI-related, context builder should inject a compact packet:

```markdown
## Design Governance

- Canonical design-system authority: <path or absent>
- Token authority: <path or absent>
- Component authority: <paths>
- Known duplicate primitive families: <summary>
- Variant vocabulary risks: <summary>
- Required reviewer checks:
  - Name the token/component roles reused or extended.
  - Reject local one-off styling when a governed primitive exists.
  - Reject new variant names unless a component contract changed.
```

Workers should use the packet before implementation. Reviewers should use it as
evidence, not taste: if a task adds a local primitive while the packet names a
canonical owner, review should request changes unless the handoff records a real
exception.

- [ ] **Step 4: Feed cross-product learnings back into Guildhall**

When reviewers repeatedly flag the same design-governance issue in managed
products, Guildhall should propose one of:

- a project-local design-system memory update;
- a component contract addition;
- a corpus-map override;
- a Guildhall product learning if the issue is broadly portable.

Do not let workers or reviewers mutate those records directly. They should emit
evidence and proposals; owner/coordinator approval decides what becomes durable.

- [ ] **Step 5: Test with Guildhall's own current failure modes**

Use Guildhall as the first fixture:

- split token families: `packages/ui/src/styles.css` vs `src/web/tokens.css`;
- duplicate primitives: package `NoticeBand`/`FrameCard` vs app-local
  `NoticeBand`/`Card`;
- variant vocabulary drift: `regular`, `default`, `attention`, `comfortable`,
  `dense`, `compact`;
- surface ownership sprawl: `SettingsTab.svelte` owning readiness, providers,
  facts, memory, re-intake, design feedback, project graph, and advanced levers.

Expected: the diagnostic output names these as governance risks and the reviewer
packet gives UI reviewers concrete checks before they approve future work.

## Rollout Order

1. Guardrails.
2. Work hierarchy conversion and `parent` status removal.
3. Owner-input linkage, bounded-chat state-machine receipts, task question conversion, and `openQuestions` removal.
4. Inbox/Needs You alert-only collapse.
5. Settings reduction and lever profiles.
6. Product-specific runtime adapter extraction.
7. UI component and design-token governance.
8. UI primitive consolidation.
9. Task transition boundary hot paths.
10. Lab/proof fixture quarantine.
11. Installed-app verification and `artifact:flow-audit` update.
12. Future corpus-refresh design-governance diagnostics.

This order keeps hard persisted-state migrations ahead of UI deletion. It also makes Settings smaller before deeper design-system hook cleanup, so the worst owner-facing cognitive overhead improves before every internal cleanup is perfect.

## Branch and Commit Guidance

- Use a feature branch with the repository default prefix, for example `feature/cognitive-overhead-reduction`.
- If the branch has already been pushed/shared, refresh from `origin/main` with `git merge origin/main`, not rebase.
- Commit after each task.
- Each commit that completes plan steps must update the corresponding checkboxes
  in this plan and include an `Evidence:` bullet under each completed step.
- Do not mix user dirty changes into these commits. If existing dirty files overlap, inspect and preserve them before editing.

## Final Acceptance

The reduction is complete when:

- No normal runtime parser accepts `status: "parent"` as a task status.
- No normal runtime/UI hierarchy builder infers containment from `parentGoalId`.
- No normal task record carries `openQuestions`.
- Bounded-chat lifecycle writes reuse `src/runtime/state-machine.ts` and persist
  transition receipts; no bespoke direct status mutation path remains for normal
  owner-input flows.
- Structural map, task, project graph, capability request, request intake, and
  recovery/settings flows create or reuse `OwnerInputRequest` records linked to
  bounded-chat sessions.
- No bounded-chat session is projected as `pressure_test_question`.
- Threads is the only owner-input conversation surface.
- Needs You is alert-owned.
- Overview, Settings, Work, Structure, and Needs You project linked session
  status/navigation only; they do not invent independent question cards.
- `SettingsTab.svelte` is a small composition shell under 400 lines.
- Project graph and structural-map review live in a focused project-structure
  surface; Settings only links to it when readiness requires attention.
- Raw levers are no longer the default owner-facing Settings experience.
- Generic runtime modules do not branch on Looma/Knit/AlertDialog/Dialog/Drawer.
- Task lifecycle hot paths reuse `src/runtime/state-machine.ts`; no second task
  transition framework exists.
- The UI has an internal design-system governance constitution, a
  machine-readable component constitution, a design-token audit, and no
  unmanaged font-size/font-weight/spacing/radius choices in touched surfaces.
- `--gh-*` is the canonical token family; old `--fs-*`, `--s-*`, and `--r-*` app scales are removed or only exist as temporary aliases during the migration task.
- Touched web surfaces use canonical UI primitives or temporary compatibility wrappers.
- The installed app proves the flow against the active test project with `stale:false`.
