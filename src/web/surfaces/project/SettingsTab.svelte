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
  import Input from '../../lib/Input.svelte'
  import Select from '../../lib/Select.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Byline from '../../lib/Byline.svelte'
  import LogViewer from '../../lib/LogViewer.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import FactsTab from './FactsTab.svelte'
  import ProjectProvidersSection from './ProjectProvidersSection.svelte'
  import Help from '../../lib/Help.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'
  import { projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { buildProductFeedbackIssueUrl } from '../../lib/product-feedback.js'

  interface Props {
    subView?: string | null
  }
  let { subView = null }: Props = $props()
  type SettingSection = 'ready' | 'providers' | 'facts' | 'coordinators' | 'learning' | 'advanced'
  const KNOWN_SECTIONS = new Set<SettingSection>(['ready', 'providers', 'facts', 'coordinators', 'learning', 'advanced'])
  const section = $derived(KNOWN_SECTIONS.has(subView as SettingSection) ? subView as SettingSection : 'ready')
  const settingsSections: Array<{ id: SettingSection; label: string }> = [
    { id: 'ready', label: 'Ready' },
    { id: 'providers', label: 'Providers' },
    { id: 'coordinators', label: 'Coordinators' },
    { id: 'facts', label: 'Facts' },
    { id: 'learning', label: 'Memory' },
    { id: 'advanced', label: 'Advanced' },
  ]

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
  interface LearningEvidence {
    kind?: string
    summary?: string
    ref?: string
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
  interface LearningSnapshot {
    project: { suggestedLearnings: SuggestedLearning[] } | null
    user: { suggestedLearnings: SuggestedLearning[] } | null
    effective: { productSuggestions: ProductSuggestion[] } | null
    projectSkillProposals: ProjectSkillProposal[]
  }
  interface CodebaseMapStatus {
    configured: boolean
    generatedAt: string | null
    stale: { stale: true; at: string; reason: string; error: string } | null
    counts: { files: number; areas: number; abstractions: number }
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
  let codebaseMapStatus = $state<CodebaseMapStatus | null>(null)
  let codebaseMapBusy = $state(false)
  let codebaseMapError = $state<string | null>(null)
  let learning = $state<LearningSnapshot | null>(null)
  let learningError = $state<string | null>(null)
  let learningBusy = $state<string | null>(null)

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
  }
  let bootstrapInfo = $state<BootstrapInfo | null>(null)
  let bootstrapRunning = $state(false)

  interface ProviderStatus {
    configured: boolean
    active?: string
  }
  let providerStatus = $state<ProviderStatus | null>(null)

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
    void loadCodebaseMapStatus()
    fetch('/api/providers/status')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return
        providerStatus = {
          configured: Boolean(j?.configured ?? j?.active),
          active: j?.active,
        }
      })
      .catch(() => (providerStatus = { configured: false }))
    void loadBootstrap()
    void loadLearning()
  })

  async function loadBootstrap() {
    try {
      const r = await projectFetch('/api/project/bootstrap/status')
      bootstrapInfo = (await r.json()) as BootstrapInfo
    } catch {
      bootstrapInfo = null
    }
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
      }
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
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

  const bootstrapReady = $derived(Boolean(bootstrapInfo?.configured && bootstrapInfo?.status?.success))
  const providerReady = $derived(Boolean(providerStatus?.configured))
  const coordinatorsReady = $derived(coordinators.length > 0)
  const readinessCount = $derived(
    (bootstrapReady ? 1 : 0) + (coordinatorsReady ? 1 : 0) + (providerReady ? 1 : 0),
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
      <Button variant="primary" onclick={() => nav('/setup')}>Open setup wizard</Button>
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

    <nav class="settings-section-nav" aria-label="Settings sections">
      {#each settingsSections as item (item.id)}
        {@const active = section === item.id}
        <button
          type="button"
          class="settings-section-button"
          class:active
          aria-current={active ? 'page' : undefined}
          onclick={() => nav(settingsSectionHref(item.id))}
        >
          {item.label}
        </button>
      {/each}
    </nav>

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
            label={`${readinessCount}/3 ready`}
            tone={readinessCount === 3 ? 'ok' : 'warn'}
            emphasis="default"
          />
        {/snippet}
      </SectionHeader>

      <FrameCard class="readiness-card" density="compact">
        <ul class="checklist">
          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">Bootstrap</span>
              <span class="check-detail">Project bootstrap commands and success gates.</span>
            </div>
            <div class="check-actions">
              <StatusPill
                label={bootstrapReady ? 'passed' : bootstrapInfo?.configured ? 'failed' : 'not set'}
                tone={bootstrapReady ? 'ok' : bootstrapInfo?.configured ? 'danger' : 'warn'}
              />
              {#if !bootstrapReady}
                <Button variant="secondary" size="sm" onclick={runBootstrap} disabled={bootstrapRunning}>
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
      </FrameCard>

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
              <Button onclick={runBootstrap} disabled={bootstrapRunning}>
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
              <section class="coord">
                <header class="coord-title">
                  <strong>{coordinator.name ?? coordinator.id}</strong>
                  {#if coordinator.domain}
                    <span class="muted">{coordinator.domain}</span>
                  {/if}
                </header>
                {#if coordinator.mandate}
                  <Markdown source={coordinator.mandate} />
                {/if}
              </section>
            {/each}
          </div>
        </FrameCard>
      {/if}
    {:else if section === 'learning'}
      <SectionHeader
        eyebrow="Settings"
        title="Memory and habits"
        description="Review the habits Guildhall wants to reuse. Suggested items stay off until you choose to use them."
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
        <div class="learning-grid">
          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="This project"
                description="Repo-specific habits, commands, and facts. These do not affect other projects."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if projectLearnings.length === 0}
                <p class="muted">Nothing saved yet. After a task teaches Guildhall a repeatable project habit, it will ask here before reusing it.</p>
              {:else}
                {#each projectLearnings as item (item.id)}
                  <article class="learning-item">
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
                          <li>{evidence.summary}</li>
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
                  </article>
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
                  <article class="learning-item">
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
                  </article>
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
                  <article class="learning-item">
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
                  </article>
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
                  <article class="learning-item">
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
                      <a
                        class="feedback-link"
                        href={buildProductFeedbackIssueUrl({ suggestion, project: project.detail })}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Give product feedback
                      </a>
                    </Row>
                  </article>
                {/each}
              </div>
            {/if}
          </FrameCard>
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
                      <article class="lever-card">
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
                      </article>
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
              </div>
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

  .settings-section-nav {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
    padding: var(--gh-space-2);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
    inline-size: min(100%, 62rem);
  }

  .settings-section-button {
    appearance: none;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg);
    color: var(--text-muted);
    cursor: pointer;
    flex: 1 1 8rem;
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 650;
    line-height: var(--lh-tight);
    min-block-size: 34px;
    padding: var(--gh-space-2) var(--gh-space-3);
  }

  .settings-section-button:hover {
    color: var(--text);
    background: var(--bg-raised-2);
  }

  .settings-section-button.active {
    color: var(--text);
    border-color: color-mix(in srgb, var(--accent) 64%, var(--border-strong));
    background: var(--bg-elevated);
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

  .coord-list {
    display: grid;
    gap: var(--gh-space-3);
  }

  .coord {
    display: grid;
    gap: var(--gh-space-1);
    padding: var(--gh-space-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
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

  .learning-item {
    display: grid;
    gap: var(--gh-space-2);
    padding: var(--gh-space-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
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

  .suggestion-list {
    display: grid;
    gap: var(--gh-space-3);
  }

  .feedback-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 22px;
    padding: 2px var(--s-2);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
    color: var(--text);
    font-size: var(--fs-1);
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    white-space: nowrap;
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 8%, transparent),
      0 1px 0 color-mix(in srgb, black 22%, transparent);
  }

  .feedback-link:hover {
    background: color-mix(in srgb, var(--bg-raised-2) 82%, white 18%);
    border-color: color-mix(in srgb, var(--border-strong) 68%, var(--text) 32%);
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

  .lever-card {
    display: grid;
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
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

    .map-facts {
      grid-template-columns: repeat(3, minmax(0, 1fr));
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
