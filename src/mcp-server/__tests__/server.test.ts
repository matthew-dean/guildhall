import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'
import {
  getProjectSystemStatePath,
  appendTaskEvidence as appendStoredTaskEvidence,
  projectStateDatabasePath,
  promoteProjectStateDatabaseAuthority,
  readProjectStateDatabaseTaskEvidenceCurrent,
  readProjectStateDatabaseTaskPointWithRevision,
} from '@guildhall/sessions'
import { writeProjectTaskQueueWithSummary } from '@guildhall/runtime/project-state-boundary'

import {
  appendTaskEvidence,
  buildGuildhallMcpManifest,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
  importMcpExternalMemoryBridgeRecord,
  listMcpExternalMemoryBridgeRecords,
  listMcpMemory,
  readMcpEffectiveContext,
  readMcpMemory,
  recordMcpMemoryObservation,
  rejectMcpExternalMemoryBridgeRecord,
  reviewMcpExternalMemoryBridgeRecord,
  updateMcpMemoryStatus,
  writeTasks,
} from '../index.js'

function asTasks(tasks: unknown[]): Task[] {
  return tasks as Task[]
}

describe('Guildhall MCP tools', () => {
  it('appends evidence to PROGRESS.md with MCP provenance before promotion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-tools-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      await appendTaskEvidence(ctx, {
        taskId: 'task-001',
        summary: 'External agent read the flow audit before editing.',
        source: 'claude-code',
      })
      const progress = readFileSync(getProjectSystemStatePath(root, 'PROGRESS.md'), 'utf8')
      expect(progress).toContain('task-001')
      expect(progress).toContain('External agent read the flow audit')
      expect(progress).toContain('source: claude-code')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('writes promoted evidence through SQLite without touching PROGRESS.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-tools-promoted-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const progressPath = getProjectSystemStatePath(root, 'PROGRESS.md')
      mkdirSync(dirname(progressPath), { recursive: true })
      writeFileSync(progressPath, '# Legacy progress\n\nThis must remain untouched.\n', 'utf8')
      promoteProjectStateDatabaseAuthority(root)
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }

      await appendTaskEvidence(ctx, {
        taskId: 'task-001',
        summary: 'Promoted evidence belongs in the normalized current projection.',
        source: 'claude-code',
      })

      expect(readFileSync(progressPath, 'utf8')).toBe('# Legacy progress\n\nThis must remain untouched.\n')
      expect(readProjectStateDatabaseTaskEvidenceCurrent(root, 'task-001')).toMatchObject({
        byKind: {
          note: [expect.objectContaining({
            payload: expect.objectContaining({
              content: 'Promoted evidence belongs in the normalized current projection.',
              source: 'claude-code',
            }),
          })],
        },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('creates and lists a mount-directory capability request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-capability-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const request = await createMcpCapabilityRequest(ctx, {
        taskId: 'task-001',
        requestedBy: 'external-agent',
        reason: 'Read sibling package API docs.',
        hostPath: '/tmp/sibling',
        access: 'read-only',
      })
      expect(request.status).toBe('pending')
      const listed = await listMcpCapabilityRequests(ctx)
      expect(listed).toContain('Read sibling package API docs.')
      expect(listed).toContain('read-only')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('records, lists, reads, promotes, and renders effective memory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-memory-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      await recordMcpMemoryObservation(ctx, {
        id: 'mcp-memory',
        scope: 'project',
        type: 'project_habit',
        status: 'observed',
        summary: 'Use MCP for audit context.',
        content: 'For src/mcp-server work, external agents should prefer MCP memory and context resources.',
        tags: ['mcp'],
        domains: ['runtime'],
        taskKinds: ['api'],
        fileAreas: ['src/mcp-server'],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [{ kind: 'task', summary: 'MCP milestone', ref: 'task-001' }],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      })
      const listed = await listMcpMemory(ctx, { text: 'MCP' })
      expect(listed).toContain('mcp-memory')

      const read = await readMcpMemory(ctx, { id: 'mcp-memory' })
      expect(read).toContain('Use MCP for audit context.')

      const updated = await updateMcpMemoryStatus(ctx, {
        id: 'mcp-memory',
        status: 'active',
        updatedAt: '2026-05-28T00:01:00.000Z',
      })
      expect(updated).toContain('"status": "active"')

      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const task = {
        id: 'task-001',
        title: 'Expand MCP bridge',
        description: 'Update src/mcp-server project-reader runtime API.',
        domain: 'runtime',
        projectPath: root,
        status: 'ready',
        notes: [],
        gateResults: [],
        reviewVerdicts: [],
        adjudications: [],
        acceptanceCriteria: [],
        outOfScope: [],
        dependsOn: [],
        revisionCount: 0,
        remediationAttempts: 0,
        escalations: [],
        agentIssues: [],
      }
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      mkdirSync(dirname(tasksPath), { recursive: true })
      writeFileSync(tasksPath, JSON.stringify({ tasks: [task] }), 'utf8')
      const effective = await readMcpEffectiveContext(ctx, { taskId: 'task-001' })
      expect(effective).toContain('## Effective Memory')
      expect(effective).toContain('Use MCP for audit context.')
      expect(effective).toContain('MCP milestone')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('imports, reviews, and rejects external memory bridge records explicitly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-external-memory-'))
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const imported = await importMcpExternalMemoryBridgeRecord(ctx, {
        id: 'mcp-bridge-record',
        provider: 'codex',
        exchange: 'import',
        scope: 'project',
        type: 'codebase_knowledge',
        summary: 'MCP bridge records require explicit review.',
        content: 'MCP-imported external memory must stay out of execution context until reviewed.',
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [{
          kind: 'external-summary',
          ref: 'codex://session-mcp#summary',
          summary: 'External session summary.',
        }],
        createdAt: '2026-06-03T12:00:00.000Z',
        updatedAt: '2026-06-03T12:00:00.000Z',
      })
      expect(imported).toContain('"reviewStatus": "imported"')
      expect(existsSync(join(root, '.guildhall', 'memory-store.json'))).toBe(false)

      const listed = await listMcpExternalMemoryBridgeRecords(ctx, { reviewStatus: 'imported' })
      expect(listed).toContain('"id": "mcp-bridge-record"')

      const reviewed = await reviewMcpExternalMemoryBridgeRecord(ctx, {
        id: 'mcp-bridge-record',
        reviewer: 'owner',
        updatedAt: '2026-06-03T12:05:00.000Z',
      })
      expect(reviewed).toContain('"reviewStatus": "reviewed"')
      expect(readFileSync(getProjectSystemStatePath(root, 'memory-store.json'), 'utf8')).toContain('external-mcp-bridge-record')

      await importMcpExternalMemoryBridgeRecord(ctx, {
        id: 'mcp-rejected-record',
        provider: 'claude-code',
        exchange: 'link',
        sourceRef: 'claude://session-mcp-rejected#summary',
        scope: 'project',
        type: 'project_fact',
        summary: 'Rejected MCP bridge records stay inert.',
        confidence: 'medium',
        risk: 'medium',
        freshness: 'recent',
        evidenceRefs: [{
          kind: 'external-link',
          ref: 'claude://session-mcp-rejected#summary',
          summary: 'External session link.',
        }],
        createdAt: '2026-06-03T12:00:00.000Z',
        updatedAt: '2026-06-03T12:00:00.000Z',
      })
      const rejected = await rejectMcpExternalMemoryBridgeRecord(ctx, {
        id: 'mcp-rejected-record',
        reviewer: 'owner',
        rejectionReason: 'Outdated source summary.',
        updatedAt: '2026-06-03T12:10:00.000Z',
      })
      expect(rejected).toContain('"reviewStatus": "rejected"')
      expect(rejected).toContain('"rejectionReason": "Outdated source summary."')
      expect(readFileSync(getProjectSystemStatePath(root, 'memory-store.json'), 'utf8')).not.toContain('external-mcp-rejected-record')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('Guildhall MCP server manifest', () => {
  it('declares the first stable resources and tools', () => {
    const manifest = buildGuildhallMcpManifest()
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/runtime')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/feedback')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/design')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/context')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/codebase-knowledge')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/external-agent-memory-bridge')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/primitives')
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project/agent-contracts')
    expect(manifest.resourceTemplates.map((resource) => resource.uriTemplate)).toContain('guildhall://project/tasks/{taskId}')
    expect(manifest.resourceTemplates.map((resource) => resource.uriTemplate)).toContain('guildhall://project/task-context/{taskId}')
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'guildhall.read_artifact',
      'guildhall.append_task_evidence',
      'guildhall.validate_agent_contract',
      'guildhall.validate_project_primitive_setup',
      'guildhall.validate_finished_work_intake',
      'guildhall.stage_agent_contract_result',
      'guildhall.apply_agent_contract_result',
      'guildhall.reject_agent_contract_result',
      'guildhall.revert_agent_contract_result',
      'guildhall.build_task_context_packet',
      'guildhall.derive_task_relationships',
      'guildhall.derive_queue_candidates',
      'guildhall.plan_task_split',
      'guildhall.create_capability_request',
      'guildhall.list_capability_requests',
      'guildhall.list_memory',
      'guildhall.read_memory',
      'guildhall.record_memory_observation',
      'guildhall.update_memory_status',
      'guildhall.read_effective_context',
      'guildhall.list_external_memory_bridge_records',
      'guildhall.import_external_memory_bridge_record',
      'guildhall.review_external_memory_bridge_record',
      'guildhall.reject_external_memory_bridge_record',
    ])
  })
})

