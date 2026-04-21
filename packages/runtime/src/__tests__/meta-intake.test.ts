import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  bootstrapWorkspace,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from '@guildhall/config'
import {
  createMetaIntakeTask,
  approveMetaIntake,
  parseCoordinatorDraft,
  workspaceNeedsMetaIntake,
  META_INTAKE_TASK_ID,
  META_INTAKE_DOMAIN,
} from '../meta-intake.js'
import { TaskQueue } from '@guildhall/core'

// ---------------------------------------------------------------------------
// FR-14 coordinator bootstrapping via meta-intake
//
// Covers:
//  - Creating the reserved meta-intake task (idempotent).
//  - Detecting when a workspace needs a meta-intake (no coordinators / no yaml).
//  - Parsing a YAML codefence draft of coordinators out of a free-text spec.
//  - approveMetaIntake merging drafts into guildhall.yaml and closing the task.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-meta-intake-'))
  // Bootstrap a fresh workspace with no coordinators — this is the common
  // entry point for meta-intake.
  bootstrapWorkspace(tmpDir, { name: 'Meta Intake Test' })
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

describe('workspaceNeedsMetaIntake', () => {
  it('returns true for a freshly-bootstrapped workspace with no coordinators', () => {
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(true)
  })

  it('returns false once coordinators are defined', () => {
    const config = readWorkspaceConfig(tmpDir)
    writeWorkspaceConfig(tmpDir, {
      ...config,
      coordinators: [
        {
          id: 'looma',
          name: 'Looma',
          domain: 'looma',
          mandate: 'UI',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
    })
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(false)
  })

  it('returns true when guildhall.yaml is absent entirely', async () => {
    await fs.rm(path.join(tmpDir, 'guildhall.yaml'), { force: true })
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(true)
  })
})

describe('createMetaIntakeTask', () => {
  it('seeds a critical exploring task with the reserved id + domain', async () => {
    const result = await createMetaIntakeTask({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(result.taskId).toBe(META_INTAKE_TASK_ID)
    expect(result.alreadyExists).toBe(false)
    expect(result.transcriptPath).toBe(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
    )

    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)
    expect(task).toBeDefined()
    expect(task!.status).toBe('exploring')
    expect(task!.domain).toBe(META_INTAKE_DOMAIN)
    expect(task!.priority).toBe('critical')
  })

  it('writes the seed message into the exploring transcript', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
      'utf-8',
    )
    expect(transcript).toContain('coordinator definitions')
    expect(transcript).toContain('system')
  })

  it('is idempotent — calling twice does not duplicate the task', async () => {
    const first = await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const second = await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    expect(first.alreadyExists).toBe(false)
    expect(second.alreadyExists).toBe(true)
    const queue = await readQueue()
    const matches = queue.tasks.filter((t) => t.id === META_INTAKE_TASK_ID)
    expect(matches).toHaveLength(1)
  })

  it('honors a custom seed message when provided', async () => {
    await createMetaIntakeTask({
      memoryDir,
      projectPath: tmpDir,
      seedMessage: 'CUSTOM SEED PROMPT',
    })
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
      'utf-8',
    )
    expect(transcript).toContain('CUSTOM SEED PROMPT')
  })
})

