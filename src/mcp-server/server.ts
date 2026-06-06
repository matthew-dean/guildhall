import fs from 'node:fs/promises'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

import {
  appendTaskEvidence,
  createMcpCapabilityRequest,
  listMcpCapabilityRequests,
} from './evidence.js'
import {
  buildGuildhallResourceIndex,
  importMcpExternalMemoryBridgeRecord,
  listMcpExternalMemoryBridgeRecords,
  listMcpMemory,
  readTasks,
  readGuildhallResource,
  readMcpEffectiveContext,
  readMcpMemory,
  recordMcpMemoryObservation,
  rejectMcpExternalMemoryBridgeRecord,
  reviewMcpExternalMemoryBridgeRecord,
  updateMcpMemoryStatus,
} from './project-reader.js'
import type { GuildhallMcpContext } from './types.js'
import {
  applyContractChangeSet,
  buildTaskContextPacket,
  deriveQueueCandidates,
  deriveTaskRelationships,
  planTaskSplit,
  rejectContractChangeSet,
  ProjectDeliveryModel,
  readProjectDeliveryModel,
  revertAppliedContractResult,
  stageContractChangeSet,
  validateProjectPrimitiveSetupResult,
  validateFinishedWorkIntakeResult,
  writeProjectDeliveryModel,
  validateProjectDeliveryModel,
} from '@guildhall/runtime'
import type { Task } from '@guildhall/core'

