import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  buildDeterministicCandidatePacket,
  createMastraMemoryCoreAdapter,
  readMemoryEvents,
  recordMemoryEvent,
  resolveMemoryPaths,
  scopeToMastraIds,
  writeMemoryAuditReport,
  type GuildhallMemoryScope,
} from '@guildhall/memory-core'

let tmpDir: string
let projectRoot: string
let previousDataDir: string | undefined

beforeEach(async () => {
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-core-'))
  projectRoot = path.join(tmpDir, 'project')
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
})

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
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

    const after = await fs.readdir(path.join(projectRoot, '.guildhall'))
    expect(after).toEqual(before)
  })

  it('builds deterministic packets with source refs and fallback health', async () => {
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
      fallbackUsed: true,
      warnings: [],
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
})
