<!--
  Setup wizard (/setup). Three steps: Identity → Provider → Launch.
  Each step persists server-side before advancing so the user can close the
  tab and resume later on the same step.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import Input from '../lib/Input.svelte'
  import Markdown from '../lib/Markdown.svelte'
  import ProviderPicker from '../lib/ProviderPicker.svelte'
  import DefinitionList from '../lib/DefinitionList.svelte'
  import StatusLight from '../lib/StatusLight.svelte'
  import Help from '../lib/Help.svelte'
  import { nav } from '../lib/nav.svelte.js'

  interface Defaults {
    suggestedName?: string
    suggestedId?: string
  }
  interface Status {
    initialized?: boolean
    providerConfigured?: boolean
    name?: string
    id?: string
    path?: string
  }
  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    url?: string
    baseUrl?: string | null
  }
  interface DraftCoordinator {
    name: string
    domain: string
    path?: string
    mandate?: string
    concerns?: Array<{ id: string }>
  }
  interface MetaIntakeDraft {
    status?: 'no-task' | 'in-progress' | 'draft-ready' | 'spec-but-no-fence' | 'approved' | 'uninitialized'
    taskExists?: boolean
    specReady?: boolean
    drafts?: DraftCoordinator[]
    taskStatus?: string | null
  }
  interface LaunchActivity {
    taskId: string
    taskStatus: string
    outputStatus: string
    runStatus: string
    updatedAt: string | null
    specLength: number
  }

  let step = $state<1 | 2 | 3>(1)
  let identity = $state<Status>({})
  let name = $state('')
  let id = $state('')
  let idEdited = $state(false)
  let nameError = $state<string | null>(null)
  let idError = $state<string | null>(null)
  let busy = $state(false)
  let loaded = $state(false)

  let providers = $state<Record<string, ProviderMeta> | null>(null)
  let selectedProvider = $state<string | null>(null)
  let apiKey = $state('')
  let openaiBaseUrl = $state('')
  let llamaUrl = $state('')

  let bootstrapBusy = $state(false)
  let bootstrapLive = $state(false)
  let approvalDrafts = $state<DraftCoordinator[] | null>(null)
  let approving = $state(false)
  let approvalError = $state<string | null>(null)
  let launchActivity = $state<LaunchActivity | null>(null)
  let activityNow = $state(Date.now())
  let bootstrapWatchActive = false
  let destroyed = false

  const launchStopped = $derived(Boolean(bootstrapLive && launchActivity && launchActivity.runStatus !== 'running'))
  const launchStatusLabel = $derived(
    launchStopped
      ? 'Orchestrator paused'
      : launchActivity?.taskStatus === 'spec_review' && launchActivity.specLength === 0
        ? 'Recovering missing draft'
        : 'Model call in progress',
  )
  const launchQuietSeconds = $derived(
    launchActivity?.updatedAt ? Math.max(0, Math.floor((activityNow - Date.parse(launchActivity.updatedAt)) / 1000)) : null,
  )

  function slugify(s: string): string {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
  }

  $effect(() => {
    Promise.all([
      fetch('/api/setup/defaults').then(r => r.json() as Promise<Defaults>),
      fetch('/api/setup/status').then(r => r.json() as Promise<Status>),
    ])
      .then(([defaults, status]) => {
        identity = {
          name: status.name || defaults.suggestedName,
          id: status.id || defaults.suggestedId,
          path: status.path,
          initialized: status.initialized,
          providerConfigured: status.providerConfigured,
        }
        name = identity.name ?? ''
        id = identity.id ?? ''
        idEdited = Boolean(identity.initialized)
        // Auto-advance to the furthest incomplete step unless a ?step= was
        // explicitly requested.
        const requested = Number(new URLSearchParams(location.search).get('step'))
        if (requested >= 1 && requested <= 3) {
          step = Math.max(1, Math.min(3, requested)) as 1 | 2 | 3
        } else if (!identity.initialized) {
          step = 1
        } else if (!identity.providerConfigured) {
          step = 2
        } else {
          step = 3
        }
        if (step === 3) void hydrateLaunchState()
        loaded = true
      })
      .catch(() => {
        loaded = true
      })
  })

  $effect(() => {
    if (step !== 2 || providers) return
    fetch('/api/setup/providers')
      .then(r => r.json())
      .then(j => {
        if (j.error) return
        providers = j.providers
        openaiBaseUrl = providers?.['openai-api']?.baseUrl ?? ''
        selectedProvider =
          j.preferredProvider ??
          ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp'].find(
            k => providers?.[k]?.detected,
          ) ??
          null
      })
  })

  function onNameInput(v: string) {
    name = v
    if (!idEdited) id = slugify(v)
  }
  function onIdInput(v: string) {
    id = v
    idEdited = true
  }

  async function saveIdentity() {
    nameError = idError = null
    const nm = name.trim()
    const slug = id.trim()
    if (!nm) return (nameError = 'Workspace name is required')
    if (!/^[a-z0-9-]+$/.test(slug))
      return (idError = 'ID must be lowercase letters, numbers, and dashes only')
    busy = true
    try {
      const r = await fetch('/api/setup/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nm, id: slug }),
      })
      const j = await r.json()
      if (j.error) return (nameError = j.error)
      identity = { ...identity, name: nm, id: slug, initialized: true }
      step = 2
      history.replaceState({}, '', '/setup?step=2')
    } finally {
      busy = false
    }
  }

  async function saveProvider() {
    if (!selectedProvider) return
    busy = true
    try {
      const body: Record<string, unknown> = { preferredProvider: selectedProvider }
      if (selectedProvider === 'anthropic-api' && apiKey.trim()) body.anthropicApiKey = apiKey.trim()
      if (selectedProvider === 'openai-api' && apiKey.trim()) {
        body.openaiApiKey = apiKey.trim()
        body.openaiBaseUrl = openaiBaseUrl.trim()
      }
      if (selectedProvider === 'llama-cpp') {
        body.lmStudioUrl = llamaUrl.trim() || providers?.['llama-cpp']?.url || 'http://localhost:1234/v1'
      }
      const r = await fetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.error) return alert('Save failed: ' + j.error)
      identity = { ...identity, providerConfigured: true }
      step = 3
      history.replaceState({}, '', '/setup?step=3')
      void hydrateLaunchState()
    } finally {
      busy = false
    }
  }

  function skipToDashboard() {
    nav('/')
  }

  async function startBootstrap() {
    bootstrapBusy = true
    try {
      const r = await fetch('/api/project/meta-intake', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        bootstrapBusy = false
        return alert('Bootstrap failed: ' + j.error)
      }
      const resumed = await ensureOrchestratorRunning()
      bootstrapLive = true
      if (resumed) runBootstrapWatch()
    } finally {
      bootstrapBusy = false
    }
  }

  async function ensureOrchestratorRunning(): Promise<boolean> {
    try {
      const detail = await fetch('/api/project', { cache: 'no-store' }).then(r => r.json())
      if (detail?.run?.status === 'running') return true
      const r = await fetch('/api/project/start', { method: 'POST' })
      if (!r.ok) {
        return false
      }
      await refreshLaunchActivity()
      return true
    } catch (err) {
      void err
      return false
    }
  }

  async function resumeBootstrap() {
    bootstrapBusy = true
    bootstrapLive = true
    try {
      const resumed = await ensureOrchestratorRunning()
      await refreshLaunchActivity()
      if (resumed) runBootstrapWatch()
    } finally {
      bootstrapBusy = false
    }
  }

  async function refreshLaunchActivity(draft?: MetaIntakeDraft): Promise<void> {
    try {
      activityNow = Date.now()
      const [projectRes, draftRes] = await Promise.all([
        fetch('/api/project', { cache: 'no-store' }),
        draft ? Promise.resolve(null) : fetch('/api/project/meta-intake/draft', { cache: 'no-store' }),
      ])
      const projectDetail = await projectRes.json()
      const draftInfo = draft ?? ((await draftRes?.json()) as MetaIntakeDraft | undefined)
      const task = (projectDetail?.tasks ?? []).find((t: { id?: string }) => t.id === 'task-meta-intake') as
        | { id?: string; status?: string; updatedAt?: string; spec?: string }
        | undefined
      launchActivity = {
        taskId: task?.id ?? 'task-meta-intake',
        taskStatus: task?.status ?? draftInfo?.taskStatus ?? 'unknown',
        outputStatus: draftInfo?.status ?? 'checking',
        runStatus: projectDetail?.run?.status ?? 'stopped',
        updatedAt: task?.updatedAt ?? null,
        specLength: typeof task?.spec === 'string' ? task.spec.length : 0,
      }
    } catch {
      /* keep prior activity */
    }
  }

  const activityItems = $derived([
    ['Task', launchActivity?.taskId],
    ['Agent phase', launchActivity?.taskStatus],
    ['Orchestrator', launchActivity?.runStatus],
    ['Draft', launchActivity?.outputStatus],
    ['Last update', launchActivity?.updatedAt ? new Date(launchActivity.updatedAt).toLocaleTimeString() : null],
    ['Quiet for', launchQuietSeconds === null ? null : formatDuration(launchQuietSeconds)],
    ['Output', launchActivity && launchActivity.specLength > 0 ? `${launchActivity.specLength} chars drafted` : 'No draft yet'],
  ] as const)

  function formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }

  function runBootstrapWatch() {
    if (bootstrapWatchActive) return
    bootstrapWatchActive = true
    const poll = async () => {
      if (!bootstrapWatchActive || destroyed) return
      try {
        const r = await fetch('/api/project/meta-intake/draft')
        const j = (await r.json()) as MetaIntakeDraft
        await refreshLaunchActivity(j)
        if (j.status === 'draft-ready' && j.drafts?.length > 0) {
          approvalDrafts = j.drafts
          bootstrapWatchActive = false
          bootstrapLive = false
          return
        }
        if (j.status === 'approved') {
          bootstrapWatchActive = false
          bootstrapLive = false
          setTimeout(() => nav('/'), 400)
          return
        }
      } catch {
        /* next tick retries */
      }
      setTimeout(poll, 2500)
    }
    setTimeout(poll, 1500)
  }

  async function hydrateLaunchState(): Promise<void> {
    try {
      const r = await fetch('/api/project/meta-intake/draft', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as MetaIntakeDraft
      await refreshLaunchActivity(j)
      if (j.status === 'draft-ready' && j.drafts && j.drafts.length > 0) {
        approvalDrafts = j.drafts
        bootstrapLive = false
        return
      }
      if (j.status === 'approved') {
        bootstrapLive = false
        approvalDrafts = null
        return
      }
      if (j.taskExists && (j.status === 'in-progress' || j.status === 'spec-but-no-fence')) {
        bootstrapLive = true
        approvalDrafts = null
        const resumed = await ensureOrchestratorRunning()
        await refreshLaunchActivity(j)
        if (resumed) runBootstrapWatch()
      }
    } catch {
      /* setup remains usable; polling resumes on next explicit action */
    }
  }

  onDestroy(() => {
    destroyed = true
    bootstrapWatchActive = false
  })

  async function approveDrafts() {
    approving = true
    approvalError = null
    try {
      const r = await fetch('/api/project/meta-intake/approve', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        approvalError = j.error
        return
      }
      setTimeout(() => nav('/'), 500)
    } finally {
      approving = false
    }
  }
</script>

{#if !loaded}
  <div class="page"><p class="muted">Loading setup…</p></div>
{:else}
  <div class="page">
    <div class="step-header">
      {#each [1, 2, 3] as n, i (n)}
        {@const labels = ['Identity', 'Provider', 'Launch']}
        <span class="dot" class:done={n < step} class:active={n === step}>
          {n < step ? '✓' : n}
        </span>
        <span class="step-label">{labels[i]}</span>
      {/each}
    </div>

    {#if step === 1}
      <Card title="Name this project">
        <Stack gap="3">
          <p class="muted">
            Guildhall will write <code>guildhall.yaml</code> at <code>{identity.path ?? ''}</code>.
            These are just labels — you can change them later from Settings or by editing the file.
          </p>
          <label class="field">
            <span>Workspace name</span>
            <Input value={name} oninput={onNameInput} />
            {#if nameError}<span class="error">{nameError}</span>{/if}
          </label>
          <label class="field">
            <span>Workspace ID (slug)</span>
            <Input value={id} oninput={onIdInput} />
            <span class="hint">Lowercase letters, numbers, and dashes only.</span>
            {#if idError}<span class="error">{idError}</span>{/if}
          </label>
        </Stack>
      </Card>
      <Row justify="end" gap="2">
        <Button variant="secondary" onclick={() => nav('/')}>Cancel</Button>
        <Button variant="primary" disabled={busy} onclick={saveIdentity}>
          Save and continue →
        </Button>
      </Row>
    {:else if step === 2}
      <Card title="How should agents call an LLM?">
        <Stack gap="3">
          <p class="muted">
            Guildhall reads credentials from Anthropic's / OpenAI's official CLIs, or falls back to
            a pasted key stored globally in <code>~/.guildhall/providers.yaml</code>.
          </p>
          {#if !providers}
            <p class="muted">Detecting providers…</p>
          {:else}
            <ProviderPicker
              {providers}
              selected={selectedProvider}
              onselect={k => (selectedProvider = k)}
              {apiKey}
              {openaiBaseUrl}
              {llamaUrl}
              onApiKeyChange={v => (apiKey = v)}
              onOpenAiBaseUrlChange={v => (openaiBaseUrl = v)}
              onLlamaUrlChange={v => (llamaUrl = v)}
            />
          {/if}
        </Stack>
      </Card>
      <Row justify="end" gap="2">
        <Button
          variant="secondary"
          onclick={() => {
            step = 1
            history.replaceState({}, '', '/setup?step=1')
          }}
        >
          ← Back
        </Button>
        <Button variant="primary" disabled={busy || !selectedProvider} onclick={saveProvider}>
          Save and continue →
        </Button>
      </Row>
    {:else}
      <Card title="You're ready to bootstrap.">
        <Stack gap="3">
          <p class="muted">
            Guildhall has saved your identity and chosen provider. Next, meta-intake will scan the
            codebase, ask for any missing context, and propose coordinator roles plus starter tasks.
            A coordinator role is a review lane for future work, not the agent running setup.
          </p>
          <Row gap="2">
            <Button variant="primary" disabled={bootstrapBusy || bootstrapLive} onclick={startBootstrap}>
              {bootstrapBusy ? 'Seeding…' : bootstrapLive ? 'Running' : 'Start meta-intake'}
            </Button>
            <Button variant="secondary" disabled={bootstrapLive} onclick={skipToDashboard}>
              Skip to dashboard
            </Button>
          </Row>
        </Stack>
      </Card>
      {#if bootstrapLive}
        <Card title="Meta-intake agent is working">
          <Stack gap="3">
            <Row gap="2" align="center">
              <StatusLight tone={launchStopped ? 'stopped' : 'running'} pulse={!launchStopped} />
              <strong class="status-line">
                {launchStatusLabel}
              </strong>
            </Row>
            {#if launchStopped}
              <p class="muted">The task is saved. Resume the orchestrator to continue meta-intake.</p>
              <Row justify="start">
                <Button variant="primary" disabled={bootstrapBusy} onclick={resumeBootstrap}>
                  {bootstrapBusy ? 'Resuming...' : 'Resume'}
                </Button>
              </Row>
            {:else}
              <p class="muted">
                When the draft is ready, this card changes to review.
              </p>
              {#if launchQuietSeconds !== null && launchQuietSeconds >= 30}
                <p class="muted">
                  No state change for {formatDuration(launchQuietSeconds)}. The model may still be generating.
                </p>
              {/if}
            {/if}
            {#if launchActivity}
              <div class="activity">
                <DefinitionList items={activityItems} size="sm" />
              </div>
            {/if}
          </Stack>
        </Card>
      {/if}
      {#if approvalDrafts}
        <Card title="Coordinator roles are ready for review" tone="warn">
          <Stack gap="3">
            <div class="section-title">
              <strong>Review lanes</strong>
              <Help topic="guide.coordinators" />
            </div>
            <p class="muted">
              Coordinator roles are review lanes for future work. Guildhall uses them to route
              tasks, choose the right reviewer, and decide what an agent may handle without
              interrupting you. Approve these if the lanes match how this repo should be split.
            </p>
            <div class="coord-list">
              {#each approvalDrafts as d, i (i)}
                <div class="coord">
                  <div class="coord-title">
                    <strong><Markdown source={d.name} inline /></strong>
                    {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                  </div>
                  {#if d.mandate}
                    <div class="coord-mandate">
                      <strong>Will watch:</strong>
                      <Markdown source={d.mandate.trim()} />
                    </div>
                  {/if}
                  {#if d.concerns?.length}
                    <div class="coord-concerns">
                      <strong>Will check:</strong> {d.concerns.map(c => c.id).join(', ')}
                    </div>
                  {/if}
                </div>
              {/each}
            </div>
            {#if approvalError}<p class="error">Failed: {approvalError}</p>{/if}
            <Row justify="end">
              <Button variant="primary" disabled={approving} onclick={approveDrafts}>
                {approving ? 'Merging…' : 'Approve and merge'}
              </Button>
            </Row>
          </Stack>
        </Card>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .page {
    padding: var(--s-4);
    max-width: 720px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .step-header {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .dot {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border);
    font-size: var(--fs-1);
    font-weight: 700;
  }
  .dot.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .dot.done {
    background: var(--accent-2);
    border-color: var(--accent-2);
    color: var(--bg);
  }
  .step-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-right: var(--s-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--fs-2);
  }
  .field > span:first-child {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--fs-0);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-1);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--text);
    font-size: var(--fs-2);
  }
  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
  }
  .coord-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
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
    line-height: var(--lh-body);
  }
  .coord-mandate {
    color: var(--text);
  }
  .coord-title :global(.md),
  .coord-mandate :global(.md) {
    color: inherit;
    font-size: inherit;
    line-height: inherit;
  }
  .coord-concerns {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .status-line {
    color: var(--text);
    font-size: var(--fs-2);
  }
  .activity {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
</style>
