import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { writeJsonFile, writeJsonLinesFile } from '@guildhall/persistence'

import { defineStateMachine, transition, type TransitionReceipt } from './state-machine.js'
import type { CreateProjectDependencyRequestInput, ProjectGraphNodeRef } from './project-graph.js'

export type StructuralMapState =
  | 'draft'
  | 'owner_review'
  | 'correction_requested'
  | 'accepted'
  | 'superseded'

export type StructuralMapEvent =
  | 'submit_for_review'
  | 'request_correction'
  | 'apply_correction'
  | 'accept'
  | 'supersede'

export type StructuralNodeKind =
  | 'project'
  | 'workspace'
  | 'monorepo'
  | 'package'
  | 'domain_group'
  | 'cross_cutting_domain'
  | 'executable_unit'
  | 'git_authority_root'
  | 'memory_scope'

export type StructuralConfidence = 'low' | 'medium' | 'high' | 'conflict'

export interface EvidenceRef {
  kind: 'manifest' | 'script' | 'path' | 'docs' | 'git' | 'owner'
  ref: string
  confidence: StructuralConfidence
}

export interface StructuralMapNode {
  id: string
  kind: StructuralNodeKind
  label: string
  relativePath?: string
  packageName?: string
  packageId?: string
  domainId?: string
  role?: 'top_level_authority' | 'child_authority' | 'vendored_generated_root' | 'domain_folder_only'
  command?: string
  scripts?: Record<string, string>
  dependencyNames?: string[]
  evidence: EvidenceRef[]
  confidence: StructuralConfidence
}

export interface StructuralMapEdge {
  from: string
  to: string
  kind:
    | 'package_depends_on'
    | 'package_belongs_to_domain'
    | 'domain_uses_executable_unit'
    | 'domain_owned_by_project'
    | 'package_owned_by_git_authority'
}

export interface IgnoredGitRoot {
  relativePath: string
  reason: 'vendored_dependency_git_metadata' | 'generated_output_git_metadata'
  evidence: EvidenceRef[]
}

export interface OwnerQuestion {
  id: string
  reason: string
  prompt: string
  targetIds: string[]
}

export interface StructuralMapCorrectionRequest {
  id: string
  targetId: string
  requestedChange: string
  reason: string
  requestedBy?: string
  requestedAt?: string
}

export type StructuralMapCorrectionChange =
  | { kind: 'rename_node'; nodeId: string; label: string }
  | { kind: 'ignore_node'; nodeId: string; reason: string }

export type StructuralMapTransitionReceipt = TransitionReceipt<StructuralMapState, StructuralMapEvent>

export interface StructuralMapDraft {
  id: string
  version: 1
  projectId: string
  projectRoot: string
  generatedAt: string
  stateMachine: {
    id: 'structural-map-review'
    version: 1
    state: StructuralMapState
  }
  nodes: StructuralMapNode[]
  edges: StructuralMapEdge[]
  ignoredGitRoots: IgnoredGitRoot[]
  ownerQuestions: OwnerQuestion[]
  correctionRequests: StructuralMapCorrectionRequest[]
  transitionReceipts: StructuralMapTransitionReceipt[]
  evidenceRefs: string[]
}

export interface StructuralContextSlice {
  routingAuthority: {
    gitAuthorityRootId?: string
    primaryDomainId?: string
    packageIds: string[]
    executableUnitIds: string[]
  }
  summaries: string[]
  handles: string[]
  omitted: Array<{
    handle: string
    reason: 'unrelated_to_task_domain' | 'map_not_accepted'
    confidence: StructuralConfidence
  }>
}

export const structuralMapReviewMachine = defineStateMachine<
  StructuralMapState,
  StructuralMapEvent,
  StructuralMapDraft
>({
  id: 'structural-map-review',
  version: 1,
  initial: 'draft',
  terminal: ['superseded'],
  states: {
    draft: {
      on: {
        submit_for_review: { to: 'owner_review', require: ['ownerQuestions'] },
        supersede: { to: 'superseded' },
      },
    },
    owner_review: {
      on: {
        accept: { to: 'accepted' },
        request_correction: { to: 'correction_requested' },
        supersede: { to: 'superseded' },
      },
    },
    correction_requested: {
      on: {
        apply_correction: { to: 'owner_review', require: ['correctionRequests'] },
        supersede: { to: 'superseded' },
      },
    },
    accepted: {
      on: {
        supersede: { to: 'superseded' },
      },
    },
    superseded: { on: {} },
  },
})

