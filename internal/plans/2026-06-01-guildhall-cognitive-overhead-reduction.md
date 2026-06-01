# Guildhall Cognitive Overhead Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Guildhall's cognitive overhead by removing wrong legacy shapes, collapsing duplicate owner-input surfaces, shrinking Settings into a real configuration surface, and moving product/project-specific knowledge out of generic runtime code.

**Architecture:** Prefer hard conversions over long-lived compatibility shims. Existing persisted shapes that are wrong should be detected by required project migrations, converted into the correct model, and then removed from runtime, UI, and schema paths. Generic runtime modules should consume typed hierarchy, thread, policy profile, and domain-adapter contracts rather than knowing about old task statuses, project-specific product names, or raw lever/card details.

**Tech Stack:** TypeScript, Svelte 5, Vitest, existing Guildhall migration ledger, Guildhall MCP/artifact state, no new runtime dependency.

---

## Source Context

- `artifact:flow-audit`
- `internal/plans/2026-05-31-guildhall-0-10-bounded-chat.md`
- `internal/plans/2026-05-31-guildhall-0-10-threads-needs-you-transition.md`
- `internal/specs/2026-06-01-guildhall-0-10-state-machines-project-graph.md`
- `internal/specs/2026-05-27-guildhall-0-9-flexible-work-hierarchy-and-work-list.md`
- `internal/plans/2026-05-31-guildhall-generalization-overfitting-hardening.md`
- `src/core/task.ts`
- `src/runtime/work-hierarchy.ts`
- `src/runtime/bounded-chat.ts`
- `src/runtime/thread.ts`
- `src/runtime/inbox.ts`
- `src/runtime/evidence-work-graph-intake.ts`
- `src/runtime/design-feedback.ts`
- `src/web/surfaces/project/SettingsTab.svelte`

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
| Owner questions | `task.openQuestions` | bounded-chat sessions shown in Threads | Required migration converts unanswered questions to bounded chats; Inbox no longer emits `agent_question_pending`. |
| Attention | Inbox as conversation plus alert queue | Threads for conversations, Needs You for alerts | `InboxItem` no longer includes thread-owned conversation kinds. |
| Settings | 3,493-line all-purpose surface | small shell plus focused panels | `SettingsTab.svelte` is below 400 lines and owns only section routing/composition. |
| Levers | raw list of every lever | operating profiles plus changed overrides | Owner sees profile summary by default; raw editor is developer-only/hidden. |
| Work graph | Looma/Knit/Dialog/Drawer branches | configured domain adapters | Generic runtime tests fail on leaked sample-product vocabulary. |
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

- Create `src/runtime/task-question-migration.ts`
  - Converts unanswered `task.openQuestions` into bounded-chat sessions.
  - Removes answered task questions after preserving answer evidence in task notes or bounded-chat accepted state.
- Create `src/runtime/__tests__/task-question-migration.test.ts`
  - Proves conversion, idempotency, and no duplicate bounded-chat sessions.
- Add migration `0.10.0/task-open-questions-to-bounded-chat` in `src/runtime/migrations.ts`.
- Modify `src/core/task.ts`
  - Removes `openQuestions` from the normal `Task` schema after migration is active.
- Modify or remove `src/tools/post-user-question.ts`
  - Replace task question writes with a bounded-chat start API/tool.
- Modify `src/runtime/thread.ts`
  - Add a first-class `bounded_chat` turn family instead of projecting bounded chat as `pressure_test_question`.
- Modify `src/runtime/inbox.ts`
  - Delete thread-owned conversation item kinds from `InboxItem`.
