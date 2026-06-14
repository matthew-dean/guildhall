import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { defaultProjectRuntimeState, recordMemoryObservation, writeProjectRuntimeState } from '@guildhall/runtime'
import { getProjectContextDebugLedgerPath, getProjectLocalHistoryDir, getProjectSystemStateDir, getProjectSystemStatePath } from '@guildhall/sessions'

describe('guildhall mcp serve', () => {
  it('serves Guildhall resources over stdio', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-stdio-'))
    const bundleParent = resolve('.guildhall/tmp')
    mkdirSync(bundleParent, { recursive: true })
    const bundleRoot = mkdtempSync(join(bundleParent, 'mcp-stdio-cli-'))
    let client: Client | undefined
    try {
      const cliPath = join(bundleRoot, 'cli.js')
      const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      await build({
        entryPoints: [resolve('src/runtime/cli.ts')],
        bundle: true,
        outfile: cliPath,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        external: Object.keys(manifest.dependencies ?? {}),
        tsconfig: resolve('tsconfig.json'),
        banner: {
          js: [
            "import { createRequire as __guildhallCreateRequire } from 'node:module'",
            'const require = __guildhallCreateRequire(import.meta.url)',
          ].join('\n'),
        },
        logLevel: 'silent',
      })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Smoke\nid: smoke\n', 'utf8')
      const tasksPath = getProjectSystemStatePath(root, 'TASKS.json')
      mkdirSync(join(tasksPath, '..'), { recursive: true })
      writeFileSync(tasksPath, JSON.stringify({
        tasks: [{
          id: 'task-001',
          title: 'Smoke MCP',
          description: 'Read MCP project context.',
          domain: 'runtime',
          projectPath: root,
          status: 'ready',
        }],
      }), 'utf8')
      await recordMemoryObservation({
        memoryDir: getProjectSystemStateDir(root),
        record: {
          id: 'stdio-memory',
          scope: 'project',
          type: 'project_fact',
          status: 'active',
          summary: 'Stdio smoke memory is visible.',
          content: 'The stdio smoke proves memory can be read through MCP.',
          tags: ['stdio'],
          domains: ['runtime'],
          taskKinds: ['api'],
          fileAreas: ['src/mcp-server'],
          confidence: 'high',
          risk: 'low',
          freshness: 'fresh',
          evidenceRefs: [],
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
          source: 'test',
        },
      })
      await writeProjectRuntimeState(root, {
        ...defaultProjectRuntimeState(root),
        status: 'running',
        health: {
          status: 'healthy',
          checkedAt: '2026-05-28T00:00:00.000Z',
          checks: [{ name: 'stdio', ok: true }],
        },
      })
      mkdirSync(join(getProjectLocalHistoryDir(root), 'context-debug'), { recursive: true })
      writeFileSync(getProjectContextDebugLedgerPath(root), `${JSON.stringify({
        id: 'stdio-context',
        at: '2026-05-28T00:00:00.000Z',
        taskId: 'task-001',
        taskTitle: 'Smoke MCP',
        taskStatus: 'ready',
        domain: 'runtime',
        agentName: 'worker-agent',
        agentRole: 'worker',
        modelId: 'test-model',
        workspacePath: root,
        taskProjectPath: root,
        promptChars: 10,
        contextChars: 20,
        promptPreview: 'bounded',
        snapshotPath: '/tmp/snapshot',
        sections: [],
        health: [],
        reasons: [],
        applicableGuildSlugs: [],
        reviewerSlugs: [],
        primaryEngineerSlug: null,
        openQuestionCount: 0,
        acceptanceCriteriaCount: 0,
      })}\n`, 'utf8')

      client = new Client({ name: 'guildhall-test', version: '0.1.0' })
      const transport = new StdioClientTransport({
        command: 'node',
        args: [cliPath, 'mcp', 'serve', root],
      })
      await client.connect(transport)
      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/tasks/task-001')
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/runtime')
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/memory')
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/context')
      const body = await client.readResource({ uri: 'guildhall://project/tasks/task-001' })
      expect(JSON.stringify(body)).toContain('Smoke MCP')
      expect(JSON.stringify(await client.readResource({ uri: 'guildhall://project/runtime' }))).toContain('Health: healthy')
      expect(JSON.stringify(await client.readResource({ uri: 'guildhall://project/memory' }))).toContain('stdio-memory')
      expect(JSON.stringify(await client.readResource({ uri: 'guildhall://project/context' }))).toContain('Smoke MCP')
      expect(existsSync(join(root, '.guildhall'))).toBe(false)
    } finally {
      await client?.close()
      rmSync(getProjectLocalHistoryDir(root), { recursive: true, force: true })
      rmSync(root, { recursive: true, force: true })
      rmSync(bundleRoot, { recursive: true, force: true })
    }
  }, 15000)
})
