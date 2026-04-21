import { describe, expect, it } from 'vitest'

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  McpClientManager,
  McpServerNotConnectedError,
  loadMcpServerConfigs,
  mcpJsonConfigSchema,
  mcpServerConfigSchema,
  type CallToolResultLike,
  type LoadedPluginForMcp,
  type McpClientSession,
  type McpServerConfig,
  type ReadResourceResultLike,
} from '../index.js'

// ---------------------------------------------------------------------
// Fake SDK session/transport for injection into the manager
// ---------------------------------------------------------------------

class FakeSession implements McpClientSession {
  connected = false
  closed = false
  readonly toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = []
  readonly resourceReads: string[] = []

  constructor(
    private readonly script: {
      tools?: Array<{
        name: string
        description?: string
        inputSchema: { type: 'object'; [k: string]: unknown }
      }>
      resources?: Array<{ name: string; uri: string; description?: string }>
      listResourcesError?: string
      listToolsError?: string
      connectError?: string
      callTool?: (
        name: string,
        args: Record<string, unknown>,
      ) => Promise<CallToolResultLike> | CallToolResultLike
      readResource?: (uri: string) => Promise<ReadResourceResultLike> | ReadResourceResultLike
    } = {},
  ) {}

  async connect(_t: Transport): Promise<void> {
    if (this.script.connectError) throw new Error(this.script.connectError)
    this.connected = true
  }
  async close(): Promise<void> {
    this.closed = true
  }
  async listTools() {
    if (this.script.listToolsError) throw new Error(this.script.listToolsError)
    return {
      tools: (this.script.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    }
  }
  async listResources() {
    if (this.script.listResourcesError) throw new Error(this.script.listResourcesError)
    return {
      resources: (this.script.resources ?? []).map((r) => ({
        name: r.name,
        uri: r.uri,
        description: r.description,
      })),
    }
  }
  async callTool(params: { name: string; arguments: Record<string, unknown> }) {
    this.toolCalls.push(params)
    if (!this.script.callTool) return { content: [{ type: 'text', text: 'ok' }] }
    return await this.script.callTool(params.name, params.arguments)
  }
  async readResource(params: { uri: string }) {
    this.resourceReads.push(params.uri)
    if (!this.script.readResource) {
      return { contents: [{ text: 'resource contents for ' + params.uri }] }
    }
    return await this.script.readResource(params.uri)
  }
}

function fakeTransport(): Transport {
  return {} as unknown as Transport
}

// ---------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------

describe('schemas', () => {
  it('parses a stdio config with defaults', () => {
    const cfg = mcpServerConfigSchema.parse({ type: 'stdio', command: 'node' })
    expect(cfg).toEqual({ type: 'stdio', command: 'node', args: [] })
  })
  it('parses an http config with default headers', () => {
    const cfg = mcpServerConfigSchema.parse({ type: 'http', url: 'https://x.example' })
    expect(cfg).toEqual({ type: 'http', url: 'https://x.example', headers: {} })
  })
  it('rejects an unknown transport type', () => {
    expect(() => mcpServerConfigSchema.parse({ type: 'udp', url: 'x' })).toThrow()
  })
  it('mcpJsonConfigSchema accepts an empty mcpServers map', () => {
    expect(mcpJsonConfigSchema.parse({})).toEqual({ mcpServers: {} })
  })
})

// ---------------------------------------------------------------------
// loadMcpServerConfigs
// ---------------------------------------------------------------------

describe('loadMcpServerConfigs', () => {
  it('merges plugin servers under a namespaced key', () => {
    const settings = {
      mcp_servers: {
        localTool: { type: 'stdio', command: 'A', args: [] } satisfies McpServerConfig,
      },
    }
    const plugins: LoadedPluginForMcp[] = [
      {
        enabled: true,
        manifest: { name: 'plug-a' },
        mcp_servers: {
          weather: { type: 'http', url: 'https://w.example', headers: {} },
        },
      },
    ]
    const merged = loadMcpServerConfigs(settings, plugins)
    expect(merged['localTool']).toBeDefined()
    expect(merged['plug-a:weather']).toBeDefined()
  })
  it('does not overwrite existing settings entries with plugin entries (setdefault)', () => {
    const settings = {
      mcp_servers: {
        'plug-a:weather': { type: 'stdio', command: 'existing', args: [] } satisfies McpServerConfig,
      },
    }
    const plugins: LoadedPluginForMcp[] = [
      {
        enabled: true,
        manifest: { name: 'plug-a' },
        mcp_servers: {
          weather: { type: 'http', url: 'https://overwrite.example', headers: {} },
        },
      },
    ]
    const merged = loadMcpServerConfigs(settings, plugins)
    const entry = merged['plug-a:weather']
    expect(entry?.type).toBe('stdio')
  })
  it('skips disabled plugins', () => {
    const plugins: LoadedPluginForMcp[] = [
      {
        enabled: false,
        manifest: { name: 'p' },
        mcp_servers: {
          tool: { type: 'stdio', command: 'x', args: [] },
        },
      },
    ]
    expect(loadMcpServerConfigs({ mcp_servers: {} }, plugins)).toEqual({})
  })
})

// ---------------------------------------------------------------------
// Manager lifecycle
// ---------------------------------------------------------------------

describe('McpClientManager', () => {
  it('connects stdio servers and records tools/resources', async () => {
    const session = new FakeSession({
      tools: [
        {
          name: 'echo',
          description: 'echo tool',
          inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
        },
      ],
      resources: [{ name: 'readme', uri: 'mcp://readme', description: 'README' }],
    })
    const mgr = new McpClientManager(
      {
        fs: { type: 'stdio', command: 'node', args: [] },
      },
      {
        clientFactory: () => session,
        transportFactory: () => fakeTransport(),
      },
    )
    await mgr.connectAll()
    const statuses = mgr.listStatuses()
    expect(statuses).toHaveLength(1)
    expect(statuses[0]!.state).toBe('connected')
    expect(mgr.listTools()).toHaveLength(1)
    expect(mgr.listResources()).toHaveLength(1)
    expect(mgr.listTools()[0]!.server_name).toBe('fs')
  })

  it('marks websocket transports as failed/unsupported in this build', async () => {
    const mgr = new McpClientManager(
      { bad: { type: 'ws', url: 'ws://x', headers: {} } },
      {
        clientFactory: () => new FakeSession(),
        transportFactory: () => {
          throw new Error('should not be reached')
        },
      },
    )
    await mgr.connectAll()
    const status = mgr.listStatuses()[0]!
    expect(status.state).toBe('failed')
    expect(status.detail.toLowerCase()).toContain('unsupported')
  })

  it('tolerates listResources Method-not-found and still reports connected', async () => {
    const session = new FakeSession({
      tools: [{ name: 't', inputSchema: { type: 'object' } }],
      listResourcesError: 'Method not found: resources/list',
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    const status = mgr.listStatuses()[0]!
    expect(status.state).toBe('connected')
    expect(status.resources).toEqual([])
  })

  it('marks server failed when listResources throws non-Method-not-found', async () => {
    const session = new FakeSession({
      tools: [{ name: 't', inputSchema: { type: 'object' } }],
      listResourcesError: 'network reset',
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    expect(mgr.listStatuses()[0]!.state).toBe('failed')
    expect(session.closed).toBe(true)
  })

  it('marks server failed when transport construction throws', async () => {
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      {
        clientFactory: () => new FakeSession(),
        transportFactory: () => {
          throw new Error('spawn failed')
        },
      },
    )
    await mgr.connectAll()
    expect(mgr.listStatuses()[0]!.state).toBe('failed')
    expect(mgr.listStatuses()[0]!.detail).toContain('spawn failed')
  })

  it('marks server failed when connect() throws', async () => {
    const session = new FakeSession({ connectError: 'handshake nope' })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    expect(mgr.listStatuses()[0]!.state).toBe('failed')
  })

  it('callTool stringifies text content blocks (upstream semantics)', async () => {
    const session = new FakeSession({
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
      callTool: () => ({
        content: [
          { type: 'text', text: 'line-1' },
          { type: 'text', text: 'line-2' },
        ],
      }),
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    expect(await mgr.callTool('s', 'echo', {})).toBe('line-1\nline-2')
  })

  it('callTool falls back to (no output) for an empty result', async () => {
    const session = new FakeSession({
      tools: [{ name: 'q', inputSchema: { type: 'object' } }],
      callTool: () => ({ content: [] }),
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    expect(await mgr.callTool('s', 'q', {})).toBe('(no output)')
  })

  it('callTool surfaces structuredContent when no text blocks are returned', async () => {
    const session = new FakeSession({
      tools: [{ name: 'stats', inputSchema: { type: 'object' } }],
      callTool: () => ({ content: [], structuredContent: { count: 42 } }),
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    const out = await mgr.callTool('s', 'stats', {})
    expect(out).toContain('42')
  })

  it('callTool wraps underlying errors in McpServerNotConnectedError', async () => {
    const session = new FakeSession({
      tools: [{ name: 't', inputSchema: { type: 'object' } }],
      callTool: () => {
        throw new Error('boom')
      },
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    await expect(mgr.callTool('s', 't', {})).rejects.toBeInstanceOf(McpServerNotConnectedError)
  })

  it('callTool on unknown server throws McpServerNotConnectedError with transport detail', async () => {
    const mgr = new McpClientManager({}, {})
    await expect(mgr.callTool('ghost', 'x', {})).rejects.toBeInstanceOf(
      McpServerNotConnectedError,
    )
  })

  it('readResource returns the text blocks joined with newlines', async () => {
    const session = new FakeSession({
      tools: [],
      resources: [{ name: 'a', uri: 'mcp://a' }],
      readResource: () => ({
        contents: [{ text: 'first' }, { text: 'second' }],
      }),
    })
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      { clientFactory: () => session, transportFactory: () => fakeTransport() },
    )
    await mgr.connectAll()
    expect(await mgr.readResource('s', 'mcp://a')).toBe('first\nsecond')
  })

  it('reconnectAll closes existing sessions and reconnects with fresh status', async () => {
    const sessions: FakeSession[] = []
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      {
        clientFactory: () => {
          const s = new FakeSession({
            tools: [{ name: 't', inputSchema: { type: 'object' } }],
          })
          sessions.push(s)
          return s
        },
        transportFactory: () => fakeTransport(),
      },
    )
    await mgr.connectAll()
    await mgr.reconnectAll()
    expect(sessions).toHaveLength(2)
    expect(sessions[0]!.closed).toBe(true)
    expect(mgr.listStatuses()[0]!.state).toBe('connected')
  })

  it('close() drains all active sessions', async () => {
    const sessions: FakeSession[] = []
    const mgr = new McpClientManager(
      {
        a: { type: 'stdio', command: 'x', args: [] },
        b: { type: 'stdio', command: 'y', args: [] },
      },
      {
        clientFactory: () => {
          const s = new FakeSession({
            tools: [{ name: 't', inputSchema: { type: 'object' } }],
          })
          sessions.push(s)
          return s
        },
        transportFactory: () => fakeTransport(),
      },
    )
    await mgr.connectAll()
    await mgr.close()
    expect(sessions.every((s) => s.closed)).toBe(true)
  })

  it('updateServerConfig / getServerConfig round-trip', () => {
    const mgr = new McpClientManager(
      { s: { type: 'stdio', command: 'x', args: [] } },
      {},
    )
    const next: McpServerConfig = {
      type: 'http',
      url: 'https://y.example',
      headers: { 'X-Auth': 'token' },
    }
    mgr.updateServerConfig('s', next)
    expect(mgr.getServerConfig('s')).toEqual(next)
  })

  it('auth_configured true for stdio with env, http with headers', async () => {
    const session1 = new FakeSession({ tools: [], resources: [] })
    const session2 = new FakeSession({ tools: [], resources: [] })
    const sessions = [session1, session2]
    const mgr = new McpClientManager(
      {
        a: { type: 'stdio', command: 'x', args: [], env: { FOO: 'bar' } },
        b: { type: 'http', url: 'https://x', headers: { 'Authorization': 'Bearer x' } },
      },
      {
        clientFactory: () => sessions.shift()!,
        transportFactory: () => fakeTransport(),
      },
    )
    await mgr.connectAll()
    const statuses = mgr.listStatuses()
    expect(statuses.map((s) => ({ name: s.name, auth: s.auth_configured }))).toEqual([
      { name: 'a', auth: true },
      { name: 'b', auth: true },
    ])
  })
})
