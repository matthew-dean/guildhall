import fs from 'node:fs'
import path from 'node:path'
import { guildhallHomeDir, listWorkspaces } from '@guildhall/config'
import { writeJsonFile, writeJsonLinesFile } from '@guildhall/persistence'

import { defineStateMachine, transition, type TransitionReceipt } from './state-machine.js'

export type ProjectGraphNodeType =
  | 'local_guildhall_project'
  | 'local_repo'
  | 'domain'
  | 'package'
  | 'executable_unit'
  | 'external_authority'
  | 'delivery_channel'

export interface ProjectGraphNodeRef {
  id: string
  label: string
  path?: string
}

export interface ProjectGraphNode extends ProjectGraphNodeRef {
  type: ProjectGraphNodeType
  pathFingerprint?: string
  lastSeenAt: string
}

export interface ProjectGraphEdgeSummary {
  id: string
  type: 'requests_from'
  state: ProjectDependencyEdgeState
  consumerProjectId: string
  providerProjectId: string
  updatedAt: string
}

export interface ProjectGraphRegistry {
  version: 1
  updatedAt: string
  projects: Array<ProjectGraphNode & { type: 'local_guildhall_project'; path: string }>
  edges: ProjectGraphEdgeSummary[]
}

export interface ProjectGraph {
  id: string
  version: 1
  generatedAt: string
  nodes: ProjectGraphNode[]
  edges: ProjectGraphEdgeSummary[]
  evidence: string[]
}

export type ProjectDependencyEdgeState =
  | 'draft'
  | 'submitted'
  | 'provider_shaping'
  | 'provider_working'
  | 'delivered'
  | 'consumer_reviewing'
  | 'revision_requested'
  | 'resolved'
  | 'closed'

export type ProjectDependencyEdgeEvent =
  | 'submit'
  | 'accept_for_shaping'
  | 'reject_request'
  | 'commit_delivery_plan'
  | 'return_for_clarification'
  | 'deliver'
  | 'begin_consumer_review'
  | 'accept_delivery'
  | 'request_revision'
  | 'revise_plan'
  | 'redeliver'
  | 'close'

export type ProjectDependencyEdgeTransitionReceipt = TransitionReceipt<ProjectDependencyEdgeState, ProjectDependencyEdgeEvent>

export interface ProjectDependencyEdge {
  id: string
  stateMachine: {
    id: 'project-dependency-edge'
    version: 1
    state: ProjectDependencyEdgeState
  }
  consumer: ProjectGraphNodeRef
  provider: ProjectGraphNodeRef
  domain?: ProjectGraphNodeRef
  consumerNeed: string
  rationale: string
  expectedDelivery?: {
    format: string
    channel: string
    providerProofPlan?: string[]
    consumerVerificationPlan: string[]
  }
  providerTaskRef?: string
  consumerReview?: {
    verificationContext: string
    reviewedBy: string
    reviewedAt: string
  }
  deliveryReceipts: DeliveryReceipt[]
  returnPackets: ConsumerReturnPacket[]
  consumerAcceptance?: {
    acceptedBy: string
    acceptedAt: string
    consumerProof: string[]
  }
  transitionReceipts: ProjectDependencyEdgeTransitionReceipt[]
  evidenceRefs: string[]
  createdAt: string
  updatedAt: string
}

export interface DeliveryReceipt {
  id: string
  format: string
  channel: string
  coordinates: string
  providerProof: string[]
}

export interface ConsumerReturnPacket {
  deliveryReceiptId: string
  mismatchKind: 'format' | 'channel' | 'scope' | 'behavior' | 'compatibility' | 'docs' | 'proof'
  expected: string
  received: string
  failedVerification: string[]
  evidenceRefs: string[]
  requestedCorrection: string
  returnedBy?: string
  returnedAt?: string
}

export interface CreateProjectDependencyRequestInput {
  consumerProject: ProjectGraphNodeRef & { path: string }
  providerProject: ProjectGraphNodeRef & { path: string }
  domain?: ProjectGraphNodeRef
  consumerNeed: string
  rationale: string
  expectedDelivery?: ProjectDependencyEdge['expectedDelivery']
  requestedBy: string
  now?: string
}

