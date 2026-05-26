# Generic Migration System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace one-off memory/task migration commands with a reusable, versioned migration registry that can detect, plan, apply, and record project migrations across Guildhall releases.

**Architecture:** Add a runtime migration registry with stable migration ids, `introducedIn` version metadata, scope, safety, detect/plan/apply hooks, and a `.guildhall/migrations.json` project ledger. Existing migration functions become built-in migration definitions; the generic CLI reports/apply status while legacy commands remain compatibility aliases.

**Tech Stack:** TypeScript, Node filesystem APIs, existing Guildhall config/runtime migration helpers, Vitest, Hono service payloads.

---

## File Structure

- Create `src/runtime/migrations.ts`: owns migration types, built-in project migration registry, ledger read/write, status planning, and apply orchestration.
- Create `src/runtime/__tests__/migrations.test.ts`: covers project migration detection, ledger behavior, dry-run/status output, safe filtering, and applying built-in migrations.
- Modify `src/runtime/cli.ts`: adds `guildhall migrate status|plan|apply`, keeps `guildhall migrate task-state` and `guildhall memory migrate-0.8.0` working as compatibility paths, and prints migration status clearly.
- Modify `src/runtime/serve.ts`: includes migration summary in `/api/service` project summaries and `/api/health`.
- Modify `src/runtime/index.ts`: exports migration registry helpers for future runtime/DB migration callers.
- Modify `docs/cli/reference.md`, `docs/reference/memory-layout.md`, and `docs/releases/0.8.0.md`: document generic migrations and describe old memory-specific commands as compatibility aliases.

## Task 1: Add Migration Registry And Ledger

**Files:**
- Create: `src/runtime/migrations.ts`
- Test: `src/runtime/__tests__/migrations.test.ts`

- [x] **Step 1: Write failing registry/ledger tests**

Add `src/runtime/__tests__/migrations.test.ts` with tests that:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getProjectMigrationStatus,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from '../migrations.js'

let tmp: string
let projectRoot: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-migrations-'))
  projectRoot = path.join(tmp, 'project')
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), 'name: Migration Test\nid: migration-test\n', 'utf8')
})

describe('project migration ledger', () => {
  it('starts empty and round-trips applied migration records', async () => {
    expect(await readProjectMigrationLedger(projectRoot)).toEqual({ version: 1, records: [] })

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/example',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'automatic',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Example migration applied.',
      }],
    })

    expect(await readProjectMigrationLedger(projectRoot)).toMatchObject({
      version: 1,
      records: [{ id: '0.8.0/example', status: 'applied' }],
    })
  })
})

