import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

// Integration tests for the Settings-page read-only endpoints:
//   GET /api/config/levers — flatten lever settings into the shape the UI
//   renders. Seeds agent-settings.yaml on first read, so a freshly bootstrapped
//   workspace is a valid test input.

let tmpDir: string

async function readTasks(tmpPath: string): Promise<Array<Record<string, any>>> {
  const tasksPath = path.join(tmpPath, 'memory', 'TASKS.json')
  const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as
    | Array<Record<string, any>>
    | { tasks?: Array<Record<string, any>> }
  return Array.isArray(raw) ? raw : raw.tasks ?? []
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-'))
  bootstrapWorkspace(tmpDir, { name: 'Settings Test' })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('GET /api/config/levers', () => {
  it('returns seeded project + default-domain levers with string-rendered positions', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { levers: Array<Record<string, any>> }
    expect(Array.isArray(body.levers)).toBe(true)
    expect(body.levers.length).toBeGreaterThan(0)

    // Every entry has scope, name, stringified position, rationale, setBy.
    for (const l of body.levers) {
      expect(typeof l.name).toBe('string')
      expect(typeof l.position).toBe('string')
      expect(typeof l.rationale).toBe('string')
      expect(typeof l.setBy).toBe('string')
      expect(['project', 'domain:default']).toContain(l.scope)
    }

    // Spot-check: concurrent_task_dispatch is a parameterized lever — the
    // renderer should emit "serial" (not "[object Object]").
    const concurrent = body.levers.find(l => l.name === 'concurrent_task_dispatch')
    expect(concurrent?.position).toBe('serial')

    // Spot-check: a plain-string lever renders as-is.
    const envelope = body.levers.find(l => l.name === 'business_envelope_strictness')
    expect(envelope?.position).toBe('advisory')

    // Seed provenance should be intact.
    expect(concurrent?.setBy).toBe('system-default')
  })

  it('seeds memory/agent-settings.yaml on first call if missing', async () => {
    const settingsPath = path.join(tmpDir, 'memory', 'agent-settings.yaml')
    await expect(fs.access(settingsPath)).rejects.toThrow()
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(res.status).toBe(200)
    await fs.access(settingsPath) // now exists
  })
})

// Recovery path: if the on-disk agent-settings.yaml is missing a lever that
// was added to the Zod schema, `GET /api/config/levers` throws
// LeverSettingsCorruptError. POST /api/config/levers/reset wipes the file and
// re-seeds from defaults so the UI can recover without shelling in.
describe('POST /api/config/levers/reset', () => {
  it('rewrites the lever file with default positions so subsequent reads succeed', async () => {
    const settingsPath = path.join(tmpDir, 'memory', 'agent-settings.yaml')
    const { app } = buildServeApp({ projectPath: tmpDir })

    // Corrupt the file beyond self-heal (bad YAML). Missing-key corruption
    // is auto-repaired by loadLeverSettings, so we need a structurally
    // broken file here to force the 500 path.
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, 'version: "one"\nproject: {}\ndomains: {}\n', 'utf8')
    const bad = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(bad.status).toBe(500)

    // Reset → ok.
    const reset = await app.fetch(
      new Request('http://localhost/api/config/levers/reset', { method: 'POST' }),
    )
    expect(reset.status).toBe(200)
    expect(((await reset.json()) as { ok?: boolean }).ok).toBe(true)

    // Follow-up read succeeds and contains the seeded defaults.
    const good = await app.fetch(new Request('http://localhost/api/config/levers'))
    expect(good.status).toBe(200)
    const body = (await good.json()) as { levers: Array<{ name: string; setBy: string }> }
    expect(body.levers.length).toBeGreaterThan(0)
    expect(body.levers.every(l => l.setBy === 'system-default')).toBe(true)
  })
})

