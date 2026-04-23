import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import {
  createWorkspaceImportTask,
  workspaceNeedsImport,
  approveWorkspaceImport,
  parseWorkspaceImport,
  maybeSeedWorkspaceImport,
  WORKSPACE_IMPORT_TASK_ID,
  WORKSPACE_IMPORT_DOMAIN,
} from '../workspace-importer.js'
import type { WorkspaceInventory } from '../workspace-import/detect.js'
import type { WorkspaceSignal } from '../workspace-import/types.js'

let tmpDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ws-import-'))
  bootstrapWorkspace(tmpDir, { name: 'Import Test' })
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

function invWith(signals: WorkspaceSignal[]): WorkspaceInventory {
  const bySource: Record<string, WorkspaceSignal[]> = {}
  const ran = new Set<string>()
  for (const s of signals) {
    ran.add(s.source)
    ;(bySource[s.source] ??= []).push(s)
  }
  return { signals, bySource, ran: [...ran], failed: [] }
}

const sampleInventory = (): WorkspaceInventory =>
  invWith([
    {
      source: 'readme',
      kind: 'goal',
      title: 'Ship multi-agent orchestrator',
      evidence: 'first line of README',
      confidence: 'high',
    },
    {
      source: 'roadmap',
      kind: 'open_work',
      title: 'Wire dashboard card',
      evidence: '- [ ] Wire dashboard card',
      confidence: 'high',
    },
    {
      source: 'git-log',
      kind: 'milestone',
      title: 'Ship v0.1.0',
      evidence: 'abc12345 Ship v0.1.0',
      confidence: 'high',
      references: ['abc12345'],
    },
  ])

describe('createWorkspaceImportTask', () => {
  it('seeds the reserved importer task with id + domain', async () => {
    const res = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.alreadyExists).toBe(false)
    expect(res.taskId).toBe(WORKSPACE_IMPORT_TASK_ID)

    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)
    expect(task).toBeDefined()
    expect(task!.domain).toBe(WORKSPACE_IMPORT_DOMAIN)
    expect(task!.status).toBe('exploring')
    expect(task!.origination).toBe('system')
    expect(task!.priority).toBe('high')
  })

  it('is idempotent — a second call does not create a duplicate', async () => {
    const inv = sampleInventory()
    await createWorkspaceImportTask({ memoryDir, projectPath: tmpDir, inventory: inv })
    const again = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: inv,
    })
    expect(again.alreadyExists).toBe(true)
    const q = await readQueue()
    const count = q.tasks.filter((t) => t.id === WORKSPACE_IMPORT_TASK_ID).length
    expect(count).toBe(1)
  })

  it('writes the inventory summary + draft into the exploring transcript', async () => {
    const res = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const content = await fs.readFile(res.transcriptPath, 'utf-8')
    expect(content).toContain('Detected inventory summary')
    expect(content).toContain('Draft goals')
    expect(content).toContain('Ship multi-agent orchestrator')
    expect(content).toContain('Draft tasks')
    expect(content).toContain('Wire dashboard card')
    expect(content).toContain('Draft milestones')
    expect(content).toContain('Ship v0.1.0')
    // Seed includes the output-format instructions for the agent.
    expect(content).toContain('Output format')
    expect(content).toContain('goals:')
    expect(content).toContain('tasks:')
    expect(content).toContain('milestones:')
  })

  it('returns the computed inventory + draft to callers even when idempotent', async () => {
    const first = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(first.draft.tasks).toHaveLength(1)
    expect(first.draft.goals).toHaveLength(1)

    const second = await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(second.alreadyExists).toBe(true)
    expect(second.draft.tasks).toHaveLength(1)
    expect(second.draft.goals).toHaveLength(1)
  })
})

