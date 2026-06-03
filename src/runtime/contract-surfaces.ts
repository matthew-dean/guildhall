import fs from 'node:fs'
import path from 'node:path'
import { guildhallHomeDir } from '@guildhall/config'
import { writeJsonFile, writeJsonLinesFile } from '@guildhall/persistence'
import type { StructuredSpecContractSurfaceDelta } from '@guildhall/core'

import {
  transitionContractSurface,
  type ContractSurfaceEvent,
  type ContractSurfaceState,
  type ContractSurfaceTransitionReceipt,
} from './contract-surface-machine.js'

export interface ContractSurfaceNodeRef {
  id: string
  label: string
  path?: string
}

export type ContractSurfaceKind =
  | 'component_api'
  | 'http_api'
  | 'event_api'
  | 'mcp_api'
  | 'schema'
  | 'state_machine'
  | 'design_system'
  | 'domain_capability'
  | 'documentation'
  | 'other'

export type ContractSurfaceSourceKind =
  | 'structured_spec'
  | 'project_graph'
  | 'structural_map'
  | 'openapi'
  | 'asyncapi'
  | 'design_tokens'
  | 'component_catalog'
  | 'schema_file'
  | 'state_machine_definition'
  | 'mcp_resource'
  | 'docs'
  | 'corpus_digest'
  | 'owner_decision'

export interface ContractSurfaceSourceRef {
  kind: ContractSurfaceSourceKind
  path?: string
  artifactId?: string
  nodeId?: string
  summary: string
}

export interface SurfaceInvariant {
  id: string
  label: string
  rule: string
  proofObligations: string[]
  sourceRefs?: ContractSurfaceSourceRef[]
}

export interface SurfaceDecision {
  id: string
  summary: string
  decidedAt: string
  decidedBy: string
  evidenceRefs: string[]
  invariantRefs?: string[]
}

export interface ContractSurface {
  id: string
  label: string
  kind: ContractSurfaceKind
  owningProject: ContractSurfaceNodeRef
  domain?: ContractSurfaceNodeRef
  authority: 'provider' | 'shared' | 'consumer'
  scope: 'project' | 'workspace' | 'external_reference'
  sourceRefs: ContractSurfaceSourceRef[]
  consumerRefs: ContractSurfaceNodeRef[]
  invariants: SurfaceInvariant[]
  decisions: SurfaceDecision[]
  stateMachine: {
    id: 'contract-surface'
    version: 1
    state: ContractSurfaceState
  }
  transitionReceipts: ContractSurfaceTransitionReceipt[]
  createdAt: string
  updatedAt: string
}

export interface RegisterContractSurfaceInput {
  id: string
  label: string
  kind: ContractSurfaceKind
  owningProject: ContractSurfaceNodeRef
  domain?: ContractSurfaceNodeRef
  authority: ContractSurface['authority']
  scope: ContractSurface['scope']
  sourceRefs: ContractSurfaceSourceRef[]
  consumerRefs: ContractSurfaceNodeRef[]
  invariants: SurfaceInvariant[]
  decisions: SurfaceDecision[]
  createdBy: string
  now?: string
}

export interface SurfaceReviewPacket {
  id: string
  surface: Pick<ContractSurface, 'id' | 'label' | 'kind' | 'authority' | 'scope' | 'owningProject' | 'domain'>
  currentSpecRef: string
  knownConsumers: ContractSurfaceNodeRef[]
  existingInvariants: SurfaceInvariant[]
  existingDecisions: SurfaceDecision[]
  siblingSpecRefs: string[]
  driftFindings: string[]
  currentDelta: StructuredSpecContractSurfaceDelta
  proofObligations: string[]
  reviewFocus: string[]
}

export function contractSurfaceStoreDir(): string {
  return path.join(guildhallHomeDir(), 'project-graph')
}

