import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { getProjectLocalHistoryDir, getProjectRuntimeCommandEvidencePath } from '@guildhall/sessions'
import {
  applyProjectMigrations,
  getProjectMigrationStatus,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from '../migrations.js'

let tmp: string
let projectRoot: string
let previousConfigDir: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-migrations-'))
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmp, 'config')
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  await fs.mkdir(projectRoot, { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), 'name: Migration Test\nid: migration-test\n', 'utf8')
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await fs.rm(tmp, { recursive: true, force: true })
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
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'migrations.json'))).rejects.toThrow()
    await expect(fs.access(path.join(getProjectLocalHistoryDir(projectRoot), 'migrations', 'migrations.json'))).resolves.toBeUndefined()
  })
})

describe('getProjectMigrationStatus', () => {
  it('reports pending built-in project migrations and hides applied ledger entries', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)

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
    expect(after.blocked.some(item => item.id === '0.8.0/project-state-layout')).toBe(false)
    expect(after.applied.some(item => item.id === '0.8.0/project-state-layout')).toBe(true)
  })
})

describe('applyProjectMigrations', () => {
  it('applies automatic migrations but leaves prompt migrations pending by default', async () => {
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'config.yaml'), [
      'openaiApiKey: sk-local',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

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

  it('applies required merge_policy conversion into landing_strategy', async () => {
    const settingsPath = path.join(projectRoot, '.guildhall', 'agent-settings.yaml')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, [
      'version: 1',
      'project:',
      '  merge_policy:',
      '    position: ff_only_local',
      '    rationale: legacy local-only landing',
      '    setAt: "2026-05-31T00:00:00.000Z"',
      '    setBy: user-direct',
      'domains:',
      '  default: {}',
      '  overrides: {}',
      '',
    ].join('\n'), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/merge-policy-to-landing-strategy')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/merge-policy-to-landing-strategy'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/merge-policy-to-landing-strategy')).toBe(true)
    const updated = parseYaml(await fs.readFile(settingsPath, 'utf8')) as Record<string, any>
    expect(updated.project.merge_policy).toBeUndefined()
    expect(updated.project.landing_strategy).toMatchObject({
      position: 'cherry_pick_local',
      rationale: 'legacy local-only landing',
      setBy: 'user-direct',
    })
  })

  it('clears repo-local Guildhall state when applying the layout migration without thin opt-in', async () => {
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')

    await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    await expect(fs.access(path.join(projectRoot, '.guildhall'))).rejects.toThrow()
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'MEMORY.md'),
      'utf8',
    )).resolves.toContain('# Legacy')
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'migrations', 'migrations.json'),
      'utf8',
    )).resolves.toContain('0.8.0/project-state-layout')
  })

  it('writes only the current thin manifest when thin repo state is explicitly opted in', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Migration Test',
      'id: migration-test',
      'storage:',
      '  repoState: thin',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'memory', 'MEMORY.md'), '# Legacy\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, 'memory', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-current',
        title: 'Current work',
        description: 'Resume me.',
        domain: 'runtime',
        projectPath: projectRoot,
        status: 'ready',
        spec: 'Current thin state includes the resumable task.',
        acceptanceCriteria: [{ id: 'ac-1', description: 'Resume packet exists.', verifiedBy: 'review', met: false }],
        notes: [{ content: 'old audit note should not export' }],
      }],
    }, null, 2), 'utf8')

    await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.8.0/project-state-layout'],
    })

    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.guildhall', 'project-state-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      version: 1,
      mode: 'thin',
      projectId: 'migration-test',
      projectName: 'Migration Test',
      currentShape: {
        artifacts: ['flow-audit'],
        activeTasks: [expect.objectContaining({
          id: 'task-current',
          title: 'Current work',
          status: 'ready',
          spec: 'Current thin state includes the resumable task.',
        })],
      },
      exports: {
        artifactRegistry: {
          path: '.guildhall/artifacts.yaml',
          artifactIds: ['flow-audit'],
        },
      },
    })
    expect(JSON.stringify(manifest)).not.toContain('old audit note')
    expect(JSON.stringify(manifest)).not.toContain('project-state-evacuation')
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'TASKS.json'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'MEMORY.md'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'DECISIONS.md'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'PROGRESS.md'))).rejects.toThrow()
  })

  it('evacuates stale repo-local Guildhall state through the storage-boundary migration', async () => {
    await fs.mkdir(path.join(projectRoot, '.guildhall', 'tasks'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'agent-settings.yaml'), 'version: 1\n', 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-stale', title: 'Stale state', status: 'ready', notes: [{ content: 'history' }] }],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/project-state-storage-boundary'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)
    await expect(fs.access(path.join(projectRoot, '.guildhall'))).rejects.toThrow()
    await expect(fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json'),
      'utf8',
    )).resolves.toContain('task-stale')

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(false)
  })

  it('rewrites stale thin repo state into only the current-shape manifest', async () => {
    await fs.writeFile(path.join(projectRoot, 'guildhall.yaml'), [
      'name: Migration Test',
      'id: migration-test',
      'storage:',
      '  repoState: thin',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'artifacts.yaml'), [
      'version: 1',
      'artifacts:',
      '  - id: flow-audit',
      '    path: internal/audits/flow-audit.md',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{
        id: 'task-thin',
        title: 'Thin resumable work',
        status: 'ready',
        spec: 'Enough information to continue.',
        notes: [{ content: 'not exported' }],
      }],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'MEMORY.md'), '# Old memory\n', 'utf8')

    const result = await applyProjectMigrations({
      projectRoot,
      includePrompt: true,
      only: ['0.10.0/project-state-storage-boundary'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/project-state-storage-boundary')).toBe(true)
    const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, '.guildhall', 'project-state-manifest.json'), 'utf8')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      mode: 'thin',
      currentShape: {
        artifacts: ['flow-audit'],
        activeTasks: [expect.objectContaining({
          id: 'task-thin',
          title: 'Thin resumable work',
          status: 'ready',
          spec: 'Enough information to continue.',
        })],
      },
    })
    expect(JSON.stringify(manifest)).not.toContain('not exported')
    expect(JSON.stringify(manifest)).not.toContain('Old memory')
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'artifacts.yaml'))).resolves.toBeUndefined()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'TASKS.json'))).rejects.toThrow()
    await expect(fs.access(path.join(projectRoot, '.guildhall', 'MEMORY.md'))).rejects.toThrow()
  })

  it('automatically migrates legacy runtime command JSONL into persistence', async () => {
    const legacyFile = getProjectRuntimeCommandEvidencePath(projectRoot)
    await fs.mkdir(path.dirname(legacyFile), { recursive: true })
    await fs.writeFile(legacyFile, `${JSON.stringify({
      id: 'cmd-legacy',
      projectId: 'migration-test',
      taskId: 'task-legacy',
      request: {
        projectId: 'migration-test',
        cwd: '/workspace/migration-test',
        argv: ['node', '--version'],
        env: {},
        timeoutMs: 5_000,
        expectedPorts: [],
        taskId: 'task-legacy',
      },
      runtime: { id: null, containerId: null },
      status: 'exited',
      exitCode: 0,
      startedAt: '2026-05-27T19:00:00.000Z',
      completedAt: '2026-05-27T19:00:01.000Z',
      events: [],
      error: null,
    })}\n`, 'utf8')

    const result = await applyProjectMigrations({ projectRoot, includePrompt: false })

    expect(result.applied.some(item => item.id === '0.9.0/runtime-command-evidence-persistence')).toBe(true)
    await expect(fs.stat(legacyFile)).rejects.toMatchObject({ code: 'ENOENT' })
    const persistence = new FileBackedGuildhallPersistence()
    const events = await persistence.listEvents({
      projectRoot,
      placement: {
        scope: 'local_history',
        retention: 'active',
        visibility: 'internal_audit',
        commitPolicy: 'ignored',
      },
      collection: 'runtime-command-evidence',
      streamId: 'task-legacy',
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toMatchObject({
      id: 'cmd-legacy',
      projectId: 'migration-test',
      taskId: 'task-legacy',
    })
  })
})