- Modify `src/web/surfaces/project/ThreadTab.svelte`
  - Split into smaller components while keeping Threads as the canonical owner-input surface.
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
- Modify `src/web/surfaces/project/SettingsTab.svelte`
  - Reduce to a shell under 400 lines.
  - Render only Settings sections, not memory/re-intake/design-intelligence internals.
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
  - Provides an event-based wrapper around high-risk task transitions.
  - First events: `mark_ready`, `start_worker`, `request_review`, `start_gate_check`, `complete`, `block`, `shelve`, `hold`, `resume`.
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

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to confirm current red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/reduction-guardrails.test.ts --reporter=dot
```

Expected: FAIL because `scripts/reduction-guardrails.mjs` does not exist.

- [ ] **Step 3: Add the guardrail script**

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
  /^src\/runtime\/__tests__\//,
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

- [ ] **Step 4: Add package script**

Add to `package.json` scripts:

```json
"lint:reductions": "node scripts/reduction-guardrails.mjs"
```

- [ ] **Step 5: Run and keep red until the reduction tasks land**

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

- [ ] **Step 1: Write migration tests**

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

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-hierarchy-migration.test.ts --reporter=dot
```

Expected: FAIL because `task-hierarchy-migration.ts` does not exist.

- [ ] **Step 3: Implement `migrateTaskHierarchyState`**

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

- [ ] **Step 4: Register the required migration**

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

- [ ] **Step 5: Add migration wrapper**

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

- [ ] **Step 6: Remove `parent` from the task status schema**

Modify `src/core/task.ts`:

- Remove the lifecycle diagram branch that says `parent`.
- Remove `'parent'` from `TaskStatusValue`.
- Add a comment above `hierarchy`:

```ts
// Work containment is represented by hierarchy links, never by task status.
// Required migration 0.10.0/task-hierarchy-links converts old status: parent
// records before normal runtime paths parse task queues.
```

- [ ] **Step 7: Stop writing parent status**

Modify `materializeRequiredSplitChildren` in `src/tools/task-queue.ts`:

- Delete `parent.status = 'parent'`.
- Ensure `parent.hierarchy.childIds` includes all planned child ids.
- Ensure each child has `hierarchy.parentId = parent.id`.
- Set `parent.taskReadiness.recommendation = 'split'` or keep the existing readiness if it already says split.
- Keep parent status unchanged if it was already `blocked`, `review`, `gate_check`, `done`, or `shelved`; otherwise use `ready`.

- [ ] **Step 8: Remove hierarchy compatibility inference**

Modify both hierarchy modules:

- Delete `legacyParentTaskId`.
- Delete `parentGoalId` fallback in `parentIdForTask`.
- Keep cycle handling.
- `isContainingWork` is true when explicit child links exist, `workKind` is `app_spec` or `feature_spec`, or a completion boundary requires children.

- [ ] **Step 9: Rename business envelope**

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

- [ ] **Step 10: Update tests**

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

## Task 3: Convert Task Questions to Bounded Chat and Remove `openQuestions`

**Files:**
- Create: `src/runtime/task-question-migration.ts`
- Create: `src/runtime/__tests__/task-question-migration.test.ts`
- Create: `scripts/migrations/0.10.0-task-questions.mjs`
- Modify: `src/runtime/migrations.ts`
- Modify: `src/core/task.ts`
- Modify: `src/tools/post-user-question.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/inbox.ts`
- Modify: `src/web/surfaces/TaskDrawer.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify tests that assert `openQuestions`

- [ ] **Step 1: Write conversion tests**

Create `src/runtime/__tests__/task-question-migration.test.ts`:

```ts
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { migrateTaskQuestionsToBoundedChat } from '../task-question-migration.js'

const now = '2026-06-01T12:00:00.000Z'

