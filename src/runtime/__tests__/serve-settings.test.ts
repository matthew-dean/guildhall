import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  bootstrapWorkspace,
  readProjectConfig,
  readWorkspaceConfig,
  registerWorkspace,
  writeProjectConfig,
  writeWorkspaceConfig,
} from '@guildhall/config'
import { defaultAgentSettingsPath, loadLeverSettings, makeDefaultSettings } from '@guildhall/levers'
import { proposeProjectSkill } from '@guildhall/skills'
import { getProjectLocalHistoryDir, getProjectTranscriptPath } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { persistLearningCandidates } from '../learning.js'
import { acceptStructuralMap, draftStructuralMap, submitStructuralMapForReview } from '../structural-map.js'
import { createProjectDependencyRequest } from '../project-graph.js'
import type { LearningCandidate } from '../policy.js'

const execFileP = promisify(execFile)

// Integration tests for the Settings-page read-only endpoints:
//   GET /api/config/levers — flatten lever settings into the shape the UI
//   renders. Seeds agent-settings.yaml on first read, so a freshly bootstrapped
//   workspace is a valid test input.

let tmpDir: string
let previousHome: string | undefined
let previousConfigDir: string | undefined
let systemDir: string
const PROJECT_ID = 'settings-test'

function scoped(pathname: string): string {
  const separator = pathname.includes('?') ? '&' : '?'
  return `http://localhost${pathname}${separator}projectId=${encodeURIComponent(PROJECT_ID)}`
}

async function readTasks(tmpPath: string): Promise<Array<Record<string, any>>> {
  const tasksPath = path.join(tmpPath, '.guildhall', 'TASKS.json')
  const raw = JSON.parse(await fs.readFile(tasksPath, 'utf-8')) as
    | Array<Record<string, any>>
    | { tasks?: Array<Record<string, any>> }
  return Array.isArray(raw) ? raw : raw.tasks ?? []
}

beforeEach(async () => {
  previousHome = process.env.HOME
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-'))
  systemDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-system-'))
  process.env.HOME = tmpDir
  process.env.GUILDHALL_CONFIG_DIR = systemDir
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
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(systemDir, { recursive: true, force: true })
})

describe('GET /api/config/levers', () => {
  it('returns seeded project + default-domain levers with string-rendered positions', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/config/levers')))
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

  it('seeds .guildhall/agent-settings.yaml on first call if missing', async () => {
    const settingsPath = path.join(tmpDir, '.guildhall', 'agent-settings.yaml')
    await expect(fs.access(settingsPath)).rejects.toThrow()
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(res.status).toBe(200)
    await fs.access(settingsPath) // now exists
  })
})

describe('project re-intake endpoints', () => {
  it('creates, returns, applies, and dismisses a re-intake draft', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma/docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'looma/docs/component-library-audit.md'),
      [
        '# Component audit',
        '',
        '| Deliverable | Need | Foundation | Consumer |',
        '| --- | --- | --- | --- |',
        '| Dialog | shipped as `ui-dialog` | native dialog + overlay manager | Knit BaseDialog already uses it |',
        '| AlertDialog | missing P0 gap | builds on Dialog and Button | Knit destructive confirmation flow |',
      ].join('\n'),
      'utf8',
    )
    const tasksPath = path.join(tmpDir, '.guildhall', 'TASKS.json')
    await fs.writeFile(
      tasksPath,
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-05-30T20:00:00.000Z',
        tasks: [{
          id: 'task-039',
          title: 'Build AlertDialog primitive',
          description: 'Old task',
          domain: 'looma',
          projectPath: tmpDir,
          status: 'blocked',
          priority: 'high',
          dependsOn: [],
          outOfScope: [],
          acceptanceCriteria: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: '2026-05-30T20:00:00.000Z',
          updatedAt: '2026-05-30T20:00:00.000Z',
        }],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const rerun = await app.fetch(new Request(scoped('/api/project/reintake/rerun'), { method: 'POST' }))
    expect(rerun.status).toBe(200)
    const rerunBody = await rerun.json() as { draft: { summary: { reframed: number; created: number } } }
    expect(rerunBody.draft.summary.reframed).toBe(1)
    expect(rerunBody.draft.summary.created).toBeGreaterThan(0)

    const draftResponse = await app.fetch(new Request(scoped('/api/project/reintake/draft')))
    const draft = await draftResponse.json() as { groups: Array<{ id: string }> }
    expect(draft.groups.map(group => group.id)).toContain('evidence-work-graph')

    const apply = await app.fetch(new Request(scoped('/api/project/reintake/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ groupIds: ['evidence-work-graph'] }),
    }))
    expect(apply.status).toBe(200)
    const tasks = await readTasks(tmpDir)
    expect(tasks.find(task => task.id === 'task-039')).toMatchObject({
      title: 'Build AlertDialog',
      status: 'import_draft',
    })
    expect(tasks.find(task => task.id === 'task-alert-dialog-integration')).toMatchObject({
      dependsOn: ['task-039'],
    })

    const dismiss = await app.fetch(new Request(scoped('/api/project/reintake/dismiss'), { method: 'POST' }))
    expect(dismiss.status).toBe(200)
  })
})

describe('POST /api/config/levers', () => {
  it('writes a project override and can return the lever to the global default', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const set = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'worktree_isolation',
        position: 'per_attempt',
      }),
    }))
    expect(set.status).toBe(200)
    const setBody = await set.json() as { levers: Array<Record<string, any>> }
    const overridden = setBody.levers.find(l => l.scope === 'project' && l.name === 'worktree_isolation')
    expect(overridden).toMatchObject({
      position: 'per_attempt',
      defaultPosition: 'per_task',
      setBy: 'user-direct',
    })

    let settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.worktree_isolation.position).toBe('per_attempt')
    expect(settings.project.worktree_isolation.setBy).toBe('user-direct')

    const inherit = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'worktree_isolation',
        position: null,
      }),
    }))
    expect(inherit.status).toBe(200)
    const inheritBody = await inherit.json() as { levers: Array<Record<string, any>> }
    const inherited = inheritBody.levers.find(l => l.scope === 'project' && l.name === 'worktree_isolation')
    expect(inherited).toMatchObject({
      position: 'per_task',
      defaultPosition: 'per_task',
      setBy: 'system-default',
    })

    settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.worktree_isolation.position).toBe('per_task')
    expect(settings.project.worktree_isolation.setBy).toBe('system-default')
  })

  it('writes parameterized lever positions from UI option values', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scoped('/api/config/levers'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scope: 'project',
        name: 'concurrent_task_dispatch',
        position: 'fanout_2',
      }),
    }))
    expect(res.status).toBe(200)

    const settings = await loadLeverSettings({
      path: defaultAgentSettingsPath(tmpDir),
    })
    expect(settings.project.concurrent_task_dispatch.position).toEqual({ kind: 'fanout', n: 2 })
    expect(settings.project.concurrent_task_dispatch.setBy).toBe('user-direct')
  })
})

