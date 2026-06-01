export type CorpusFileKind =
  | 'source'
  | 'test'
  | 'doc'
  | 'config'
  | 'manifest'
  | 'style'
  | 'unknown'

export interface CorpusFileEntry {
  path: string
  mtimeMs: number
  size: number
  sha256: string
  language: string
  kind: CorpusFileKind
  areaIds: string[]
  symbols: string[]
  imports: string[]
  summary: string
}

export interface CorpusEntrypoint {
  kind: string
  path: string
  summary: string
}

export interface CorpusArea {
  id: string
  title: string
  summary: string
  owns: string[]
  canonicalFiles: Array<{
    path: string
    symbols: string[]
    summary: string
  }>
  conventions: string[]
  tests: string[]
}

export interface CorpusAbstraction {
  id: string
  title: string
  kind: string
  canonicalPath: string
  useWhen: string[]
  avoid: string[]
  related: string[]
}

export interface CorpusDesignSystemSummary {
  sourcePath?: string
  revision?: number
  approved: boolean
  tokenCounts: {
    color: number
    spacing: number
    typography: number
    radius: number
    shadow: number
  }
  tokenSamples: string[]
  primitives: Array<{ name: string; usage: string }>
  componentFiles: string[]
  maturity: 'absent' | 'thin' | 'emerging' | 'established'
  recommendations: string[]
}

export type DesignGovernanceDiagnosticSeverity = 'info' | 'warn' | 'blocker'

export type DesignGovernanceDiagnosticKind =
  | 'token_family_split'
  | 'raw_visual_values'
  | 'variant_vocabulary_sprawl'
  | 'duplicate_primitive_family'
  | 'surface_ownership_sprawl'
  | 'missing_component_contract'
  | 'unreviewed_design_exception'

export type DesignGovernanceReviewerRole =
  | 'design'
  | 'accessibility'
  | 'product'
  | 'maintainability'

export interface DesignGovernanceDiagnostic {
  id: string
  severity: DesignGovernanceDiagnosticSeverity
  kind: DesignGovernanceDiagnosticKind
  summary: string
  evidence: Array<{ path: string; line?: number; excerpt?: string }>
  recommendation: string
  appliesToReviewerRoles: DesignGovernanceReviewerRole[]
}

export type DesignGovernanceLearningProposalKind =
  | 'project_design_system_memory_update'
  | 'component_contract_addition'
  | 'corpus_map_override'
  | 'guildhall_product_learning'

export interface DesignGovernanceLearningProposal {
  id: string
  kind: DesignGovernanceLearningProposalKind
  diagnosticKinds: DesignGovernanceDiagnosticKind[]
  summary: string
  evidence: Array<{ path: string; line?: number; excerpt?: string }>
  ownerApprovalRequired: true
}

export interface CorpusDesignGovernanceSummary {
  generatedAt: string
  canonicalDesignSystemAuthority?: string
  tokenAuthority?: string
  componentAuthorityPaths: string[]
  knownDuplicatePrimitiveFamilies: string[]
  variantVocabularyRisks: string[]
  requiredReviewerChecks: string[]
  learningProposals: DesignGovernanceLearningProposal[]
  diagnostics: DesignGovernanceDiagnostic[]
}

export type CorpusSemanticKind = 'documentation' | 'code' | 'mixed' | 'unknown'

export interface CorpusSemanticArea {
  name: string
  purpose: string
  canonicalFiles: string[]
}

export interface CorpusSemanticAbstraction {
  name: string
  purpose: string
  canonicalFiles: string[]
  reuseRule: string
}

export interface CorpusSemanticReadNext {
  path: string
  reason: string
}

export interface CorpusSemanticSummary {
  generatedAt: string
  modelId: string
  corpusKind: CorpusSemanticKind
  confidence: number
  projectPurpose: string
  currentTruth: string[]
  architectureAreas: CorpusSemanticArea[]
  canonicalAbstractions: CorpusSemanticAbstraction[]
  gapsOrRisks: string[]
  readNext: CorpusSemanticReadNext[]
  workerGuidance: string[]
  needsBroaderRead: boolean
}

export interface CorpusSemanticIndexer {
  modelId: string
  completeJson(input: {
    prompt: string
    map: CodebaseMap
  }): Promise<string>
  repairJson?(input: {
    raw: string
    error: string
    schemaHint: string
    map: CodebaseMap
  }): Promise<string>
}

export interface CorpusOverrides {
  conventions?: Array<{
    areaId?: string
    abstractionId?: string
    text: string
  }>
  abstractions?: CorpusAbstraction[]
}

export interface CodebaseMap {
  version: 1
  generatedAt: string
  project: {
    root: string
    summary: string
    languages: string[]
    packageManagers: string[]
    primaryFrameworks: string[]
  }
  files: Record<string, CorpusFileEntry>
  entrypoints: CorpusEntrypoint[]
  areas: CorpusArea[]
  abstractions: CorpusAbstraction[]
  designSystem?: CorpusDesignSystemSummary
  designGovernance?: CorpusDesignGovernanceSummary
  semantic?: CorpusSemanticSummary
  verification: { commands: string[] }
  overrides?: CorpusOverrides
}

export type CodebaseMapRefreshReason =
  | 'manual'
  | 'worker-completion'
  | 'setup'
  | 'workspace-import'
  | 'watcher'
  | 'fallback'

export interface BuildCodebaseMapInput {
  projectRoot: string
  memoryDir?: string
  now?: Date
  semanticIndexer?: CorpusSemanticIndexer
}

export interface RefreshCodebaseMapInput extends BuildCodebaseMapInput {
  touchedFiles?: string[]
  reason: CodebaseMapRefreshReason
}

export interface RefreshCodebaseMapResult {
  map: CodebaseMap
  mode: 'full' | 'partial'
  changedFiles: string[]
  removedFiles: string[]
  affectedAreas: string[]
  affectedAbstractions: string[]
}

export interface CodebaseMapHistoryEvent {
  at: string
  reason: CodebaseMapRefreshReason
  mode: 'full' | 'partial' | 'failed'
  changedFiles: string[]
  removedFiles?: string[]
  affectedAreas?: string[]
  affectedAbstractions?: string[]
  error?: string
}

export interface CodebaseMapStaleState {
  stale: true
  at: string
  reason: string
  error: string
}

export interface CodebaseMapQuery {
  text: string
  area?: string
  kind?: string
  paths?: string[]
  limit?: number
}

export interface ScoredCorpusFile {
  file: CorpusFileEntry
  score: number
  reasons: string[]
}

export interface ScoredCorpusArea {
  area: CorpusArea
  score: number
  reasons: string[]
}

export interface ScoredCorpusAbstraction {
  abstraction: CorpusAbstraction
  score: number
  reasons: string[]
}

export interface CodebaseMapQueryResult {
  files: ScoredCorpusFile[]
  areas: ScoredCorpusArea[]
  abstractions: ScoredCorpusAbstraction[]
  readNext: Array<{ path: string; reason: string }>
  explanations: string[]
}

export interface CorpusTaskContext {
  id: string
  title: string
  description: string
  domain?: string
  acceptanceCriteria?: Array<{ description: string; command?: string }>
  likelyFiles?: string[]
}

export interface ContextBudgetOptions {
  targetChars?: number
  maxChars?: number
  readNextLimit?: number
}

export interface CorpusOverrideNote {
  areaId?: string
  abstractionId?: string
  text: string
}
