import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  appendTaskEvidence,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
} from './evidence.js'
import {
  buildGuildhallResourceIndex,
  readGuildhallResource,
} from './project-reader.js'
import type { GuildhallMcpContext } from './types.js'

export function buildGuildhallMcpManifest() {
  return {
    resources: [
      { uri: 'guildhall://project', name: 'Guildhall project' },
      { uri: 'guildhall://project/tasks', name: 'Guildhall tasks' },
      { uri: 'guildhall://project/artifacts', name: 'Guildhall artifacts' },
      { uri: 'guildhall://project/decisions', name: 'Guildhall decisions' },
      { uri: 'guildhall://project/memory', name: 'Guildhall memory' },
      { uri: 'guildhall://project/capability-requests', name: 'Guildhall capability requests' },
    ],
    resourceTemplates: [
      { uriTemplate: 'guildhall://project/tasks/{taskId}', name: 'Guildhall task' },
      { uriTemplate: 'guildhall://project/artifacts/{artifactId}', name: 'Guildhall artifact' },
    ],
    tools: [
      { name: 'guildhall.read_artifact' },
      { name: 'guildhall.append_task_evidence' },
      { name: 'guildhall.create_capability_request' },
      { name: 'guildhall.list_capability_requests' },
    ],
  }
}

export async function createGuildhallMcpServer(ctx: GuildhallMcpContext): Promise<McpServer> {
  const server = new McpServer({ name: 'guildhall', version: '0.1.0' })
  const resources = await buildGuildhallResourceIndex(ctx)
  for (const resource of resources) {
    server.registerResource(
      resource.uri,
      resource.uri,
      {
        title: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri) => ({
        contents: [{
          uri: uri.href,
          mimeType: resource.mimeType,
          text: await readGuildhallResource(ctx, uri.href),
        }],
      }),
    )
  }

  server.registerTool(
    'guildhall.read_artifact',
    {
      description: 'Read a Guildhall artifact by registered artifact id.',
      inputSchema: {
        artifactId: z.string(),
        format: z.enum(['markdown', 'json']).default('markdown'),
      },
    },
    async ({ artifactId }) => ({
      content: [{
        type: 'text',
        text: await readGuildhallResource(ctx, `guildhall://project/artifacts/${artifactId}`),
      }],
    }),
  )

  server.registerTool(
    'guildhall.append_task_evidence',
    {
      description: 'Append visible MCP-originated evidence to Guildhall project progress.',
      inputSchema: {
        taskId: z.string(),
        summary: z.string(),
        source: z.string().default('external-agent'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await appendTaskEvidence(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.create_capability_request',
    {
      description: 'Create a pending Guildhall capability request for host access.',
      inputSchema: {
        taskId: z.string(),
        requestedBy: z.string().default('external-agent'),
        reason: z.string(),
        hostPath: z.string(),
        access: z.enum(['read-only', 'read-write']).default('read-only'),
      },
    },
    async (input) => ({
      content: [{
        type: 'text',
        text: JSON.stringify(await createMcpCapabilityRequest(ctx, input), null, 2),
      }],
    }),
  )

  server.registerTool(
    'guildhall.list_capability_requests',
    {
      description: 'List current Guildhall capability requests.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: await listMcpCapabilityRequests(ctx) }],
    }),
  )

  return server
}