export async function registerContractSurface(input: RegisterContractSurfaceInput): Promise<ContractSurface> {
  const now = input.now ?? new Date().toISOString()
  const existing = readContractSurface(input.id, { optional: true })
  const surface: ContractSurface = {
    id: input.id,
    label: input.label,
    kind: input.kind,
    owningProject: input.owningProject,
    domain: input.domain,
    authority: input.authority,
    scope: input.scope,
    sourceRefs: [...input.sourceRefs],
    consumerRefs: [...input.consumerRefs],
    invariants: [...input.invariants],
    decisions: [...input.decisions],
    stateMachine: existing?.stateMachine ?? {
      id: 'contract-surface',
      version: 1,
      state: 'draft',
    },
    transitionReceipts: existing?.transitionReceipts ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  if (surface.stateMachine.state === 'draft') {
    applyContractSurfaceTransitionInMemory(surface, {
      event: 'propose_surface',
      actor: input.createdBy,
      evidenceRefs: surface.sourceRefs.map(sourceRef => sourceEvidenceRef(sourceRef)),
      now,
    })
  }
  await writeContractSurface(surface)
  return surface
}

export async function applyContractSurfaceTransition(surfaceId: string, input: {
  event: ContractSurfaceEvent
  actor: string
  evidenceRefs?: string[]
  touchedSpecRef?: string
  consumerImpactNote?: string
  authorityDecisionRef?: string
  now?: string
}): Promise<ContractSurface> {
  const surface = readContractSurface(surfaceId)
  applyContractSurfaceTransitionInMemory(surface, {
    ...input,
    evidenceRefs: input.evidenceRefs ?? [],
    now: input.now ?? new Date().toISOString(),
  })
  await writeContractSurface(surface)
  return surface
}

export function readContractSurface(surfaceId: string): ContractSurface
export function readContractSurface(surfaceId: string, options: { optional: true }): ContractSurface | undefined
export function readContractSurface(surfaceId: string, options?: { optional: true }): ContractSurface | undefined {
  const filePath = contractSurfacePath(surfaceId)
  if (!fs.existsSync(filePath)) {
    if (options?.optional) return undefined
    throw new Error(`Contract surface ${surfaceId} not found`)
  }
  const surface = JSON.parse(fs.readFileSync(filePath, 'utf8')) as ContractSurface
  surface.sourceRefs ??= []
  surface.consumerRefs ??= []
  surface.invariants ??= []
  surface.decisions ??= []
  surface.transitionReceipts ??= []
  return surface
}

export function readContractSurfaces(): ContractSurface[] {
  const dir = path.join(contractSurfaceStoreDir(), 'contract-surfaces')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => readContractSurface(path.basename(file, '.json')))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function writeContractSurface(surface: ContractSurface): Promise<void> {
  writeJsonFile(contractSurfacePath(surface.id), surface)
  await writeJsonLinesFile(contractSurfaceReceiptPath(surface.id), surface.transitionReceipts)
}

export function buildSurfaceReviewPacket(input: {
  surface: ContractSurface
  currentSpecRef: string
  delta: StructuredSpecContractSurfaceDelta
  siblingSpecRefs?: string[]
  driftFindings?: string[]
}): SurfaceReviewPacket {
  const proofObligations = [
    ...input.delta.proofObligations,
    ...input.delta.proposedInvariants?.flatMap(invariant => invariant.proofObligations ?? []) ?? [],
  ]
  return {
    id: `surface-review:${input.currentSpecRef}:${input.surface.id}`,
    surface: {
      id: input.surface.id,
      label: input.surface.label,
      kind: input.surface.kind,
      authority: input.surface.authority,
      scope: input.surface.scope,
      owningProject: input.surface.owningProject,
      domain: input.surface.domain,
    },
    currentSpecRef: input.currentSpecRef,
    knownConsumers: [...input.surface.consumerRefs].sort((left, right) => left.label.localeCompare(right.label)),
    existingInvariants: [...input.surface.invariants],
    existingDecisions: [...input.surface.decisions],
    siblingSpecRefs: [...input.siblingSpecRefs ?? []],
    driftFindings: [...input.driftFindings ?? []],
    currentDelta: input.delta,
    proofObligations,
    reviewFocus: reviewFocusForSurface(input.surface),
  }
}

export function renderSurfaceReviewPacketMarkdown(packet: SurfaceReviewPacket): string {
  const lines = [
    '## Contract Surface Review',
    '',
    `- Surface: ${packet.surface.label}`,
    `- Kind: ${packet.surface.kind}`,
    `- Owner: ${packet.surface.owningProject.label}`,
    `- Authority: ${packet.surface.authority}`,
    `- Known consumers: ${packet.knownConsumers.map(consumer => consumer.label).join(', ') || 'None recorded'}`,
  ]
  if (packet.siblingSpecRefs.length > 0) lines.push(`- Recent sibling specs: ${packet.siblingSpecRefs.join(', ')}`)
  for (const invariant of packet.existingInvariants) {
    lines.push(`- Existing invariant: ${invariant.label} - ${invariant.rule}`)
  }
  for (const decision of packet.existingDecisions) {
    lines.push(`- Decision: ${decision.summary}`)
  }
  lines.push(`- Current spec delta: ${packet.currentDelta.summary}`)
  for (const proposed of packet.currentDelta.proposedInvariants ?? []) {
    lines.push(`- Proposed invariant: ${proposed.label} - ${proposed.rule}`)
  }
  for (const obligation of packet.proofObligations) lines.push(`- Proof obligation: ${obligation}`)
  for (const finding of packet.driftFindings) lines.push(`- Drift finding: ${finding}`)
  for (const focus of packet.reviewFocus) lines.push(`- Review focus: ${focus}`)
  return lines.join('\n')
}

function applyContractSurfaceTransitionInMemory(surface: ContractSurface, input: {
  event: ContractSurfaceEvent
  actor: string
  evidenceRefs: string[]
  touchedSpecRef?: string
  consumerImpactNote?: string
  authorityDecisionRef?: string
  now: string
}): void {
  const result = transitionContractSurface({
    entityId: surface.id,
    currentState: surface.stateMachine.state,
    event: input.event,
    context: {
      owningProjectId: surface.owningProject.id,
      domainId: surface.domain?.id,
      consumerCount: surface.consumerRefs.length,
      evidenceRefs: input.evidenceRefs,
      touchedSpecRef: input.touchedSpecRef,
      consumerImpactNote: input.consumerImpactNote,
      authorityDecisionRef: input.authorityDecisionRef,
    },
    actor: input.actor,
    evidenceRefs: input.evidenceRefs,
    now: input.now,
  })
  if (result.kind === 'rejected') {
    throw new Error(`Contract surface ${surface.id} cannot ${input.event} from ${surface.stateMachine.state}: ${result.reason}`)
  }
  surface.stateMachine.state = result.nextState
  surface.transitionReceipts.push(result.receipt)
  surface.updatedAt = input.now
}

function reviewFocusForSurface(surface: ContractSurface): string[] {
  const focus = [
    'Does this preserve the surface vocabulary instead of adding one-off names?',
    'Are proof obligations explicit enough for reviewer verification?',
  ]
  if (surface.authority !== 'consumer') {
    focus.push('Does the delta stay inside the owning authority boundary?')
  }
  return focus
}

function contractSurfacePath(surfaceId: string): string {
  return path.join(contractSurfaceStoreDir(), 'contract-surfaces', `${slugify(surfaceId)}.json`)
}

function contractSurfaceReceiptPath(surfaceId: string): string {
  return path.join(contractSurfaceStoreDir(), 'contract-surface-receipts', `${slugify(surfaceId)}.jsonl`)
}

function sourceEvidenceRef(sourceRef: ContractSurfaceSourceRef): string {
  if (sourceRef.artifactId) return `artifact:${sourceRef.artifactId}`
  if (sourceRef.path) return `path:${sourceRef.path}`
  if (sourceRef.nodeId) return `node:${sourceRef.nodeId}`
  return `source:${sourceRef.kind}`
}

export function contractSurfaceNodeId(surfaceId: string): string {
  return `contract-surface:${surfaceId}`
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'surface'
}
