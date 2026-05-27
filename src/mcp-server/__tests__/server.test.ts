import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  appendTaskEvidence,
  buildGuildhallMcpManifest,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
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
})

describe('Guildhall MCP server manifest', () => {
  it('declares the first stable resources and tools', () => {
    const manifest = buildGuildhallMcpManifest()
    expect(manifest.resources.map((resource) => resource.uri)).toContain('guildhall://project')
    expect(manifest.resourceTemplates.map((resource) => resource.uriTemplate)).toContain('guildhall://project/tasks/{taskId}')
    expect(manifest.tools.map((tool) => tool.name)).toEqual([
      'guildhall.read_artifact',
      'guildhall.append_task_evidence',
      'guildhall.create_capability_request',
      'guildhall.list_capability_requests',
    ])
  })
})