describe('Guildhall MCP contract task writes', () => {
  it('uses normalized task points for promoted apply/revert updates and preserves evidence-owned detail', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-contract-promoted-'))
    try {
      const projectStateDir = join(root, '.guildhall')
      mkdirSync(projectStateDir, { recursive: true })
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      const initialTask = {
        id: 'task-contract',
        title: 'Link the primitive',
        description: 'Keep the task definition stable while delivery changes.',
        status: 'ready',
        delivery: { driver: 'knit', usesPrimitives: [] },
      }
      const untouchedTask = {
        id: 'task-untouched',
        title: 'Leave this task alone',
        status: 'ready',
        notes: [{ id: 'note-2', content: 'Untouched evidence.' }],
      }
      const initialQueue = {
        version: 1,
        lastUpdated: '2026-07-15T00:00:00.000Z',
        releases: [],
        tasks: [initialTask, untouchedTask],
      }

      writeProjectTaskQueueWithSummary(tasksPath, initialQueue, { projectRoot: root })
      promoteProjectStateDatabaseAuthority(root)
      await appendStoredTaskEvidence(root, 'task-contract', {
        id: 'note-1',
        kind: 'note',
        recordedAt: '2026-07-15T00:00:01.000Z',
        payload: { id: 'note-1', content: 'Evidence-owned note.' },
      })
      await appendStoredTaskEvidence(root, 'task-contract', {
        id: 'gate-1',
        kind: 'gate_result',
        recordedAt: '2026-07-15T00:00:02.000Z',
        payload: { command: 'pnpm test', ok: true },
      })
      await appendStoredTaskEvidence(root, 'task-contract', {
        id: 'review-1',
        kind: 'review_verdict',
        recordedAt: '2026-07-15T00:00:03.000Z',
        payload: { reviewer: 'owner', verdict: 'accepted' },
      })
      const beforeFile = readFileSync(tasksPath, 'utf8')
      const beforeDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedBytes = beforeDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-untouched') as { payload_gzip: Uint8Array }
      beforeDatabase.close()

      const appliedTask = {
        ...initialTask,
        delivery: { driver: 'knit', usesPrimitives: ['menu-item'] },
      }
      writeTasks(root, projectStateDir, asTasks([initialTask, untouchedTask]), asTasks([appliedTask, untouchedTask]))

      const appliedPoint = readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-contract')
      expect(appliedPoint?.task.definition).toMatchObject({
        delivery: { usesPrimitives: ['menu-item'] },
      })
      expect(appliedPoint?.task.definition).not.toHaveProperty('notes')
      expect(appliedPoint?.task.definition).not.toHaveProperty('gateResults')
      expect(appliedPoint?.task.definition).not.toHaveProperty('reviewVerdicts')
      expect(readProjectStateDatabaseTaskEvidenceCurrent(root, 'task-contract')).toMatchObject({
        byKind: {
          note: [expect.objectContaining({ payload: expect.objectContaining({ content: 'Evidence-owned note.' }) })],
          gate_result: [expect.objectContaining({ payload: expect.objectContaining({ command: 'pnpm test' }) })],
          review_verdict: [expect.objectContaining({ payload: expect.objectContaining({ reviewer: 'owner', verdict: 'accepted' }) })],
        },
      })
      expect(readFileSync(tasksPath, 'utf8')).toBe(beforeFile)
      const afterApplyDatabase = new DatabaseSync(projectStateDatabasePath(root), { readOnly: true })
      const untouchedAfterApply = afterApplyDatabase.prepare('SELECT payload_gzip FROM work_item_detail WHERE task_id = ?').get('task-untouched') as { payload_gzip: Uint8Array }
      expect(Buffer.from(untouchedAfterApply.payload_gzip)).toEqual(Buffer.from(untouchedBytes.payload_gzip))
      afterApplyDatabase.close()

      writeTasks(root, projectStateDir, asTasks([appliedTask, untouchedTask]), asTasks([initialTask, untouchedTask]))
      expect(readProjectStateDatabaseTaskPointWithRevision(tasksPath, 'task-contract')?.task.definition).toMatchObject({
        delivery: initialTask.delivery,
      })
      expect(readProjectStateDatabaseTaskEvidenceCurrent(root, 'task-contract')).toMatchObject({
        byKind: {
          note: [expect.objectContaining({ payload: expect.objectContaining({ content: 'Evidence-owned note.' }) })],
          gate_result: [expect.objectContaining({ payload: expect.objectContaining({ command: 'pnpm test' }) })],
          review_verdict: [expect.objectContaining({ payload: expect.objectContaining({ reviewer: 'owner', verdict: 'accepted' }) })],
        },
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses an unpromoted contract task write instead of replacing the legacy queue', () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-contract-migration-'))
    try {
      const projectStateDir = join(root, '.guildhall')
      mkdirSync(projectStateDir, { recursive: true })
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      const before = { id: 'task-contract', title: 'Legacy task', status: 'ready', delivery: { driver: 'knit' } }
      const after = { ...before, delivery: { driver: 'looma' } }
      mkdirSync(dirname(tasksPath), { recursive: true })
      writeFileSync(tasksPath, JSON.stringify({ tasks: [before] }), 'utf8')
      const beforeFile = readFileSync(tasksPath, 'utf8')

      expect(() => writeTasks(root, projectStateDir, asTasks([before]), asTasks([after]))).toThrow(/project-state migration/i)
      expect(readFileSync(tasksPath, 'utf8')).toBe(beforeFile)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
