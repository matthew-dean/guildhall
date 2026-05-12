<!--
  Settings tab. Primary/secondary/overflow IA:
    · Primary: "Ready to start?" checklist — Bootstrap / Repo structure /
      LLM provider — each a single-line row with status chip + action.
    · Secondary: Routing summary card.
    · Overflow (<details> "Advanced"): Workspace identity, rename, Levers
      (read-only), Design system.
  Left-rail sub-nav maps:
    /settings            -> subView null | 'ready'       => ready block
    /settings/routing      -> 'routing'                  => routing summary block
    /settings/advanced   -> 'advanced'                    => advanced block
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Input from '../../lib/Input.svelte'
  import Select from '../../lib/Select.svelte'
  import Byline from '../../lib/Byline.svelte'
  import LogViewer from '../../lib/LogViewer.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
  import FactsTab from './FactsTab.svelte'
  import ProjectProvidersSection from './ProjectProvidersSection.svelte'
  import Help from '../../lib/Help.svelte'
  import { friendlyStewardName } from '../../lib/display.js'
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

  let initialized = $state<boolean | null>(null)
  let name = $state('')
  let id = $state('')
  let savingIdentity = $state(false)
  let identityStatus = $state<{ text: string; error: boolean } | null>(null)

  let levers = $state<Lever[] | null>(null)
  let leversError = $state<string | null>(null)
  let designSystem = $state<DesignSystem | null | undefined>(undefined)
  interface LocalConfigResponse {
    landingBranch: string | null
    effectiveLandingBranch: string | null
    landingStrategy: 'cherry_pick_local' | 'cherry_pick_with_push' | 'manual_pr'
    error?: string
  }
  interface WorkspaceImportLearningState {
    preferredAreaKeys: string[]
    preferredSourceKeys: string[]
    approvedRuns: number
    dismissedRuns: number
    averageTaskAcceptanceRatio: number | null
    lastTaskAcceptanceRatio: number | null
    taskSelectionMode: 'all' | 'tight'
    updatedAt: string | null
  }
  interface CoordinatorSuggestion {
    id: string
    title: string
    summary: string
    confidence: 'low' | 'medium' | 'high'
  }
  interface ProductSuggestion {
    id: string
    title: string
    summary: string
    evidence: string[]
  }
  interface LearningResponse {
    project: { workspaceImport: WorkspaceImportLearningState } | null
    user: { workspaceImport: WorkspaceImportLearningState } | null
    effective: {
      workspaceImport: WorkspaceImportLearningState
      defaults: {
        selectedAreaKeys: string[]
        selectedSourceKeys: string[]
        selectedTaskIds: string[]
        taskSelectionMode: 'all' | 'tight'
        note: string | null
      }
      coordinatorSuggestions: CoordinatorSuggestion[]
      productSuggestions: ProductSuggestion[]
    } | null
    error?: string
  }
  let learning = $state<LearningResponse | null>(null)
  let learningBusy = $state<null | 'project' | 'all'>(null)
  let learningError = $state<string | null>(null)

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
  interface SetupProvider {
    detected?: boolean
    verifiedAt?: string | null
    detail?: string
  }
  let providerStatus = $state<ProviderStatus | null>(null)
  let metaIntakeBusy = $state(false)
  let metaIntakeError = $state<string | null>(null)
  let localConfig = $state<LocalConfigResponse | null>(null)
  let landingBranchDraft = $state('')
  let landingStrategyDraft = $state<'cherry_pick_local' | 'cherry_pick_with_push' | 'manual_pr'>('cherry_pick_local')
  let landingBusy = $state(false)
  let landingStatus = $state<{ text: string; error: boolean } | null>(null)

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
    projectFetch('/api/project/local-config')
      .then(r => r.json())
      .then((j: LocalConfigResponse) => {
        if (j?.error) return
        localConfig = j
        landingBranchDraft = j.landingBranch ?? ''
        landingStrategyDraft = j.landingStrategy
      })
      .catch(() => (localConfig = null))
    projectFetch('/api/setup/providers')
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (!j) return
        const preferred = typeof j.preferredProvider === 'string' ? j.preferredProvider : null
        const providers = (j.providers ?? {}) as Record<string, SetupProvider>
        const preferredInfo = preferred ? providers[preferred] : null
        const active =
          preferred && (preferredInfo?.detected || preferredInfo?.verifiedAt)
            ? preferred
            : Object.entries(providers).find(([, p]) => p.detected || p.verifiedAt)?.[0]
        providerStatus = {
          configured: Boolean(active),
          ...(active ? { active } : {}),
        }
      })
      .catch(() => (providerStatus = { configured: false }))
    void loadBootstrap()
    void loadLearning()
  })

  async function loadLearning() {
    try {
      learningError = null
      const r = await projectFetch('/api/project/learning')
      const j = (await r.json()) as LearningResponse
      if (j.error) {
        learningError = j.error
        learning = null
        return
      }
      learning = j
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
      learning = null
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

  let bootstrapError = $state<string | null>(null)
  // Toast after a manual bootstrap run so the user sees what actually
  // happened — pressing "Configure" and silently landing on "Running" was
  // the documented UX bug.
  let bootstrapToast = $state<{ text: string; tone: 'ok' | 'danger' } | null>(null)

  function flashToast(text: string, tone: 'ok' | 'danger'): void {
    bootstrapToast = { text, tone }
    setTimeout(() => {
      if (bootstrapToast?.text === text) bootstrapToast = null
    }, 4500)
  }

  function summarizeBootstrapResult(j: unknown): string {
    const d = (j as { detected?: { packageManager?: string; gates?: Record<string, { available?: boolean }> } })?.detected
    if (!d) return 'Bootstrap verified.'
    const pm = d.packageManager ?? 'none'
    const gates = d.gates ? Object.entries(d.gates).filter(([, v]) => v?.available).map(([k]) => k) : []
    const gateList = gates.length > 0 ? gates.join(', ') : 'no gates'
    return `Bootstrap verified (${pm}): ${gateList}`
  }

  function bootstrapOutputLine(output: string): string | null {
    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line.length > 0 &&
        !line.startsWith('>') &&
        !line.startsWith('Scope:') &&
        !line.startsWith(' ERR_PNPM_') &&
        !line.startsWith(' ELIFECYCLE'),
      )
    return lines.find(line => /\berror\b|failed|Cannot find module|command not found|spawn ENOENT/i.test(line)) ?? lines[0] ?? null
  }

  const failedBootstrapStep = $derived(
    bootstrapInfo?.status?.success === false
      ? bootstrapInfo.status.steps.find(s => s.result === 'fail') ?? null
      : null,
  )
  const failedBootstrapSummary = $derived.by(() => {
    const step = failedBootstrapStep
    if (!step) return null
    const line = bootstrapOutputLine(step.output)
    return line ? `${step.command} exited ${step.exitCode}: ${line}` : `${step.command} exited ${step.exitCode}.`
  })
  const failedBootstrapOutput = $derived.by(() => {
    const step = failedBootstrapStep
    if (!step) return []
    return step.output.split(/\r?\n/)
  })

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

  async function resetLearning(scope: 'project' | 'all') {
    try {
      learningBusy = scope
      learningError = null
      const r = await projectFetch('/api/project/learning/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        learningError = j?.error ?? `Reset failed (${r.status})`
        return
      }
      await loadLearning()
    } catch (err) {
      learningError = err instanceof Error ? err.message : String(err)
    } finally {
      learningBusy = null
    }
  }

  function percent(value: number | null): string {
    if (value === null || Number.isNaN(value)) return '—'
    return `${Math.round(value * 100)}%`
  }

  const hasLearnedBehavior = $derived(
    ((learning?.project?.workspaceImport.approvedRuns ?? 0) + (learning?.project?.workspaceImport.dismissedRuns ?? 0)) > 0,
  )

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])
  const workspaceConfigPath = $derived(
    project.detail?.path ? `${project.detail.path}/guildhall.yaml` : 'guildhall.yaml',
  )
  function scopeLabel(path?: string): string {
    return path?.trim() ? path.trim() : 'workspace root'
  }

  function summarizeMandate(value?: string, limit = 220): string {
    const text = (value ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > limit ? text.slice(0, limit - 1).trimEnd() + '...' : text
  }

  async function ensureCoordinatorRunning(): Promise<boolean> {
    try {
      const detail = await projectFetch('/api/project', { cache: 'no-store' }).then(r => r.json())
      if (detail?.run?.status === 'running') return true
      const r = await projectFetch('/api/project/start', { method: 'POST' })
      return r.ok
    } catch {
      return false
    }
  }

  async function startMetaIntake() {
    if (metaIntakeBusy) return
    metaIntakeBusy = true
    metaIntakeError = null
    try {
      const r = await projectFetch('/api/project/meta-intake', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        metaIntakeError = j?.error ?? `HTTP ${r.status}`
        return
      }
      await ensureCoordinatorRunning()
      nav('/thread')
    } catch (err) {
      metaIntakeError = err instanceof Error ? err.message : String(err)
    } finally {
      metaIntakeBusy = false
    }
  }

  async function rerunMetaIntake() {
    if (metaIntakeBusy) return
    metaIntakeBusy = true
    metaIntakeError = null
    try {
      const r = await projectFetch('/api/project/meta-intake/rerun', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        metaIntakeError = j?.error ?? `HTTP ${r.status}`
        return
      }
      await ensureCoordinatorRunning()
      nav('/thread')
    } catch (err) {
      metaIntakeError = err instanceof Error ? err.message : String(err)
    } finally {
      metaIntakeBusy = false
    }
  }

  const bootstrapReady = $derived(
    Boolean(bootstrapInfo?.configured && bootstrapInfo?.status?.success),
  )
  const providerReady = $derived(Boolean(providerStatus?.configured))
  const coordinatorsReady = $derived(coordinators.length > 0)
  const landingStrategyOptions = [
    { value: 'cherry_pick_local', label: 'Cherry-pick locally' },
    { value: 'cherry_pick_with_push', label: 'Cherry-pick, then push' },
    { value: 'manual_pr', label: 'Open a manual PR' },
  ] as const

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

  function flashLanding(text: string, error: boolean) {
    landingStatus = { text, error }
    setTimeout(() => {
      if (landingStatus?.text === text) landingStatus = null
    }, 3000)
  }

  async function saveLandingSettings() {
    if (landingBusy) return
    landingBusy = true
    try {
      const r = await projectFetch('/api/project/local-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          landingBranch: landingBranchDraft,
          landingStrategy: landingStrategyDraft,
        }),
      })
      const j = (await r.json().catch(() => ({}))) as LocalConfigResponse
      if (!r.ok || j?.error) {
        flashLanding(j?.error ?? `Save failed (${r.status})`, true)
        return
      }
      const fresh = await projectFetch('/api/project/local-config').then(r => r.json() as Promise<LocalConfigResponse>)
      localConfig = fresh
      landingBranchDraft = fresh.landingBranch ?? ''
      landingStrategyDraft = fresh.landingStrategy
      flashLanding('Landing settings saved', false)
      void project.refresh()
    } catch (err) {
      flashLanding(err instanceof Error ? err.message : String(err), true)
    } finally {
      landingBusy = false
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
    for (const l of levers ?? []) {
      if (!out.has(l.scope)) out.set(l.scope, [])
      out.get(l.scope)!.push(l)
    }
    return [...out.entries()]
  })

  const leverInvariantWarning = $derived.by(() => {
    const dispatch = levers?.find(l => l.scope === 'project' && l.name === 'concurrent_task_dispatch')?.position
    const isolation = levers?.find(l => l.scope === 'project' && l.name === 'worktree_isolation')?.position
    if (!dispatch || !isolation) return null
    if (dispatch.startsWith('fanout') && isolation === 'none') {
      return 'Fanout dispatch requires worktree isolation. Set worktree_isolation to per_task or per_attempt before starting Guildhall.'
    }
    return null
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
</script>

{#if initialized === null}
  <p class="muted">Loading settings...</p>
{:else if !initialized}
  <Card title="Project not initialized yet">
    <p class="muted">Complete the setup wizard first.</p>
    <Row justify="end">
      <Button variant="primary" onclick={() => nav('/setup')}>Open setup wizard →</Button>
    </Row>
  </Card>
{:else}
  <Stack gap="4">
  {#if bootstrapToast}
    <div class="toast toast-{bootstrapToast.tone}" role="status">{bootstrapToast.text}</div>
  {/if}
  {#if section === 'facts'}
    <FactsTab />
  {:else if section === 'providers'}
    <ProjectProvidersSection />
  {:else if section === 'ready'}
    <!-- PRIMARY: Ready-to-start checklist -->
    <Card title="Ready to start?" titleTag="h2">
      <ul class="checklist">
        <li class="check-row">
          <span class="check-label">Bootstrap</span>
          <Chip
            label={bootstrapReady ? 'passed' : bootstrapInfo?.configured ? 'failed' : 'not set'}
            tone={bootstrapReady ? 'ok' : bootstrapInfo?.configured ? 'danger' : 'warn'}
          />
          {#if !bootstrapReady}
            <button type="button" class="linkbtn" onclick={runBootstrap} disabled={bootstrapRunning}>
              {bootstrapRunning ? 'Running...' : 'Run again →'}
            </button>
          {/if}
          {#if bootstrapError}
            <div class="row-error">{bootstrapError}</div>
          {/if}
        </li>
        <li class="check-row">
          <span class="check-label">Repo structure</span>
          <Chip
            label={coordinatorsReady ? 'inferred' : 'not inferred'}
            tone={coordinatorsReady ? 'ok' : 'warn'}
          />
          {#if !coordinatorsReady}
            <button type="button" class="linkbtn" onclick={() => nav('/thread')}>Continue setup →</button>
          {/if}
        </li>
        <li class="check-row">
          <span class="check-label">LLM provider</span>
          <Chip
            label={providerReady ? (providerStatus?.active ?? 'configured') : 'not configured'}
            tone={providerReady ? 'ok' : 'warn'}
          />
          {#if !providerReady}
            <button type="button" class="linkbtn" onclick={() => nav('/providers')}>
              Configure →
            </button>
          {/if}
        </li>
      </ul>
    </Card>
  {/if}

  {#if section === 'routing'}
    <!-- ADVANCED: internal routing summary -->
    <Card title="Internal routing" titleTag="h2">
      <Stack gap="3">
        <div class="coord-intro">
          <p class="coord-lede">
            This is Guildhall's internal routing map. It helps the coordinator decide what context,
            scope, and review lenses to pull in, but it should not be a primary thing you manage day
            to day.
          </p>
        </div>

        <div class="coord-grid">
          <div class="coord-info-card">
            <div class="coord-info-label">How it gets filled in</div>
            <ul class="coord-bullets compact">
              <li>Meta-intake infers an initial repo structure from the repo itself.</li>
              <li>Guildhall uses it internally for routing and scope hints.</li>
              <li>Direct <code>guildhall.yaml</code> edits are still the source of truth.</li>
            </ul>
          </div>
          <div class="coord-info-card">
            <div class="coord-info-label">What the fields mean</div>
            <dl class="coord-fields">
              <dt><code>domain</code></dt>
              <dd>The routing lane attached to tasks behind the scenes.</dd>
              <dt><code>path</code></dt>
              <dd>Optional. Narrows one lane to a subproject or folder.</dd>
              <dt><code>guildhall.yaml</code></dt>
              <dd>Current source of truth. This screen is inspection-only.</dd>
            </dl>
          </div>
        </div>

        <div class="coord-source">
          <div class="coord-source-label">Source of truth</div>
          <code class="coord-source-path">{workspaceConfigPath}</code>
        </div>

        <div class="coord-nav-row">
          <span class="muted">If Guildhall's inferred repo structure or starter tasks are stale, run the setup intake again.</span>
          <button type="button" class="linkbtn" onclick={rerunMetaIntake}>
            {metaIntakeBusy ? 'Re-running...' : 'Re-run meta-intake →'}
          </button>
          </div>

      {#if coordinators.length === 0}
        <div class="coord-empty">
          <p class="muted">
            No inferred structure yet. Start meta-intake if you want Guildhall to infer an initial split
            from the repo, then review it in Thread only if something important looks wrong.
          </p>
            <div class="coord-empty-actions">
              <Button variant="primary" onclick={startMetaIntake} disabled={metaIntakeBusy}>
                {metaIntakeBusy ? 'Starting...' : 'Start meta-intake'}
              </Button>
              <Button variant="secondary" onclick={() => nav('/thread')}>Open Thread</Button>
            </div>
            {#if metaIntakeError}
              <p class="error">{metaIntakeError}</p>
            {/if}
          </div>
      {:else}
          <div class="coord-list">
            {#each coordinators as c, i (c.id ?? c.domain ?? i)}
              <div class="coord">
                <div class="coord-title">
                  <div class="coord-heading">
                    <strong>{friendlyStewardName(undefined, c.domain, c.id)}</strong>
                    <span class="muted"> · {c.domain ?? ''}</span>
                  </div>
                  <div class="coord-scope">
                    <span class="coord-chip">Scope: {scopeLabel(c.path)}</span>
                  </div>
                </div>
                <p class="coord-summary">{summarizeMandate(c.mandate)}</p>
                <dl class="coord-meta">
                  <div>
                    <dt>Concerns</dt>
                    <dd>{c.concerns?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Auto</dt>
                    <dd>{c.autonomousDecisions?.length ?? 0}</dd>
                  </div>
                  <div>
                    <dt>Escalates</dt>
                    <dd>{c.escalationTriggers?.length ?? 0}</dd>
                  </div>
                </dl>
              </div>
            {/each}
          </div>
        {/if}
      </Stack>
    </Card>
  {/if}

  {#if section === 'ready'}
    <!-- Bootstrap detail (shown only when configured, collapsed-ish via its own card) -->
    {#if bootstrapInfo?.configured}
      <Card title="Bootstrap detail">
        <Stack gap="3">
          <Row gap="2">
            <Chip
              label={bootstrapInfo.status?.success
                ? 'passed'
                : bootstrapInfo.status
                  ? 'failed'
                  : 'never run'}
              tone={bootstrapInfo.status?.success ? 'ok' : bootstrapInfo.status ? 'danger' : 'warn'}
            />
            {#if bootstrapInfo.needed}
              <Chip label="re-run needed" tone="warn" />
            {/if}
            {#if bootstrapInfo.status}
              <Byline verb="Last run" at={bootstrapInfo.status.lastRunAt} />
            {/if}
          </Row>

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
                s =>
                  `[${s.result === 'pass' ? '✓' : '✗'}] ${s.kind}: ${s.command} (${s.durationMs}ms)`,
              )}
              maxHeight="200px"
            />
          {/if}

          {#if failedBootstrapSummary}
            <div class="failure-detail" role="alert">
              <strong>{failedBootstrapSummary}</strong>
              <LogViewer lines={failedBootstrapOutput} maxHeight="260px" />
            </div>
          {/if}

          <Row justify="end">
            <Button onclick={runBootstrap} disabled={bootstrapRunning}>
              {bootstrapRunning ? 'Running...' : 'Re-run bootstrap'}
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}
  {/if}

  {#if section === 'advanced'}
    <!-- OVERFLOW: Advanced -->
    <div class="advanced-body">
        <Stack gap="4">
          <Card title="Workspace identity">
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
          </Card>

          <Card title="Landing">
            <Stack gap="3">
              <p class="muted">
                Accepted task work lands back onto one project branch using one landing policy. This
                is advanced on purpose: leave it alone unless you want Guildhall to land accepted
                work somewhere other than the current branch, or you want a different post-review
                landing path.
              </p>
              <label class="field">
                <span>Landing branch</span>
                <Input bind:value={landingBranchDraft} placeholder="Current branch at runtime start" />
                <span class="field-note">
                  {#if localConfig?.effectiveLandingBranch}
                    Effective right now: <code>{localConfig.effectiveLandingBranch}</code>
                  {:else}
                    Leave blank to use the current branch when the coordinator starts.
                  {/if}
                </span>
              </label>
              <label class="field">
                <span>Landing strategy</span>
                <Select bind:value={landingStrategyDraft} options={landingStrategyOptions} ariaLabel="Landing strategy" />
                <span class="field-note">
                  Cherry-pick is the normal parallel-work default. Use manual PR when accepted work
                  should stop for human integration instead.
                </span>
              </label>
              <Row justify="end" gap="2" align="center">
                {#if landingStatus}
                  <span class="status" class:error={landingStatus.error}>{landingStatus.text}</span>
                {/if}
                <Button variant="primary" disabled={landingBusy} onclick={saveLandingSettings}>
                  {landingBusy ? 'Saving...' : 'Save landing settings'}
                </Button>
              </Row>
            </Stack>
          </Card>

          <Card title="What the local coordinator has learned">
            <Stack gap="3">
              <p class="muted">
                Guildhall keeps this light on purpose. The coordinator on this machine remembers the
                corrections and preferences that keep repeating, so the next pass can start closer to
                your preferred answer.
              </p>
              {#if learningError}
                <p class="error">Could not load learned behavior: {learningError}</p>
              {:else if !learning?.effective}
                <p class="muted">No learned behavior yet.</p>
              {:else}
                {#if hasLearnedBehavior}
                  <div class="learning-grid">
                    <div class="learning-block">
                      <span class="coord-info-label">Import defaults</span>
                      <ul class="coord-bullets compact">
                        <li>
                          <strong>Repo slices:</strong>
                          {learning.effective.defaults.selectedAreaKeys.length > 0
                            ? learning.effective.defaults.selectedAreaKeys.join(', ')
                            : 'all task-bearing parts'}
                        </li>
                        <li>
                          <strong>Planning sources:</strong>
                          {learning.effective.defaults.selectedSourceKeys.length > 0
                            ? `${learning.effective.defaults.selectedSourceKeys.length} preferred source${learning.effective.defaults.selectedSourceKeys.length === 1 ? '' : 's'}`
                            : 'all task-bearing sources'}
                        </li>
                        <li>
                          <strong>Task list style:</strong>
                          {learning.effective.defaults.taskSelectionMode === 'tight'
                            ? 'tighter recommended task list'
                            : 'full recommended task list'}
                        </li>
                      </ul>
                      {#if learning.effective.defaults.note}
                        <p class="muted">{learning.effective.defaults.note}</p>
                      {/if}
                    </div>

                    <div class="learning-block">
                      <span class="coord-info-label">Signals from your approvals</span>
                      <ul class="coord-bullets compact">
                        <li><strong>Approved import runs:</strong> {learning.project?.workspaceImport.approvedRuns ?? 0}</li>
                        <li><strong>Skipped import runs:</strong> {learning.project?.workspaceImport.dismissedRuns ?? 0}</li>
                        <li><strong>Average kept tasks:</strong> {percent(learning.project?.workspaceImport.averageTaskAcceptanceRatio ?? null)}</li>
                      </ul>
                    </div>
                  </div>
                {:else}
                  <div class="learning-block">
                    <span class="coord-info-label">No learned behavior yet</span>
                    <p class="muted">
                      Once you approve or prune a guided import, Guildhall will reuse those choices here instead of making you teach it again.
                    </p>
                    <ul class="coord-bullets compact">
                      <li><strong>Right now it would start with:</strong> all task-bearing project parts and sources</li>
                      <li><strong>Task list style:</strong> full recommended task list</li>
                    </ul>
                  </div>
                {/if}

                {#if learning.effective.coordinatorSuggestions.length > 0}
                  <div class="learning-block">
                    <span class="coord-info-label">Routing suggestions</span>
                    <Stack gap="2">
                      {#each learning.effective.coordinatorSuggestions as suggestion (suggestion.id)}
                        <div class="coord-info-card">
                          <Row justify="between" gap="2" align="center">
                            <strong>{suggestion.title}</strong>
                            <Chip label={suggestion.confidence} tone={suggestion.confidence === 'high' ? 'warn' : 'neutral'} />
                          </Row>
                          <p class="muted">{suggestion.summary}</p>
                        </div>
                      {/each}
                    </Stack>
                  </div>
                {/if}

                {#if learning.effective.productSuggestions.length > 0}
                  <div class="learning-block">
                    <span class="coord-info-label">Product suggestions</span>
                    <Stack gap="2">
                      {#each learning.effective.productSuggestions as suggestion (suggestion.id)}
                        <div class="coord-info-card">
                          <strong>{suggestion.title}</strong>
                          <p class="muted">{suggestion.summary}</p>
                          {#if suggestion.evidence.length > 0}
                            <ul class="coord-bullets compact">
                              {#each suggestion.evidence as line (line)}
                                <li>{line}</li>
                              {/each}
                            </ul>
                          {/if}
                        </div>
                      {/each}
                    </Stack>
                  </div>
                {/if}

                <Row justify="end" gap="2" align="center">
                  <Button variant="secondary" onclick={() => resetLearning('project')} disabled={learningBusy !== null}>
                    {learningBusy === 'project' ? 'Resetting...' : 'Reset project learning'}
                  </Button>
                  <Button variant="secondary" onclick={() => resetLearning('all')} disabled={learningBusy !== null}>
                    {learningBusy === 'all' ? 'Resetting...' : 'Reset all learning'}
                  </Button>
                </Row>
              {/if}
            </Stack>
          </Card>

          <Card title="Levers">
            <Stack gap="2">
              <Row align="center" gap="2">
                <span class="muted">
                  Every behavioral knob is a named lever with full provenance.
                </span>
                <Help topic="subsystem.levers" />
              </Row>
              {#if leverInvariantWarning}
                <div class="failure-detail" role="alert">
                  <strong>Invalid lever combination</strong>
                  <p class="muted">{leverInvariantWarning}</p>
                </div>
              {/if}
              {#if leversError}
                <Row justify="between" align="center" gap="2">
                  <span class="error">Could not load levers: {leversError}</span>
                  <Button variant="secondary" size="sm" onclick={resetLevers}>
                    Reset to defaults
                  </Button>
                </Row>
              {:else if !levers}
                <p class="muted">Loading...</p>
              {:else if levers.length === 0}
                <p class="muted">No levers configured.</p>
              {:else}
                {#each leversByScope as [scope, entries] (scope)}
                  <div class="lever-scope">{scope}</div>
                  <table class="lever-table">
                    <tbody>
                      {#each entries as l, i (l.name + i)}
                        <tr>
                          <td>
                            <code>{l.name}</code>
                            <Help topic={`lever.${l.name}`} size={12} />
                          </td>
                          <td><strong>{l.position}</strong></td>
                          <td class="lever-by">{l.setBy}</td>
                        </tr>
                        <tr class="lever-rationale">
                          <td colspan="3">{l.rationale}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/each}
              {/if}
            </Stack>
          </Card>

          <Card title="Design system">
            <Stack gap="3">
              {#if designSystem === undefined}
                <p class="muted">Loading...</p>
              {:else if !designSystem}
                <p class="muted">No draft yet.</p>
              {:else}
                <div class="ds-head">
                  <strong>Revision {designSystem.revision ?? 0}</strong>
                  <Chip
                    label={designSystem.approvedAt ? 'approved' : 'draft'}
                    tone={designSystem.approvedAt ? 'ok' : 'warn'}
                  />
                  <Byline by={designSystem.authoredBy ?? 'unknown'} at={designSystem.authoredAt} />
                </div>
                <div class="ds-facts">
                  <div><span class="muted">Tokens:</span> {dsTokenCount}</div>
                  <div><span class="muted">Primitives:</span> {designSystem.primitives?.length ?? 0}</div>
                  <div><span class="muted">Tone:</span> {designSystem.copyVoice?.tone ?? 'plain'}</div>
                  <div><span class="muted">Min contrast:</span> {designSystem.a11y?.minContrastRatio ?? '—'}</div>
                </div>
                {#if designSystem.primitives?.length}
                  <ul class="ds-prims">
                    {#each designSystem.primitives as p, i (p.name + i)}
                      <li><strong>{p.name}</strong> <span class="muted">— {p.usage}</span></li>
                    {/each}
                  </ul>
                {/if}
                {#if designSystem.approvedAt}
                  <p class="muted">
                    <Byline
                      verb="Approved by"
                      by={designSystem.approvedBy ?? 'human'}
                      at={designSystem.approvedAt}
                    />
                  </p>
                {:else}
                  <Row justify="end">
                    <Button variant="primary" onclick={approveDesignSystem}>Approve current draft</Button>
                  </Row>
                {/if}
              {/if}
            </Stack>
          </Card>
        </Stack>
      </div>
  {/if}
  </Stack>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-1);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .field > span:first-child {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .field-note {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .status.error {
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
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .check-row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    border-top: 1px solid var(--border);
  }
  .check-row:first-child {
    border-top: none;
  }
  .check-label {
    min-width: 120px;
    font-weight: 600;
    font-size: var(--fs-2);
  }
  .linkbtn {
    background: transparent;
    border: none;
    padding: 0;
    margin-left: auto;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .linkbtn:hover {
    text-decoration: underline;
  }
  .linkbtn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .row-error {
    flex-basis: 100%;
    margin-top: var(--s-1);
    font-size: var(--fs-1);
    color: var(--danger);
  }
  .toast {
    padding: var(--s-2) var(--s-3);
    border-radius: var(--r-1);
    border: 1px solid var(--border);
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .toast-ok {
    background: color-mix(in srgb, var(--accent-2) 15%, transparent);
    border-color: var(--accent-2);
    color: var(--accent-2);
  }
  .toast-danger {
    background: color-mix(in srgb, var(--danger) 15%, transparent);
    border-color: var(--danger);
    color: var(--danger);
  }
  .failure-detail {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    border: 1px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--text);
    border-radius: var(--r-2);
    padding: var(--s-3);
  }
  .failure-detail strong {
    color: var(--danger);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .coord-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .coord-intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .learning-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--s-2);
  }
  .learning-block {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .coord-lede {
    margin: 0;
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    color: var(--text);
    max-width: 72ch;
  }
  .coord-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: var(--s-2);
  }
  .coord-info-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .coord-info-label {
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .coord-bullets {
    margin: 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    color: var(--text);
  }
  .coord-bullets.compact {
    gap: 4px;
  }
  .coord-fields {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 6px var(--s-2);
    margin: 0;
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .coord-fields dt {
    color: var(--text);
    font-weight: 600;
  }
  .coord-fields dd {
    margin: 0;
    color: var(--text-muted);
  }
  .coord-nav-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .coord {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--fs-2);
  }
  .coord-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .coord-heading {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
  }
  .coord-scope {
    display: flex;
    align-items: center;
  }
  .coord-chip {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: var(--fs-0);
    font-weight: 700;
    border: 1px solid var(--border);
    background: var(--bg-raised-2);
    color: var(--text-muted);
  }
  .coord-source {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--s-2) 0 0 0;
  }
  .coord-source-label {
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .coord-source-path {
    display: inline-block;
    width: fit-content;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .coord-empty {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding-top: var(--s-1);
  }
  .coord-empty-actions {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .coord-summary {
    margin: 0;
    color: var(--text);
    line-height: var(--lh-body);
  }
  .coord-meta {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-2);
    margin: var(--s-1) 0 0 0;
  }
  .coord-meta div {
    background: var(--bg-raised-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    padding: 8px 10px;
  }
  .coord-meta dt {
    margin: 0;
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .coord-meta dd {
    margin: 4px 0 0 0;
    font-size: var(--fs-2);
    font-weight: 600;
    color: var(--text);
  }
  .advanced-body {
    margin-top: var(--s-3);
  }
  .lever-scope {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 700;
    font-size: var(--fs-0);
    margin-top: var(--s-2);
  }
  .lever-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-1);
  }
  .lever-table td {
    padding: var(--s-1) var(--s-2);
    border-top: 1px solid var(--border);
  }
  .lever-table code {
    font-size: var(--fs-1);
  }
  .lever-by {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: var(--fs-0);
    font-weight: 700;
  }
  .lever-rationale td {
    color: var(--text-muted);
    font-style: italic;
    padding-bottom: var(--s-2);
    padding-top: 0;
    border-top: none;
    line-height: var(--lh-body);
  }
  .ds-head {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .ds-facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--s-2);
    font-size: var(--fs-2);
  }
  .ds-prims {
    list-style: none;
    padding-left: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
</style>