export async function draftStructuralMap(input: {
  projectId: string
  projectRoot: string
  now?: string
}): Promise<StructuralMapDraft> {
  const now = input.now ?? new Date().toISOString()
  const projectRoot = path.resolve(input.projectRoot)
  const rootPackage = readJsonIfExists(path.join(projectRoot, 'package.json')) as PackageJson | undefined
  const workspacePatterns = readPnpmWorkspacePatterns(path.join(projectRoot, 'pnpm-workspace.yaml'))
  const packageNodes = await discoverWorkspacePackages(projectRoot, workspacePatterns)
  const nodes: StructuralMapNode[] = [
    {
      id: 'project:root',
      kind: 'project',
      label: rootPackage?.name ?? input.projectId,
      relativePath: '.',
      evidence: evidence('manifest', 'package.json', rootPackage ? 'high' : 'low'),
      confidence: rootPackage ? 'high' : 'low',
    },
    {
      id: 'git:root',
      kind: 'git_authority_root',
      role: 'top_level_authority',
      label: 'Top-level Git authority',
      relativePath: '.',
      evidence: evidence('git', '.', 'medium'),
      confidence: 'medium',
    },
    {
      id: 'monorepo:root',
      kind: 'monorepo',
      label: 'Root monorepo',
      relativePath: '.',
      evidence: evidence('manifest', 'pnpm-workspace.yaml', workspacePatterns.length > 0 ? 'high' : 'low'),
      confidence: workspacePatterns.length > 0 ? 'high' : 'low',
    },
  ]
  if (workspacePatterns.length > 0) {
    nodes.push({
      id: 'workspace:pnpm',
      kind: 'workspace',
      label: 'pnpm workspace',
      relativePath: '.',
      evidence: evidence('manifest', 'pnpm-workspace.yaml', 'high'),
      confidence: 'high',
    })
  }
  const edges: StructuralMapEdge[] = []

  for (const pkg of packageNodes) {
    nodes.push(pkg)
    nodes.push(...domainNodesForPackage(pkg))
    const packageUnits = executableUnitsForPackage(pkg)
    nodes.push(...packageUnits)
    if (pkg.packageId) {
      const domainId = `domain:${pkg.packageId.split('-').at(-1) ?? pkg.packageId}`
      edges.push({ from: pkg.id, to: domainId, kind: 'package_belongs_to_domain' })
      edges.push({ from: pkg.id, to: 'git:root', kind: 'package_owned_by_git_authority' })
      for (const unit of packageUnits) {
        edges.push({ from: domainId, to: unit.id, kind: 'domain_uses_executable_unit' })
      }
    }
  }

  for (const unit of rootExecutableUnits(rootPackage)) {
    nodes.push(unit)
  }
  for (const edge of packageDependencyEdges(packageNodes)) {
    edges.push(edge)
  }

  if (hasNodeCopyEvidence(projectRoot, rootPackage)) {
    nodes.push({
      id: 'cross-cutting:node-copy-reduction',
      kind: 'cross_cutting_domain',
      label: 'Node-copy reduction',
      evidence: [
        ...evidence('script', 'verify:node-copy-frontier', rootPackage?.scripts?.['verify:node-copy-frontier'] ? 'high' : 'low'),
        ...evidence('docs', 'docs/future/node-copy-reduction', fs.existsSync(path.join(projectRoot, 'docs', 'future', 'node-copy-reduction')) ? 'high' : 'low'),
      ],
      confidence: 'high',
    })
  }

  const ignoredGitRoots = await discoverIgnoredGitRoots(projectRoot)
  const ownerQuestions: OwnerQuestion[] = [{
    id: 'confirm-domain-routing',
    reason: 'owner_review_required_before_routing_truth',
    prompt: 'Review the proposed domains, package graph, executable units, and Git authority before Guildhall uses this map for routing.',
    targetIds: nodes.filter(node => node.kind === 'domain_group' || node.kind === 'cross_cutting_domain').map(node => node.id),
  }]
  const draft: StructuralMapDraft = {
    id: `structural-map-${Date.parse(now).toString(36)}`,
    version: 1,
    projectId: input.projectId,
    projectRoot,
    generatedAt: now,
    stateMachine: {
      id: 'structural-map-review',
      version: 1,
      state: 'draft',
    },
    nodes: uniqueNodes(nodes),
    edges: uniqueEdges(edges),
    ignoredGitRoots,
    ownerQuestions,
    correctionRequests: [],
    transitionReceipts: [],
    evidenceRefs: ['manifest:package.json', 'manifest:pnpm-workspace.yaml'],
  }
  await writeStructuralMap(projectRoot, draft)
  return draft
}

