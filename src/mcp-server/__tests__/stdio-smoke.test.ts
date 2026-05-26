import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

describe('guildhall mcp serve', () => {
  it('serves Guildhall resources over stdio', async () => {
    const root = mkdtempSync(join(tmpdir(), 'guildhall-mcp-stdio-'))
    const bundleRoot = mkdtempSync(join(resolve('.guildhall/tmp'), 'mcp-stdio-cli-'))
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
      mkdirSync(join(root, '.guildhall'), { recursive: true })
      writeFileSync(join(root, 'guildhall.yaml'), 'name: Smoke\nid: smoke\n', 'utf8')
      writeFileSync(join(root, '.guildhall', 'TASKS.json'), JSON.stringify({
        tasks: [{ id: 'task-001', title: 'Smoke MCP', status: 'ready' }],
      }), 'utf8')

      client = new Client({ name: 'guildhall-test', version: '0.1.0' })
      const transport = new StdioClientTransport({
        command: 'node',
        args: [cliPath, 'mcp', 'serve', root],
      })
      await client.connect(transport)
      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain('guildhall://project/tasks/task-001')
      const body = await client.readResource({ uri: 'guildhall://project/tasks/task-001' })
      expect(JSON.stringify(body)).toContain('Smoke MCP')
    } finally {
      await client?.close()
      rmSync(root, { recursive: true, force: true })
      rmSync(bundleRoot, { recursive: true, force: true })
    }
  }, 15000)
})
