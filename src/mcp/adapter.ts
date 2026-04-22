/**
 * Ported from:
 *   openharness/src/openharness/tools/mcp_tool.py
 *   openharness/src/openharness/tools/list_mcp_resources_tool.py
 *   openharness/src/openharness/tools/read_mcp_resource_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Pydantic `create_model` → Zod `z.object(shape)` built at runtime from
 *     the MCP tool's input schema. We keep the same JSON-type → Zod-type
 *     mapping (string, number, integer, boolean, array, object).
 *   - `McpToolAdapter` class → `createMcpToolAdapter()` factory matching the
 *     guildhall `defineTool({...})` pattern. No behavioral difference.
 *   - Name segments are sanitized with the same regex upstream uses; the
 *     `mcp__<server>__<tool>` shape is preserved for wire parity.
 */

import { z } from 'zod'
import { defineTool, type AnyTool } from '@guildhall/engine'

import type { McpClientManager } from './client.js'
import { McpServerNotConnectedError } from './client.js'
import type { McpToolInfo } from './types.js'

// ---------------------------------------------------------------------------
// MCP → guildhall tool adapter
// ---------------------------------------------------------------------------

export function createMcpToolAdapter(
  manager: McpClientManager,
  toolInfo: McpToolInfo,
): AnyTool {
  const serverSegment = sanitizeToolSegment(toolInfo.server_name)
  const toolSegment = sanitizeToolSegment(toolInfo.name)
  const name = `mcp__${serverSegment}__${toolSegment}`
  const inputSchema = buildZodSchema(toolInfo.input_schema)

  return defineTool<Record<string, unknown>>({
    name,
    description: toolInfo.description || `MCP tool ${toolInfo.name}`,
    inputSchema,
    jsonSchema: toolInfo.input_schema,
    isReadOnly: () => false,
    execute: async (input) => {
      try {
        const output = await manager.callTool(
          toolInfo.server_name,
          toolInfo.name,
          stripUndefined(input),
        )
        return { output, is_error: false }
      } catch (err) {
        if (err instanceof McpServerNotConnectedError) {
          return { output: err.message, is_error: true }
        }
        throw err
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Built-in resource tools
// ---------------------------------------------------------------------------

const listMcpResourcesInputSchema = z.object({}).passthrough()

export function createListMcpResourcesTool(manager: McpClientManager): AnyTool {
  return defineTool<Record<string, unknown>>({
    name: 'list_mcp_resources',
    description: 'List MCP resources available from connected servers.',
    inputSchema: listMcpResourcesInputSchema,
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
    isReadOnly: () => true,
    execute: async () => {
      const resources = manager.listResources()
      if (resources.length === 0) return { output: '(no MCP resources)', is_error: false }
      const lines = resources.map((r) =>
        `${r.server_name}:${r.uri} ${r.description}`.trim(),
      )
      return { output: lines.join('\n'), is_error: false }
    },
  })
}

const readMcpResourceInputSchema = z.object({
  server: z.string().describe('MCP server name'),
  uri: z.string().describe('Resource URI'),
})

export function createReadMcpResourceTool(manager: McpClientManager): AnyTool {
  return defineTool<z.infer<typeof readMcpResourceInputSchema>>({
    name: 'read_mcp_resource',
    description: 'Read an MCP resource by server and URI.',
    inputSchema: readMcpResourceInputSchema,
    jsonSchema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'MCP server name' },
        uri: { type: 'string', description: 'Resource URI' },
      },
      required: ['server', 'uri'],
      additionalProperties: false,
    },
    isReadOnly: () => true,
    execute: async ({ server, uri }) => {
      try {
        const output = await manager.readResource(server, uri)
        return { output, is_error: false }
      } catch (err) {
        if (err instanceof McpServerNotConnectedError) {
          return { output: err.message, is_error: true }
        }
        throw err
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Bundle helper
// ---------------------------------------------------------------------------

/**
 * Build the full set of MCP tools to inject into an agent's tool registry:
 * one `mcp__<server>__<tool>` adapter per tool the manager has discovered,
 * plus the two built-in resource tools.
 */
export function createMcpTools(manager: McpClientManager): AnyTool[] {
  const tools: AnyTool[] = [
    createListMcpResourcesTool(manager),
    createReadMcpResourceTool(manager),
  ]
  for (const info of manager.listTools()) {
    tools.push(createMcpToolAdapter(manager, info))
  }
  return tools
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeToolSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '_')
  if (cleaned.length === 0) return 'tool'
  if (!/^[A-Za-z]/.test(cleaned)) return `mcp_${cleaned}`
  return cleaned
}

function buildZodSchema(schema: Record<string, unknown>): z.ZodType<Record<string, unknown>> {
  const properties =
    (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {}
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : [])
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(properties)) {
    const propType = typeof prop?.type === 'string' ? prop.type : ''
    const base = jsonTypeToZod(propType)
    shape[key] = required.has(key) ? base : base.optional()
  }
  return z.object(shape) as unknown as z.ZodType<Record<string, unknown>>
}

function jsonTypeToZod(jsonType: string): z.ZodTypeAny {
  switch (jsonType) {
    case 'string':
      return z.string()
    case 'integer':
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(z.unknown())
    case 'object':
      return z.record(z.unknown())
    default:
      return z.unknown()
  }
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) out[k] = v
  }
  return out
}
