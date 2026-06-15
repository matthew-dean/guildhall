import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { summarizeDesignSystem, type Task } from '@guildhall/core'
import { loadCodebaseMap, loadCodebaseMapStaleState } from '@guildhall/corpus-map'
import {
  buildMemoryCoreCandidatePacket,
  resolveMemoryPaths,
} from '@guildhall/memory-core'
import {
  getProjectContextDebugLedgerPath,
  getProjectLocalHistoryHealth,
  getProjectSystemStatePathFromMemoryDir,
} from '@guildhall/sessions'
import { load as yamlLoad } from 'js-yaml'
import {
  buildTaskContextPacket,
  buildEffectiveMemoryPacket,
  buildDesignIntentSurrogate,
  buildDesignSystemCatalog,
  deriveTaskRelationships,
  importExternalMemoryBridgeRecord,
  listPrimitivesWithRelations,
  listCapabilityRequests,
  listExternalMemoryBridgeRecords,
  listMemoryRecords,
  readGlobalLearning,
  readDesignFeedbackStore,
  loadDesignSystem,
  loadEffectiveDesignTaste,
  readProjectLearning,
  readProjectRuntimeState,
  readProjectDeliveryModel,
  validateProjectDeliveryModel,
  recordMemoryObservation,
  rejectExternalMemoryBridgeRecord,
  reviewExternalMemoryBridgeRecord,
  updateMemoryStatus,
  type ContextDebugRecord,
  type ExternalMemoryBridgeRecordInput,
  type ExternalMemoryBridgeReviewStatus,
  type MemoryQuery,
  type MemoryRecordInput,
  type MemoryStatus,
} from '@guildhall/runtime'

import {
  artifactUri,
  parseGuildhallUri,
  projectUri,
  taskUri,
  type GuildhallMcpContext,
} from './types.js'

export interface GuildhallMcpResource {
  uri: string
  name: string
  description: string
  mimeType: 'text/markdown'
}

export async function buildGuildhallResourceIndex(
  ctx: GuildhallMcpContext,
): Promise<GuildhallMcpResource[]> {
  const tasks = await readTasks(ctx.projectStateDir)
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  return [
    {
      uri: projectUri(),
      name: 'Guildhall project',
      description: 'Compact project context.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/tasks',
      name: 'Guildhall tasks',
      description: 'Active task queue summary.',
      mimeType: 'text/markdown',
    },
    ...tasks.map((task) => ({
      uri: taskUri(task.id),
      name: task.title || task.id,
      description: `Task ${task.id} (${task.status || 'unknown'})`,
      mimeType: 'text/markdown' as const,
    })),
    {
      uri: 'guildhall://project/artifacts',
      name: 'Guildhall artifacts',
      description: 'Registered artifact IDs.',
      mimeType: 'text/markdown',
    },
    ...artifacts.map((artifact) => ({
      uri: artifactUri(artifact.id),
      name: artifact.id,
      description: artifact.description || artifact.path,
      mimeType: 'text/markdown' as const,
    })),
    {
      uri: 'guildhall://project/decisions',
      name: 'Guildhall decisions',
      description: 'Committed decision log.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/feedback',
      name: 'Guildhall feedback',
      description: 'Accepted feedback, constraints, and decision packets for agents to carry forward.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/design',
      name: 'Guildhall design context',
      description: 'Design system, taste, preview/catalog, and design feedback summary.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/memory',
      name: 'Guildhall memory',
      description: 'Queryable project, user, skill, and learning memory.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/learning',
      name: 'Guildhall learning',
      description: 'Project and user learning suggestions.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/context',
      name: 'Guildhall context health',
      description: 'Latest bounded context-debug records.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/local-history',
      name: 'Guildhall local history',
      description: 'Bounded local-history health summary.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/codebase-knowledge',
      name: 'Guildhall codebase knowledge',
      description: 'Codebase map freshness and summary.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/runtime',
      name: 'Guildhall runtime',
      description: 'Runtime state, migration mode, mounts, and health.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/capability-requests',
      name: 'Capability requests',
      description: 'Current capability request state.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/external-agent-memory-bridge',
      name: 'External agent memory bridge',
      description: 'Reviewable external-agent memory exchange records.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/drivers',
      name: 'Guildhall delivery drivers',
      description: 'Project-local delivery driver registry.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/primitives',
      name: 'Guildhall primitives',
      description: 'Project-local primitive registry with consumers and proof links.',
      mimeType: 'text/markdown',
    },
    ...tasks.map((task) => ({
      uri: `guildhall://project/task-context/${task.id}`,
      name: `${task.title || task.id} context packet`,
      description: `Shared worker/UI context packet for ${task.id}.`,
      mimeType: 'text/markdown' as const,
    })),
    ...tasks.map((task) => ({
      uri: `guildhall://project/task-relationships/${task.id}`,
      name: `${task.title || task.id} relationships`,
      description: `Hierarchy, blockers, supports, primitive-use, and proof links for ${task.id}.`,
      mimeType: 'text/markdown' as const,
    })),
    {
      uri: 'guildhall://project/agent-contracts',
      name: 'Guildhall agent contracts',
      description: 'Available structured contracts, schemas, validation tools, and apply policies.',
      mimeType: 'text/markdown',
    },
    {
      uri: 'guildhall://project/validation-evidence',
      name: 'Guildhall validation evidence',
      description: 'Validation results and owner overrides that affected project state.',
      mimeType: 'text/markdown',
    },
  ]
}

