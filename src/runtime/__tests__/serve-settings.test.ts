import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { bootstrapWorkspace } from '@guildhall/config'
import { readProjectConfig } from '@guildhall/config'
import { defaultAgentSettingsPath, loadLeverSettings, makeDefaultSettings } from '@guildhall/levers'
import { proposeProjectSkill } from '@guildhall/skills'
import { buildServeApp } from '../serve.js'
import { persistLearningCandidates } from '../learning.js'
import type { LearningCandidate } from '../policy.js'

const execFileP = promisify(execFile)

// Integration tests for the Settings-page read-only endpoints:
//   GET /api/config/levers — flatten lever settings into the shape the UI
//   renders. Seeds agent-settings.yaml on first read, so a freshly bootstrapped
//   workspace is a valid test input.

let tmpDir: string
let previousHome: string | undefined
const PROJECT_ID = 'settings-test'

function scoped(pathname: string): string {
  const separator = pathname.includes('?') ? '&' : '?'
  return `http://localhost${pathname}${separator}projectId=${encodeURIComponent(PROJECT_ID)}`
}

async function readTasks(tmpPath: string): Promise<Array<Record<string, any>>> {
  const tasksPath = path.join(tmpPath, 'memory', 'TASKS.json')
  const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as
    | Array<Record<string, any>>
    | { tasks?: Array<Record<string, any>> }
  return Array.isArray(raw) ? raw : raw.tasks ?? []
}

beforeEach(async () => {
  previousHome = process.env.HOME
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-'))
  process.env.HOME = tmpDir
  bootstrapWorkspace(tmpDir, { name: 'Settings Test' })
  await execFileP('git', ['init', '-b', 'main'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: tmpDir })
  await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: tmpDir })
  await execFileP('git', ['add', '.'], { cwd: tmpDir })
  await execFileP('git', ['commit', '-m', 'init'], { cwd: tmpDir })
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
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

describe('GET/POST /api/project/local-config', () => {
  it('reports effective landing config and persists advanced landing updates', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/local-config')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      landingBranch: string | null
      effectiveLandingBranch: string | null
      landingStrategy: string
    }
    expect(beforeBody.landingBranch).toBeNull()
    expect(beforeBody.effectiveLandingBranch).toBe('main')
    expect(beforeBody.landingStrategy).toBe('cherry_pick_local')

    const save = await app.fetch(
      new Request(scoped('/api/project/local-config'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landingBranch: 'release/mainline',
          landingStrategy: 'manual_pr',
        }),
      }),
    )
    expect(save.status).toBe(200)
    expect(((await save.json()) as { ok?: boolean }).ok).toBe(true)

    const projectCfg = readProjectConfig(tmpDir)
    expect(projectCfg.landingBranch).toBe('release/mainline')

    const settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.landing_strategy.position).toBe('manual_pr')
    expect(settings.project.landing_strategy.setBy).toBe('user-direct')
  })
})