describe('workspaceNeedsImport', () => {
  it('returns needed=true when workspace has signals and no user tasks', async () => {
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.needed).toBe(true)
    expect(res.draft.tasks.length).toBeGreaterThan(0)
  })

  it('returns needed=false when the inventory is empty', async () => {
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: invWith([]),
    })
    expect(res.needed).toBe(false)
  })

  it('returns needed=false once any user task exists', async () => {
    // Write a non-meta task directly into the queue.
    const q = await readQueue()
    const now = new Date().toISOString()
    q.tasks.push({
      id: 'user-1',
      title: 'manual task',
      description: 'x',
      domain: 'core',
      projectPath: tmpDir,
      status: 'ready',
      priority: 'normal',
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      reviewVerdicts: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
    })
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(q, null, 2),
    )
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    expect(res.needed).toBe(false)
  })

  it('ignores reserved _meta and _workspace_import tasks when deciding need', async () => {
    // Seed both reserved tasks — they should NOT suppress import detection.
    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const res = await workspaceNeedsImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    // After the reserved task was created the detection signal still says
    // 'needed' because the reserved task is not a user task.
    expect(res.needed).toBe(true)
  })
})

describe('parseWorkspaceImport', () => {
  it('returns empty buckets when spec has no fences', () => {
    expect(parseWorkspaceImport('hello world')).toEqual({
      goals: [],
      tasks: [],
      milestones: [],
    })
  })

  it('parses goals / tasks / milestones fences independently', () => {
    const spec = `
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
    rationale: North star per README
\`\`\`

\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: Wire dashboard card
    description: Render import preview + approve button
    domain: ui
    priority: high
    references:
      - ROADMAP.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
    evidence: abc12345
\`\`\`
`
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals).toEqual([
      { id: 'g1', title: 'Ship orchestrator', rationale: 'North star per README' },
    ])
    expect(parsed.tasks).toEqual([
      {
        id: 't-wire-dashboard',
        title: 'Wire dashboard card',
        description: 'Render import preview + approve button',
        domain: 'ui',
        priority: 'high',
        references: ['ROADMAP.md'],
      },
    ])
    expect(parsed.milestones).toEqual([
      { title: 'Ship v0.1.0', evidence: 'abc12345' },
    ])
  })

  it('falls back to normal priority and default domain on invalid values', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: t1
    title: whatever
    priority: urgent-now
\`\`\`
`)
    expect(parsed.tasks[0]!.priority).toBe('normal')
    expect(parsed.tasks[0]!.domain).toBe('core')
  })

  it('skips malformed fence entries but keeps the valid ones', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - title: no id
  - id: t-ok
    title: ok
\`\`\`
`)
    expect(parsed.tasks).toHaveLength(1)
    expect(parsed.tasks[0]!.id).toBe('t-ok')
  })
})

