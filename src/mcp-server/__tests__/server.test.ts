import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  appendTaskEvidence,
  buildGuildhallMcpManifest,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
  listMcpMemory,
  readMcpEffectiveContext,
  readMcpMemory,
  recordMcpMemoryObservation,
  updateMcpMemoryStatus,
} from '../index.js'

describe('Guildhall MCP tools', () => {
  it('appends evidence to PROGRESS.md with MCP provenance', async () => {
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
      const progress = readFileSync(join(root, '.guildhall', 'PROGRESS.md'), 'utf8')
      expect(progress).toContain('task-001')
      expect(progress).toContain('External agent read the flow audit')
      expect(progress).toContain('source: claude-code')
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
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({ tasks: [task] }), 'utf8')
      const effective = await readMcpEffectiveContext(ctx, { taskId: 'task-001' })
      expect(effective).toContain('## Effective Memory')
      expect(effective).toContain('Use MCP for audit context.')
      expect(effective).toContain('MCP milestone')
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
    expect(manifest.resourceTemplates.map((resource) => resource.uriTemplate)).toContain('guildhall://project/tasks/{taskId}')
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'guildhall.read_artifact',
      'guildhall.append_task_evidence',
      'guildhall.create_capability_request',
      'guildhall.list_capability_requests',
      'guildhall.list_memory',
      'guildhall.read_memory',
      'guildhall.record_memory_observation',
      'guildhall.update_memory_status',
      'guildhall.read_effective_context',
    ])
  })
})
