/**
 * Ported from openharness/src/openharness/tools/mcp_auth_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `load_settings()` / `save_settings()` → `readWorkspaceConfig` /
 *     `writeWorkspaceConfig`. Guildhall stores MCP server configs in the
 *     project's `guildhall.yaml` under `mcp.servers`, not a user-global
 *     settings file. The workspace root is discovered via
 *     `findWorkspaceRoot(ctx.cwd)` — falling back to `ctx.cwd`.
 *   - `config.model_copy(update=...)` → direct shallow clone + assignment.
 *   - `mcp_manager` is looked up from `ctx.metadata['mcp_manager']`; when
 *     absent, the tool still persists to YAML so the next boot picks up the
 *     change, but can't reconnect in-place.
 *   - Unlike upstream, we skip the manager-driven config fallback
 *     (`get_server_config`) when the workspace YAML has no entry — the YAML
 *     *is* the source of truth, so a missing entry is an error.
 */

import { defineTool } from '@guildhall/engine'
import { z } from 'zod'
import {
  findWorkspaceRoot,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from '@guildhall/config'
import type {
  McpServerConfig,
  McpStdioServerConfig,
  McpHttpServerConfig,
  McpWebSocketServerConfig,
} from '@guildhall/mcp'

interface McpManagerLike {
  updateServerConfig: (name: string, config: McpServerConfig) => void
  reconnectAll: () => Promise<void>
  getServerConfig?: (name: string) => McpServerConfig | undefined
}

const mcpAuthInputSchema = z.object({
  serverName: z.string().describe('Configured MCP server name'),
  mode: z.enum(['bearer', 'header', 'env']).describe('Auth mode: bearer, header, or env'),
  value: z.string().describe('Secret value to persist'),
  key: z.string().optional().describe('Header or env key override'),
})
export type McpAuthInput = z.input<typeof mcpAuthInputSchema>

function isStdio(c: McpServerConfig): c is McpStdioServerConfig {
  return c.type === 'stdio'
}
function isHttpOrWs(c: McpServerConfig): c is McpHttpServerConfig | McpWebSocketServerConfig {
  return c.type === 'http' || c.type === 'ws'
}

export function applyMcpAuth(
  config: McpServerConfig,
  mode: 'bearer' | 'header' | 'env',
  value: string,
  key: string | undefined,
): { config: McpServerConfig } | { error: string } {
  if (isStdio(config)) {
    if (mode !== 'env' && mode !== 'bearer') {
      return { error: 'stdio MCP auth supports env or bearer modes' }
    }
    const envKey = key ?? 'MCP_AUTH_TOKEN'
    const env = { ...(config.env ?? {}) }
    env[envKey] = mode === 'bearer' ? `Bearer ${value}` : value
    return { config: { ...config, env } }
  }
  if (isHttpOrWs(config)) {
    if (mode !== 'header' && mode !== 'bearer') {
      return { error: 'http/ws MCP auth supports header or bearer modes' }
    }
    const headerKey = key ?? 'Authorization'
    const headers = { ...config.headers }
    headers[headerKey] =
      mode === 'bearer' && headerKey === 'Authorization' ? `Bearer ${value}` : value
    return { config: { ...config, headers } }
  }
  return { error: 'Unsupported MCP server config type' }
}

export const mcpAuthTool = defineTool({
  name: 'mcp-auth',
  description:
    'Configure auth for an MCP server and reconnect active sessions when possible.',
  inputSchema: mcpAuthInputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      serverName: { type: 'string' },
      mode: { type: 'string', enum: ['bearer', 'header', 'env'] },
      value: { type: 'string' },
      key: { type: 'string' },
    },
    required: ['serverName', 'mode', 'value'],
    additionalProperties: false,
  },
  isReadOnly: () => false,
  execute: async (input, ctx) => {
    const root = findWorkspaceRoot(ctx.cwd) ?? ctx.cwd
    let workspace
    try {
      workspace = readWorkspaceConfig(root)
    } catch (err) {
      return { output: `Failed to read guildhall.yaml: ${String(err)}`, is_error: true }
    }

    const servers = workspace.mcp?.servers ?? {}
    const existing = servers[input.serverName]
    if (!existing) {
      return {
        output: `Unknown MCP server: ${input.serverName}`,
        is_error: true,
      }
    }

    const result = applyMcpAuth(existing, input.mode, input.value, input.key)
    if ('error' in result) {
      return { output: result.error, is_error: true }
    }

    const nextWorkspace = {
      ...workspace,
      mcp: {
        servers: { ...servers, [input.serverName]: result.config },
      },
    }
    try {
      writeWorkspaceConfig(root, nextWorkspace)
    } catch (err) {
      return { output: `Failed to save guildhall.yaml: ${String(err)}`, is_error: true }
    }

    const manager = ctx.metadata['mcp_manager'] as McpManagerLike | undefined
    if (manager && typeof manager.updateServerConfig === 'function') {
      try {
        manager.updateServerConfig(input.serverName, result.config)
        if (typeof manager.reconnectAll === 'function') {
          await manager.reconnectAll()
        }
      } catch (err) {
        return {
          output: `Saved MCP auth for ${input.serverName}, but reconnect failed: ${String(err)}`,
          is_error: true,
        }
      }
    }

    return { output: `Saved MCP auth for ${input.serverName}`, is_error: false }
  },
})