// When guildhall.yaml has no legacy bootstrap.commands block, POST
// /api/project/bootstrap/run should fall back to structural detection so
// bootstrap isn't silently a no-op.
describe('POST /api/project/bootstrap/run — auto-detect fallback', () => {
  it('runs the detector, writes the structural block, and returns a success payload', async () => {
    // Seed a minimal node project the detector can resolve (package.json with
    // a typecheck script + tsconfig.json). Install is skipped by spawner
    // injection is not available here — but without a lockfile the runner is
    // `none`, so the detector skips install and just probes gates.
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'detect-me', scripts: { typecheck: 'echo ok' } }, null, 2),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/bootstrap/run', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      success: boolean
      detected?: { packageManager?: string; verifiedAt?: string; gates?: Record<string, unknown> }
      logs?: string[]
    }
    expect(body.detected).toBeDefined()
    expect(typeof body.detected?.verifiedAt).toBe('string')
    expect(body.detected?.packageManager).toBe('none')
    expect(body.detected?.gates).toBeDefined()

    // File was written.
    const yamlText = await fs.readFile(path.join(tmpDir, 'guildhall.yaml'), 'utf8')
    // Keys may be double-quoted under the QUOTE_DOUBLE stringifier; match
    // either quoted or unquoted form.
    expect(yamlText).toMatch(/verifiedAt/)
    expect(yamlText).toMatch(/packageManager/)
  })
})

// Facts endpoint: aggregates identity, environment, workspace discoveries,
// coordinators, and design-system state with editHref pointers. Surfaces on
// the `/facts` route. Must never crash if a section is missing — undefined
// sections come back as null/empty.
describe('GET /api/project/facts', () => {
  it('returns all sections with editHrefs even on a bare-bootstrap workspace', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/facts'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.identity.name).toBeDefined()
    expect(body.identity.id).toBeDefined()
    expect(typeof body.identity.editHref).toBe('string')
    expect(body.environment.editHref).toBe('/settings')
    expect(body.workspace.reviewHref).toBe('/workspace-import')
    expect(body.coordinators.editHref).toBe('/settings/coordinators')
    expect(body.designSystem.editHref).toBe('/settings')
    // Environment defaults to unknown when bootstrap hasn't run yet.
    expect(body.environment.packageManager).toBe('unknown')
  })
})

// POST /api/project/workspace-import/dismiss — writes a dismissed marker so
// the Inbox stops nagging; Facts still shows "dismissed" so the user can
// re-review. Replaces the confusing "Scan workspace" prompt.
describe('POST /api/project/workspace-import/dismiss', () => {
  it('writes the dismissed marker and suppresses the inbox item', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    // Seed files that make buildInbox emit workspace_import_pending.
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# Test\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'package.json'), '{"name":"x"}', 'utf8')

    const before = await app.fetch(new Request('http://localhost/api/project/inbox'))
    const beforeBody = (await before.json()) as { items: Array<{ kind: string }> }
    expect(beforeBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(true)

    const dismiss = await app.fetch(
      new Request('http://localhost/api/project/workspace-import/dismiss', { method: 'POST' }),
    )
    expect(dismiss.status).toBe(200)
    expect(((await dismiss.json()) as { ok?: boolean }).ok).toBe(true)

    const after = await app.fetch(new Request('http://localhost/api/project/inbox'))
    const afterBody = (await after.json()) as { items: Array<{ kind: string }> }
    expect(afterBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(false)

    // Facts surface reflects the dismissed state.
    const facts = await app.fetch(new Request('http://localhost/api/project/facts'))
    const factsBody = (await facts.json()) as { workspace: { goals: { dismissed: boolean } | null } }
    expect(factsBody.workspace.goals?.dismissed).toBe(true)
  })
})

// GET /api/version exposes the runtime package version so the header can
// render "Guildhall v0.2.0-dev" next to the wordmark.
describe('GET /api/version', () => {
  it('returns a non-empty version string', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/version'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { version?: string }
    expect(typeof body.version).toBe('string')
    expect((body.version ?? '').length).toBeGreaterThan(0)
  })
})