describe('getProjectMigrationStatus', () => {
  it('reports pending built-in project migrations and hides applied ledger entries', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.pending.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)

    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.8.0/project-state-layout',
        introducedIn: '0.8.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: '2026-05-26T00:00:00.000Z',
        appliedByVersion: '0.8.0',
        summary: 'Moved legacy memory into split project state.',
      }],
    })

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.pending.some(item => item.id === '0.8.0/project-state-layout')).toBe(false)
    expect(after.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/migrations.test.ts`

Expected: FAIL because `src/runtime/migrations.ts` does not exist.

- [x] **Step 3: Implement minimal registry and ledger**

Create `src/runtime/migrations.ts` with:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectStateDir } from '@guildhall/sessions'

export type MigrationScope = 'machine' | 'project' | 'workspace' | 'database'
export type MigrationSafety = 'automatic' | 'prompt' | 'manual' | 'required'
export type MigrationLedgerStatus = 'applied' | 'failed' | 'skipped'

export interface MigrationLedgerRecord {
  id: string
  introducedIn: string
  scope: MigrationScope
  safety: MigrationSafety
  status: MigrationLedgerStatus
  appliedAt: string
  appliedByVersion: string
  summary: string
  error?: string
  affectedPaths?: string[]
}

export interface ProjectMigrationLedger {
  version: 1
  records: MigrationLedgerRecord[]
}

export interface ProjectMigrationStatusItem {
  id: string
  title: string
  introducedIn: string
  scope: MigrationScope
  safety: MigrationSafety
  summary: string
  affectedPaths: string[]
  applied?: MigrationLedgerRecord
}

export interface ProjectMigrationStatus {
  projectRoot: string
  pending: ProjectMigrationStatusItem[]
  applied: ProjectMigrationStatusItem[]
  blocked: ProjectMigrationStatusItem[]
}

interface ProjectMigrationDefinition {
  id: string
  title: string
  introducedIn: string
  scope: 'project'
  safety: MigrationSafety
  summary: string
  detect: (projectRoot: string) => Promise<{ needed: boolean; affectedPaths?: string[] }>
  apply: (projectRoot: string) => Promise<{ summary: string; affectedPaths?: string[] }>
}

function ledgerPath(projectRoot: string): string {
  return path.join(getProjectStateDir(projectRoot), 'migrations.json')
}

export async function readProjectMigrationLedger(projectRoot: string): Promise<ProjectMigrationLedger> {
  try {
    const raw = await fs.readFile(ledgerPath(projectRoot), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProjectMigrationLedger>
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records as MigrationLedgerRecord[] : [],
    }
  } catch {
    return { version: 1, records: [] }
  }
}

export async function writeProjectMigrationLedger(projectRoot: string, ledger: ProjectMigrationLedger): Promise<void> {
  const file = ledgerPath(projectRoot)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify({ version: 1, records: ledger.records }, null, 2)}\n`, 'utf8')
}

const BUILT_IN_PROJECT_MIGRATIONS: ProjectMigrationDefinition[] = [
  {
    id: '0.8.0/project-state-layout',
    title: 'Move legacy project memory into split project state',
    introducedIn: '0.8.0',
    scope: 'project',
    safety: 'prompt',
    summary: 'Moves old ./memory project notes into .guildhall and local Guildhall history.',
    async detect(projectRoot) {
      const memoryDir = path.join(projectRoot, 'memory')
      try {
        const entries = await fs.readdir(memoryDir)
        return { needed: entries.length > 0, affectedPaths: entries.length > 0 ? ['memory/'] : [] }
      } catch {
        return { needed: false, affectedPaths: [] }
      }
    },
    async apply() {
      throw new Error('Migration apply is implemented in Task 2.')
    },
  },
]

export async function getProjectMigrationStatus(input: { projectRoot: string }): Promise<ProjectMigrationStatus> {
  const ledger = await readProjectMigrationLedger(input.projectRoot)
  const appliedById = new Map(ledger.records.filter(r => r.status === 'applied').map(r => [r.id, r]))
  const pending: ProjectMigrationStatusItem[] = []
  const applied: ProjectMigrationStatusItem[] = []
  const blocked: ProjectMigrationStatusItem[] = []

  for (const migration of BUILT_IN_PROJECT_MIGRATIONS) {
    const appliedRecord = appliedById.get(migration.id)
    if (appliedRecord) {
      applied.push({ ...migration, affectedPaths: appliedRecord.affectedPaths ?? [], applied: appliedRecord })
      continue
    }
    const detected = await migration.detect(input.projectRoot)
    if (!detected.needed) continue
    const item = { ...migration, affectedPaths: detected.affectedPaths ?? [] }
    if (migration.safety === 'required') blocked.push(item)
    else pending.push(item)
  }

  return { projectRoot: input.projectRoot, pending, applied, blocked }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/__tests__/migrations.test.ts`

Expected: PASS.

## Task 2: Wrap Existing One-Off Migrations As Built-Ins

**Files:**
- Modify: `src/runtime/migrations.ts`
- Test: `src/runtime/__tests__/migrations.test.ts`

- [x] **Step 1: Add failing apply/safety tests**

Extend `migrations.test.ts` with tests that:

```ts
import { applyProjectMigrations } from '../migrations.js'

it('applies automatic migrations but leaves prompt migrations pending by default', async () => {
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
    'name: Migration Test',
    'id: migration-test',
    'openaiApiKey: sk-local',
    '',
  ].join('\n'), 'utf8')
  await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

  const result = await applyProjectMigrations({ projectRoot, includePrompt: false })

  expect(result.applied.some(item => item.id === '0.8.0/provider-config-globalization')).toBe(true)
  expect(result.skipped.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
})

