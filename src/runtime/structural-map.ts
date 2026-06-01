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
export type StructuralFreshness = 'fresh' | 'recent' | 'stale' | 'unknown'

export interface StructuralConflict {
  kind: 'label_conflict' | 'evidence_conflict'
  targetId: string
  summary: string
  evidenceRefs: string[]
}

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
  packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun'
  scripts?: Record<string, string>
  dependencyNames?: string[]
  evidence: EvidenceRef[]
  confidence: StructuralConfidence
  evidenceScore?: number
  freshness?: StructuralFreshness
  conflicts?: StructuralConflict[]
}

export interface StructuralDiscoveryDetection {
  detected: boolean
  evidence: EvidenceRef[]
}

export interface StructuralDiscoveryResult {
  nodes: StructuralMapNode[]
  edges: StructuralMapEdge[]
  evidenceRefs: string[]
}

export interface StructuralDiscoveryProvider {
  id: string
  label: string
  detect: (input: { projectRoot: string }) => Promise<StructuralDiscoveryDetection> | StructuralDiscoveryDetection
  discover: (input: { projectRoot: string }) => Promise<StructuralDiscoveryResult> | StructuralDiscoveryResult
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
  evidence?: EvidenceRef[]
  confidence?: StructuralConfidence
  evidenceScore?: number
  freshness?: StructuralFreshness
  conflicts?: StructuralConflict[]
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

export interface StructuralMapRefreshChange {
  kind: 'added' | 'removed' | 'changed'
  targetId: string
  targetKind: StructuralNodeKind | StructuralMapEdge['kind']
  reviewImpact: 'routing' | 'memory' | 'commands' | 'git_authority' | 'none'
  summary: string
}

export interface StructuralMapRefreshResult {
  id: string
  previousMapId: string
  nextMap: StructuralMapDraft
  changes: StructuralMapRefreshChange[]
  staleNodeIds: string[]
  reviewQuestions: OwnerQuestion[]
  refreshedBy: string
  refreshedAt: string
}

export interface StructuralMapReviewSummaryNode {
  id: string
  label: string
  path?: string
  command?: string
  confidence: StructuralConfidence
  evidenceScore?: number
  freshness?: StructuralFreshness
}

export interface StructuralMapReviewSummaryConflict {
  id: string
  message: string
  severity: 'low' | 'medium' | 'high'
  targetId?: string
}

export interface StructuralMapReviewSummaryQuestion {
  id: string
  prompt: string
  reason?: string
  targetIds?: string[]
}

export interface StructuralMapReviewSummary {
  id: string
  state: StructuralMapState
  generatedAt: string
  counts: {
    gitRoots: number
    ignoredGitRoots: number
    packages: number
    domains: number
    crossCuttingDomains: number
    executableUnits: number
    conflicts: number
    questions: number
  }
  gitRoots: StructuralMapReviewSummaryNode[]
  ignoredGitRoots: StructuralMapReviewSummaryNode[]
  packages: StructuralMapReviewSummaryNode[]
  domains: StructuralMapReviewSummaryNode[]
  crossCuttingDomains: StructuralMapReviewSummaryNode[]
  executableUnits: StructuralMapReviewSummaryNode[]
  conflicts: StructuralMapReviewSummaryConflict[]
  questions: StructuralMapReviewSummaryQuestion[]
}

export interface StructuralDomainCoordinator {
  id: string
  domainIds?: string[]
  crossCuttingDomainIds?: string[]
}

export interface StructuralTaskRoute {
  taskId: string
  primaryDomainId?: string
  coordinatorId?: string
  gitAuthorityRootId?: string
  packageIds: string[]
  executableUnitIds: string[]
  crossCuttingDomainIds: string[]
  routeReasons: string[]
}

export type StructuralAgentRole = 'spec' | 'worker' | 'reviewer' | 'gate_checker'

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

export function defaultStructuralDiscoveryProviders(): StructuralDiscoveryProvider[] {
  return [
    pnpmStructuralDiscoveryProvider,
    npmStructuralDiscoveryProvider,
    yarnStructuralDiscoveryProvider,
    bunStructuralDiscoveryProvider,
    packageJsonWorkspacesStructuralDiscoveryProvider,
    pythonStructuralDiscoveryProvider,
    cargoStructuralDiscoveryProvider,
    composerStructuralDiscoveryProvider,
    dotnetStructuralDiscoveryProvider,
    moduleArchitectureStructuralDiscoveryProvider,
    docsOnlyStructuralDiscoveryProvider,
  ]
}

export const pnpmStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'pnpm-workspace',
  label: 'pnpm workspace',
  detect({ projectRoot }) {
    const workspacePath = path.join(projectRoot, 'pnpm-workspace.yaml')
    const detected = fs.existsSync(workspacePath)
    return {
      detected,
      evidence: detected
        ? evidence('manifest', 'pnpm-workspace.yaml', 'high')
        : evidence('manifest', 'pnpm-workspace.yaml', 'low'),
    }
  },
  async discover({ projectRoot }) {
    const workspacePatterns = readPnpmWorkspacePatterns(path.join(projectRoot, 'pnpm-workspace.yaml'))
    if (workspacePatterns.length === 0) {
      return { nodes: [], edges: [], evidenceRefs: [] }
    }
    const packageNodes = await discoverWorkspacePackageNodes(projectRoot, workspacePatterns, 'pnpm')
    return {
      nodes: [
        {
          id: 'workspace:pnpm',
          kind: 'workspace',
          label: 'pnpm workspace',
          relativePath: '.',
          evidence: evidence('manifest', 'pnpm-workspace.yaml', 'high'),
          confidence: 'high',
        },
        ...packageNodes,
      ],
      edges: [],
      evidenceRefs: ['manifest:pnpm-workspace.yaml'],
    }
  },
}

export const npmStructuralDiscoveryProvider = createPackageJsonWorkspaceProvider({
  id: 'npm-workspaces',
  label: 'npm workspaces',
  workspaceNodeId: 'workspace:npm',
  packageManager: 'npm',
  lockFiles: ['package-lock.json', 'npm-shrinkwrap.json'],
})

