import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace } from '@guildhall/config'
import { TaskQueue } from '@guildhall/core'
import {
  createWorkspaceImportTask,
  workspaceNeedsImport,
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