describe('general project status endpoints', () => {
  it('reports and refreshes the project codebase map', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'settings-test', scripts: { test: 'vitest' }, dependencies: { svelte: '5.0.0' } }, null, 2),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, 'src/web/lib'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'src/web/lib/Button.svelte'), '<button><slot /></button>\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const initial = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    expect(initial.status).toBe(200)
    const initialBody = await initial.json() as Record<string, any>
    expect(initialBody).toMatchObject({
      configured: true,
      counts: { abstractions: 1 },
    })
    expect(initialBody.generatedAt).toEqual(expect.any(String))

    const refresh = await app.fetch(new Request(scoped('/api/project/codebase-map/refresh'), { method: 'POST' }))
    expect(refresh.status).toBe(200)
    const refreshBody = await refresh.json() as Record<string, any>
    expect(refreshBody).toMatchObject({
      ok: true,
      mode: 'full',
      status: {
        configured: true,
        counts: { abstractions: 1 },
      },
    })

    const status = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    expect(status.status).toBe(200)
    const body = await status.json() as Record<string, any>
    expect(body.configured).toBe(true)
    expect(body.counts.files).toBeGreaterThan(0)
    expect(body.project.summary).toContain('Local project')
    expect(body.project.languages).toContain('svelte')
    expect(body.entrypoints.map((entry: any) => entry.path)).toContain('package.json')
    expect(body.areas.length).toBeGreaterThan(0)
    expect(body.areas[0]).toHaveProperty('canonicalFiles')
    expect(body.abstractions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Command buttons',
          canonicalPath: 'src/web/lib/Button.svelte',
        }),
      ]),
    )
    expect(body.frameworks).toContain('svelte')

    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'codebase-map.yaml'),
      [
        'version: 1',
        'generatedAt: 2026-05-21T12:00:00.000Z',
        'project:',
        `  root: ${tmpDir}`,
        '  summary: Fixture',
        '  languages: [typescript]',
        '  packageManagers: [pnpm]',
        '  primaryFrameworks: [svelte]',
        'files: {}',
        'entrypoints: []',
        'areas: []',
        'abstractions: []',
        'verification:',
        '  commands: []',
        'semantic:',
        '  generatedAt: 2026-05-21T12:00:00.000Z',
        '  modelId: zai-org/GLM-4.6',
        '  corpusKind: documentation',
        '  confidence: 0.95',
        '  projectPurpose: Fixture semantic map.',
        '  currentTruth: []',
        '  architectureAreas: []',
        '  canonicalAbstractions: []',
        '  gapsOrRisks: []',
        '  readNext:',
        '    - path: docs/architecture.md',
        '      reason: Read the project architecture first.',
        '  workerGuidance:',
        '    - Use the semantic map before editing.',
        '  needsBroaderRead: true',
      ].join('\n'),
      'utf8',
    )
    const semanticStatus = await app.fetch(new Request(scoped('/api/project/codebase-map/status')))
    const semanticBody = await semanticStatus.json() as Record<string, any>
    expect(semanticBody.semantic).toMatchObject({
      modelId: 'zai-org/GLM-4.6',
      corpusKind: 'documentation',
      projectPurpose: 'Fixture semantic map.',
      readNext: [{ path: 'docs/architecture.md', reason: 'Read the project architecture first.' }],
      workerGuidance: ['Use the semantic map before editing.'],
      needsBroaderRead: true,
    })
  })

  it('reports setup status and generated setup defaults for the selected project', async () => {
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      id: PROJECT_ID,
      name: 'Settings Test',
      coordinators: [
        {
          id: 'frontend',
          domain: 'frontend',
          mandate: 'Own UI work.',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
      ignore: ['node_modules', 'dist', '.git', 'coverage'],
    })
    writeProjectConfig(tmpDir, { ...readProjectConfig(tmpDir), preferredProvider: 'openai-api' })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const status = await app.fetch(new Request(scoped('/api/setup/status')))
    expect(status.status).toBe(200)
    const statusBody = await status.json() as Record<string, any>
    expect(statusBody).toMatchObject({
      initialized: true,
      providerConfigured: true,
      name: 'Settings Test',
      id: PROJECT_ID,
      coordinatorCount: 1,
    })

    const defaults = await app.fetch(new Request(scoped('/api/setup/defaults')))
    expect(defaults.status).toBe(200)
    const defaultsBody = await defaults.json() as Record<string, any>
    expect(defaultsBody.suggestedName).toBe('Settings Test')
    expect(defaultsBody.suggestedId).toBe(PROJECT_ID)
    expect(defaultsBody.path).toBe(tmpDir)
    expect(Array.isArray(defaultsBody.localModels)).toBe(true)
    expect(Array.isArray(defaultsBody.cloudModels)).toBe(true)
  })

  it('detects and saves explicit task worktree include paths for local runtime config', async () => {
    await fs.writeFile(path.join(tmpDir, '.env.local'), 'SECRET=do-not-read\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# readme\n', 'utf8')
    await fs.mkdir(path.join(tmpDir, 'frontend'), { recursive: true })
    await execFileP('git', ['init'], { cwd: path.join(tmpDir, 'frontend') })
    await execFileP('git', ['config', 'user.email', 'guildhall@example.test'], { cwd: path.join(tmpDir, 'frontend') })
    await execFileP('git', ['config', 'user.name', 'Guildhall Test'], { cwd: path.join(tmpDir, 'frontend') })
    await fs.writeFile(path.join(tmpDir, 'frontend', '.env'), 'SECRET=tracked\n', 'utf8')
    await execFileP('git', ['add', '.env'], { cwd: path.join(tmpDir, 'frontend') })
    await fs.mkdir(path.join(tmpDir, 'backend'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'backend', 'appsettings.local.yaml'),
      'connection: local\n',
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/worktree-includes')))
    expect(before.status).toBe(200)
    const beforeBody = await before.json() as Record<string, any>
    expect(beforeBody.include).toEqual([])
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).toEqual(
      expect.arrayContaining(['.env.local', 'backend/appsettings.local.yaml']),
    )
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain('README.md')
    expect(beforeBody.candidates.map((candidate: { path: string }) => candidate.path)).not.toContain('frontend/.env')

    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeText: '.env.local\nbackend/appsettings.local.yaml\n' }),
      }),
    )
    expect(save.status).toBe(200)
    const saved = await save.json() as Record<string, any>
    expect(saved.include).toEqual(['.env.local', 'backend/appsettings.local.yaml'])
    expect(readWorkspaceConfig(tmpDir).worktree?.include).toEqual([
      '.env.local',
      'backend/appsettings.local.yaml',
    ])
  })

  it('rejects task worktree include paths outside the project root', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ include: ['.env', '../outside.env'] }),
      }),
    )
    expect(save.status).toBe(400)
    const body = await save.json() as Record<string, any>
    expect(body.error).toMatch(/project-relative/i)
  })

  it('saves task worktree include paths on the selected child project in a workspace', async () => {
    await fs.mkdir(path.join(tmpDir, 'looma'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'knit'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'knit', '.env'), 'SECRET=needed\n', 'utf8')
    await fs.writeFile(path.join(tmpDir, 'knit', 'package.json'), JSON.stringify({ name: 'knit' }), 'utf8')
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      kind: 'workspace',
      projectPath: tmpDir,
      projects: [
        { id: 'looma', label: 'Looma', path: 'looma', coordinator: 'looma' },
        { id: 'knit', label: 'Knit', path: 'knit', coordinator: 'knit' },
      ],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/worktree-includes')))
    expect(before.status).toBe(200)
    const beforeBody = await before.json() as Record<string, any>
    expect(beforeBody.scopes.map((scope: { projectId?: string }) => scope.projectId)).toEqual(['looma', 'knit'])
    const knitScope = beforeBody.scopes.find((scope: { projectId?: string }) => scope.projectId === 'knit')
    expect(knitScope.candidates.map((candidate: { path: string }) => candidate.path)).toContain('.env')

    const saveWithoutChild = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includeText: '.env\n' }),
      }),
    )
    expect(saveWithoutChild.status).toBe(400)

    const save = await app.fetch(
      new Request(scoped('/api/project/worktree-includes'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceProjectId: 'knit', includeText: '.env\n' }),
      }),
    )
    expect(save.status).toBe(200)
    const saved = await save.json() as Record<string, any>
    expect(saved.include).toEqual(['.env'])
    const workspace = readWorkspaceConfig(tmpDir)
    expect(workspace.worktree).toBeUndefined()
    expect(workspace.projects.find(project => project.id === 'knit')?.worktree?.include).toEqual(['.env'])
    expect(workspace.projects.find(project => project.id === 'looma')?.worktree).toBeUndefined()
  })

  it('redacts local config secrets and filters noisy progress entries', async () => {
    writeProjectConfig(tmpDir, {
      ...readProjectConfig(tmpDir),
      preferredProvider: 'anthropic-api',
      anthropicApiKey: 'sk-ant-secret',
      openaiApiKey: 'sk-openai-secret',
    })
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'PROGRESS.md'),
      [
        '# Progress',
        '',
        '### 💓 HEARTBEAT',
        'routine tick',
        '---',
        '### Worker blocked',
        'Useful blocker detail',
        '---',
        '### Escalation',
        'error: Exceeded maximum turn limit',
        '---',
      ].join('\n'),
      'utf-8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const config = await app.fetch(new Request(scoped('/api/config')))
    expect(config.status).toBe(200)
    const configBody = await config.json() as Record<string, any>
    expect(configBody.anthropicApiKey).toBe('•••')
    expect(configBody.openaiApiKey).toBe('•••')

    const progress = await app.fetch(new Request(scoped('/api/project/progress')))
    expect(progress.status).toBe(200)
    const progressBody = await progress.json() as { progress: string }
    expect(progressBody.progress).toContain('Worker blocked')
    expect(progressBody.progress).toContain('Useful blocker detail')
    expect(progressBody.progress).not.toContain('HEARTBEAT')
    expect(progressBody.progress).not.toContain('Exceeded maximum turn limit')
  })

  it('reports bootstrap and workspace-import status before either flow has work to do', async () => {
    writeWorkspaceConfig(tmpDir, {
      ...readWorkspaceConfig(tmpDir),
      id: PROJECT_ID,
      name: 'Settings Test',
      bootstrap: {
        commands: ['node --version'],
        successGates: ['node --version'],
        timeoutMs: 300_000,
        provenance: {
          establishedBy: 'test',
          establishedAt: '2026-05-19T16:00:00.000Z',
          tried: [{ command: 'node --version', result: 'pass' }],
        },
      },
      coordinators: [],
      ignore: ['node_modules', 'dist', '.git', 'coverage'],
    })
    const { app } = buildServeApp({ projectPath: tmpDir })

    const needsMeta = await app.fetch(new Request(scoped('/api/project/needs-meta-intake')))
    expect(needsMeta.status).toBe(200)
    expect(await needsMeta.json()).toMatchObject({ needsMetaIntake: expect.any(Boolean) })

    const bootstrap = await app.fetch(new Request(scoped('/api/project/bootstrap/status')))
    expect(bootstrap.status).toBe(200)
    const bootstrapBody = await bootstrap.json() as Record<string, any>
    expect(bootstrapBody.configured).toBe(true)
    expect(bootstrapBody.bootstrap.commands).toEqual(['node --version'])
    expect(bootstrapBody.bootstrap.successGates).toEqual(['node --version'])
    expect(bootstrapBody.bootstrap.provenance.establishedBy).toBe('test')

    const importStatus = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(importStatus.status).toBe(200)
    const importBody = await importStatus.json() as Record<string, any>
    expect(importBody).toMatchObject({
      seeded: false,
      taskStatus: null,
      specPresent: false,
      leverPosition: expect.any(String),
    })
    expect(importBody.draft).toMatchObject({
      goals: expect.any(Number),
      tasks: expect.any(Number),
      milestones: expect.any(Number),
    })
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
  it('blocks project start when required migrations are pending', async () => {
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const migrations = await app.fetch(new Request(scoped('/api/project/migrations')))
    expect(migrations.status).toBe(200)
    const migrationsBody = await migrations.json() as Record<string, any>
    expect(migrationsBody.blocked.map((item: { id: string }) => item.id)).toContain('0.8.0/project-state-layout')

    const project = await app.fetch(new Request(scoped('/api/project')))
    expect(project.status).toBe(200)
    const projectBody = await project.json() as { startReadiness?: Record<string, any> }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'required_migration_pending',
      actionHref: '/migrations',
    })

    const start = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(start.status).toBe(409)
    const startBody = await start.json() as Record<string, any>
    expect(startBody).toMatchObject({
      code: 'required_migration_pending',
    })

    const apply = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePrompt: true, migrationId: '0.8.0/project-state-layout' }),
    }))
    expect(apply.status).toBe(200)
    const applyBody = await apply.json() as Record<string, any>
    expect(applyBody.result.applied.map((item: { id: string }) => item.id)).toContain('0.8.0/project-state-layout')
    expect(applyBody.status.blocked).toEqual([])

    const after = await app.fetch(new Request(scoped('/api/project/migrations')))
    const afterBody = await after.json() as Record<string, any>
    expect(afterBody.blocked).toEqual([])
  })

  it('projects required migrations into durable inbox history without making them dismissible', async () => {
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items?: Array<Record<string, any>>
      history?: Array<Record<string, any>>
    }
    expect(beforeBody.items?.find(item => item.id === 'migration:0.8.0/project-state-layout')).toMatchObject({
      kind: 'required_migration',
      status: 'open',
      blocking: true,
      dismissible: false,
      actionHref: '/migrations',
    })
    expect(beforeBody.history?.find(item => item.id === 'migration:0.8.0/project-state-layout')?.dismissEndpoint).toBeUndefined()

    const apply = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePrompt: true, migrationId: '0.8.0/project-state-layout' }),
    }))
    expect(apply.status).toBe(200)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as {
      items?: Array<Record<string, any>>
      history?: Array<Record<string, any>>
    }
    expect(afterBody.items?.some(item => item.id === 'migration:0.8.0/project-state-layout')).toBe(false)
    expect(afterBody.history?.find(item => item.id === 'migration:0.8.0/project-state-layout')).toMatchObject({
      status: 'resolved',
      resolution: 'migrated',
    })
  })

  it('includes project start readiness in service summaries so fleet cards inherit start blockers', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const service = await app.fetch(new Request('http://localhost/api/service'))
    expect(service.status).toBe(200)
    const body = (await service.json()) as {
      projects?: Array<{
        id?: string
        startReadiness?: { canStart?: boolean; code?: string; actionHref?: string }
      }>
    }
    const project = body.projects?.find(entry => entry.id === PROJECT_ID)
    expect(project?.startReadiness).toMatchObject({
      canStart: false,
      code: 'required_migration_pending',
      actionHref: '/migrations',
    })
  })

  it('blocks project mutations when project state requires a newer Guildhall runtime', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'runtime.json'),
      JSON.stringify({
        version: 1,
        writtenByGuildhall: '999.0.0',
        minGuildhallVersion: '999.0.0',
        stateSchema: 'future-state',
        requiredFeatures: ['future.guildhall-state.v1'],
      }, null, 2),
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const project = await app.fetch(new Request(scoped('/api/project')))
    expect(project.status).toBe(200)
    const projectBody = await project.json() as { startReadiness?: Record<string, any> }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'runtime_too_old',
      actionHref: '/settings/about',
    })

    const start = await app.fetch(new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }))
    expect(start.status).toBe(409)
    expect(await start.json()).toMatchObject({
      code: 'runtime_too_old',
      actionHref: '/settings/about',
    })

    const migrations = await app.fetch(new Request(scoped('/api/project/migrations/apply'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ includePrompt: true }),
    }))
    expect(migrations.status).toBe(409)
    expect(await migrations.json()).toMatchObject({
      code: 'runtime_too_old',
    })
  })

  it('marks all-terminal projects as not startable', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-done-1',
            title: 'Done one',
            description: 'Finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
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
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-done-2',
            title: 'Done two',
            description: 'Also finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
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
            createdAt: now,
            updatedAt: now,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))

    expect(res.status).toBe(200)
    const body = await res.json() as { startReadiness?: { canStart?: boolean; code?: string; message?: string } }
    expect(body.startReadiness).toMatchObject({
      canStart: false,
      code: 'all_terminal',
      message: 'All tasks are already finished.',
    })
  })

  it('returns a no-op start response when all tasks are terminal', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-done-1',
            title: 'Done one',
            description: 'Finished already.',
            domain: 'core',
            status: 'done',
            priority: 'normal',
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
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-blocked-1',
            title: 'Blocked one',
            description: 'No action can be taken.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
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
            createdAt: now,
            updatedAt: now,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { status?: string; code?: string; stopSummary?: { reason?: string } }
    expect(body).toMatchObject({
      status: 'stopped',
      code: 'all_terminal',
      stopSummary: { reason: 'all_terminal' },
    })
  })

  it('points Start at imported draft review when no runnable work is available', async () => {
    const tasksPath = path.join(tmpDir, '.guildhall', 'TASKS.json')
    await fs.writeFile(
      tasksPath,
      JSON.stringify({
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [
          {
            id: 'task-import-1',
            title: 'Imported draft',
            description: 'Needs shaping before work can run.',
            domain: 'core',
            status: 'import_draft',
            priority: 'normal',
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }, null, 2),
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }
    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'import_drafts_waiting',
      actionHref: '/task/task-import-1',
    })
    expect(projectBody.startReadiness?.message).toContain('Review the imported draft')

    const startRes = await app.fetch(
      new Request(scoped('/api/project/start'), { method: 'POST', body: '{}' }),
    )
    expect(startRes.status).toBe(400)
    const startBody = (await startRes.json()) as { code?: string; actionHref?: string }
    expect(startBody.code).toBe('import_drafts_waiting')
    expect(startBody.actionHref).toBe('/task/task-import-1')
  })

  it('blocks Start when ready tasks still need brief cleanup', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-thin-ready',
            title: 'Thin ready task',
            description: 'Looks queued but has no approved brief or acceptance criteria.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
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
            createdAt: now,
            updatedAt: now,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'no_unattended_progress',
      actionHref: '/work',
    })
    expect(projectBody.startReadiness?.message).toContain('clearer brief')
  })

  it('points owner-input Start blockers at the pending question instead of a separate escalation', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-blocked',
            title: 'Blocked task',
            description: 'Already has a separate escalation.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-1', summary: 'Build is failing' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-question',
            title: 'Question task',
            description: 'Needs one owner decision.',
            domain: 'core',
            status: 'exploring',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [{
              id: 'q-1',
              askedBy: 'spec-agent',
              askedAt: now,
              kind: 'choice',
              prompt: 'Which API shape should this component use?',
              choices: ['Stencil component', 'Vanilla web component'],
            }],
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      actionHref: '/task/task-question?tab=current',
    })
    expect(projectBody.startReadiness?.message).toContain('1 question needs your answer')
  })

  it('points recovery-only Start blockers at the newest blocked task instead of stale historical blockers', async () => {
    const older = '2026-05-19T10:00:00.000Z'
    const newer = '2026-05-19T12:00:00.000Z'
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: newer,
        tasks: [
          {
            id: 'task-old-import',
            title: 'Old import blocker',
            description: 'Historical blocked task.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-old', summary: 'Old recovery path' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: older,
            updatedAt: older,
          },
          {
            id: 'task-current',
            title: 'Current blocked task',
            description: 'The task the user is looking at now.',
            domain: 'core',
            status: 'blocked',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [],
            escalations: [{ id: 'esc-current', summary: 'Current recovery path' }],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: newer,
            updatedAt: newer,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    const projectBody = (await projectRes.json()) as {
      startReadiness?: { canStart?: boolean; code?: string; actionHref?: string; message?: string }
    }

    expect(projectBody.startReadiness).toMatchObject({
      canStart: false,
      code: 'owner_input_required',
      actionHref: '/task/task-current',
    })
    expect(projectBody.startReadiness?.message).toContain('Choose a recovery path')
  })

  it('rejects focused task starts while project-level owner input is still blocking Start', async () => {
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: now,
        tasks: [
          {
            id: 'task-needs-answer',
            title: 'Needs answer first',
            description: 'The project-level blocker.',
            domain: 'core',
            status: 'exploring',
            priority: 'normal',
            acceptanceCriteria: [],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            openQuestions: [{
              id: 'q-1',
              askedBy: 'spec-agent',
              askedAt: now,
              kind: 'choice',
              prompt: 'Which implementation direction should Guildhall use?',
              choices: ['Option A', 'Option B'],
            }],
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'task-other',
            title: 'Other ready-looking task',
            description: 'This should not be startable while the project is blocked.',
            domain: 'core',
            status: 'ready',
            priority: 'normal',
            acceptanceCriteria: ['It has a real acceptance criterion.'],
            outOfScope: [],
            dependsOn: [],
            notes: [],
            productBrief: {
              userJob: 'Move another task forward.',
              successMetric: 'The task completes.',
              approvedAt: now,
            },
            escalations: [],
            agentIssues: [],
            gateResults: [],
            reviewVerdicts: [],
            adjudications: [],
            revisionCount: 0,
            remediationAttempts: 0,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'one_task', taskId: 'task-other', scope: 'work_item' }),
      }),
    )

    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string; actionHref?: string; error?: string }
    expect(body).toMatchObject({
      code: 'owner_input_required',
      actionHref: '/task/task-needs-answer?tab=current',
    })
    expect(body.error).toContain('1 question needs your answer')
  })

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

  it('rejects targeted task starts while a project run is already active', async () => {
    const { app, supervisor } = buildServeApp({ projectPath: tmpDir })
    supervisor.start({
      workspaceId: PROJECT_ID,
      workspacePath: tmpDir,
    })

    const res = await app.fetch(
      new Request(scoped('/api/project/start'), {
        method: 'POST',
        body: JSON.stringify({ taskId: 'task-a', mode: 'continuous' }),
      }),
    )
    expect(res.status).toBe(409)
    const body = (await res.json()) as { code?: string; status?: string; error?: string }
    expect(body.code).toBe('run_already_active')
    expect(body.status).toBe('running')
    expect(body.error).toContain('already running')

    await supervisor.stop(PROJECT_ID, { waitMs: 1_000 })
  })
})

