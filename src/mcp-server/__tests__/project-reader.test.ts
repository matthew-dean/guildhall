import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  artifactUri,
  buildGuildhallResourceIndex,
  parseGuildhallUri,
  projectUri,
  readGuildhallResource,
  taskUri,
  type GuildhallMcpContext,
} from '../index.js'

describe('Guildhall MCP URI helpers', () => {
  it('renders stable resource URIs', () => {
    expect(projectUri()).toBe('guildhall://project')
    expect(taskUri('task-001')).toBe('guildhall://project/tasks/task-001')
    expect(artifactUri('flow-audit')).toBe('guildhall://project/artifacts/flow-audit')
  })

  it('parses known resource URIs', () => {
    expect(parseGuildhallUri('guildhall://project')).toEqual({ kind: 'project' })
    expect(parseGuildhallUri('guildhall://project/tasks')).toEqual({ kind: 'tasks' })
    expect(parseGuildhallUri('guildhall://project/tasks/task-001')).toEqual({
      kind: 'task',
      taskId: 'task-001',
    })
    expect(parseGuildhallUri('guildhall://project/artifacts/flow-audit')).toEqual({
      kind: 'artifact',
      artifactId: 'flow-audit',
    })
  })

  it('rejects non-Guildhall URIs and path traversal segments', () => {
    expect(() => parseGuildhallUri('file:///etc/passwd')).toThrow(/unsupported/i)
    expect(() => parseGuildhallUri('guildhall://project/tasks/../x')).toThrow(/invalid/i)
  })

  it('keeps the context runtime-agnostic', () => {
    const context: GuildhallMcpContext = {
      projectRoot: '/tmp/example',
      projectStateDir: '/tmp/example/.guildhall',
      localHistoryDir: '/tmp/home/.guildhall/data/projects/hash',
      runtime: { kind: 'host' },
    }
    expect(context.runtime.kind).toBe('host')
  })
})

describe('Guildhall MCP project reader', () => {
  it('lists project, task, artifact, decision, memory, and capability resources', async () => {
    const root = mkdtempRoot('guildhall-mcp-reader-')
    try {
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Example\nid: example\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
        tasks: [{ id: 'task-001', title: 'Wire bridge', status: 'ready' }],
      }), 'utf8')
      writeFileSync(join(root, '.guildhall', 'DECISIONS.md'), '# Decisions\n\n- Use MCP.\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'MEMORY.md'), '# Memory\n\nProject fact.\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'artifacts.yaml'), [
        'version: 1',
        'artifacts:',
        '  - id: flow-audit',
        '    path: internal/audits/flow-audit.md',
        '    description: Live audit',
        '',
      ].join('\n'), 'utf8')
      mkdirSync(join(root, 'internal/audits'), { recursive: true })
      writeFileSync(join(root, 'internal/audits/flow-audit.md'), '# Audit\n\n- [ ] Bridge\n', 'utf8')

      const ctx = {
        projectRoot: root,
        projectStateDir: join(root, '.guildhall'),
        runtime: { kind: 'host' as const },
      }
      const resources = await buildGuildhallResourceIndex(ctx)
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/tasks/task-001')
      expect(resources.map((r) => r.uri)).toContain('guildhall://project/artifacts/flow-audit')

      const artifact = await readGuildhallResource(ctx, 'guildhall://project/artifacts/flow-audit')
      expect(artifact).toContain('# Audit')
      expect(artifact).toContain('Bridge')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

function mkdtempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