export const yarnStructuralDiscoveryProvider = createPackageJsonWorkspaceProvider({
  id: 'yarn-workspaces',
  label: 'yarn workspaces',
  workspaceNodeId: 'workspace:yarn',
  packageManager: 'yarn',
  lockFiles: ['yarn.lock'],
})

export const bunStructuralDiscoveryProvider = createPackageJsonWorkspaceProvider({
  id: 'bun-workspaces',
  label: 'bun workspaces',
  workspaceNodeId: 'workspace:bun',
  packageManager: 'bun',
  lockFiles: ['bun.lock', 'bun.lockb'],
})

export const packageJsonWorkspacesStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'package-json-workspaces',
  label: 'package.json workspaces',
  detect({ projectRoot }) {
    const patterns = readPackageJsonWorkspacePatterns(projectRoot)
    const detected = patterns.length > 0 && !hasAnyLockFile(projectRoot, [
      'pnpm-workspace.yaml',
      'package-lock.json',
      'npm-shrinkwrap.json',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
    ])
    return {
      detected,
      evidence: detected
        ? evidence('manifest', 'package.json#workspaces', 'high')
        : evidence('manifest', 'package.json#workspaces', patterns.length > 0 ? 'medium' : 'low'),
    }
  },
  async discover({ projectRoot }) {
    const patterns = readPackageJsonWorkspacePatterns(projectRoot)
    const packageNodes = await discoverWorkspacePackageNodes(projectRoot, patterns, 'npm')
    return packageJsonWorkspaceResult({
      workspaceNodeId: 'workspace:package-json',
      label: 'package.json workspaces',
      packageNodes,
    })
  },
}

export const pythonStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'python-project',
  label: 'Python project',
  detect({ projectRoot }) {
    const detected = fs.existsSync(path.join(projectRoot, 'pyproject.toml'))
    return {
      detected,
      evidence: evidence('manifest', 'pyproject.toml', detected ? 'high' : 'low'),
    }
  },
  discover({ projectRoot }) {
    const pyproject = fs.readFileSync(path.join(projectRoot, 'pyproject.toml'), 'utf8')
    const projectName = matchFirst(pyproject, /^\s*name\s*=\s*"([^"]+)"/m) ?? path.basename(projectRoot)
    return {
      nodes: [
        {
          id: `package:python-${slugify(projectName)}`,
          kind: 'package',
          label: projectName,
          relativePath: '.',
          packageName: projectName,
          packageId: `python-${slugify(projectName)}`,
          evidence: evidence('manifest', 'pyproject.toml', 'high'),
          confidence: 'high',
        },
        {
          id: 'exec:python:pytest',
          kind: 'executable_unit',
          label: 'pytest',
          relativePath: '.',
          command: 'python -m pytest',
          evidence: evidence('manifest', 'pyproject.toml', 'medium'),
          confidence: 'medium',
        },
      ],
      edges: [],
      evidenceRefs: ['manifest:pyproject.toml'],
    }
  },
}

export const cargoStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'cargo-workspace',
  label: 'Cargo workspace',
  detect({ projectRoot }) {
    const detected = fs.existsSync(path.join(projectRoot, 'Cargo.toml'))
    return {
      detected,
      evidence: evidence('manifest', 'Cargo.toml', detected ? 'high' : 'low'),
    }
  },
  discover({ projectRoot }) {
    const cargo = fs.readFileSync(path.join(projectRoot, 'Cargo.toml'), 'utf8')
    const members = parseQuotedList(matchFirst(cargo, /^\s*members\s*=\s*\[([^\]]+)\]/m) ?? '')
    const packageNodes = members.map((member): StructuralMapNode | undefined => {
      const memberManifestPath = path.join(projectRoot, member, 'Cargo.toml')
      if (!fs.existsSync(memberManifestPath)) return undefined
      const manifest = fs.readFileSync(memberManifestPath, 'utf8')
      const crateName = matchFirst(manifest, /^\s*name\s*=\s*"([^"]+)"/m) ?? path.basename(member)
      return {
        id: `package:cargo-${slugify(crateName)}`,
        kind: 'package',
        label: crateName,
        relativePath: member,
        packageName: crateName,
        packageId: `cargo-${slugify(crateName)}`,
        evidence: evidence('manifest', `${member}/Cargo.toml`, 'high'),
        confidence: 'high',
      }
    }).filter((node): node is StructuralMapNode => Boolean(node))
    return {
      nodes: [
        {
          id: 'workspace:cargo',
          kind: 'workspace',
          label: 'Cargo workspace',
          relativePath: '.',
          evidence: evidence('manifest', 'Cargo.toml', members.length > 0 ? 'high' : 'medium'),
          confidence: members.length > 0 ? 'high' : 'medium',
        },
        ...packageNodes,
        {
          id: 'exec:cargo:test',
          kind: 'executable_unit',
          label: 'cargo test',
          relativePath: '.',
          command: 'cargo test --workspace',
          evidence: evidence('manifest', 'Cargo.toml', 'high'),
          confidence: 'high',
        },
      ],
      edges: [],
      evidenceRefs: ['manifest:Cargo.toml'],
    }
  },
}

export const composerStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'composer-project',
  label: 'Composer project',
  detect({ projectRoot }) {
    const detected = fs.existsSync(path.join(projectRoot, 'composer.json'))
    return {
      detected,
      evidence: evidence('manifest', 'composer.json', detected ? 'high' : 'low'),
    }
  },
  discover({ projectRoot }) {
    const composer = readJsonIfExists(path.join(projectRoot, 'composer.json')) as { name?: string; scripts?: Record<string, string> } | undefined
    const packageName = composer?.name ?? path.basename(projectRoot)
    const nodes: StructuralMapNode[] = [
      {
        id: `package:composer-${slugify(packageName)}`,
        kind: 'package',
        label: packageName,
        relativePath: '.',
        packageName,
        packageId: `composer-${slugify(packageName)}`,
        evidence: evidence('manifest', 'composer.json', 'high'),
        confidence: 'high',
      },
    ]
    if (composer?.scripts?.test) {
      nodes.push({
        id: 'exec:composer:test',
        kind: 'executable_unit',
        label: 'composer test',
        relativePath: '.',
        command: 'composer test',
        evidence: evidence('script', 'composer.json#scripts.test', 'high'),
        confidence: 'high',
      })
    }
    return {
      nodes,
      edges: [],
      evidenceRefs: ['manifest:composer.json'],
    }
  },
}

