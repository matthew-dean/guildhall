import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Task } from '@guildhall/core'
import {
  getProjectLocalHistoryDir,
  getProjectStateDir,
  getProjectTaskLocalHistoryDir,
} from '@guildhall/sessions'
import { directoryStats } from '../../memory-core/storage.js'
import { createDeterministicGuildhallMemory } from '../../memory-core/deterministic.js'
import { ingestProjectStateForMemoryPrototype } from '../../memory-core/project-state-ingest.js'
import { buildContext } from '../context-builder.js'
import { compactProjectState } from '../project-state-compaction.js'

let tmp: string
let projectRoot: string
let stateDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-scale-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  process.env.GUILDHALL_CONFIG_DIR = path.join(tmp, 'config')
  projectRoot = path.join(tmp, 'project')
  stateDir = getProjectStateDir(projectRoot)
  await fs.mkdir(projectRoot, { recursive: true })
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  delete process.env.GUILDHALL_CONFIG_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('project memory scalability pressure', () => {
  it('keeps 10x historical task state compact while preserving active context retrieval', async () => {
    await seedHistoricalProjectState(500)
    const tasksPath = path.join(stateDir, 'TASKS.json')
    const beforeTasksBytes = (await fs.stat(tasksPath)).size
    expect(beforeTasksBytes).toBeGreaterThan(1_000_000)

    const compactStarted = performance.now()
    const compaction = await compactProjectState({
      projectRoot,
      dryRun: false,
      terminalTaskMinAgeMs: 90 * 24 * 60 * 60 * 1000,
      now: new Date('2026-06-04T00:00:00.000Z'),
    })
    const compactionMs = performance.now() - compactStarted

    expect(compaction.archivedTasks).toBe(500)
    expect(compaction.activeTasksKept).toBe(14)
    expect(compaction.progressHeartbeatsMoved).toBe(300)
    expect(compaction.codebaseMapCompacted).toBe(true)
    expect(compaction.bytesAfter).toBeLessThan(160_000)
    expect(compaction.bytesAfter).toBeLessThan(compaction.bytesBefore / 10)
    expect(compactionMs).toBeLessThan(12_000)

    const compactQueue = JSON.parse(await fs.readFile(tasksPath, 'utf8')) as { tasks: Array<{ id: string; status: string }> }
    expect(compactQueue.tasks.filter(task => task.status === 'done')).toHaveLength(0)
    expect(compactQueue.tasks.filter(task => task.status === 'shelved')).toHaveLength(2)
    expect(compactQueue.tasks.map(task => task.id)).toContain('task-active-0')

    const archiveStats = await directoryStats(path.join(stateDir, 'tasks', 'archive'))
    const localHistoryStats = await directoryStats(getProjectLocalHistoryDir(projectRoot))
    expect(archiveStats.fileCount).toBe(500)
    expect(localHistoryStats.fileCount).toBeGreaterThanOrEqual(502)
    await expect(fs.readFile(path.join(getProjectTaskLocalHistoryDir(projectRoot, 'task-old-0000'), 'archive-evidence.json'), 'utf8'))
      .resolves.toContain('historical note 0/24')

    const memory = createDeterministicGuildhallMemory({ projectRoot })
    const ingestStarted = performance.now()
    const ingestReport = await ingestProjectStateForMemoryPrototype({
      projectRoot,
      stateDir,
      stateLabel: 'system-state',
      memory,
    })
    const ingestMs = performance.now() - ingestStarted
    expect(ingestReport.eventsRecorded).toBeGreaterThanOrEqual(4)
    expect(ingestReport.files.find(file => file.relativePath === 'system-state/TASKS.json')?.summary)
      .toContain('active=14')
    expect(ingestReport.files.find(file => file.relativePath === 'system-state/TASKS.json')?.summary)
      .toContain('terminal=0')
    expect(ingestMs).toBeLessThan(4_000)

    const packet = await memory.buildCandidatePacket({
      scope: { kind: 'project', projectRoot },
      intent: 'Find memory scalability, task queue, archived task, and structural map context for active implementation work.',
      maxBytes: 3_000,
    })
    expect(packet.byteEstimate).toBeLessThanOrEqual(3_000)
    expect(packet.included.some(item => item.summary.includes('Task queue'))).toBe(true)
    expect(JSON.stringify(packet)).not.toContain('historical note 24/24')

    const contextStarted = performance.now()
    const context = await buildContext(activeTask(), stateDir)
    const contextMs = performance.now() - contextStarted
    expect(Buffer.byteLength(context.formatted, 'utf8')).toBeLessThan(60_000)
    expect(context.formatted).toContain('task-active-0')
    expect(context.formatted).toContain('Memory scalability')
    expect(context.formatted).not.toContain('historical note 24/24')
    expect(contextMs).toBeLessThan(4_000)

    console.info('[guildhall memory scale]', JSON.stringify({
      historicalTasks: 500,
      tasksBytesBefore: beforeTasksBytes,
      stateBytesBefore: compaction.bytesBefore,
      stateBytesAfter: compaction.bytesAfter,
      archivedTasks: compaction.archivedTasks,
      activeTasksKept: compaction.activeTasksKept,
      archiveFiles: archiveStats.fileCount,
      localHistoryFiles: localHistoryStats.fileCount,
      packetBytes: packet.byteEstimate,
      contextBytes: Buffer.byteLength(context.formatted, 'utf8'),
      compactionMs: Math.round(compactionMs),
      ingestMs: Math.round(ingestMs),
      contextMs: Math.round(contextMs),
    }))
  })
})