export async function readGuildhallResource(
  ctx: GuildhallMcpContext,
  uri: string,
): Promise<string> {
  const parsed = parseGuildhallUri(uri)
  if (parsed.kind === 'project') return renderProject(ctx)
  if (parsed.kind === 'tasks') return renderTasks(ctx)
  if (parsed.kind === 'task') return renderTask(ctx, parsed.taskId)
  if (parsed.kind === 'artifacts') return renderArtifacts(ctx)
  if (parsed.kind === 'artifact') return renderArtifact(ctx, parsed.artifactId)
  if (parsed.kind === 'decisions') {
    return readOptional(
      path.join(ctx.projectStateDir, 'DECISIONS.md'),
      '# Decisions\n\nNo decisions recorded.\n',
    )
  }
  if (parsed.kind === 'feedback') {
    return renderFeedback(ctx)
  }
  if (parsed.kind === 'design') {
    return renderDesign(ctx)
  }
  if (parsed.kind === 'memory') {
    return renderMemory(ctx)
  }
  if (parsed.kind === 'learning') {
    return renderLearning(ctx)
  }
  if (parsed.kind === 'context') {
    return renderContext(ctx)
  }
  if (parsed.kind === 'localHistory') {
    return renderLocalHistory(ctx)
  }
  if (parsed.kind === 'codebaseKnowledge') {
    return renderCodebaseKnowledge(ctx)
  }
  if (parsed.kind === 'runtime') {
    return renderRuntime(ctx)
  }
  if (parsed.kind === 'capabilityRequests') {
    return renderCapabilityRequests(ctx)
  }
  if (parsed.kind === 'externalAgentMemoryBridge') {
    return renderExternalAgentMemoryBridge(ctx)
  }
  if (parsed.kind === 'drivers') {
    return renderDeliveryDrivers(ctx)
  }
  if (parsed.kind === 'primitives') {
    return renderPrimitives(ctx)
  }
  if (parsed.kind === 'taskContext') {
    return renderTaskContextPacket(ctx, parsed.taskId)
  }
  if (parsed.kind === 'taskRelationships') {
    return renderTaskRelationships(ctx, parsed.taskId)
  }
  if (parsed.kind === 'agentContracts') {
    return renderAgentContracts(ctx)
  }
  if (parsed.kind === 'validationEvidence') {
    return renderValidationEvidence(ctx)
  }
  return '# Unknown\n'
}

async function renderDeliveryDrivers(ctx: GuildhallMcpContext): Promise<string> {
  const model = await readProjectDeliveryModel(ctx.projectRoot)
  if (model.drivers.length === 0) return '# Delivery Drivers\n\nNo delivery drivers recorded.\n'
  return trimForMcp(redactForMcp([
    '# Delivery Drivers',
    '',
    ...model.drivers.flatMap(driver => [
      `## ${driver.label}`,
      '',
      `- Id: ${driver.id}`,
      `- Role: ${driver.role}`,
      ...(driver.kind ? [`- Kind: ${driver.kind}`] : []),
      ...(driver.paths.length > 0 ? [`- Paths: ${driver.paths.join(', ')}`] : []),
      ...(driver.domains.length > 0 ? [`- Domains: ${driver.domains.join(', ')}`] : []),
      ...(driver.description ? [`- Description: ${driver.description}`] : []),
      '',
    ]),
  ].join('\n')))
}

async function renderPrimitives(ctx: GuildhallMcpContext): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  const runtimeTasks = tasks as unknown as Task[]
  const model = await readProjectDeliveryModel(ctx.projectRoot)
  const validation = validateProjectDeliveryModel({ model, tasks: runtimeTasks, projectRoot: ctx.projectRoot })
  const primitives = listPrimitivesWithRelations(model, runtimeTasks)
  if (primitives.length === 0) return '# Primitives\n\nNo project-local primitives recorded.\n'
  return trimForMcp(redactForMcp([
    '# Primitives',
    '',
    `- Validation: ${validation.valid ? 'valid' : 'invalid'}`,
    validation.errors.length > 0 ? `- Errors: ${validation.errors.map(error => `${error.code} at ${error.path}`).join('; ')}` : '',
    '',
    ...primitives.flatMap(primitive => [
      `## ${primitive.label}`,
      '',
      `- Id: ${primitive.id}`,
      `- Kind: ${primitive.kind}`,
      `- Status: ${primitive.status}`,
      ...(primitive.provider ? [`- Provider: ${primitive.provider}`] : []),
      ...(primitive.paths.length > 0 ? [`- Paths: ${primitive.paths.join(', ')}`] : []),
      ...(primitive.dependsOn.length > 0 ? [`- Depends on primitives: ${primitive.dependsOn.join(', ')}`] : []),
      ...(primitive.proof.length > 0 ? [`- Required proof: ${primitive.proof.join(', ')}`] : []),
      ...(primitive.invariants.length > 0 ? ['- Invariants:', ...primitive.invariants.map(invariant => `  - ${invariant}`)] : []),
      ...(primitive.consumers.length > 0
        ? [`- Used by tasks: ${primitive.consumers.filter(consumer => consumer.kind === 'task').map(consumer => consumer.id).join(', ')}`]
        : []),
      ...(primitive.provingTasks.length > 0 ? [`- Proving tasks: ${primitive.provingTasks.map(task => task.id).join(', ')}`] : []),
      '',
    ]),
  ].filter(Boolean).join('\n')))
}

