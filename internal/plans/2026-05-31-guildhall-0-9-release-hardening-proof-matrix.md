# Guildhall 0.9 Release Hardening Proof Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove Guildhall 0.9 can take different real project shapes from intent to shaped task graph to implementation to truthful proof to done, without overfitting to Looma/Knit/web work or hiding lifecycle failures.

**Architecture:** Treat release readiness as a matrix of executable proof scenarios, not as a prose checklist. The hardening harness should run compact fixture projects through the same intake, task-graph, execution, gate, proof, and UI-state code paths that real projects use, while keeping each scenario small enough to debug quickly.

**Tech Stack:** TypeScript, Vitest, existing Guildhall runtime/orchestrator/test harnesses, small checked-in fixture projects under `internal/fixtures`, existing browser smoke tooling where available. No new runtime dependency.

---

## Ship Gate

0.9.0 is not ready until all of these are true on a clean working tree:

- [ ] `pnpm typecheck` passes.
- [ ] `pnpm build` passes with no Svelte warning regressions.
- [ ] `pnpm vitest run src/runtime/__tests__/orchestrator.test.ts --reporter=dot --test-timeout 10000` passes.
- [ ] `pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot --test-timeout 20000` passes.
- [ ] `pnpm smoke:release` or `pnpm release:dry` passes.
- [ ] `pnpm dev:install` succeeds and `/api/stale-server` reports `"stale":false`.
- [ ] `internal/audits/flow-audit.md` has no unchecked 0.9 release blocker that says "before calling 0.9.0 ready".
- [ ] `docs/releases/0.9.0.md` only claims runtime image/package facts that have current proof.

## Current Known Blockers

- The current branch has uncommitted orchestrator hard-gate work in `src/runtime/orchestrator.ts` and `src/runtime/__tests__/orchestrator.test.ts`. Decide whether to finish or revert it before running release gates.
- The last broad focused run failed 9 orchestrator tests. Those failures are release blockers because they touch review, hard gates, done transitions, and worktree merge/checkpoint behavior.
- `internal/audits/flow-audit.md` still contains an unchecked item: "Tighten the focused work-item path before calling 0.9.0 ready."
- The release note claims the 0.9 runtime image is published and release-tied; verify the image tag/digest/manifest before shipping or soften the copy.

## File Structure

- Create `src/runtime/release-proof-matrix.ts`
  - Defines project-shape fixtures, expected task graph shape, allowed proof modes, forbidden vocabulary, and scenario pass/fail assertions.
- Create `src/runtime/__tests__/release-proof-matrix.test.ts`
  - Runs the matrix at the pure/planner/runtime-contract level first so failures are fast and deterministic.
- Create `internal/fixtures/release-proof-matrix/*`
  - Small projects for each release scenario. Fixtures must be tiny, readable, and intentionally different from Looma/Knit.
- Modify `src/runtime/orchestrator.ts`
  - Only as needed to make lifecycle/gate behavior truthful and green.
- Modify `src/runtime/__tests__/orchestrator.test.ts`
  - Lock release-critical lifecycle regressions: hard gates in active worktree, unrelated failure adjudication, worktree merge/checkpoint, lean command-backed path.
- Modify `src/runtime/evidence-work-graph-intake.ts`
  - Ensure generic work graph behavior handles non-UI scenarios, with no hardcoded component-library assumptions.
- Modify `src/runtime/__tests__/evidence-work-graph-intake.test.ts`
  - Add release-matrix graph assertions for backend/API, CLI, docs-only, and migration/data work.
- Modify `src/runtime/pressure-test-intake.ts`
  - Ensure project-question planning asks only project-shape-appropriate questions and records confusion as failed question evidence.
- Modify `src/runtime/__tests__/pressure-test-intake.test.ts`
  - Add release-matrix intake assertions for question/no-question behavior.
- Modify `src/web/surfaces/project/*` only if a scenario proves the user cannot see the next action, pending question, blocked reason, or proof packet.
- Modify `internal/audits/flow-audit.md`
  - Track this plan as the release-hardening checklist and record proof evidence.