describe('task question migration', () => {
  it('moves unanswered task questions into bounded chat sessions and removes openQuestions', async () => {
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
    expect(result.createdSessions).toHaveLength(1)

    const queue = JSON.parse(await readFile(path.join(root, '.guildhall', 'TASKS.json'), 'utf8'))
    expect(queue.tasks[0].openQuestions).toBeUndefined()

    const session = JSON.parse(await readFile(path.join(root, '.guildhall', 'bounded-chat', `${result.createdSessions[0]}.json`), 'utf8'))
    expect(session.objective.kind).toBe('task_shaping')
    expect(session.source).toBe('migration:0.10.0/task-open-questions-to-bounded-chat:task-1:q1')
    expect(session.subObjectives[0].prompt).toBe('Which policy should Guildhall follow?')
    expect(session.subObjectives[0].choices).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-question-migration.test.ts --reporter=dot
```

Expected: FAIL because `task-question-migration.ts` does not exist.

- [ ] **Step 3: Implement migration**

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
  createdSessions: string[]
  affectedPaths: string[]
}
```

Rules:

- Read raw `.guildhall/TASKS.json`.
- For every unanswered question, create one bounded-chat session with:
  - `objective.kind = "task_shaping"`;
  - `objective.label = "Clarify <task title>"`;
  - `source = "migration:0.10.0/task-open-questions-to-bounded-chat:<taskId>:<questionId>"`;
  - `initialSubObjective.id = <questionId>`;
  - `initialSubObjective.prompt = question.prompt`;
  - `initialSubObjective.choices = question.choices` when present.
- For answered questions, append a task note that preserves the answer summary if no equivalent note already exists.
- Remove `openQuestions` from every task.
- Do not create duplicate sessions when applied twice.

- [ ] **Step 4: Register required migration**

Add built-in project migration:

```ts
{
  id: '0.10.0/task-open-questions-to-bounded-chat',
  title: 'Move task questions into bounded chat',
  introducedIn: '0.10.0',
  scope: 'project',
  safety: 'prompt',
  requirement: 'required',
  summary: 'Converts task.openQuestions into bounded-chat sessions and removes task-local question state.',
  async detect(projectRoot) {
    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot, projectId: path.basename(projectRoot), apply: false })
    return { needed: result.changedTasks.length > 0, affectedPaths: result.affectedPaths }
  },
  async apply(projectRoot) {
    const result = await migrateTaskQuestionsToBoundedChat({ projectRoot, projectId: path.basename(projectRoot), apply: true })
    return {
      summary: `Moved ${result.createdSessions.length} task question${result.createdSessions.length === 1 ? '' : 's'} into bounded chat.`,
      affectedPaths: result.affectedPaths,
    }
  },
}
```

- [ ] **Step 5: Replace question writer path**

Change `src/tools/post-user-question.ts` from a task mutator into one of these:

- a thin compatibility CLI/tool that calls `createBoundedChatSession`, or
- a removed tool replaced by `start-owner-input-thread`.

The resulting code must not assign `task.openQuestions`.

- [ ] **Step 6: Remove normal `openQuestions` schema**

Modify `src/core/task.ts`:

- Delete `openQuestions: z.array(AgentQuestion).optional()`.
- Keep `AgentQuestion` type only if bounded-chat migration or old transcript readers still need to parse old records outside normal task parsing.
- Update `src/web/lib/types.ts` after UI payloads stop including `openQuestions`.

- [ ] **Step 7: Remove UI and Inbox question paths**

- Delete `agent_question_pending` from `InboxItem`.
- Delete `visibleOpenQuestions` calls from Inbox construction.
- Delete task drawer question answer UI or replace it with a Threads link to the bounded chat.
- Replace `ThreadTab` pressure-test/question branches with a `bounded_chat` branch.

- [ ] **Step 8: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-question-migration.test.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/serve-intake.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/__tests__/TaskDrawer.svelte.test.ts --reporter=dot
```

Expected: PASS with no tests asserting task-local `openQuestions`.

Commit:

```bash
git add src/runtime/task-question-migration.ts src/runtime/__tests__/task-question-migration.test.ts scripts/migrations/0.10.0-task-questions.mjs src/runtime/migrations.ts src/core/task.ts src/tools/post-user-question.ts src/runtime/orchestrator.ts src/runtime/thread.ts src/runtime/inbox.ts src/web/lib/types.ts src/web/surfaces/TaskDrawer.svelte src/web/surfaces/project/ThreadTab.svelte
git commit -m "refactor: move task questions into bounded chat"
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

- [ ] **Step 1: Write runtime test for alert-only inbox**

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

- [ ] **Step 2: Delete thread-owned item kinds**

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

- [ ] **Step 3: Move conversation routing to Thread**

In `src/runtime/thread.ts`:

- Ensure project check-in, task shaping, approvals, escalations, and recovery decisions project as Thread turns.
- Add action hrefs that target `/thread?thread=<id>` instead of `/overview/inbox`.

- [ ] **Step 4: Reduce UI duplication**

- `DoThisNext.svelte` should choose between:
  - top alert item from Needs You, or
  - top waiting Thread from Thread summary.
- `FleetNeedsYou.svelte` should fetch one canonical fleet attention summary endpoint. It should not locally synthesize inbox groups and then replace them with project inbox results.
- `InboxTab.svelte` should become `NeedsYouTab.svelte` or a narrow alert/history component.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/inbox.test.ts src/runtime/__tests__/thread.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/surfaces/__tests__/FleetNeedsYou.svelte.test.ts src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts --reporter=dot
```

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
- Create: `src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts`
- Create: `src/levers/profiles.ts`
- Create: `src/levers/__tests__/profiles.test.ts`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
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
    expect(source).not.toMatch(/looma/i)
  })
})
```

Run:

```bash
pnpm vitest run src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts --reporter=dot
```

Expected: FAIL because the current file is 3,493 lines and owns all specialist types.

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

- [ ] **Step 4: Add lever operating profiles**

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

- [ ] **Step 5: Build `OperatingProfilePanel`**

Panel behavior:

- Shows current profile.
- Shows changed overrides as a short list.
- Shows raw lever editor only inside `DeveloperToolsPanel`, not the default Settings path.
- Provides one "Reset project overrides" action.

- [ ] **Step 6: Remove deprecated `merge_policy`**

Add migration `0.10.0/merge-policy-to-landing-strategy`:

- Detect project config containing `merge_policy`.
- Copy value to `landing_strategy` when `landing_strategy` is absent.
- Delete `merge_policy`.
- Mark migration required if any project still has `merge_policy`.

Then remove `merge_policy` from `src/levers/schema.ts` and `src/levers/storage.ts`.

- [ ] **Step 7: Move specialist panels**

Move logic out of Settings:

- Memory/suggested learnings -> project intelligence surface.
- Re-intake -> bounded-chat/review thread entry point plus specialist review panel.
- Design feedback/design-system/codebase map -> project intelligence or developer tools, depending on whether the owner is making a decision or debugging Guildhall.

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm vitest run src/web/surfaces/project/settings/__tests__/SettingsTab.structure.test.ts src/levers/__tests__/profiles.test.ts src/runtime/__tests__/serve-settings.test.ts src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts --reporter=dot
```

Expected: PASS, with `SettingsTab.svelte` under 400 lines.

Commit:

```bash
git add src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/settings src/levers/profiles.ts src/levers/__tests__/profiles.test.ts src/levers/schema.ts src/levers/storage.ts src/runtime/migrations.ts
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

- [ ] **Step 1: Write adapter tests**

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

- [ ] **Step 2: Run tests and confirm red**

Run:

```bash
pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts --reporter=dot
```

Expected: FAIL because adapter module does not exist.

- [ ] **Step 3: Add adapter contract**

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

- [ ] **Step 4: Replace hardcoded work-graph branches**

In `src/runtime/evidence-work-graph-intake.ts`:

- Remove `unit.targetArea === 'looma' ? '@looma/core'`.
- Remove `isKnit`.
- Remove `Knit destructive confirmation flow`.
- Remove `Knit mobile navigation drawer`.
- Remove `Compliance dashboard` rename.
- Remove `AlertDialog`, `Dialog`, `Drawer`, and `Button` normalization.
- Use adapter methods for all of the above.

- [ ] **Step 5: Generalize design feedback**

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

- [ ] **Step 6: Move sample config out of runtime**

Move `src/runtime/guildhall.config.ts` to an internal fixture or example.

Acceptable targets:

- `internal/fixtures/looma-knit/guildhall.config.ts`
- `examples/looma-knit/guildhall.config.ts`

Update any tests/imports that expected it under `src/runtime`.

- [ ] **Step 7: Replace examples**

Change examples in:

- `src/runtime/init.ts`
- `src/tools/agent-settings-tool.ts`
- comments and help text under generic runtime paths

Use neutral examples such as `frontend`, `backend`, `docs`, `release`, or `platform`.

- [ ] **Step 8: Run guardrails and tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/work-graph-domain-adapters.test.ts src/runtime/__tests__/generalization-smoke.test.ts src/runtime/__tests__/serve-settings.test.ts --reporter=dot
pnpm lint:reductions
```

Expected: PASS after sample-product vocabulary is gone from generic runtime paths.

Commit:

```bash
git add src/runtime/work-graph-domain-adapters.ts src/runtime/__tests__/work-graph-domain-adapters.test.ts src/runtime/evidence-work-graph-intake.ts src/runtime/design-feedback.ts src/runtime/design-system-discovery.ts src/runtime/serve.ts src/runtime/init.ts src/tools/agent-settings-tool.ts internal/fixtures/looma-knit scripts/reduction-guardrails.mjs
git commit -m "refactor: move product-specific work graph logic behind adapters"
```

## Task 7: Audit and Govern UI Components and Design Tokens

**Files:**
- Create: `internal/audits/2026-06-01-ui-component-token-governance.md`
- Create: `packages/ui/src/component-constitution.ts`
- Create: `scripts/design-token-audit.mjs`
- Create: `scripts/design-token-audit.test.ts`
- Modify: `packages/ui/src/styles.css`
- Modify: token source that generates `packages/ui/src/styles.css`
- Modify: `src/web/tokens.css`
- Modify: `package.json`

- [ ] **Step 1: Write the failing scanner test**

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

- [ ] **Step 2: Run the test and confirm red**

Run:

```bash
pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot
```

Expected: FAIL because `scripts/design-token-audit.mjs` does not exist.

- [ ] **Step 3: Add the design-token audit script**

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

- [ ] **Step 4: Add package script**

Add to `package.json` scripts:

```json
"lint:design": "node scripts/design-token-audit.mjs"
```

- [ ] **Step 5: Create the component constitution**

Create `packages/ui/src/component-constitution.ts`:

```ts
export type ComponentTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger' | 'accent'
export type ComponentDensity = 'compact' | 'default' | 'roomy'
export type TextRole =
  | 'page-title'
  | 'section-title'
  | 'panel-title'
  | 'body'
  | 'body-strong'
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
    allowedDensities: ['compact', 'default', 'roomy'],
    replacementFor: ['src/web/lib/Card.svelte'],
    maxVariantAxes: 3,
  },
  {
    name: 'NoticeBand',
    owns: 'inline status, warning, and recovery notices',
    useFor: ['blocking setup notices', 'migration warnings', 'empty/error/loading states that need action'],
    doNotUseFor: ['normal section intros', 'decorative callouts', 'success badges'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger'],
    allowedDensities: ['compact', 'default'],
    replacementFor: ['src/web/lib/NoticeBand.svelte'],
    maxVariantAxes: 3,
  },
  {
    name: 'StatusPill',
    owns: 'short status labels with semantic tone',
    useFor: ['state chips', 'count labels', 'readiness labels'],
    doNotUseFor: ['primary actions', 'long prose labels'],
    allowedTones: ['neutral', 'info', 'ok', 'warn', 'danger', 'accent'],
    allowedDensities: ['compact', 'default'],
    replacementFor: ['src/web/lib/Chip.svelte when the chip is state, not metadata'],
    maxVariantAxes: 3,
  },
]
```

- [ ] **Step 6: Add named typography and role tokens**

Update the package token source and generated `packages/ui/src/styles.css` so components can use roles instead of arbitrary scale picks:

```css
:root {
  --gh-type-size-caption: var(--gh-type-size-1);
  --gh-type-size-eyebrow: var(--gh-type-size-1);
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

- [ ] **Step 7: Write the governance audit**

Create `internal/audits/2026-06-01-ui-component-token-governance.md` with this structure:

```markdown
# UI Component and Token Governance Audit

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

- [ ] **Step 8: Convert the first surfaces**

Start with the surfaces that showed obvious drift:

- `src/web/surfaces/project/SettingsTab.svelte`
- `src/web/surfaces/project/ThreadTab.svelte`
- `src/web/surfaces/ProjectView.svelte`
- `src/web/surfaces/project/WorkspaceImportTab.svelte`
- `src/web/surfaces/FleetNeedsYou.svelte`
- `src/web/surfaces/DoThisNext.svelte`

For each touched surface:

- replace `--fs-*` with `--gh-type-size-*` role tokens;
- replace raw font weights with `--gh-type-weight-*`;
- replace negative letter spacing with `0`;
- replace raw local padding/gap/radius with `--gh-*` tokens;
- replace local status/card/notice classes with canonical primitives when a primitive exists.

- [ ] **Step 9: Run the audit and focused UI tests**

Run:

```bash
pnpm vitest run scripts/design-token-audit.test.ts --reporter=dot
pnpm lint:design
pnpm vitest run src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/__tests__/ProjectView.svelte.test.ts src/web/surfaces/__tests__/DoThisNext.svelte.test.ts src/web/surfaces/__tests__/FleetNeedsYou.svelte.test.ts --reporter=dot
```

Expected: PASS, with the design audit no longer flagging touched surfaces.

Commit:

```bash
git add internal/audits/2026-06-01-ui-component-token-governance.md packages/ui/src/component-constitution.ts packages/ui/src/styles.css src/web/tokens.css scripts/design-token-audit.mjs scripts/design-token-audit.test.ts package.json src/web/surfaces/project/SettingsTab.svelte src/web/surfaces/project/ThreadTab.svelte src/web/surfaces/ProjectView.svelte src/web/surfaces/project/WorkspaceImportTab.svelte src/web/surfaces/FleetNeedsYou.svelte src/web/surfaces/DoThisNext.svelte
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
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/intake.ts`
- Modify: `src/tools/task-queue.ts`
- Modify: `src/runtime/import-drafts.ts`
- Modify: `src/runtime/merge-dispatcher.ts`

- [ ] **Step 1: Write transition tests**

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
    })
    expect(result).toMatchObject({ kind: 'applied', from: 'ready', to: 'in_progress' })
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
    })
    expect(result).toMatchObject({ kind: 'rejected', reason: 'containing_work_not_runnable' })
  })
})
```

- [ ] **Step 2: Implement minimal transition boundary**

Create `src/runtime/task-transition.ts`:

```ts
export type TaskTransitionEvent =
  | 'mark_ready'
  | 'start_worker'
  | 'request_review'
  | 'start_gate_check'
  | 'complete'
  | 'block'
  | 'shelve'
  | 'hold'
  | 'resume'

export type TaskTransitionResult =
  | { kind: 'applied'; from: string; to: string; event: TaskTransitionEvent; actor: string; at: string }
  | { kind: 'rejected'; from: string; event: TaskTransitionEvent; actor: string; at: string; reason: string }
```

Rules:

- `start_worker` allowed only from `ready`.
- `start_worker` rejected when `task.hierarchy.childIds.length > 0` and readiness is not `ready`.
- `request_review` allowed from `in_progress`.
- `start_gate_check` allowed from `review`.
- `complete` allowed from `gate_check`, `review`, or `pending_pr` only when required evidence is present in context.
- `block` allowed from any non-terminal status.
- `shelve` allowed from `proposed`, `exploring`, `spec_review`, `ready`, or `in_progress`.
- `hold` records `hold.previousStatus`.
- `resume` returns to `hold.previousStatus`.

- [ ] **Step 3: Replace direct writes in hot paths**

Use `applyTaskTransition` in:

- orchestrator worker start/review/gate/done/block paths;
- intake promotion to ready/spec_review;
- required split materialization;
- import draft apply;
- merge dispatcher pending PR/done paths.

Do not attempt to migrate every status write in one commit. After each replaced hot path, add or update a focused test.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm vitest run src/runtime/__tests__/task-transition.test.ts src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/intake.test.ts src/runtime/__tests__/merge-dispatcher.test.ts src/tools/__tests__/task-queue.test.ts --reporter=dot
```

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

- [ ] **Step 1: Decide runtime necessity by import graph**

Run:

```bash
rg -n "app-spec-smoke|release-proof-matrix" src scripts internal
```

Expected:

- If only tests, benchmarks, or internal plans import them, move them out of `src/runtime`.
- If shipped CLI commands import them, keep a tiny runtime entrypoint and move fixture data to `internal/fixtures`.

- [ ] **Step 2: Move non-shipping proof fixtures**

Preferred locations:

- `internal/fixtures/app-spec-smoke/runtime.ts`
- `internal/fixtures/release-proof-matrix/runtime.ts`

Update tests to import from the new internal fixture path.

- [ ] **Step 3: Run tests**

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

## Rollout Order

1. Guardrails.
2. Work hierarchy conversion and `parent` status removal.
3. Task question conversion and `openQuestions` removal.
4. Inbox/Needs You alert-only collapse.
5. Settings reduction and lever profiles.
6. Product-specific runtime adapter extraction.
7. UI component and design-token governance.
8. UI primitive consolidation.
9. Task transition boundary hot paths.
10. Lab/proof fixture quarantine.
11. Installed-app verification and `artifact:flow-audit` update.

This order keeps hard persisted-state migrations ahead of UI deletion. It also makes Settings smaller before deeper design-system hook cleanup, so the worst owner-facing cognitive overhead improves before every internal cleanup is perfect.

## Branch and Commit Guidance

- Use a feature branch with the repository default prefix, for example `feature/cognitive-overhead-reduction`.
- If the branch has already been pushed/shared, refresh from `origin/main` with `git merge origin/main`, not rebase.
- Commit after each task.
- Do not mix user dirty changes into these commits. If existing dirty files overlap, inspect and preserve them before editing.

## Final Acceptance

The reduction is complete when:

- No normal runtime parser accepts `status: "parent"` as a task status.
- No normal runtime/UI hierarchy builder infers containment from `parentGoalId`.
- No normal task record carries `openQuestions`.
- Threads is the only owner-input conversation surface.
- Needs You is alert-owned.
- `SettingsTab.svelte` is a small composition shell under 400 lines.
- Raw levers are no longer the default owner-facing Settings experience.
- Generic runtime modules do not branch on Looma/Knit/AlertDialog/Dialog/Drawer.
- The UI has a component constitution, design-token audit, and no unmanaged font-size/font-weight/spacing/radius choices in touched surfaces.
- `--gh-*` is the canonical token family; old `--fs-*`, `--s-*`, and `--r-*` app scales are removed or only exist as temporary aliases during the migration task.
- Touched web surfaces use canonical UI primitives or temporary compatibility wrappers.
- The installed app proves the flow against the active test project with `stale:false`.