async function renderTaskContextPacket(ctx: GuildhallMcpContext, taskId: string): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  const model = await readProjectDeliveryModel(ctx.projectRoot)
  const packet = buildTaskContextPacket({ model, tasks: tasks as unknown as Task[], taskId })
  return trimForMcp(redactForMcp([
    `# Task Context Packet: ${taskId}`,
    '',
    `- Why this now: ${packet.whyThisNow}`,
    packet.deliveryIntent.driver ? `- Driver: ${packet.deliveryIntent.driver.label}` : '',
    packet.deliveryIntent.provider ? `- Provider: ${packet.deliveryIntent.provider.label}` : '',
    packet.deliveryIntent.containingPackage ? `- Package: ${packet.deliveryIntent.containingPackage.title}` : '',
    `- Runnable now: ${packet.executionOrder.runnableNow ? 'yes' : 'no'}`,
    packet.executionOrder.recursiveBlockers.length > 0
      ? `- Blocked by: ${packet.executionOrder.recursiveBlockers.map(task => `${task.id} ${task.title}`).join(', ')}`
      : '',
    packet.primitiveContext.direct.length > 0
      ? `- Uses primitives: ${packet.primitiveContext.direct.map(primitive => primitive.label).join(', ')}`
      : '',
    packet.primitiveContext.blockers.length > 0
      ? `- Primitive blockers: ${packet.primitiveContext.blockers.map(primitive => primitive.label).join(', ')}`
      : '',
    packet.proofContext.provesPrimitives.length > 0
      ? `- Proves primitives: ${packet.proofContext.provesPrimitives.map(primitive => primitive.label).join(', ')}`
      : '',
    '',
    '## Persona',
    '',
    `- ${packet.persona.label}`,
    ...packet.persona.guardrails.map(guardrail => `- ${guardrail}`),
    '',
    '## Correction Hooks',
    '',
    ...packet.correctionHooks.map(hook => `- ${hook.field}: ${hook.label}`),
    '',
  ].filter(Boolean).join('\n')))
}

async function renderTaskRelationships(ctx: GuildhallMcpContext, taskId: string): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  const model = await readProjectDeliveryModel(ctx.projectRoot)
  const relationships = deriveTaskRelationships({ model, tasks: tasks as unknown as Task[], taskId })
  return trimForMcp(redactForMcp([
    `# Task Relationships: ${taskId}`,
    '',
    relationships.hierarchy.parent ? `- Parent package: ${relationships.hierarchy.parent.id} ${relationships.hierarchy.parent.title}` : '',
    relationships.hierarchy.children.length > 0
      ? `- Nested work: ${relationships.hierarchy.children.map(task => `${task.id} ${task.title}`).join(', ')}`
      : '',
    relationships.dependencies.directBlockers.length > 0
      ? `- Blocked by: ${relationships.dependencies.directBlockers.map(task => `${task.id} ${task.title}`).join(', ')}`
      : '',
    relationships.dependencies.blocks.length > 0
      ? `- Blocks: ${relationships.dependencies.blocks.map(task => `${task.id} ${task.title}`).join(', ')}`
      : '',
    relationships.supports.length > 0 ? `- Supports: ${relationships.supports.join(', ')}` : '',
    relationships.primitiveUse.direct.length > 0
      ? `- Uses primitives: ${relationships.primitiveUse.direct.map(primitive => primitive.label).join(', ')}`
      : '',
    relationships.primitiveUse.ancestors.length > 0
      ? `- Primitive ancestors: ${relationships.primitiveUse.ancestors.map(primitive => primitive.label).join(', ')}`
      : '',
    relationships.primitiveProof.proves.length > 0
      ? `- Proves primitives: ${relationships.primitiveProof.proves.map(primitive => primitive.label).join(', ')}`
      : '',
    '',
  ].filter(Boolean).join('\n')))
}

async function renderAgentContracts(_ctx: GuildhallMcpContext): Promise<string> {
  return [
    '# Agent Contracts',
    '',
    '- project-primitive-setup: validates proposed project-local primitives, task links, proof tasks, rejected candidates, and owner questions.',
    '- finished-work-intake: validates shipped packages, observed proof, missing proof, future tasks, and rejected primitive candidates without fabricating completed Guildhall work.',
    '- task-split-plan: validates split child delivery metadata, primitive references, proof links, and child dependency mapping before materializing nested work.',
    '- task-context-packet: builds deterministic worker/UI context from drivers, task blockers, primitive ancestors, proof obligations, and correction hooks.',
    '',
    'Validation tools: guildhall.validate_agent_contract, guildhall.validate_project_primitive_setup, guildhall.validate_finished_work_intake, guildhall.plan_task_split.',
    '',
  ].join('\n')
}

async function renderValidationEvidence(ctx: GuildhallMcpContext): Promise<string> {
  const model = await readProjectDeliveryModel(ctx.projectRoot)
  if (model.validationEvidence.length === 0) return '# Validation Evidence\n\nNo validation evidence recorded.\n'
  return trimForMcp(redactForMcp([
    '# Validation Evidence',
    '',
    ...model.validationEvidence.slice(0, 30).map((record, index) => `- ${index + 1}: ${JSON.stringify(record)}`),
    model.validationEvidence.length > 30 ? `- [truncated ${model.validationEvidence.length - 30} more records]` : '',
    '',
  ].filter(Boolean).join('\n')))
}

async function renderExternalAgentMemoryBridge(ctx: GuildhallMcpContext): Promise<string> {
  const store = await listExternalMemoryBridgeRecords({ memoryDir: ctx.projectStateDir })
  if (store.records.length === 0) {
    return '# External Agent Memory Bridge\n\nNo external memory bridge records.\n'
  }
  const counts = countBy(store.records, (record) => record.reviewStatus)
  return trimForMcp(redactForMcp([
    '# External Agent Memory Bridge',
    '',
    `- Records: ${store.records.length}`,
    `- Imported: ${counts.imported ?? 0}`,
    `- Reviewed: ${counts.reviewed ?? 0}`,
    `- Rejected: ${counts.rejected ?? 0}`,
    '',
    '## Records',
    '',
    ...store.records.slice(0, 30).map((record) =>
      `- ${record.id}: ${record.reviewStatus} ${record.provider} ${record.scope}/${record.type} (${record.confidence}/${record.risk}) - ${record.summary}`,
    ),
    store.records.length > 30 ? `- [truncated ${store.records.length - 30} more records]` : '',
    '',
    'Imported records are reviewable bridge records only. They enter ordinary effective memory through explicit review.',
    '',
  ].filter(Boolean).join('\n')))
}