export async function submitStructuralMapForReview(input: {
  projectRoot: string
  mapId: string
  actor: string
  now?: string
}): Promise<StructuralMapDraft> {
  return applyStructuralTransition(input.projectRoot, input.mapId, {
    event: 'submit_for_review',
    actor: input.actor,
    evidenceRefs: ['owner-review:requested'],
    now: input.now,
  })
}

export async function requestStructuralMapCorrection(input: {
  projectRoot: string
  mapId: string
  actor: string
  request: StructuralMapCorrectionRequest
  now?: string
}): Promise<StructuralMapDraft> {
  const now = input.now ?? new Date().toISOString()
  const map = readStructuralMap(input.projectRoot, input.mapId)
  map.correctionRequests.push({
    ...input.request,
    requestedBy: input.actor,
    requestedAt: now,
  })
  await writeStructuralMap(input.projectRoot, map)
  return applyStructuralTransition(input.projectRoot, input.mapId, {
    event: 'request_correction',
    actor: input.actor,
    evidenceRefs: [`owner-correction:${input.request.id}`],
    now,
  })
}

export async function applyStructuralMapCorrection(input: {
  projectRoot: string
  mapId: string
  actor: string
  correctionRequestId: string
  changes: StructuralMapCorrectionChange[]
  now?: string
}): Promise<StructuralMapDraft> {
  const now = input.now ?? new Date().toISOString()
  const map = readStructuralMap(input.projectRoot, input.mapId)
  if (!map.correctionRequests.some(request => request.id === input.correctionRequestId)) {
    throw new Error(`Structural map correction request ${input.correctionRequestId} not found`)
  }
  for (const change of input.changes) {
    if (change.kind === 'rename_node') {
      const node = map.nodes.find(candidate => candidate.id === change.nodeId)
      if (!node) throw new Error(`Structural map node ${change.nodeId} not found`)
      node.label = change.label
      node.evidence.push(...evidence('owner', input.correctionRequestId, 'high'))
      node.confidence = 'high'
    }
    if (change.kind === 'ignore_node') {
      map.nodes = map.nodes.filter(node => node.id !== change.nodeId)
      map.edges = map.edges.filter(edge => edge.from !== change.nodeId && edge.to !== change.nodeId)
    }
  }
  await writeStructuralMap(input.projectRoot, map)
  return applyStructuralTransition(input.projectRoot, input.mapId, {
    event: 'apply_correction',
    actor: input.actor,
    evidenceRefs: [`owner-correction:${input.correctionRequestId}`],
    now,
  })
}

export async function acceptStructuralMap(input: {
  projectRoot: string
  mapId: string
  actor: string
  now?: string
}): Promise<StructuralMapDraft> {
  const accepted = await applyStructuralTransition(input.projectRoot, input.mapId, {
    event: 'accept',
    actor: input.actor,
    evidenceRefs: ['owner-review:accepted'],
    now: input.now,
  })
  writeJsonFile(path.join(structuralMapDir(input.projectRoot), 'accepted.json'), accepted)
  return accepted
}