export const dotnetStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'dotnet-solution',
  label: '.NET solution',
  detect({ projectRoot }) {
    const solution = findFirstFile(projectRoot, file => file.endsWith('.sln'))
    return {
      detected: Boolean(solution),
      evidence: evidence('manifest', solution ? path.basename(solution) : '*.sln', solution ? 'high' : 'low'),
    }
  },
  discover({ projectRoot }) {
    const solution = findFirstFile(projectRoot, file => file.endsWith('.sln'))
    if (!solution) return { nodes: [], edges: [], evidenceRefs: [] }
    const solutionName = path.basename(solution)
    const text = fs.readFileSync(solution, 'utf8')
    const projectMatches = [...text.matchAll(/=\s*"([^"]+)",\s*"([^"]+\.csproj)"/g)]
    const packageNodes = projectMatches.map((match): StructuralMapNode => {
      const label = match[1]
      const relativeProjectPath = match[2].replaceAll('\\', '/')
      return {
        id: `package:dotnet-${slugify(label)}`,
        kind: 'package',
        label,
        relativePath: path.dirname(relativeProjectPath),
        packageName: label,
        packageId: `dotnet-${slugify(label)}`,
        evidence: evidence('manifest', relativeProjectPath, 'high'),
        confidence: 'high',
      }
    })
    return {
      nodes: [
        {
          id: 'workspace:dotnet',
          kind: 'workspace',
          label: solutionName,
          relativePath: '.',
          evidence: evidence('manifest', solutionName, 'high'),
          confidence: 'high',
        },
        ...packageNodes,
        {
          id: 'exec:dotnet:test',
          kind: 'executable_unit',
          label: 'dotnet test',
          relativePath: '.',
          command: `dotnet test ${solutionName}`,
          evidence: evidence('manifest', solutionName, 'high'),
          confidence: 'high',
        },
      ],
      edges: [],
      evidenceRefs: [`manifest:${solutionName}`],
    }
  },
}

export const docsOnlyStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'docs-only',
  label: 'Docs-only project',
  detect({ projectRoot }) {
    const hasDocs = fs.existsSync(path.join(projectRoot, 'docs')) || fs.existsSync(path.join(projectRoot, 'README.md'))
    const hasKnownManifest = [
      'package.json',
      'pnpm-workspace.yaml',
      'pyproject.toml',
      'Cargo.toml',
      'composer.json',
    ].some(file => fs.existsSync(path.join(projectRoot, file))) || Boolean(findFirstFile(projectRoot, file => file.endsWith('.sln')))
    return {
      detected: hasDocs && !hasKnownManifest,
      evidence: hasDocs ? evidence('docs', 'docs-or-readme', 'medium') : evidence('docs', 'docs-or-readme', 'low'),
    }
  },
  discover() {
    return {
      nodes: [
        {
          id: 'domain:docs',
          kind: 'domain_group',
          label: 'Docs',
          relativePath: 'docs',
          evidence: evidence('docs', 'docs', 'medium'),
          confidence: 'medium',
        },
        {
          id: 'exec:docs:review',
          kind: 'executable_unit',
          label: 'manual docs review',
          relativePath: 'docs',
          command: 'review docs manually',
          evidence: evidence('docs', 'README.md', 'low'),
          confidence: 'low',
        },
      ],
      edges: [],
      evidenceRefs: ['docs:docs-or-readme'],
    }
  },
}