async function renderCapabilityRequests(ctx: GuildhallMcpContext): Promise<string> {
  const requests = listCapabilityRequests(ctx.projectStateDir)
  if (requests.length === 0) return '# Capability Requests\n\nNo capability requests.\n'
  return [
    '# Capability Requests',
    '',
    ...requests.flatMap((request) => {
      const lines = [
        `- ${request.id}: ${request.status} ${request.mount.access} ${request.mount.hostPath} for ${request.taskId}.`,
        `  - Reason: ${request.reason}`,
        `  - Duration: ${request.duration}`,
      ]
      if (request.fallback) lines.push(`  - Fallback: ${request.fallback}`)
      if (request.blockedReason) lines.push(`  - Blocked: ${request.blockedReason}`)
      if (request.grant) {
        lines.push(`  - Grant: ${request.grant.status} ${request.grant.access} ${request.grant.hostPath} -> ${request.grant.containerPath}`)
      }
      return lines
    }),
    '',
  ].join('\n')
}

async function renderProject(ctx: GuildhallMcpContext): Promise<string> {
  const config = await readOptional(path.join(ctx.projectRoot, 'guildhall.yaml'), '')
  const [runtime, memoryRecords, latestContext, codebaseMap, staleState] = await Promise.all([
    readProjectRuntimeState(ctx.projectRoot),
    listMemoryRecords({ memoryDir: ctx.projectStateDir }),
    readLatestContextDebug(ctx.projectRoot, 1),
    loadCodebaseMap(ctx.projectStateDir),
    loadCodebaseMapStaleState(ctx.projectStateDir),
  ])
  const memoryByStatus = countBy(memoryRecords, (record) => record.status)
  const context = latestContext[0]
  return [
    '# Guildhall Project',
    '',
    `Runtime: ${ctx.runtime.kind}`,
    '',
    '## Runtime Health',
    '',
    `- Status: ${runtime.status}`,
    `- Backend: ${runtime.backend}`,
    `- Health: ${runtime.health.status}${runtime.health.checkedAt ? ` (${runtime.health.checkedAt})` : ''}`,
    `- Migration: ${runtime.migration.mode}`,
    '',
    '## Memory Health',
    '',
    `- Records: ${memoryRecords.length}`,
    `- Active: ${memoryByStatus.active ?? 0}`,
    `- Proposed: ${(memoryByStatus.observed ?? 0) + (memoryByStatus.proposed ?? 0)}`,
    `- Used: ${memoryByStatus.used ?? 0}`,
    `- Retired: ${memoryByStatus.retired ?? 0}`,
    '',
    '## Codebase Knowledge',
    '',
    codebaseMap
      ? `- Generated: ${codebaseMap.generatedAt}`
      : '- Generated: missing',
    codebaseMap
      ? `- Shape: ${Object.keys(codebaseMap.files).length} files, ${codebaseMap.areas.length} areas, ${codebaseMap.abstractions.length} abstractions`
      : '- Shape: unavailable',
    staleState
      ? `- Freshness: stale since ${staleState.at} (${staleState.reason})`
      : '- Freshness: current or unknown',
    '',
    '## Latest Context Health',
    '',
    context
      ? `- Latest: ${context.at} for ${context.taskId} via ${context.agentName}`
      : '- Latest: no context-debug records',
    context
      ? `- Health: ${context.health.length > 0 ? context.health.map((warning) => `${warning.severity}:${warning.code}`).join(', ') : 'clean'}`
      : '- Health: unavailable',
    '',
    '## Config',
    '',
    '```yaml',
    trimForMcp(redactForMcp(config)),
    '```',
    '',
  ].join('\n')
}

async function renderTasks(ctx: GuildhallMcpContext): Promise<string> {
  const tasks = await readTasks(ctx.projectStateDir)
  if (tasks.length === 0) return '# Tasks\n\nNo active tasks.\n'
  return [
    '# Tasks',
    '',
    ...tasks.map((task) => `- ${task.id}: ${task.title || '(untitled)'} (${task.status || 'unknown'})`),
    '',
  ].join('\n')
}

async function renderTask(ctx: GuildhallMcpContext, taskId: string): Promise<string> {
  const task = (await readTasks(ctx.projectStateDir)).find((candidate) => candidate.id === taskId)
  if (!task) throw new Error(`Task not found: ${taskId}`)
  return [
    `# ${task.title || task.id}`,
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
  ].join('\n')
}

async function renderArtifacts(ctx: GuildhallMcpContext): Promise<string> {
  const artifacts = await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir)
  if (artifacts.length === 0) return '# Artifacts\n\nNo registered artifacts.\n'
  return [
    '# Artifacts',
    '',
    ...artifacts.map((artifact) => `- ${artifact.id}: ${artifact.description || artifact.path}`),
    '',
  ].join('\n')
}