async function seedHistoricalProjectState(historicalTasks: number): Promise<void> {
  await fs.mkdir(path.join(stateDir, 'tasks', 'archive'), { recursive: true })
  await fs.writeFile(path.join(projectRoot, 'package.json'), JSON.stringify({
    name: 'memory-scale-fixture',
    private: true,
    scripts: { test: 'vitest run' },
  }, null, 2), 'utf8')
  await fs.writeFile(path.join(projectRoot, 'src.ts'), 'export const fixture = true\n', 'utf8')

  const tasks = [
    ...Array.from({ length: 10 }, (_, index) => ({
      ...activeTask(index),
      notes: Array.from({ length: 6 }, (__, note) => ({
        agentId: 'worker-agent',
        role: 'worker',
        content: `active note ${index}/${note}`,
        timestamp: '2026-06-04T00:00:00.000Z',
      })),
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `task-blocked-${index}`,
      title: `Blocked visible task ${index}`,
      description: 'Visible blocked task should remain in live queue.',
      domain: 'guildhall',
      projectPath: projectRoot,
      status: 'blocked',
      priority: 'normal',
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
      createdAt: '2026-06-04T00:00:00.000Z',
      updatedAt: '2026-06-04T00:00:00.000Z',
    })),
    ...Array.from({ length: 2 }, (_, index) => ({
      id: `task-shelved-${index}`,
      title: `Shelved visible task ${index}`,
      description: 'Shelved tasks remain visible for planning and release blockers.',
      domain: 'guildhall',
      projectPath: projectRoot,
      status: 'shelved',
      priority: 'normal',
      dependsOn: [],
      outOfScope: [],
      acceptanceCriteria: [],
      notes: Array.from({ length: 20 }, (__, note) => ({
        agentId: 'worker-agent',
        role: 'worker',
        content: `shelved note ${index}/${note}`,
        timestamp: '2026-05-01T00:00:00.000Z',
      })),
      gateResults: [],
      reviewVerdicts: [],
      adjudications: [],
      escalations: [],
      agentIssues: [],
      revisionCount: 0,
      remediationAttempts: 0,
      origination: 'human',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    })),
    ...Array.from({ length: historicalTasks }, (_, index) => historicalTask(index)),
  ]

  await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
    version: 1,
    lastUpdated: '2026-06-04T00:00:00.000Z',
    tasks,
  }, null, 2), 'utf8')

  await fs.writeFile(path.join(stateDir, 'MEMORY.md'), [
    '# Memory',
    '',
    '## Memory scalability',
    'Keep historical task evidence out of active context. Active tasks need compact summaries and local-history references.',
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(stateDir, 'DECISIONS.md'), [
    '---',
    'Decision: guildhall memory compaction keeps active task state visible and archives old terminal task evidence.',
    '---',
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(stateDir, 'PROGRESS.md'), [
    '# Progress',
    '',
    ...Array.from({ length: 300 }, (_, index) => [
      `### HEARTBEAT ${index}`,
      `Routine noisy heartbeat ${index}.`,
      '',
    ].join('\n')),
    '### MILESTONE',
    'Memory scalability pressure fixture seeded.',
    '',
  ].join('\n'), 'utf8')
  await fs.writeFile(path.join(stateDir, 'codebase-map.yaml'), JSON.stringify(largeCodebaseMap(), null, 2), 'utf8')
}

function activeTask(index = 0): Task {
  return {
    id: `task-active-${index}`,
    title: `Memory scalability active implementation ${index}`,
    description: 'Keep runtime memory and context building fast with a large historical task archive.',
    domain: 'guildhall',
    projectPath: projectRoot,
    status: 'in_progress',
    priority: 'normal',
    dependsOn: [],
    outOfScope: ['Do not load full archived task evidence into active context.'],
    acceptanceCriteria: [
      {
        id: 'ac-memory-scale',
        description: 'Context for active work remains compact after historical task compaction.',
        verifiedBy: 'automated',
        command: 'pnpm exec vitest run src/runtime/__tests__/memory-scalability.test.ts',
        met: false,
      },
    ],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    spec: 'Build memory scalability proof around compaction, retrieval, and context packet size.',
  }
}

function historicalTask(index: number): Task {
  const id = `task-old-${String(index).padStart(4, '0')}`
  return {
    id,
    title: `Historical completed task ${index}`,
    description: 'Old terminal task with bulky evidence that should not stay in the live task queue.',
    domain: 'guildhall',
    projectPath: projectRoot,
    status: 'done',
    priority: 'normal',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [
      { id: `${id}-ac`, description: 'Historical acceptance criterion', verifiedBy: 'review', met: true },
    ],
    notes: Array.from({ length: 25 }, (_, note) => ({
      agentId: 'worker-agent',
      role: 'worker',
      content: `historical note ${note}/24 for ${id}: ${'evidence '.repeat(24)}`,
      timestamp: '2026-01-01T00:00:00.000Z',
    })),
    gateResults: Array.from({ length: 12 }, (_, gate) => ({
      gateId: `${id}-gate-${gate}`,
      type: 'hard',
      passed: true,
      output: `gate output ${gate}: ${'verification '.repeat(20)}`,
      checkedAt: '2026-01-01T00:00:00.000Z',
    })),
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:00.000Z',
    spec: `Historical spec ${index}: ${'large spec evidence '.repeat(30)}`,
  }
}

function largeCodebaseMap(): Record<string, unknown> {
  return {
    version: 1,
    generatedAt: '2026-06-04T00:00:00.000Z',
    project: {
      root: projectRoot,
      summary: 'Large fixture map used for memory scalability pressure.',
      languages: ['typescript'],
      packageManagers: ['pnpm'],
      primaryFrameworks: [],
    },
    files: Object.fromEntries(Array.from({ length: 1_000 }, (_, index) => [
      `src/module-${index}.ts`,
      {
        path: `src/module-${index}.ts`,
        mtimeMs: index,
        size: 300,
        sha256: `${String(index).padStart(64, '0')}`.slice(-64),
        language: 'typescript',
        kind: 'source',
        areaIds: ['runtime'],
        symbols: [`module${index}`],
        imports: [],
        summary: `Fixture source module ${index}. ${'navigation summary '.repeat(8)}`,
      },
    ])),
    entrypoints: [],
    areas: [],
    abstractions: [],
    verification: { commands: ['pnpm test'] },
  }
}
