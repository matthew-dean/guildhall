import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  buildDeterministicCandidatePacket,
  createMastraMemoryCoreAdapter,
  auditProjectMemoryState,
  readMemoryEvents,
  buildMemoryCoreCandidatePacket,
  consolidateProjectMemoryEvents,
  evaluateMemoryCandidatePacketGuarantees,
  inspectEmptyMastraDatabase,
  inspectEmptyMastraThreadShells,
  recordMemoryEvent,
  retireEmptyMastraDatabase,
  removeEmptyMastraThreadShells,
  resolveMemoryPaths,
  scopeToMastraIds,
  scopeKey,
  writeMemoryAuditReport,
  MEMORY_EVENT_HISTORY_MAX_BYTES,
  MEMORY_EVENT_SUMMARY_MAX_CHARS,
  type GuildhallMemoryScope,
} from '@guildhall/memory-core'

let tmpDir: string
let projectRoot: string
let previousDataDir: string | undefined
let previousSemanticRecall: string | undefined
let previousObservationalMemory: string | undefined
let previousEngineGate: string | undefined
let previousSubstrate: string | undefined

beforeEach(async () => {
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  previousSemanticRecall = process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL
  previousObservationalMemory = process.env.GUILDHALL_MEMORY_OBSERVATIONAL
  previousEngineGate = process.env.GUILDHALL_MEMORY_ENGINE_GATE
  previousSubstrate = process.env.GUILDHALL_MEMORY_SUBSTRATE
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-core-'))
  projectRoot = path.join(tmpDir, 'project')
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  if (previousSemanticRecall === undefined) delete process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL
  else process.env.GUILDHALL_MEMORY_SEMANTIC_RECALL = previousSemanticRecall
  if (previousObservationalMemory === undefined) delete process.env.GUILDHALL_MEMORY_OBSERVATIONAL
  else process.env.GUILDHALL_MEMORY_OBSERVATIONAL = previousObservationalMemory
  if (previousEngineGate === undefined) delete process.env.GUILDHALL_MEMORY_ENGINE_GATE
  else process.env.GUILDHALL_MEMORY_ENGINE_GATE = previousEngineGate
  if (previousSubstrate === undefined) delete process.env.GUILDHALL_MEMORY_SUBSTRATE
  else process.env.GUILDHALL_MEMORY_SUBSTRATE = previousSubstrate
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function taskScope(overrides: Partial<Extract<GuildhallMemoryScope, { kind: 'task_thread' }>> = {}): GuildhallMemoryScope {
  return {
    kind: 'task_thread',
    projectId: 'looma-knit',
    taskId: 'context-menu',
    agentRole: 'worker',
    threadId: 'thread-1',
    runId: 'run-1',
    ...overrides,
  }
}

describe('memory-core', () => {
  it('maps Guildhall scopes to Mastra resource/thread ids without cross-task sharing', () => {
    expect(scopeToMastraIds(taskScope())).toEqual({
      resourceId: 'project:looma-knit:task:context-menu',
      threadId: 'agent:worker:thread:thread-1',
    })

    expect(scopeToMastraIds({ kind: 'project', projectId: 'looma-knit' })).toEqual({
      resourceId: 'project:looma-knit',
      threadId: 'project:looma-knit:memory',
    })
  })

  it('records memory events in system-local storage without writing project .guildhall files', async () => {
    const before = await fs.readdir(path.join(projectRoot, '.guildhall'))
    const paths = resolveMemoryPaths({ projectRoot, scope: taskScope() })

    const result = await recordMemoryEvent({
      projectRoot,
      event: {
        scope: taskScope(),
        source: {
          kind: 'task',
          ref: 'TASKS.json#context-menu',
          path: '.guildhall/TASKS.json',
          capturedAt: '2026-06-06T12:00:00.000Z',
        },
        content: {
          summary: 'Context menu is ready for worker proof.',
          text: 'The selected task should continue through child work before stopping.',
        },
        metadata: {
          projectId: 'looma-knit',
          taskId: 'context-menu',
          agentRole: 'worker',
          retention: 'task_lifecycle',
          risk: 'low',
        },
      },
    })

    expect(result.storagePath).toBe(paths.eventsPath)
    expect(result.repoLocalWrites).toEqual([])
    expect(existsSync(paths.eventsPath)).toBe(true)
    expect(paths.eventsPath.startsWith(process.env.GUILDHALL_DATA_DIR!)).toBe(true)

    const events = await readMemoryEvents({ projectRoot, scope: taskScope() })
    expect(events).toHaveLength(1)
    expect(events[0]?.source.path).toBe('.guildhall/TASKS.json')
    expect(events[0]?.content.summary).toContain('worker proof')
    const stored = JSON.parse(await fs.readFile(paths.eventsPath, 'utf8').then(raw => raw.trim())) as Record<string, unknown>
    expect(stored.schemaVersion).toBe(2)
    expect(stored.content).toEqual({ summary: 'Context menu is ready for worker proof.' })
    expect(stored).not.toHaveProperty('text')
    expect(stored).not.toHaveProperty('json')

    const after = await fs.readdir(path.join(projectRoot, '.guildhall'))
    expect(after).toEqual(before)
  })

  it('bounds durable memory summaries and per-scope history at the write boundary', async () => {
    const scope = taskScope({ taskId: 'bounded-memory' })
    const paths = resolveMemoryPaths({ projectRoot, scope })
    const longSummary = 'important '.repeat(MEMORY_EVENT_SUMMARY_MAX_CHARS)

    for (let index = 0; index < 320; index += 1) {
      await recordMemoryEvent({
        projectRoot,
        event: {
          scope,
          source: {
            kind: 'progress',
            ref: `PROGRESS.md#${index}`,
            capturedAt: '2026-06-06T12:01:00.000Z',
          },
          content: { summary: index === 0 ? longSummary : `Progress ${index}` },
          metadata: { projectId: 'looma-knit', taskId: 'bounded-memory', retention: 'task_lifecycle' },
        },
      })
    }

    const raw = await fs.readFile(paths.eventsPath, 'utf8')
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(MEMORY_EVENT_HISTORY_MAX_BYTES)
    const events = await readMemoryEvents({ projectRoot, scope })
    expect(events.every(event => event.content.summary.length <= MEMORY_EVENT_SUMMARY_MAX_CHARS)).toBe(true)
  })

  it('enforces one project-wide memory history budget across many scopes', async () => {
    for (let index = 0; index < 96; index += 1) {
      const scope = taskScope({ taskId: `scope-${index}`, threadId: `thread-${index}` })
      await recordMemoryEvent({
        projectRoot,
        event: {
          scope,
          source: {
            kind: 'progress',
            ref: `PROGRESS.md#scope-${index}`,
            capturedAt: '2026-06-06T12:01:00.000Z',
          },
          content: { summary: `${index} ${'important '.repeat(600)}` },
          metadata: { projectId: 'looma-knit', taskId: `scope-${index}`, retention: 'task_lifecycle' },
        },
      })
    }

    const paths = resolveMemoryPaths({ projectRoot, scope: taskScope() })
    const raw = await fs.readFile(paths.eventsPath, 'utf8')
    expect(Buffer.byteLength(raw, 'utf8')).toBeLessThanOrEqual(MEMORY_EVENT_HISTORY_MAX_BYTES)
    expect((await fs.readdir(path.join(paths.memoryDir, 'events')).catch(() => [])).length).toBe(0)
  })

  it('ignores legacy per-scope memory files until an explicit migration consolidates them', async () => {
    const scope = taskScope({ taskId: 'legacy-scope', threadId: 'legacy-thread' })
    const paths = resolveMemoryPaths({ projectRoot, scope })
    const legacyPath = path.join(path.dirname(paths.eventsPath), 'events', `${scopeKey(scope)}.jsonl`)
    const event = {
      schemaVersion: 2,
      scope,
      source: { kind: 'progress', ref: 'PROGRESS.md#legacy', capturedAt: '2026-06-06T12:01:00.000Z' },
      content: { summary: 'Legacy memory remains readable during migration.' },
      metadata: { projectId: 'looma-knit', taskId: 'legacy-scope', retention: 'task_lifecycle' },
      id: 'legacy-event',
      recordedAt: '2026-06-06T12:01:00.000Z',
      sourceRefs: [],
    }
    await fs.mkdir(path.dirname(legacyPath), { recursive: true })
    await fs.writeFile(legacyPath, `${JSON.stringify(event)}\n`, 'utf8')

    await expect(readMemoryEvents({ projectRoot, scope })).resolves.toHaveLength(0)
    const dryRun = await consolidateProjectMemoryEvents(projectRoot, { dryRun: true })
    expect(dryRun.filesSeen).toBe(1)
    expect(existsSync(legacyPath)).toBe(true)

    const applied = await consolidateProjectMemoryEvents(projectRoot, { dryRun: false })
    expect(applied.filesRemoved).toBe(1)
    expect(existsSync(legacyPath)).toBe(false)
    await expect(readMemoryEvents({ projectRoot, scope })).resolves.toHaveLength(1)
  })

  it('builds deterministic packets with source refs and authoritative health', async () => {
    await recordMemoryEvent({
      projectRoot,
      event: {
        scope: taskScope(),
        source: {
          kind: 'progress',
          ref: 'PROGRESS.md#latest',
          path: '.guildhall/PROGRESS.md',
          capturedAt: '2026-06-06T12:01:00.000Z',
        },
        content: {
          summary: 'Latest proof says stale browser control failed, not the app.',
        },
        metadata: {
          projectId: 'looma-knit',
          taskId: 'context-menu',
          retention: 'task_lifecycle',
          risk: 'medium',
        },
      },
    })

    const packet = await buildDeterministicCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })

    expect(packet.health).toEqual({
      adapter: 'deterministic',
      fallbackUsed: false,
      warnings: [],
      compactionStatus: 'active',
      semanticValidity: 'valid',
    })
    expect(packet.candidates).toHaveLength(1)
    expect(packet.candidates[0]?.sourceRefs).toEqual([
      expect.objectContaining({
        sourceKind: 'progress',
        uri: 'PROGRESS.md#latest',
        path: '.guildhall/PROGRESS.md',
      }),
    ])
    expect(packet.byteEstimate).toBeLessThan(4096)
  })

  it('instantiates Mastra memory against system-local libSQL and reports no repo-local writes', async () => {
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
      storage: 'persistent',
    })

    expect(adapter.health.adapter).toBe('mastra')
    expect(adapter.health.storagePath.startsWith(process.env.GUILDHALL_DATA_DIR!)).toBe(true)
    expect(adapter.health.repoLocalWrites).toEqual([])
    expect(adapter.health.features).toEqual(expect.arrayContaining([
      'libsql-storage',
      'thread-resource-scope',
      'read-only-mode',
    ]))
    expect(adapter.health.scope).toEqual(scopeToMastraIds(taskScope()))
    expect(existsSync(adapter.health.storagePath)).toBe(true)
    expect(await fs.readdir(path.join(projectRoot, '.guildhall'))).toEqual([])
    await adapter.close()
    expect(existsSync(`${adapter.health.storagePath}-wal`)).toBe(false)
  })

  it('does not create Mastra threads from a read-only packet path', async () => {
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
      storage: 'persistent',
    })
    const db = new DatabaseSync(adapter.health.storagePath, { readOnly: true })
    const row = db.prepare('select count(*) as count from mastra_threads').get() as { count: number | bigint }
    db.close()
    expect(Number(row.count)).toBe(0)
    await adapter.close()
  })

  it('removes only empty Guildhall Mastra thread shells and preserves message-bearing threads', async () => {
    const projectScope = { kind: 'project' as const, projectId: 'looma-knit' }
    const shellAdapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: projectScope,
      readOnly: false,
      storage: 'persistent',
    })

    expect(inspectEmptyMastraThreadShells({ projectRoot, projectId: 'looma-knit' }).count).toBe(1)
    const removed = removeEmptyMastraThreadShells({ projectRoot, projectId: 'looma-knit' })
    expect(removed.removed).toBe(1)
    expect(inspectEmptyMastraThreadShells({ projectRoot, projectId: 'looma-knit' }).count).toBe(0)
    await shellAdapter.close()

    const messageAdapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: projectScope,
      readOnly: false,
      storage: 'persistent',
    })
    const ids = scopeToMastraIds(projectScope)
    const db = new DatabaseSync(messageAdapter.health.storagePath)
    const threadId = (db.prepare('select id from mastra_threads limit 1').get() as { id: string }).id
    db.prepare(`
      insert into mastra_messages (id, thread_id, content, role, type, createdAt, resourceId)
      values (?, ?, ?, ?, ?, ?, ?)
    `).run('message-1', threadId, '{"text":"durable"}', 'user', 'text', '2026-07-14T00:00:00.000Z', ids.resourceId)
    expect(Number((db.prepare('select count(*) as count from mastra_messages').get() as { count: number | bigint }).count)).toBe(1)
    db.close()

    expect(removeEmptyMastraThreadShells({ projectRoot, projectId: 'looma-knit' }).removed).toBe(0)
    const retained = new DatabaseSync(messageAdapter.health.storagePath, { readOnly: true })
    expect(Number((retained.prepare('select count(*) as count from mastra_threads').get() as { count: number | bigint }).count)).toBe(1)
    retained.close()
    await messageAdapter.close()
  })

  it('retires only an empty Mastra database and preserves databases with data or unknown objects', async () => {
    const emptyAdapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: { kind: 'project', projectId: 'looma-knit' },
      readOnly: true,
      storage: 'persistent',
    })
    const emptyPath = emptyAdapter.health.storagePath
    await emptyAdapter.close()
    expect(inspectEmptyMastraDatabase({ projectRoot, projectId: 'looma-knit' })).toMatchObject({
      eligible: true,
      reason: 'empty-mastra-schema',
    })
    expect(retireEmptyMastraDatabase({ projectRoot, projectId: 'looma-knit' })).toMatchObject({
      retired: true,
      bytesAfter: 0,
    })
    expect(existsSync(emptyPath)).toBe(false)

    const messageAdapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: { kind: 'project', projectId: 'looma-knit' },
      readOnly: false,
      storage: 'persistent',
    })
    const database = new DatabaseSync(messageAdapter.health.storagePath)
    database.prepare(`
      insert into mastra_resources (id, "createdAt", "updatedAt")
      values (?, ?, ?)
    `).run('resource-1', '2026-07-15T00:00:00.000Z', '2026-07-15T00:00:00.000Z')
    database.close()
    expect(inspectEmptyMastraDatabase({ projectRoot, projectId: 'looma-knit' })).toMatchObject({
      eligible: false,
      reason: 'data-present',
    })
    expect(retireEmptyMastraDatabase({ projectRoot, projectId: 'looma-knit' }).retired).toBe(false)
    expect(existsSync(messageAdapter.health.storagePath)).toBe(true)
    await messageAdapter.close()
  })

  it('does not allocate persistent Mastra storage for an implicit read-only adapter', async () => {
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
    })

    expect(adapter.health.storagePath).toBe('file::memory:')
    expect(existsSync(resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath)).toBe(false)
    await adapter.close()
  })

  it('prepares Mastra observational memory only when explicitly enabled after the quality gate passes', async () => {
    process.env.GUILDHALL_MEMORY_ENGINE_GATE = 'passed'
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
      storage: 'persistent',
      observationalMemory: true,
    })

    expect(adapter.health.observationalMemoryEnabled).toBe(true)
    expect(adapter.health.observationalProcessorReady).toBe(true)
    expect(adapter.health.features).toEqual(expect.arrayContaining([
      'observational-memory-enabled',
      'observational-memory-processor',
    ]))
    expect(adapter.health.repoLocalWrites).toEqual([])
    expect(await fs.readdir(path.join(projectRoot, '.guildhall'))).toEqual([])
    await adapter.close()
  })

  it('builds deterministic packets by default without creating a Mastra database', async () => {
    await recordMemoryEvent({
      projectRoot,
      event: {
        scope: taskScope(),
        source: {
          kind: 'progress',
          ref: 'PROGRESS.md#mastra-packet',
          path: '.guildhall/PROGRESS.md',
          capturedAt: '2026-06-06T12:01:00.000Z',
        },
        content: {
          summary: 'Mastra packet should preserve source-backed progress.',
        },
        metadata: {
          projectId: 'looma-knit',
          taskId: 'context-menu',
          retention: 'task_lifecycle',
          risk: 'low',
        },
      },
    })

    const packet = await buildMemoryCoreCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })

    expect(packet.health).toMatchObject({
      adapter: 'deterministic',
      fallbackUsed: false,
      compactionStatus: 'active',
      semanticValidity: 'valid',
    })
    expect(existsSync(resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath)).toBe(false)
    expect(packet.candidates[0]).toEqual(expect.objectContaining({
      kind: 'deterministic_summary',
      summary: 'Mastra packet should preserve source-backed progress.',
    }))
    expect(packet.candidates[0]?.sourceRefs).toEqual([
      expect.objectContaining({ uri: 'PROGRESS.md#mastra-packet' }),
    ])
  })

  it('does not allocate project history for an empty default memory read', async () => {
    const previous = process.env.GUILDHALL_MEMORY_SUBSTRATE
    delete process.env.GUILDHALL_MEMORY_SUBSTRATE
    try {
      const paths = resolveMemoryPaths({ projectRoot, scope: taskScope() })
      const packet = await buildMemoryCoreCandidatePacket({
        projectRoot,
        scope: taskScope(),
        purpose: 'next_worker_context',
        maxBytes: 4096,
      })

      expect(packet.health.adapter).toBe('deterministic')
      expect(existsSync(path.dirname(paths.memoryDir))).toBe(false)
      expect(existsSync(paths.memoryDir)).toBe(false)
      expect(existsSync(paths.dbPath)).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.GUILDHALL_MEMORY_SUBSTRATE
      else process.env.GUILDHALL_MEMORY_SUBSTRATE = previous
    }
  })

  it('does not initialize Mastra storage when retrieval is not wired', async () => {
    process.env.GUILDHALL_MEMORY_SUBSTRATE = 'mastra'
    await recordMemoryEvent({
      projectRoot,
      event: {
        scope: taskScope(),
        source: {
          kind: 'progress',
          ref: 'PROGRESS.md#engine-gate',
          path: '.guildhall/PROGRESS.md',
          capturedAt: '2026-06-06T12:05:00.000Z',
        },
        content: {
          summary: 'Requested engines should remain gated until quality proof passes.',
        },
        metadata: {
          projectId: 'looma-knit',
          taskId: 'context-menu',
          retention: 'task_lifecycle',
          risk: 'low',
        },
      },
    })

    const packet = await buildMemoryCoreCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })

    expect(packet.health.adapter).toBe('deterministic')
    expect(packet.health.warnings.join('\n')).toContain('Mastra retrieval is not wired')
    expect(existsSync(resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath)).toBe(false)
  })

  it('enables only engine paths whose prerequisites pass the quality gate', async () => {
    process.env.GUILDHALL_MEMORY_ENGINE_GATE = 'passed'

    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
      storage: 'persistent',
      semanticRecall: true,
      observationalMemory: true,
    })

    expect(adapter.health.features).toEqual(expect.arrayContaining([
      'semantic-recall-vector-unavailable',
      'observational-memory-enabled',
      'observational-memory-processor',
    ]))
    expect(adapter.health.semanticRecallEnabled).toBe(false)
    expect(adapter.health.observationalMemoryEnabled).toBe(true)
    expect(adapter.health.observationalProcessorReady).toBe(true)
    expect(adapter.health.warnings.join('\n')).toContain('Semantic recall requested but no vector store is configured.')
    expect(adapter.health.repoLocalWrites).toEqual([])
    await adapter.close()
  })

  it('keeps explicit Mastra requests honest instead of pretending to retrieve', async () => {
    process.env.GUILDHALL_MEMORY_SUBSTRATE = 'mastra'
    const packet = await buildMemoryCoreCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })

    expect(packet.health.adapter).toBe('deterministic')
    expect(packet.health.warnings.join('\n')).toContain('Mastra retrieval is not wired')
    expect(existsSync(resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath)).toBe(false)
  })

  it('keeps automatic Mastra storage in memory for temporary project roots', async () => {
    const adapter = await createMastraMemoryCoreAdapter({
      projectRoot,
      scope: taskScope(),
      readOnly: true,
    })

    expect(adapter.health.storagePath).toBe('file::memory:')
    expect(adapter.health.features).toContain('ephemeral-storage')
    expect(existsSync(resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath)).toBe(false)
    await adapter.close()
  })

  it('marks memory packets that lose source refs as semantically invalid', async () => {
    const packet = await buildDeterministicCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })
    const guarantees = evaluateMemoryCandidatePacketGuarantees({
      ...packet,
      candidates: [{
        id: 'bad-memory',
        kind: 'deterministic_summary',
        summary: 'Unsourced claim.',
        relevance: 'high',
        confidence: 'high',
        freshness: 'current',
        sourceRefs: [],
        reasonForInclusion: 'test',
        risks: [],
      }],
    })

    expect(guarantees).toEqual({
      compactionStatus: 'active',
      semanticValidity: 'needs_attention',
      warnings: ['Memory candidate bad-memory has no source refs.'],
    })
  })

  it('marks memory packets over their requested byte budget as compaction needing attention', async () => {
    const packet = await buildDeterministicCandidatePacket({
      projectRoot,
      scope: taskScope(),
      purpose: 'next_worker_context',
      maxBytes: 4096,
    })
    const guarantees = evaluateMemoryCandidatePacketGuarantees({
      ...packet,
      byteEstimate: 512,
    }, { maxBytes: 128 })

    expect(guarantees).toEqual({
      compactionStatus: 'needs_attention',
      semanticValidity: 'valid',
      warnings: ['Memory packet exceeds byte budget: 512 > 128.'],
    })
  })

  it('writes audit reports through memory-core data access', async () => {
    const report = await writeMemoryAuditReport({
      projectRoot,
      scope: taskScope(),
      report: {
        generatedAt: '2026-06-06T12:02:00.000Z',
        storagePath: resolveMemoryPaths({ projectRoot, scope: taskScope() }).dbPath,
        repoLocalWrites: [],
        warnings: ['semantic recall disabled'],
      },
    })

    expect(report.path.startsWith(process.env.GUILDHALL_DATA_DIR!)).toBe(true)
    expect(report.repoLocalWrites).toEqual([])
    const raw = await fs.readFile(report.path, 'utf8')
    expect(raw).toContain('semantic recall disabled')
  })

  it('audits project-local .guildhall bloat into system-local memory events without mutating the repo', async () => {
    const stateDir = path.join(projectRoot, '.guildhall')
    await fs.writeFile(path.join(stateDir, 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [
        { id: 'task-a', status: 'done', title: 'Done task', notes: ['a', 'b'] },
        { id: 'task-b', status: 'blocked', title: 'Blocked task', reviewVerdicts: [{ ok: false }] },
      ],
    }, null, 2), 'utf8')
    await fs.writeFile(path.join(stateDir, 'PROGRESS.md'), [
      '# Progress',
      '',
      '### Milestone',
      'Worker completed useful proof.',
      '',
    ].join('\n'), 'utf8')
    await fs.writeFile(path.join(stateDir, 'learning.json'), '{"suggestedLearnings":[{"id":"learn-1"}]}\n', 'utf8')
    const beforeEntries = await fs.readdir(stateDir)
    const beforeTasks = await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')

    const dryRun = await auditProjectMemoryState({
      projectRoot,
      apply: false,
      now: () => new Date('2026-06-06T12:03:00.000Z'),
    })

    expect(dryRun.dryRun).toBe(true)
    expect(dryRun.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: '.guildhall/TASKS.json', kind: 'task_queue', taskCount: 2 }),
      expect.objectContaining({ relativePath: '.guildhall/PROGRESS.md', kind: 'progress_log' }),
      expect.objectContaining({ relativePath: '.guildhall/learning.json', kind: 'memory_file' }),
    ]))
    expect(dryRun.eventsWritten).toBe(0)
    expect(dryRun.repoLocalWrites).toEqual([])
    expect(dryRun.auditReportPath).toBeNull()
    expect(await fs.readdir(stateDir)).toEqual(beforeEntries)
    expect(await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')).toBe(beforeTasks)

    const applied = await auditProjectMemoryState({
      projectRoot,
      apply: true,
      now: () => new Date('2026-06-06T12:04:00.000Z'),
    })

    expect(applied.dryRun).toBe(false)
    expect(applied.eventsWritten).toBe(applied.files.length)
    expect(applied.repoLocalWrites).toEqual([])
    expect(applied.bytesBefore).toBeGreaterThan(0)
    expect(applied.bytesAfter).toBe(applied.bytesBefore)
    expect(applied.auditReportPath?.startsWith(process.env.GUILDHALL_DATA_DIR!)).toBe(true)
    expect(await fs.readdir(stateDir)).toEqual(beforeEntries)
    expect(await fs.readFile(path.join(stateDir, 'TASKS.json'), 'utf8')).toBe(beforeTasks)

    const events = await readMemoryEvents({
      projectRoot,
      scope: { kind: 'project', projectId: path.basename(projectRoot) },
    })
    expect(events.map(event => event.content.summary)).toEqual(expect.arrayContaining([
      expect.stringContaining('TASKS.json'),
      expect.stringContaining('PROGRESS.md'),
      expect.stringContaining('learning.json'),
    ]))
    expect(events.every(event => event.sourceRefs[0]?.hash)).toBe(true)
  })
})
