import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import {
  readProjectStateJsonAsync,
  readProjectStateTextAsync,
  writeProjectStateJsonFromMemoryDirAsync,
} from '@guildhall/sessions'
import {
  createWorkspaceImportTask,
  workspaceNeedsImport,
  approveWorkspaceImport,
  parseWorkspaceImport,
  maybeSeedWorkspaceImport,
  formatDetectedDraftAsSpec,
  mergeWorkspaceImportDraft,
  WORKSPACE_IMPORT_TASK_ID,
  WORKSPACE_IMPORT_DOMAIN,
} from '../workspace-importer.js'
import { pickNextTask } from '../orchestrator-picker.js'
import { detectWorkspaceSignals } from '../workspace-import/index.js'
import { formWorkspaceHypothesis } from '../workspace-import/hypothesis.js'
import type { WorkspaceInventory } from '../workspace-import/detect.js'
import type { WorkspaceSignal } from '../workspace-import/types.js'

let tmpDir: string
let dataDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-ws-import-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  bootstrapWorkspace(tmpDir, { name: 'Import Test' })
  memoryDir = path.join(tmpDir, '.guildhall')
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const parsed = await readProjectStateJsonAsync<unknown>(tmpDir, 'TASKS.json').catch((err: unknown) => {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: unknown }).code === 'ENOENT'
    ) {
      return {
        version: 1,
        lastUpdated: new Date().toISOString(),
        tasks: [],
      }
    }
    throw err
  })
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function writeQueue(queue: TaskQueue): Promise<void> {
  await writeProjectStateJsonFromMemoryDirAsync(memoryDir, 'TASKS.json', queue)
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
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: now,
      updatedAt: now,
    })
    await writeQueue(q)
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
        scope: 'current',
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

  it('treats a root YAML array as a task list for completed import recovery', () => {
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
- id: task-auth-complete
  title: Complete authentication flow
  description: Finish registration, login, profile management, and email confirmation.
  domain: auth
  priority: high
  references:
    - docs/brief.md
- id: task-listings-basic
  title: Build basic listing submission
\`\`\`
`)

    expect(parsed.tasks).toEqual([
      {
        id: 'task-auth-complete',
        title: 'Complete authentication flow',
        description: 'Finish registration, login, profile management, and email confirmation.',
        domain: 'auth',
        scope: 'current',
        priority: 'high',
        references: ['docs/brief.md'],
      },
      {
        id: 'task-listings-basic',
        title: 'Build basic listing submission',
        description: '',
        domain: 'core',
        scope: 'current',
        priority: 'normal',
        references: [],
      },
    ])
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
    await writeQueue(q)
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

  it('rejects malformed YAML fences instead of marking a partial import done', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
goals:
  - id: g1
    title: Ship orchestrator
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
     - bad-indent.md
\`\`\`

\`\`\`yaml
milestones:
  - title: Ship v0.1.0
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.success).toBe(false)
    expect(res.error).toContain('Invalid workspace-import YAML')

    const q = await readQueue()
    const importerTask = q.tasks.find((t) => t.id === WORKSPACE_IMPORT_TASK_ID)!
    expect(importerTask.status).not.toBe('done')
    expect(q.tasks.some((t) => t.id === 't-wire-dashboard')).toBe(false)
  })

  it('inserts tasks as import drafts + origination=human, records goals + milestones', async () => {
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
    expect(newTask.status).toBe('import_draft')
    expect(newTask.origination).toBe('human')
    expect(newTask.domain).toBe('ui')
    expect(newTask.priority).toBe('high')
    expect(newTask.references).toEqual([path.join(tmpDir, 'ROADMAP.md')])
    expect(newTask.notes[0]!.content).toContain('ROADMAP.md')
    expect(newTask.requestIntake).toMatchObject({
      intent: 'spec_only',
      recommendedNextAction: 'draft_spec',
      evidenceRefs: [expect.stringContaining('import:')],
      pressureTestSummary: {
        degree: 'guided',
      },
    })

    const goals = await readProjectStateJsonAsync<{ goals: Array<{ id: string; title: string }> }>(tmpDir, 'workspace-goals.json')
    expect(goals.goals[0]).toMatchObject({
      id: 'g1',
      title: 'Ship orchestrator',
    })

    const progress = await readProjectStateTextAsync(tmpDir, 'PROGRESS.md')
    expect(progress).toContain('Ship v0.1.0')
    expect(progress).toContain('abc12345')
    expect(progress).toContain('MILESTONE')
  })

  it('normalizes imported evidence paths after narrowing a task to a subproject', async () => {
    const knitPath = path.join(tmpDir, 'knit')
    await fs.mkdir(knitPath, { recursive: true })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: t-invite-flow
    title: Proper invite flow
    description: "knit/PROJECT_STATE.md: - [ ] Proper invite flow"
    domain: knit
    references:
      - knit/PROJECT_STATE.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: { knit: knitPath },
    })
    expect(res.success).toBe(true)

    const q = await readQueue()
    const newTask = q.tasks.find((t) => t.id === 't-invite-flow')!
    expect(newTask.projectPath).toBe(knitPath)
    expect(newTask.description).toBe('PROJECT_STATE.md: - [ ] Proper invite flow')
    expect(newTask.references).toEqual([path.join(knitPath, 'PROJECT_STATE.md')])
    expect(newTask.notes[0]!.content).toBe(`Imported from: ${path.join(knitPath, 'PROJECT_STATE.md')}`)
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
    await writeQueue(qAfterSeed)

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

    // Every drafted task landed in intake + origination=human. The approve
    // click imports candidates; the spec agent still has to shape them.
    for (const t of seeded.draft.tasks) {
      const landed = qFinal.tasks.find((x) => x.id === t.suggestedId)
      expect(landed, `task ${t.suggestedId}`).toBeDefined()
      expect(landed!.status).toBe('import_draft')
      expect(landed!.origination).toBe('human')
      expect(landed!.references).toEqual(t.references ?? [])
    }

    // workspace-goals.json persisted with every goal.
    const goalsPersisted = await readProjectStateJsonAsync<{ goals: unknown[] }>(tmpDir, 'workspace-goals.json')
    expect(goalsPersisted.goals).toHaveLength(seeded.draft.goals.length)

    // PROGRESS.md logs every completed milestone (e.g. "Initial scaffold").
    const progress = await readProjectStateTextAsync(tmpDir, 'PROGRESS.md')
    for (const m of seeded.draft.milestones) {
      expect(progress).toContain(m.title)
    }
  })

  it('detects schema-surface gaps before importing a mature Supabase project', async () => {
    await fs.mkdir(path.join(tmpDir, 'supabase/migrations'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'frontend/supabase/migrations'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'supabase/migrations/001_initial.sql'),
      [
        'CREATE TABLE software (id uuid primary key);',
        'CREATE TABLE transactions (id uuid primary key, software_id uuid references software(id));',
        'CREATE TABLE eligibility_checks (id uuid primary key, software_id uuid references software(id));',
        'CREATE OR REPLACE FUNCTION check_user_eligibility(p_user_id uuid, p_software_id uuid)',
        'RETURNS TABLE (is_eligible boolean, reason text) AS $$ BEGIN END; $$ LANGUAGE plpgsql;',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'frontend/supabase/migrations/001_payments.sql'),
      [
        'CREATE TABLE projects (id uuid primary key);',
        'CREATE TABLE payments (id uuid primary key, project_id uuid references projects(id));',
        'CREATE TABLE stripe_accounts (id uuid primary key, stripe_account_id text unique);',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)

    expect(inventory.ran).toContain('schema-surface')
    expect(draft.context.some((c) => c.label.includes('Database schema surface'))).toBe(true)
    expect(draft.tasks.map((t) => t.title)).toEqual(
      expect.arrayContaining([
        'Resolve software/projects schema naming split',
        'Resolve transactions/payments schema split',
        'Wire eligibility checks through the application flow',
      ]),
    )
  })

  it('detects stage deliverables, current milestone tasks, and decomposition inventory recommendations from prose docs', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs/harness'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'docs/specs'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        'Goal: build a no-UI test harness that proves story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        '',
        'Deliverables:',
        '',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        'The first Guildhall starter tasks should be:',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored',
        '   expected records.',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/harness/remaining-spec-decomposition-inventory.md'),
      [
        '# Remaining Spec Decomposition Inventory',
        '',
        '### 2.2 `dialogue-and-character-voice.md`',
        '',
        '- **Recommended first task title:** Implement dialogue-and-character-voice reviewer lane',
        '- **Recommended domain:** coherence',
        '- **Stage alignment:** Stage 2 (Agent Coordination)',
      ].join('\n'),
      'utf-8',
    )
    await fs.writeFile(
      path.join(tmpDir, 'docs/specs/dialogue-and-character-voice.md'),
      [
        '# Dialogue And Character Voice',
        '',
        'Protect distinct speaking patterns while preserving the author voice envelope.',
      ].join('\n'),
      'utf-8',
    )

    const inventory = await detectWorkspaceSignals({ projectPath: tmpDir })
    const draft = formWorkspaceHypothesis(inventory)

    expect(draft.tasks.map((task) => task.title)).toEqual(
      expect.arrayContaining([
        'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        'Add the first tiny fiction fixture and human-authored expected records.',
        'Implement dialogue-and-character-voice reviewer lane',
      ]),
    )
    expect(draft.tasks.find((task) => task.title === 'Implement dialogue-and-character-voice reviewer lane')).toMatchObject({
      scope: 'later',
      domain: 'coherence',
      references: expect.arrayContaining([
        expect.stringContaining('docs/harness/remaining-spec-decomposition-inventory.md'),
        expect.stringContaining('docs/specs/dialogue-and-character-voice.md'),
      ]),
    })
    expect(draft.tasks.map((task) => task.title)).not.toEqual(
      expect.arrayContaining([
        'fixture directory shape for at least one small story fixture',
        'typed fixture and expected-record contracts',
      ]),
    )
  })

  it('imports later-scope workspace tasks as shelved instead of current intake drafts', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-current
    title: Build current packet runner
    description: Build the current-scope packet runner.
    domain: harness
    priority: high
  - id: task-later
    title: Implement dialogue-and-character-voice reviewer lane
    description: Implement the later reviewer lane after the current harness loop is proven.
    domain: coherence
    scope: later
    priority: normal
    references:
      - docs/harness/remaining-spec-decomposition-inventory.md
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(2)

    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'task-current')?.status).toBe('import_draft')
    expect(q.tasks.find((t) => t.id === 'task-later')).toMatchObject({
      status: 'shelved',
      origination: 'human',
    })
    expect(q.tasks.find((t) => t.id === 'task-later')?.notes?.[0]?.content ?? '').toContain('Scope: later/deferred')
  })

  it('does not duplicate already-imported tasks when a refreshed import includes the same title again', async () => {
    await writeQueue({
      version: 1,
      lastUpdated: new Date().toISOString(),
      tasks: [
        {
          id: WORKSPACE_IMPORT_TASK_ID,
          title: 'Review existing project work',
          description: 'Reserved importer',
          domain: WORKSPACE_IMPORT_DOMAIN,
          projectPath: tmpDir,
          status: 'spec_review',
          priority: 'high',
          spec: '',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'system',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'task-import-existing',
          title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
          description: 'Already imported once.',
          domain: 'harness',
          projectPath: tmpDir,
          status: 'exploring',
          priority: 'normal',
          acceptanceCriteria: [],
          dependsOn: [],
          outOfScope: [],
          notes: [],
          gateResults: [],
          reviewVerdicts: [],
          adjudications: [],
          escalations: [],
          agentIssues: [],
          revisionCount: 0,
          remediationAttempts: 0,
          origination: 'human',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-existing
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: Keep the existing Stage 1 schema task.
    domain: harness
    priority: normal
  - id: task-later
    title: Implement dialogue-and-character-voice reviewer lane
    description: Import the later reviewer lane too.
    domain: coherence
    scope: later
    priority: normal
\`\`\`
`)

    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(res.tasksAdded).toBe(1)

    const q = await readQueue()
    const existing = q.tasks.find(task => task.id === 'task-import-existing')
    expect(q.tasks.filter(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toHaveLength(1)
    expect(existing).toMatchObject({
      description: 'Keep the existing Stage 1 schema task.',
      domain: 'harness',
      status: 'exploring',
    })
    expect(q.tasks.find(task => task.id === 'task-later')?.status).toBe('shelved')
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

  it('assigns imported tasks to the matching coordinator project path when provided', async () => {
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-knit-auth
    title: Redirect auth callback
    description: Route signed-in users to the right Knit workspace.
    domain: knit
\`\`\`
`)
    const res = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: {
        knit: path.join(tmpDir, 'knit'),
      },
    })
    expect(res.success).toBe(true)
    const q = await readQueue()
    expect(q.tasks.find((t) => t.id === 'task-knit-auth')?.projectPath).toBe(
      path.join(tmpDir, 'knit'),
    )
  })

  it('materializes referenced evidence as a dependency-aware work graph that scheduling respects', async () => {
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
        '| Drawer | missing | builds on Dialog and overlay manager | Knit mobile navigation drawer |',
        '',
        '- Knit delete collection confirmation needs `AlertDialog` before replacing the local BaseDialog variant.',
      ].join('\n'),
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-039
    title: Build AlertDialog primitive
    description: Build the Looma AlertDialog primitive as a concrete UI-library component.
    domain: looma
    priority: high
    references:
      - looma/docs/component-library-audit.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
      coordinatorProjectPaths: {
        looma: path.join(tmpDir, 'looma'),
        knit: path.join(tmpDir, 'knit'),
      },
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 4 })

    const q = await readQueue()
    const alertDialog = q.tasks.find((task) => task.id === 'task-039')!
    const alertDialogIntegration = q.tasks.find((task) => task.id === 'task-alert-dialog-integration')!
    const drawer = q.tasks.find((task) => task.id === 'task-drawer')!
    const drawerIntegration = q.tasks.find((task) => task.id === 'task-drawer-integration')!

    expect(alertDialog).toMatchObject({
      title: 'Build AlertDialog',
      domain: 'looma',
      projectPath: path.join(tmpDir, 'looma'),
      status: 'import_draft',
      dependsOn: [],
    })
    expect(alertDialog.acceptanceCriteria.map((criterion) => criterion.id)).toEqual([
      'source-implementation',
      'public-contract',
      'foundation-reuse',
      'design-system-conformance',
      'accessibility-contract',
      'automated-proof',
    ])
    expect(alertDialog.proofPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'command', command: 'pnpm test -- alert-dialog' }),
      ]),
    )

    expect(alertDialogIntegration).toMatchObject({
      title: 'Integrate AlertDialog into Knit destructive confirmation flow',
      domain: 'knit',
      projectPath: path.join(tmpDir, 'knit'),
      dependsOn: ['task-039'],
    })
    expect(alertDialog.requestIntake).toMatchObject({
      intent: 'spec_only',
      recommendedNextAction: 'draft_spec',
    })
    expect(alertDialogIntegration.acceptanceCriteria.map((criterion) => criterion.id)).toEqual([
      'public-consumer-import',
      'consumer-flow-renders',
      'runtime-proof',
      'look-and-feel-proof',
      'integration-regression-test',
    ])
    expect(drawer).toMatchObject({ domain: 'looma' })
    expect(drawerIntegration).toMatchObject({ domain: 'knit', dependsOn: ['task-drawer'] })
    expect(q.tasks.some((task) => task.title === 'looma/docs/component-library-audit.md: AlertDialog')).toBe(false)

    const runnableQueue = {
      ...q,
      tasks: q.tasks.map((task) => {
        if (task.id === 'task-workspace-import') return task
        if (task.id === 'task-039') return { ...task, status: 'ready' as const }
        if (task.id === 'task-alert-dialog-integration') {
          return { ...task, status: 'ready' as const, priority: 'critical' as const }
        }
        return task
      }),
    }
    expect(pickNextTask(runnableQueue)?.id).toBe('task-039')

    const afterImplementation = {
      ...runnableQueue,
      tasks: runnableQueue.tasks.map((task) =>
        task.id === 'task-039' ? { ...task, status: 'done' as const } : task,
      ),
    }
    expect(pickNextTask(afterImplementation)?.id).toBe('task-alert-dialog-integration')
  })

  it('uses the evidence graph even when it reframes one imported task instead of adding more tasks', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Stage 1: Fixture And Evaluation Harness',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1: Fixture And Evaluation Harness.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      ].join('\n'),
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-import-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: "docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas."
    whyThisMayMatter: "docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas."
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
    assumptions:
      - This item still reflects current project intent and has not already been completed or superseded elsewhere.
    missingInformation:
      - "Guildhall still needs to confirm scope, current relevance, and success criteria during shaping."
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 1 })

    const q = await readQueue()
    const imported = q.tasks.find(task => task.id === 'task-import-schema')
    expect(imported).toMatchObject({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      description: '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
      domain: 'harness',
      status: 'import_draft',
    })
    expect(imported?.acceptanceCriteria?.map(criterion => criterion.id)).toEqual([
      'source-implementation',
      'public-contract',
      'foundation-reuse',
      'design-system-conformance',
      'accessibility-contract',
      'automated-proof',
    ])
    expect(imported?.proofPaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'command',
          command: 'pnpm test -- define-fixture-expected-record-prototype-run-and-evaluation-schemas',
        }),
      ]),
    )
    expect(imported?.requestIntake?.assumptions).toEqual([
      'The referenced documentation still represents intended project direction.',
    ])
  })

  it('drops parsed deliverable bullets when the same roadmap already defines current starter tasks', async () => {
    await fs.mkdir(path.join(tmpDir, 'docs', 'harness'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'docs', 'harness', 'implementation-roadmap.md'),
      [
        '# Implementation Roadmap',
        '',
        '## Current Next Milestone',
        '',
        'The next milestone is Stage 1.',
        '',
        '1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        '2. Add the first tiny fiction fixture and human-authored expected records.',
        '',
        '## Stage 1: Harness foundation',
        '',
        'Deliverables:',
        '- fixture directory shape for at least one small story fixture',
        '- typed fixture and expected-record contracts',
      ].join('\n'),
      'utf-8',
    )
    await seedImporterWithSpec(`
\`\`\`yaml
tasks:
  - id: task-fixture-shape
    title: fixture directory shape for at least one small story fixture
    description: "docs/harness/implementation-roadmap.md: - fixture directory shape for at least one small story fixture"
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
  - id: task-contracts
    title: typed fixture and expected-record contracts
    description: "docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts"
    domain: harness
    priority: normal
    references:
      - docs/harness/implementation-roadmap.md
\`\`\`
`)

    const approved = await approveWorkspaceImport({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(approved).toMatchObject({ success: true, tasksAdded: 2 })

    const q = await readQueue()
    expect(q.tasks
      .filter(task => task.id !== WORKSPACE_IMPORT_TASK_ID)
      .map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
    expect(q.tasks.find(task => task.title === 'fixture directory shape for at least one small story fixture')).toBeUndefined()
    expect(q.tasks.find(task => task.title === 'typed fixture and expected-record contracts')).toBeUndefined()
  })
})

describe('mergeWorkspaceImportDraft', () => {
  it('applies importer refinements on top of detector findings without dropping detector-only tasks', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Build packet runner',
        evidence: 'Stage 1 harness deliverable.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Implement reviewer lane',
        evidence: 'Stage 2 reviewer lane.',
        confidence: 'high',
        scopeHint: 'later',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-runner
    title: Build packet runner
    description: Refined runner scope.
    domain: harness
    priority: high
  - id: task-cli
    title: Add CLI wrapper
    description: Human-added CLI entrypoint.
    domain: harness
    priority: normal
    references:
      - docs/harness/prototype-iteration-workflow.md
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.tasks.find(task => task.title === 'Build packet runner')).toMatchObject({
      suggestedId: 'task-runner',
      description: 'Refined runner scope.',
      references: ['docs/harness/implementation-roadmap.md'],
      source: 'planning-docs',
    })
    expect(merged.tasks.find(task => task.title === 'Implement reviewer lane')).toMatchObject({
      scope: 'later',
      source: 'planning-docs',
    })
    expect(merged.tasks.find(task => task.title === 'Add CLI wrapper')).toMatchObject({
      suggestedId: 'task-cli',
      description: 'Human-added CLI entrypoint.',
      source: 'workspace-importer',
      confidence: 'medium',
      references: ['docs/harness/prototype-iteration-workflow.md'],
    })
  })

  it('suppresses stale parsed deliverable bullets when the same roadmap already names a numbered current-task sequence', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Define fixture, expected-record, prototype-run, and evaluation schemas.',
        evidence: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Add the first tiny fiction fixture and human-authored expected records.',
        evidence: 'docs/harness/implementation-roadmap.md: 2. Add the first tiny fiction fixture and human-authored expected records.',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
tasks:
  - id: task-fixture-shape
    title: fixture directory shape for at least one small story fixture
    description: docs/harness/implementation-roadmap.md: - fixture directory shape for at least one small story fixture
    domain: harness
    priority: normal
  - id: task-contracts
    title: typed fixture and expected-record contracts
    description: docs/harness/implementation-roadmap.md: - typed fixture and expected-record contracts
    domain: harness
    priority: normal
  - id: task-schema
    title: Define fixture, expected-record, prototype-run, and evaluation schemas.
    description: docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.
    domain: harness
    priority: high
  - id: task-records
    title: Add the first tiny fiction fixture and human-authored expected records.
    description: docs/harness/implementation-roadmap.md: 2. Add the first tiny fiction fixture and human-authored expected records.
    domain: harness
    priority: high
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.tasks.map(task => task.title)).toEqual([
      'Define fixture, expected-record, prototype-run, and evaluation schemas.',
      'Add the first tiny fiction fixture and human-authored expected records.',
    ])
    expect(merged.tasks.find(task => task.title === 'Define fixture, expected-record, prototype-run, and evaluation schemas.')).toMatchObject({
      source: 'planning-docs',
      description: 'docs/harness/implementation-roadmap.md: 1. Define fixture, expected-record, prototype-run, and evaluation schemas.',
    })
    expect(merged.tasks.find(task => task.title === 'fixture directory shape for at least one small story fixture')).toBeUndefined()
  })

  it('drops stale parsed goal fragments when detected goals now contain the full wrapped sentence', () => {
    const detected = formWorkspaceHypothesis(invWith([
      {
        source: 'planning-docs',
        kind: 'goal',
        title: 'build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        evidence: 'full goal',
        confidence: 'high',
        references: ['docs/harness/implementation-roadmap.md'],
      },
    ]))
    const parsed = parseWorkspaceImport(`
\`\`\`yaml
goals:
  - id: goal-old
    title: build a no-UI test harness that proves the story-memory and packet
    rationale: old wrapped fragment
\`\`\`
`)

    const merged = mergeWorkspaceImportDraft(detected, parsed)

    expect(merged.goals).toEqual([
      expect.objectContaining({
        title: 'build a no-UI test harness that proves the story-memory and packet contracts against small fiction fixtures before any product UI is designed.',
        source: 'planning-docs',
      }),
    ])
  })
})