// Recovery path: if the on-disk agent-settings.yaml is missing a lever that
// was added to the Zod schema, `GET /api/config/levers` throws
// LeverSettingsCorruptError. POST /api/config/levers/reset wipes the file and
// re-seeds from defaults so the UI can recover without shelling in.
describe('POST /api/config/levers/reset', () => {
  it('rewrites the lever file with default positions so subsequent reads succeed', async () => {
    const settingsPath = path.join(tmpDir, '.guildhall', 'agent-settings.yaml')
    const { app } = buildServeApp({ projectPath: tmpDir })

    // Corrupt the file beyond self-heal (bad YAML). Missing-key corruption
    // is auto-repaired by loadLeverSettings, so we need a structurally
    // broken file here to force the 500 path.
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, 'version: "one"\nproject: {}\ndomains: {}\n', 'utf8')
    const bad = await app.fetch(new Request(scoped('/api/config/levers')))
    expect(bad.status).toBe(500)

    // Reset → ok.
    const reset = await app.fetch(
      new Request(scoped('/api/config/levers/reset'), { method: 'POST' }),
    )
    expect(reset.status).toBe(200)
    expect(((await reset.json()) as { ok?: boolean }).ok).toBe(true)

    // Follow-up read succeeds and contains the seeded defaults.
    const good = await app.fetch(new Request(scoped('/api/config/levers')))
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
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, any>
    expect(body.identity.name).toBeDefined()
    expect(body.identity.id).toBeDefined()
    expect(typeof body.identity.editHref).toBe('string')
    expect(body.identity.editHref).toBe('/settings/advanced')
    expect(body.environment.editHref).toBe('/settings')
    expect(body.workspace.reviewHref).toBe(`/projects/${PROJECT_ID}/workspace-import`)
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
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { environment: { packageManagers: string[] } }
    expect(body.environment.packageManagers).toContain('pnpm')
    expect(body.environment.packageManagers).toContain('NuGet')
  })

  it('counts saved completed workspace-import specs in the memory check-in facts', async () => {
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'workspace-goals.json'),
      JSON.stringify({
        goals: [{ id: 'old-goal', title: 'Old goal' }],
      }),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              status: 'done',
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-goal',
                '    title: Imported goal',
                '```',
                '```yaml',
                'tasks:',
                '  - id: imported-task-one',
                '    title: First imported task',
                '  - id: imported-task-two',
                '    title: Second imported task',
                '```',
                '```yaml',
                'milestones:',
                '  - title: First milestone',
                '  - title: Second milestone',
                '```',
              ].join('\n'),
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/facts')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      workspace: { goals: { imported: boolean; goalCount: number; taskCount: number; milestoneCount: number } }
    }
    expect(body.workspace.goals).toMatchObject({
      imported: true,
      goalCount: 1,
      taskCount: 2,
      milestoneCount: 2,
    })
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

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    const beforeBody = (await before.json()) as { items: Array<{ kind: string }> }
    expect(beforeBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(true)

    const dismiss = await app.fetch(
      new Request(scoped('/api/project/workspace-import/dismiss'), { method: 'POST' }),
    )
    expect(dismiss.status).toBe(200)
    expect(((await dismiss.json()) as { ok?: boolean }).ok).toBe(true)

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as { items: Array<{ kind: string }> }
    expect(afterBody.items.some(i => i.kind === 'workspace_import_pending')).toBe(false)

    // Facts surface reflects the dismissed state.
    const facts = await app.fetch(new Request(scoped('/api/project/facts')))
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

describe('GET /api/stale-server', () => {
  it('returns the served bundle freshness payload used by release smoke', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/stale-server'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      stale?: boolean
      processStartedAt?: string
      bootBuildMtimeMs?: number
      currentBuildMtimeMs?: number
    }
    expect(body.stale).toBe(false)
    expect(typeof body.processStartedAt).toBe('string')
    expect(typeof body.bootBuildMtimeMs).toBe('number')
    expect(typeof body.currentBuildMtimeMs).toBe('number')
  })
})

