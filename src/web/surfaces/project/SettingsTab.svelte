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
  import Markdown from '../../lib/Markdown.svelte'
  import Byline from '../../lib/Byline.svelte'
  import LogViewer from '../../lib/LogViewer.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import FactsTab from './FactsTab.svelte'
  import ProjectProvidersSection from './ProjectProvidersSection.svelte'
  import Help from '../../lib/Help.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'
  import { projectFetch } from '../../lib/project-routes.js'
  import { buildProductFeedbackIssueUrl } from '../../lib/product-feedback.js'

  interface Props {
    subView?: string | null
  }
  let { subView = null }: Props = $props()
  const section = $derived(subView ?? 'ready')

  interface Lever {
    name: string
    position: string
    setBy: string
    rationale: string
    scope: string
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

  let initialized = $state<boolean | null>(null)
  let name = $state('')
  let id = $state('')
  let savingIdentity = $state(false)
  let identityStatus = $state<{ text: string; error: boolean } | null>(null)

  let levers = $state<Lever[] | null>(null)
  let leversError = $state<string | null>(null)
  let designSystem = $state<DesignSystem | null | undefined>(undefined)
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
    auto_if_safe: 'Automatic when safe',
    automatic: 'Automatic',
    conservative: 'Conservative',
    default: 'Default',
    fail_fast: 'Stop on first problem',
    fanout_2: 'Two reviewers',
    fanout_4: 'Four reviewers',
    first_pass: 'First pass only',
    gated: 'Ask first',
    high: 'High',
    human: 'Human only',
    isolated: 'Isolated',
    lenient: 'Lenient',
    local: 'Local only',
    manual: 'Manual',
    medium: 'Medium',
    minimal: 'Minimal',
    normal: 'Normal',
    off: 'Off',
    one_at_a_time: 'One at a time',
    project: 'Project',
    required: 'Required',
    same_as_global: 'Same as global setting',
    serial: 'Serial',
    shared: 'Shared',
    strict: 'Strict',
    thorough: 'Thorough',
    user: 'User',
  }
  const leverOptions: Record<string, string[]> = {
    agent_health_strictness: ['lenient', 'normal', 'strict'],
    business_envelope_strictness: ['lenient', 'normal', 'strict'],
    completion_approval: ['automatic', 'gated', 'human'],
    concurrent_task_dispatch: ['one_at_a_time', 'auto_if_safe', 'automatic'],
    crash_recovery_default: ['manual', 'automatic'],
    escalation_on_ambiguity: ['lenient', 'normal', 'strict'],
    landing_strategy: ['shared', 'isolated'],
    max_revisions: ['1', '2', '3', '4', '5'],
    pre_rejection_policy: ['off', 'first_pass', 'required'],
    rejection_dampening: ['lenient', 'normal', 'strict'],
    remediation_autonomy: ['manual', 'gated', 'automatic'],
    reviewer_fanout_policy: ['serial', 'fanout_2', 'fanout_4'],
    reviewer_mode: ['minimal', 'normal', 'thorough'],
    runtime_isolation: ['shared', 'isolated'],
    spec_completeness: ['minimal', 'normal', 'thorough'],
    task_origination: ['human', 'gated', 'automatic'],
    workspace_import_autonomy: ['manual', 'gated', 'automatic'],
    worktree_isolation: ['shared', 'isolated'],
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

      <FrameCard class="readiness-card">
        <ul class="checklist">
          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">Bootstrap</span>
              <span class="check-detail">Project bootstrap commands and success gates.</span>
            </div>
            <StatusPill
              label={bootstrapReady ? 'passed' : bootstrapInfo?.configured ? 'failed' : 'not set'}
              tone={bootstrapReady ? 'ok' : bootstrapInfo?.configured ? 'danger' : 'warn'}
            />
            {#if !bootstrapReady}
              <button type="button" class="linkbtn" onclick={runBootstrap} disabled={bootstrapRunning}>
                {bootstrapRunning ? 'Running…' : 'Configure'}
              </button>
            {/if}
            {#if bootstrapError}
              <div class="row-error">{bootstrapError}</div>
            {/if}
          </li>

          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">Coordinators</span>
              <span class="check-detail">Routing roles that own planning and task execution.</span>
            </div>
            <StatusPill
              label={coordinatorsReady ? `${coordinators.length} defined` : 'none'}
              tone={coordinatorsReady ? 'ok' : 'warn'}
            />
            {#if !coordinatorsReady}
              <button type="button" class="linkbtn" onclick={() => nav('/')}>Configure</button>
            {/if}
          </li>

          <li class="check-row">
            <div class="check-copy">
              <span class="check-label">LLM provider</span>
              <span class="check-detail">Active model host and runtime selection for this project.</span>
            </div>
            <StatusPill
              label={providerReady ? (providerStatus?.active ?? 'configured') : 'not configured'}
              tone={providerReady ? 'ok' : 'warn'}
            />
            {#if !providerReady}
              <button type="button" class="linkbtn" onclick={() => nav('/providers')}>
                Configure
              </button>
            {/if}
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
        <FrameCard class="advanced-card">
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
            <Row justify="end" gap="2" align="center">
              {#if identityStatus}
                <span class="status" class:error={identityStatus.error}>{identityStatus.text}</span>
              {/if}
              <Button variant="primary" disabled={savingIdentity} onclick={saveIdentity}>
                Save identity
              </Button>
            </Row>
          </Stack>
        </FrameCard>

        <FrameCard class="advanced-card advanced-card-wide">
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
                          <StatusPill label={leverSetByLabel(lever.setBy)} tone={lever.setBy === 'user-direct' ? 'warn' : 'neutral'} density="dense" />
                        </header>
                        <div class="lever-options" role="group" aria-label={`${humanizeLeverName(lever.name)} options`}>
                          {#each optionsForLever(lever) as option (option)}
                            <span class:active={option === lever.position} class="lever-option">
                              {leverPositionLabel(option)}
                            </span>
                          {/each}
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

        <FrameCard class="advanced-card advanced-card-wide">
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
    padding: var(--gh-space-3) 0;
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

  .linkbtn {
    justify-self: start;
    background: transparent;
    border: 1px solid var(--gh-color-border-strong);
    border-radius: var(--gh-radius-full);
    color: var(--gh-color-text-primary);
    cursor: pointer;
    font: inherit;
    min-height: var(--gh-control-height-default);
    padding: var(--gh-control-padding-block) var(--gh-control-padding-inline);
  }

  .linkbtn:hover {
    background: color-mix(in srgb, var(--gh-color-feedback-accent) 12%, transparent);
  }

  .linkbtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  .lever-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .lever-option {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 600;
    line-height: 1;
  }

  .lever-option.active {
    border-color: color-mix(in srgb, var(--accent) 58%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-raised));
    color: var(--text);
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

  .ds-facts {
    display: grid;
    gap: var(--gh-space-3);
  }

  .ds-facts > div {
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
      grid-template-columns: minmax(0, 1fr) auto auto;
      align-items: center;
    }

    .row-error {
      grid-column: 1 / -1;
    }

    .ds-facts {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }

  @container (min-width: 60rem) {
    .advanced-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :global(.advanced-card-wide) {
      grid-column: 1 / -1;
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