describe('POST /api/project/start', () => {
  it('rejects fanout without worktree isolation with a clear error', async () => {
    const settings = makeDefaultSettings()
    settings.project.concurrent_task_dispatch = {
      position: { kind: 'fanout', n: 3 },
      rationale: 'fan out tasks',
      setAt: new Date().toISOString(),
      setBy: 'user-direct',
    }
    settings.project.worktree_isolation = {
      position: 'none',
      rationale: 'bad combo',
      setAt: new Date().toISOString(),
      setBy: 'user-direct',
    }
    const settingsPath = defaultAgentSettingsPath(tmpDir)
    // write the invalid historical file directly to simulate a bad legacy/edit state
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error?: string; code?: string; actionHref?: string }
    expect(body.code).toBe('invalid_lever_combo')
    expect(body.error).toContain('fanout_N requires worktree_isolation')
    expect(body.actionHref).toBe('/settings/advanced')
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
      new Request(scoped('/api/config/levers/reset'), { method: 'POST' }),
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
      new Request(scoped('/api/project/bootstrap/run'), { method: 'POST' }),
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
    expect(body.identity.editHref).toBe('/settings/advanced')
    expect(body.environment.editHref).toBe('/settings')
    expect(body.workspace.reviewHref).toBe('/workspace-import')
    expect(body.coordinators.editHref).toBe('/settings/routing')
    expect(body.designSystem.editHref).toBe('/settings')
    expect(Array.isArray(body.environment.packageManagers)).toBe(true)
    expect(body.environment.packageManagers).toEqual(['unknown'])
  })

  it('reports multiple package managers when the repo clearly spans ecosystems', async () => {
    await fs.mkdir(path.join(tmpDir, 'frontend'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'frontend', 'package.json'),
      JSON.stringify({ name: 'frontend', packageManager: 'pnpm@10.0.0' }, null, 2),
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'frontend', 'pnpm-lock.yaml'), 'lockfileVersion: 9.0', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'backend'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'backend', 'backend.csproj'), '<Project />', 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/project/facts'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { environment: { packageManagers: string[] } }
    expect(body.environment.packageManagers).toContain('pnpm')
    expect(body.environment.packageManagers).toContain('NuGet')
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
      new Request(scoped('/api/project/workspace-import/dismiss'), { method: 'POST' }),
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
      new Request(scoped('/api/project/workspace-import/approve'), {
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

  it('reuses learned import defaults after a narrowed approval', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma', 'docs'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit', 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma', 'docs', 'component-roadmap.md'),
      '- [ ] Listbox\n- [ ] Combobox\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'knit', 'docs', 'feature-roadmap.md'),
      '- [ ] Auth callback redirect\n- [ ] Collections parity\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'ws-learn' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const before = await app.fetch(new Request('http://localhost/api/project/workspace-import/draft'))
    const beforeBody = (await before.json()) as {
      detected: {
        review: { sourceGroups: Array<{ key: string; areaKey: string; taskIds: string[] }> }
        learning: { defaults: { selectedAreaKeys: string[]; selectedSourceKeys: string[] } }
      }
    }
    const loomaSource = beforeBody.detected.review.sourceGroups.find(group => group.areaKey === 'looma')
    expect(loomaSource).toBeDefined()

    const approve = await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: ['looma'],
          sourceKeys: [loomaSource!.key],
          taskIds: [loomaSource!.taskIds[0]],
        }),
      }),
    )
    expect(approve.status).toBe(200)

    const after = await app.fetch(new Request('http://localhost/api/project/workspace-import/draft'))
    const afterBody = (await after.json()) as {
      detected: {
        learning: {
          defaults: {
            selectedAreaKeys: string[]
            selectedSourceKeys: string[]
            selectedTaskIds: string[]
            note: string | null
          }
        }
      }
    }
    expect(afterBody.detected.learning.defaults.selectedAreaKeys).toEqual(['looma'])
    expect(afterBody.detected.learning.defaults.selectedSourceKeys).toEqual([loomaSource!.key])
    expect(afterBody.detected.learning.defaults.selectedTaskIds).toEqual(loomaSource!.taskIds)
    expect(afterBody.detected.learning.defaults.note).toContain('approved last time')
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
      new Request(scoped('/api/project/workspace-import/rerun'), { method: 'POST' }),
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

