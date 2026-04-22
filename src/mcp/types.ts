/**
 * Ported from openharness/src/openharness/mcp/types.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic BaseModel → zod discriminated union; the
 *     `type` field stays as the discriminator just like upstream.
 *   - `McpJsonConfig` is the disk shape used by plugins and project config
 *     files (key `mcpServers`). Kept as a thin zod object because we don't
 *     need field-level defaults at the object level — `mcpServerConfigSchema`
 *     handles per-entry validation.
 *   - `McpToolInfo`, `McpResourceInfo`, and `McpConnectionStatus` stay as
 *     plain TS types. Upstream `@dataclass(frozen=True)` maps to `readonly`
 *     property declarations; runtime freezing is not worth the overhead.
 *   - WebSocket transport is represented but `McpClientManager.connectAll`
 *     marks it as unsupported — matching upstream's runtime behavior, which
 *     lists the type but doesn't actually connect.
 */

import { z } from 'zod'

export const mcpStdioServerConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional().nullable(),
  cwd: z.string().optional().nullable(),
})

export const mcpHttpServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string()).default({}),
})

export const mcpWebSocketServerConfigSchema = z.object({
  type: z.literal('ws'),
  url: z.string(),
  headers: z.record(z.string()).default({}),
})

export const mcpServerConfigSchema = z.discriminatedUnion('type', [
  mcpStdioServerConfigSchema,
  mcpHttpServerConfigSchema,
  mcpWebSocketServerConfigSchema,
])

export type McpStdioServerConfig = z.infer<typeof mcpStdioServerConfigSchema>
export type McpHttpServerConfig = z.infer<typeof mcpHttpServerConfigSchema>
export type McpWebSocketServerConfig = z.infer<typeof mcpWebSocketServerConfigSchema>
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>

export const mcpJsonConfigSchema = z.object({
  mcpServers: z.record(mcpServerConfigSchema).default({}),
})
export type McpJsonConfig = z.infer<typeof mcpJsonConfigSchema>

export interface McpToolInfo {
  readonly server_name: string
  readonly name: string
  readonly description: string
  readonly input_schema: Record<string, unknown>
}

export interface McpResourceInfo {
  readonly server_name: string
  readonly name: string
  readonly uri: string
  readonly description: string
}

export type McpConnectionState = 'connected' | 'failed' | 'pending' | 'disabled'

export interface McpConnectionStatus {
  name: string
  state: McpConnectionState
  detail: string
  transport: string
  auth_configured: boolean
  tools: McpToolInfo[]
  resources: McpResourceInfo[]
}

export function newPendingStatus(
  name: string,
  transport: string,
): McpConnectionStatus {
  return {
    name,
    state: 'pending',
    detail: '',
    transport,
    auth_configured: false,
    tools: [],
    resources: [],
  }
}