async function renderFeedback(ctx: GuildhallMcpContext): Promise<string> {
  const design = await readDesignFeedbackStore(ctx.projectStateDir)
  const acceptedOwnerFeedback = design.ownerFeedback.filter((feedback) => feedback.status === 'accepted')
  const latestPacket = design.decisionPackets.at(-1)
  if (
    acceptedOwnerFeedback.length === 0 &&
    design.decisionPackets.length === 0 &&
    design.decisions.length === 0 &&
    design.candidates.length === 0
  ) {
    return '# Feedback\n\nNo feedback or decision packets recorded.\n'
  }
  return trimForMcp(redactForMcp([
    '# Feedback',
    '',
    '## Accepted Feedback',
    '',
    acceptedOwnerFeedback.length
      ? acceptedOwnerFeedback.map((feedback) => {
          const target = [
            feedback.target.componentName,
            feedback.target.selector,
            feedback.target.viewport,
          ].filter(Boolean).join(' · ')
          return `- ${feedback.id}: ${feedback.summary}${target ? ` (${target})` : ''}`
        }).join('\n')
      : 'No accepted owner feedback.',
    '',
    '## Decision Packets',
    '',
    design.decisionPackets.length
      ? design.decisionPackets.map((packet) => `- ${packet.id}: ${packet.summary}`).join('\n')
      : 'No decision packets.',
    '',
    latestPacket ? '## Worker Context' : '',
    latestPacket ? latestPacket.workerContext : '',
    '',
    '## Routed Design Feedback',
    '',
    `- Project decisions: ${design.decisions.length}`,
    `- Reusable candidates: ${design.candidates.length}`,
    `- Design-system follow-ups: ${design.designSystemImprovements.length}`,
    '',
  ].filter(Boolean).join('\n')))
}

async function renderDesign(ctx: GuildhallMcpContext): Promise<string> {
  const [designSystem, taste, catalog, intent, feedback] = await Promise.all([
    loadDesignSystem(ctx.projectStateDir),
    loadEffectiveDesignTaste({ memoryDir: ctx.projectStateDir }),
    buildDesignSystemCatalog({ projectPath: ctx.projectRoot, memoryDir: ctx.projectStateDir }),
    buildDesignIntentSurrogate({ projectPath: ctx.projectRoot, memoryDir: ctx.projectStateDir }),
    readDesignFeedbackStore(ctx.projectStateDir),
  ])
  const acceptedFeedback = feedback.ownerFeedback.filter(item => item.status === 'accepted')
  const latestPacket = feedback.decisionPackets.at(-1)
  return trimForMcp(redactForMcp([
    '# Design Context',
    '',
    '## Design System',
    '',
    designSystem
      ? [
          `- Revision: ${designSystem.revision}${designSystem.approvedAt ? ' (approved)' : ' (draft)'}`,
          `- Tokens: ${designTokenCount(designSystem)}`,
          `- Primitives: ${designSystem.primitives.length}`,
          ...designSystem.primitives.slice(0, 8).map(primitive => `  - ${primitive.name}: ${primitive.usage}`),
          '',
          summarizeDesignSystem(designSystem),
        ].join('\n')
      : 'No project design system has been drafted yet.',
    '',
    '## Taste',
    '',
    `- Direction: ${taste.taste.opinions.visualDirection.default}`,
    `- Controls: ${taste.taste.opinions.interactionSemantics.mutuallyExclusiveModes}`,
    `- Palette: ${taste.taste.opinions.paletteStrategy.defaultMode} / ${taste.taste.opinions.paletteStrategy.saturationBudget}`,
    `- Layers: ${taste.layers.filter(layer => layer.applied).length} of ${taste.layers.length}`,
    `- Summary: ${taste.summary}`,
    '',
    '## Catalog And Preview',
    '',
    `- Catalog: ${catalog.previewAdapter}`,
    `- Interactable: ${catalog.interactable ? 'yes' : 'no'}`,
    `- Entries: ${catalog.entries.length}`,
    ...catalog.entries.slice(0, 8).map(entry => `  - ${entry.id}: ${entry.title}${entry.componentIntent ? ` (${entry.componentIntent})` : ''}`),
    `- Intent preview: ${intent.platform} / ${intent.previewMode}${intent.approximate ? ' (approximate)' : ''}`,
    `- Native proof: ${intent.nativeProofRequired ? 'required' : 'not required'}`,
    ...(intent.warning ? [`- Warning: ${intent.warning}`] : []),
    '',
    '## Feedback And Decisions',
    '',
    `- Accepted feedback: ${acceptedFeedback.length}`,
    `- Decision packets: ${feedback.decisionPackets.length}`,
    `- Project decisions: ${feedback.decisions.length}`,
    `- Reusable candidates: ${feedback.candidates.length}`,
    `- Design-system follow-ups: ${feedback.designSystemImprovements.length}`,
    latestPacket ? `- Latest packet: ${latestPacket.id} - ${latestPacket.summary}` : '- Latest packet: none',
    '',
  ].filter(Boolean).join('\n')))
}

function designTokenCount(
  designSystem: NonNullable<Awaited<ReturnType<typeof loadDesignSystem>>>,
): number {
  return designSystem.tokens.color.length
    + designSystem.tokens.spacing.length
    + designSystem.tokens.typography.length
    + designSystem.tokens.radius.length
    + designSystem.tokens.shadow.length
}

async function renderArtifact(ctx: GuildhallMcpContext, artifactId: string): Promise<string> {
  const artifact = (await readArtifactRegistry(ctx.projectRoot, ctx.projectStateDir))
    .find((candidate) => candidate.id === artifactId)
  if (!artifact) throw new Error(`Artifact not found: ${artifactId}`)
  const resolved = safeProjectPath(ctx.projectRoot, artifact.path)
  return readOptional(
    resolved,
    `# ${artifact.id}\n\nRegistered artifact file is missing: ${artifact.path}\n`,
  ).then((content) => trimForMcp(redactForMcp(content)))
}

