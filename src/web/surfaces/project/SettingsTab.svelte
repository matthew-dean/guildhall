<!--
  Settings tab. Primary/secondary/overflow IA:
    · Primary: readiness checklist for bootstrap, coordinators, and provider.
    · Secondary: coordinator routing summary.
    · Overflow: workspace identity, levers, and design system state.
-->
<script lang="ts">
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../packages/ui/src/components/StatusPill.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/Card.svelte'
  import Input from '../../lib/Input.svelte'
  import Select from '../../lib/Select.svelte'
  import Textarea from '../../lib/Textarea.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Byline from '../../lib/Byline.svelte'
  import LogViewer from '../../lib/LogViewer.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import Icon from '../../lib/Icon.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import FactsTab from './FactsTab.svelte'
  import ProjectProvidersSection from './ProjectProvidersSection.svelte'
  import Help from '../../lib/Help.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'
  import { currentProjectHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { buildProductFeedbackIssueUrl } from '../../lib/product-feedback.js'
  import type { ProjectMigrationStatus } from '../../lib/types.js'

  interface Props {
    subView?: string | null
    onMigrate?: () => void | Promise<void>
  }
  let { subView = null, onMigrate }: Props = $props()
  type SettingSection = 'ready' | 'providers' | 'facts' | 'coordinators' | 'learning' | 'reintake' | 'advanced'
  const KNOWN_SECTIONS = new Set<SettingSection>(['ready', 'providers', 'facts', 'coordinators', 'learning', 'reintake', 'advanced'])
  const section = $derived(KNOWN_SECTIONS.has(subView as SettingSection) ? subView as SettingSection : 'ready')
  const settingsSections: Array<{ id: SettingSection; label: string }> = [
    { id: 'ready', label: 'Ready' },
    { id: 'providers', label: 'Providers' },
    { id: 'coordinators', label: 'Coordinators' },
    { id: 'facts', label: 'Facts' },
    { id: 'learning', label: 'Memory' },
    { id: 'reintake', label: 'Re-intake' },
    { id: 'advanced', label: 'Advanced' },
  ]
  const settingsSectionOptions = settingsSections.map(item => ({
    value: item.id,
    label: item.label,
  }))

  function settingsSectionHref(id: SettingSection): string {
    return projectActionHref(id === 'ready' ? '/settings/ready' : `/settings/${id}`)
  }

  interface Lever {
    name: string
    position: string
    setBy: string
    rationale: string
    scope: string
    defaultPosition?: string
  }
  interface DesignSystem {
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
  interface DesignFeedbackStore {
    findings?: unknown[]
    decisions?: unknown[]
    candidates?: Array<{ summary?: string; targetDesignSystem?: string; status?: string }>
    loomaImprovements?: Array<{ summary?: string; targetPackage?: string; status?: string }>
    ownerFeedback?: Array<{ summary?: string; status?: string }>
    decisionPackets?: Array<{ summary?: string; workerContext?: string }>
  }
  interface LoomaHookStatus {
    enabled?: boolean
    status?: 'active' | 'inactive' | string
    reason?: string
    path?: string
    writeThrough?: string
  }
  interface DesignSystemProfile {
    primarySystem?: string
    preview?: { adapter?: string; summary?: string }
    libraries?: Array<{ id?: string; label?: string; role?: string }>
    tokenFiles?: string[]
    componentFiles?: string[]
    proofContract?: { targetDesignSystem?: string; componentIntents?: string[] }
    recommendations?: string[]
  }
  interface DesignTastePacket {
    summary?: string
    taste?: {
      opinions?: {
        interactionSemantics?: {
          mutuallyExclusiveModes?: string
          oneShotCommand?: string
          persistentBinaryState?: string
        }
        paletteStrategy?: {
          defaultMode?: string
          saturationBudget?: string
          avoid?: string[]
        }
        visualDirection?: {
          default?: string
          avoid?: string[]
        }
      }
      patternRecipes?: Record<string, { preferred?: string }>
    }
    layers?: Array<{ id?: string; label?: string; applied?: boolean }>
  }
  interface DesignSystemCatalog {
    previewAdapter?: string
    interactable?: boolean
    entries?: Array<{ id?: string; kind?: string; title?: string; previewUrl?: string }>
    recommendations?: string[]
  }
  interface DesignIntentSurrogate {
    platform?: string
    previewMode?: string
    approximate?: boolean
    label?: string
    warning?: string
    nativeProofRequired?: boolean
    detectedNativeTooling?: string[]
    componentIntents?: string[]
    recommendations?: string[]
  }
  interface LearningEvidence {
    kind?: string
    summary?: string
    ref?: string
    links?: Array<{
      kind?: string
      label?: string
      href?: string
      localHistoryRef?: string
    }>
  }
  interface SuggestedLearning {
    id: string
    summary: string
    destination: string
    scope: 'project' | 'user_global' | 'guildhall_product' | string
    confidence: 'low' | 'medium' | 'high' | string
    risk: 'low' | 'medium' | 'high' | string
    status: 'suggested' | 'active' | 'dismissed' | string
    requiresApproval?: boolean
    evidence?: LearningEvidence[]
    updatedAt?: string
  }
  interface ProductSuggestion {
    id: string
    title: string
    summary: string
    evidence?: string[]
  }
  interface ProjectSkillProposal {
    id: string
    name: string
    description: string
    status: 'suggested' | 'active' | 'dismissed' | string
    risk?: 'low' | 'medium' | 'high' | string
    triggerKeywords?: string[]
    requiresApproval?: boolean
  }
  interface WorkspaceImportLearning {
    approvedRuns?: number
    dismissedRuns?: number
    averageTaskAcceptanceRatio?: number | null
    lastTaskAcceptanceRatio?: number | null
    updatedAt?: string | null
  }
  interface ProjectContextSummary {
    projectBrief?: { present?: boolean; nonEmptyLines?: number }
    projectNotes?: { present?: boolean; nonEmptyLines?: number }
    decisions?: { present?: boolean; nonEmptyLines?: number }
    workspaceGoals?: { present?: boolean; goalCount?: number }
  }
  interface LearningSnapshot {
    project: { suggestedLearnings: SuggestedLearning[]; workspaceImport?: WorkspaceImportLearning } | null
    user: { suggestedLearnings: SuggestedLearning[] } | null
    effective: { productSuggestions: ProductSuggestion[]; workspaceImport?: WorkspaceImportLearning } | null
    projectSkillProposals: ProjectSkillProposal[]
    projectContext?: ProjectContextSummary | null
  }
  interface ReintakeSummary {
    kept?: number
    reframed?: number
    merged?: number
    archived?: number
    created?: number
    preservedDone?: number
  }
  interface ReintakeStatus {
    draftExists?: boolean
    status?: 'draft' | 'applied' | 'dismissed' | string | null
    createdAt?: string | null
    summary?: ReintakeSummary | null
  }
  interface ReintakeDraft {
    status?: string
    summary?: ReintakeSummary
    groups?: Array<{
      id: string
      title: string
      rationale?: string
      changes?: Array<{
        kind?: string
        taskId?: string
        reason?: string
        before?: { title?: string }
        after?: { title?: string }
        task?: { title?: string }
      }>
    }>
  }
  interface CodebaseMapStatus {
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
    areas?: Array<{
      id: string
      title: string
      summary: string
      owns: string[]
      canonicalFiles: Array<{ path: string; symbols: string[]; summary: string }>
      conventions: string[]
      tests: string[]
    }>
    abstractions?: Array<{
      id: string
      title: string
      kind: string
      canonicalPath: string
      useWhen: string[]
      avoid: string[]
      related: string[]
    }>
    designSystem?: {
      maturity: 'absent' | 'thin' | 'emerging' | 'established'
      approved: boolean
      tokenCounts: { color: number; spacing: number; typography: number; radius: number; shadow: number }
      primitives: number
      tokenSamples?: string[]
      componentFiles?: string[]
      recommendations: string[]
    } | null
    semantic?: {
      modelId: string
      corpusKind: 'documentation' | 'code' | 'mixed' | 'unknown'
      confidence: number
      projectPurpose: string
      currentTruth?: string[]
      architectureAreas?: Array<{ name: string; purpose: string; canonicalFiles: string[] }>
      canonicalAbstractions?: Array<{ name: string; purpose: string; canonicalFiles: string[]; reuseRule: string }>
      gapsOrRisks?: string[]
      readNext: Array<{ path: string; reason: string }>
      workerGuidance: string[]
      needsBroaderRead: boolean
    } | null
    frameworks?: string[]
    packageManagers?: string[]
  }

  let initialized = $state<boolean | null>(null)
  let name = $state('')
  let id = $state('')
  let savingIdentity = $state(false)
  let identityStatus = $state<{ text: string; error: boolean } | null>(null)

  let levers = $state<Lever[] | null>(null)
  let leversError = $state<string | null>(null)
  let savingLever = $state<string | null>(null)
  let designSystem = $state<DesignSystem | null | undefined>(undefined)
  let designSystemProfile = $state<DesignSystemProfile | null>(null)
  let designTaste = $state<DesignTastePacket | null>(null)
  let designSystemCatalog = $state<DesignSystemCatalog | null>(null)
  let designIntentSurrogate = $state<DesignIntentSurrogate | null>(null)
  let designFeedback = $state<DesignFeedbackStore | null>(null)
  let loomaHook = $state<LoomaHookStatus | null>(null)
  let codebaseMapStatus = $state<CodebaseMapStatus | null>(null)
  let codebaseMapBusy = $state(false)
  let codebaseMapError = $state<string | null>(null)
  let learning = $state<LearningSnapshot | null>(null)
  let learningError = $state<string | null>(null)
  let learningBusy = $state<string | null>(null)
  let reintakeStatus = $state<ReintakeStatus | null>(null)
  let reintakeDraft = $state<ReintakeDraft | null>(null)
  let reintakeBusy = $state<null | 'rerun' | 'apply'>(null)
  let reintakeError = $state<string | null>(null)
  let reintakeNoDraft = $state(false)
  let reintakeApplied = $state(false)
  let migrationStatus = $state<ProjectMigrationStatus | null>(null)
  let migrationStatusError = $state<string | null>(null)

  interface BootstrapStep {
    kind: 'command' | 'gate'
    command: string
    result: 'pass' | 'fail'
    exitCode: number
    output: string
    durationMs: number
  }
  interface BootstrapStatus {
    success: boolean
    lastRunAt: string
    durationMs: number
    steps: BootstrapStep[]
  }
  interface BootstrapInfo {
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
  let bootstrapInfo = $state<BootstrapInfo | null>(null)
  let bootstrapRunning = $state(false)
  interface WorktreeIncludeCandidate {
    path: string
    reason: string
    selected: boolean
  }
  interface WorktreeIncludeScope {
    projectId?: string
    label?: string
    type?: string
    rootPath: string
    include: string[]
    candidates: WorktreeIncludeCandidate[]
  }
  let worktreeIncludeText = $state('')
  let worktreeIncludeCandidates = $state<WorktreeIncludeCandidate[]>([])
  let worktreeIncludeScopes = $state<WorktreeIncludeScope[]>([])
  let selectedWorktreeProjectId = $state<string | null>(null)
  let worktreeIncludeBusy = $state(false)
  let worktreeIncludeStatus = $state<{ text: string; error: boolean } | null>(null)

  interface ProviderStatus {
    configured: boolean
    active?: string
  }
  let providerStatus = $state<ProviderStatus | null>(null)

  type RuntimeSetupStatus =
    | 'ready'
    | 'missing'
    | 'machine-not-created'
    | 'machine-stopped'
    | 'unsupported-platform'
    | 'unknown-error'
  type RuntimeSetupActionId =
    | 'install-instructions'
    | 'initialize-machine'
    | 'start-machine'
    | 'retry-detection'
    | 'use-host-run-compatibility'
  interface RuntimeSetupAction {
    id: RuntimeSetupActionId
    label: string
    description: string
    mutatesHost: boolean
    requiresApproval: boolean
    command?: string[]
    homebrewAvailable?: boolean
    officialInstallerUrl?: string
  }
  interface RuntimeSetupReadout {
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
  let runtimeSetup = $state<RuntimeSetupReadout | null>(null)
  let runtimeSetupBusy = $state<RuntimeSetupActionId | null>(null)
  let runtimeSetupError = $state<string | null>(null)
  type CapabilityAccess = 'read-only' | 'read-write'
  interface CapabilityGrant {
    id: string
    kind: 'mount_directory'
    hostPath: string
    containerPath: string
    access: CapabilityAccess
    duration: string
    status: 'active' | 'revoked'
    evidence: string
  }
  interface CapabilityRequest {
    id: string
    taskId: string
    reason: string
    status: 'pending' | 'approved' | 'denied' | 'blocked' | 'revoked'
    grant?: CapabilityGrant
  }
  let capabilityRequests = $state<CapabilityRequest[]>([])
  let activeCapabilityGrants = $state<CapabilityGrant[]>([])
  let capabilityGrantBusyId = $state<string | null>(null)
  let capabilityGrantError = $state<string | null>(null)

  $effect(() => {
    projectFetch('/api/setup/status')
      .then(r => r.json())
      .then(s => {
        initialized = Boolean(s.initialized)
        name = s.name ?? ''
        id = s.id ?? ''
      })
      .catch(() => (initialized = false))
    projectFetch('/api/config/levers')
      .then(r => r.json())
      .then(j => {
        if (j.error) leversError = String(j.error)
        else levers = j.levers ?? []
      })
      .catch(err => (leversError = err instanceof Error ? err.message : String(err)))
    projectFetch('/api/project/design-system')
      .then(r => r.json())
      .then(j => (designSystem = j?.designSystem ?? null))
      .catch(() => (designSystem = null))
    projectFetch('/api/project/design-system/discovery')
      .then(r => r.json())
      .then(j => (designSystemProfile = j ?? null))
      .catch(() => (designSystemProfile = null))
    projectFetch('/api/project/design-taste')
      .then(r => r.json())
      .then(j => (designTaste = j ?? null))
      .catch(() => (designTaste = null))
    projectFetch('/api/project/design-system/catalog')
      .then(r => r.json())
      .then(j => (designSystemCatalog = j ?? null))
      .catch(() => (designSystemCatalog = null))
    projectFetch('/api/project/design-intent-surrogate')
      .then(r => r.json())
      .then(j => (designIntentSurrogate = j ?? null))
      .catch(() => (designIntentSurrogate = null))
    projectFetch('/api/project/design-feedback')
      .then(r => r.json())
      .then(j => {
        designFeedback = j?.feedback ?? null
        loomaHook = j?.loomaHook ?? null
      })
      .catch(() => {
        designFeedback = null
        loomaHook = null
      })
    void loadCodebaseMapStatus()
    projectFetch('/api/setup/providers')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return
        const preferred = j?.preferredProvider
        const preferredMeta = typeof preferred === 'string' ? j?.providers?.[preferred] : null
        providerStatus = {
          configured: Boolean(preferred && preferredMeta?.detected),
          active: preferredMeta?.label ?? preferred ?? undefined,
        }
      })
      .catch(() => (providerStatus = { configured: false }))
    void loadBootstrap()
    void loadLearning()
    void loadReintakeStatus()
    void loadMigrationStatus()
    void loadWorktreeIncludes()
    void loadRuntimeSetup()
    void loadCapabilityGrants()
  })

  $effect(() => {
    if (section === 'reintake') void loadReintakeDraft()
  })

  async function loadCapabilityGrants() {
    try {
      const r = await projectFetch('/api/project/capability-requests', { cache: 'no-store' })
      const j = await r.json() as {
        requests?: CapabilityRequest[]
        activeGrants?: CapabilityGrant[]
        error?: string
      }
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
      capabilityRequests = j.requests ?? []
      activeCapabilityGrants = j.activeGrants ?? []
      capabilityGrantError = null
    } catch (err) {
      capabilityGrantError = err instanceof Error ? err.message : String(err)
      capabilityRequests = []
      activeCapabilityGrants = []
    }
  }

  async function revokeCapabilityGrant(grant: CapabilityGrant) {
    const request = capabilityRequests.find(candidate => candidate.grant?.id === grant.id)
    if (!request) return
    capabilityGrantBusyId = grant.id
    capabilityGrantError = null
    try {
      const r = await projectFetch(`/api/project/capability-requests/${encodeURIComponent(request.id)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Revoked from project settings.' }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
      await loadCapabilityGrants()
    } catch (err) {
      capabilityGrantError = err instanceof Error ? err.message : String(err)
    } finally {
      capabilityGrantBusyId = null
    }
  }

  async function loadRuntimeSetup() {
    try {
      const r = await projectFetch('/api/project/runtime/setup', { cache: 'no-store' })
      const j = await r.json() as RuntimeSetupReadout & { error?: string }
      if (j.error) {
        runtimeSetupError = j.error
        return
      }
      runtimeSetup = {
        ...j,
        machine: j.machine ?? { exists: false, name: null, running: false },
        actions: j.actions ?? [],
      }
      runtimeSetupError = null
    } catch (err) {
      runtimeSetupError = err instanceof Error ? err.message : String(err)
    }
  }

  function runtimeStatusTone(status: RuntimeSetupStatus): 'ok' | 'warn' | 'neutral' {
    if (status === 'ready') return 'ok'
    if (status === 'unsupported-platform') return 'neutral'
    return 'warn'
  }

  function runtimeStatusLabel(status: RuntimeSetupStatus): string {
    switch (status) {
      case 'ready': return 'ready'
      case 'missing': return 'needs Podman'
      case 'machine-not-created': return 'setup needed'
      case 'machine-stopped': return 'stopped'
      case 'unsupported-platform': return 'compatibility mode'
      case 'unknown-error': return 'needs attention'
    }
  }

  async function runRuntimeSetupAction(action: RuntimeSetupAction) {
    if (action.id === 'install-instructions') {
      const url = action.officialInstallerUrl ?? runtimeSetup?.installGuidance?.officialInstallerUrl
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      return
    }

    runtimeSetupBusy = action.id
    runtimeSetupError = null
    try {
      const r = await projectFetch('/api/project/runtime/setup/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action.id, approved: action.mutatesHost }),
      })
      const j = await r.json() as {
        ok?: boolean
        error?: string
        status?: RuntimeSetupReadout
      }
      if (!r.ok || j.error) {
        runtimeSetupError = j.error ?? `Runtime setup action failed with ${r.status}.`
      }
      if (j.status) runtimeSetup = j.status
    } catch (err) {
      runtimeSetupError = err instanceof Error ? err.message : String(err)
    } finally {
      runtimeSetupBusy = null
    }
  }

  async function loadBootstrap() {
    try {
      const r = await projectFetch('/api/project/bootstrap/status')
      bootstrapInfo = (await r.json()) as BootstrapInfo
    } catch {
      bootstrapInfo = null
    }
  }

  async function loadWorktreeIncludes() {
    try {
      const suffix = selectedWorktreeProjectId
        ? `?workspaceProjectId=${encodeURIComponent(selectedWorktreeProjectId)}`
        : ''
      const r = await projectFetch(`/api/project/worktree-includes${suffix}`, { cache: 'no-store' })
      const j = await r.json() as {
        include?: string[]
        candidates?: WorktreeIncludeCandidate[]
        scopes?: WorktreeIncludeScope[]
        error?: string
      }
      if (j.error) {
        worktreeIncludeStatus = { text: j.error, error: true }
        return
      }
      worktreeIncludeScopes = j.scopes ?? []
      if (!selectedWorktreeProjectId && worktreeIncludeScopes.some(scope => scope.projectId)) {
        selectedWorktreeProjectId = worktreeIncludeScopes.find(scope => scope.projectId)?.projectId ?? null
      }
      const activeScope = selectedWorktreeProjectId
        ? worktreeIncludeScopes.find(scope => scope.projectId === selectedWorktreeProjectId)
        : null
      if (activeScope) {
        worktreeIncludeText = activeScope.include.join('\n')
        worktreeIncludeCandidates = activeScope.candidates
        return
      }
      worktreeIncludeText = (j.include ?? []).join('\n')
      worktreeIncludeCandidates = j.candidates ?? []
    } catch (err) {
      worktreeIncludeStatus = { text: err instanceof Error ? err.message : String(err), error: true }
    }
  }

  async function saveWorktreeIncludes() {
    worktreeIncludeBusy = true
    worktreeIncludeStatus = null
    try {
      const r = await projectFetch('/api/project/worktree-includes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          includeText: worktreeIncludeText,
          ...(selectedWorktreeProjectId ? { workspaceProjectId: selectedWorktreeProjectId } : {}),
        }),
      })
      const j = await r.json() as { include?: string[]; error?: string }
      if (j.error) {
        worktreeIncludeStatus = { text: j.error, error: true }
        return
      }
      worktreeIncludeText = (j.include ?? []).join('\n')
      worktreeIncludeStatus = { text: 'Saved', error: false }
      await loadWorktreeIncludes()
    } finally {
      worktreeIncludeBusy = false
    }
  }

  function addWorktreeIncludeCandidate(candidate: string) {
    const lines = worktreeIncludeText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!lines.includes(candidate)) lines.push(candidate)
    worktreeIncludeText = lines.join('\n')
  }

  function selectWorktreeIncludeScope(scope: WorktreeIncludeScope) {
    selectedWorktreeProjectId = scope.projectId ?? null
    worktreeIncludeText = scope.include.join('\n')
    worktreeIncludeCandidates = scope.candidates
    worktreeIncludeStatus = null
  }

  async function loadLearning() {
    try {
      learningError = null
      const r = await projectFetch('/api/project/learning')
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || typeof j !== 'object') {
        learningError = j && typeof j === 'object' && 'error' in j
          ? String(j.error)
          : `HTTP ${r.status}`
        return
      }
      if ('error' in j && j.error) {
        learningError = String(j.error)
        return
      }
      learning = {
        project: 'project' in j ? j.project ?? null : null,
        user: 'user' in j ? j.user ?? null : null,
        effective: 'effective' in j ? j.effective ?? null : null,
        projectSkillProposals: 'projectSkillProposals' in j ? j.projectSkillProposals ?? [] : [],
        projectContext: 'projectContext' in j ? j.projectContext ?? null : null,
      }
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadReintakeStatus() {
    try {
      const r = await projectFetch('/api/project/reintake/status', { cache: 'no-store' })
      const j = await r.json().catch(() => null) as ReintakeStatus & { error?: string } | null
      if (!r.ok || j?.error) throw new Error(j?.error ?? `HTTP ${r.status}`)
      reintakeStatus = j
      reintakeError = null
    } catch (err) {
      reintakeError = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadMigrationStatus() {
    try {
      const r = await projectFetch('/api/project/migrations', { cache: 'no-store' })
      const j = await r.json().catch(() => null) as ProjectMigrationStatus & { error?: string } | null
      if (!r.ok || j?.error) throw new Error(j?.error ?? `HTTP ${r.status}`)
      migrationStatus = j
      migrationStatusError = null
    } catch (err) {
      migrationStatusError = err instanceof Error ? err.message : String(err)
      migrationStatus = null
    }
  }

  async function loadReintakeDraft() {
    try {
      const r = await projectFetch('/api/project/reintake/draft', { cache: 'no-store' })
      const j = await r.json().catch(() => null) as ReintakeDraft & { error?: string } | null
      if (!r.ok || j?.error) {
        const message = j?.error ?? `HTTP ${r.status}`
        if (r.status === 404 && /no re-intake draft/i.test(message)) {
          reintakeDraft = null
          reintakeError = null
          reintakeNoDraft = true
          return
        }
        throw new Error(message)
      }
      reintakeDraft = j
      reintakeError = null
      reintakeNoDraft = false
      reintakeApplied = j?.status === 'applied'
    } catch (err) {
      reintakeError = err instanceof Error ? err.message : String(err)
      reintakeDraft = null
      reintakeNoDraft = false
    }
  }

  async function startReintake() {
    reintakeBusy = 'rerun'
    reintakeError = null
    try {
      const r = await projectFetch('/api/project/reintake/rerun', { method: 'POST' })
      const j = await r.json().catch(() => null) as { draft?: ReintakeDraft; error?: string } | null
      if (!r.ok || j?.error) throw new Error(j?.error ?? `HTTP ${r.status}`)
      reintakeDraft = j?.draft ?? null
      reintakeNoDraft = false
      reintakeApplied = false
      await loadReintakeStatus()
    } catch (err) {
      reintakeError = err instanceof Error ? err.message : String(err)
    } finally {
      reintakeBusy = null
    }
  }

  async function applyReintakeSelected() {
    const groupIds = reintakeDraft?.groups?.map(group => group.id) ?? []
    reintakeBusy = 'apply'
    reintakeError = null
    try {
      const r = await projectFetch('/api/project/reintake/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupIds }),
      })
      const j = await r.json().catch(() => null) as { error?: string } | null
      if (!r.ok || j?.error) throw new Error(j?.error ?? `HTTP ${r.status}`)
      reintakeDraft = reintakeDraft
        ? { ...reintakeDraft, status: 'applied', groups: [] }
        : null
      reintakeApplied = true
      await loadReintakeStatus()
    } catch (err) {
      reintakeError = err instanceof Error ? err.message : String(err)
    } finally {
      reintakeBusy = null
    }
  }

  async function loadCodebaseMapStatus() {
    try {
      codebaseMapError = null
      const r = await projectFetch('/api/project/codebase-map/status')
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || typeof j !== 'object') {
        codebaseMapError = j && typeof j === 'object' && 'error' in j
          ? String(j.error)
          : `HTTP ${r.status}`
        return
      }
      if ('error' in j && j.error) {
        codebaseMapError = String(j.error)
        return
      }
      codebaseMapStatus = j as CodebaseMapStatus
    } catch (err) {
      codebaseMapError = err instanceof Error ? err.message : String(err)
    }
  }

  async function refreshCodebaseMap() {
    if (codebaseMapBusy) return
    codebaseMapBusy = true
    codebaseMapError = null
    try {
      const r = await projectFetch('/api/project/codebase-map/refresh', { method: 'POST' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || typeof j !== 'object' || ('error' in j && j.error)) {
        codebaseMapError = j && typeof j === 'object' && 'error' in j
          ? String(j.error)
          : `HTTP ${r.status}`
        return
      }
      codebaseMapStatus = (j as { status?: CodebaseMapStatus }).status ?? null
    } catch (err) {
      codebaseMapError = err instanceof Error ? err.message : String(err)
    } finally {
      codebaseMapBusy = false
    }
  }

  let bootstrapError = $state<string | null>(null)
  let bootstrapToast = $state<{ text: string; tone: 'ok' | 'danger' } | null>(null)

  function flashToast(text: string, tone: 'ok' | 'danger'): void {
    bootstrapToast = { text, tone }
    setTimeout(() => {
      if (bootstrapToast?.text === text) bootstrapToast = null
    }, 4500)
  }

  function summarizeBootstrapResult(j: unknown): string {
    const detected = (j as {
      detected?: { packageManager?: string; gates?: Record<string, { available?: boolean }> }
    })?.detected
    if (!detected) return 'Bootstrap verified.'
    const pm = detected.packageManager ?? 'none'
    const gates = detected.gates
      ? Object.entries(detected.gates)
          .filter(([, value]) => value?.available)
          .map(([key]) => key)
      : []
    const gateList = gates.length > 0 ? gates.join(', ') : 'no gates'
    return `Bootstrap verified (${pm}): ${gateList}`
  }

  async function runBootstrap() {
    if (bootstrapRunning) return
    bootstrapRunning = true
    bootstrapError = null
    try {
      const r = await projectFetch('/api/project/bootstrap/run', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        bootstrapError = j?.error ?? `HTTP ${r.status}`
        flashToast(`Bootstrap failed: ${bootstrapError}`, 'danger')
      } else {
        flashToast(summarizeBootstrapResult(j), 'ok')
      }
      await loadBootstrap()
    } catch (err) {
      bootstrapError = err instanceof Error ? err.message : String(err)
      flashToast(`Bootstrap failed: ${bootstrapError}`, 'danger')
    } finally {
      bootstrapRunning = false
    }
  }

  async function resetLevers() {
    try {
      leversError = null
      const r = await projectFetch('/api/config/levers/reset', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (j?.error) {
        leversError = String(j.error)
        return
      }
      const fresh = await projectFetch('/api/config/levers').then(r => r.json())
      levers = fresh.levers ?? []
    } catch (err) {
      leversError = err instanceof Error ? err.message : String(err)
    }
  }

  async function saveLever(lever: Lever, nextValue: string) {
    const key = `${lever.scope}:${lever.name}`
    savingLever = key
    leversError = null
    try {
      const r = await projectFetch('/api/config/levers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: lever.scope,
          name: lever.name,
          position: nextValue === 'same_as_global' ? null : nextValue,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        leversError = j?.error ?? `HTTP ${r.status}`
        return
      }
      levers = j.levers ?? []
    } catch (err) {
      leversError = err instanceof Error ? err.message : String(err)
    } finally {
      savingLever = null
    }
  }

  async function runLearningAction(kind: string, scope: 'project' | 'user_global', id?: string) {
    learningBusy = `${kind}:${scope}:${id ?? 'all'}`
    try {
      const r = await projectFetch('/api/project/learning/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, scope, id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        learningError = j?.error ?? `HTTP ${r.status}`
        return
      }
      await loadLearning()
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
    } finally {
      learningBusy = null
    }
  }

  async function runSkillAction(kind: string, id?: string, approved = false) {
    learningBusy = `skill:${kind}:${id ?? 'all'}`
    try {
      const r = await projectFetch('/api/project/skill-proposals/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, approved }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        learningError = j?.error ?? `HTTP ${r.status}`
        return
      }
      await loadLearning()
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
    } finally {
      learningBusy = null
    }
  }

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])

  const workspaceChildProjects = $derived(bootstrapInfo?.workspaceProjects ?? [])
  const hasWorkspaceChildProjects = $derived(workspaceChildProjects.length > 0)
  const workspaceChildGateCount = $derived(
    workspaceChildProjects.reduce((count, child) => count + (child.bootstrap?.successGates?.length ?? 0), 0),
  )
  const bootstrapVerified = $derived(Boolean(
    bootstrapInfo?.configured && bootstrapInfo?.status?.success && !bootstrapInfo?.needed,
  ))
  const bootstrapReady = $derived(Boolean(
    bootstrapVerified ||
    (bootstrapInfo && !bootstrapInfo.configured && !bootstrapInfo.needed && !hasWorkspaceChildProjects),
  ))
  const bootstrapShellLabel = $derived(
    bootstrapInfo?.configured && bootstrapInfo?.status?.success && bootstrapInfo?.needed
      ? 're-run needed'
      : bootstrapInfo?.configured && bootstrapInfo?.status?.success
      ? 'passed'
      : bootstrapInfo?.configured
        ? 'failed'
        : hasWorkspaceChildProjects
          ? `${workspaceChildProjects.length} child project${workspaceChildProjects.length === 1 ? '' : 's'}`
          : bootstrapInfo && !bootstrapInfo.needed
            ? 'not required'
            : 'not set',
  )
  const bootstrapShellTone = $derived(
    bootstrapReady
      ? 'ok'
      : bootstrapInfo?.configured && bootstrapInfo?.status?.success && bootstrapInfo?.needed
        ? 'warn'
      : bootstrapInfo?.configured
        ? 'danger'
        : hasWorkspaceChildProjects
          ? 'info'
          : 'warn',
  )
  const providerReady = $derived(Boolean(providerStatus?.configured))
  const coordinatorsReady = $derived(coordinators.length > 0)
  const readinessCount = $derived(
    (bootstrapReady ? 1 : 0) + (coordinatorsReady ? 1 : 0) + (providerReady ? 1 : 0),
  )
  const projectStartBlocker = $derived(
    project.detail?.startReadiness?.canStart === false &&
      project.detail.startReadiness.code !== 'all_terminal'
      ? project.detail.startReadiness
      : null,
  )
  const readinessPillLabel = $derived(projectStartBlocker ? 'Blocked' : `${readinessCount}/3 ready`)
  const readinessPillTone = $derived(projectStartBlocker ? 'warn' : readinessCount === 3 ? 'ok' : 'warn')
  const migrationCount = $derived((migrationStatus?.blocked?.length ?? 0) + (migrationStatus?.pending?.length ?? 0))
  const hasSecondaryMigrations = $derived(
    migrationCount > 0 && projectStartBlocker?.code !== 'required_migration_pending',
  )

  function flashIdentity(text: string, error: boolean) {
    identityStatus = { text, error }
    setTimeout(() => {
      if (identityStatus?.text === text) identityStatus = null
    }, 2500)
  }

  async function saveIdentity() {
    const nm = name.trim()
    const slug = id.trim()
    if (!nm) return flashIdentity('Name is required', true)
    if (!/^[a-z0-9-]+$/.test(slug)) return flashIdentity('Invalid ID', true)
    savingIdentity = true
    try {
      const r = await projectFetch('/api/setup/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nm, id: slug }),
      })
      const j = await r.json()
      if (j.error) return flashIdentity(j.error, true)
      flashIdentity('Saved', false)
      void project.refresh()
    } finally {
      savingIdentity = false
    }
  }

  async function approveDesignSystem() {
    const r = await projectFetch('/api/project/design-system/approve', { method: 'POST' })
    const j = await r.json()
    if (j.error) return alert('Approve failed: ' + j.error)
    const reload = await projectFetch('/api/project/design-system').then(r => r.json())
    designSystem = reload?.designSystem ?? null
  }

  const leversByScope = $derived.by(() => {
    const out = new Map<string, Lever[]>()
    for (const lever of levers ?? []) {
      if (!out.has(lever.scope)) out.set(lever.scope, [])
      out.get(lever.scope)!.push(lever)
    }
    return [...out.entries()]
  })

  const leverNameLabels: Record<string, string> = {
    agent_health_strictness: 'Stuck-agent detection',
    business_envelope_strictness: 'Product-risk strictness',
    completion_approval: 'Completion approval',
    concurrent_task_dispatch: 'Task dispatch',
    crash_recovery_default: 'Crash recovery',
    escalation_on_ambiguity: 'Ambiguity handling',
    landing_strategy: 'Where work lands',
    max_revisions: 'Revision limit',
    pre_rejection_policy: 'Pre-rejection handling',
    rejection_dampening: 'Review strictness',
    remediation_autonomy: 'Recovery autonomy',
    review_effort: 'Review effort',
    reviewer_fanout_policy: 'Reviewer agreement',
    reviewer_mode: 'Review style',
    runtime_isolation: 'Runtime isolation',
    spec_completeness: 'Spec detail level',
    task_origination: 'Who can create tasks',
    workspace_import_autonomy: 'Existing-work import',
    worktree_isolation: 'Worktree isolation',
  }
  const leverPositionLabels: Record<string, string> = {
    advisory: 'Advisory',
    agent_autonomous: 'Agent autonomous',
    agent_proposed_coordinator_approved: 'Agent proposes, coordinator approves',
    agent_proposed_human_approved: 'Agent proposes, human approves',
    always: 'Always',
    auto: 'Automatic',
    cherry_pick_local: 'Land locally',
    cherry_pick_with_push: 'Land and push',
    confirm_all: 'Confirm all recovery',
    confirm_destructive: 'Confirm destructive recovery',
    coordinator_adjudicates_on_conflict: 'Coordinator adjudicates conflicts',
    coordinator_first: 'Coordinator first',
    coordinator_sufficient: 'Coordinator approval',
    deterministic_only: 'Deterministic only',
    emergent: 'Emergent',
    fanout_2: 'Two at a time',
    fanout_4: 'Four at a time',
    fanout_2_reviewers: 'Two reviewers',
    fanout_4_reviewers: 'Four reviewers',
    full_upfront: 'Full upfront',
    gates_sufficient: 'Verification gates',
    hard_suppress_after_2: 'Hard suppress after 2',
    hard_suppress_after_3: 'Hard suppress after 3',
    first_pass: 'First pass only',
    human_only: 'Human only',
    human_required: 'Human approval',
    lax: 'Lax',
    lenient: 'Lenient',
    llm_only: 'LLM only',
    llm_with_deterministic_fallback: 'LLM with deterministic fallback',
    majority: 'Majority',
    manual_pr: 'Manual PR',
    minimal: 'Minimal',
    never: 'Never',
    none: 'None',
    off: 'Off',
    pause_all_on_issue: 'Pause all on issue',
    pause_for_review: 'Pause for review',
    per_attempt: 'Per attempt',
    per_task: 'Per task',
    prefer_restart_clean: 'Prefer clean restart',
    prefer_resume: 'Prefer resume',
    requeue_lower_priority: 'Requeue lower priority',
    requeue_with_dampening: 'Requeue with dampening',
    release_critical: 'Release-critical',
    same_as_global: 'Same as global setting',
    serial: 'Serial',
    soft_penalty_after_2: 'Soft penalty after 2',
    soft_penalty_after_3: 'Soft penalty after 3',
    slot_allocation: 'Slot allocation',
    stage_appropriate: 'Stage appropriate',
    standard: 'Standard',
    strict: 'Strict',
    suggest: 'Suggest',
    terminal_shelved: 'Shelve terminal failures',
    thorough: 'Thorough',
  }
  const leverOptions: Record<string, string[]> = {
    agent_health_strictness: ['lax', 'standard', 'strict'],
    business_envelope_strictness: ['strict', 'advisory', 'off'],
    completion_approval: ['human_required', 'coordinator_sufficient', 'gates_sufficient'],
    concurrent_task_dispatch: ['serial', 'fanout_2', 'fanout_4'],
    crash_recovery_default: ['prefer_resume', 'prefer_restart_clean', 'pause_for_review'],
    escalation_on_ambiguity: ['always', 'coordinator_first', 'never'],
    landing_strategy: ['cherry_pick_local', 'cherry_pick_with_push', 'manual_pr'],
    max_revisions: ['1', '2', '3', '4', '5'],
    pre_rejection_policy: ['terminal_shelved', 'requeue_lower_priority', 'requeue_with_dampening'],
    rejection_dampening: ['off', 'soft_penalty_after_2', 'soft_penalty_after_3', 'hard_suppress_after_2', 'hard_suppress_after_3'],
    remediation_autonomy: ['auto', 'confirm_destructive', 'confirm_all', 'pause_all_on_issue'],
    review_effort: ['lean', 'balanced', 'thorough', 'release_critical'],
    reviewer_fanout_policy: ['strict', 'coordinator_adjudicates_on_conflict', 'advisory', 'majority'],
    reviewer_mode: ['llm_only', 'deterministic_only', 'llm_with_deterministic_fallback'],
    runtime_isolation: ['none', 'slot_allocation'],
    spec_completeness: ['full_upfront', 'stage_appropriate', 'emergent'],
    task_origination: ['human_only', 'agent_proposed_human_approved', 'agent_proposed_coordinator_approved', 'agent_autonomous'],
    workspace_import_autonomy: ['off', 'suggest', 'apply'],
    worktree_isolation: ['none', 'per_task', 'per_attempt'],
  }

  function humanizeLeverName(name: string): string {
    return leverNameLabels[name] ?? name.replace(/[_.-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  function leverScopeLabel(scope: string): string {
    if (scope === 'project') return 'Project behavior'
    if (scope === 'domain:default') return 'Default task behavior'
    if (scope.startsWith('domain:')) return `${scope.slice('domain:'.length)} task behavior`
    return scope.replaceAll('_', ' ')
  }

  function leverPositionLabel(position: string): string {
    return leverPositionLabels[position] ?? position.replaceAll('_', ' ')
  }

  function leverSetByLabel(setBy: string): string {
    switch (setBy) {
      case 'system-default':
        return 'Same as global setting'
      case 'user-direct':
        return 'Project override'
      case 'inferred':
        return 'Learned from this project'
      default:
        return setBy.replaceAll('_', ' ').replaceAll('-', ' ')
    }
  }

  function optionsForLever(lever: Lever): string[] {
    return leverOptions[lever.name] ?? [lever.position]
  }

  function selectValueForLever(lever: Lever): string {
    return lever.setBy === 'system-default' ? 'same_as_global' : lever.position
  }

  function selectOptionsForLever(lever: Lever): Array<{ value: string; label: string }> {
    const values = new Set(optionsForLever(lever))
    if (lever.position && lever.setBy !== 'system-default') values.add(lever.position)
    if (lever.defaultPosition) values.add(lever.defaultPosition)
    return [
      { value: 'same_as_global', label: `Same as global setting${lever.defaultPosition ? ` (${leverPositionLabel(lever.defaultPosition)})` : ''}` },
      ...[...values].map(value => ({ value, label: leverPositionLabel(value) })),
    ]
  }

  const dsTokenCount = $derived(
    designSystem
      ? (designSystem.tokens?.color?.length ?? 0) +
        (designSystem.tokens?.spacing?.length ?? 0) +
        (designSystem.tokens?.typography?.length ?? 0) +
        (designSystem.tokens?.radius?.length ?? 0) +
        (designSystem.tokens?.shadow?.length ?? 0)
      : 0,
  )
  const designTasteLayerCount = $derived(
    designTaste?.layers
      ? `${designTaste.layers.filter(layer => layer.applied).length} of ${designTaste.layers.length} layers`
      : '—',
  )
  const designCatalogSummary = $derived(
    designSystemCatalog
      ? `${designSystemCatalog.previewAdapter ?? 'none'} · ${designSystemCatalog.entries?.length ?? 0} item${(designSystemCatalog.entries?.length ?? 0) === 1 ? '' : 's'}`
      : '—',
  )
  const designIntentSummary = $derived(
    designIntentSurrogate
      ? `${designIntentSurrogate.platform ?? 'unknown'} · ${designIntentSurrogate.previewMode ?? 'none'}`
      : '—',
  )
  const projectLearnings = $derived(
    (learning?.project?.suggestedLearnings ?? [])
      .filter(item => item.scope === 'project' && item.destination !== 'product_suggestion'),
  )
  const userLearnings = $derived(
    (learning?.user?.suggestedLearnings ?? [])
      .filter(item => item.scope === 'user_global' || item.destination === 'user_preference' || item.destination === 'model_lane_recommendation'),
  )
  const skillProposals = $derived(learning?.projectSkillProposals ?? [])
  const productSuggestions = $derived(learning?.effective?.productSuggestions ?? [])
  const recentMemoryUse = $derived(project.detail?.memoryHealth?.recentUse ?? [])
  const reintakeSummaryText = $derived.by(() => {
    const summary = reintakeStatus?.summary ?? reintakeDraft?.summary
    if (!summary) return 'No draft yet'
    const parts = [
      `${summary.reframed ?? 0} reframed`,
      `${summary.created ?? 0} created`,
      `${summary.archived ?? 0} archived`,
    ]
    return parts.join(', ')
  })
  const reintakeGroupCount = $derived(reintakeDraft?.groups?.length ?? 0)
  const projectContextRows = $derived.by(() => {
    const rows: Array<{ label: string; value: string; detail: string; href?: string }> = []
    const context = learning?.projectContext
    if (context?.projectBrief?.present) {
      const lines = context.projectBrief.nonEmptyLines ?? 0
      rows.push({
        label: 'Project brief',
        value: lines > 0 ? 'saved' : 'empty',
        detail: lines > 0
          ? 'The product direction is saved and available to agents.'
          : 'A brief file exists, but it does not have useful content yet.',
        href: '/settings/facts',
      })
    }
    const goalCount = context?.workspaceGoals?.goalCount ?? 0
    if (context?.workspaceGoals?.present || goalCount > 0) {
      rows.push({
        label: 'Workspace goals',
        value: goalCount > 0 ? `${goalCount} goal${goalCount === 1 ? '' : 's'}` : 'saved',
        detail: 'Approved intake/workspace goals are available as project context.',
        href: '/workspace-import',
      })
    }
    const approvedRuns = learning?.project?.workspaceImport?.approvedRuns ?? learning?.effective?.workspaceImport?.approvedRuns ?? 0
    if (approvedRuns > 0) {
      rows.push({
        label: 'Import choices',
        value: `${approvedRuns} approved`,
        detail: 'Guildhall remembers that you accepted prior workspace-import shaping choices.',
        href: '/workspace-import',
      })
    }
    const decisionLines = context?.decisions?.nonEmptyLines ?? 0
    if (decisionLines > 0) {
      rows.push({
        label: 'Decision log',
        value: `${decisionLines} lines`,
        detail: 'Past project decisions are saved for agent context.',
      })
    }
    const projectNoteLines = context?.projectNotes?.nonEmptyLines ?? 0
    if (projectNoteLines > 0) {
      rows.push({
        label: 'Project notes',
        value: `${projectNoteLines} lines`,
        detail: 'Project-specific notes are saved for agent context.',
      })
    }
    return rows
  })
  const activeLearningCount = $derived(
    projectLearnings.filter(item => item.status === 'active').length +
      userLearnings.filter(item => item.status === 'active').length +
      skillProposals.filter(item => item.status === 'active').length,
  )
  const suggestedLearningCount = $derived(
    projectLearnings.filter(item => item.status === 'suggested').length +
      userLearnings.filter(item => item.status === 'suggested').length +
      skillProposals.filter(item => item.status === 'suggested').length,
  )

  function learningDestinationLabel(destination: string): string {
    switch (destination) {
      case 'project_memory':
        return 'Project memory'
      case 'project_skill':
        return 'Project playbook'
      case 'project_policy':
        return 'Project rule'
      case 'user_preference':
        return 'Your preference'
      case 'model_lane_recommendation':
        return 'Model suggestion'
      case 'product_suggestion':
        return 'Guildhall idea'
      default:
        return destination.replaceAll('_', ' ')
    }
  }

  function learningStatusLabel(status: string): string {
    switch (status) {
      case 'active':
        return 'in use'
      case 'suggested':
        return 'waiting'
      case 'dismissed':
        return 'ignored'
      default:
        return status
    }
  }

  function learningStatusTone(status: string): 'ok' | 'warn' | 'neutral' {
    if (status === 'active') return 'ok'
    if (status === 'suggested') return 'warn'
    return 'neutral'
  }

  function confidenceLabel(confidence: string): string {
    switch (confidence) {
      case 'high':
        return 'Strong signal'
      case 'medium':
        return 'Some evidence'
      case 'low':
        return 'Weak signal'
      default:
        return confidence
    }
  }

  function riskLabel(risk: string | undefined): string | null {
    if (!risk || risk === 'low') return null
    return risk === 'medium' ? 'Needs care' : 'High impact'
  }
</script>

{#if initialized === null}
  <NoticeBand tone="neutral" role="status" label="Settings" title="Loading settings">
    <p>Fetching project setup, provider, and design-system state…</p>
  </NoticeBand>
{:else if !initialized}
  <NoticeBand tone="warn" role="note" label="Settings" title="Project not initialized yet">
    {#snippet actions()}
      <Button variant="primary" onclick={() => nav(currentProjectHref('/setup'))}>Open setup wizard</Button>
    {/snippet}
    <p>Complete the setup wizard first.</p>
  </NoticeBand>
{:else}
  <div class="settings-shell">
    {#if bootstrapToast}
      <NoticeBand
        tone={bootstrapToast.tone === 'ok' ? 'ok' : 'danger'}
        role={bootstrapToast.tone === 'ok' ? 'status' : 'alert'}
        label="Bootstrap"
        title={bootstrapToast.tone === 'ok' ? 'Bootstrap verified' : 'Bootstrap failed'}
        density="compact"
      >
        <p>{bootstrapToast.text}</p>
      </NoticeBand>
    {/if}

    <div class="settings-section-picker">
      <label class="settings-section-picker-label" for="settings-section-select">Section</label>
      <Select
        id="settings-section-select"
        ariaLabel="Settings section"
        value={section}
        options={settingsSectionOptions}
        onchange={(value) => nav(settingsSectionHref(value as SettingSection))}
      />
    </div>

    <Card className="settings-section-card" frosted>
      <nav class="settings-section-nav" aria-label="Settings sections">
        {#each settingsSections as item (item.id)}
          {@const active = section === item.id}
          <Button
            variant={active ? 'secondary' : 'ghost'}
            size="md"
            className="settings-section-button"
            aria-current={active ? 'page' : undefined}
            onclick={() => nav(settingsSectionHref(item.id))}
          >
            {item.label}
          </Button>
        {/each}
      </nav>
    </Card>

    {#if section === 'facts'}
      <FactsTab />
    {:else if section === 'providers'}
      <ProjectProvidersSection />
    {:else if section === 'ready'}
      <SectionHeader
        eyebrow="Settings"
        title="Ready to start?"
        description="Check the prerequisites Guildhall needs before unattended project runs."
        headingTag="h2"
        density="compact"
      >
        {#snippet meta()}
          <StatusPill
            label={readinessPillLabel}
            tone={readinessPillTone}
            emphasis="default"
          />
        {/snippet}
      </SectionHeader>

      {#if hasSecondaryMigrations}
        <NoticeBand tone="neutral" icon="refresh-cw" density="compact">
          <strong>
            {migrationCount} pending Guildhall migration{migrationCount === 1 ? '' : 's'} will need review after the current blocker.
          </strong>
          {#snippet actions()}
            <Button variant="secondary" size="sm" onclick={() => { void onMigrate?.() }}>Review migrations</Button>
          {/snippet}
        </NoticeBand>
      {:else if migrationStatusError}
        <NoticeBand tone="warn" icon="alert-triangle" density="compact">
          <strong>Could not check project migrations: {migrationStatusError}</strong>
        </NoticeBand>
      {/if}

      <Card className="readiness-card" frosted>
        <ul class="checklist">
          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">Bootstrap</span>
              <span class="check-detail">Project bootstrap commands and success gates.</span>
            </div>
            <div class="check-actions">
              <StatusPill
                label={bootstrapShellLabel}
                tone={bootstrapShellTone}
              />
              {#if !bootstrapReady}
                <Button variant="agent" size="sm" onclick={runBootstrap} disabled={bootstrapRunning}>
                  <Icon name="sparkles" size={14} />
                  {bootstrapRunning ? 'Running…' : 'Run bootstrap'}
                </Button>
              {/if}
            </div>
            {#if bootstrapError}
              <div class="row-error">{bootstrapError}</div>
            {/if}
          </li>

          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">Coordinators</span>
              <span class="check-detail">Routing roles that own planning and task execution.</span>
            </div>
            <div class="check-actions">
              <StatusPill
                label={coordinatorsReady ? `${coordinators.length} defined` : 'none'}
                tone={coordinatorsReady ? 'ok' : 'warn'}
              />
              {#if !coordinatorsReady}
                <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/settings/coordinators'))}>
                  Open coordinators
                </Button>
              {/if}
            </div>
          </li>

          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">LLM provider</span>
              <span class="check-detail">Active model host and runtime selection for this project.</span>
            </div>
            <div class="check-actions">
              <StatusPill
                label={providerReady ? (providerStatus?.active ?? 'configured') : 'not configured'}
                tone={providerReady ? 'ok' : 'warn'}
              />
              {#if !providerReady}
                <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/settings/providers'))}>
                  Choose provider
                </Button>
              {/if}
            </div>
          </li>
        </ul>
      </Card>

      <Card className="runtime-setup-card" frosted>
        <div class="runtime-head">
          <div class="runtime-head-copy">
            <h3>Local runtime</h3>
            <p>Guildhall can run project work in a Podman-backed Debian runtime on macOS. Until that is ready, host-run compatibility stays available.</p>
          </div>
          {#if runtimeSetup}
            <StatusPill
              label={runtimeStatusLabel(runtimeSetup.status)}
              tone={runtimeStatusTone(runtimeSetup.status)}
            />
          {/if}
        </div>
        {#if runtimeSetup}
          <Stack gap="3">
            <p class="runtime-message">{runtimeSetup.message}</p>
            <dl class="runtime-facts" aria-label="Local runtime setup facts">
              <UtilityPanel as="div" className="runtime-fact" tone="neutral">
                <dt>Host</dt>
                <dd>{runtimeSetup.platform === 'darwin' ? 'macOS' : runtimeSetup.platform}</dd>
              </UtilityPanel>
              <UtilityPanel as="div" className="runtime-fact" tone="neutral">
                <dt>Podman</dt>
                <dd>{runtimeSetup.podmanVersion ?? (runtimeSetup.podmanPath ? 'installed' : 'not installed')}</dd>
              </UtilityPanel>
              <UtilityPanel as="div" className="runtime-fact" tone="neutral">
                <dt>Service</dt>
                <dd>{runtimeSetup.machine.exists ? `${runtimeSetup.machine.name ?? 'default'} ${runtimeSetup.machine.running ? 'running' : 'stopped'}` : 'not created'}</dd>
              </UtilityPanel>
            </dl>
            {#if runtimeSetup.status === 'missing'}
              <NoticeBand tone="neutral" role="note" label="Install" title="Podman is a separate Mac runtime" density="compact">
                <p>
                  Guildhall does not install Podman during package install. Use the official macOS installer,
                  or Homebrew if it is already on this Mac, then come back here and retry.
                </p>
                {#if runtimeSetup.homebrewPath}
                  <p>Homebrew is available at <code>{runtimeSetup.homebrewPath}</code>; the matching install command is <code>{runtimeSetup.installGuidance?.homebrew}</code>.</p>
                {:else}
                  <p>Homebrew was not detected, so the official Podman macOS installer is the guided path.</p>
                {/if}
              </NoticeBand>
            {/if}
            <div class="runtime-actions">
              {#each runtimeSetup.actions as action (action.id)}
                <Button
                  variant={action.id === 'use-host-run-compatibility' ? 'ghost' : action.mutatesHost ? 'agent' : 'secondary'}
                  size="sm"
                  disabled={runtimeSetupBusy !== null}
                  onclick={() => runRuntimeSetupAction(action)}
                >
                  {#if runtimeSetupBusy === action.id}
                    Working…
                  {:else}
                    {action.label}
                  {/if}
                </Button>
              {/each}
            </div>
            <p class="runtime-compatibility">{runtimeSetup.compatibilityModeLabel} keeps existing host execution available when setup is skipped or fails.</p>
          </Stack>
        {:else}
          <p class="muted">Checking local runtime setup…</p>
        {/if}
        {#if runtimeSetupError}
          <p class="row-error">{runtimeSetupError}</p>
        {/if}
      </Card>

      <FrameCard class="capability-grants-card" density="compact">
        {#snippet header()}
          <SectionHeader
            title="Extra folder access"
            description="Approved mounts are narrow, visible, and revocable from the project."
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill
                label={activeCapabilityGrants.length === 1 ? '1 active grant' : `${activeCapabilityGrants.length} active grants`}
                tone={activeCapabilityGrants.length > 0 ? 'warn' : 'ok'}
              />
            {/snippet}
          </SectionHeader>
        {/snippet}

        {#if activeCapabilityGrants.length > 0}
          <Stack gap="3">
            {#each activeCapabilityGrants as grant (grant.id)}
              <UtilityPanel as="div" className="grant-row" tone="neutral">
                <div class="grant-copy">
                  <Row gap="2" align="center" wrap>
                    <strong>{grant.hostPath}</strong>
                    <StatusPill label={grant.access} tone={grant.access === 'read-only' ? 'ok' : 'warn'} />
                    <StatusPill label={grant.duration} tone="neutral" />
                  </Row>
                  <p>{grant.containerPath}</p>
                  <p>{grant.evidence}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={capabilityGrantBusyId === grant.id}
                  onclick={() => revokeCapabilityGrant(grant)}
                >
                  {capabilityGrantBusyId === grant.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </UtilityPanel>
            {/each}
          </Stack>
        {:else}
          <p class="muted">No extra host folders are mounted for this project.</p>
        {/if}
        {#if capabilityGrantError}
          <p class="row-error">{capabilityGrantError}</p>
        {/if}
      </FrameCard>

      {#if hasWorkspaceChildProjects}
        <NoticeBand
          tone="info"
          role="note"
          label="Workspace"
          title="This workspace coordinates child projects"
          density="compact"
        >
          <p>
            The root shell is the council layer. Task bootstrap and verification should come from the
            child project a task belongs to, so a missing root package file is not itself a project failure.
          </p>
          <ul class="workspace-project-list" aria-label="Child project bootstrap contracts">
            {#each workspaceChildProjects as child (child.id)}
              <li>
                <span class="workspace-project-name">{child.label}</span>
                <span class="workspace-project-path">{child.path}</span>
                {#if child.bootstrap?.commands?.length}
                  <span>{child.bootstrap.commands.length} setup command{child.bootstrap.commands.length === 1 ? '' : 's'}</span>
                {/if}
                {#if child.bootstrap?.successGates?.length}
                  <span>{child.bootstrap.successGates.length} gate{child.bootstrap.successGates.length === 1 ? '' : 's'}</span>
                {/if}
              </li>
            {/each}
          </ul>
          {#if workspaceChildGateCount === 0}
            <p class="workspace-project-note">
              No child gates are configured yet. Add gates to each child project before expecting fully unattended work.
            </p>
          {/if}
        </NoticeBand>
      {/if}

      {#if bootstrapInfo?.configured}
        <FrameCard
          tone={bootstrapInfo.status?.success ? 'info' : bootstrapInfo.status ? 'warn' : 'default'}
          class="bootstrap-card"
        >
          {#snippet header()}
            <SectionHeader
              title="Bootstrap detail"
              description="The last verification pass and the commands behind it."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                <StatusPill
                  label={bootstrapInfo.status?.success ? 'passed' : bootstrapInfo.status ? 'failed' : 'never run'}
                  tone={bootstrapInfo.status?.success ? 'ok' : bootstrapInfo.status ? 'danger' : 'warn'}
                />
                {#if bootstrapInfo.needed}
                  <StatusPill label="re-run needed" tone="warn" />
                {/if}
              {/snippet}
            </SectionHeader>
          {/snippet}

          <Stack gap="3">
            {#if bootstrapInfo.status}
              <Byline verb="Last run" at={bootstrapInfo.status.lastRunAt} />
            {/if}

            <DefinitionList
              size="sm"
              items={[
                ['Commands', bootstrapInfo.bootstrap?.commands.join(' · ') ?? '—'],
                ['Gates', bootstrapInfo.bootstrap?.successGates.join(' · ') ?? '—'],
                [
                  'Established by',
                  bootstrapInfo.bootstrap?.provenance
                    ? `${bootstrapInfo.bootstrap.provenance.establishedBy} (${bootstrapInfo.bootstrap.provenance.establishedAt})`
                    : null,
                ],
              ]}
            />

            {#if bootstrapInfo.status && bootstrapInfo.status.steps.length > 0}
              <LogViewer
                lines={bootstrapInfo.status.steps.map(
                  step =>
                    `[${step.result === 'pass' ? '✓' : '✗'}] ${step.kind}: ${step.command} (${step.durationMs}ms)`,
                )}
                maxHeight="200px"
              />
            {/if}

            <Row justify="end">
              <Button variant="agent" onclick={runBootstrap} disabled={bootstrapRunning}>
                <Icon name="sparkles" size={14} />
                {bootstrapRunning ? 'Running…' : 'Re-run bootstrap'}
              </Button>
            </Row>
          </Stack>
        </FrameCard>
      {/if}
    {:else if section === 'coordinators'}
      <SectionHeader
        eyebrow="Settings"
        title="Coordinators"
        description="The project’s routing layer for planning, review, and execution."
        headingTag="h2"
        density="compact"
      >
        {#snippet meta()}
          <StatusPill
            label={coordinatorsReady ? `${coordinators.length} defined` : 'none'}
            tone={coordinatorsReady ? 'ok' : 'warn'}
          />
        {/snippet}
      </SectionHeader>

      {#if coordinators.length === 0}
        <NoticeBand tone="warn" role="note" label="Coordinators" title="No coordinators yet">
          <p>Run meta-intake to bootstrap routing for this project.</p>
        </NoticeBand>
      {:else}
        <FrameCard class="coordinators-card">
          <div class="coord-list">
            {#each coordinators as coordinator, i (coordinator.id ?? coordinator.name ?? i)}
              <UtilityPanel as="section" className="coord" tone="neutral">
                <header class="coord-title">
                  <strong>{coordinator.name ?? coordinator.id}</strong>
                  {#if coordinator.domain}
                    <span class="muted">{coordinator.domain}</span>
                  {/if}
                </header>
                {#if coordinator.mandate}
                  <Markdown source={coordinator.mandate} />
                {/if}
              </UtilityPanel>
            {/each}
          </div>
        </FrameCard>
      {/if}
    {:else if section === 'learning'}
      <SectionHeader
        eyebrow="Settings"
        title="Memory controls"
        description="See what Guildhall knows, what it wants to reuse, and where that memory recently entered agent context."
        headingTag="h2"
        density="compact"
      >
        {#snippet meta()}
          <StatusPill label={`${activeLearningCount} in use`} tone={activeLearningCount > 0 ? 'ok' : 'neutral'} />
          <StatusPill label={`${suggestedLearningCount} waiting`} tone={suggestedLearningCount > 0 ? 'warn' : 'neutral'} />
        {/snippet}
      </SectionHeader>

      {#if learningError}
        <NoticeBand tone="danger" role="alert" label="Learning" title="Could not load learned behavior" density="compact">
          <p>{learningError}</p>
        </NoticeBand>
      {:else if !learning}
        <NoticeBand tone="neutral" role="status" label="Learning" title="Loading learned behavior" density="compact">
          <p>Reading project and user learning records…</p>
        </NoticeBand>
      {:else}
        <FrameCard class="learning-card learning-card-wide context-card">
          {#snippet header()}
            <SectionHeader
              title="Re-intake Project"
              description="Re-read this project with the current Guildhall reasoning model and propose a cleaner task graph. Existing tasks and progress are used as evidence, not treated as final."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                <StatusPill label={reintakeStatus?.status === 'draft' ? 'Draft ready' : reintakeStatus?.status === 'applied' ? 'Applied' : 'Not started'} tone={reintakeStatus?.status === 'draft' ? 'warn' : reintakeStatus?.status === 'applied' ? 'ok' : 'neutral'} density="dense" />
              {/snippet}
            </SectionHeader>
          {/snippet}
          <Row justify="between" align="center" gap="3" wrap>
            <p class="muted">{reintakeSummaryText}</p>
            <Row gap="2" justify="end" wrap>
              {#if reintakeStatus?.draftExists}
                <Button size="sm" variant="secondary" onclick={() => nav(projectActionHref('/settings/reintake'))}>Review draft</Button>
              {/if}
              <Button size="sm" variant="agent" disabled={reintakeBusy !== null} onclick={startReintake}>
                {reintakeBusy === 'rerun' ? 'Starting...' : reintakeStatus?.draftExists ? 'Refresh draft' : 'Start re-intake'}
              </Button>
            </Row>
          </Row>
          {#if reintakeError}
            <p class="form-error">{reintakeError}</p>
          {/if}
        </FrameCard>
        <FrameCard class="learning-card learning-card-wide context-card">
          {#snippet header()}
            <SectionHeader
              title="Project context Guildhall already has"
              description="This is durable project context agents can read now. Reusable habits below only appear after Guildhall finds a pattern worth applying again."
              headingTag="h3"
              density="dense"
            />
          {/snippet}
          {#if projectContextRows.length === 0}
            <p class="muted">
              No durable project context has been saved yet. Use Facts or answer a project check-in question to give Guildhall something concrete to keep.
            </p>
          {:else}
            <div class="context-memory-list">
              {#each projectContextRows as row (row.label)}
                <UtilityPanel as="div" className="context-memory-row" tone="neutral">
                  <div>
                    <strong>{row.label}</strong>
                    <span>{row.detail}</span>
                  </div>
                  <div class="context-memory-meta">
                    <StatusPill label={row.value} tone={row.value === 'empty' ? 'warn' : 'ok'} density="dense" />
                    {#if row.href}
                      <a class="learning-evidence-link" href={projectActionHref(row.href)}>Open</a>
                    {/if}
                  </div>
                </UtilityPanel>
              {/each}
            </div>
          {/if}
        </FrameCard>
        <FrameCard class="learning-card learning-card-wide context-card">
          {#snippet header()}
            <SectionHeader
              title="Recent memory use"
              description="The latest task contexts that included or withheld saved memory."
              headingTag="h3"
              density="dense"
            />
          {/snippet}
          {#if recentMemoryUse.length === 0}
            <p class="muted">No recent memory packet use has been recorded yet.</p>
          {:else}
            <div class="context-memory-list">
              {#each recentMemoryUse as use (`${use.taskId}:${use.at}`)}
                <UtilityPanel as="div" className="context-memory-row" tone="neutral">
                  <div>
                    <strong>{use.taskId}</strong>
                    <span>{use.at}</span>
                  </div>
                  <div class="context-memory-meta">
                    <StatusPill label={`${use.included ?? 0} included`} tone={(use.included ?? 0) > 0 ? 'ok' : 'neutral'} density="dense" />
                    <StatusPill label={`${use.withheld ?? 0} withheld`} tone={(use.withheld ?? 0) > 0 ? 'warn' : 'neutral'} density="dense" />
                  </div>
                </UtilityPanel>
              {/each}
            </div>
          {/if}
        </FrameCard>
        <div class="learning-grid">
          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="Project habits"
                description="Reusable repo-specific guidance Guildhall has proposed. These do not affect other projects."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if projectLearnings.length === 0}
                <p class="muted">No reusable project habits yet. That does not mean the project has no memory; it means Guildhall has not promoted a repeated pattern into a reusable rule.</p>
              {:else}
                {#each projectLearnings as item (item.id)}
                  <UtilityPanel as="article" className="learning-item" tone="neutral">
                    <header class="learning-title">
                      <strong>{item.summary}</strong>
                      <StatusPill label={learningStatusLabel(item.status)} tone={learningStatusTone(item.status)} density="dense" />
                    </header>
                    <div class="learning-meta">
                      <span>{learningDestinationLabel(item.destination)}</span>
                      <span>{confidenceLabel(item.confidence)}</span>
                      {#if riskLabel(item.risk)}
                        <span>{riskLabel(item.risk)}</span>
                      {/if}
                    </div>
                    {#if item.evidence?.length}
                      <p class="learning-label">Why Guildhall suggested this</p>
                      <ul class="learning-evidence">
                        {#each item.evidence as evidence, i (`${item.id}-${i}`)}
                          <li>
                            <span>{evidence.summary}</span>
                            {#if evidence.links?.length}
                              <span class="learning-evidence-links">
                                {#each evidence.links as link, j (`${item.id}-${i}-${j}`)}
                                  {#if link.href}
                                    <a
                                      class="learning-evidence-link"
                                      href={projectActionHref(link.href)}
                                      title={link.localHistoryRef ? `Local evidence: ${link.localHistoryRef}` : undefined}
                                    >{link.label ?? 'Open evidence'}</a>
                                  {/if}
                                {/each}
                              </span>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    {/if}
                    <Row gap="2" justify="end">
                      {#if item.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('accept', 'project', item.id)}>Use this</Button>
                      {/if}
                      {#if item.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('dismiss', 'project', item.id)}>Ignore</Button>
                      {/if}
                    </Row>
                  </UtilityPanel>
                {/each}
              {/if}
              {#if projectLearnings.length > 0}
                <Row justify="end">
                  <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('reset', 'project')}>Forget project memories</Button>
                </Row>
              {/if}
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="Across projects"
                description="Preferences Guildhall noticed from repeated corrections. You can use them everywhere or only here."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if userLearnings.length === 0}
                <p class="muted">No cross-project preferences yet. Guildhall needs repeated evidence before suggesting one.</p>
              {:else}
                {#each userLearnings as item (item.id)}
                  <UtilityPanel as="article" className="learning-item" tone="neutral">
                    <header class="learning-title">
                      <strong>{item.summary}</strong>
                      <StatusPill label={learningStatusLabel(item.status)} tone={learningStatusTone(item.status)} density="dense" />
                    </header>
                    <div class="learning-meta">
                      <span>{learningDestinationLabel(item.destination)}</span>
                      <span>{confidenceLabel(item.confidence)}</span>
                    </div>
                    <Row gap="2" justify="end">
                      {#if item.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('accept', 'user_global', item.id)}>Use everywhere</Button>
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('make-project-wide', 'user_global', item.id)}>Use only here</Button>
                      {/if}
                      {#if item.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('dismiss', 'user_global', item.id)}>Ignore</Button>
                      {/if}
                    </Row>
                  </UtilityPanel>
                {/each}
              {/if}
              {#if userLearnings.length > 0}
                <Row justify="end">
                  <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('reset', 'user_global')}>Forget cross-project preferences</Button>
                </Row>
              {/if}
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="Project playbooks"
                description="Step-by-step procedures Guildhall can add to worker context when a matching task appears."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if skillProposals.length === 0}
                <p class="muted">No playbooks yet. Guildhall will suggest one only after a workflow looks worth repeating.</p>
              {:else}
                {#each skillProposals as skill (skill.id)}
                  <UtilityPanel as="article" className="learning-item" tone="neutral">
                    <header class="learning-title">
                      <strong>{skill.name}</strong>
                      <StatusPill label={learningStatusLabel(skill.status)} tone={learningStatusTone(skill.status)} density="dense" />
                    </header>
                    <p class="learning-copy">{skill.description}</p>
                    {#if skill.triggerKeywords?.length}
                      <p class="learning-label">Used when a task mentions</p>
                      <div class="learning-meta">
                        {#each skill.triggerKeywords as keyword (`${skill.id}-${keyword}`)}
                          <span>{keyword}</span>
                        {/each}
                      </div>
                    {/if}
                    <Row gap="2" justify="end">
                      {#if skill.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runSkillAction('activate', skill.id, true)}>Use playbook</Button>
                      {/if}
                      {#if skill.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runSkillAction('dismiss', skill.id)}>Ignore</Button>
                      {/if}
                    </Row>
                  </UtilityPanel>
                {/each}
              {/if}
              {#if skillProposals.length > 0}
                <Row justify="end">
                  <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runSkillAction('reset')}>Forget project playbooks</Button>
                </Row>
              {/if}
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card learning-card-wide">
            {#snippet header()}
              <SectionHeader
                title="Ideas for Guildhall"
                description="Product improvements Guildhall noticed. These are notes for builders; they do not change this project."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            {#if productSuggestions.length === 0}
              <p class="muted">No product ideas yet.</p>
            {:else}
              <div class="suggestion-list">
                {#each productSuggestions as suggestion (suggestion.id)}
                  <UtilityPanel as="article" className="learning-item" tone="neutral">
                    <header class="learning-title">
                      <strong>{suggestion.title}</strong>
                      <StatusPill label="not active" tone="info" density="dense" />
                    </header>
                    <p class="learning-copy">{suggestion.summary}</p>
                    {#if suggestion.evidence?.length}
                      <p class="learning-label">Evidence</p>
                      <ul class="learning-evidence">
                        {#each suggestion.evidence as evidence, i (`${suggestion.id}-${i}`)}
                          <li>{evidence}</li>
                        {/each}
                      </ul>
                    {/if}
                    <Row justify="end">
                      <Button
                        size="sm"
                        variant="secondary"
                        onclick={() => window.open(buildProductFeedbackIssueUrl({ suggestion, project: project.detail }), '_blank', 'noopener,noreferrer')}
                      >
                        Give product feedback
                      </Button>
                    </Row>
                  </UtilityPanel>
                {/each}
              </div>
            {/if}
          </FrameCard>
        </div>
      {/if}
    {:else if section === 'reintake'}
      <SectionHeader
        eyebrow="Settings"
        title={reintakeNoDraft ? 'Start re-intake' : reintakeApplied ? 'Re-intake applied' : 'Review re-intake draft'}
        description={reintakeNoDraft ? 'Refresh the project from current evidence before changing tasks.' : reintakeApplied ? 'The selected project task-graph cleanup was applied.' : 'Review the proposed project task-graph cleanup before applying anything.'}
        headingTag="h2"
        density="compact"
      >
        {#snippet meta()}
          <StatusPill
            label={reintakeNoDraft ? 'not started' : reintakeApplied ? 'applied' : reintakeDraft?.status ?? reintakeStatus?.status ?? 'draft'}
            tone={reintakeApplied ? 'ok' : reintakeNoDraft ? 'neutral' : 'warn'}
          />
        {/snippet}
      </SectionHeader>

      {#if reintakeError}
        <NoticeBand tone="danger" role="alert" label="Re-intake" title="Could not load re-intake draft" density="compact">
          <p>{reintakeError}</p>
        </NoticeBand>
      {:else if reintakeNoDraft}
        <FrameCard class="learning-card learning-card-wide context-card">
          {#snippet header()}
            <SectionHeader
              title="No draft yet"
              description="Start re-intake to compare current project evidence with the task graph."
              headingTag="h3"
              density="dense"
            />
          {/snippet}
          <Row justify="end" gap="2">
            <Button size="sm" variant="agent" disabled={reintakeBusy !== null} onclick={startReintake}>
              {reintakeBusy === 'rerun' ? 'Starting...' : 'Start re-intake'}
            </Button>
          </Row>
        </FrameCard>
      {:else if !reintakeDraft}
        <NoticeBand tone="neutral" role="status" label="Re-intake" title="Loading draft" density="compact">
          <p>Reading the latest re-intake draft…</p>
        </NoticeBand>
      {:else}
        <FrameCard class="learning-card learning-card-wide context-card">
          {#snippet header()}
            <SectionHeader
              title="Draft summary"
              description={reintakeSummaryText}
              headingTag="h3"
              density="dense"
            />
          {/snippet}
          {#if reintakeApplied}
            <NoticeBand tone="success" role="status" label="Re-intake" title="Re-intake applied" density="compact">
              <p>The selected cleanup groups were applied. Start another re-intake if the project evidence changed again.</p>
            </NoticeBand>
          {:else if reintakeGroupCount === 0}
            <NoticeBand tone="neutral" role="status" label="Re-intake" title="No changes proposed" density="compact">
              <p>Guildhall did not find task-graph changes to apply from the current evidence.</p>
            </NoticeBand>
            <Row justify="end" gap="2">
              <Button size="sm" variant="secondary" disabled={reintakeBusy !== null} onclick={startReintake}>
                {reintakeBusy === 'rerun' ? 'Refreshing...' : 'Refresh draft'}
              </Button>
            </Row>
          {:else}
            <Row justify="end" gap="2">
              <Button size="sm" variant="agent" disabled={reintakeBusy !== null} onclick={applyReintakeSelected}>
                {reintakeBusy === 'apply' ? 'Applying...' : 'Apply selected'}
              </Button>
            </Row>
          {/if}
        </FrameCard>
        <div class="context-memory-list">
          {#each reintakeDraft.groups ?? [] as group (group.id)}
            <FrameCard class="learning-card learning-card-wide context-card">
              {#snippet header()}
                <SectionHeader
                  title={group.title}
                  description={group.rationale ?? ''}
                  headingTag="h3"
                  density="dense"
                />
              {/snippet}
              <div class="context-memory-list">
                {#each group.changes ?? [] as change, index (`${group.id}-${index}`)}
                  <UtilityPanel as="div" className="context-memory-row" tone="neutral">
                    <div>
                      <strong>{change.kind}</strong>
                      <span>{change.after?.title ?? change.task?.title ?? change.before?.title ?? change.taskId ?? change.reason}</span>
                    </div>
                    <div class="context-memory-meta">
                      <StatusPill label={change.kind ?? 'change'} tone="neutral" density="dense" />
                    </div>
                  </UtilityPanel>
                {/each}
              </div>
            </FrameCard>
          {/each}
        </div>
      {/if}
    {:else if section === 'advanced'}
      <SectionHeader
        eyebrow="Settings"
        title="Advanced settings"
        description="Project identity, defaults, and operating style. Most projects can leave this alone."
        headingTag="h2"
        density="compact"
      />

      <div class="advanced-grid">
        <FrameCard class="advanced-card" density="compact">
          {#snippet header()}
            <SectionHeader
              title="Workspace identity"
              description="Operator-facing name and slug for this project."
              headingTag="h3"
              density="dense"
            />
          {/snippet}

          <Stack gap="3">
            <label class="field">
              <span>Workspace name</span>
              <Input bind:value={name} />
            </label>
            <label class="field">
              <span>Workspace ID (slug)</span>
              <Input bind:value={id} />
            </label>
            <Row justify="start" gap="2" align="center" wrap>
              {#if identityStatus}
                <span class="status" class:error={identityStatus.error}>{identityStatus.text}</span>
              {/if}
              <Button variant="primary" disabled={savingIdentity} onclick={saveIdentity}>
                Save identity
              </Button>
            </Row>
          </Stack>
        </FrameCard>

        <FrameCard class="advanced-card advanced-card-wide" density="compact">
          {#snippet header()}
            <SectionHeader
              title="Task worktree local files"
              description="Root-relative files or directories Guildhall may copy into isolated task worktrees before bootstrap."
              headingTag="h3"
              density="dense"
            />
          {/snippet}

          <Stack gap="3">
            <NoticeBand tone="neutral" role="note" label="Worktrees" title="Opt in local runtime config" density="compact">
              <p>
                Use this for files like <code>.env</code>, <code>.env.local</code>, or
                <code>appsettings.local.yaml</code> when workers need them to run local setup.
                Guildhall detects likely filenames, but only copies the paths listed here.
              </p>
            </NoticeBand>
            {#if worktreeIncludeScopes.length > 1}
              <div class="candidate-list" aria-label="Workspace project worktree settings">
                {#each worktreeIncludeScopes as scope (scope.projectId ?? scope.rootPath)}
                  <Button
                    size="sm"
                    variant={(scope.projectId ?? null) === selectedWorktreeProjectId ? 'secondary' : 'ghost'}
                    title={scope.rootPath}
                    onclick={() => selectWorktreeIncludeScope(scope)}
                  >
                    {scope.label ?? scope.projectId ?? 'Workspace'}
                  </Button>
                {/each}
              </div>
            {/if}
            {#if worktreeIncludeCandidates.length > 0}
              <div class="candidate-list" aria-label="Detected local config candidates">
                {#each worktreeIncludeCandidates.slice(0, 6) as candidate (candidate.path)}
                  <Button
                    size="sm"
                    variant={worktreeIncludeText.split(/\r?\n/).map(line => line.trim()).includes(candidate.path) ? 'secondary' : 'ghost'}
                    title={candidate.reason}
                    onclick={() => addWorktreeIncludeCandidate(candidate.path)}
                  >
                    {candidate.path}
                  </Button>
                {/each}
              </div>
            {/if}
            <label class="field">
              <span>Include in task worktrees</span>
              <Textarea
                bind:value={worktreeIncludeText}
                rows="5"
                spellcheck="false"
                placeholder=".env&#10;appsettings.local.yaml&#10;config/local/**"
              />
            </label>
            <Row justify="start" gap="2" align="center" wrap>
              {#if worktreeIncludeStatus}
                <span class="status" class:error={worktreeIncludeStatus.error}>{worktreeIncludeStatus.text}</span>
              {/if}
              <Button variant="primary" disabled={worktreeIncludeBusy} onclick={saveWorktreeIncludes}>
                {worktreeIncludeBusy ? 'Saving…' : 'Save worktree files'}
              </Button>
            </Row>
          </Stack>
        </FrameCard>

        <FrameCard class="advanced-card advanced-card-wide" density="compact">
          {#snippet header()}
            <SectionHeader
              title="Behavior defaults"
              description="These shape how Guildhall works on this project. Use the global defaults unless this project genuinely needs a different operating style."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                <Help topic="lever.index" />
              {/snippet}
            </SectionHeader>
          {/snippet}

          <Stack gap="3">
            {#if leversError}
              <NoticeBand tone="danger" role="alert" label="Levers" title="Could not load levers" density="compact">
                {#snippet actions()}
                  <Button variant="secondary" size="sm" onclick={resetLevers}>Reset to defaults</Button>
                {/snippet}
                <p>{leversError}</p>
              </NoticeBand>
            {:else if !levers}
              <NoticeBand tone="neutral" role="status" label="Levers" title="Loading levers" density="compact">
                <p>Reading lever provenance and current positions…</p>
              </NoticeBand>
            {:else if levers.length === 0}
              <NoticeBand tone="neutral" role="note" label="Levers" title="No levers configured" density="compact">
                <p>This project is currently using defaults only.</p>
              </NoticeBand>
            {:else}
              <NoticeBand tone="neutral" role="note" label="Defaults" title="Most projects should not need overrides" density="compact">
                <p>Settings below show the active behavior and where it came from. Project-specific changes should stay narrow and intentional.</p>
              </NoticeBand>
              {#each leversByScope as [scope, entries] (scope)}
                <section class="lever-scope">
                  <header class="lever-scope-head">
                    <h4>{leverScopeLabel(scope)}</h4>
                    <span>{entries.length} setting{entries.length === 1 ? '' : 's'}</span>
                  </header>
                  <div class="lever-list">
                    {#each entries as lever, i (lever.name + i)}
                      <UtilityPanel as="article" className="lever-card" tone="neutral">
                        <header class="lever-card-head">
                          <div class="lever-title-block">
                            <div class="lever-title-row">
                              <strong>{humanizeLeverName(lever.name)}</strong>
                              <Help topic={`lever.${lever.name}`} size={12} />
                            </div>
                          </div>
                          {#if savingLever === `${lever.scope}:${lever.name}`}
                            <StatusPill label="Saving" tone="info" density="dense" />
                          {:else if lever.setBy !== 'system-default'}
                            <StatusPill label={leverSetByLabel(lever.setBy)} tone={lever.setBy === 'user-direct' ? 'warn' : 'neutral'} density="dense" />
                          {/if}
                        </header>
                        <div class="lever-control">
                          <Select
                            value={selectValueForLever(lever)}
                            options={selectOptionsForLever(lever)}
                            ariaLabel={`${humanizeLeverName(lever.name)} setting`}
                            disabled={savingLever === `${lever.scope}:${lever.name}`}
                            onchange={(value) => saveLever(lever, value)}
                          />
                          <p class="lever-current">
                            Current: {leverPositionLabel(lever.position)}
                            {#if lever.setBy === 'system-default'}
                              · inherited from global defaults
                            {:else}
                              · {leverSetByLabel(lever.setBy)}
                            {/if}
                          </p>
                        </div>
                        {#if lever.rationale}
                          <p class="lever-rationale">{lever.rationale}</p>
                        {/if}
                      </UtilityPanel>
                    {/each}
                  </div>
                </section>
              {/each}
            {/if}
          </Stack>
        </FrameCard>

        <FrameCard class="advanced-card advanced-card-wide" density="compact">
          {#snippet header()}
            <SectionHeader
              title="Codebase map"
              description="Compact architecture context workers use to find existing primitives before editing."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                {#if codebaseMapStatus}
                  <StatusPill
                    label={codebaseMapStatus.stale ? 'stale' : codebaseMapStatus.configured ? 'ready' : 'not built'}
                    tone={codebaseMapStatus.stale ? 'warn' : codebaseMapStatus.configured ? 'ok' : 'neutral'}
                  />
                {/if}
              {/snippet}
            </SectionHeader>
          {/snippet}

          <Stack gap="3">
            {#if codebaseMapError}
              <NoticeBand tone="danger" role="alert" label="Codebase map" title="Could not read map" density="compact">
                <p>{codebaseMapError}</p>
              </NoticeBand>
            {:else if !codebaseMapStatus}
              <NoticeBand tone="neutral" role="status" label="Codebase map" title="Loading map status" density="compact">
                <p>Checking the compact architecture index…</p>
              </NoticeBand>
            {:else}
              <div class="map-facts">
                <div><span class="muted">Files</span><strong>{codebaseMapStatus.counts.files}</strong></div>
                <div><span class="muted">Areas</span><strong>{codebaseMapStatus.counts.areas}</strong></div>
                <div><span class="muted">Abstractions</span><strong>{codebaseMapStatus.counts.abstractions}</strong></div>
                <div><span class="muted">Design system</span><strong>{codebaseMapStatus.designSystem?.maturity ?? '—'}</strong></div>
                <div><span class="muted">Corpus</span><strong>{codebaseMapStatus.semantic?.corpusKind ?? '—'}</strong></div>
              </div>
              {#if codebaseMapStatus.project}
                <div class="map-semantic">
                  <strong>What Guildhall knows</strong>
                  <p>{codebaseMapStatus.project.summary}</p>
                  {#if codebaseMapStatus.project.languages.length || codebaseMapStatus.project.primaryFrameworks.length || codebaseMapStatus.project.packageManagers.length}
                    <div class="map-chip-list" aria-label="Detected stack">
                      {#each [...codebaseMapStatus.project.primaryFrameworks, ...codebaseMapStatus.project.packageManagers, ...codebaseMapStatus.project.languages].slice(0, 12) as item, i (`stack-${i}-${item}`)}
                        <span>{item}</span>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
              {#if codebaseMapStatus.entrypoints?.length}
                <div class="map-section">
                  <strong>Start here</strong>
                  <ul class="map-recommendations">
                    {#each codebaseMapStatus.entrypoints as entry (entry.path)}
                      <li><code>{entry.path}</code> — {entry.summary}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
              {#if codebaseMapStatus.semantic}
                <div class="map-semantic">
                  <div class="map-semantic-meta">
                    <span>{codebaseMapStatus.semantic.modelId}</span>
                    {#if codebaseMapStatus.semantic.needsBroaderRead}
                      <span>broader read</span>
                    {/if}
                  </div>
                  <p>{codebaseMapStatus.semantic.projectPurpose}</p>
                  {#if codebaseMapStatus.semantic.currentTruth?.length}
                    <div>
                      <strong>Current truth</strong>
                      <ul class="map-recommendations">
                        {#each codebaseMapStatus.semantic.currentTruth.slice(0, 4) as truth, i (`truth-${i}`)}
                          <li>{truth}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if codebaseMapStatus.semantic.readNext.length}
                    <div>
                      <strong>Read next</strong>
                      <ul class="map-recommendations">
                        {#each codebaseMapStatus.semantic.readNext.slice(0, 3) as item (item.path)}
                          <li><code>{item.path}</code> — {item.reason}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if codebaseMapStatus.semantic.workerGuidance.length}
                    <div>
                      <strong>Worker guidance</strong>
                      <ul class="map-recommendations">
                        {#each codebaseMapStatus.semantic.workerGuidance.slice(0, 2) as guidance, i (`worker-guidance-${i}`)}
                          <li>{guidance}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if codebaseMapStatus.semantic.architectureAreas?.length}
                    <div>
                      <strong>Architecture areas</strong>
                      <div class="map-list-grid">
                        {#each codebaseMapStatus.semantic.architectureAreas.slice(0, 3) as area (area.name)}
                          <UtilityPanel as="article" className="map-card" tone="neutral">
                            <h4>{area.name}</h4>
                            <p>{area.purpose}</p>
                            {#if area.canonicalFiles.length}
                              <code>{area.canonicalFiles.slice(0, 2).join(', ')}</code>
                            {/if}
                          </UtilityPanel>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if codebaseMapStatus.semantic.canonicalAbstractions?.length}
                    <div>
                      <strong>Canonical abstractions</strong>
                      <div class="map-list-grid">
                        {#each codebaseMapStatus.semantic.canonicalAbstractions.slice(0, 3) as abstraction (abstraction.name)}
                          <UtilityPanel as="article" className="map-card" tone="neutral">
                            <h4>{abstraction.name}</h4>
                            <p>{abstraction.purpose}</p>
                            <p>{abstraction.reuseRule}</p>
                          </UtilityPanel>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  {#if codebaseMapStatus.semantic.gapsOrRisks?.length}
                    <div>
                      <strong>Gaps or risks</strong>
                      <ul class="map-recommendations">
                        {#each codebaseMapStatus.semantic.gapsOrRisks.slice(0, 4) as risk, i (`risk-${i}`)}
                          <li>{risk}</li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                </div>
              {/if}
              {#if codebaseMapStatus.areas?.length}
                <div class="map-section">
                  <strong>Mapped areas</strong>
                  <div class="map-list-grid">
                    {#each codebaseMapStatus.areas.slice(0, 4) as area (area.id)}
                      <UtilityPanel as="article" className="map-card" tone="neutral">
                        <h4>{area.title}</h4>
                        <p>{area.summary}</p>
                        {#if area.canonicalFiles.length}
                          <ul class="map-mini-list">
                            {#each area.canonicalFiles.slice(0, 3) as file (file.path)}
                              <li><code>{file.path}</code></li>
                            {/each}
                          </ul>
                        {/if}
                        {#if area.tests.length}
                          <p class="muted">Tests: {area.tests.slice(0, 3).join(', ')}</p>
                        {/if}
                      </UtilityPanel>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if codebaseMapStatus.abstractions?.length}
                <div class="map-section">
                  <strong>Reusable abstractions</strong>
                  <div class="map-list-grid">
                    {#each codebaseMapStatus.abstractions.slice(0, 4) as abstraction (abstraction.id)}
                      <UtilityPanel as="article" className="map-card" tone="neutral">
                        <h4>{abstraction.title}</h4>
                        <p><code>{abstraction.canonicalPath}</code></p>
                        {#if abstraction.useWhen.length}
                          <p>{abstraction.useWhen[0]}</p>
                        {/if}
                        {#if abstraction.related.length}
                          <div class="map-chip-list" aria-label={`Related files for ${abstraction.title}`}>
                            {#each abstraction.related.slice(0, 3) as related (related)}
                              <span>{related}</span>
                            {/each}
                          </div>
                        {/if}
                      </UtilityPanel>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if codebaseMapStatus.designSystem?.recommendations?.length}
                <div class="map-section">
                  <strong>Design-system findings</strong>
                  <ul class="map-recommendations">
                    {#each codebaseMapStatus.designSystem.recommendations.slice(0, 3) as recommendation, i (`ds-rec-${i}`)}
                      <li>{recommendation}</li>
                    {/each}
                  </ul>
                  {#if codebaseMapStatus.designSystem.componentFiles?.length}
                    <p class="muted">Component files sampled: {codebaseMapStatus.designSystem.componentFiles.slice(0, 4).join(', ')}</p>
                  {/if}
                </div>
              {/if}
              {#if codebaseMapStatus.generatedAt}
                <Byline verb="Last built" at={codebaseMapStatus.generatedAt} />
              {/if}
              {#if codebaseMapStatus.stale}
                <NoticeBand tone="warn" role="note" label="Codebase map" title="Map needs refresh" density="compact">
                  <p>{codebaseMapStatus.stale.error}</p>
                </NoticeBand>
              {/if}
              <Row justify="end">
                <Button variant="secondary" onclick={refreshCodebaseMap} disabled={codebaseMapBusy}>
                  {codebaseMapBusy ? 'Refreshing…' : codebaseMapStatus.configured ? 'Refresh map' : 'Build map'}
                </Button>
              </Row>
            {/if}
          </Stack>
        </FrameCard>

        <FrameCard class="advanced-card advanced-card-wide" density="compact">
          {#snippet header()}
            <SectionHeader
              title="Design system"
              description="Current draft state for the operator-facing shared UI primitives."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                {#if designSystem && designSystem !== undefined}
                  <StatusPill
                    label={designSystem.approvedAt ? 'approved' : 'draft'}
                    tone={designSystem.approvedAt ? 'ok' : 'warn'}
                  />
                {/if}
              {/snippet}
            </SectionHeader>
          {/snippet}

          <Stack gap="3">
            {#if designSystem === undefined}
              <NoticeBand tone="neutral" role="status" label="Design system" title="Loading draft" density="compact">
                <p>Fetching the current design-system document…</p>
              </NoticeBand>
            {:else if !designSystem}
              <NoticeBand tone="neutral" role="note" label="Design system" title="No draft yet" density="compact">
                <p>Guildhall has not generated a design-system draft for this project yet.</p>
              </NoticeBand>
            {:else}
              <div class="ds-head">
                <strong>Revision {designSystem.revision ?? 0}</strong>
                <Byline by={designSystem.authoredBy ?? 'unknown'} at={designSystem.authoredAt} />
              </div>

              <div class="ds-facts">
                <div><span class="muted">Tokens</span><strong>{dsTokenCount}</strong></div>
                <div><span class="muted">Primitives</span><strong>{designSystem.primitives?.length ?? 0}</strong></div>
                <div><span class="muted">Tone</span><strong>{designSystem.copyVoice?.tone ?? 'plain'}</strong></div>
                <div><span class="muted">Min contrast</span><strong>{designSystem.a11y?.minContrastRatio ?? '—'}</strong></div>
              </div>

              {#if designSystem.primitives?.length}
                <ul class="ds-prims">
                  {#each designSystem.primitives as primitive, i (primitive.name + i)}
                    <li>
                      <strong>{primitive.name}</strong>
                      <span class="muted">{primitive.usage}</span>
                    </li>
                  {/each}
                </ul>
              {/if}

              {#if designSystem.approvedAt}
                <Byline
                  verb="Approved by"
                  by={designSystem.approvedBy ?? 'human'}
                  at={designSystem.approvedAt}
                />
              {:else}
                <Row justify="end">
                  <Button variant="primary" onclick={approveDesignSystem}>Approve current draft</Button>
                </Row>
              {/if}
            {/if}

            {#if designSystemProfile}
              <div class="map-section">
                <strong>Design System Profile</strong>
              </div>
              <div class="ds-facts">
                <div><span class="muted">Foundation</span><strong>{designSystemProfile.primarySystem ?? 'portable'}</strong></div>
                <div><span class="muted">Preview</span><strong>{designSystemProfile.preview?.adapter ?? 'none'}</strong></div>
                <div><span class="muted">Libraries</span><strong>{designSystemProfile.libraries?.length ?? 0}</strong></div>
                <div><span class="muted">Token files</span><strong>{designSystemProfile.tokenFiles?.length ?? 0}</strong></div>
              </div>

              {#if designSystemProfile.recommendations?.length}
                <ul class="map-recommendations">
                  {#each designSystemProfile.recommendations.slice(0, 3) as recommendation, i (`design-system-profile-${i}`)}
                    <li>{recommendation}</li>
                  {/each}
                </ul>
              {/if}
            {/if}

            {#if designTaste}
              <div class="map-section">
                <strong>Taste memory</strong>
                <div class="ds-facts">
                  <div><span class="muted">Direction</span><strong>{designTaste.taste?.opinions?.visualDirection?.default ?? '—'}</strong></div>
                  <div><span class="muted">Controls</span><strong>{designTaste.taste?.opinions?.interactionSemantics?.mutuallyExclusiveModes ?? '—'}</strong></div>
                  <div><span class="muted">Palette</span><strong>{designTaste.taste?.opinions?.paletteStrategy?.defaultMode ?? '—'}</strong></div>
                  <div><span class="muted">Layers</span><strong>{designTasteLayerCount}</strong></div>
                </div>
                {#if designTaste.summary}
                  <p class="muted">{designTaste.summary}</p>
                {/if}
              </div>
            {/if}

            {#if designSystemCatalog}
              <div class="ds-facts">
                <div><span class="muted">Catalog</span><strong>{designCatalogSummary}</strong></div>
                <div><span class="muted">Interactable</span><strong>{designSystemCatalog.interactable ? 'yes' : 'no'}</strong></div>
              </div>
              {#if designSystemCatalog.recommendations?.length}
                <ul class="map-recommendations">
                  {#each designSystemCatalog.recommendations.slice(0, 2) as recommendation, i (`catalog-rec-${i}`)}
                    <li>{recommendation}</li>
                  {/each}
                </ul>
              {/if}
            {/if}

            {#if designIntentSurrogate}
              <div class="ds-facts">
                <div><span class="muted">Intent preview</span><strong>{designIntentSummary}</strong></div>
                <div><span class="muted">Native proof</span><strong>{designIntentSurrogate.nativeProofRequired ? 'required' : 'not required'}</strong></div>
              </div>
              {#if designIntentSurrogate.warning}
                <NoticeBand
                  tone={designIntentSurrogate.approximate ? 'warn' : 'neutral'}
                  role="note"
                  label="Design proof"
                  title={designIntentSurrogate.approximate ? 'Approximate preview' : 'Preview ready'}
                  density="compact"
                >
                  <p>{designIntentSurrogate.warning}</p>
                </NoticeBand>
              {/if}
            {/if}

            {#if designFeedback}
              <div class="ds-facts">
                <div><span class="muted">Design findings</span><strong>{designFeedback.findings?.length ?? 0}</strong></div>
                <div><span class="muted">Project decisions</span><strong>{designFeedback.decisions?.length ?? 0}</strong></div>
                <div><span class="muted">Owner feedback</span><strong>{designFeedback.ownerFeedback?.length ?? 0}</strong></div>
                <div><span class="muted">Decision packets</span><strong>{designFeedback.decisionPackets?.length ?? 0}</strong></div>
                <div><span class="muted">Reusable candidates</span><strong>{designFeedback.candidates?.length ?? 0}</strong></div>
                <div><span class="muted">Looma follow-ups</span><strong>{designFeedback.loomaImprovements?.length ?? 0}</strong></div>
              </div>

              {#if designFeedback.candidates?.length}
                <ul class="ds-prims">
                  {#each designFeedback.candidates.slice(0, 3) as candidate, i (`candidate-${i}`)}
                    <li>
                      <strong>{candidate.targetDesignSystem ?? 'portable'} follow-up</strong>
                      <span class="muted">{candidate.summary ?? 'Reusable design-system candidate queued.'}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            {/if}

            {#if loomaHook}
              <NoticeBand
                tone={loomaHook.status === 'active' ? 'ok' : 'neutral'}
                role="note"
                label="Looma development"
                title={loomaHook.status === 'active' ? 'Local hook active' : 'Local hook inactive'}
                density="compact"
              >
                <p>{loomaHook.status === 'active' ? `Queued follow-ups can target ${loomaHook.path ?? 'the configured Looma checkout'}.` : loomaHook.reason ?? 'No local Looma checkout is configured for this machine.'}</p>
              </NoticeBand>
            {/if}
          </Stack>
        </FrameCard>
      </div>
    {/if}
  </div>
{/if}

<style>
  .settings-shell {
    display: grid;
    gap: var(--gh-space-4);
    container-type: inline-size;
    max-inline-size: 72rem;
  }

  .settings-section-picker {
    display: none;
    gap: var(--gh-space-2);
    inline-size: 100%;
  }

  .settings-section-picker-label {
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 700;
    line-height: var(--lh-tight);
    text-transform: uppercase;
  }

  :global(.settings-section-card) {
    padding: var(--gh-space-2);
  }

  .settings-section-nav {
    display: grid;
    gap: var(--gh-space-2);
    grid-template-columns: repeat(auto-fit, minmax(min(9.5rem, 100%), 1fr));
    inline-size: 100%;
    align-items: stretch;
  }

  :global(.settings-section-button) {
    inline-size: 100%;
    justify-content: center;
    min-inline-size: 0;
    min-block-size: 38px;
    font-size: var(--fs-1);
    font-weight: 650;
    line-height: var(--lh-tight);
    color: var(--text-muted);
    box-shadow: none;
  }

  :global(.settings-section-button[aria-current='page']) {
    color: var(--text);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 10%, transparent),
      0 1px 0 color-mix(in srgb, black 14%, transparent);
  }

  :global(.settings-section-button:not([aria-current='page'])) {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), transparent 58%),
      transparent;
    color: var(--text-muted);
  }

  :global(.settings-section-button:not([aria-current='page']):hover) {
    color: var(--text);
  }

  @container (max-width: 44rem) {
    .settings-section-picker {
      display: grid;
    }

    :global(.settings-section-card) {
      display: none;
    }
  }

  .field {
    display: grid;
    gap: var(--gh-space-1);
  }

  .field > span:first-child,
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }

  .status.error,
  .row-error {
    color: var(--danger);
  }

  .checklist {
    list-style: none;
    display: grid;
    gap: 0;
    padding: 0;
    margin: 0;
  }

  .check-row {
    display: grid;
    gap: var(--gh-space-3);
    align-items: start;
    padding: var(--gh-space-4) 0;
    border-top: 1px solid var(--border);
  }

  .check-row:first-child {
    border-top: none;
  }

  .check-copy {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .check-label {
    font-size: var(--fs-3);
    font-weight: 600;
    line-height: var(--lh-tight);
    color: var(--text);
  }

  .check-detail {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .check-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
    justify-content: flex-start;
    min-inline-size: 0;
  }

  .row-error {
    font-size: var(--fs-1);
  }

  :global(.runtime-setup-card) {
    margin-block-start: var(--gh-space-4);
  }

  .runtime-head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
    margin-bottom: var(--gh-space-3);
  }

  .runtime-head-copy {
    display: grid;
    gap: var(--gh-space-2);
    min-inline-size: min(28rem, 100%);
  }

  .runtime-head-copy h3 {
    margin: 0;
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }

  .runtime-head-copy p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  :global(.readiness-card) {
    gap: 0;
  }

  :global(.capability-grants-card) {
    margin-block-start: var(--gh-space-4);
  }

  .runtime-message,
  .runtime-compatibility {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    margin: 0;
  }

  .runtime-facts {
    display: grid;
    gap: var(--gh-space-2);
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    margin: 0;
  }

  :global(.runtime-fact) {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .runtime-facts dt {
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 700;
    line-height: var(--lh-tight);
    text-transform: uppercase;
  }

  .runtime-facts dd {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .runtime-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
  }

  :global(.grant-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: start;
  }

  .grant-copy {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .grant-copy p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }

  .coord-list {
    display: grid;
    gap: var(--gh-space-3);
  }

  :global(.coord) {
    display: grid;
    gap: var(--gh-space-1);
  }

  .coord-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: baseline;
  }

  .advanced-grid {
    display: grid;
    gap: var(--gh-space-4);
    max-inline-size: 62rem;
  }

  :global(.advanced-card) {
    align-self: start;
  }

  .learning-grid {
    display: grid;
    gap: var(--gh-space-4);
  }

  :global(.context-card) {
    max-inline-size: 62rem;
    margin-block-end: var(--gh-space-4);
  }

  .context-memory-list {
    display: grid;
    gap: var(--gh-space-2);
  }

  :global(.context-memory-row) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-3);
    align-items: center;
    justify-content: space-between;
  }

  :global(.context-memory-row) > div:first-child {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: min(28rem, 100%);
  }

  :global(.context-memory-row) strong {
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }

  :global(.context-memory-row) span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .context-memory-meta {
    display: inline-flex;
    gap: var(--gh-space-2);
    align-items: center;
  }

  :global(.learning-item) {
    display: grid;
    gap: var(--gh-space-2);
    min-inline-size: 0;
  }

  .learning-title {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: start;
    justify-content: space-between;
    min-inline-size: 0;
  }

  .learning-title strong {
    min-inline-size: 0;
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .learning-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }

  .learning-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .learning-label {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 700;
    line-height: var(--lh-tight);
    text-transform: uppercase;
  }

  .learning-evidence {
    margin: 0;
    padding-inline-start: var(--gh-space-4);
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .learning-evidence-links {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    margin-inline-start: var(--gh-space-2);
  }

  .learning-evidence-link {
    color: var(--accent);
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .suggestion-list {
    display: grid;
    gap: var(--gh-space-3);
  }

  .lever-scope {
    display: grid;
    gap: 12px;
  }

  .lever-scope-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    padding-block-start: 8px;
  }

  .lever-scope-head h4 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-2);
    font-weight: 700;
    line-height: var(--lh-tight);
  }

  .lever-scope-head span {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }

  .lever-list {
    display: grid;
    gap: 12px;
  }

  :global(.lever-card) {
    display: grid;
    gap: 12px;
  }

  .lever-card-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
    min-inline-size: 0;
    flex-wrap: wrap;
  }

  .lever-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-inline-size: 0;
  }

  .lever-title-row strong {
    font-size: var(--fs-2);
    line-height: var(--lh-tight);
  }

  .lever-title-block {
    min-inline-size: min(100%, 18rem);
  }

  .lever-control {
    display: grid;
    gap: var(--gh-space-2);
    max-inline-size: 28rem;
  }

  .lever-current {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .lever-rationale {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .ds-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
  }

  .ds-facts,
  .map-facts {
    display: grid;
    gap: var(--gh-space-3);
  }

  .ds-facts > div,
  .map-facts > div {
    display: grid;
    gap: var(--gh-space-1);
  }

  .map-recommendations {
    margin: 0;
    padding-inline-start: var(--gh-space-4);
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .map-section {
    display: grid;
    gap: var(--gh-space-2);
  }

  .map-list-grid {
    display: grid;
    gap: var(--gh-space-2);
  }

  :global(.map-card) {
    display: grid;
    gap: var(--gh-space-2);
  }

  .map-list-grid h4 {
    margin: 0;
    font-size: var(--fs-2);
  }

  .map-list-grid p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .map-mini-list {
    display: grid;
    gap: var(--gh-space-1);
    margin: 0;
    padding-inline-start: var(--gh-space-4);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }

  .map-chip-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-1);
  }

  .map-chip-list span {
    max-width: min(28rem, 100%);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0.2rem 0.55rem;
    border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--glass-border));
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    font-size: var(--fs-0);
  }

  .workspace-project-list {
    list-style: none;
    display: grid;
    gap: var(--gh-space-2);
    margin: var(--gh-space-3) 0 0;
    padding: 0;
  }

  .workspace-project-list li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .workspace-project-name {
    color: var(--text);
    font-weight: 700;
  }

  .workspace-project-path {
    font-family: var(--font-mono);
  }

  .workspace-project-note {
    margin-block-start: var(--gh-space-3);
  }

  .candidate-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
  }

  .map-semantic {
    display: grid;
    gap: var(--gh-space-3);
    padding-block-start: var(--gh-space-1);
  }

  .map-semantic-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
  }

  .map-semantic-meta span + span::before {
    content: "·";
    margin-inline-end: var(--gh-space-2);
  }

  .map-semantic p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    max-width: 72ch;
  }

  .ds-prims {
    list-style: none;
    display: grid;
    gap: var(--gh-space-2);
    padding: 0;
  }

  .ds-prims li {
    display: grid;
    gap: var(--gh-space-1);
  }

  @container (min-width: 42rem) {
    .check-row {
      grid-template-columns: minmax(0, 1fr) minmax(16rem, auto);
      align-items: center;
    }

    .check-actions {
      justify-content: flex-end;
    }

    .row-error {
      grid-column: 1 / -1;
    }

    .ds-facts,
    .map-facts {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .map-list-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

  }

  @container (max-width: 42rem) {
    :global(.grant-row) {
      grid-template-columns: 1fr;
    }
  }

  @container (min-width: 84rem) {
    .learning-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :global(.learning-card-wide) {
      grid-column: 1 / -1;
    }
  }
</style>