// GET /api/project/workspace-import/draft must expose the deterministic
// detector output (`detected`) so the Review tab shows findings immediately
// — before the importer agent has populated the task spec. POST /approve
// then falls back to the detector when the spec is still empty, so the
// user is never blocked on an agent round-trip.
describe('Workspace Import review endpoints', () => {
  it('draft endpoint returns a detector block even before the importer agent runs', async () => {
    // Seed signals the detector can pick up.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Ship it\n\nGoals:\n- Ship the orchestrator\n- Wire the dashboard\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'ws-import', scripts: {} }),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/workspace-import/draft'),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      detected: {
        goals: unknown[]
        tasks: unknown[]
        stats: { inputSignals: number; drafted: number }
      } | null
      dismissed: boolean
    }
    expect(body.detected).not.toBeNull()
    expect(body.dismissed).toBe(false)
    // Stats are always present even if signals are zero.
    expect(typeof body.detected!.stats.inputSignals).toBe('number')
  })

  it('approve falls back to detector when the importer task has no spec', async () => {
    // Seed a README with a goal the detector will pick up.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# t-minus-t\n\n## Goals\n\n- Ship the extension\n- Wire the popup\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'ws-fallback' }),
      'utf8',
    )
    // Prime TASKS.json with the reserved importer task — empty spec.
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          lastUpdated: new Date().toISOString(),
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Workspace import',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'proposed',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: '', // no agent output yet
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const approve = await app.fetch(
      new Request('http://localhost/api/project/workspace-import/approve', {
        method: 'POST',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }
    expect(approve.status).toBe(200)
    expect(body.ok).toBe(true)
    // Detector should have produced at least one goal from the README.
    expect((body.goalsRecorded ?? 0) + (body.tasksAdded ?? 0)).toBeGreaterThan(0)
  })

  it('rerun reseeds the reserved import task even when the project already has tasks', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Knit\n\n## Goals\n\n- Ship Looma primitives cleanly\n',
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'feature-roadmap.md'),
      '## Next up\n\n- [ ] Turn planning docs into real intake tasks\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'workspace-goals.json'),
      JSON.stringify({ dismissed: true, dismissedAt: '2026-01-01T00:00:00Z' }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00Z',
          tasks: [
            {
              id: 'task-001',
              title: 'Existing user task',
              description: 'Existing imported work.',
              status: 'done',
              domain: 'core',
              priority: 'normal',
              projectPath: tmpDir,
              acceptanceCriteria: [],
              outOfScope: [],
              dependsOn: [],
              notes: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'human',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/workspace-import/rerun', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok?: boolean
      draft?: { tasks?: number; goals?: number }
    }
    expect(body.ok).toBe(true)
    expect((body.draft?.tasks ?? 0) + (body.draft?.goals ?? 0)).toBeGreaterThan(0)

    const tasks = await readTasks(tmpDir)
    const importTask = tasks.find((task) => task.id === 'task-workspace-import')
    expect(importTask?.status).toBe('exploring')

    const goalsState = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'memory', 'workspace-goals.json'), 'utf8'),
    ) as { dismissed?: boolean }
    expect(goalsState.dismissed).toBeUndefined()
  })
})

describe('POST /api/project/meta-intake/rerun', () => {
  it('resets the reserved task back to exploring and reseeds the transcript', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00Z',
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Map project areas and starter tasks',
              description: 'Scan the codebase, ask for missing context, then propose review lanes and starter tasks.',
              status: 'done',
              domain: '_meta',
              priority: 'critical',
              projectPath: tmpDir,
              spec: 'old draft',
              notes: [
                {
                  agentId: 'worker-agent',
                  role: 'worker-agent',
                  content: 'stale',
                  timestamp: '2026-01-01T00:30:00Z',
                },
              ],
              acceptanceCriteria: [],
              outOfScope: [],
              dependsOn: [],
              gateResults: [],
              reviewVerdicts: [],
              adjudications: [],
              escalations: [],
              agentIssues: [],
              revisionCount: 0,
              remediationAttempts: 0,
              origination: 'system',
              createdAt: '2026-01-01T00:00:00Z',
              updatedAt: '2026-01-01T00:00:00Z',
              completedAt: '2026-01-01T01:00:00Z',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'memory', 'exploring'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'exploring', 'task-meta-intake.md'),
      'stale transcript\n',
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request('http://localhost/api/project/meta-intake/rerun', { method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; taskId?: string }
    expect(body.ok).toBe(true)
    expect(body.taskId).toBe('task-meta-intake')

    const tasks = await readTasks(tmpDir)
    const metaTask = tasks.find((task) => task.id === 'task-meta-intake')
    expect(metaTask?.status).toBe('exploring')
    expect(metaTask?.spec).toBeUndefined()
    expect(metaTask?.completedAt).toBeUndefined()

    const transcript = await fs.readFile(
      path.join(tmpDir, 'memory', 'exploring', 'task-meta-intake.md'),
      'utf8',
    )
    expect(transcript).toMatch(/You are bootstrapping a new Guildhall workspace/i)
    expect(transcript).not.toMatch(/stale transcript/)
  })
})

