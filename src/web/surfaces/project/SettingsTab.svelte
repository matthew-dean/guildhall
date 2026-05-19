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
      const j = await r.json()
      if (j.error) {
        learningError = String(j.error)
        return
      }
      learning = {
        project: j.project ?? null,
        user: j.user ?? null,
        effective: j.effective ?? null,
        projectSkillProposals: j.projectSkillProposals ?? [],
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

  const dsTokenCount = $derived(
    designSystem
      ? (designSystem.tokens?.color?.length ?? 0) +
        (designSystem.tokens?.spacing?.length ?? 0) +
        (designSystem.tokens?.typography?.length ?? 0) +
        (designSystem.tokens?.radius?.length ?? 0) +
        (designSystem.tokens?.shadow?.length ?? 0)
      : 0,
  )
  const projectLearnings = $derived(learning?.project?.suggestedLearnings ?? [])
  const userLearnings = $derived(learning?.user?.suggestedLearnings ?? [])
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
        title="Learned behavior"
        description="Project defaults, reusable project skills, and builder suggestions Guildhall has learned from completed work."
        headingTag="h2"
        density="compact"
      >
        {#snippet meta()}
          <StatusPill label={`${activeLearningCount} active`} tone={activeLearningCount > 0 ? 'ok' : 'neutral'} />
          <StatusPill label={`${suggestedLearningCount} suggested`} tone={suggestedLearningCount > 0 ? 'warn' : 'neutral'} />
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
                title="Project learnings"
                description="Defaults and project facts Guildhall can apply in this workspace."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if projectLearnings.length === 0}
                <p class="muted">No project-specific learning records yet.</p>
              {:else}
                {#each projectLearnings as item (item.id)}
                  <article class="learning-item">
                    <header class="learning-title">
                      <strong>{item.summary}</strong>
                      <StatusPill label={item.status} tone={item.status === 'active' ? 'ok' : item.status === 'dismissed' ? 'neutral' : 'warn'} density="dense" />
                    </header>
                    <div class="learning-meta">
                      <span>{item.destination.replaceAll('_', ' ')}</span>
                      <span>{item.confidence} confidence</span>
                      <span>{item.risk} risk</span>
                    </div>
                    {#if item.evidence?.length}
                      <ul class="learning-evidence">
                        {#each item.evidence as evidence, i (`${item.id}-${i}`)}
                          <li>{evidence.summary}</li>
                        {/each}
                      </ul>
                    {/if}
                    <Row gap="2" justify="end">
                      {#if item.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('accept', 'project', item.id)}>Accept</Button>
                      {/if}
                      {#if item.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('dismiss', 'project', item.id)}>Dismiss</Button>
                      {/if}
                    </Row>
                  </article>
                {/each}
              {/if}
              <Row justify="end">
                <Button size="sm" variant="ghost" disabled={learningBusy !== null || projectLearnings.length === 0} onclick={() => runLearningAction('reset', 'project')}>Reset project learnings</Button>
              </Row>
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="User preferences"
                description="Repeated preferences Guildhall has noticed across work."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if userLearnings.length === 0}
                <p class="muted">No user preference records yet.</p>
              {:else}
                {#each userLearnings as item (item.id)}
                  <article class="learning-item">
                    <header class="learning-title">
                      <strong>{item.summary}</strong>
                      <StatusPill label={item.status} tone={item.status === 'active' ? 'ok' : item.status === 'dismissed' ? 'neutral' : 'warn'} density="dense" />
                    </header>
                    <div class="learning-meta">
                      <span>{item.destination.replaceAll('_', ' ')}</span>
                      <span>{item.confidence} confidence</span>
                    </div>
                    <Row gap="2" justify="end">
                      {#if item.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('accept', 'user_global', item.id)}>Accept</Button>
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runLearningAction('make-project-wide', 'user_global', item.id)}>Use here</Button>
                      {/if}
                      {#if item.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runLearningAction('dismiss', 'user_global', item.id)}>Dismiss</Button>
                      {/if}
                    </Row>
                  </article>
                {/each}
              {/if}
              <Row justify="end">
                <Button size="sm" variant="ghost" disabled={learningBusy !== null || userLearnings.length === 0} onclick={() => runLearningAction('reset', 'user_global')}>Reset user preferences</Button>
              </Row>
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card">
            {#snippet header()}
              <SectionHeader
                title="Project skills"
                description="Reusable project procedures that can enter worker context when their triggers match."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            <Stack gap="3">
              {#if skillProposals.length === 0}
                <p class="muted">No project skill proposals yet.</p>
              {:else}
                {#each skillProposals as skill (skill.id)}
                  <article class="learning-item">
                    <header class="learning-title">
                      <strong>{skill.name}</strong>
                      <StatusPill label={skill.status} tone={skill.status === 'active' ? 'ok' : skill.status === 'dismissed' ? 'neutral' : 'warn'} density="dense" />
                    </header>
                    <p class="learning-copy">{skill.description}</p>
                    {#if skill.triggerKeywords?.length}
                      <div class="learning-meta">
                        {#each skill.triggerKeywords as keyword (`${skill.id}-${keyword}`)}
                          <span>{keyword}</span>
                        {/each}
                      </div>
                    {/if}
                    <Row gap="2" justify="end">
                      {#if skill.status === 'suggested'}
                        <Button size="sm" variant="secondary" disabled={learningBusy !== null} onclick={() => runSkillAction('activate', skill.id, true)}>Activate</Button>
                      {/if}
                      {#if skill.status !== 'dismissed'}
                        <Button size="sm" variant="ghost" disabled={learningBusy !== null} onclick={() => runSkillAction('dismiss', skill.id)}>Dismiss</Button>
                      {/if}
                    </Row>
                  </article>
                {/each}
              {/if}
              <Row justify="end">
                <Button size="sm" variant="ghost" disabled={learningBusy !== null || skillProposals.length === 0} onclick={() => runSkillAction('reset')}>Reset project skills</Button>
              </Row>
            </Stack>
          </FrameCard>

          <FrameCard class="learning-card learning-card-wide">
            {#snippet header()}
              <SectionHeader
                title="Builder suggestions"
                description="Guildhall product improvements raised by project runs."
                headingTag="h3"
                density="dense"
              />
            {/snippet}
            {#if productSuggestions.length === 0}
              <p class="muted">No product suggestions yet.</p>
            {:else}
              <div class="suggestion-list">
                {#each productSuggestions as suggestion (suggestion.id)}
                  <article class="learning-item">
                    <header class="learning-title">
                      <strong>{suggestion.title}</strong>
                      <StatusPill label="builder" tone="info" density="dense" />
                    </header>
                    <p class="learning-copy">{suggestion.summary}</p>
                    {#if suggestion.evidence?.length}
                      <ul class="learning-evidence">
                        {#each suggestion.evidence as evidence, i (`${suggestion.id}-${i}`)}
                          <li>{evidence}</li>
                        {/each}
                      </ul>
                    {/if}
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
        description="Identity, levers, and design-system controls that shape how Guildhall operates."
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

        <FrameCard class="advanced-card">
          {#snippet header()}
            <SectionHeader
              title="Levers"
              description="Every behavioral knob should stay explicit, named, and explainable."
              headingTag="h3"
              density="dense"
            >
              {#snippet meta()}
                <Help topic="subsystem.levers" />
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
              {#each leversByScope as [scope, entries] (scope)}
                <div class="lever-scope">{scope}</div>
                <table class="lever-table">
                  <tbody>
                    {#each entries as lever, i (lever.name + i)}
                      <tr>
                        <td>
                          <code>{lever.name}</code>
                          <Help topic={`lever.${lever.name}`} size={12} />
                        </td>
                        <td><strong>{lever.position}</strong></td>
                        <td class="lever-by">{lever.setBy}</td>
                      </tr>
                      <tr class="lever-rationale">
                        <td colspan="3">{lever.rationale}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
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

  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
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

  .lever-scope {
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--text-muted);
    font-weight: 700;
    font-size: var(--fs-0);
  }

  .lever-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-1);
  }

  .lever-table td {
    padding: var(--gh-space-2) var(--gh-space-2);
    border-top: 1px solid var(--border);
    vertical-align: top;
  }

  .lever-table tbody tr:first-child td {
    border-top: none;
  }

  .lever-by {
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: var(--fs-0);
    font-weight: 700;
  }

  .lever-rationale td {
    color: var(--text-muted);
    font-style: italic;
    padding-top: 0;
    border-top: none;
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

    .learning-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    :global(.advanced-card-wide) {
      grid-column: 1 / -1;
    }

    :global(.learning-card-wide) {
      grid-column: 1 / -1;
    }
  }
</style>