async function renderMemory(ctx: GuildhallMcpContext): Promise<string> {
  const records = await listMemoryRecords({ memoryDir: ctx.projectStateDir })
  const tasks = await readTasks(ctx.projectStateDir)
  const firstTask = tasks[0]
  const memoryCoreScope = firstTask
    ? {
        kind: 'task_thread' as const,
        projectId: path.basename(ctx.projectRoot) || 'project',
        taskId: firstTask.id,
        agentRole: 'worker' as const,
        threadId: firstTask.id,
      }
    : {
        kind: 'project' as const,
        projectId: path.basename(ctx.projectRoot) || 'project',
      }
  const memoryCorePaths = resolveMemoryPaths({
    projectRoot: ctx.projectRoot,
    scope: memoryCoreScope,
  })
  const memoryCorePacket = await buildMemoryCoreCandidatePacket({
    projectRoot: ctx.projectRoot,
    scope: memoryCoreScope,
    purpose: firstTask ? 'next_worker_context' : 'handoff',
    maxBytes: 4096,
  }).catch(() => null)
  const grouped = countBy(records, (record) => `${record.scope}/${record.status}`)
  const rawMemory = await readOptional(getProjectSystemStatePathFromMemoryDir(ctx.projectStateDir, 'MEMORY.md'), '')
  return trimForMcp(redactForMcp([
    '# Memory',
    '',
    `- Records: ${records.length}`,
    `- Project active: ${grouped['project/active'] ?? 0}`,
    `- Project proposed: ${(grouped['project/observed'] ?? 0) + (grouped['project/proposed'] ?? 0)}`,
    `- User-global active: ${grouped['user_global/active'] ?? 0}`,
    '',
    '## Memory-Core',
    '',
    `- Storage: ${memoryCorePaths.dbPath}`,
    `- Events: ${memoryCorePaths.eventsPath}`,
    `- Adapter: ${memoryCorePacket?.health.adapter ?? 'deterministic'}`,
    `- Fallback used: ${memoryCorePacket?.health.fallbackUsed ?? true}`,
    '- Repo-local writes: none',
    `- Compaction: ${memoryCorePacket?.health.compactionStatus ?? 'needs_attention'}`,
    `- Semantic validity: ${memoryCorePacket?.health.semanticValidity ?? 'needs_attention'}`,
    `- Candidate preview: ${memoryCorePacket?.candidates.length ?? 0}`,
    ...(memoryCorePacket?.candidates ?? []).slice(0, 5).map((candidate) =>
      `  - ${candidate.summary}`,
    ),
    '',
    '## Queryable Records',
    '',
    ...records.slice(0, 20).map((record) =>
      `- ${record.id}: ${record.status} ${record.scope}/${record.type} (${record.confidence}/${record.risk}) - ${record.summary}`,
    ),
    records.length > 20 ? `- [truncated ${records.length - 20} more records]` : '',
    '',
    '## MEMORY.md',
    '',
    rawMemory.trim() || 'No compact MEMORY.md recorded.',
    '',
  ].filter(Boolean).join('\n')))
}

async function renderLearning(ctx: GuildhallMcpContext): Promise<string> {
  const project = readProjectLearning(ctx.projectStateDir)
  const user = readGlobalLearning()
  const lines = [
    '# Learning',
    '',
    `- Project suggested learnings: ${project.suggestedLearnings.length}`,
    `- User/global suggested learnings: ${user.suggestedLearnings.length}`,
    `- Product suggestions: ${project.productSuggestions.length + user.productSuggestions.length}`,
    '',
    '## Project Learnings',
    '',
    ...project.suggestedLearnings.slice(0, 15).map((item) =>
      `- ${item.id}: ${item.status} ${item.destination} (${item.confidence}/${item.risk}) - ${item.summary}`,
    ),
    project.suggestedLearnings.length > 15 ? `- [truncated ${project.suggestedLearnings.length - 15} more project learnings]` : '',
    '',
    '## User Learnings',
    '',
    ...user.suggestedLearnings.slice(0, 10).map((item) =>
      `- ${item.id}: ${item.status} ${item.destination} (${item.confidence}/${item.risk}) - ${item.summary}`,
    ),
    user.suggestedLearnings.length > 10 ? `- [truncated ${user.suggestedLearnings.length - 10} more user learnings]` : '',
    '',
  ]
  return trimForMcp(redactForMcp(lines.filter(Boolean).join('\n')))
}

async function renderContext(ctx: GuildhallMcpContext): Promise<string> {
  const records = await readLatestContextDebug(ctx.projectRoot, 8)
  if (records.length === 0) return '# Context\n\nNo context-debug records.\n'
  return trimForMcp(redactForMcp([
    '# Context',
    '',
    ...records.flatMap((record) => [
      `## ${record.taskId} / ${record.agentName}`,
      '',
      `- At: ${record.at}`,
      `- Task: ${record.taskTitle} (${record.taskStatus})`,
      `- Model: ${record.modelId}`,
      `- Context chars: ${record.contextChars}`,
      `- Prompt chars: ${record.promptChars}`,
      `- Health: ${record.health.length > 0 ? record.health.map((warning) => `${warning.severity}:${warning.code}`).join(', ') : 'clean'}`,
      record.memoryPacket
        ? `- Memory packet: ${record.memoryPacket.included.length} included, ${record.memoryPacket.withheld.length} withheld, ${record.memoryPacket.evidenceRefs} evidence refs`
        : '- Memory packet: none recorded',
      '',
    ]),
  ].join('\n')))
}

async function renderLocalHistory(ctx: GuildhallMcpContext): Promise<string> {
  const health = await getProjectLocalHistoryHealth(ctx.projectRoot)
  return [
    '# Local History',
    '',
    `- Project: ${health.projectRoot}`,
    `- History dir: ${health.historyDir}`,
    `- Files: ${health.fileCount}`,
    `- Bytes: ${health.totalBytes}`,
    `- Oldest transcript: ${health.oldestTranscriptPath ?? 'none'}`,
    '',
    'Local history is summarized only. Transcripts, prompts, and command logs stay out of MCP resource dumps unless a purpose-built tool reads a bounded record.',
    '',
  ].join('\n')
}

