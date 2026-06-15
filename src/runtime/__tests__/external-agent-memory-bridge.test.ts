import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Task } from '@guildhall/core'
import { buildContext } from '../context-builder.js'
import {
  EXTERNAL_AGENT_MEMORY_BRIDGE_FILE,
  exportExternalMemoryBridgeRecords,
  importExternalMemoryBridgeRecord,
  listExternalMemoryBridgeRecords,
  reviewExternalMemoryBridgeRecord,
} from '../external-agent-memory-bridge.js'

let tmpDir: string
let memoryDir: string
let previousHome: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousHome = process.env.HOME
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-external-memory-'))
  process.env.HOME = tmpDir
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  memoryDir = path.join(tmpDir, 'project', '.guildhall')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-bridge',
    title: 'Tighten runtime memory bridge parsing',
    description: 'Update src/runtime/external-agent-memory-bridge.ts and focused tests.',
    domain: 'runtime',
    projectPath: path.dirname(memoryDir),
    status: 'in_progress',
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
    createdAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:00.000Z',
    spec: 'Keep imported external memory reviewable before it shapes local execution context.',
    ...overrides,
  }
}

describe('external agent memory bridge', () => {
  it('persists reviewable bridge records with evidence, freshness, and explicit scope rules', async () => {
    await expect(importExternalMemoryBridgeRecord({
      memoryDir,
      record: {
        id: 'bridge-without-evidence',
        provider: 'codex',
        exchange: 'import',
        scope: 'project',
        type: 'codebase_knowledge',
        summary: 'Missing evidence should not import.',
        content: 'This has no source evidence.',
        confidence: 'medium',
        risk: 'low',
        freshness: 'fresh',
      } as never,
    })).rejects.toThrow()

    const record = await importExternalMemoryBridgeRecord({
      memoryDir,
      record: {
        id: 'bridge-runtime-proof',
        provider: 'codex',
        externalSessionId: 'session-123',
        exchange: 'import',
        scope: 'project',
        type: 'codebase_knowledge',
        summary: 'Runtime bridge work should use focused tests before wider gates.',
        content: 'Run the external-agent memory bridge suite before broader runtime checks.',
        tags: ['bridge', 'runtime'],
        domains: ['runtime'],
        taskKinds: ['api'],
        fileAreas: ['src/runtime'],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [{
          kind: 'external-summary',
          ref: 'codex://session-123#handoff',
          summary: 'Reviewed Codex handoff summary, not raw chat.',
        }],
        createdAt: '2026-06-02T12:00:00.000Z',
        updatedAt: '2026-06-02T12:00:00.000Z',
      },
    })

    expect(record).toMatchObject({
      id: 'bridge-runtime-proof',
      reviewStatus: 'imported',
      freshness: 'fresh',
      scope: 'project',
      evidenceRefs: [{ kind: 'external-summary' }],
    })

    const listed = await listExternalMemoryBridgeRecords({ memoryDir })
    expect(listed.records.map(item => item.id)).toEqual(['bridge-runtime-proof'])

    const exported = await exportExternalMemoryBridgeRecords({ memoryDir })
    expect(exported.records[0]).toMatchObject({ id: 'bridge-runtime-proof' })

    const raw = await fs.readFile(path.join(memoryDir, EXTERNAL_AGENT_MEMORY_BRIDGE_FILE), 'utf-8')
    expect(raw).toContain('codex://session-123#handoff')
  })

  it('keeps imported external memory out of execution context until review promotes it', async () => {
    await importExternalMemoryBridgeRecord({
      memoryDir,
      record: {
        id: 'bridge-runtime-context',
        provider: 'claude-code',
        exchange: 'link',
        sourceRef: 'claude://session-789#summary',
        scope: 'project',
        type: 'codebase_knowledge',
        summary: 'Runtime bridge context uses reviewed external summaries only.',
        content: 'Bridge imports must be reviewed before workers treat them as effective memory.',
        tags: ['bridge', 'runtime'],
        domains: ['runtime'],
        taskKinds: ['api'],
        fileAreas: ['src/runtime'],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [{
          kind: 'external-link',
          ref: 'claude://session-789#summary',
          summary: 'External session summary link.',
        }],
        createdAt: '2026-06-02T12:00:00.000Z',
        updatedAt: '2026-06-02T12:00:00.000Z',
      },
    })

    const beforeReview = await buildContext(task({
      title: 'Implement runtime bridge context guard',
      description: 'Update src/runtime/external-agent-memory-bridge.ts for runtime API tests.',
      domain: 'runtime',
    }), memoryDir)

    expect(beforeReview.formatted).not.toContain('Runtime bridge context uses reviewed external summaries only.')
    expect(beforeReview.effectiveMemoryPacket?.included.map(record => record.id)).not.toContain('external-bridge-runtime-context')

    await reviewExternalMemoryBridgeRecord({
      memoryDir,
      id: 'bridge-runtime-context',
      reviewer: 'owner',
      now: '2026-06-02T12:10:00.000Z',
    })

    const afterReview = await buildContext(task({
      title: 'Implement runtime bridge context guard',
      description: 'Update src/runtime/external-agent-memory-bridge.ts for runtime API tests.',
      domain: 'runtime',
    }), memoryDir)

    expect(afterReview.formatted).toContain('Runtime bridge context uses reviewed external summaries only.')
    expect(afterReview.effectiveMemoryPacket?.included.map(record => record.id)).toContain('external-bridge-runtime-context')
  })
})