export function buildStructuralContextSlice(map: StructuralMapDraft, task: {
  id: string
  title: string
  files?: string[]
  text?: string
}): StructuralContextSlice {
  if (map.stateMachine.state !== 'accepted') {
    return {
      routingAuthority: { packageIds: [], executableUnitIds: [] },
      summaries: ['Structural map exists but is not accepted for routing.'],
      handles: [`structural-map://${map.projectId}/drafts/${map.id}`],
      omitted: [{ handle: `structural-map://${map.projectId}/accepted`, reason: 'map_not_accepted', confidence: 'high' }],
    }
  }
  const matchedPackages = map.nodes
    .filter((node): node is StructuralMapNode & { kind: 'package'; packageId: string } =>
      node.kind === 'package' && Boolean(node.packageId) && taskMatchesPath(task, node.relativePath))
  const primaryPackage = matchedPackages[0]
  const domainId = primaryPackage
    ? map.edges.find(edge => edge.kind === 'package_belongs_to_domain' && edge.from === primaryPackage.id)?.to
    : inferDomainFromText(map, task.text ?? task.title)?.id
  const executableUnits = map.nodes
    .filter(node => node.kind === 'executable_unit' && (!primaryPackage || node.packageId === primaryPackage.packageId))
    .map(node => node.id)
  const gitAuthority = map.nodes.find(node => node.kind === 'git_authority_root' && node.role === 'top_level_authority')
  const handles = [
    domainId ? `structural-map://${map.projectId}/domains/${domainId.replace(/^domain:/, '')}` : undefined,
    ...matchedPackages.map(node => `package://${map.projectId}/${node.packageId}`),
    gitAuthority ? `git-root://${map.projectId}/${gitAuthority.id.replace(/^git:/, '')}` : undefined,
  ].filter((value): value is string => Boolean(value))
  const omitted = map.nodes
    .filter(node => node.kind === 'package' && node.packageId && !matchedPackages.some(candidate => candidate.id === node.id))
    .map(node => ({
      handle: `package://${map.projectId}/${node.packageId}`,
      reason: 'unrelated_to_task_domain' as const,
      confidence: 'high' as const,
    }))
  return {
    routingAuthority: {
      gitAuthorityRootId: gitAuthority?.id,
      primaryDomainId: domainId,
      packageIds: matchedPackages.map(node => node.id),
      executableUnitIds: executableUnits,
    },
    summaries: [
      primaryPackage ? `Task is routed to ${primaryPackage.label}.` : 'Task has no direct package match.',
      domainId ? `Primary domain is ${domainId}.` : 'No primary domain inferred.',
    ],
    handles,
    omitted,
  }
}

export function shapeStructuralDependencyRequest(input: {
  consumerMap: StructuralMapDraft
  providerMap: StructuralMapDraft
  consumerProject: ProjectGraphNodeRef & { path: string }
  providerProject: ProjectGraphNodeRef & { path: string }
  requestedDomainId: string
  consumerNeed: string
  expectedDelivery?: CreateProjectDependencyRequestInput['expectedDelivery']
  requestedBy: string
  now?: string
}): CreateProjectDependencyRequestInput {
  assertAccepted(input.consumerMap, 'consumer')
  assertAccepted(input.providerMap, 'provider')
  const domain = input.providerMap.nodes.find(node => node.id === input.requestedDomainId && node.kind === 'domain_group')
  if (!domain) {
    throw new Error(`Provider structural map ${input.providerMap.id} does not expose requested domain ${input.requestedDomainId}`)
  }
  const providerExecutableUnits = input.providerMap.nodes
    .filter(node => node.kind === 'executable_unit' && node.domainId === domain.id)
    .map(node => node.command)
    .filter((value): value is string => Boolean(value))
  return {
    consumerProject: input.consumerProject,
    providerProject: input.providerProject,
    domain: {
      id: domain.id,
      label: domain.label,
      path: path.join(input.providerProject.path, domain.relativePath ?? '.'),
    },
    consumerNeed: input.consumerNeed,
    rationale: `${domain.id} is provider-owned by ${input.providerProject.label}; ${input.consumerProject.label} must request delivery instead of writing provider files. Provider map ${input.providerMap.id} lists proof paths: ${providerExecutableUnits.join(', ') || 'none'}.`,
    expectedDelivery: input.expectedDelivery,
    requestedBy: input.requestedBy,
    now: input.now,
  }
}