async function renderCodebaseKnowledge(ctx: GuildhallMcpContext): Promise<string> {
  const [map, stale] = await Promise.all([
    loadCodebaseMap(ctx.projectStateDir),
    loadCodebaseMapStaleState(ctx.projectStateDir),
  ])
  if (!map) {
    return [
      '# Codebase Knowledge',
      '',
      'No codebase map recorded.',
      stale ? `Stale marker: ${stale.reason} at ${stale.at}.` : '',
      '',
    ].filter(Boolean).join('\n')
  }
  return trimForMcp(redactForMcp([
    '# Codebase Knowledge',
    '',
    `- Generated: ${map.generatedAt}`,
    `- Project: ${map.project.summary}`,
    `- Languages: ${map.project.languages.join(', ') || 'unknown'}`,
    `- Package managers: ${map.project.packageManagers.join(', ') || 'unknown'}`,
    `- Frameworks: ${map.project.primaryFrameworks.join(', ') || 'unknown'}`,
    `- Files: ${Object.keys(map.files).length}`,
    `- Areas: ${map.areas.length}`,
    `- Abstractions: ${map.abstractions.length}`,
    `- Freshness: ${stale ? `stale since ${stale.at} (${stale.reason})` : 'current or unknown'}`,
    '',
    '## Areas',
    '',
    ...map.areas.slice(0, 12).map((area) => `- ${area.id}: ${area.summary}`),
    map.areas.length > 12 ? `- [truncated ${map.areas.length - 12} more areas]` : '',
    '',
    '## Read Next',
    '',
    ...(map.semantic?.readNext ?? []).slice(0, 8).map((item) => `- ${item.path}: ${item.reason}`),
    '',
  ].filter(Boolean).join('\n')))
}

async function renderRuntime(ctx: GuildhallMcpContext): Promise<string> {
  const state = await readProjectRuntimeState(ctx.projectRoot)
  const checks = state.health.checks.slice(0, 12)
  return trimForMcp(redactForMcp([
    '# Runtime',
    '',
    `- Backend: ${state.backend}`,
    `- Status: ${state.status}`,
    `- Health: ${state.health.status}${state.health.checkedAt ? ` (${state.health.checkedAt})` : ''}`,
    `- Image: ${state.image.repository}:${state.image.tag}${state.image.digest ? `@${state.image.digest}` : ''}`,
    `- Migration: ${state.migration.mode}`,
    `- Backend setup: ${state.backendSetup.status}${state.backendSetup.selectedMode ? ` (${state.backendSetup.selectedMode})` : ''}`,
    `- Last activity: ${state.lastActivityAt ?? 'none'}`,
    `- Last error: ${state.lastError ?? 'none'}`,
    '',
    '## Mounts',
    '',
    `- Project: ${state.mounts.projectRoot} -> ${state.mounts.projectPath}`,
    `- Guildhall home: ${state.mounts.guildhallHome} -> ${state.mounts.guildhallHomePath}`,
    '',
    '## Ports',
    '',
    ...(state.ports.length > 0
      ? state.ports.slice(0, 12).map((port) => `- ${port.purpose}: ${port.host} -> ${port.container}`)
      : ['No runtime ports recorded.']),
    state.ports.length > 12 ? `- [truncated ${state.ports.length - 12} more ports]` : '',
    '',
    '## Checks',
    '',
    ...(checks.length > 0
      ? checks.map((check) => `- ${check.ok ? 'ok' : 'fail'} ${check.name}${check.message ? `: ${check.message}` : ''}`)
      : ['No health checks recorded.']),
    state.health.checks.length > checks.length ? `- [truncated ${state.health.checks.length - checks.length} more checks]` : '',
    '',
  ].filter(Boolean).join('\n')))
}

export async function listMcpMemory(ctx: GuildhallMcpContext, query?: MemoryQuery): Promise<string> {
  const records = await listMemoryRecords({ memoryDir: ctx.projectStateDir, query })
  return trimForMcp(redactForMcp(JSON.stringify(records.slice(0, 50), null, 2)))
}

export async function readMcpMemory(ctx: GuildhallMcpContext, input: {
  id: string
  scope?: string
}): Promise<string> {
  const records = await listMemoryRecords({ memoryDir: ctx.projectStateDir })
  const record = records.find((candidate) =>
    candidate.id === input.id && (!input.scope || candidate.scope === input.scope),
  )
  if (!record) throw new Error(`Memory record not found: ${input.id}`)
  return trimForMcp(redactForMcp(JSON.stringify(record, null, 2)))
}

export async function recordMcpMemoryObservation(ctx: GuildhallMcpContext, record: MemoryRecordInput): Promise<string> {
  const saved = await recordMemoryObservation({ memoryDir: ctx.projectStateDir, record })
  return trimForMcp(redactForMcp(JSON.stringify(saved, null, 2)))
}

export async function updateMcpMemoryStatus(ctx: GuildhallMcpContext, input: {
  id: string
  status: MemoryStatus
  updatedAt?: string
}): Promise<string> {
  const saved = await updateMemoryStatus({
    memoryDir: ctx.projectStateDir,
    id: input.id,
    status: input.status,
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
  })
  return trimForMcp(redactForMcp(JSON.stringify(saved, null, 2)))
}