- Modify `docs/releases/0.9.0.md`
  - Align public claims with verified release facts after the matrix passes.

## Release Proof Matrix

Each scenario must prove four things:

1. **Intent:** Guildhall understands the request without dragging in unrelated project assumptions.
2. **Graph:** Guildhall creates the right amount of work: no premature split for one bounded edit, but real dependency edges for multi-part work.
3. **Execution:** The task reaches `done` only through appropriate proof for that project type.
4. **User Path:** The UI/API has one clear next action and does not show stale/older blockers as the current job.

| Scenario | Fixture | User request | Expected graph | Proof mode | Forbidden failure |
| --- | --- | --- | --- | --- | --- |
| Component + consumer integration | `internal/fixtures/release-proof-matrix/component-consumer` | "Build a reusable AlertDialog-style primitive and use it in the demo app" | library implementation task before consumer integration task | component test/docs plus consumer browser or render proof | component built with no consumer integration |
| Frontend app feature | `internal/fixtures/release-proof-matrix/frontend-app` | "Add a saved-filter drawer to the task board" | one implementation task unless existing primitives require one dependency | unit/component test plus browser proof | generic landing page, fake done without screenshot/render proof |
| Backend/API feature | `internal/fixtures/release-proof-matrix/backend-api` | "Add a comment endpoint and prove membership checks" | API implementation plus integration test, no UI child unless requested | API integration test | browser-only proof, frontend component vocabulary |
| CLI/tooling behavior | `internal/fixtures/release-proof-matrix/cli-tool` | "Add --json output to the inspect command" | one bounded CLI task | command output fixture and regression test | web app/runtime/browser assumptions |
| Docs-only edit | `internal/fixtures/release-proof-matrix/docs-only` | "Clarify the install warning in the quick start" | one docs task, no implementation split | docs build/lint or deterministic content diff | worker pressure to edit code |
| Data/schema migration | `internal/fixtures/release-proof-matrix/data-migration` | "Add archived_at migration and rollback proof" | migration task plus validation proof | migration up/down validation | no rollback/validation proof |
| Bugfix | `internal/fixtures/release-proof-matrix/bugfix` | "Fix duplicate rows in the summary output" | reproduce-then-fix task | failing regression first, then green test | no reproduction evidence |
| Single-edit task | `internal/fixtures/release-proof-matrix/single-edit` | "Rename Host-run to Runs on host in settings footer" | exactly one task | focused diff/test | decomposition into component/backlog/project plan |

## Task 1: Stabilize The Orchestrator Release Gate