it('applies selected prompt migrations and records them in the ledger', async () => {
  await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

  const result = await applyProjectMigrations({
    projectRoot,
    includePrompt: true,
    only: ['0.8.0/project-state-layout'],
  })

  expect(result.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  const ledger = await readProjectMigrationLedger(projectRoot)
  expect(ledger.records.some(record => record.id === '0.8.0/project-state-layout')).toBe(true)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/migrations.test.ts`

Expected: FAIL because `applyProjectMigrations` and additional built-ins are missing.

- [x] **Step 3: Implement built-in migration application**

Update `src/runtime/migrations.ts` to:

- Import `readProjectConfig`, `updateProjectConfig`, and `migrateProjectProvidersToGlobal`.
- Import `migrateLegacyMemoryToLocalHistory`, `migrateTaskState`, and `installAgentBridgeInstructions`.
- Add built-ins:
  - `0.8.0/provider-config-globalization`, safety `automatic`, detects local provider keys.
  - `0.8.0/task-state-split`, safety `prompt`, detects legacy task state with `migrateTaskState({ apply: false })`.
  - `0.8.0/project-state-layout`, safety `prompt`, applies `migrateLegacyMemoryToLocalHistory({ dryRun: false, deleteSource: true, updateGitignore: true })`.
  - `0.8.0/codex-agent-bridge`, safety `prompt`, detects missing managed `AGENTS.md`, applies `installAgentBridgeInstructions({ target: 'codex' })`.
- Add:

```ts
export async function applyProjectMigrations(input: {
  projectRoot: string
  includePrompt?: boolean
  only?: string[]
  appVersion?: string
  now?: () => Date
}): Promise<{ applied: ProjectMigrationStatusItem[]; skipped: ProjectMigrationStatusItem[]; failed: Array<ProjectMigrationStatusItem & { error: string }> }>
```

Application rules:

- Skip already applied ledger entries.
- Apply `automatic` migrations by default.
- Apply `prompt` migrations only when `includePrompt` is true or their id is in `only`.
- Record successful applications in `.guildhall/migrations.json`.
- Record failed applications with `status: 'failed'` and continue.

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/__tests__/migrations.test.ts`

Expected: PASS.

## Task 3: Add Generic CLI Commands And Compatibility Aliases

**Files:**
- Modify: `src/runtime/cli.ts`
- Test: add CLI-level tests where existing CLI tests cover command help/output.

- [x] **Step 1: Write failing CLI tests**

Add tests to the existing CLI test file that assert help contains:

```ts
expect(help).toContain('guildhall migrate status')
expect(help).toContain('guildhall migrate plan')
expect(help).toContain('guildhall migrate apply')
```

If the CLI tests have a helper to execute commands, add an output test for:

```sh
guildhall migrate status <tmp-project>
```

Expected output contains `Pending migrations`.

- [x] **Step 2: Run CLI test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/cli.test.ts -t migrate`

Expected: FAIL because help/output does not include the generic migration commands.

- [x] **Step 3: Implement CLI commands**

Update `cmdMigrate()`:

- Keep `guildhall migrate task-state` as a legacy compatibility path.
- Add subcommands:
  - `status`
  - `plan`
  - `apply`
- Default `guildhall migrate` to `status`.
- Support `--all` by iterating `listWorkspaces()`.
- Support `--include-prompt` for prompt migrations.
- Support `--migration <id>` to apply one migration.
- Support `--safe` as the default automatic-only apply mode.

Output shape:

```text
[guildhall] Migration status for <project>
[guildhall] Pending migrations: <n>
[guildhall] Required blockers: <n>
[guildhall] Applied migrations: <n>
```

Apply output:

```text
[guildhall] Migration apply complete for <project>
[guildhall] Applied: <n>
[guildhall] Skipped: <n>
[guildhall] Failed: <n>
```

- [x] **Step 4: Run CLI tests**

Run: `pnpm vitest run src/runtime/__tests__/cli.test.ts -t migrate`

Expected: PASS.

## Task 4: Surface Migration Status In Service And Health

**Files:**
- Modify: `src/runtime/serve.ts`
- Test: `src/runtime/__tests__/serve-settings.test.ts`

- [x] **Step 1: Write failing service/health tests**

Extend `serve-settings.test.ts`:

```ts
it('includes project migration summary in service project cards', async () => {
  await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
  const { app } = buildServeApp({ projectPath: tmpDir })
  const res = await app.fetch(new Request('http://localhost/api/service'))
  const body = await res.json() as { projects: Array<{ id: string; migrationSummary?: { pending: number; blocked: number; applied: number } }> }
  expect(body.projects[0]?.migrationSummary?.pending).toBeGreaterThan(0)
})
```

Extend the `/api/health` test to expect:

```ts
expect(typeof body.migrations?.pending).toBe('number')
expect(typeof body.migrations?.blocked).toBe('number')
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/__tests__/serve-settings.test.ts -t "migration|health"`

Expected: FAIL because service/health do not expose migration summaries.

- [x] **Step 3: Implement service summaries**

In `serve.ts`:

- Import `getProjectMigrationStatus`.
- Add helper:

```ts
async function summarizeMigrations(projectPath: string) {
  const status = await getProjectMigrationStatus({ projectRoot: projectPath })
  return {
    pending: status.pending.length,
    blocked: status.blocked.length,
    applied: status.applied.length,
  }
}
```

- Include `migrationSummary` on `/api/service` project summaries.
- Include `migrations` on `/api/health` for the current default project.
- Catch errors and return zero/unknown summary rather than breaking service startup.

- [x] **Step 4: Run service tests**

Run: `pnpm vitest run src/runtime/__tests__/serve-settings.test.ts -t "migration|health"`

Expected: PASS.

## Task 5: Documentation And Verification

**Files:**
- Modify: `docs/cli/reference.md`
- Modify: `docs/reference/memory-layout.md`
- Modify: `docs/releases/0.8.0.md`
- Modify: `src/runtime/index.ts`

- [x] **Step 1: Export runtime migration helpers**

Add to `src/runtime/index.ts`:

```ts
export {
  getProjectMigrationStatus,
  applyProjectMigrations,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from './migrations.js'
export type {
  MigrationScope,
  MigrationSafety,
  MigrationLedgerRecord,
  ProjectMigrationStatus,
  ProjectMigrationStatusItem,
} from './migrations.js'
```

- [x] **Step 2: Update CLI/reference docs**

Document:

```text
guildhall migrate status [--all] [id|path]
guildhall migrate plan [--all] [id|path]
guildhall migrate apply [--all] [--safe|--include-prompt] [--migration <id>] [id|path]
```

Explain that `guildhall memory migrate-0.8.0` remains a compatibility alias for the project-state migration, not the migration system itself.

- [x] **Step 3: Run verification**

Run:

```sh
pnpm vitest run src/runtime/__tests__/migrations.test.ts
pnpm vitest run src/runtime/__tests__/serve-settings.test.ts -t "migration|health"
pnpm vitest run src/runtime/__tests__/cli.test.ts -t migrate
pnpm typecheck
pnpm build
```

Expected: all commands exit 0. `pnpm build` may still emit known third-party Svelte warnings from `svelte-sonner` and `runed`.

## Self-Review

- Spec coverage: The plan creates a generic registry, stable ids, version attachment, safety classes, project ledger, generic CLI, startup-visible status, and compatibility aliases for old one-off commands.
- Placeholder scan: No placeholders remain; every task has concrete files, test names, commands, and expected output.
- Type consistency: The migration types use `MigrationScope`, `MigrationSafety`, `MigrationLedgerRecord`, and `ProjectMigrationStatusItem` consistently across registry, CLI, service, and exports.