describe('approveWorkspaceImport', () => {
  async function seedImporterWithSpec(spec: string) {
    await createWorkspaceImportTask({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
    })
    const q = await readQueue()
    const task = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    task.spec = spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(q, null, 2),
    )
  }

  it('errors when the importer task is missing', async () => {
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('No workspace-import task')
  })

  it('errors when the spec has no parseable fences', async () => {
    await seedImporterWithSpec('just free text, no yaml fences')
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Could not find')
  })

  it('inserts tasks as proposed + origination=system, records goals + milestones', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
    rationale: README
\`\`\`

\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: Wire dashboard card
    description: do the thing
    domain: ui
    priority: high
    references:
      - ROADMAP.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
    evidence: abc12345
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res).toMatchObject({
      success: true,
      tasksAdded: 1,
      goalsRecorded: 1,
      milestonesLogged: 1,
    })

    const q = await readQueue()
    const importerTask = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    expect(importerTask.status).toBe('done')
    expect(importerTask.completedAt).toBeTypeOf('string')

    const newTask = q.tasks.find((t) => t.id === 't-wire-dashboard')!
    expect(newTask.status).toBe('proposed')
    expect(newTask.origination).toBe('system')
    expect(newTask.domain).toBe('ui')
    expect(newTask.priority).toBe('high')
    expect(newTask.notes[0]!.content).toContain('ROADMAP.md')

    const goalsRaw = await fs.readFile(
      path.join(memoryDir, 'workspace-goals.json'),
      'utf-8',
    )
    const goals = JSON.parse(goalsRaw)
    expect(goals.goals[0]).toMatchObject({
      id: 'g1',
      title: 'Ship orchestrator',
    })

    const progress = await fs.readFile(
      path.join(memoryDir, 'PROGRESS.md'),
      'utf-8',
    )
    expect(progress).toContain('Ship v0.1.0')
    expect(progress).toContain('abc12345')
    expect(progress).toContain('MILESTONE')
  })

  it('maybeSeedWorkspaceImport respects lever=off', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'off',
    })
    expect(res.seeded).toBe(false)
    expect(res.outcome).toBe('off')
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)).toBeUndefined()
  })

  it('maybeSeedWorkspaceImport seeds the reserved task on lever=suggest', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'suggest',
    })
    expect(res.seeded).toBe(true)
    expect(res.outcome).toBe('seeded')
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)).toBeDefined()
  })

  it('maybeSeedWorkspaceImport skips when no signals are found', async () => {
    const res = await maybeSeedWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      inventory: invWith([]),
      leverPosition: 'suggest',
    })
    expect(res.seeded).toBe(false)
    expect(res.outcome).toBe('not-needed')
  })

  it('maybeSeedWorkspaceImport reports already-seeded on the second run', async () => {
    const opts = {
      memoryDir,
      projectPath: tmpDir,
      inventory: sampleInventory(),
      leverPosition: 'suggest' as const,
    }
    await maybeSeedWorkspaceImport(opts)
    const second = await maybeSeedWorkspaceImport(opts)
    expect(second.outcome).toBe('already-seeded')
    expect(second.seeded).toBe(true)
  })

  // ---------------------------------------------------------------------
  // FR-34 full pipeline: real files on disk → detect → seed → approve →
  // TASKS.json populated. Every earlier test in this file mocks the
  // inventory; this one runs the real source loaders against fixture files
  // to prove the end-to-end path works on a realistic repo shape.
  // ---------------------------------------------------------------------
  it('FR-34 e2e: fixture files → detect → seed → approve populates TASKS.json', async () => {
    // Lay down a realistic "existing project" on disk.
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      [
        '# Acme Widget',
        '',
        'A widget platform for acme-flavored orchestration.',
        '',
        '## Goals',
        '',
        '- Ship the dashboard',
        '- Cut latency in half',
        '',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'ROADMAP.md'),
      [
        '# Roadmap',
        '',
        '- [ ] Wire the auth flow',
        '- [ ] Add metric exporter',
        '- [x] Initial scaffold',
        '',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'AGENTS.md'),
      '# Agents\n\nConventions: run pnpm test before every commit.\n',
      'utf-8',
    )

    // Run the full pipeline: detect happens inside maybeSeedWorkspaceImport.
    const seeded = await import('../workspace-importer.js').then((m) =>
      m.maybeSeedWorkspaceImport({
        memoryDir,
        projectPath: tmpDir,
        leverPosition: 'suggest',
      }),
    )
    expect(seeded.outcome).toBe('seeded')
    expect(seeded.seeded).toBe(true)

    // Real sources produced real signals.
    const sources = new Set(seeded.inventory.signals.map((s) => s.source))
    expect(sources.has('readme')).toBe(true)
    expect(sources.has('roadmap')).toBe(true)

    // Draft carries the ROADMAP open items as tasks and the README goal.
    expect(seeded.draft.tasks.length).toBeGreaterThan(0)
    expect(seeded.draft.goals.length).toBeGreaterThan(0)
    expect(seeded.draft.milestones.length).toBeGreaterThan(0) // `[x] Initial scaffold`

    // Importer task exists in `exploring` with origination=system.
    const qAfterSeed = await readQueue()
    const importer = qAfterSeed.tasks.find(
      (t) => t.id === WORKSPACE_IMPORT_TASK_ID,
    )!
    expect(importer.status).toBe('exploring')
    expect(importer.origination).toBe('system')

    // Simulate the importer agent promoting the draft into the YAML-fence
    // output format by building fences directly from the real draft. Using
    // the draft (rather than hand-rolled fences) is what makes this an
    // actual end-to-end proof: the data that reaches approve() is what the
    // detector + hypothesis formed from the real files.
    const yamlTaskBlock = seeded.draft.tasks
      .map((t) => {
        const lines = [
          `  - id: ${t.suggestedId}`,
          `    title: ${JSON.stringify(t.title)}`,
          `    description: ${JSON.stringify(t.description)}`,
          `    domain: ${t.domain}`,
          `    priority: ${t.priority}`,
        ]
        const refs = t.references ?? []
        if (refs.length) {
          lines.push('    references:')
          for (const ref of refs) lines.push(`      - ${JSON.stringify(ref)}`)
        }
        return lines.join('\n')
      })
      .join('\n')
    const yamlGoalBlock = seeded.draft.goals
      .map(
        (g) =>
          `  - id: ${g.id}\n    title: ${JSON.stringify(g.title)}\n    rationale: ${JSON.stringify(g.rationale)}`,
      )
      .join('\n')
    const yamlMilestoneBlock = seeded.draft.milestones
      .map(
        (m) =>
          `  - title: ${JSON.stringify(m.title)}\n    evidence: ${JSON.stringify(m.evidence)}`,
      )
      .join('\n')
    importer.spec = [
      '```yaml',
      'goals:',
      yamlGoalBlock,
      '```',
      '',
      '```yaml',
      'tasks:',
      yamlTaskBlock,
      '```',
      '',
      '```yaml',
      'milestones:',
      yamlMilestoneBlock,
      '```',
    ].join('\n')
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(qAfterSeed, null, 2),
      'utf-8',
    )

    // Approve → tasks merged, goals persisted, milestones logged.
    const approved = await approveWorkspaceImport({ memoryDir, projectPath: tmpDir })
    expect(approved.success).toBe(true)
    expect(approved.tasksAdded).toBe(seeded.draft.tasks.length)
    expect(approved.goalsRecorded).toBe(seeded.draft.goals.length)
    expect(approved.milestonesLogged).toBe(seeded.draft.milestones.length)

    const qFinal = await readQueue()

    // Importer task is done.
    expect(
      qFinal.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)?.status,
    ).toBe('done')

    // Every drafted task landed as proposed + origination=system.
    for (const t of seeded.draft.tasks) {
      const landed = qFinal.tasks.find((x) => x.id === t.suggestedId)
      expect(landed, `task ${t.suggestedId}`).toBeDefined()
      expect(landed!.status).toBe('proposed')
      expect(landed!.origination).toBe('system')
    }

    // workspace-goals.json persisted with every goal.
    const goalsRaw = await fs.readFile(
      path.join(memoryDir, 'workspace-goals.json'),
      'utf-8',
    )
    const goalsPersisted = JSON.parse(goalsRaw)
    expect(goalsPersisted.goals).toHaveLength(seeded.draft.goals.length)

    // PROGRESS.md logs every completed milestone (e.g. "Initial scaffold").
    const progress = await fs.readFile(
      path.join(memoryDir, 'PROGRESS.md'),
      'utf-8',
    )
    for (const m of seeded.draft.milestones) {
      expect(progress).toContain(m.title)
    }
  })

  it('suffixes conflicting task ids rather than overwriting', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: t-wire-dashboard
    title: v1
    domain: ui
  - id: t-wire-dashboard
    title: v2
    domain: ui
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(2)
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 't-wire-dashboard')?.title).toBe('v1')
    expect(q.tasks.find((t) => t.id === 't-wire-dashboard-2')?.title).toBe('v2')
  })
})