**Files:**
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/__tests__/orchestrator.test.ts`

- [ ] **Step 1: Capture the current failing command**

Run:

```bash
pnpm vitest run src/runtime/__tests__/orchestrator.test.ts --reporter=dot --test-timeout 10000
```

Expected before fixes: failures in gate/review lifecycle, especially transitions that remain `in_progress` or `review` when the test expects `done` / `gate_check`.

- [ ] **Step 2: Add or keep the active-worktree hard-gate regression**

Ensure `src/runtime/__tests__/orchestrator.test.ts` contains a regression equivalent to:

```ts
it('runs acceptance command gates in the active task worktree when one exists', async () => {
  const projectPath = path.join(tmpDir, 'acceptance-command-project-copy')
  const worktreePath = path.join(tmpDir, 'acceptance-command-task-worktree')
  await fs.mkdir(projectPath, { recursive: true })
  await fs.mkdir(path.join(worktreePath, '.guildhall'), { recursive: true })
  await fs.writeFile(path.join(projectPath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
  execFileSync('git', ['init'], { cwd: worktreePath, stdio: 'ignore' })
  await fs.writeFile(path.join(worktreePath, 'RELEASE_NOTES.md'), '# Release Notes\n\n- Placeholder note.\n', 'utf8')
  execFileSync('git', ['add', 'RELEASE_NOTES.md'], { cwd: worktreePath, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'seed'], {
    cwd: worktreePath,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
  await fs.appendFile(path.join(worktreePath, 'RELEASE_NOTES.md'), '- Added benchmark artifact evidence.\n')
  await fs.writeFile(path.join(worktreePath, '.guildhall', 'TASKS.json'), '{"version":1}\n', 'utf8')

  await writeQueue([
    mkTask({
      id: 'artifact-patch',
      status: 'gate_check',
      assignedTo: 'gate-checker-agent',
      projectPath,
      worktreePath,
      acceptanceCriteria: [
        {
          id: 'AC-1',
          description: 'RELEASE_NOTES.md contains benchmark artifact evidence.',
          verifiedBy: 'automated',
          command: "grep -q 'benchmark artifact evidence' RELEASE_NOTES.md",
          met: false,
        },
        {
          id: 'AC-2',
          description: 'Only RELEASE_NOTES.md changed.',
          verifiedBy: 'automated',
          command: "git diff --name-only | grep -q '^RELEASE_NOTES.md$'",
          met: false,
        },
      ],
    }),
  ])

  const orch = new Orchestrator({
    config: baseConfig(),
    agents: agentSet({ gateChecker: stubAgent('gate-checker-agent') }),
  })

  const out = await orch.tick()

  expect(out.kind).toBe('processed')
  if (out.kind === 'processed') {
    expect(out.agent).toBe('acceptance-command-gates')
    expect(out.afterStatus).toBe('done')
  }
  const task = (await readQueue()).tasks.find(candidate => candidate.id === 'artifact-patch')!
  expect(task.acceptanceCriteria.every((criterion) => criterion.met)).toBe(true)
  expect(await fs.readFile(path.join(projectPath, 'RELEASE_NOTES.md'), 'utf8')).not.toContain('benchmark artifact evidence')
})
```

- [ ] **Step 3: Implement the minimal active-worktree command root**

In `runAcceptanceCommandGates`, choose `task.worktreePath` when present:

```ts
const taskProjectPath =
  typeof task.worktreePath === 'string' && task.worktreePath.trim().length > 0
    ? task.worktreePath.trim()
    : resolveEffectiveTaskProjectPath(task, this.opts.config.projectPath)
```

- [ ] **Step 4: Fix the 9 lifecycle failures without weakening assertions**

Do not change tests to accept `review` where the expected status is `done`. Root-cause each failure:

- hard-gate injected paths must still call the gate checker when no automated command gates exist;
- command-backed gates must not bypass scoped-failure adjudication;
- worktree merge/checkpoint tests must reach the merge path after done;
- reviewer deterministic fallback must not be mistaken for command-gate bounce.

Run after each fix:

```bash
pnpm vitest run src/runtime/__tests__/orchestrator.test.ts --reporter=dot --test-timeout 10000
```

Expected final result: all orchestrator tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/orchestrator.ts src/runtime/__tests__/orchestrator.test.ts
git commit -m "fix: stabilize release gate lifecycle"
```

## Task 2: Add The Release Matrix Contract

**Files:**
- Create: `src/runtime/release-proof-matrix.ts`
- Create: `src/runtime/__tests__/release-proof-matrix.test.ts`

- [ ] **Step 1: Write the failing matrix test**

Create `src/runtime/__tests__/release-proof-matrix.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RELEASE_PROOF_MATRIX, validateReleaseProofScenario } from '../release-proof-matrix.js'

describe('release proof matrix', () => {
  it('covers the required 0.9 hardening project shapes', () => {
    expect(RELEASE_PROOF_MATRIX.map(scenario => scenario.id)).toEqual([
      'component-consumer',
      'frontend-app',
      'backend-api',
      'cli-tool',
      'docs-only',
      'data-migration',
      'bugfix',
      'single-edit',
    ])
  })

  it('forbids project-specific vocabulary from generic scenarios', () => {
    for (const scenario of RELEASE_PROOF_MATRIX) {
      const result = validateReleaseProofScenario(scenario)
      expect(result.errors).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot
```

Expected: FAIL because `src/runtime/release-proof-matrix.ts` does not exist.

- [ ] **Step 3: Implement the matrix**

Create `src/runtime/release-proof-matrix.ts`:

```ts
export type ReleaseProofScenarioId =
  | 'component-consumer'
  | 'frontend-app'
  | 'backend-api'
  | 'cli-tool'
  | 'docs-only'
  | 'data-migration'
  | 'bugfix'
  | 'single-edit'

export interface ReleaseProofScenario {
  id: ReleaseProofScenarioId
  fixturePath: string
  request: string
  expectedGraph: string
  proofMode: string
  forbiddenVocabulary: string[]
}

export interface ReleaseProofValidation {
  errors: string[]
}

const WEB_OVERFIT = ['Looma', 'Knit', 'AlertDialog', 'Storybook-only', 'browser-only']

export const RELEASE_PROOF_MATRIX: ReleaseProofScenario[] = [
  {
    id: 'component-consumer',
    fixturePath: 'internal/fixtures/release-proof-matrix/component-consumer',
    request: 'Build a reusable AlertDialog-style primitive and use it in the demo app.',
    expectedGraph: 'library implementation before consumer integration',
    proofMode: 'component test/docs plus consumer render proof',
    forbiddenVocabulary: [],
  },
  {
    id: 'frontend-app',
    fixturePath: 'internal/fixtures/release-proof-matrix/frontend-app',
    request: 'Add a saved-filter drawer to the task board.',
    expectedGraph: 'one implementation task unless existing primitives require one dependency',
    proofMode: 'unit/component test plus browser proof',
    forbiddenVocabulary: ['Looma', 'Knit', 'AlertDialog'],
  },
  {
    id: 'backend-api',
    fixturePath: 'internal/fixtures/release-proof-matrix/backend-api',
    request: 'Add a comment endpoint and prove membership checks.',
    expectedGraph: 'API implementation plus integration test',
    proofMode: 'API integration test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'cli-tool',
    fixturePath: 'internal/fixtures/release-proof-matrix/cli-tool',
    request: 'Add --json output to the inspect command.',
    expectedGraph: 'one bounded CLI task',
    proofMode: 'command output fixture and regression test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'docs-only',
    fixturePath: 'internal/fixtures/release-proof-matrix/docs-only',
    request: 'Clarify the install warning in the quick start.',
    expectedGraph: 'one docs task',
    proofMode: 'docs build or deterministic content diff',
    forbiddenVocabulary: [...WEB_OVERFIT, 'implementation child'],
  },
  {
    id: 'data-migration',
    fixturePath: 'internal/fixtures/release-proof-matrix/data-migration',
    request: 'Add archived_at migration and rollback proof.',
    expectedGraph: 'migration task plus validation proof',
    proofMode: 'migration up/down validation',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'bugfix',
    fixturePath: 'internal/fixtures/release-proof-matrix/bugfix',
    request: 'Fix duplicate rows in the summary output.',
    expectedGraph: 'reproduce-then-fix task',
    proofMode: 'failing regression first then green test',
    forbiddenVocabulary: WEB_OVERFIT,
  },
  {
    id: 'single-edit',
    fixturePath: 'internal/fixtures/release-proof-matrix/single-edit',
    request: 'Rename Host-run to Runs on host in settings footer.',
    expectedGraph: 'exactly one task',
    proofMode: 'focused diff/test',
    forbiddenVocabulary: ['component backlog', 'integration task', 'Looma', 'Knit'],
  },
]

export function validateReleaseProofScenario(scenario: ReleaseProofScenario): ReleaseProofValidation {
  const haystack = [
    scenario.request,
    scenario.expectedGraph,
    scenario.proofMode,
  ].join('\n')
  const errors = scenario.forbiddenVocabulary
    .filter(term => haystack.toLowerCase().includes(term.toLowerCase()))
    .map(term => `${scenario.id} leaks forbidden vocabulary: ${term}`)
  return { errors }
}
```

- [ ] **Step 4: Run the test**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/release-proof-matrix.ts src/runtime/__tests__/release-proof-matrix.test.ts
git commit -m "test: add release proof matrix contract"
```

## Task 3: Add Tiny Fixture Projects

**Files:**
- Create fixture files under `internal/fixtures/release-proof-matrix/*`
- Modify: `src/runtime/__tests__/release-proof-matrix.test.ts`

- [ ] **Step 1: Add fixture-existence assertions**

Extend `release-proof-matrix.test.ts`:

```ts
import { existsSync } from 'node:fs'
import path from 'node:path'

it('points every scenario at a checked-in fixture', () => {
  for (const scenario of RELEASE_PROOF_MATRIX) {
    expect(existsSync(path.resolve(scenario.fixturePath)), scenario.fixturePath).toBe(true)
  }
})
```

- [ ] **Step 2: Run the failing test**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot
```

Expected: FAIL because fixture directories are absent.

- [ ] **Step 3: Create fixture directories**

Create the following minimal files:

```text
internal/fixtures/release-proof-matrix/component-consumer/packages/ui/package.json
internal/fixtures/release-proof-matrix/component-consumer/apps/demo/package.json
internal/fixtures/release-proof-matrix/frontend-app/package.json
internal/fixtures/release-proof-matrix/backend-api/package.json
internal/fixtures/release-proof-matrix/cli-tool/package.json
internal/fixtures/release-proof-matrix/docs-only/docs/quick-start.md
internal/fixtures/release-proof-matrix/data-migration/migrations/001_initial.sql
internal/fixtures/release-proof-matrix/bugfix/package.json
internal/fixtures/release-proof-matrix/single-edit/src/settings-footer.ts
```

Keep fixtures tiny. Each `package.json` can use scripts that echo deterministic proof, for example:

```json
{
  "name": "guildhall-release-fixture-cli-tool",
  "private": true,
  "scripts": {
    "test": "node test.js"
  }
}
```

- [ ] **Step 4: Run the fixture test**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add internal/fixtures/release-proof-matrix src/runtime/__tests__/release-proof-matrix.test.ts
git commit -m "test: add release proof matrix fixtures"
```

## Task 4: Prove Work Graph Shape Across The Matrix

**Files:**
- Modify: `src/runtime/evidence-work-graph-intake.ts`
- Modify: `src/runtime/__tests__/evidence-work-graph-intake.test.ts`
- Modify: `src/runtime/release-proof-matrix.ts`

- [ ] **Step 1: Add graph-shape tests**

Add cases asserting:

```ts
expect(componentConsumer.tasks.map(task => task.title)).toEqual([
  'Build reusable dialog primitive',
  'Integrate dialog primitive in demo app',
])
expect(componentConsumer.tasks[1]!.dependsOn).toEqual([componentConsumer.tasks[0]!.id])

expect(singleEdit.tasks).toHaveLength(1)
expect(singleEdit.tasks[0]!.title).toMatch(/settings footer copy/i)

expect(docsOnly.tasks).toHaveLength(1)
expect(JSON.stringify(docsOnly.tasks)).not.toMatch(/implementation child|browser proof|component/i)

expect(backendApi.tasks.some(task => /integration test/i.test(task.description))).toBe(true)
expect(JSON.stringify(backendApi.tasks)).not.toMatch(/Storybook|AlertDialog|Looma|Knit/i)
```

- [ ] **Step 2: Run graph tests and confirm failures**

```bash
pnpm vitest run src/runtime/__tests__/evidence-work-graph-intake.test.ts --reporter=dot --test-timeout 10000
```

Expected: FAIL until non-UI matrix scenarios are represented.

- [ ] **Step 3: Implement generic graph rules**

Rules:

- Split only when source evidence names separate deliverables with an ordering relationship.
- Preserve dependencies when evidence says "foundation", "shared primitive", "migration before API", or "library before consumer".
- Keep one bounded edit as one task when the request names one file/copy/API option and no dependent consumer.
- Require consumer integration when the request names both reusable work and a consuming app/surface.
- Do not require UI/browser proof unless the scenario is user-visible UI.

- [ ] **Step 4: Run graph tests**

```bash
pnpm vitest run src/runtime/__tests__/evidence-work-graph-intake.test.ts --reporter=dot --test-timeout 10000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/evidence-work-graph-intake.ts src/runtime/__tests__/evidence-work-graph-intake.test.ts src/runtime/release-proof-matrix.ts
git commit -m "test: prove release work graph shapes"
```

## Task 5: Prove Intake And Question Behavior Across The Matrix

**Files:**
- Modify: `src/runtime/pressure-test-intake.ts`
- Modify: `src/runtime/__tests__/pressure-test-intake.test.ts`
- Modify: `src/runtime/project-question-planner.ts`
- Modify: `src/runtime/__tests__/project-question-planner.test.ts`

- [ ] **Step 1: Add intake tests**

Add assertions:

```ts
expect(cliScenario.questions).not.toEqual(expect.arrayContaining([
  expect.objectContaining({ prompt: expect.stringMatching(/browser|component|Storybook/i) }),
]))

expect(docsScenario.generatedTasks).toHaveLength(1)
expect(docsScenario.generatedTasks[0]!.domain).toBe('docs')

expect(confusedAnswer.classification).toBe('failed_question')
expect(confusedAnswer.memoryFacts).toEqual([])

expect(componentConsumer.questions.map(question => question.prompt).join('\n')).toMatch(/consumer|integration|demo app/i)
```

- [ ] **Step 2: Run intake tests**

```bash
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts src/runtime/__tests__/project-question-planner.test.ts --reporter=dot --test-timeout 10000
```

Expected: FAIL for any overfit or missing question behavior.

- [ ] **Step 3: Implement minimal intake fixes**

Rules:

- Use project evidence and request shape to pick question domains.
- Ask no question when proof/acceptance is already unambiguous.
- For component-consumer scenarios, ask only about API/consumer integration if not obvious.
- For CLI/API/docs scenarios, forbid UI/component/browser questions unless the request names UI.
- Treat confusion, protest, or "why are you asking this" as a failed question, not memory.

- [ ] **Step 4: Run intake tests**

```bash
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts src/runtime/__tests__/project-question-planner.test.ts --reporter=dot --test-timeout 10000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/pressure-test-intake.ts src/runtime/__tests__/pressure-test-intake.test.ts src/runtime/project-question-planner.ts src/runtime/__tests__/project-question-planner.test.ts
git commit -m "test: harden release intake questions"
```

## Task 6: Prove Execution And Proof Packets

**Files:**
- Create or modify: `src/runtime/__tests__/release-proof-matrix.test.ts`
- Modify: orchestrator/runtime files only as failures demand.

- [ ] **Step 1: Add execution-contract assertions**

For each scenario, assert a proof mode:

```ts
expect(proofFor('cli-tool')).toMatchObject({
  requiredEvidence: ['command_output', 'regression_test'],
  forbiddenEvidence: ['browser_screenshot'],
})

expect(proofFor('frontend-app')).toMatchObject({
  requiredEvidence: ['test', 'rendered_ui'],
})

expect(proofFor('bugfix')).toMatchObject({
  requiredEvidence: ['failing_reproduction', 'green_regression'],
})
```

- [ ] **Step 2: Run release matrix tests**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot --test-timeout 20000
```

Expected: FAIL until proof contract helpers exist.

- [ ] **Step 3: Implement proof-contract helper**

Add a pure helper to `release-proof-matrix.ts`:

```ts
export function proofFor(id: ReleaseProofScenarioId): { requiredEvidence: string[]; forbiddenEvidence: string[] } {
  switch (id) {
    case 'frontend-app':
      return { requiredEvidence: ['test', 'rendered_ui'], forbiddenEvidence: [] }
    case 'component-consumer':
      return { requiredEvidence: ['component_contract', 'consumer_integration'], forbiddenEvidence: [] }
    case 'backend-api':
      return { requiredEvidence: ['api_integration_test'], forbiddenEvidence: ['browser_screenshot'] }
    case 'cli-tool':
      return { requiredEvidence: ['command_output', 'regression_test'], forbiddenEvidence: ['browser_screenshot'] }
    case 'docs-only':
      return { requiredEvidence: ['content_diff'], forbiddenEvidence: ['source_code_mutation'] }
    case 'data-migration':
      return { requiredEvidence: ['migration_up', 'rollback_or_validation'], forbiddenEvidence: ['browser_screenshot'] }
    case 'bugfix':
      return { requiredEvidence: ['failing_reproduction', 'green_regression'], forbiddenEvidence: [] }
    case 'single-edit':
      return { requiredEvidence: ['focused_diff'], forbiddenEvidence: ['task_split'] }
  }
}
```

- [ ] **Step 4: Run release matrix tests**

```bash
pnpm vitest run src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot --test-timeout 20000
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/release-proof-matrix.ts src/runtime/__tests__/release-proof-matrix.test.ts
git commit -m "test: codify release proof contracts"
```

## Task 7: Browser/User Path Smoke For Representative Scenarios

**Files:**
- Modify or create a browser smoke test if an existing harness is appropriate.
- Modify UI only if a scenario cannot show one clear next action.

- [ ] **Step 1: Pick four browser-smoke representatives**

Use:

- `component-consumer`
- `frontend-app`
- `cli-tool`
- `docs-only`

- [ ] **Step 2: Add UI assertions**

For each representative:

```ts
expect(screenText).toContain('Start')
expect(screenText).not.toMatch(/Waiting on answer.*no question/i)
expect(screenText).not.toMatch(/Already queued.*no active run/i)
expect(screenText).not.toMatch(/missing repo evidence/i)
```

- [ ] **Step 3: Run browser smoke**

Run the existing browser/playwright command used by the nearest project-flow test, for example:

```bash
pnpm exec playwright test tests/rendered-ui/project-flow.spec.ts
```

Expected: PASS or a concrete UI blocker recorded in `internal/audits/flow-audit.md`.

- [ ] **Step 4: Commit**

```bash
git add tests src/web internal/audits/flow-audit.md
git commit -m "test: add release user-path smoke coverage"
```

## Task 8: Final Release Readiness Pass

**Files:**
- Modify: `docs/releases/0.9.0.md`
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Run final commands**

```bash
pnpm typecheck
pnpm build
pnpm vitest run src/runtime/__tests__/orchestrator.test.ts src/runtime/__tests__/release-proof-matrix.test.ts --reporter=dot --test-timeout 20000
pnpm smoke:release
pnpm dev:install
curl -fsS http://localhost:7777/api/stale-server
```

Expected:

- typecheck exits 0;
- build exits 0 without the old Svelte warnings;
- orchestrator and release matrix tests exit 0;
- release smoke exits 0;
- dev install exits 0;
- stale server JSON contains `"stale":false`.

- [ ] **Step 2: Verify release note claims**

If the runtime image/digest is not currently published/finalized, change:

```md
the 0.9 runtime image is published through GHCR
```

to:

```md
the 0.9 runtime image is part of the release set and is verified by the release manifest
```

Only keep the stronger wording if the GHCR tag and digest are verified in the same release pass.

- [ ] **Step 3: Close release-blocker checklist items**

Update `internal/audits/flow-audit.md`:

- check the focused work-item release blocker only if browser/API proof confirms it;
- check the release proof matrix item only if the commands above pass;
- leave any caveat unchecked if it affects trust in done/proof/next action.

- [ ] **Step 4: Commit final release-readiness evidence**

```bash
git add docs/releases/0.9.0.md internal/audits/flow-audit.md
git commit -m "docs: record 0.9 release readiness evidence"
```

## Execution Order

1. Task 1: stabilize orchestrator lifecycle. This is the hard gate; do not proceed while it is red.
2. Task 2 and Task 3: add the release proof matrix and fixtures.
3. Task 4 and Task 5: make graphing and intake respect the matrix.
4. Task 6: codify proof contracts.
5. Task 7: browser-smoke the user path.
6. Task 8: final release pass and release-note alignment.

## Self-Review

- Spec coverage: covers execution lifecycle, project-type proof matrix, generalization guardrails, end-to-end scenarios, trust UI walkthroughs, release smoke, and release-note truthfulness.
- Placeholder scan: no placeholder markers; every task has concrete files, commands, and expected results.
- Type consistency: `ReleaseProofScenario`, `ReleaseProofScenarioId`, `validateReleaseProofScenario`, and `proofFor` are introduced in Task 2/6 before use.