export const moduleArchitectureStructuralDiscoveryProvider: StructuralDiscoveryProvider = {
  id: 'module-architecture',
  label: 'Module/class architecture',
  detect({ projectRoot }) {
    const evidenceRefs = collectModuleArchitectureEvidence(projectRoot)
    return {
      detected: evidenceRefs.size > 0,
      evidence: evidenceRefs.size > 0
        ? [...evidenceRefs.values()].flat().slice(0, 6)
        : evidence('path', 'app-or-tests', 'low'),
    }
  },
  discover({ projectRoot }) {
    const evidenceRefs = collectModuleArchitectureEvidence(projectRoot)
    const nodes = [...evidenceRefs.entries()]
      .map(([domain, refs]): StructuralMapNode => ({
        id: `domain:${domain}`,
        kind: 'domain_group',
        label: titleCase(domain),
        relativePath: firstDomainPath(refs) ?? '.',
        evidence: refs,
        confidence: refs.length >= 4 ? 'high' : 'medium',
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
    return {
      nodes,
      edges: [],
      evidenceRefs: ['architecture:module-folders'],
    }
  },
}

function createPackageJsonWorkspaceProvider(input: {
  id: string
  label: string
  workspaceNodeId: string
  packageManager: 'npm' | 'yarn' | 'bun'
  lockFiles: string[]
}): StructuralDiscoveryProvider {
  return {
    id: input.id,
    label: input.label,
    detect({ projectRoot }) {
      const patterns = readPackageJsonWorkspacePatterns(projectRoot)
      const detected = patterns.length > 0 && hasAnyLockFile(projectRoot, input.lockFiles)
      return {
        detected,
        evidence: detected
          ? [
              ...evidence('manifest', 'package.json#workspaces', 'high'),
              ...input.lockFiles
                .filter(lockFile => fs.existsSync(path.join(projectRoot, lockFile)))
                .flatMap(lockFile => evidence('manifest', lockFile, 'high')),
            ]
          : evidence('manifest', 'package.json#workspaces', patterns.length > 0 ? 'medium' : 'low'),
      }
    },
    async discover({ projectRoot }) {
      const packageNodes = await discoverWorkspacePackageNodes(
        projectRoot,
        readPackageJsonWorkspacePatterns(projectRoot),
        input.packageManager,
      )
      return packageJsonWorkspaceResult({
        workspaceNodeId: input.workspaceNodeId,
        label: input.label,
        packageNodes,
      })
    },
  }
}

export async function draftStructuralMap(input: {
  projectId: string
  projectRoot: string
  discoveryProviders?: StructuralDiscoveryProvider[]
  now?: string
}): Promise<StructuralMapDraft> {
  const now = input.now ?? new Date().toISOString()
  const projectRoot = path.resolve(input.projectRoot)
  const rootPackage = readJsonIfExists(path.join(projectRoot, 'package.json')) as PackageJson | undefined
  const providers = input.discoveryProviders ?? defaultStructuralDiscoveryProviders()
  const providerResults = await runStructuralDiscoveryProviders(projectRoot, providers)
  const providerNodes = providerResults.flatMap(result => result.result.nodes)
  const packageNodes = providerNodes.filter((node): node is StructuralMapNode & { kind: 'package' } => node.kind === 'package')
  const providerEvidence = providerResults.flatMap(result => [
    `provider:${result.provider.id}`,
    ...result.result.evidenceRefs,
  ])
  const workspaceDetected = providerNodes.some(node => node.kind === 'workspace')
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
      evidence: workspaceDetected
        ? providerResults.flatMap(result => result.detection.evidence)
        : evidence('manifest', 'pnpm-workspace.yaml', 'low'),
      confidence: workspaceDetected ? 'high' : 'low',
    },
  ]
  nodes.push(...providerNodes.filter(node => node.kind !== 'package'))
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
  for (const result of providerResults) {
    edges.push(...result.result.edges)
  }

  nodes.push(...inferCrossCuttingConcernNodes(projectRoot, rootPackage))

  const ignoredGitRoots = await discoverIgnoredGitRoots(projectRoot)
  const finalNodes = uniqueNodes(nodes)
  const finalEdges = uniqueEdges(edges)
  const ownerQuestions: OwnerQuestion[] = [{
    id: 'confirm-domain-routing',
    reason: 'owner_review_required_before_routing_truth',
    prompt: 'Review the proposed domains, package graph, executable units, and Git authority before Guildhall uses this map for routing.',
    targetIds: finalNodes.filter(node => node.kind === 'domain_group' || node.kind === 'cross_cutting_domain').map(node => node.id),
  }, ...conflictOwnerQuestions(finalNodes, finalEdges)]
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
    nodes: finalNodes,
    edges: finalEdges,
    ignoredGitRoots,
    ownerQuestions,
    correctionRequests: [],
    transitionReceipts: [],
    evidenceRefs: uniqueStrings(['manifest:package.json', ...providerEvidence]),
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

export function readAcceptedStructuralMap(projectRoot: string): StructuralMapDraft | null {
  const filePath = path.join(structuralMapDir(projectRoot), 'accepted.json')
  if (!fs.existsSync(filePath)) return null
  const map = JSON.parse(fs.readFileSync(filePath, 'utf8')) as StructuralMapDraft
  map.correctionRequests ??= []
  map.transitionReceipts ??= []
  return map
}

export function readStructuralMapReviewSummary(projectRoot: string): StructuralMapReviewSummary | null {
  const map = readAcceptedStructuralMap(projectRoot)
  return map ? summarizeStructuralMapForReview(map) : null
}

export async function refreshStructuralMap(input: {
  projectRoot: string
  previousMapId: string
  projectId: string
  actor: string
  now?: string
}): Promise<StructuralMapRefreshResult> {
  const now = input.now ?? new Date().toISOString()
  const previous = readStructuralMap(input.projectRoot, input.previousMapId)
  const nextMap = await draftStructuralMap({
    projectId: input.projectId,
    projectRoot: input.projectRoot,
    now,
  })
  const changes = diffStructuralMaps(previous, nextMap)
  const reviewQuestions = refreshReviewQuestions(changes)
  nextMap.ownerQuestions = [
    ...nextMap.ownerQuestions,
    ...reviewQuestions,
  ]
  await writeStructuralMap(input.projectRoot, nextMap)
  const result: StructuralMapRefreshResult = {
    id: `refresh-${Date.parse(now).toString(36)}`,
    previousMapId: previous.id,
    nextMap,
    changes,
    staleNodeIds: changes
      .filter(change => change.reviewImpact !== 'none')
      .map(change => change.targetId)
      .filter(id => id.startsWith('package:') || id.startsWith('domain:') || id.startsWith('exec:') || id.startsWith('git:') || id.startsWith('cross-cutting:')),
    reviewQuestions,
    refreshedBy: input.actor,
    refreshedAt: now,
  }
  writeJsonFile(path.join(structuralMapDir(input.projectRoot), 'refreshes', `${result.id}.json`), result)
  return result
}

export function summarizeStructuralMapForReview(map: StructuralMapDraft): StructuralMapReviewSummary {
  const nodesByKind = (kind: StructuralNodeKind) => map.nodes.filter(node => node.kind === kind)
  const conflicts = map.nodes
    .flatMap(node => (node.conflicts ?? []).map(conflict => ({
      id: `${conflict.kind}:${conflict.targetId}`,
      message: conflict.summary,
      severity: conflict.evidenceRefs.length > 1 ? 'medium' as const : 'low' as const,
      targetId: conflict.targetId,
    })))
  const gitRoots = nodesByKind('git_authority_root').map(summaryNode)
  const ignoredGitRoots = map.ignoredGitRoots.map((root, index): StructuralMapReviewSummaryNode => ({
    id: `ignored-git-root:${root.relativePath || index}`,
    label: labelFromPath(root.relativePath) || 'Ignored Git root',
    path: root.relativePath,
    confidence: root.evidence[0]?.confidence ?? 'low',
  }))
  const packages = nodesByKind('package').map(summaryNode)
  const domains = nodesByKind('domain_group').map(summaryNode)
  const crossCuttingDomains = nodesByKind('cross_cutting_domain').map(summaryNode)
  const executableUnits = nodesByKind('executable_unit').map(summaryNode)
  const questions = map.ownerQuestions.map(question => ({
    id: question.id,
    prompt: question.prompt,
    reason: question.reason,
    targetIds: question.targetIds,
  }))

  return {
    id: map.id,
    state: map.stateMachine.state,
    generatedAt: map.generatedAt,
    counts: {
      gitRoots: gitRoots.length,
      ignoredGitRoots: ignoredGitRoots.length,
      packages: packages.length,
      domains: domains.length,
      crossCuttingDomains: crossCuttingDomains.length,
      executableUnits: executableUnits.length,
      conflicts: conflicts.length,
      questions: questions.length,
    },
    gitRoots,
    ignoredGitRoots,
    packages,
    domains,
    crossCuttingDomains,
    executableUnits,
    conflicts,
    questions,
  }
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

export function routeTaskWithStructuralMap(input: {
  map: StructuralMapDraft
  task: {
    id: string
    title: string
    files?: string[]
    text?: string
  }
  coordinators?: StructuralDomainCoordinator[]
}): StructuralTaskRoute {
  assertAccepted(input.map, 'task routing')
  const slice = buildStructuralContextSlice(input.map, input.task)
  const crossCuttingDomainIds = activatedCrossCuttingDomains(input.map, input.task)
  const coordinator = input.coordinators?.find(candidate =>
    (slice.routingAuthority.primaryDomainId && candidate.domainIds?.includes(slice.routingAuthority.primaryDomainId)) ||
    crossCuttingDomainIds.some(domainId => candidate.crossCuttingDomainIds?.includes(domainId)))
  const routeReasons: string[] = []
  for (const file of input.task.files ?? []) {
    if (slice.routingAuthority.packageIds.length > 0) routeReasons.push(`matched-file:${file}`)
  }
  for (const domainId of crossCuttingDomainIds) {
    routeReasons.push(`activated-cross-cutting:${domainId}`)
  }
  if (coordinator) routeReasons.push(`assigned-coordinator:${coordinator.id}`)
  return {
    taskId: input.task.id,
    primaryDomainId: slice.routingAuthority.primaryDomainId,
    coordinatorId: coordinator?.id,
    gitAuthorityRootId: slice.routingAuthority.gitAuthorityRootId,
    packageIds: slice.routingAuthority.packageIds,
    executableUnitIds: slice.routingAuthority.executableUnitIds,
    crossCuttingDomainIds,
    routeReasons,
  }
}

export function renderStructuralAgentPacket(input: {
  map: StructuralMapDraft
  task: {
    id: string
    title: string
    files?: string[]
    text?: string
  }
  role: StructuralAgentRole
  coordinators?: StructuralDomainCoordinator[]
}): string {
  const route = routeTaskWithStructuralMap({
    map: input.map,
    task: input.task,
    coordinators: input.coordinators,
  })
  const slice = buildStructuralContextSlice(input.map, input.task)
  const budgetTier = structuralBudgetTier(input.role)
  return [
    '## Structural Map Slice',
    `Role: ${input.role}`,
    `Budget tier: ${budgetTier}`,
    route.primaryDomainId ? `Primary domain: ${route.primaryDomainId}` : 'Primary domain: none inferred',
    route.coordinatorId ? `Coordinator: ${route.coordinatorId}` : '',
    route.gitAuthorityRootId ? `Git authority root: ${route.gitAuthorityRootId}` : '',
    route.packageIds.length > 0 ? `Packages: ${route.packageIds.join(', ')}` : '',
    route.executableUnitIds.length > 0 ? `Executable units: ${route.executableUnitIds.join(', ')}` : '',
    route.crossCuttingDomainIds.length > 0 ? `Cross-cutting domains: ${route.crossCuttingDomainIds.join(', ')}` : '',
    slice.handles.length > 0 ? `Handles: ${slice.handles.join(', ')}` : '',
    slice.omitted.length > 0
      ? `Omitted: ${slice.omitted.map(item => `${item.handle} (${item.reason})`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')
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

async function runStructuralDiscoveryProviders(
  projectRoot: string,
  providers: StructuralDiscoveryProvider[],
): Promise<Array<{
    provider: StructuralDiscoveryProvider
    detection: StructuralDiscoveryDetection
    result: StructuralDiscoveryResult
  }>> {
  const results: Array<{
    provider: StructuralDiscoveryProvider
    detection: StructuralDiscoveryDetection
    result: StructuralDiscoveryResult
  }> = []
  for (const provider of providers) {
    const detection = await provider.detect({ projectRoot })
    if (!detection.detected) continue
    results.push({
      provider,
      detection,
      result: await provider.discover({ projectRoot }),
    })
  }
  return results
}

async function discoverWorkspacePackageNodes(
  projectRoot: string,
  patterns: string[],
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun',
): Promise<StructuralMapNode[]> {
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
      packageManager,
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

function packageJsonWorkspaceResult(input: {
  workspaceNodeId: string
  label: string
  packageNodes: StructuralMapNode[]
}): StructuralDiscoveryResult {
  return {
    nodes: [
      {
        id: input.workspaceNodeId,
        kind: 'workspace',
        label: input.label,
        relativePath: '.',
        evidence: evidence('manifest', 'package.json#workspaces', 'high'),
        confidence: 'high',
      },
      ...input.packageNodes,
    ],
    edges: [],
    evidenceRefs: ['manifest:package.json#workspaces'],
  }
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
    command: packageScriptCommand(pkg.packageManager ?? 'pnpm', pkg.packageName ?? pkg.packageId, script),
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

function readPackageJsonWorkspacePatterns(projectRoot: string): string[] {
  const manifest = readJsonIfExists(path.join(projectRoot, 'package.json')) as PackageJson | undefined
  const workspaces = (manifest as PackageJson & { workspaces?: string[] | { packages?: string[] } } | undefined)?.workspaces
  if (Array.isArray(workspaces)) return workspaces
  if (workspaces && typeof workspaces === 'object' && Array.isArray(workspaces.packages)) return workspaces.packages
  return []
}

function readJsonIfExists(filePath: string): unknown {
  if (!fs.existsSync(filePath)) return undefined
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function hasAnyLockFile(projectRoot: string, lockFiles: string[]): boolean {
  return lockFiles.some(lockFile => fs.existsSync(path.join(projectRoot, lockFile)))
}

function findFirstFile(dir: string, predicate: (file: string) => boolean): string | undefined {
  if (!fs.existsSync(dir)) return undefined
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name)
    if (entry.isFile() && predicate(absolutePath)) return absolutePath
    if (entry.isDirectory() && !['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
      const child = findFirstFile(absolutePath, predicate)
      if (child) return child
    }
  }
  return undefined
}

function findFirstFileContaining(
  dir: string,
  filePredicate: (file: string) => boolean,
  contentPattern: RegExp,
): string | undefined {
  return findFirstFile(dir, (file) => {
    if (!filePredicate(file)) return false
    return contentPattern.test(fs.readFileSync(file, 'utf8'))
  })
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll(path.sep, '/')
}

function collectModuleArchitectureEvidence(projectRoot: string): Map<string, EvidenceRef[]> {
  const domains = new Map<string, EvidenceRef[]>()
  addChildDirectoryDomains(domains, projectRoot, 'app/services')
  addChildDirectoryDomains(domains, projectRoot, 'app/commands')
  addChildDirectoryDomains(domains, projectRoot, 'tests')
  addFilenameDomains(domains, projectRoot, 'app/controllers', /(.+)_controller\.[^.]+$/)
  addFilenameDomains(domains, projectRoot, 'app/jobs', /(.+?)(?:_sync)?_job\.[^.]+$/)
  addFilenameDomains(domains, projectRoot, 'routes', /(.+)\.[^.]+$/)
  addFilenameDomains(domains, projectRoot, 'db/migrations', /(?:create|add|update|alter)_([a-z0-9_]+?)(?:_tables?|_table|_invoices)?\.[^.]+$/)
  return domains
}

function addChildDirectoryDomains(
  domains: Map<string, EvidenceRef[]>,
  projectRoot: string,
  relativeDir: string,
): void {
  const absoluteDir = path.join(projectRoot, relativeDir)
  if (!fs.existsSync(absoluteDir)) return
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    addDomainEvidence(domains, entry.name, path.join(relativeDir, entry.name), 'path')
  }
}

function addFilenameDomains(
  domains: Map<string, EvidenceRef[]>,
  projectRoot: string,
  relativeDir: string,
  pattern: RegExp,
): void {
  const absoluteDir = path.join(projectRoot, relativeDir)
  if (!fs.existsSync(absoluteDir)) return
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const domain = pattern.exec(entry.name)?.[1]
    if (!domain) continue
    addDomainEvidence(domains, singularDomainName(domain), path.join(relativeDir, entry.name), 'path')
  }
}

function addDomainEvidence(
  domains: Map<string, EvidenceRef[]>,
  domainName: string,
  ref: string,
  kind: EvidenceRef['kind'],
): void {
  const domain = slugify(domainName)
  if (!domain) return
  const refs = domains.get(domain) ?? []
  refs.push({ kind, ref, confidence: 'medium' })
  domains.set(domain, refs)
}

function singularDomainName(value: string): string {
  return value
    .replace(/_tables?$/, '')
    .replace(/_invoices$/, '')
    .replace(/_records$/, '')
}

function firstDomainPath(refs: EvidenceRef[]): string | undefined {
  return refs.find(ref => !path.basename(ref.ref).includes('.'))?.ref
}

function hasNodeCopyEvidence(projectRoot: string, manifest: PackageJson | undefined): boolean {
  return Boolean(manifest?.scripts?.['verify:node-copy-frontier']) ||
    fs.existsSync(path.join(projectRoot, 'docs', 'future', 'node-copy-reduction'))
}

function inferCrossCuttingConcernNodes(projectRoot: string, manifest: PackageJson | undefined): StructuralMapNode[] {
  const nodes: StructuralMapNode[] = []
  if (hasNodeCopyEvidence(projectRoot, manifest)) {
    nodes.push(crossCuttingNode({
      id: 'node-copy-reduction',
      label: 'Node-copy reduction',
      evidenceRefs: [
        ...evidence('script', 'verify:node-copy-frontier', manifest?.scripts?.['verify:node-copy-frontier'] ? 'high' : 'low'),
        ...evidence('docs', 'docs/future/node-copy-reduction', fs.existsSync(path.join(projectRoot, 'docs', 'future', 'node-copy-reduction')) ? 'high' : 'low'),
      ],
    }))
  }

  const parserDirs = ['css-parser', 'less-parser', 'scss-parser', 'jess-parser']
    .map(dir => `packages/${dir}`)
    .filter(relative => fs.existsSync(path.join(projectRoot, relative)))
  if (parserDirs.length >= 2) {
    nodes.push(crossCuttingNode({
      id: 'parser-parity',
      label: 'Parser parity',
      evidenceRefs: parserDirs.map(ref => ({ kind: 'path', ref, confidence: 'high' })),
    }))
  }

  if (fs.existsSync(path.join(projectRoot, 'packages', 'ui')) || fs.existsSync(path.join(projectRoot, 'design-system'))) {
    nodes.push(crossCuttingNode({
      id: 'design-system-reuse',
      label: 'Design-system reuse',
      evidenceRefs: [
        ...evidence('path', fs.existsSync(path.join(projectRoot, 'packages', 'ui')) ? 'packages/ui' : 'design-system', 'medium'),
      ],
    }))
  }

  const authEvidence = findFirstFile(projectRoot, file => /(?:^|\/)(auth|session)(?:\/|\.|-|_)/.test(normalizePath(file)))
  if (authEvidence) {
    nodes.push(crossCuttingNode({
      id: 'auth-session-security',
      label: 'Auth/session security',
      evidenceRefs: evidence('path', path.relative(projectRoot, authEvidence), 'medium'),
    }))
  }

  if (fs.existsSync(path.join(projectRoot, 'db', 'migrations')) || fs.existsSync(path.join(projectRoot, 'migrations'))) {
    nodes.push(crossCuttingNode({
      id: 'migrations',
      label: 'Migrations',
      evidenceRefs: evidence('path', fs.existsSync(path.join(projectRoot, 'db', 'migrations')) ? 'db/migrations' : 'migrations', 'high'),
    }))
  }

  const accessibilityEvidence = findFirstFileContaining(projectRoot, file => /\.(svelte|tsx|jsx|html|vue)$/.test(file), /\b(?:aria-|role=)/)
  if (accessibilityEvidence) {
    nodes.push(crossCuttingNode({
      id: 'accessibility',
      label: 'Accessibility',
      evidenceRefs: evidence('path', path.relative(projectRoot, accessibilityEvidence), 'medium'),
    }))
  }

  const observabilityEvidence = findFirstFile(projectRoot, file => /(?:observability|tracing|metrics|logging)/.test(normalizePath(file)))
  if (observabilityEvidence) {
    nodes.push(crossCuttingNode({
      id: 'observability',
      label: 'Observability',
      evidenceRefs: evidence('path', path.relative(projectRoot, observabilityEvidence), 'medium'),
    }))
  }

  if (manifest?.scripts?.release || fs.existsSync(path.join(projectRoot, 'scripts', 'release.mjs'))) {
    nodes.push(crossCuttingNode({
      id: 'release-packaging',
      label: 'Release packaging',
      evidenceRefs: evidence('script', manifest?.scripts?.release ? 'package.json#scripts.release' : 'scripts/release.mjs', 'medium'),
    }))
  }

  nodes.push(...readOwnerDefinedCrossCuttingDomains(projectRoot))
  return uniqueNodes(nodes)
}

function crossCuttingNode(input: {
  id: string
  label: string
  evidenceRefs: EvidenceRef[]
}): StructuralMapNode {
  return {
    id: `cross-cutting:${input.id}`,
    kind: 'cross_cutting_domain',
    label: input.label,
    evidence: input.evidenceRefs,
    confidence: input.evidenceRefs.some(ref => ref.confidence === 'high') ? 'high' : 'medium',
  }
}

function readOwnerDefinedCrossCuttingDomains(projectRoot: string): StructuralMapNode[] {
  const filePath = path.join(projectRoot, '.guildhall', 'structural-domains.json')
  if (!fs.existsSync(filePath)) return []
  const data = readJsonIfExists(filePath) as { crossCuttingDomains?: Array<{ id: string; label?: string; evidenceRefs?: string[] }> } | undefined
  return (data?.crossCuttingDomains ?? []).map(domain => crossCuttingNode({
    id: slugify(domain.id),
    label: domain.label ?? titleCase(domain.id),
    evidenceRefs: (domain.evidenceRefs ?? [`owner:${domain.id}`]).map(ref => ({ kind: 'owner', ref, confidence: 'high' })),
  }))
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

function activatedCrossCuttingDomains(map: StructuralMapDraft, task: { files?: string[]; text?: string; title?: string }): string[] {
  const haystack = `${task.title ?? ''} ${task.text ?? ''} ${(task.files ?? []).join(' ')}`.toLowerCase()
  return map.nodes
    .filter(node => node.kind === 'cross_cutting_domain')
    .filter(node => {
      const slug = node.id.replace(/^cross-cutting:/, '')
      if (haystack.includes(slug.replaceAll('-', ' ')) || haystack.includes(slug)) return true
      if (haystack.includes(node.label.toLowerCase())) return true
      return node.evidence.some(ref => haystack.includes(ref.ref.toLowerCase()))
    })
    .map(node => node.id)
    .sort()
}

function structuralBudgetTier(role: StructuralAgentRole): string {
  switch (role) {
    case 'spec':
      return 'required: domain/questions; high: dependency summary; medium: packages'
    case 'worker':
      return 'required: domain/git/executable units; high: package/cross-cutting; medium: omitted handles'
    case 'reviewer':
      return 'required: spec/domain/cross-cutting; high: proof expectations; medium: dependency impact'
    case 'gate_checker':
      return 'required: executable units/git authority; medium: domain summary'
  }
}

function assertAccepted(map: StructuralMapDraft, role: string): void {
  if (map.stateMachine.state !== 'accepted') {
    throw new Error(`${role} structural map ${map.id} must be accepted before shaping dependency requests`)
  }
}

function uniqueNodes(nodes: StructuralMapNode[]): StructuralMapNode[] {
  const merged = new Map<string, StructuralMapNode>()
  for (const node of nodes) {
    const existing = merged.get(node.id)
    if (!existing) {
      merged.set(node.id, annotateNodeEvidence({ ...node, evidence: [...node.evidence], conflicts: [...node.conflicts ?? []] }))
      continue
    }
    const conflicts = [...existing.conflicts ?? [], ...node.conflicts ?? []]
    if (existing.label !== node.label) {
      conflicts.push({
        kind: 'label_conflict',
        targetId: node.id,
        summary: `Structural evidence disagrees on label "${existing.label}" vs "${node.label}".`,
        evidenceRefs: [...existing.evidence, ...node.evidence].map(ref => ref.ref),
      })
    }
    merged.set(node.id, annotateNodeEvidence({
      ...existing,
      evidence: [...existing.evidence, ...node.evidence],
      confidence: conflicts.length > 0 ? 'conflict' : strongestConfidence(existing.confidence, node.confidence),
      conflicts,
    }))
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function uniqueEdges(edges: StructuralMapEdge[]): StructuralMapEdge[] {
  return [...new Map(edges.map(edge => [`${edge.from}:${edge.kind}:${edge.to}`, edge])).values()]
    .map(annotateEdgeEvidence)
    .sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`))
}

function annotateNodeEvidence(node: StructuralMapNode): StructuralMapNode {
  return {
    ...node,
    evidenceScore: evidenceScore(node.evidence, node.conflicts),
    freshness: evidenceFreshness(node.evidence),
  }
}

function annotateEdgeEvidence(edge: StructuralMapEdge): StructuralMapEdge {
  return {
    ...edge,
    evidence: edge.evidence ?? [],
    confidence: edge.confidence ?? 'medium',
    evidenceScore: evidenceScore(edge.evidence ?? [], edge.conflicts),
    freshness: evidenceFreshness(edge.evidence ?? []),
  }
}

function conflictOwnerQuestions(nodes: StructuralMapNode[], edges: StructuralMapEdge[]): OwnerQuestion[] {
  const nodeQuestions = nodes
    .flatMap(node => node.conflicts ?? [])
    .map(conflict => ({
      id: `resolve-conflict-${slugify(conflict.targetId)}`,
      reason: 'conflicting_structural_evidence',
      prompt: conflict.summary,
      targetIds: [conflict.targetId],
    }))
  const edgeQuestions = edges
    .flatMap(edge => edge.conflicts ?? [])
    .map(conflict => ({
      id: `resolve-conflict-${slugify(conflict.targetId)}`,
      reason: 'conflicting_structural_evidence',
      prompt: conflict.summary,
      targetIds: [conflict.targetId],
    }))
  return [...nodeQuestions, ...edgeQuestions]
}

function diffStructuralMaps(previous: StructuralMapDraft, next: StructuralMapDraft): StructuralMapRefreshChange[] {
  const previousNodes = new Map(previous.nodes.map(node => [node.id, node]))
  const nextNodes = new Map(next.nodes.map(node => [node.id, node]))
  const changes: StructuralMapRefreshChange[] = []
  for (const [id, node] of nextNodes) {
    const before = previousNodes.get(id)
    if (!before) {
      changes.push({
        kind: 'added',
        targetId: id,
        targetKind: node.kind,
        reviewImpact: reviewImpactForNode(node),
        summary: `Added ${node.kind} ${node.label}.`,
      })
      continue
    }
    if (nodeSignature(before) !== nodeSignature(node)) {
      changes.push({
        kind: 'changed',
        targetId: id,
        targetKind: node.kind,
        reviewImpact: reviewImpactForNode(node),
        summary: `Changed ${node.kind} ${node.label}.`,
      })
    }
  }
  for (const [id, node] of previousNodes) {
    if (!nextNodes.has(id)) {
      changes.push({
        kind: 'removed',
        targetId: id,
        targetKind: node.kind,
        reviewImpact: reviewImpactForNode(node),
        summary: `Removed ${node.kind} ${node.label}.`,
      })
    }
  }
  return changes.sort((left, right) => left.targetId.localeCompare(right.targetId))
}

function refreshReviewQuestions(changes: StructuralMapRefreshChange[]): OwnerQuestion[] {
  return changes
    .filter(change => change.reviewImpact !== 'none')
    .map(change => ({
      id: `review-${change.kind}-${slugify(change.targetId)}`,
      reason: `structural_refresh_changed_${change.reviewImpact}`,
      prompt: `${change.summary} Review before this structural change affects ${change.reviewImpact}.`,
      targetIds: [change.targetId],
    }))
}

function reviewImpactForNode(node: StructuralMapNode): StructuralMapRefreshChange['reviewImpact'] {
  if (node.kind === 'git_authority_root') return 'git_authority'
  if (node.kind === 'executable_unit') return 'commands'
  if (node.kind === 'memory_scope') return 'memory'
  if (node.kind === 'package' || node.kind === 'domain_group' || node.kind === 'cross_cutting_domain' || node.kind === 'workspace' || node.kind === 'monorepo') return 'routing'
  return 'none'
}

function nodeSignature(node: StructuralMapNode): string {
  return JSON.stringify({
    kind: node.kind,
    label: node.label,
    relativePath: node.relativePath,
    packageName: node.packageName,
    packageId: node.packageId,
    domainId: node.domainId,
    role: node.role,
    command: node.command,
  })
}

function strongestConfidence(left: StructuralConfidence, right: StructuralConfidence): StructuralConfidence {
  if (left === 'conflict' || right === 'conflict') return 'conflict'
  const order: StructuralConfidence[] = ['low', 'medium', 'high']
  return order.indexOf(left) >= order.indexOf(right) ? left : right
}

function evidenceScore(evidenceRefs: EvidenceRef[], conflicts: StructuralConflict[] = []): number {
  if (conflicts.length > 0) return 0.25
  if (evidenceRefs.length === 0) return 0.5
  const score = evidenceRefs.reduce((sum, ref) => {
    if (ref.confidence === 'high') return sum + 1
    if (ref.confidence === 'medium') return sum + 0.66
    if (ref.confidence === 'low') return sum + 0.33
    return sum + 0.1
  }, 0) / evidenceRefs.length
  return Math.round(score * 100) / 100
}

function evidenceFreshness(evidenceRefs: EvidenceRef[]): StructuralFreshness {
  if (evidenceRefs.some(ref => ref.kind === 'owner' || ref.kind === 'manifest' || ref.kind === 'path' || ref.kind === 'script')) return 'fresh'
  if (evidenceRefs.some(ref => ref.kind === 'docs')) return 'recent'
  return 'unknown'
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort()
}

function evidence(kind: EvidenceRef['kind'], ref: string, confidence: StructuralConfidence): EvidenceRef[] {
  return [{ kind, ref, confidence }]
}

function packageScriptCommand(
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun',
  packageName: string | undefined,
  script: string,
): string {
  const workspace = packageName ?? 'workspace'
  switch (packageManager) {
    case 'npm':
      return `npm --workspace ${workspace} run ${script}`
    case 'yarn':
      return `yarn workspace ${workspace} ${script}`
    case 'bun':
      return `bun --filter ${workspace} run ${script}`
    case 'pnpm':
    default:
      return `pnpm --filter ${workspace} ${script}`
  }
}

function matchFirst(text: string, pattern: RegExp): string | undefined {
  return pattern.exec(text)?.[1]
}

function parseQuotedList(value: string): string[] {
  return [...value.matchAll(/"([^"]+)"/g)].map(match => match[1])
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
}

function summaryNode(node: StructuralMapNode): StructuralMapReviewSummaryNode {
  return {
    id: node.id,
    label: node.packageName ?? node.label,
    path: node.relativePath,
    command: node.command,
    confidence: node.confidence,
    evidenceScore: node.evidenceScore,
    freshness: node.freshness,
  }
}

function labelFromPath(value: string): string {
  if (!value || value === '.') return 'Project root'
  return titleCase(path.basename(value))
}

function titleCase(value: string): string {
  return value.split(/[-_]/g).map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(' ')
}