export const projectDependencyEdgeMachine = defineStateMachine<
  ProjectDependencyEdgeState,
  ProjectDependencyEdgeEvent,
  ProjectDependencyEdge
>({
  id: 'project-dependency-edge',
  version: 1,
  initial: 'draft',
  terminal: ['resolved', 'closed'],
  states: {
    draft: {
      on: {
        submit: { to: 'submitted', require: ['consumerNeed', 'provider', 'rationale'] },
        close: { to: 'closed' },
      },
    },
    submitted: {
      on: {
        accept_for_shaping: { to: 'provider_shaping' },
        reject_request: { to: 'closed' },
        close: { to: 'closed' },
      },
    },
    provider_shaping: {
      on: {
        commit_delivery_plan: { to: 'provider_working', require: ['expectedDelivery'] },
        return_for_clarification: { to: 'submitted' },
        close: { to: 'closed' },
      },
    },
    provider_working: {
      on: {
        deliver: { to: 'delivered' },
        close: { to: 'closed' },
      },
    },
    delivered: {
      on: {
        begin_consumer_review: { to: 'consumer_reviewing' },
        close: { to: 'closed' },
      },
    },
    consumer_reviewing: {
      on: {
        accept_delivery: { to: 'resolved' },
        request_revision: { to: 'revision_requested' },
        close: { to: 'closed' },
      },
    },
    revision_requested: {
      on: {
        revise_plan: { to: 'provider_shaping' },
        redeliver: { to: 'delivered' },
        close: { to: 'closed' },
      },
    },
    resolved: { on: {} },
    closed: { on: {} },
  },
})

export function projectGraphRegistryDir(): string {
  return path.join(guildhallHomeDir(), 'project-graph')
}