describe('GET/POST /api/project/learning', () => {
  it('returns learned import behavior and supports reset', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma', 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma', 'docs', 'component-roadmap.md'),
      '- [ ] Listbox\n- [ ] Combobox\n',
      'utf8',
    )
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'learning-api' }), 'utf8')

    const { app } = buildServeApp({ projectPath: tmpDir })
    const draftRes = await app.fetch(new Request('http://localhost/api/project/workspace-import/draft'))
    const draftBody = (await draftRes.json()) as {
      detected: { review: { sourceGroups: Array<{ key: string; areaKey: string; taskIds: string[] }> } }
    }
    const source = draftBody.detected.review.sourceGroups[0]
    expect(source).toBeDefined()
    await app.fetch(
      new Request(scoped('/api/project/workspace-import/approve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: ['looma'],
          sourceKeys: [source!.key],
          taskIds: [source!.taskIds[0]],
        }),
      }),
    )

    const learning = await app.fetch(new Request('http://localhost/api/project/learning'))
    const learningBody = (await learning.json()) as {
      effective: { defaults: { selectedAreaKeys: string[] } } | null
      project: { workspaceImport: { approvedRuns: number } } | null
    }
    expect(learningBody.project?.workspaceImport.approvedRuns).toBe(1)
    expect(learningBody.effective?.defaults.selectedAreaKeys).toEqual(['looma'])

    const reset = await app.fetch(
      new Request(scoped('/api/project/learning/reset'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'project' }),
      }),
    )
    expect(reset.status).toBe(200)

    const afterReset = await app.fetch(new Request('http://localhost/api/project/learning'))
    const afterResetBody = (await afterReset.json()) as {
      project: { workspaceImport: { approvedRuns: number } } | null
    }
    expect(afterResetBody.project?.workspaceImport.approvedRuns).toBe(0)
  })

  it('lists learning records and supports accept, dismiss, reset, and make-project-wide', async () => {
    const memoryDir = path.join(tmpDir, 'memory')
    const projectCandidate: LearningCandidate = {
      id: 'project-invite-path',
      source: 'task',
      summary: 'Invite work usually touches web/server/api/workspaces routes.',
      evidence: [{ kind: 'task', summary: 'Recovered invite task.', ref: 'task-invite' }],
      proposedScope: 'project',
      proposedDestination: 'project_memory',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    const userCandidate: LearningCandidate = {
      id: 'global-doc-style',
      source: 'user_correction',
      summary: 'Prefer shorter public docs with less implementation trivia.',
      evidence: [{ kind: 'task', summary: 'User corrected docs tone.', ref: 'task-docs' }],
      proposedScope: 'user_global',
      proposedDestination: 'user_preference',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    const productCandidate: LearningCandidate = {
      id: 'product-recovery-visibility',
      source: 'blocker',
      summary: 'Make failed recovery playbooks more visible to builders.',
      evidence: [{ kind: 'task', summary: 'Playbook failed.', ref: 'task-blocked' }],
      proposedScope: 'guildhall_product',
      proposedDestination: 'product_suggestion',
      confidence: 'medium',
      risk: 'low',
      requiresApproval: true,
    }
    await persistLearningCandidates({
      memoryDir,
      candidates: [projectCandidate, userCandidate, productCandidate],
    })
    await proposeProjectSkill({
      memoryDir,
      proposal: {
        id: 'invite-route-skill',
        name: 'invite-route-skill',
        description: 'Repair invite routes',
        triggerKeywords: ['invite'],
        content: 'Use existing workspace route helpers before adding utilities.',
        risk: 'medium',
        requiresApproval: true,
      },
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const before = await app.fetch(new Request(scoped('/api/project/learning')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      project: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      user: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      effective: { productSuggestions: Array<{ id: string }> } | null
      projectSkillProposals: Array<{ id: string; status: string }>
    }
    expect(beforeBody.project?.suggestedLearnings.map(item => item.id)).toContain('project-invite-path')
    expect(beforeBody.user?.suggestedLearnings.map(item => item.id)).toContain('global-doc-style')
    expect(beforeBody.effective?.productSuggestions.map(item => item.id)).toContain('product-recovery-visibility')
    expect(beforeBody.projectSkillProposals[0]).toMatchObject({
      id: 'invite-route-skill',
      status: 'suggested',
    })

    const accept = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'accept', scope: 'project', id: 'project-invite-path' }),
      }),
    )
    expect(accept.status).toBe(200)

    const makeProjectWide = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'make-project-wide', id: 'global-doc-style' }),
      }),
    )
    expect(makeProjectWide.status).toBe(200)

    const dismiss = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'dismiss', scope: 'user_global', id: 'global-doc-style' }),
      }),
    )
    expect(dismiss.status).toBe(200)

    const activateSkill = await app.fetch(
      new Request(scoped('/api/project/skill-proposals/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'activate', id: 'invite-route-skill', approved: true }),
      }),
    )
    expect(activateSkill.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/learning')))
    const afterBody = (await after.json()) as {
      project: { suggestedLearnings: Array<{ id: string; status: string; scope: string }> } | null
      user: { suggestedLearnings: Array<{ id: string; status: string }> } | null
      projectSkillProposals: Array<{ id: string; status: string }>
    }
    expect(afterBody.project?.suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'project-invite-path', status: 'active' }),
        expect.objectContaining({ id: 'project-global-doc-style', status: 'active', scope: 'project' }),
      ]),
    )
    expect(afterBody.user?.suggestedLearnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'global-doc-style', status: 'dismissed' }),
      ]),
    )
    expect(afterBody.projectSkillProposals[0]).toMatchObject({
      id: 'invite-route-skill',
      status: 'active',
    })

    const reset = await app.fetch(
      new Request(scoped('/api/project/learning/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'reset', scope: 'project' }),
      }),
    )
    expect(reset.status).toBe(200)

    const skillReset = await app.fetch(
      new Request(scoped('/api/project/skill-proposals/action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'reset' }),
      }),
    )
    expect(skillReset.status).toBe(200)

    const final = await app.fetch(new Request(scoped('/api/project/learning')))
    const finalBody = (await final.json()) as {
      project: { suggestedLearnings: unknown[] } | null
      projectSkillProposals: unknown[]
    }
    expect(finalBody.project?.suggestedLearnings).toEqual([])
    expect(finalBody.projectSkillProposals).toEqual([])
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
              title: 'Inspect the repo and draft starter tasks',
              description: 'Inspect the codebase, infer the project structure, and draft the first starter tasks. Ask only if confidence is low and being wrong would matter.',
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
      new Request(scoped('/api/project/meta-intake/rerun'), { method: 'POST' }),
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