describe('GET /api/service', () => {
  it('includes migration summary counts for registered projects', async () => {
    registerWorkspace({ id: PROJECT_ID, name: 'Settings Test', path: tmpDir, tags: [] })
    await fs.mkdir(path.join(tmpDir, 'memory'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'memory', 'PROGRESS.md'), '# Progress\n', 'utf8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request('http://localhost/api/service'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { projects?: Array<Record<string, any>> }
    const project = body.projects?.find(item => item.id === PROJECT_ID)
    expect(project?.migrationSummary).toMatchObject({
      pending: expect.any(Number),
      blocked: expect.any(Number),
      applied: expect.any(Number),
    })
    expect(project?.migrationSummary.pending).toBeGreaterThan(0)
  })
})

describe('GET /api/health', () => {
  it('returns package, git, and served-build identity for the running process', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request('http://localhost/api/health'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      version?: string
      git?: {
        commit?: string
        shortCommit?: string
        branch?: string
        dirty?: boolean
      }
      build?: {
        builtAt?: string
        source?: string
        distPath?: string | null
      }
      served?: {
        stale?: boolean
        processStartedAt?: string
        bootBuildMtimeMs?: number
        currentBuildMtimeMs?: number
      }
      migrations?: {
        pending?: number
        blocked?: number
        applied?: number
      }
    }

    expect(typeof body.version).toBe('string')
    expect((body.version ?? '').length).toBeGreaterThan(0)
    expect(body.git?.commit).toMatch(/^[0-9a-f]{40}$|^unknown$/)
    expect(typeof body.git?.shortCommit).toBe('string')
    expect(typeof body.git?.branch).toBe('string')
    expect(typeof body.git?.dirty).toBe('boolean')
    expect(typeof body.build?.builtAt).toBe('string')
    expect(typeof body.build?.source).toBe('string')
    expect(body.served?.stale).toBe(false)
    expect(typeof body.served?.processStartedAt).toBe('string')
    expect(typeof body.served?.bootBuildMtimeMs).toBe('number')
    expect(typeof body.served?.currentBuildMtimeMs).toBe('number')
    expect(typeof body.migrations?.pending).toBe('number')
    expect(typeof body.migrations?.blocked).toBe('number')
    expect(typeof body.migrations?.applied).toBe('number')
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
      new Request(scoped('/api/project/workspace-import/draft')),
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
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
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

  it('approve preserves the importer agent curated spec when no review narrowing is supplied', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      '# Broad detector bait\n\n## Goals\n\n- Ship everything\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'roadmap.md'),
      '- [ ] Detector task one\n- [ ] Detector task two\n- [ ] Detector task three\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'curated-import' }),
      'utf8',
    )
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'spec_review',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: curated-goal',
                '    title: Keep the curated project direction',
                '    rationale: The importer agent narrowed noisy repo notes to one useful workstream.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: curated-first-task',
                '    title: Build the curated first task',
                '    description: Implement only the first reviewed workstream from the importer agent.',
                '    domain: app',
                '    priority: high',
                '    references:',
                '      - README.md',
                '```',
                '```yaml',
                'milestones:',
                '  - title: Curated import spec reviewed',
                '    evidence: README.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
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
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    const body = (await approve.json()) as {
      ok?: boolean
      tasksAdded?: number
      goalsRecorded?: number
      milestonesLogged?: number
      error?: string
    }
    if (approve.status !== 200) {
      throw new Error(`approve failed: status=${approve.status} body=${JSON.stringify(body)}`)
    }

    expect(body.ok).toBe(true)
    expect(body.tasksAdded).toBe(1)
    expect(body.goalsRecorded).toBe(1)
    expect(body.milestonesLogged).toBe(1)

    const tasks = await readTasks(tmpDir)
    expect(tasks.some(task => task.id === 'curated-first-task')).toBe(true)
    expect(tasks.some(task => task.id === 'task-detector-task-one')).toBe(false)
  })

  it('status counts a completed importer task from its saved curated spec', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'completed-import-status' }), 'utf8')
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify(
        {
          version: 1,
          lastUpdated: '2026-01-01T00:00:00.000Z',
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              description: 'Reserved importer',
              domain: '_workspace_import',
              projectPath: tmpDir,
              status: 'done',
              priority: 'normal',
              acceptanceCriteria: [],
              dependsOn: [],
              outOfScope: [],
              spec: [
                '```yaml',
                'goals:',
                '  - id: imported-direction',
                '    title: Keep the imported direction',
                '    rationale: The completed import captured the owner direction.',
                '```',
                '```yaml',
                'tasks:',
                '  - id: imported-first-task',
                '    title: Build the first imported task',
                '    description: Preserve completed import work in status summaries.',
                '    domain: app',
                '    priority: high',
                '```',
                '```yaml',
                'milestones:',
                '  - title: Imported work reviewed',
                '    evidence: README.md',
                '```',
              ].join('\n'),
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const status = await app.fetch(new Request(scoped('/api/project/workspace-import/status')))
    expect(status.status).toBe(200)
    const body = await status.json() as Record<string, any>
    expect(body).toMatchObject({
      seeded: true,
      taskStatus: 'done',
      specPresent: true,
      draft: {
        goals: 1,
        tasks: 1,
        milestones: 1,
      },
    })
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
    const before = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
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

    const after = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
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
      path.join(tmpDir, '.guildhall', 'workspace-goals.json'),
      JSON.stringify({ dismissed: true, dismissedAt: '2026-01-01T00:00:00Z' }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
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
      await fs.readFile(path.join(tmpDir, '.guildhall', 'workspace-goals.json'), 'utf8'),
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
    const draftRes = await app.fetch(new Request(scoped('/api/project/workspace-import/draft')))
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
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.guildhall', 'project-brief.md'), 'This project has saved context.\n', 'utf8')

    const learning = await app.fetch(new Request(scoped('/api/project/learning')))
    const learningBody = (await learning.json()) as {
      effective: { defaults: { selectedAreaKeys: string[] } } | null
      project: { workspaceImport: { approvedRuns: number } } | null
      projectContext: {
        projectBrief: { present: boolean; nonEmptyLines: number }
      } | null
    }
    expect(learningBody.project?.workspaceImport.approvedRuns).toBe(1)
    expect(learningBody.effective?.defaults.selectedAreaKeys).toEqual(['looma'])
    expect(learningBody.projectContext?.projectBrief).toMatchObject({ present: true, nonEmptyLines: 1 })

    const reset = await app.fetch(
      new Request(scoped('/api/project/learning/reset'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'project' }),
      }),
    )
    expect(reset.status).toBe(200)

    const afterReset = await app.fetch(new Request(scoped('/api/project/learning')))
    const afterResetBody = (await afterReset.json()) as {
      project: { workspaceImport: { approvedRuns: number } } | null
    }
    expect(afterResetBody.project?.workspaceImport.approvedRuns).toBe(0)
  })

  it('lists learning records and supports accept, dismiss, reset, and make-project-wide', async () => {
    const memoryDir = path.join(tmpDir, '.guildhall')
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
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
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
    const transcriptPath = getProjectTranscriptPath(tmpDir, 'exploring', 'task-meta-intake')
    await fs.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.writeFile(transcriptPath, 'stale transcript\n', 'utf8')

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

    const transcript = await fs.readFile(transcriptPath, 'utf8')
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
    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
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

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    const afterBody = (await after.json()) as {
      blockers: { bootstrap: boolean; workspaceImport: boolean }
    }
    expect(afterBody.blockers.bootstrap).toBe(false)
  })

  it('keeps attention history and marks satisfied items resolved', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const before = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(before.status).toBe(200)
    const beforeBody = (await before.json()) as {
      items?: Array<{ id?: string; status?: string; kind?: string }>
      history?: Array<{ id?: string; status?: string; kind?: string }>
    }
    expect(beforeBody.items?.some(item => item.id === 'bootstrap:readiness' && item.status === 'open')).toBe(true)
    expect(beforeBody.history?.some(item => item.id === 'bootstrap:readiness' && item.status === 'open')).toBe(true)

    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n',
      'utf8',
    )

    const after = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(after.status).toBe(200)
    const afterBody = (await after.json()) as {
      items?: Array<{ id?: string; status?: string }>
      history?: Array<{ id?: string; status?: string; resolution?: string }>
    }
    expect(afterBody.items?.some(item => item.id === 'bootstrap:readiness')).toBe(false)
    expect(afterBody.history?.some(item =>
      item.id === 'bootstrap:readiness' &&
      item.status === 'resolved' &&
      item.resolution === 'verified',
    )).toBe(true)
  })

  it('returns only needs-you alerts sorted by current inbox priority instead of stale record recency', async () => {
    const yamlPath = path.join(tmpDir, 'guildhall.yaml')
    const current = await fs.readFile(yamlPath, 'utf8')
    await fs.writeFile(
      yamlPath,
      current +
        '\nbootstrap:\n  verifiedAt: "2026-04-24T00:00:00Z"\n  packageManager: pnpm\n  install: { command: "pnpm install", status: ok }\n  gates:\n    lint: { command: "pnpm lint", available: true }\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'workspace-goals.json'),
      JSON.stringify({ goals: [] }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-05-31T15:00:00.000Z',
        tasks: [
          {
            id: 'task-thin',
            title: 'Thin ready task',
            description: 'Needs acceptance criteria.',
            status: 'ready',
            productBrief: {
              userJob: 'Use the task.',
              successMetric: 'Task works.',
              approvedAt: '2026-05-31T14:00:00.000Z',
            },
            acceptanceCriteria: [],
            escalations: [],
          },
          {
            id: 'task-blocked',
            title: 'Blocked task',
            description: 'Needs recovery.',
            status: 'blocked',
            escalations: [{ id: 'esc-block', summary: 'Needs recovery.' }],
          },
        ],
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'attention.json'),
      JSON.stringify({
        version: 1,
        records: [
          {
            id: 'spec_fill_pending:task-thin',
            status: 'open',
            kind: 'spec_fill_pending',
            severity: 'low',
            taskId: 'task-thin',
            title: 'Thin ready task',
            detail: 'Optional cleanup: add acceptance criteria so agents and reviewers have a clearer brief.',
            actionHref: '/task/task-thin?tab=spec',
            missingSteps: ['acceptance'],
            createdAt: '2026-05-31T16:00:00.000Z',
            updatedAt: '2026-05-31T16:00:00.000Z',
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; taskId?: string; severity?: string }>
    }
    const relevant = (body.items ?? []).filter(item =>
      item.taskId === 'task-thin' || item.taskId === 'task-blocked',
    )

    expect(relevant.map(item => item.kind)).toEqual(['spec_fill_pending'])
    expect(relevant.map(item => item.severity)).toEqual(['low'])
  })

  it('describes project-understanding reconciliation without implying Git is missing', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'workspace-goals.json'),
      JSON.stringify({ goals: [{ id: 'goal-1', title: 'Existing imported plan' }] }, null, 2),
      'utf8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; title?: string; detail?: string; actionHref?: string }>
    }
    const item = body.items?.find(candidate => candidate.kind === 'project_understanding')

    expect(item).toMatchObject({
      title: 'Review project discovery update',
      detail: 'Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.',
      actionHref: '/workspace-import?mode=reconcile',
    })
    expect(`${item?.title ?? ''} ${item?.detail ?? ''}`).not.toMatch(/missing repo evidence/i)
  })

  it('keeps thread-owned approvals and questions out of the needs-you inbox snapshot', async () => {
    await fs.writeFile(
      path.join(tmpDir, '.guildhall', 'TASKS.json'),
      JSON.stringify({
        version: 1,
        lastUpdated: '2026-05-31T15:00:00.000Z',
        tasks: [
          {
            id: 'task-spec',
            title: 'Approve the spec draft',
            status: 'spec_review',
            spec: 'Draft spec',
            escalations: [],
            openQuestions: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:05:00.000Z',
          },
          {
            id: 'task-question',
            title: 'Pick a scope',
            status: 'exploring',
            productBrief: {
              userJob: 'Ship the thing.',
              successMetric: 'The thing works.',
            },
            openQuestions: [
              {
                id: 'q-1',
                kind: 'text',
                askedBy: 'coordinator',
                askedAt: '2026-05-31T14:10:00.000Z',
                prompt: 'Which scope should Guildhall use?',
              },
            ],
            escalations: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:10:00.000Z',
          },
          {
            id: 'task-thin',
            title: 'Fill in acceptance criteria',
            status: 'ready',
            productBrief: {
              userJob: 'Use the task.',
              successMetric: 'Task works.',
              approvedAt: '2026-05-31T14:00:00.000Z',
            },
            acceptanceCriteria: [],
            openQuestions: [],
            escalations: [],
            createdAt: '2026-05-31T14:00:00.000Z',
            updatedAt: '2026-05-31T14:20:00.000Z',
          },
        ],
      }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items?: Array<{ kind?: string; taskId?: string }>
      history?: Array<{ kind?: string; taskId?: string }>
    }

    expect(body.items?.some(item => item.kind === 'spec_approval' || item.kind === 'agent_question_pending')).toBe(false)
    expect(body.items?.some(item => item.kind === 'spec_fill_pending' && item.taskId === 'task-thin')).toBe(true)
    expect(body.history?.some(item => item.kind === 'spec_approval' || item.kind === 'agent_question_pending')).toBe(false)
  })
})