// The inbox endpoint exposes `blockers` so the UI can disable Start/+ New
// Task while bootstrap is incomplete without re-deriving the rules.
describe('GET /api/project/inbox — blockers', () => {
  it('reports bootstrap: true when bootstrap is incomplete, false once verified', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    // bootstrapWorkspace leaves guildhall.yaml without a structural bootstrap
    // verifiedAt, so bootstrap_missing is expected.
    const before = await app.fetch(new Request('http://localhost/api/project/inbox'))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items: Array<{ kind: string }>
      blockers: { bootstrap: boolean; workspaceImport: boolean }
    }
    expect(beforeBody.blockers.bootstrap).toBe(true)

    // Overwrite guildhall.yaml with a complete structural bootstrap block.
    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n    typecheck: { command: "pnpm tsc --noEmit", available: true }\n    build: { command: "pnpm build", available: true }\n    test: { command: "pnpm test", available: true }\n',
      'utf8',
    )

    const after = await app.fetch(new Request('http://localhost/api/project/inbox'))
    const afterBody = (await after.json()) as {
      blockers: { bootstrap: boolean; workspaceImport: boolean }
    }
    expect(afterBody.blockers.bootstrap).toBe(false)
  })
})

describe('GET /api/project — bootstrap status', () => {
  it('includes the last bootstrap run status so the shell can explain async start failures', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'memory', 'bootstrap.json'),
      JSON.stringify({
        success: false,
        lastRunAt: '2026-04-25T00:00:00Z',
        durationMs: 10,
        commandHash: 'x',
        lockfileHash: null,
        steps: [
          {
            kind: 'gate',
            command: 'pnpm run build',
            result: 'fail',
            exitCode: 2,
            output: 'src/customEditorProvider.ts(6,8): error TS2307',
            durationMs: 10,
          },
        ],
      }),
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request('http://localhost/api/project'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      bootstrapStatus?: { success?: boolean; steps?: Array<{ command?: string; result?: string }> }
    }
    expect(body.bootstrapStatus?.success).toBe(false)
    expect(body.bootstrapStatus?.steps?.[0]?.command).toBe('pnpm run build')
    expect(body.bootstrapStatus?.steps?.[0]?.result).toBe('fail')
  })

  it('includes the same inbox snapshot as /api/project/inbox', async () => {
    const tasksPath = path.join(tmpDir, 'memory', 'TASKS.json')
    await fs.writeFile(
      tasksPath,
      JSON.stringify({
        tasks: [
          {
            id: 'task-1',
            title: 'Add unit coverage for use-collections behavior',
            status: 'spec_review',
            spec: 'Draft spec',
            createdAt: '2026-05-05T00:00:00Z',
            updatedAt: '2026-05-05T00:05:00Z',
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request('http://localhost/api/project'))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as {
      inbox?: {
        items?: Array<{ kind?: string; taskId?: string }>
        blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
      }
    }

    const inboxRes = await app.fetch(new Request('http://localhost/api/project/inbox'))
    expect(inboxRes.status).toBe(200)
    const inboxBody = (await inboxRes.json()) as {
      items?: Array<{ kind?: string; taskId?: string }>
      blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
    }

    expect(projectBody.inbox).toEqual(inboxBody)
    expect(projectBody.inbox?.items?.some(item => item.kind === 'spec_approval' && item.taskId === 'task-1')).toBe(true)
  })

  it('marks dynamic project payloads as non-cacheable', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request('http://localhost/api/project'))
    expect(projectRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(projectRes.headers.get('pragma')).toBe('no-cache')

    const inboxRes = await app.fetch(new Request('http://localhost/api/project/inbox'))
    expect(inboxRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(inboxRes.headers.get('pragma')).toBe('no-cache')
  })
})