// The Workspace Import tab needs to let users approve the detector's
// deterministic findings directly, without waiting on an agent round-trip
// to emit YAML fences. formatDetectedDraftAsSpec serializes the detector
// output into the same fence format the parser expects, so
// approveWorkspaceImport can consume it.
describe('formatDetectedDraftAsSpec', () => {
  it('round-trips through parseWorkspaceImport into tasks/goals/milestones', () => {
    const inventory = sampleInventory()
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals.length).toBeGreaterThan(0)
    expect(parsed.tasks.length).toBeGreaterThan(0)
    expect(parsed.milestones.length).toBeGreaterThan(0)
    // Titles survive the round-trip verbatim.
    expect(parsed.goals.map((g) => g.title)).toContain(
      'Ship multi-agent orchestrator',
    )
    expect(parsed.tasks.map((t) => t.title)).toContain('Wire dashboard card')
    expect(parsed.milestones.map((m) => m.title)).toContain('Ship v0.1.0')
  })

  it('returns empty string for empty draft (no fences to emit)', () => {
    const empty = formWorkspaceHypothesis({
      signals: [],
      bySource: {},
      ran: [],
      failed: [],
    })
    expect(formatDetectedDraftAsSpec(empty)).toBe('')
  })

  it('escapes quotes in titles/descriptions so YAML stays valid', () => {
    const inventory = invWith([
      {
        source: 'readme',
        kind: 'goal',
        title: 'Add "dark" mode',
        evidence: 'Supports toggle between light/dark themes',
        confidence: 'high',
      },
    ])
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.goals[0]?.title).toBe('Add "dark" mode')
  })

  it('round-trips richer import-draft shaping fields', () => {
    const inventory = invWith([
      {
        source: 'planning-docs',
        kind: 'open_work',
        title: 'Implement dialogue reviewer lane',
        evidence: 'later-stage recommendation',
        confidence: 'high',
        scopeHint: 'later',
      },
      {
        source: 'roadmap',
        kind: 'open_work',
        title: 'Ship invite flow',
        evidence: 'Complete the missing invite redirect and success state.',
        confidence: 'medium',
        references: ['ROADMAP.md'],
      },
    ])
    const draft = formWorkspaceHypothesis(inventory)
    const spec = formatDetectedDraftAsSpec(draft)
    const parsed = parseWorkspaceImport(spec)
    expect(parsed.tasks.find((task) => task.title === 'Ship invite flow')).toMatchObject({
      title: 'Ship invite flow',
      whyThisMayMatter: 'Complete the missing invite redirect and success state.',
      assumptions: expect.any(Array),
      missingInformation: expect.any(Array),
      scope: 'current',
    })
    expect(parsed.tasks.find((task) => task.title === 'Implement dialogue reviewer lane')).toMatchObject({
      scope: 'later',
    })
  })
})