describe('GET /api/project — bootstrap status', () => {
  it('includes the last bootstrap run status so the shell can explain async start failures', async () => {
    const bootstrapPath = path.join(getProjectLocalHistoryDir(tmpDir), 'bootstrap.json')
    await fs.writeFile(
      bootstrapPath,
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

    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      bootstrapStatus?: { success?: boolean; steps?: Array<{ command?: string; result?: string }> }
    }
    expect(body.bootstrapStatus?.success).toBe(false)
    expect(body.bootstrapStatus?.steps?.[0]?.command).toBe('pnpm run build')
    expect(body.bootstrapStatus?.steps?.[0]?.result).toBe('fail')
  })

  it('includes the same inbox snapshot as /api/project/inbox', async () => {
    const tasksPath = path.join(tmpDir, '.guildhall', 'TASKS.json')
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
    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.status).toBe(200)
    const projectBody = (await projectRes.json()) as {
      inbox?: {
        items?: Array<{ kind?: string; taskId?: string }>
        blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
      }
    }

    const inboxRes = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(inboxRes.status).toBe(200)
    const inboxBody = (await inboxRes.json()) as {
      items?: Array<{ kind?: string; taskId?: string }>
      blockers?: { bootstrap?: boolean; workspaceImport?: boolean }
    }

    expect(projectBody.inbox).toEqual(inboxBody)
    expect(projectBody.inbox?.items?.some(item => item.kind === 'spec_approval' && item.taskId === 'task-1')).toBe(false)
  })

  it('marks dynamic project payloads as non-cacheable', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const projectRes = await app.fetch(new Request(scoped('/api/project')))
    expect(projectRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(projectRes.headers.get('pragma')).toBe('no-cache')

    const inboxRes = await app.fetch(new Request(scoped('/api/project/inbox')))
    expect(inboxRes.headers.get('cache-control')).toBe('no-store, no-cache, must-revalidate')
    expect(inboxRes.headers.get('pragma')).toBe('no-cache')
  })

  it('includes a structural map review summary for owner review', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages', 'core'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'packages', 'editor'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'settings-test',
        private: true,
        workspaces: ['packages/*'],
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({
        name: '@settings/core',
        scripts: { test: 'vitest run' },
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'editor', 'package.json'),
      JSON.stringify({
        name: '@settings/editor',
        dependencies: { '@settings/core': 'workspace:*' },
      }, null, 2),
      'utf8',
    )
    const draft = await draftStructuralMap({
      projectId: PROJECT_ID,
      projectRoot: tmpDir,
      now: '2026-06-01T12:00:00.000Z',
    })
    const review = await submitStructuralMapForReview({
      projectRoot: tmpDir,
      mapId: draft.id,
      actor: 'coordinator',
      now: '2026-06-01T12:01:00.000Z',
    })
    await acceptStructuralMap({
      projectRoot: tmpDir,
      mapId: review.id,
      actor: 'owner',
      now: '2026-06-01T12:02:00.000Z',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const res = await app.fetch(new Request(scoped('/api/project')))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      structuralMapReview?: {
        state?: string
        counts?: Record<string, number>
        packages?: Array<{ id: string; label: string }>
        domains?: Array<{ id: string; label: string }>
        executableUnits?: Array<{ id: string; command?: string }>
        gitRoots?: Array<{ path: string }>
        questions?: Array<{ id: string; prompt: string }>
      }
    }

    expect(body.structuralMapReview?.state).toBe('accepted')
    expect(body.structuralMapReview?.counts?.packages).toBe(2)
    expect(body.structuralMapReview?.packages?.map(item => item.label)).toEqual(expect.arrayContaining(['@settings/core', '@settings/editor']))
    expect(body.structuralMapReview?.domains?.some(item => item.id.startsWith('domain:'))).toBe(true)
    expect(body.structuralMapReview?.executableUnits?.some(item => item.command === 'npm --workspace @settings/core run test')).toBe(true)
    expect(body.structuralMapReview?.gitRoots?.[0]?.path).toBe('.')
    expect(body.structuralMapReview?.questions?.length).toBeGreaterThan(0)
  })

  it('applies structural map review actions through the owning project endpoint', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages', 'core'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'settings-test',
        private: true,
        workspaces: ['packages/*'],
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@settings/core' }, null, 2),
      'utf8',
    )
    const draft = await draftStructuralMap({
      projectId: PROJECT_ID,
      projectRoot: tmpDir,
      now: '2026-06-01T12:10:00.000Z',
    })
    const review = await submitStructuralMapForReview({
      projectRoot: tmpDir,
      mapId: draft.id,
      actor: 'coordinator',
      now: '2026-06-01T12:11:00.000Z',
    })

    const { app } = buildServeApp({ projectPath: tmpDir })
    const rename = await app.fetch(new Request(scoped('/api/project/structural-map/action'), {
      method: 'POST',
      body: JSON.stringify({
        mapId: review.id,
        action: { kind: 'rename_node', nodeId: 'domain:core', label: 'Core runtime' },
      }),
    }))
    expect(rename.status).toBe(200)
    const renameBody = (await rename.json()) as { structuralMapReview?: { domains?: Array<{ label?: string }> } }
    expect(renameBody.structuralMapReview?.domains?.map(item => item.label)).toContain('Core runtime')

    const accept = await app.fetch(new Request(scoped('/api/project/structural-map/action'), {
      method: 'POST',
      body: JSON.stringify({
        mapId: review.id,
        action: { kind: 'accept' },
      }),
    }))
    expect(accept.status).toBe(200)
    const acceptBody = (await accept.json()) as { structuralMapReview?: { state?: string } }
    expect(acceptBody.structuralMapReview?.state).toBe('accepted')
  })

  it('serves the scoped local project graph view for the selected project', async () => {
    const providerDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-settings-provider-'))
    try {
      bootstrapWorkspace(providerDir, { id: 'looma', name: 'Looma' })
      await createProjectDependencyRequest({
        consumerProject: { id: PROJECT_ID, path: tmpDir, label: 'Settings Test' },
        providerProject: { id: 'looma', path: providerDir, label: 'Looma' },
        domain: { id: 'domain:editor', label: 'Editor' },
        consumerNeed: 'Settings Test needs an editor adapter.',
        rationale: 'The editor domain is provider-owned by Looma.',
        requestedBy: 'coordinator:settings-test',
        expectedDelivery: {
          format: 'Svelte editor adapter',
          channel: 'npm dev tag',
          consumerVerificationPlan: ['Run settings-test editor integration.'],
        },
        now: '2026-06-01T12:20:00.000Z',
      })

      const { app } = buildServeApp({ projectPath: tmpDir })
      const res = await app.fetch(new Request(scoped('/api/project/project-graph')))
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        projectGraph?: {
          localProjects?: Array<{ id?: string; role?: string }>
          authorityRoots?: Array<{ projectId?: string; domainId?: string }>
          unresolvedRequests?: Array<{ waitingOn?: string }>
        }
      }
      expect(body.projectGraph?.localProjects).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: PROJECT_ID, role: 'current' }),
        expect.objectContaining({ id: 'looma', role: 'provider' }),
      ]))
      expect(body.projectGraph?.authorityRoots).toContainEqual(expect.objectContaining({
        projectId: 'looma',
        domainId: 'domain:editor',
      }))
      expect(body.projectGraph?.unresolvedRequests).toContainEqual(expect.objectContaining({
        waitingOn: 'provider',
      }))
    } finally {
      await fs.rm(providerDir, { recursive: true, force: true })
    }
  })
})
