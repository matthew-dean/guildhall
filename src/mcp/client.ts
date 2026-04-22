/**
 * Ported from openharness/src/openharness/mcp/client.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `mcp.ClientSession` + `stdio_client` / `streamable_http_client`
 *     context managers → `@modelcontextprotocol/sdk` `Client` with
 *     `StdioClientTransport` / `StreamableHTTPClientTransport`. The SDK's
 *     `Client.connect(transport)` handles `initialize()`; we call it directly.
 *   - `AsyncExitStack` → explicit `transports` Map. The SDK's `Client.close()`
 *     closes the underlying transport, so the stack pattern isn't needed.
 *   - `httpx.AsyncClient` context manager is dropped — the streamable-http
 *     transport owns its own fetch client. We pass `headers` via
 *     `requestInit` instead.
 *   - The transport type is injectable via `TransportFactory` so tests can
 *     drive the manager without spawning real subprocesses. Upstream tests
 *     skip integration because they would need real MCP servers; our
 *     test seam removes that friction.
 *   - Output stringification mirrors upstream: join text blocks with '\n',
 *     fall back to JSON for non-text content, then `structuredContent`, then
 *     '(no output)'. **Minor divergence:** upstream uses Python `str(...)` on
 *     `structuredContent` (dict `__repr__` is readable); TS `String({x:1})`
 *     yields `"[object Object]"`, so we use `JSON.stringify` instead. Same
 *     intent — make the payload visible — with actually-useful output.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import {
  newPendingStatus,
  type McpConnectionStatus,
  type McpHttpServerConfig,
  type McpResourceInfo,
  type McpServerConfig,
  type McpStdioServerConfig,
  type McpToolInfo,
  type McpWebSocketServerConfig,
} from './types.js'

export class McpServerNotConnectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpServerNotConnectedError'
  }
}

// ---------------------------------------------------------------------------
// Minimal SDK surface the manager depends on. We type against an interface so
// tests can inject a fake Client + Transport pair without running a server.
// ---------------------------------------------------------------------------

export interface McpClientSession {
  connect(transport: Transport): Promise<void>
  close(): Promise<void>
  listTools(): Promise<{
    tools: Array<{
      name: string
      description?: string | undefined
      inputSchema: { type: 'object'; [k: string]: unknown }
    }>
  }>
  listResources(): Promise<{
    resources: Array<{
      name: string
      uri: string
      description?: string | undefined
    }>
  }>
  callTool(params: { name: string; arguments: Record<string, unknown> }): Promise<CallToolResultLike>
  readResource(params: { uri: string }): Promise<ReadResourceResultLike>
}

export interface CallToolResultLike {
  content?: Array<{ type: string; text?: string | undefined } & Record<string, unknown>>
  structuredContent?: unknown
  isError?: boolean | undefined
}

export interface ReadResourceResultLike {
  contents: Array<{ text?: string | undefined; blob?: string | undefined } & Record<string, unknown>>
}

export type ClientFactory = (info: { name: string; version: string }) => McpClientSession

export type TransportFactory = (
  name: string,
  config: McpServerConfig,
) => Transport

export const defaultClientFactory: ClientFactory = (info) =>
  new Client(info) as unknown as McpClientSession

export const defaultTransportFactory: TransportFactory = (name, config) => {
  if (config.type === 'stdio') {
    return buildStdioTransport(config)
  }
  if (config.type === 'http') {
    return buildHttpTransport(config)
  }
  throw new Error(`Unsupported MCP transport: ${(config as { type: string }).type}`)
}

function buildStdioTransport(config: McpStdioServerConfig): Transport {
  return new StdioClientTransport({
    command: config.command,
    args: config.args,
    ...(config.env != null ? { env: config.env } : {}),
    ...(config.cwd != null ? { cwd: config.cwd } : {}),
  }) as unknown as Transport
}

function buildHttpTransport(config: McpHttpServerConfig): Transport {
  const headers = config.headers ?? {}
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers },
  }) as unknown as Transport
}

function isWebSocketConfig(config: McpServerConfig): config is McpWebSocketServerConfig {
  return config.type === 'ws'
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export interface McpClientManagerOptions {
  clientInfo?: { name: string; version: string }
  clientFactory?: ClientFactory
  transportFactory?: TransportFactory
}

export class McpClientManager {
  private readonly serverConfigs: Map<string, McpServerConfig>
  private readonly statuses: Map<string, McpConnectionStatus>
  private readonly sessions: Map<string, McpClientSession> = new Map()
  private readonly clientInfo: { name: string; version: string }
  private readonly clientFactory: ClientFactory
  private readonly transportFactory: TransportFactory

  constructor(
    serverConfigs: Record<string, McpServerConfig>,
    options: McpClientManagerOptions = {},
  ) {
    this.serverConfigs = new Map(Object.entries(serverConfigs))
    this.statuses = new Map()
    for (const [name, config] of this.serverConfigs) {
      this.statuses.set(name, newPendingStatus(name, config.type))
    }
    this.clientInfo = options.clientInfo ?? { name: 'guildhall', version: '0.1.0' }
    this.clientFactory = options.clientFactory ?? defaultClientFactory
    this.transportFactory = options.transportFactory ?? defaultTransportFactory
  }

  async connectAll(): Promise<void> {
    for (const [name, config] of this.serverConfigs) {
      if (isWebSocketConfig(config)) {
        this.statuses.set(name, {
          name,
          state: 'failed',
          detail: `Unsupported MCP transport in current build: ${config.type}`,
          transport: config.type,
          auth_configured: Boolean(config.headers && Object.keys(config.headers).length > 0),
          tools: [],
          resources: [],
        })
        continue
      }
      await this.connectOne(name, config)
    }
  }

  async reconnectAll(): Promise<void> {
    await this.close()
    this.statuses.clear()
    for (const [name, config] of this.serverConfigs) {
      this.statuses.set(name, newPendingStatus(name, config.type))
    }
    await this.connectAll()
  }

  updateServerConfig(name: string, config: McpServerConfig): void {
    this.serverConfigs.set(name, config)
  }

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.serverConfigs.get(name)
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      try {
        await session.close()
      } catch {
        // Swallow — upstream suppresses RuntimeError + CancelledError here.
      }
    }
    this.sessions.clear()
  }

  listStatuses(): McpConnectionStatus[] {
    return [...this.statuses.keys()]
      .sort()
      .map((name) => this.statuses.get(name)!)
  }

  listTools(): McpToolInfo[] {
    const tools: McpToolInfo[] = []
    for (const status of this.listStatuses()) {
      tools.push(...status.tools)
    }
    return tools
  }

  listResources(): McpResourceInfo[] {
    const resources: McpResourceInfo[] = []
    for (const status of this.listStatuses()) {
      resources.push(...status.resources)
    }
    return resources
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const session = this.sessions.get(serverName)
    if (session == null) {
      const status = this.statuses.get(serverName)
      const detail = status?.detail ?? 'unknown server'
      throw new McpServerNotConnectedError(
        `MCP server '${serverName}' is not connected: ${detail}`,
      )
    }
    let result: CallToolResultLike
    try {
      result = await session.callTool({ name: toolName, arguments: args })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new McpServerNotConnectedError(
        `MCP server '${serverName}' call failed: ${message}`,
      )
    }
    return stringifyCallToolResult(result)
  }

  async readResource(serverName: string, uri: string): Promise<string> {
    const session = this.sessions.get(serverName)
    if (session == null) {
      const status = this.statuses.get(serverName)
      const detail = status?.detail ?? 'unknown server'
      throw new McpServerNotConnectedError(
        `MCP server '${serverName}' is not connected: ${detail}`,
      )
    }
    let result: ReadResourceResultLike
    try {
      result = await session.readResource({ uri })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new McpServerNotConnectedError(
        `MCP server '${serverName}' resource read failed: ${message}`,
      )
    }
    return stringifyReadResourceResult(result)
  }

  // -------------------------------------------------------------------------
  // Per-server connect
  // -------------------------------------------------------------------------

  private async connectOne(name: string, config: McpServerConfig): Promise<void> {
    const authConfigured = computeAuthConfigured(config)
    let transport: Transport
    try {
      transport = this.transportFactory(name, config)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.statuses.set(name, {
        name,
        state: 'failed',
        detail: message,
        transport: config.type,
        auth_configured: authConfigured,
        tools: [],
        resources: [],
      })
      return
    }

    const session = this.clientFactory(this.clientInfo)
    try {
      await session.connect(transport)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        await session.close()
      } catch {
        // ignore close-after-failure errors
      }
      this.statuses.set(name, {
        name,
        state: 'failed',
        detail: message,
        transport: config.type,
        auth_configured: authConfigured,
        tools: [],
        resources: [],
      })
      return
    }

    // Connected — gather tools and resources.
    let toolList: Awaited<ReturnType<McpClientSession['listTools']>>
    try {
      toolList = await session.listTools()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await session.close().catch(() => {})
      this.statuses.set(name, {
        name,
        state: 'failed',
        detail: `listTools failed: ${message}`,
        transport: config.type,
        auth_configured: authConfigured,
        tools: [],
        resources: [],
      })
      return
    }

    let resourceList: Awaited<ReturnType<McpClientSession['listResources']>> | null = null
    try {
      resourceList = await session.listResources()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Upstream only tolerates "Method not found"; rethrow otherwise.
      if (!/method not found/i.test(message)) {
        await session.close().catch(() => {})
        this.statuses.set(name, {
          name,
          state: 'failed',
          detail: `listResources failed: ${message}`,
          transport: config.type,
          auth_configured: authConfigured,
          tools: [],
          resources: [],
        })
        return
      }
    }

    const tools: McpToolInfo[] = toolList.tools.map((tool) => ({
      server_name: name,
      name: tool.name,
      description: tool.description ?? '',
      input_schema: { ...(tool.inputSchema ?? { type: 'object', properties: {} }) },
    }))

    const resources: McpResourceInfo[] = (resourceList?.resources ?? []).map(
      (r) => ({
        server_name: name,
        name: r.name && r.name.length > 0 ? r.name : r.uri,
        uri: r.uri,
        description: r.description ?? '',
      }),
    )

    this.sessions.set(name, session)
    this.statuses.set(name, {
      name,
      state: 'connected',
      detail: '',
      transport: config.type,
      auth_configured: authConfigured,
      tools,
      resources,
    })
  }
}

// ---------------------------------------------------------------------------
// Result stringifiers (upstream semantics)
// ---------------------------------------------------------------------------

function stringifyCallToolResult(result: CallToolResultLike): string {
  const parts: string[] = []
  for (const item of result.content ?? []) {
    if (item.type === 'text') {
      parts.push(String(item.text ?? ''))
    } else {
      parts.push(JSON.stringify(item))
    }
  }
  if (result.structuredContent != null && parts.length === 0) {
    parts.push(
      typeof result.structuredContent === 'string'
        ? result.structuredContent
        : JSON.stringify(result.structuredContent),
    )
  }
  if (parts.length === 0) parts.push('(no output)')
  return parts.join('\n').trim()
}

function stringifyReadResourceResult(result: ReadResourceResultLike): string {
  const parts: string[] = []
  for (const item of result.contents) {
    if (item.text != null) parts.push(String(item.text))
    else parts.push(String(item.blob ?? ''))
  }
  return parts.join('\n').trim()
}

function computeAuthConfigured(config: McpServerConfig): boolean {
  if (config.type === 'stdio') return Boolean(config.env && Object.keys(config.env).length > 0)
  if (config.type === 'http' || config.type === 'ws') {
    return Boolean(config.headers && Object.keys(config.headers).length > 0)
  }
  return false
}
