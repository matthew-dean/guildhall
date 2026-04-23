import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { dump as yamlDump, load as yamlLoad } from 'js-yaml'

import { mcpAuthTool, applyMcpAuth } from '../mcp-auth.js'
import type {
  McpServerConfig,
  McpStdioServerConfig,
  McpHttpServerConfig,
} from '@guildhall/mcp'

describe('applyMcpAuth', () => {
  const stdio: McpStdioServerConfig = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'mcp-fs'],
    env: { EXISTING: 'keep' },
    cwd: null,
  }
  const http: McpHttpServerConfig = {
    type: 'http',
    url: 'https://mcp.example/v1',
    headers: { 'X-Trace': 'keep' },
  }

  it('stdio + env sets the default MCP_AUTH_TOKEN env key', () => {
    const out = applyMcpAuth(stdio, 'env', 'abc123', undefined)
    expect('config' in out).toBe(true)
    if ('config' in out && out.config.type === 'stdio') {
      expect(out.config.env).toEqual({ EXISTING: 'keep', MCP_AUTH_TOKEN: 'abc123' })
    }
  })

  it('stdio + bearer + key prepends "Bearer " into the chosen env var', () => {
    const out = applyMcpAuth(stdio, 'bearer', 'abc123', 'MY_TOKEN')
    if ('config' in out && out.config.type === 'stdio') {
      expect(out.config.env).toMatchObject({ MY_TOKEN: 'Bearer abc123' })
    }
  })

  it('stdio + header returns an error', () => {
    const out = applyMcpAuth(stdio, 'header', 'v', undefined)
    expect('error' in out).toBe(true)
  })

  it('http + header with explicit key writes the raw value', () => {
    const out = applyMcpAuth(http, 'header', 'secret', 'X-Auth')
    if ('config' in out && out.config.type === 'http') {
      expect(out.config.headers).toEqual({ 'X-Trace': 'keep', 'X-Auth': 'secret' })
    }
  })

  it('http + bearer with default Authorization header prepends "Bearer "', () => {
    const out = applyMcpAuth(http, 'bearer', 'tok', undefined)
    if ('config' in out && out.config.type === 'http') {
      expect(out.config.headers).toMatchObject({ Authorization: 'Bearer tok' })
    }
  })

  it('http + bearer with custom header writes raw value (not Bearer-prefixed)', () => {
    const out = applyMcpAuth(http, 'bearer', 'tok', 'X-API-Key')
    if ('config' in out && out.config.type === 'http') {
      expect(out.config.headers).toMatchObject({ 'X-API-Key': 'tok' })
    }
  })

  it('http + env returns an error', () => {
    const out = applyMcpAuth(http, 'env', 'v', undefined)
    expect('error' in out).toBe(true)
  })
})

describe('mcpAuthTool.execute', () => {
  let cwd: string

  function writeWorkspaceYaml(mcpServers: Record<string, McpServerConfig>): void {
    const yaml = yamlDump({
      name: 'test',
      mcp: { servers: mcpServers },
    })
    writeFileSync(join(cwd, 'guildhall.yaml'), yaml, 'utf8')
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'guildhall-mcp-auth-'))
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  it('persists bearer token into a stdio env var', async () => {
    writeWorkspaceYaml({
      fs: { type: 'stdio', command: 'npx', args: ['-y', 'mcp-fs'] } as McpStdioServerConfig,
    })
    const result = await mcpAuthTool.execute(
      { serverName: 'fs', mode: 'bearer', value: 'sk-123' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    expect(result.output).toContain('Saved MCP auth for fs')
    const raw = yamlLoad(readFileSync(join(cwd, 'guildhall.yaml'), 'utf8')) as {
      mcp: { servers: Record<string, McpStdioServerConfig> }
    }
    expect(raw.mcp.servers.fs?.env).toMatchObject({ MCP_AUTH_TOKEN: 'Bearer sk-123' })
  })

  it('persists a custom header onto an http server', async () => {
    writeWorkspaceYaml({
      api: { type: 'http', url: 'https://mcp.example/v1', headers: {} } as McpHttpServerConfig,
    })
    const result = await mcpAuthTool.execute(
      { serverName: 'api', mode: 'header', value: 'hunter2', key: 'X-API-Key' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(false)
    const raw = yamlLoad(readFileSync(join(cwd, 'guildhall.yaml'), 'utf8')) as {
      mcp: { servers: Record<string, McpHttpServerConfig> }
    }
    expect(raw.mcp.servers.api?.headers).toMatchObject({ 'X-API-Key': 'hunter2' })
  })

  it('returns an error for an unknown server', async () => {
    writeWorkspaceYaml({})
    const result = await mcpAuthTool.execute(
      { serverName: 'ghost', mode: 'bearer', value: 'x' },
      { cwd, metadata: {} },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Unknown MCP server')
  })

  it('calls mcp_manager.updateServerConfig + reconnectAll when threaded', async () => {
    writeWorkspaceYaml({
      fs: { type: 'stdio', command: 'npx', args: [] } as McpStdioServerConfig,
    })
    let updatedWith: McpServerConfig | undefined
    let reconnects = 0
    const manager = {
      updateServerConfig: (_name: string, cfg: McpServerConfig) => {
        updatedWith = cfg
      },
      reconnectAll: async () => {
        reconnects++
      },
    }
    const result = await mcpAuthTool.execute(
      { serverName: 'fs', mode: 'env', value: 'tok' },
      { cwd, metadata: { mcp_manager: manager } },
    )
    expect(result.is_error).toBe(false)
    expect(updatedWith?.type).toBe('stdio')
    expect(reconnects).toBe(1)
  })

  it('reports an error if reconnectAll throws but the YAML was saved', async () => {
    writeWorkspaceYaml({
      fs: { type: 'stdio', command: 'npx', args: [] } as McpStdioServerConfig,
    })
    const manager = {
      updateServerConfig: () => {},
      reconnectAll: async () => {
        throw new Error('boom')
      },
    }
    const result = await mcpAuthTool.execute(
      { serverName: 'fs', mode: 'env', value: 'tok' },
      { cwd, metadata: { mcp_manager: manager } },
    )
    expect(result.is_error).toBe(true)
    expect(result.output).toContain('reconnect failed')
    const raw = yamlLoad(readFileSync(join(cwd, 'guildhall.yaml'), 'utf8')) as {
      mcp: { servers: Record<string, McpStdioServerConfig> }
    }
    expect(raw.mcp.servers.fs?.env).toMatchObject({ MCP_AUTH_TOKEN: 'tok' })
  })
})
