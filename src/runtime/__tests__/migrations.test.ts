import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'
import { getProjectLocalHistoryDir, getProjectRuntimeCommandEvidencePath, getProjectSystemStatePath } from '@guildhall/sessions'
import {
  applyProjectMigrations,
  getProjectMigrationStatus,
  readProjectMigrationLedger,
  writeProjectMigrationLedger,
} from '../migrations.js'
import { createOwnerInputRequest } from '../owner-input-store.js'

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

  it('reports legacy split recommendation migration as required when task state needs action audit', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-06-17T00:00:00.000Z',
      tasks: [{
        id: 'parent',
        title: 'Parent',
        sizePlan: {
          action: 'split_recommended',
          recommendedChildren: [{ title: 'Child A', reason: 'Legacy child.' }],
        },
      }],
    }, null, 2), 'utf8')

    const status = await getProjectMigrationStatus({ projectRoot })
    expect(status.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '0.11.0/execution-planning-decomposition',
        requirement: 'required',
      }),
    ]))
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

  it('repairs source-trail owner-input lead-ins even when the original owner-input repair already ran', async () => {
    const now = '2026-07-06T08:30:00.000Z'
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: now,
      tasks: [{
        id: 'task-templates',
        title: 'Templates',
        description: 'Legacy imported task.',
        domain: 'product',
        projectPath: projectRoot,
        status: 'ready',
        priority: 'normal',
        notes: [],
      }],
    }, null, 2), 'utf8')
    const created = await createOwnerInputRequest({
      projectRoot,
      projectId: 'migration-test',
      commandId: 'test:source-trail-leadin',
      now,
      actor: 'test',
      source: { kind: 'task', taskId: 'task-templates', questionId: 'q-templates' },
      target: { kind: 'thread' },
      question: {
        prompt: 'Should Templates stay in the current release scope?',
        choices: ['Keep Templates in the current release', 'Defer Templates'],
      },
      objective: {
        kind: 'task_shaping',
        label: 'Clarify Templates',
        successCriteria: ['Owner answers the linked bounded-chat session.'],
      },
    })
    await rewriteOwnerInputPrompt(projectRoot, created.request.id, {
      prompt: "From what I've seen:",
      choices: [
        '`features.md` line 59: `- [ ] Templates` - unchecked, under "Organization & Structure"',
        'The roadmap does not list Templates as a priority parity gap',
      ],
    })
    await writeProjectMigrationLedger(projectRoot, {
      version: 1,
      records: [{
        id: '0.10.0/owner-input-state-repair',
        introducedIn: '0.10.0',
        scope: 'project',
        safety: 'prompt',
        status: 'applied',
        appliedAt: now,
        appliedByVersion: '0.10.0',
        summary: 'Original owner-input repair already ran.',
      }],
    })

    const before = await getProjectMigrationStatus({
      projectRoot,
      only: ['0.10.1/owner-input-source-trail-leadin-repair'],
    })
    expect(before.blocked.map(item => item.id)).toEqual(['0.10.1/owner-input-source-trail-leadin-repair'])

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/owner-input-source-trail-leadin-repair'],
    })

    expect(result.applied.map(item => item.id)).toEqual(['0.10.1/owner-input-source-trail-leadin-repair'])
    const request = JSON.parse(await fs.readFile(
      getProjectSystemStatePath(projectRoot, path.join('owner-input', `${created.request.id}.json`)),
      'utf8',
    ))
    expect(request.status).toBe('cancelled')
    expect(JSON.stringify(request.receipts)).toContain('0.10.1/owner-input-source-trail-leadin-repair')
  })

  it('normalizes verification child tasks into explicit delivery-step metadata', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-06-12T00:00:00.000Z',
      tasks: [
        {
          id: 'task-import-review',
          title: 'Import review flow',
          description: 'Review imported project material.',
          domain: 'project',
          projectPath: projectRoot,
          status: 'ready',
          priority: 'normal',
          hierarchy: { childIds: ['task-runtime-proof'] },
        },
        {
          id: 'task-runtime-proof',
          title: 'Runtime proof',
          description: 'Prove the import review flow.',
          domain: 'project',
          projectPath: projectRoot,
          status: 'blocked',
          priority: 'normal',
          workKind: 'verification',
          hierarchy: { parentId: 'task-import-review', order: 0 },
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot, only: ['0.10.0/task-delivery-steps'] })
    expect(before.pending.map(item => item.id)).toContain('0.10.0/task-delivery-steps')

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/task-delivery-steps'],
    })

    expect(result.applied.map(item => item.id)).toContain('0.10.0/task-delivery-steps')
    const updated = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as { tasks: Array<Record<string, any>> }
    const parent = updated.tasks.find(task => task.id === 'task-import-review')
    const child = updated.tasks.find(task => task.id === 'task-runtime-proof')
    expect(child?.workVisibility).toMatchObject({ kind: 'internal_step', countInProjectTotals: false })
    expect(parent?.deliverySteps).toEqual([
      expect.objectContaining({
        id: 'task:task-runtime-proof',
        title: 'Runtime proof',
        kind: 'verify',
        status: 'blocked',
        sourceTaskId: 'task-runtime-proof',
      }),
    ])
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

  it('restores stranded evacuated task state into the system-local queue', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-workspace-import', title: 'Review existing project work', status: 'done' },
        { id: 'task-context-menu', title: 'ContextMenu', status: 'done' },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-listbox', title: 'Listbox', status: 'spec_review' },
        { id: 'task-context-menu', title: 'ContextMenu', status: 'ready' },
      ],
    }, null, 2), 'utf8')
    const evacuatedIndexPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'index.json')
    const evacuatedArchivePath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'tasks', 'archive', 'task-done.json')
    await fs.mkdir(path.dirname(evacuatedArchivePath), { recursive: true })
    await fs.writeFile(evacuatedIndexPath, JSON.stringify({
      activeTaskIds: ['task-listbox'],
      archivedTaskIds: ['task-done'],
    }, null, 2), 'utf8')
    await fs.writeFile(evacuatedArchivePath, JSON.stringify({
      id: 'task-done',
      title: 'Readable completed task',
      status: 'done',
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)
    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as { tasks: Array<{ id: string; title: string; status: string }> }
    expect(restored.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-listbox', title: 'Listbox', status: 'spec_review' }),
      expect.objectContaining({ id: 'task-context-menu', title: 'ContextMenu', status: 'done' }),
      expect.objectContaining({ id: 'task-workspace-import', title: 'Review existing project work', status: 'done' }),
    ]))
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/index.json'), 'utf8'))
      .resolves.toContain('task-listbox')
    await expect(fs.readFile(getProjectSystemStatePath(projectRoot, 'tasks/archive/task-done.json'), 'utf8'))
      .resolves.toContain('Readable completed task')
  })

  it('restores evacuated release containers even when task records already exist', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-knit-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'spec_review',
          releaseIds: ['stage-1-v1-release-hardening'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      selectedReleaseId: 'stage-1-v1-release-hardening',
      releases: [{
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-knit-unit-tests'],
        deferredNodeIds: ['work:task-looma-editor-integration'],
      }],
      tasks: [
        {
          id: 'task-knit-unit-tests',
          title: 'Unit tests: use-collections, use-presence, subdomain utils',
          status: 'spec_review',
          releaseIds: ['stage-1-v1-release-hardening'],
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)

    const result = await applyProjectMigrations({
      projectRoot,
      only: ['0.10.0/restore-evacuated-task-state'],
    })

    expect(result.applied.some(item => item.id === '0.10.0/restore-evacuated-task-state')).toBe(true)
    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      selectedReleaseId?: string
      releases?: Array<{ id: string; label: string; deferredNodeIds?: string[] }>
      tasks: Array<{ id: string }>
    }
    expect(restored.selectedReleaseId).toBe('stage-1-v1-release-hardening')
    expect(restored.releases).toEqual([
      expect.objectContaining({
        id: 'stage-1-v1-release-hardening',
        label: 'Stage 1: V1 Release Hardening',
        deferredNodeIds: ['work:task-looma-editor-integration'],
      }),
    ])
    expect(restored.tasks).toEqual([
      expect.objectContaining({ id: 'task-knit-unit-tests' }),
    ])
  })

  it('restores richer evacuated task shape over hollow same-id imported drafts', async () => {
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    const fullTitle = 'Block menu / block side menu supports generic Looma blocks and Knit-specific actions.'
    const croppedTitle = 'Block menu / block side menu supports generic Looma blocks and Knit-specific'
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-block-menu',
          title: croppedTitle,
          description: `docs/editor-roadmap.md: - ${fullTitle}`,
          status: 'import_draft',
          scope: 'current',
          releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
          references: ['docs/editor-roadmap.md'],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-block-menu',
          title: croppedTitle,
          description: `docs/editor-roadmap.md: - ${fullTitle}`,
          status: 'ready',
          spec: '## Summary\nBuild the block menu and side menu primitives.',
          productBrief: {
            status: 'approved',
            productOutcome: 'Knit can use a generic Looma block menu primitive.',
            successMetric: 'Block menu primitive is specified and ready for implementation.',
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'Block menu primitive has a ready implementation spec.', verifiedBy: 'review', met: false },
          ],
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/restore-evacuated-shaped-task-state')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{
        id: string
        title: string
        status: string
        spec?: string
        productBrief?: { productOutcome?: string }
        acceptanceCriteria?: Array<{ id: string }>
        releaseIds?: string[]
        references?: string[]
      }>
    }
    expect(restored.tasks).toHaveLength(1)
    expect(restored.tasks[0]).toEqual(expect.objectContaining({
      id: 'task-import-block-menu',
      title: fullTitle,
      status: 'ready',
      spec: expect.stringContaining('Build the block menu'),
      productBrief: expect.objectContaining({
        productOutcome: 'Knit can use a generic Looma block menu primitive.',
      }),
      acceptanceCriteria: [expect.objectContaining({ id: 'ac-1' })],
      releaseIds: ['stage-1-finish-knit-primitive-replacement-wave'],
      references: ['docs/editor-roadmap.md'],
    }))
  })

  it('repairs clipped shaped task titles left behind after evacuated state restoration', async () => {
    const fullTitle = 'Continue the Knit-to-Looma promotion work into the next generic surfaces while primitive normalization continues.'
    const croppedTitle = 'Continue the Knit-to-Looma promotion work into the next generic surfaces while'
    const systemTasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(systemTasksPath), { recursive: true })
    await fs.writeFile(systemTasksPath, JSON.stringify({
      version: 1,
      tasks: [
        {
          id: 'task-import-next-wave',
          title: croppedTitle,
          description: `looma/PROJECT_STATE.md: 3. ${fullTitle}`,
          status: 'spec_review',
          spec: `## Summary\nBuild ${croppedTitle} from the current evidence.`,
          productBrief: {
            productOutcome: 'The next promotion wave is shaped.',
          },
          acceptanceCriteria: [
            { id: 'ac-1', description: 'The wave has acceptance criteria.', verifiedBy: 'review', met: false },
          ],
        },
      ],
    }, null, 2), 'utf8')
    const evacuatedTasksPath = path.join(getProjectLocalHistoryDir(projectRoot), 'project-state-evacuation', 'TASKS.json')
    await fs.mkdir(path.dirname(evacuatedTasksPath), { recursive: true })
    await fs.writeFile(evacuatedTasksPath, JSON.stringify({ version: 1, tasks: [] }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/restore-evacuated-shaped-task-state')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/restore-evacuated-shaped-task-state'],
    })

    const restored = JSON.parse(await fs.readFile(systemTasksPath, 'utf8')) as {
      tasks: Array<{ id: string; title: string; status: string }>
    }
    expect(restored.tasks).toEqual([
      expect.objectContaining({
        id: 'task-import-next-wave',
        title: fullTitle,
        status: 'spec_review',
      }),
    ])
  })

  it('attaches recovered current-scope owner requirement work to the selected release', async () => {
    const tasksPath = getProjectSystemStatePath(projectRoot, 'TASKS.json')
    await fs.mkdir(path.dirname(tasksPath), { recursive: true })
    await fs.writeFile(tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2026-07-06T09:00:00.000Z',
      tasks: [
        {
          id: 'task-import-fixture',
          title: 'Add the first tiny fiction fixture and human-authored expected records.',
          status: 'done',
          releaseIds: ['stage-1-fixture-and-evaluation-harness'],
        },
        {
          id: 'task-150',
          title: 'Define Narrative Harness MVP drafting model and physical-world review lanes',
          status: 'done',
          releaseIds: [],
          hierarchy: {
            childIds: [
              'task-150-split-select-and-prove-deepinfra-drafting-model',
              'task-150-split-define-world-state-continuity-review-lane',
              'task-150-split-define-spatial-geographic-continuity-review-lane',
            ],
            relation: 'contains',
          },
        },
        {
          id: 'task-150-split-select-and-prove-deepinfra-drafting-model',
          title: 'Select and prove DeepInfra drafting model',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 0, relation: 'decomposes' },
        },
        {
          id: 'task-150-split-define-world-state-continuity-review-lane',
          title: 'Define world-state continuity review lane',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 1, relation: 'decomposes' },
        },
        {
          id: 'task-150-split-define-spatial-geographic-continuity-review-lane',
          title: 'Define spatial/geographic continuity review lane',
          status: 'done',
          releaseIds: [],
          hierarchy: { parentId: 'task-150', childIds: [], order: 2, relation: 'decomposes' },
        },
      ],
    }, null, 2), 'utf8')

    const before = await getProjectMigrationStatus({ projectRoot })
    expect(before.blocked.some(item => item.id === '0.10.1/attach-recovered-current-scope-work-to-selected-release')).toBe(true)

    await applyProjectMigrations({
      projectRoot,
      only: ['0.10.1/attach-recovered-current-scope-work-to-selected-release'],
    })

    const repaired = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as {
      tasks: Array<{ id: string; releaseIds?: string[] }>
      selectedReleaseId?: string
      releases: Array<{ id: string; nodeIds?: string[] }>
    }
    expect(repaired.selectedReleaseId).toBe('stage-1-fixture-and-evaluation-harness')
    for (const task of repaired.tasks.filter(task => task.id.startsWith('task-150'))) {
      expect(task.releaseIds).toEqual(['stage-1-fixture-and-evaluation-harness'])
    }
    expect(repaired.releases[0]?.nodeIds).toEqual([
      'work:task-import-fixture',
      'work:task-150',
      'work:task-150-split-select-and-prove-deepinfra-drafting-model',
      'work:task-150-split-define-world-state-continuity-review-lane',
      'work:task-150-split-define-spatial-geographic-continuity-review-lane',
    ])

    const after = await getProjectMigrationStatus({ projectRoot })
    expect(after.blocked.some(item => item.id === '0.10.1/attach-recovered-current-scope-work-to-selected-release')).toBe(false)
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

async function rewriteOwnerInputPrompt(
  root: string,
  requestId: string,
  patch: { prompt: string; choices?: string[] },
): Promise<void> {
  const requestFile = getProjectSystemStatePath(root, path.join('owner-input', `${requestId}.json`))
  const request = JSON.parse(await fs.readFile(requestFile, 'utf8'))
  request.prompt = patch.prompt
  if (patch.choices === undefined) delete request.choices
  else request.choices = patch.choices
  await fs.writeFile(requestFile, `${JSON.stringify(request, null, 2)}\n`, 'utf8')

  const sessionFile = getProjectSystemStatePath(root, path.join('bounded-chat', `${request.boundedChatSessionId}.json`))
  const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'))
  session.subObjectives[0].prompt = patch.prompt
  if (patch.choices === undefined) delete session.subObjectives[0].choices
  else session.subObjectives[0].choices = patch.choices
  await fs.writeFile(sessionFile, `${JSON.stringify(session, null, 2)}\n`, 'utf8')
}