async function applyStructuralTransition(projectRoot: string, mapId: string, input: {
  event: StructuralMapEvent
  actor: string
  evidenceRefs: string[]
  now?: string
}): Promise<StructuralMapDraft> {
  const now = input.now ?? new Date().toISOString()
  const map = readStructuralMap(projectRoot, mapId)
  const result = transition(structuralMapReviewMachine, {
    entityId: map.id,
    currentState: map.stateMachine.state,
    event: input.event,
    context: map,
    actor: input.actor,
    evidenceRefs: input.evidenceRefs,
    now,
  })
  if (result.kind === 'rejected') {
    throw new Error(`Structural map ${map.id} cannot ${input.event.replaceAll('_', ' ')} from ${map.stateMachine.state}: ${result.reason}`)
  }
  map.stateMachine.state = result.nextState
  map.transitionReceipts.push(result.receipt)
  await writeStructuralMap(projectRoot, map)
  return map
}

function structuralMapDir(projectRoot: string): string {
  return path.join(projectRoot, '.guildhall', 'structural-map')
}

async function writeStructuralMap(projectRoot: string, map: StructuralMapDraft): Promise<void> {
  writeJsonFile(path.join(structuralMapDir(projectRoot), 'drafts', `${map.id}.json`), map)
  await writeJsonLinesFile(path.join(structuralMapDir(projectRoot), 'receipts', `${map.id}.jsonl`), map.transitionReceipts)
}

function readStructuralMap(projectRoot: string, mapId: string): StructuralMapDraft {
  const filePath = path.join(structuralMapDir(projectRoot), 'drafts', `${mapId}.json`)
  if (!fs.existsSync(filePath)) throw new Error(`Structural map ${mapId} not found`)
  const map = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StructuralMapDraft
  map.correctionRequests ??= []
  map.transitionReceipts ??= []
  return map
}

interface PackageJson {
  name?: string
  private?: boolean
  packageManager?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

async function discoverWorkspacePackages(projectRoot: string, patterns: string[]): Promise<StructuralMapNode[]> {
  const packageDirs = new Set<string>()
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const base = path.join(projectRoot, pattern.slice(0, -2))
      if (!fs.existsSync(base)) continue
      for (const entry of await fsp.readdir(base, { withFileTypes: true })) {
        if (entry.isDirectory()) packageDirs.add(path.join(base, entry.name))
      }
      continue
    }
    packageDirs.add(path.join(projectRoot, pattern))
  }
  const packages: StructuralMapNode[] = []
  for (const packageDir of [...packageDirs].sort()) {
    const manifestPath = path.join(packageDir, 'package.json')
    const manifest = readJsonIfExists(manifestPath) as PackageJson | undefined
    if (!manifest?.name) continue
    const relativePath = path.relative(projectRoot, packageDir)
    const packageId = slugify(manifest.name)
    packages.push({
      id: `package:${packageId}`,
      kind: 'package',
      label: manifest.name,
      relativePath,
      packageName: manifest.name,
      packageId,
      scripts: manifest.scripts ?? {},
      dependencyNames: Object.keys({
        ...manifest.dependencies,
        ...manifest.devDependencies,
        ...manifest.peerDependencies,
      }),
      evidence: evidence('manifest', `${relativePath}/package.json`, 'high'),
      confidence: 'high',
    })
  }
  return packages
}

function domainNodesForPackage(pkg: StructuralMapNode): StructuralMapNode[] {
  if (!pkg.packageId || !pkg.relativePath) return []
  const domainSlug = pkg.packageId.split('-').at(-1) ?? pkg.packageId
  return [{
    id: `domain:${domainSlug}`,
    kind: 'domain_group',
    label: titleCase(domainSlug),
    relativePath: pkg.relativePath,
    packageId: pkg.packageId,
    evidence: [
      ...evidence('manifest', `${pkg.relativePath}/package.json`, 'medium'),
      ...evidence('path', pkg.relativePath, 'medium'),
    ],
    confidence: 'medium',
  }]
}

function executableUnitsForPackage(pkg: StructuralMapNode): StructuralMapNode[] {
  if (!pkg.packageId || !pkg.relativePath) return []
  const packageId = pkg.packageId
  const relativePath = pkg.relativePath
  return Object.keys(pkg.scripts ?? {}).map(script => ({
    id: `exec:${packageId}:${slugify(script)}`,
    kind: 'executable_unit' as const,
    label: `${pkg.label} ${script}`,
    relativePath,
    packageId,
    domainId: `domain:${packageId.split('-').at(-1) ?? packageId}`,
    command: `pnpm --filter ${pkg.packageName} ${script}`,
    evidence: evidence('script', `${relativePath}/package.json#scripts.${script}`, 'high'),
    confidence: 'high' as const,
  }))
}