const memoryStatus = z.enum(['observed', 'proposed', 'active', 'used', 'retired'])
const memoryType = z.enum([
  'project_fact',
  'project_habit',
  'user_preference',
  'project_skill',
  'codebase_knowledge',
  'product_idea',
])
const memoryScope = z.enum(['project', 'user_global', 'guildhall_product'])
const confidence = z.enum(['low', 'medium', 'high'])
const risk = z.enum(['low', 'medium', 'high'])
const freshness = z.enum(['fresh', 'recent', 'stale'])
const externalMemoryBridgeProvider = z.enum(['codex', 'codex-subagent', 'claude-code', 'other-mcp-client'])
const externalMemoryBridgeExchange = z.enum(['import', 'link'])
const externalMemoryBridgeReviewStatus = z.enum(['imported', 'reviewed', 'rejected'])
const externalMemoryBridgeRecordInput = z.object({
  id: z.string(),
  provider: externalMemoryBridgeProvider,
  externalAgentId: z.string().optional(),
  externalSessionId: z.string().optional(),
  exchange: externalMemoryBridgeExchange,
  sourceRef: z.string().optional(),
  scope: memoryScope,
  type: memoryType,
  summary: z.string(),
  content: z.string().optional(),
  tags: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]),
  structuralScopes: z.array(z.string()).default([]),
  taskKinds: z.array(z.string()).default([]),
  fileAreas: z.array(z.string()).default([]),
  confidence: confidence.default('medium'),
  risk: risk.default('low'),
  freshness,
  evidenceRefs: z.array(z.object({
    kind: z.string(),
    summary: z.string(),
    ref: z.string().optional(),
    path: z.string().optional(),
  })),
  reviewStatus: externalMemoryBridgeReviewStatus.default('imported'),
  reviewer: z.string().optional(),
  reviewedAt: z.string().optional(),
  rejectionReason: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export function buildGuildhallMcpManifest() {
  return {
    resources: [
      { uri: 'guildhall://project', name: 'Guildhall project' },
      { uri: 'guildhall://project/tasks', name: 'Guildhall tasks' },
      { uri: 'guildhall://project/artifacts', name: 'Guildhall artifacts' },
      { uri: 'guildhall://project/decisions', name: 'Guildhall decisions' },
      { uri: 'guildhall://project/feedback', name: 'Guildhall feedback' },
      { uri: 'guildhall://project/design', name: 'Guildhall design context' },
      { uri: 'guildhall://project/memory', name: 'Guildhall memory' },
      { uri: 'guildhall://project/learning', name: 'Guildhall learning' },
      { uri: 'guildhall://project/context', name: 'Guildhall context health' },
      { uri: 'guildhall://project/local-history', name: 'Guildhall local history' },
      { uri: 'guildhall://project/codebase-knowledge', name: 'Guildhall codebase knowledge' },
      { uri: 'guildhall://project/runtime', name: 'Guildhall runtime' },
      { uri: 'guildhall://project/capability-requests', name: 'Guildhall capability requests' },
      { uri: 'guildhall://project/external-agent-memory-bridge', name: 'External agent memory bridge' },
      { uri: 'guildhall://project/drivers', name: 'Guildhall delivery drivers' },
      { uri: 'guildhall://project/primitives', name: 'Guildhall primitives' },
      { uri: 'guildhall://project/agent-contracts', name: 'Guildhall agent contracts' },
      { uri: 'guildhall://project/validation-evidence', name: 'Guildhall validation evidence' },
    ],
    resourceTemplates: [
      { uriTemplate: 'guildhall://project/tasks/{taskId}', name: 'Guildhall task' },
      { uriTemplate: 'guildhall://project/artifacts/{artifactId}', name: 'Guildhall artifact' },
      { uriTemplate: 'guildhall://project/task-context/{taskId}', name: 'Guildhall task context packet' },
      { uriTemplate: 'guildhall://project/task-relationships/{taskId}', name: 'Guildhall task relationships' },
    ],
    tools: [
      { name: 'guildhall.read_artifact' },
      { name: 'guildhall.append_task_evidence' },
      { name: 'guildhall.validate_agent_contract' },
      { name: 'guildhall.validate_project_primitive_setup' },
      { name: 'guildhall.validate_finished_work_intake' },
      { name: 'guildhall.stage_agent_contract_result' },
      { name: 'guildhall.apply_agent_contract_result' },
      { name: 'guildhall.reject_agent_contract_result' },
      { name: 'guildhall.revert_agent_contract_result' },
      { name: 'guildhall.build_task_context_packet' },
      { name: 'guildhall.derive_task_relationships' },
      { name: 'guildhall.derive_queue_candidates' },
      { name: 'guildhall.plan_task_split' },
      { name: 'guildhall.create_capability_request' },
      { name: 'guildhall.list_capability_requests' },
      { name: 'guildhall.list_memory' },
      { name: 'guildhall.read_memory' },
      { name: 'guildhall.record_memory_observation' },
      { name: 'guildhall.update_memory_status' },
      { name: 'guildhall.read_effective_context' },
      { name: 'guildhall.list_external_memory_bridge_records' },
      { name: 'guildhall.import_external_memory_bridge_record' },
      { name: 'guildhall.review_external_memory_bridge_record' },
      { name: 'guildhall.reject_external_memory_bridge_record' },
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
    'guildhall.validate_agent_contract',
    {
      description: 'Validate a structured Guildhall agent contract result before it can become project state.',
      inputSchema: {
        contractId: z.string(),
        result: z.record(z.unknown()),
      },
    },
    async ({ contractId, result }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      if (contractId === 'project-primitive-setup') {
        const model = await readProjectDeliveryModel(ctx.projectRoot)
        const runtimeTasks = tasks as unknown as Task[]
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(validateProjectPrimitiveSetupResult({
              model,
              tasks: runtimeTasks,
              result,
              actor: 'mcp-agent',
            }), null, 2),
          }],
        }
      }
      if (contractId === 'task-context-packet') {
        const taskId = typeof result['taskId'] === 'string' ? result['taskId'] : ''
        const model = await readProjectDeliveryModel(ctx.projectRoot)
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              valid: Boolean(taskId && tasks.some(task => task.id === taskId)),
              normalized: taskId ? buildTaskContextPacket({ model, tasks: tasks as unknown as Task[], taskId }) : undefined,
              errors: taskId ? [] : [{ path: 'taskId', code: 'missing_required_field', message: 'taskId is required.' }],
              warnings: [],
            }, null, 2),
          }],
        }
      }
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            valid: false,
            errors: [{ path: 'contractId', code: 'unknown_contract', message: `Unknown contract ${contractId}.` }],
            warnings: [],
          }, null, 2),
        }],
      }
    },
  )

  server.registerTool(
    'guildhall.validate_project_primitive_setup',
    {
      description: 'Validate proposed project-local primitive setup output.',
      inputSchema: {
        projectId: z.string().optional(),
        result: z.record(z.unknown()),
      },
    },
    async ({ result }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const existing = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(validateProjectPrimitiveSetupResult({
            model: existing,
            tasks: tasks as unknown as Task[],
            result,
            actor: 'mcp-agent',
          }), null, 2),
        }],
      }
    },
  )

  server.registerTool(
    'guildhall.validate_finished_work_intake',
    {
      description: 'Validate retrospective finished-work intake so it does not fabricate Guildhall execution or code-only readiness.',
      inputSchema: {
        projectId: z.string().optional(),
        corpusRefs: z.array(z.string()).default([]),
        result: z.record(z.unknown()),
      },
    },
    async ({ corpusRefs, result }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{
          type: 'text',
          text: JSON.stringify(validateFinishedWorkIntakeResult({
            model,
            tasks: tasks as unknown as Task[],
            corpusRefs,
            result,
            actor: 'mcp-agent',
          }), null, 2),
        }],
      }
    },
  )

  server.registerTool(
    'guildhall.stage_agent_contract_result',
    {
      description: 'Validate and stage a Guildhall agent contract result for owner review without applying it.',
      inputSchema: {
        contractId: z.string(),
        result: z.record(z.unknown()),
        applyPolicy: z.enum(['auto_apply', 'owner_review', 'suggest_only']).default('owner_review'),
        actor: z.string().default('mcp-agent'),
      },
    },
    async ({ contractId, result, applyPolicy, actor }) => {
      if (contractId !== 'project-primitive-setup') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              valid: false,
              errors: [{ path: 'contractId', code: 'unknown_contract', message: `Unknown contract ${contractId}.` }],
              warnings: [],
            }, null, 2),
          }],
        }
      }
      const tasks = await readTasks(ctx.projectStateDir) as unknown as Task[]
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      const validation = validateProjectPrimitiveSetupResult({
        model,
        tasks,
        result,
        applyPolicy,
        actor,
      })
      if (!validation.valid || !validation.changeSet) {
        return { content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }] }
      }
      const staged = stageContractChangeSet({
        model,
        changeSet: validation.changeSet,
        actor,
      })
      await writeProjectDeliveryModel(ctx.projectRoot, staged)
      return { content: [{ type: 'text', text: JSON.stringify({ ...validation, staged: true }, null, 2) }] }
    },
  )

  server.registerTool(
    'guildhall.apply_agent_contract_result',
    {
      description: 'Validate and apply a Guildhall agent contract result into project delivery state.',
      inputSchema: {
        contractId: z.string(),
        result: z.record(z.unknown()),
        applyPolicy: z.enum(['auto_apply', 'owner_review', 'suggest_only']).default('owner_review'),
        actor: z.string().default('mcp-agent'),
        ownerOverrideReason: z.string().optional(),
      },
    },
    async ({ contractId, result, applyPolicy, actor, ownerOverrideReason }) => {
      if (contractId !== 'project-primitive-setup') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              valid: false,
              errors: [{ path: 'contractId', code: 'unknown_contract', message: `Unknown contract ${contractId}.` }],
              warnings: [],
            }, null, 2),
          }],
        }
      }
      const tasks = await readTasks(ctx.projectStateDir) as unknown as Task[]
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      const validation = validateProjectPrimitiveSetupResult({
        model,
        tasks,
        result,
        applyPolicy,
        actor,
      })
      if (!validation.valid || !validation.changeSet) {
        return { content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }] }
      }
      if (validation.changeSet.status === 'suggested') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...validation,
              applied: false,
              reason: 'applyPolicy suggest_only returns a reviewable change set without mutating project state.',
            }, null, 2),
          }],
        }
      }
      const applied = applyContractChangeSet({
        model,
        tasks,
        changeSet: validation.changeSet,
        actor,
        ownerOverrideReason,
      })
      await writeProjectDeliveryModel(ctx.projectRoot, applied.model)
      await writeTasks(ctx.projectStateDir, applied.tasks)
      return { content: [{ type: 'text', text: JSON.stringify({ ...validation, applied: applied.applied }, null, 2) }] }
    },
  )

  server.registerTool(
    'guildhall.reject_agent_contract_result',
    {
      description: 'Reject a validated Guildhall agent contract result and store the rejection so agents do not repeat it as fresh work.',
      inputSchema: {
        contractId: z.string(),
        result: z.record(z.unknown()),
        actor: z.string().default('mcp-agent'),
        reason: z.string(),
      },
    },
    async ({ contractId, result, actor, reason }) => {
      if (contractId !== 'project-primitive-setup') {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              valid: false,
              errors: [{ path: 'contractId', code: 'unknown_contract', message: `Unknown contract ${contractId}.` }],
              warnings: [],
            }, null, 2),
          }],
        }
      }
      const tasks = await readTasks(ctx.projectStateDir) as unknown as Task[]
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      const validation = validateProjectPrimitiveSetupResult({ model, tasks, result, actor })
      if (!validation.valid || !validation.changeSet) {
        return { content: [{ type: 'text', text: JSON.stringify(validation, null, 2) }] }
      }
      const rejected = rejectContractChangeSet({
        model,
        changeSet: validation.changeSet,
        actor,
        reason,
      })
      await writeProjectDeliveryModel(ctx.projectRoot, rejected)
      return { content: [{ type: 'text', text: JSON.stringify({ ...validation, rejected: rejected.rejectedCandidates.at(-1) }, null, 2) }] }
    },
  )

  server.registerTool(
    'guildhall.revert_agent_contract_result',
    {
      description: 'Revert an applied Guildhall contract result without deleting later-edited project state.',
      inputSchema: {
        resultId: z.string(),
        actor: z.string().default('mcp-agent'),
      },
    },
    async ({ resultId, actor }) => {
      const tasks = await readTasks(ctx.projectStateDir) as unknown as Task[]
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      const reverted = revertAppliedContractResult({
        model,
        tasks,
        resultId,
        actor,
      })
      await writeProjectDeliveryModel(ctx.projectRoot, reverted.model)
      await writeTasks(ctx.projectStateDir, reverted.tasks)
      return { content: [{ type: 'text', text: JSON.stringify(reverted, null, 2) }] }
    },
  )

  server.registerTool(
    'guildhall.build_task_context_packet',
    {
      description: 'Build the shared worker/UI context packet for one task.',
      inputSchema: { projectId: z.string().optional(), taskId: z.string() },
    },
    async ({ taskId }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{ type: 'text', text: JSON.stringify(buildTaskContextPacket({ model, tasks: tasks as unknown as Task[], taskId }), null, 2) }],
      }
    },
  )

  server.registerTool(
    'guildhall.derive_task_relationships',
    {
      description: 'Derive hierarchy, blockers, supports, primitive-use, and primitive-proof links for one task.',
      inputSchema: { projectId: z.string().optional(), taskId: z.string() },
    },
    async ({ taskId }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{ type: 'text', text: JSON.stringify(deriveTaskRelationships({ model, tasks: tasks as unknown as Task[], taskId }), null, 2) }],
      }
    },
  )

  server.registerTool(
    'guildhall.derive_queue_candidates',
    {
      description: 'Return runnable and blocked work using task blockers and primitive-proof blockers.',
      inputSchema: { projectId: z.string().optional(), activeDriverId: z.string().optional() },
    },
    async ({ activeDriverId }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{ type: 'text', text: JSON.stringify(deriveQueueCandidates({ model, tasks: tasks as unknown as Task[], activeDriverId }), null, 2) }],
      }
    },
  )

  server.registerTool(
    'guildhall.plan_task_split',
    {
      description: 'Return the validated split plan for a task, including child delivery metadata and primitive reference validation.',
      inputSchema: { projectId: z.string().optional(), taskId: z.string() },
    },
    async ({ taskId }) => {
      const tasks = await readTasks(ctx.projectStateDir)
      const model = await readProjectDeliveryModel(ctx.projectRoot)
      return {
        content: [{ type: 'text', text: JSON.stringify(planTaskSplit({ model, tasks: tasks as unknown as Task[], taskId }), null, 2) }],
      }
    },
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

  server.registerTool(
    'guildhall.list_memory',
    {
      description: 'List bounded Guildhall memory records with optional filters.',
      inputSchema: {
        statuses: z.array(memoryStatus).optional(),
        scopes: z.array(memoryScope).optional(),
        types: z.array(memoryType).optional(),
        tags: z.array(z.string()).optional(),
        domains: z.array(z.string()).optional(),
        taskKinds: z.array(z.string()).optional(),
        fileAreas: z.array(z.string()).optional(),
        minConfidence: confidence.optional(),
        maxRisk: risk.optional(),
        freshness: z.array(freshness).optional(),
        text: z.string().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await listMcpMemory(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.read_memory',
    {
      description: 'Read one Guildhall memory record by id.',
      inputSchema: {
        id: z.string(),
        scope: memoryScope.optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await readMcpMemory(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.record_memory_observation',
    {
      description: 'Record or replace a Guildhall memory observation.',
      inputSchema: {
        id: z.string(),
        scope: memoryScope,
        type: memoryType,
        status: memoryStatus.default('observed'),
        summary: z.string(),
        content: z.string(),
        tags: z.array(z.string()).default([]),
        domains: z.array(z.string()).default([]),
        taskKinds: z.array(z.string()).default([]),
        fileAreas: z.array(z.string()).default([]),
        confidence: confidence.default('medium'),
        risk: risk.default('low'),
        freshness: freshness.default('fresh'),
        evidenceRefs: z.array(z.object({
          kind: z.string(),
          summary: z.string(),
          ref: z.string().optional(),
          path: z.string().optional(),
        })).default([]),
        createdAt: z.string(),
        updatedAt: z.string(),
        source: z.string().default('mcp'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await recordMcpMemoryObservation(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.update_memory_status',
    {
      description: 'Update the lifecycle status of a Guildhall memory record.',
      inputSchema: {
        id: z.string(),
        status: memoryStatus,
        updatedAt: z.string().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await updateMcpMemoryStatus(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.read_effective_context',
    {
      description: 'Read the effective memory context Guildhall would inject for a task.',
      inputSchema: {
        taskId: z.string(),
        maxRecords: z.number().int().positive().max(20).optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await readMcpEffectiveContext(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.list_external_memory_bridge_records',
    {
      description: 'List reviewable external-agent memory bridge records.',
      inputSchema: {
        reviewStatus: externalMemoryBridgeReviewStatus.optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await listMcpExternalMemoryBridgeRecords(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.import_external_memory_bridge_record',
    {
      description: 'Import an external-agent memory bridge record for explicit review.',
      inputSchema: externalMemoryBridgeRecordInput.shape,
    },
    async (input) => ({
      content: [{ type: 'text', text: await importMcpExternalMemoryBridgeRecord(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.review_external_memory_bridge_record',
    {
      description: 'Review and promote one external-agent memory bridge record into ordinary memory.',
      inputSchema: {
        id: z.string(),
        reviewer: z.string(),
        updatedAt: z.string().optional(),
        memoryStatus: z.enum(['active', 'proposed', 'observed']).default('active'),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await reviewMcpExternalMemoryBridgeRecord(ctx, input) }],
    }),
  )

  server.registerTool(
    'guildhall.reject_external_memory_bridge_record',
    {
      description: 'Reject one external-agent memory bridge record without promoting it.',
      inputSchema: {
        id: z.string(),
        reviewer: z.string(),
        rejectionReason: z.string(),
        updatedAt: z.string().optional(),
      },
    },
    async (input) => ({
      content: [{ type: 'text', text: await rejectMcpExternalMemoryBridgeRecord(ctx, input) }],
    }),
  )

  return server
}

async function writeTasks(projectStateDir: string, tasks: Task[]): Promise<void> {
  const file = path.join(projectStateDir, 'TASKS.json')
  let existing: unknown = null
  try {
    existing = JSON.parse(await fs.readFile(file, 'utf8')) as unknown
  } catch {
    existing = null
  }
  const next = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? { ...existing, tasks, lastUpdated: new Date().toISOString() }
    : { tasks, lastUpdated: new Date().toISOString() }
  await fs.mkdir(projectStateDir, { recursive: true })
  await fs.writeFile(file, JSON.stringify(next, null, 2) + '\n', 'utf8')
}