export async function readMcpEffectiveContext(ctx: GuildhallMcpContext, input: {
  taskId: string
  maxRecords?: number
}): Promise<string> {
  const task = (await readTasks(ctx.projectStateDir)).find((candidate) => candidate.id === input.taskId)
  if (!task) throw new Error(`Task not found: ${input.taskId}`)
  const packet = await buildEffectiveMemoryPacket({
    memoryDir: ctx.projectStateDir,
    task: task as unknown as Task,
    ...(input.maxRecords ? { maxRecords: input.maxRecords } : {}),
  })
  return trimForMcp(redactForMcp([
    packet.rendered || '# Effective Memory\n\nNo matching memory.',
    '',
    '## Evidence',
    '',
    ...packet.evidenceRefs.slice(0, 20).map((ref) => `- ${ref.kind}: ${ref.summary}${ref.ref ? ` (${ref.ref})` : ''}`),
    packet.evidenceRefs.length > 20 ? `- [truncated ${packet.evidenceRefs.length - 20} more evidence refs]` : '',
    '',
  ].filter(Boolean).join('\n')))
}

export async function listMcpExternalMemoryBridgeRecords(ctx: GuildhallMcpContext, input?: {
  reviewStatus?: ExternalMemoryBridgeReviewStatus
}): Promise<string> {
  const store = await listExternalMemoryBridgeRecords({
    memoryDir: ctx.projectStateDir,
    ...(input?.reviewStatus ? { reviewStatus: input.reviewStatus } : {}),
  })
  return trimForMcp(redactForMcp(JSON.stringify(store, null, 2)))
}

export async function importMcpExternalMemoryBridgeRecord(
  ctx: GuildhallMcpContext,
  record: ExternalMemoryBridgeRecordInput,
): Promise<string> {
  const saved = await importExternalMemoryBridgeRecord({
    memoryDir: ctx.projectStateDir,
    record,
  })
  return trimForMcp(redactForMcp(JSON.stringify(saved, null, 2)))
}

export async function reviewMcpExternalMemoryBridgeRecord(ctx: GuildhallMcpContext, input: {
  id: string
  reviewer: string
  updatedAt?: string
  memoryStatus?: 'active' | 'proposed' | 'observed'
}): Promise<string> {
  const saved = await reviewExternalMemoryBridgeRecord({
    memoryDir: ctx.projectStateDir,
    id: input.id,
    reviewer: input.reviewer,
    ...(input.updatedAt ? { now: input.updatedAt } : {}),
    ...(input.memoryStatus ? { memoryStatus: input.memoryStatus } : {}),
  })
  return trimForMcp(redactForMcp(JSON.stringify(saved, null, 2)))
}

export async function rejectMcpExternalMemoryBridgeRecord(ctx: GuildhallMcpContext, input: {
  id: string
  reviewer: string
  rejectionReason: string
  updatedAt?: string
}): Promise<string> {
  const saved = await rejectExternalMemoryBridgeRecord({
    memoryDir: ctx.projectStateDir,
    id: input.id,
    reviewer: input.reviewer,
    rejectionReason: input.rejectionReason,
    ...(input.updatedAt ? { now: input.updatedAt } : {}),
  })
  return trimForMcp(redactForMcp(JSON.stringify(saved, null, 2)))
}

export async function readTasks(
  projectStateDir: string,
): Promise<Array<Record<string, unknown> & { id: string; title?: string; status?: string }>> {
  const raw = await readOptional(getProjectSystemStatePathFromMemoryDir(projectStateDir, 'TASKS.json'), '{"tasks":[]}')
  const parsed = JSON.parse(raw) as unknown
  const tasks = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)
      ? (parsed as { tasks: unknown[] }).tasks
      : []
  return tasks.filter((task): task is Record<string, unknown> & {
    id: string
    title?: string
    status?: string
  } =>
    Boolean(
      task &&
      typeof task === 'object' &&
      typeof (task as { id?: unknown }).id === 'string',
    ),
  )
}

async function readArtifactRegistry(
  projectRoot: string,
  projectStateDir: string,
): Promise<Array<{ id: string; path: string; description?: string }>> {
  const raw = await readOptional(path.join(projectStateDir, 'artifacts.yaml'), 'artifacts: []\n')
  const parsed = yamlLoad(raw) as {
    artifacts?: Array<{ id?: unknown; path?: unknown; description?: unknown }>
  } | null
  return (parsed?.artifacts ?? [])
    .filter((artifact): artifact is { id: string; path: string; description?: string } => {
      if (typeof artifact.id !== 'string' || typeof artifact.path !== 'string') return false
      safeProjectPath(projectRoot, artifact.path)
      return true
    })
}

async function readOptional(filePath: string, fallback: string): Promise<string> {
  try {
    return await readManagedTextFile(filePath, 'utf8')
  } catch {
    return fallback
  }
}

function safeProjectPath(projectRoot: string, relativePath: string): string {
  const resolved = path.resolve(projectRoot, relativePath)
  const root = path.resolve(projectRoot)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes project root: ${relativePath}`)
  }
  return resolved
}

function trimForMcp(text: string): string {
  return text.length > 12000 ? text.slice(0, 12000) + '\n\n[truncated]\n' : text
}

async function readLatestContextDebug(projectRoot: string, limit: number): Promise<ContextDebugRecord[]> {
  const ledgerPath = getProjectContextDebugLedgerPath(projectRoot)
  try {
    const raw = await readManagedTextFile(ledgerPath, 'utf8')
    const records: ContextDebugRecord[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        records.push(JSON.parse(line) as ContextDebugRecord)
      } catch {
        // Ignore malformed debug rows; MCP should remain available.
      }
    }
    return records.slice(-limit).reverse()
  } catch {
    return []
  }
}

function countBy<T>(items: readonly T[], keyFor: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = keyFor(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function redactForMcp(text: string): string {
  return text
    .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g, '[redacted-secret]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[redacted-secret]')
    .replace(/^(\s*(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*).+$/gim, '$1[redacted]')
}