describe('parseCoordinatorDraft', () => {
  it('extracts a single coordinator from a ```yaml ...``` fence', () => {
    const spec = `
Some narrative text.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma Coordinator
    domain: looma
    mandate: |
      Oversee UI.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard nav?
    autonomousDecisions:
      - Minor copy tweaks
    escalationTriggers:
      - API surface changes
\`\`\`

More narrative.
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).not.toBeNull()
    expect(drafts).toHaveLength(1)
    const coord = drafts![0]!
    expect(coord.id).toBe('looma')
    expect(coord.name).toBe('Looma Coordinator')
    expect(coord.domain).toBe('looma')
    expect(coord.mandate).toBe('Oversee UI.')
    expect(coord.concerns).toHaveLength(1)
    expect(coord.concerns[0]!.reviewQuestions).toEqual([
      'Does this preserve keyboard nav?',
    ])
    expect(coord.autonomousDecisions).toEqual(['Minor copy tweaks'])
    expect(coord.escalationTriggers).toEqual(['API surface changes'])
  })

  it('also accepts a ```yml fence', () => {
    const spec = '```yml\ncoordinators:\n  - id: a\n    name: A\n    domain: a\n    mandate: m\n```'
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).toHaveLength(1)
    expect(drafts![0]!.id).toBe('a')
  })

  it('returns null when there is no yaml codefence', () => {
    expect(parseCoordinatorDraft('No codefence here, just prose.')).toBeNull()
  })

  it('returns null when the fence has no coordinators key', () => {
    const spec = '```yaml\nfoo: bar\n```'
    expect(parseCoordinatorDraft(spec)).toBeNull()
  })

  it('skips entries missing required fields', () => {
    const spec = `
\`\`\`yaml
coordinators:
  - id: ok
    name: OK
    domain: ok
    mandate: m
  - name: Nameless
    domain: wat
  - id: also-ok
    name: Another
    domain: also-ok
    mandate: m
\`\`\`
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts!.map((d) => d.id)).toEqual(['ok', 'also-ok'])
  })

  it('finds the first valid fence even if earlier fences are broken', () => {
    const spec = `
\`\`\`yaml
not even valid yaml because of a tab\t: field
\`\`\`

\`\`\`yaml
coordinators:
  - id: good
    name: Good
    domain: good
    mandate: m
\`\`\`
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).toHaveLength(1)
    expect(drafts![0]!.id).toBe('good')
  })
})

describe('approveMetaIntake', () => {
  const sampleDraft = `## Summary
Draft coordinator definitions based on the interview.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma Coordinator
    domain: looma
    path: frontend
    mandate: |
      UI quality and design-system fidelity.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard navigation?
    autonomousDecisions:
      - Minor copy tweaks
    escalationTriggers:
      - Public API changes
  - id: knit
    name: Knit Coordinator
    domain: knit
    mandate: |
      Data / API layer concerns.
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`
`

  beforeEach(async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    // Attach a draft spec to the meta-intake task (as the Spec Agent would).
    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!
    task.spec = sampleDraft
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
  })

  it('merges drafts into guildhall.yaml and closes the task', async () => {
    const result = await approveMetaIntake({
      workspacePath: tmpDir,
      memoryDir,
    })
    expect(result.success).toBe(true)
    expect(result.coordinatorsAdded).toBe(2)

    const config = readWorkspaceConfig(tmpDir)
    expect(config.coordinators).toHaveLength(2)
    expect(config.coordinators.map((c) => c.id)).toEqual(['looma', 'knit'])
    expect(config.coordinators[0]!.path).toBe('frontend')

    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!
    expect(task.status).toBe('done')
    expect(task.completedAt).toBeDefined()
  })

  it('deduplicates against coordinators already in guildhall.yaml', async () => {
    // Pre-seed looma into the yaml.
    const config = readWorkspaceConfig(tmpDir)
    writeWorkspaceConfig(tmpDir, {
      ...config,
      coordinators: [
        {
          id: 'looma',
          name: 'Looma (existing)',
          domain: 'looma',
          mandate: 'existing',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
    })

    const result = await approveMetaIntake({
      workspacePath: tmpDir,
      memoryDir,
    })
    expect(result.success).toBe(true)
    // Only knit is new; looma should be preserved as the pre-existing version.
    expect(result.coordinatorsAdded).toBe(1)
    const after = readWorkspaceConfig(tmpDir)
    expect(after.coordinators).toHaveLength(2)
    expect(after.coordinators.find((c) => c.id === 'looma')!.name).toBe('Looma (existing)')
  })

  it('errors when the spec has no yaml codefence', async () => {
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = 'just prose, no draft'
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain('codefence')
  })

  it('errors when there is no meta-intake task', async () => {
    const queue = await readQueue()
    queue.tasks = queue.tasks.filter((t) => t.id !== META_INTAKE_TASK_ID)
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain(META_INTAKE_TASK_ID)
  })

  it('errors when the meta-intake task has no spec yet', async () => {
    const queue = await readQueue()
    delete queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no spec')
  })
})