export function readProjectGraphRegistry(): ProjectGraphRegistry {
  const filePath = path.join(projectGraphRegistryDir(), 'registry.json')
  if (!fs.existsSync(filePath)) {
    return { version: 1, updatedAt: '', projects: [], edges: [] }
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProjectGraphRegistry
}

export function writeLocalProjectGraphDraft(input: {
  now?: string
} = {}): ProjectGraph {
  const now = input.now ?? new Date().toISOString()
  const projects = listWorkspaces()
    .filter(workspace => workspace.path)
    .map(workspace => ({
      id: `local-project:${workspace.id}`,
      type: 'local_guildhall_project' as const,
      label: workspace.name,
      path: workspace.path,
      pathFingerprint: pathFingerprint(workspace.path),
      lastSeenAt: now,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const current = readProjectGraphRegistry()
  const registry: ProjectGraphRegistry = {
    version: 1,
    updatedAt: now,
    projects,
    edges: current.edges,
  }
  writeJsonFile(path.join(projectGraphRegistryDir(), 'registry.json'), registry)
  const graph: ProjectGraph = {
    id: 'local',
    version: 1,
    generatedAt: now,
    nodes: projects,
    edges: registry.edges,
    evidence: ['source:workspace-registry'],
  }
  writeJsonFile(path.join(projectGraphRegistryDir(), 'graphs', 'local.json'), graph)
  return graph
}

export async function createProjectDependencyRequest(
  input: CreateProjectDependencyRequestInput,
): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge: ProjectDependencyEdge = {
    id: `edge-${slugify(input.consumerProject.id)}-${slugify(input.providerProject.id)}-${Date.parse(now).toString(36)}`,
    stateMachine: {
      id: 'project-dependency-edge',
      version: 1,
      state: 'draft',
    },
    consumer: {
      id: input.consumerProject.id,
      label: input.consumerProject.label,
      path: input.consumerProject.path,
    },
    provider: {
      id: input.providerProject.id,
      label: input.providerProject.label,
      path: input.providerProject.path,
    },
    domain: input.domain,
    consumerNeed: input.consumerNeed,
    rationale: input.rationale,
    expectedDelivery: input.expectedDelivery,
    deliveryReceipts: [],
    returnPackets: [],
    transitionReceipts: [],
    evidenceRefs: [`project:${input.consumerProject.id}`, `project:${input.providerProject.id}`],
    createdAt: now,
    updatedAt: now,
  }
  applyProjectDependencyEdgeTransition(edge, {
    event: 'submit',
    actor: input.requestedBy,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeProviderRequestPacket(edge, input)
  await writeConsumerOutgoingMirror(edge, input.consumerProject.path)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function importProjectDependencyRequestForProvider(input: {
  edgeId: string
  providerProjectPath: string
  importedBy: string
  domain?: ProjectGraphNodeRef
  providerTaskRef?: string
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertProviderAuthority(edge, input.providerProjectPath)
  if (input.domain) edge.domain = input.domain
  if (input.providerTaskRef) edge.providerTaskRef = input.providerTaskRef
  applyProjectDependencyEdgeTransition(edge, {
    event: 'accept_for_shaping',
    actor: input.importedBy,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeProviderIncomingMirror(edge, input.providerProjectPath)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function commitProjectDependencyDeliveryPlan(input: {
  edgeId: string
  providerProjectPath: string
  plannedBy: string
  deliveryExpectation: NonNullable<ProjectDependencyEdge['expectedDelivery']>
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertProviderAuthority(edge, input.providerProjectPath)
  edge.expectedDelivery = input.deliveryExpectation
  applyProjectDependencyEdgeTransition(edge, {
    event: 'commit_delivery_plan',
    actor: input.plannedBy,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeProviderIncomingMirror(edge, input.providerProjectPath)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function deliverProjectDependency(input: {
  edgeId: string
  providerProjectPath: string
  deliveredBy: string
  deliveryReceipt: DeliveryReceipt
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertProviderAuthority(edge, input.providerProjectPath)
  edge.deliveryReceipts.push(input.deliveryReceipt)
  applyProjectDependencyEdgeTransition(edge, {
    event: 'deliver',
    actor: input.deliveredBy,
    evidenceRefs: [`delivery:${input.deliveryReceipt.id}`, ...edge.evidenceRefs],
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeProviderIncomingMirror(edge, input.providerProjectPath)
  await writeProviderDeliveryMirror(edge, input.providerProjectPath, input.deliveryReceipt)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function beginProjectDependencyConsumerReview(input: {
  edgeId: string
  consumerProjectPath: string
  reviewedBy: string
  verificationContext: string
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertConsumerAuthority(edge, input.consumerProjectPath)
  edge.consumerReview = {
    verificationContext: input.verificationContext,
    reviewedBy: input.reviewedBy,
    reviewedAt: now,
  }
  applyProjectDependencyEdgeTransition(edge, {
    event: 'begin_consumer_review',
    actor: input.reviewedBy,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeConsumerOutgoingMirror(edge, input.consumerProjectPath)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function requestProjectDependencyRevision(input: {
  edgeId: string
  consumerProjectPath: string
  returnedBy: string
  returnPacket: ConsumerReturnPacket
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertConsumerAuthority(edge, input.consumerProjectPath)
  const packet: ConsumerReturnPacket = {
    ...input.returnPacket,
    returnedBy: input.returnedBy,
    returnedAt: now,
  }
  edge.returnPackets.push(packet)
  applyProjectDependencyEdgeTransition(edge, {
    event: 'request_revision',
    actor: input.returnedBy,
    evidenceRefs: packet.evidenceRefs,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeConsumerOutgoingMirror(edge, input.consumerProjectPath)
  await writeConsumerReturnPacket(edge, packet)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function reviseProjectDependencyPlan(input: {
  edgeId: string
  providerProjectPath: string
  revisedBy: string
  deliveryExpectation?: NonNullable<ProjectDependencyEdge['expectedDelivery']>
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertProviderAuthority(edge, input.providerProjectPath)
  if (input.deliveryExpectation) edge.expectedDelivery = input.deliveryExpectation
  applyProjectDependencyEdgeTransition(edge, {
    event: 'revise_plan',
    actor: input.revisedBy,
    now,
  })
  if (input.deliveryExpectation) {
    applyProjectDependencyEdgeTransition(edge, {
      event: 'commit_delivery_plan',
      actor: input.revisedBy,
      now,
    })
  }
  await writeProjectDependencyEdge(edge)
  await writeProviderIncomingMirror(edge, input.providerProjectPath)
  updateRegistryForEdge(edge, now)
  return edge
}

export async function acceptProjectDependencyDelivery(input: {
  edgeId: string
  consumerProjectPath: string
  acceptedBy: string
  consumerProof: string[]
  now?: string
}): Promise<ProjectDependencyEdge> {
  const now = input.now ?? new Date().toISOString()
  const edge = readProjectDependencyEdge(input.edgeId)
  assertConsumerAuthority(edge, input.consumerProjectPath)
  edge.consumerAcceptance = {
    acceptedBy: input.acceptedBy,
    acceptedAt: now,
    consumerProof: input.consumerProof,
  }
  applyProjectDependencyEdgeTransition(edge, {
    event: 'accept_delivery',
    actor: input.acceptedBy,
    evidenceRefs: input.consumerProof,
    now,
  })
  await writeProjectDependencyEdge(edge)
  await writeConsumerOutgoingMirror(edge, input.consumerProjectPath)
  updateRegistryForEdge(edge, now)
  return edge
}

function applyProjectDependencyEdgeTransition(
  edge: ProjectDependencyEdge,
  input: { event: ProjectDependencyEdgeEvent; actor: string; now: string; evidenceRefs?: string[] },
): void {
  const result = transition(projectDependencyEdgeMachine, {
    entityId: edge.id,
    currentState: edge.stateMachine.state,
    event: input.event,
    context: edge,
    actor: input.actor,
    evidenceRefs: input.evidenceRefs ?? edge.evidenceRefs,
    now: input.now,
  })
  if (result.kind === 'rejected') {
    throw new Error(`Project dependency edge ${edge.id} cannot ${input.event} from ${edge.stateMachine.state}: ${result.reason}`)
  }
  edge.stateMachine.state = result.nextState
  edge.transitionReceipts.push(result.receipt)
  edge.updatedAt = input.now
}

async function writeProjectDependencyEdge(edge: ProjectDependencyEdge): Promise<void> {
  writeJson(path.join(projectGraphRegistryDir(), 'edges', `${edge.id}.json`), edge)
  const receiptPath = path.join(projectGraphRegistryDir(), 'receipts', `${edge.id}.jsonl`)
  await writeJsonLinesFile(receiptPath, edge.transitionReceipts)
}

function readProjectDependencyEdge(edgeId: string): ProjectDependencyEdge {
  const filePath = path.join(projectGraphRegistryDir(), 'edges', `${edgeId}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Project dependency edge ${edgeId} not found`)
  const edge = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ProjectDependencyEdge
  edge.deliveryReceipts ??= []
  edge.returnPackets ??= []
  edge.transitionReceipts ??= []
  return edge
}

async function writeProviderRequestPacket(
  edge: ProjectDependencyEdge,
  input: CreateProjectDependencyRequestInput,
): Promise<void> {
  writeJson(path.join(projectGraphRegistryDir(), 'exchange', 'provider-requests', `${edge.id}.json`), {
    type: 'provider_request',
    edgeId: edge.id,
    consumerProject: edge.consumer,
    providerProject: edge.provider,
    requestedDomain: edge.domain,
    consumerNeed: edge.consumerNeed,
    rationale: edge.rationale,
    proposedDeliveryExpectation: input.expectedDelivery,
    evidenceRefs: edge.evidenceRefs,
    requestedBy: input.requestedBy,
    requestedAt: edge.createdAt,
  })
}

async function writeConsumerOutgoingMirror(edge: ProjectDependencyEdge, consumerProjectPath: string): Promise<void> {
  writeJson(path.join(consumerProjectPath, '.guildhall', 'project-graph', 'outgoing-requests', `${edge.id}.json`), {
    edgeId: edge.id,
    providerProject: edge.provider,
    expectedDelivery: edge.expectedDelivery
      ? {
          format: edge.expectedDelivery.format,
          channel: edge.expectedDelivery.channel,
        }
      : undefined,
    verificationPlan: edge.expectedDelivery?.consumerVerificationPlan ?? [],
    latestDeliveryReceipt: edge.deliveryReceipts.at(-1),
    latestReturnPacket: edge.returnPackets.at(-1),
    consumerAcceptance: edge.consumerAcceptance,
    currentEdgeState: edge.stateMachine.state,
    updatedAt: edge.updatedAt,
  })
}

async function writeProviderIncomingMirror(edge: ProjectDependencyEdge, providerProjectPath: string): Promise<void> {
  writeJson(path.join(providerProjectPath, '.guildhall', 'project-graph', 'incoming-requests', `${edge.id}.json`), {
    edgeId: edge.id,
    consumerProject: edge.consumer,
    requestedDomain: edge.domain,
    consumerNeed: edge.consumerNeed,
    providerTaskRef: edge.providerTaskRef,
    expectedDelivery: edge.expectedDelivery,
    latestReturnPacket: edge.returnPackets.at(-1),
    currentEdgeState: edge.stateMachine.state,
    updatedAt: edge.updatedAt,
  })
}

async function writeProviderDeliveryMirror(
  edge: ProjectDependencyEdge,
  providerProjectPath: string,
  deliveryReceipt: DeliveryReceipt,
): Promise<void> {
  writeJson(path.join(providerProjectPath, '.guildhall', 'project-graph', 'deliveries', `${edge.id}.json`), {
    edgeId: edge.id,
    providerProject: edge.provider,
    consumerProject: edge.consumer,
    deliveryReceipt,
    currentEdgeState: edge.stateMachine.state,
    deliveredAt: edge.updatedAt,
  })
}

async function writeConsumerReturnPacket(edge: ProjectDependencyEdge, packet: ConsumerReturnPacket): Promise<void> {
  writeJson(path.join(projectGraphRegistryDir(), 'exchange', 'consumer-returns', `${edge.id}.json`), {
    type: 'consumer_return',
    edgeId: edge.id,
    consumerProject: edge.consumer,
    providerProject: edge.provider,
    ...packet,
  })
}

function updateRegistryForEdge(edge: ProjectDependencyEdge, now: string): void {
  const registry = readProjectGraphRegistry()
  const projectsById = new Map(registry.projects.map(project => [project.id, project]))
  for (const project of [edge.consumer, edge.provider]) {
    if (!project.path) continue
    projectsById.set(`local-project:${project.id}`, {
      id: `local-project:${project.id}`,
      type: 'local_guildhall_project',
      label: project.label,
      path: project.path,
      pathFingerprint: pathFingerprint(project.path),
      lastSeenAt: now,
    })
  }
  const summary: ProjectGraphEdgeSummary = {
    id: edge.id,
    type: 'requests_from',
    state: edge.stateMachine.state,
    consumerProjectId: edge.consumer.id,
    providerProjectId: edge.provider.id,
    updatedAt: edge.updatedAt,
  }
  const existing = registry.edges.findIndex(candidate => candidate.id === edge.id)
  const edges = existing >= 0
    ? registry.edges.map(candidate => candidate.id === edge.id ? summary : candidate)
    : [...registry.edges, summary]
  writeJson(path.join(projectGraphRegistryDir(), 'registry.json'), {
    ...registry,
    version: 1,
    updatedAt: now,
    projects: [...projectsById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges,
  } satisfies ProjectGraphRegistry)
}

function writeJson(filePath: string, value: unknown): void {
  writeJsonFile(filePath, value)
}

function assertProviderAuthority(edge: ProjectDependencyEdge, projectPath: string): void {
  if (!edge.provider.path || path.resolve(edge.provider.path) !== path.resolve(projectPath)) {
    throw new Error(`Project ${projectPath} does not own provider authority for edge ${edge.id}`)
  }
}

function assertConsumerAuthority(edge: ProjectDependencyEdge, projectPath: string): void {
  if (!edge.consumer.path || path.resolve(edge.consumer.path) !== path.resolve(projectPath)) {
    throw new Error(`Project ${projectPath} does not own consumer authority for edge ${edge.id}`)
  }
}

function pathFingerprint(value: string): string {
  return path.resolve(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
}