function rootExecutableUnits(manifest: PackageJson | undefined): StructuralMapNode[] {
  return Object.entries(manifest?.scripts ?? {}).map(([script]) => ({
    id: `exec:root:${slugify(script)}`,
    kind: 'executable_unit' as const,
    label: `root ${script}`,
    command: `pnpm run ${script}`,
    relativePath: '.',
    evidence: evidence('script', `package.json#scripts.${script}`, 'high'),
    confidence: 'high' as const,
  }))
}

function packageDependencyEdges(packages: StructuralMapNode[]): StructuralMapEdge[] {
  const byName = new Map(packages.map(pkg => [pkg.packageName, pkg]))
  const edges: StructuralMapEdge[] = []
  for (const pkg of packages) {
    for (const dep of pkg.dependencyNames ?? []) {
      const target = byName.get(dep)
      if (target) edges.push({ from: pkg.id, to: target.id, kind: 'package_depends_on' })
    }
  }
  return edges
}

async function discoverIgnoredGitRoots(projectRoot: string): Promise<IgnoredGitRoot[]> {
  const ignored: IgnoredGitRoot[] = []
  await walk(projectRoot, async (absolutePath, dirent) => {
    if (!dirent.isDirectory() || dirent.name !== '.git') return
    const parent = path.dirname(absolutePath)
    const relativePath = path.relative(projectRoot, parent)
    if (relativePath.split(path.sep).includes('node_modules')) {
      ignored.push({
        relativePath,
        reason: 'vendored_dependency_git_metadata',
        evidence: evidence('git', `${relativePath}/.git`, 'high'),
      })
    }
  })
  return ignored.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

async function walk(root: string, visit: (absolutePath: string, dirent: fs.Dirent) => Promise<void>): Promise<void> {
  if (!fs.existsSync(root)) return
  for (const dirent of await fsp.readdir(root, { withFileTypes: true })) {
    const absolutePath = path.join(root, dirent.name)
    await visit(absolutePath, dirent)
    if (dirent.isDirectory() && dirent.name !== '.git' && !['dist', 'build', '.turbo'].includes(dirent.name)) {
      await walk(absolutePath, visit)
    }
  }
}

function readPnpmWorkspacePatterns(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return []
  const parsed = YAML.parse(fs.readFileSync(filePath, 'utf8')) as { packages?: string[] } | undefined
  return Array.isArray(parsed?.packages) ? parsed.packages : []
}

function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function hasNodeCopyEvidence(projectRoot: string, manifest: PackageJson | undefined): boolean {
  return Boolean(manifest?.scripts?.['verify:node-copy-frontier']) ||
    fs.existsSync(path.join(projectRoot, 'docs', 'future', 'node-copy-reduction'))
}

function taskMatchesPath(task: { files?: string[]; text?: string; title?: string }, relativePath?: string): boolean {
  if (!relativePath) return false
  return (task.files ?? []).some(file => file === relativePath || file.startsWith(`${relativePath}/`))
}

function inferDomainFromText(map: StructuralMapDraft, text: string): StructuralMapNode | undefined {
  const normalized = text.toLowerCase()
  return map.nodes.find(node =>
    node.kind === 'domain_group' &&
    (normalized.includes(node.label.toLowerCase()) || normalized.includes(node.id.replace(/^domain:/, ''))))
}

function assertAccepted(map: StructuralMapDraft, role: string): void {
  if (map.stateMachine.state !== 'accepted') {
    throw new Error(`${role} structural map ${map.id} must be accepted before shaping dependency requests`)
  }
}

function uniqueNodes(nodes: StructuralMapNode[]): StructuralMapNode[] {
  return [...new Map(nodes.map(node => [node.id, node])).values()].sort((left, right) => left.id.localeCompare(right.id))
}

function uniqueEdges(edges: StructuralMapEdge[]): StructuralMapEdge[] {
  return [...new Map(edges.map(edge => [`${edge.from}:${edge.kind}:${edge.to}`, edge])).values()]
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`))
}

function evidence(kind: EvidenceRef['kind'], ref: string, confidence: StructuralConfidence): EvidenceRef[] {
  return [{ kind, ref, confidence }]
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
}

function titleCase(value: string): string {
  return value.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}
