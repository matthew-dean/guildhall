import type { ProjectMigrationStatus } from '../../../lib/types.js'

export interface Lever {
  name: string
  position: string
  setBy: string
  rationale: string
  scope: string
  defaultPosition?: string
}

export interface BootstrapStep {
  kind: 'command' | 'gate'
  command: string
  result: 'pass' | 'fail'
  exitCode: number
  output: string
  durationMs: number
}

export interface BootstrapStatus {
  success: boolean
  lastRunAt: string
  durationMs: number
  steps: BootstrapStep[]
}

export interface BootstrapInfo {
  configured: boolean
  needed: boolean
  status: BootstrapStatus | null
  bootstrap?: {
    commands: string[]
    successGates: string[]
    timeoutMs: number
    provenance?: {
      establishedBy: string
      establishedAt: string
      tried: Array<{ command: string; result: string; stderr?: string }>
    } | null
  }
  workspaceProjects?: Array<{
    id: string
    label: string
    path: string
    bootstrap?: {
      commands: string[]
      successGates: string[]
      timeoutMs?: number
    } | null
  }>
}

export interface ProviderStatus {
  configured: boolean
  active?: string
}

export type RuntimeSetupStatus =
  | 'ready'
  | 'missing'
  | 'machine-not-created'
  | 'machine-stopped'
  | 'unsupported-platform'
  | 'unknown-error'

export type RuntimeSetupActionId =
  | 'install-instructions'
  | 'initialize-machine'
  | 'start-machine'
  | 'retry-detection'
  | 'use-host-run-compatibility'

export interface RuntimeSetupAction {
  id: RuntimeSetupActionId
  label: string
  description: string
  mutatesHost: boolean
  requiresApproval: boolean
  command?: string[]
  homebrewAvailable?: boolean
  officialInstallerUrl?: string
}

export interface RuntimeSetupReadout {
  status: RuntimeSetupStatus
  message: string
  platform: string
  supportedHost: boolean
  podmanPath: string | null
  podmanVersion: string | null
  homebrewPath: string | null
  compatibilityModeLabel: string
  installGuidance?: {
    homebrew: string
    officialInstallerUrl: string
  }
  machine: {
    exists: boolean
    name: string | null
    running: boolean
  }
  actions: RuntimeSetupAction[]
}

export type CapabilityAccess = 'read-only' | 'read-write'

export interface CapabilityGrant {
  id: string
  kind: 'mount_directory'
  hostPath: string
  containerPath: string
  access: CapabilityAccess
  duration: string
  status: 'active' | 'revoked'
  evidence: string
}

export interface CapabilityRequest {
  id: string
  taskId: string
  reason: string
  status: 'pending' | 'approved' | 'denied' | 'blocked' | 'revoked'
  grant?: CapabilityGrant
}

export interface WorktreeIncludeCandidate {
  path: string
  reason: string
  selected: boolean
}

export interface WorktreeIncludeScope {
  projectId?: string
  label?: string
  type?: string
  rootPath: string
  include: string[]
  candidates: WorktreeIncludeCandidate[]
}

export interface CodebaseMapStatus {
  configured: boolean
  generatedAt: string | null
  stale: { stale: true; at: string; reason: string; error: string } | null
  counts: { files: number; areas: number; abstractions: number }
  project?: {
    summary: string
    languages: string[]
    packageManagers: string[]
    primaryFrameworks: string[]
  } | null
  entrypoints?: Array<{ kind: string; path: string; summary: string }>
  designSystem?: {
    maturity: 'absent' | 'thin' | 'emerging' | 'established'
    approved: boolean
    tokenCounts: { color: number; spacing: number; typography: number; radius: number; shadow: number }
    primitives: number
    recommendations: string[]
  } | null
  semantic?: {
    modelId: string
    corpusKind: 'documentation' | 'code' | 'mixed' | 'unknown'
    confidence: number
    projectPurpose: string
    currentTruth?: string[]
    readNext: Array<{ path: string; reason: string }>
    workerGuidance: string[]
    needsBroaderRead: boolean
  } | null
  frameworks?: string[]
  packageManagers?: string[]
}

export interface DesignSystemReadout {
  revision?: number
  authoredBy?: string
  authoredAt?: string
  approvedAt?: string
  approvedBy?: string
  primitives?: Array<{ name: string; usage: string }>
  tokens?: Record<string, unknown[]>
  copyVoice?: { tone?: string }
  a11y?: { minContrastRatio?: number }
}

export interface DesignFeedbackReadout {
  findings?: unknown[]
  decisions?: unknown[]
  candidates?: Array<{ summary?: string; targetDesignSystem?: string; status?: string }>
  designSystemImprovements?: Array<{ summary?: string; targetPackage?: string; status?: string }>
  ownerFeedback?: Array<{ summary?: string; status?: string }>
  decisionPackets?: Array<{ summary?: string; workerContext?: string }>
}

export interface ReintakeStatus {
  draftExists?: boolean
  status?: 'draft' | 'applied' | 'dismissed' | string | null
  summary?: {
    kept?: number
    reframed?: number
    merged?: number
    archived?: number
    created?: number
    preservedDone?: number
  } | null
}

export interface SettingsReadiness {
  bootstrap: BootstrapInfo | null
  providers: ProviderStatus | null
  runtime: RuntimeSetupReadout | null
  capabilityRequests: CapabilityRequest[]
  activeCapabilityGrants: CapabilityGrant[]
  migrations: ProjectMigrationStatus | null
}

export interface ProjectIdentity {
  initialized: boolean | null
  name: string
  id: string
  worktreeIncludeText: string
  worktreeIncludeCandidates: WorktreeIncludeCandidate[]
  worktreeIncludeScopes: WorktreeIncludeScope[]
  selectedWorktreeProjectId: string | null
}

export interface OperatingProfileReadout {
  levers: Lever[] | null
  error: string | null
}

export interface DeveloperToolsReadout {
  levers: Lever[] | null
  leversError: string | null
  codebaseMap: CodebaseMapStatus | null
  codebaseMapError: string | null
  designSystem: DesignSystemReadout | null | undefined
  designFeedback: DesignFeedbackReadout | null
  reintakeStatus: ReintakeStatus | null
}
