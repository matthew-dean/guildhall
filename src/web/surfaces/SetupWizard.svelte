<!--
  Setup wizard (/setup). Three steps: Identity → Provider → Launch.
  Each step persists server-side before advancing so the user can close the
  tab and resume later on the same step.
-->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import Card from '../lib/ui-compat/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import Input from '../lib/Input.svelte'
  import Markdown from '../lib/Markdown.svelte'
  import ProviderPicker from '../lib/ProviderPicker.svelte'
  import DefinitionList from '../lib/DefinitionList.svelte'
  import StatusLight from '../lib/StatusLight.svelte'
  import Help from '../lib/Help.svelte'
  import Icon from '../lib/Icon.svelte'
  import { friendlyStewardName } from '../lib/display.js'
  import { nav } from '../lib/nav.svelte.js'
  import { currentProjectHref, projectFetch, projectHref } from '../lib/project-routes.js'

  interface Defaults {
    suggestedName?: string
    suggestedId?: string
    path?: string
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
    name?: string
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
    blockReason?: string | null
  }
  interface LaunchActivity {
    taskId: string
    taskStatus: string
    outputStatus: string
    runStatus: string
    updatedAt: string | null
    specLength: number
    blockReason: string | null
  }
  interface WorktreeIncludeCandidate {
    path: string
    reason: string
    selected: boolean
  }

  interface Props {
    projectId?: string | null
  }

  let { projectId: _projectId = null }: Props = $props()
  const routeProjectId = $derived(_projectId?.trim() || null)
  let activeProjectId = $state<string | null>(null)

  let step = $state<1 | 2 | 3>(1)
  let identity = $state<Status>({})
  let name = $state('')
  let id = $state('')
  let idEdited = $state(false)
  let nameError = $state<string | null>(null)
  let idError = $state<string | null>(null)
  let busy = $state(false)
  let loaded = $state(false)
  let setupLoadError = $state<string | null>(null)
  let providerSaveError = $state<string | null>(null)

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
  let setupComplete = $state(false)
  let resumeNotice = $state<string | null>(null)
  let worktreeIncludeCandidates = $state<WorktreeIncludeCandidate[]>([])
  let selectedWorktreeIncludes = $state<string[]>([])
  let worktreeIncludeError = $state<string | null>(null)
  let activityNow = $state(Date.now())
  let bootstrapWatchActive = false
  let destroyed = false

  const launchStopped = $derived(Boolean(bootstrapLive && launchActivity && launchActivity.runStatus !== 'running'))
  const launchBlocked = $derived(launchActivity?.taskStatus === 'blocked')
  const launchCanFinishFromRepoScan = $derived(
    Boolean(
      launchStopped &&
        launchActivity?.taskId === 'task-meta-intake' &&
        launchActivity.specLength === 0 &&
        (launchActivity.outputStatus === 'in-progress' || launchActivity.outputStatus === 'spec-but-no-fence'),
    ),
  )
  const launchRecoverableInterruption = $derived(
    Boolean(
      launchCanFinishFromRepoScan ||
        (launchBlocked &&
        launchActivity?.taskId === 'task-meta-intake' &&
        launchActivity.blockReason &&
        /durable progress|kept researching|request aborted|stop requested/i.test(launchActivity.blockReason)),
    ),
  )
  const launchStatusLabel = $derived(
    launchRecoverableInterruption
      ? 'Setup was interrupted'
      : launchBlocked
      ? 'Meta-intake is blocked'
      : launchStopped
      ? 'Coordinator paused'
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

  function setupFetch(input: string, init?: RequestInit): Promise<Response> {
    return projectFetch(input, init, activeProjectId)
  }

  async function readSetupJson<T extends { error?: string }>(response: Response): Promise<T> {
    const json = (await response.json()) as T
    if (!response.ok) {
      throw new Error(json.error ?? `Setup request failed (${response.status})`)
    }
    return json
  }

  function displayProjectPath(rawPath?: string | null): string | null {
    const trimmed = rawPath?.trim()
    if (!trimmed) return null
    const macHome = /^\/Users\/[^/]+(\/.*)?$/.exec(trimmed)
    if (macHome) return `~${macHome[1] ?? ''}`
    const linuxHome = /^\/home\/[^/]+(\/.*)?$/.exec(trimmed)
    if (linuxHome) return `~${linuxHome[1] ?? ''}`
    return trimmed
  }

  function setupHref(nextStep: 1 | 2 | 3): string {
    return activeProjectId ? projectHref(activeProjectId, `/setup?step=${nextStep}`) : `/setup?step=${nextStep}`
  }

  function dashboardHref(): string {
    return activeProjectId ? projectHref(activeProjectId, '/overview') : currentProjectHref('/overview')
  }

  $effect(() => {
    if (routeProjectId && activeProjectId !== routeProjectId) activeProjectId = routeProjectId
  })

  $effect(() => {
    Promise.all([
      setupFetch('/api/setup/defaults').then(r => readSetupJson<Defaults>(r)),
      setupFetch('/api/setup/status').then(r => readSetupJson<Status>(r)),
    ])
      .then(([defaults, status]) => {
        setupLoadError = null
        if (status.initialized && status.id) activeProjectId = status.id
        identity = {
          name: status.name || defaults.suggestedName,
          id: status.id || defaults.suggestedId,
          path: status.path ?? defaults.path,
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
        } else if (routeProjectId) {
          nav(projectHref(routeProjectId, '/settings/ready'))
          return
        } else {
          step = 3
        }
        if (step === 3) {
          void hydrateWorktreeIncludes()
          void hydrateLaunchState()
        }
        loaded = true
      })
      .catch(error => {
        setupLoadError = error instanceof Error ? error.message : 'Setup could not load this project.'
        loaded = true
      })
  })

  $effect(() => {
    if (step !== 2 || providers) return
    setupFetch('/api/setup/providers')
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
      const r = await setupFetch('/api/setup/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nm, id: slug }),
      })
      const j = await r.json()
      if (j.error) return (nameError = j.error)
      activeProjectId = typeof j.id === 'string' && j.id.trim() ? j.id.trim() : slug
      identity = { ...identity, name: nm, id: slug, initialized: true }
      step = 2
      history.replaceState({}, '', setupHref(2))
    } finally {
      busy = false
    }
  }

  async function saveProvider() {
    if (!selectedProvider) return
    providerSaveError = null
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
      const r = await setupFetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.error) return alert('Save failed: ' + j.error)
      identity = { ...identity, providerConfigured: true }
      step = 3
      history.replaceState({}, '', setupHref(3))
      void hydrateWorktreeIncludes()
      void hydrateLaunchState()
    } catch (err) {
      providerSaveError =
        err instanceof Error
          ? `Could not save provider settings. The service may be refreshing or restarting; try again in a moment. (${err.message})`
          : 'Could not save provider settings. The service may be refreshing or restarting; try again in a moment.'
    } finally {
      busy = false
    }
  }

  function skipToDashboard() {
    nav(dashboardHref())
  }

  async function startBootstrap() {
    bootstrapBusy = true
    setupComplete = false
    try {
      const savedIncludes = await saveSelectedWorktreeIncludes()
      if (!savedIncludes) {
        bootstrapBusy = false
        return
      }
      const r = await setupFetch('/api/project/meta-intake', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        bootstrapBusy = false
        return alert('Bootstrap failed: ' + j.error)
      }
      const resumed = await ensureCoordinatorRunning()
      bootstrapLive = true
      if (resumed) runBootstrapWatch()
    } finally {
      bootstrapBusy = false
    }
  }

  async function hydrateWorktreeIncludes(): Promise<void> {
    try {
      const r = await setupFetch('/api/project/worktree-includes', { cache: 'no-store' })
      const j = await r.json() as { include?: string[]; candidates?: WorktreeIncludeCandidate[]; error?: string }
      if (j.error) {
        worktreeIncludeError = j.error
        return
      }
      worktreeIncludeCandidates = j.candidates ?? []
      selectedWorktreeIncludes = j.include ?? []
      worktreeIncludeError = null
    } catch (err) {
      worktreeIncludeError = err instanceof Error ? err.message : String(err)
    }
  }

  function toggleWorktreeInclude(candidatePath: string) {
    selectedWorktreeIncludes = selectedWorktreeIncludes.includes(candidatePath)
      ? selectedWorktreeIncludes.filter(item => item !== candidatePath)
      : [...selectedWorktreeIncludes, candidatePath]
  }

  async function saveSelectedWorktreeIncludes(): Promise<boolean> {
    try {
      const r = await setupFetch('/api/project/worktree-includes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ include: selectedWorktreeIncludes }),
      })
      const j = await r.json()
      if (j.error) {
        worktreeIncludeError = j.error
        return false
      }
      worktreeIncludeError = null
      return true
    } catch (err) {
      worktreeIncludeError = err instanceof Error ? err.message : String(err)
      return false
    }
  }

  async function ensureCoordinatorRunning(): Promise<boolean> {
    try {
      const detail = await setupFetch('/api/project', { cache: 'no-store' }).then(r => r.json())
      if (detail?.run?.status === 'running') return true
      const r = await setupFetch('/api/project/start', { method: 'POST' })
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
    resumeNotice = 'Resume requested. The coordinator is restarting now.'
    try {
      if (launchRecoverableInterruption) {
        resumeNotice = 'Finishing a setup draft from the saved repo scan.'
        const synthesized = await setupFetch('/api/project/meta-intake/synthesize', { method: 'POST' })
        if (synthesized.ok) {
          const body = await synthesized.json().catch(() => ({})) as { drafts?: DraftCoordinator[] }
          if (body.drafts && body.drafts.length > 0) {
            approvalDrafts = body.drafts
            bootstrapLive = false
            resumeNotice = 'A setup draft was built from the saved repo scan. Review it before continuing.'
            return
          }
        } else {
          const body = await synthesized.json().catch(() => ({})) as { error?: string }
          resumeNotice = body.error ?? 'Could not finish from the saved repo scan. Trying that setup step again.'
        }
        const rerun = await setupFetch('/api/project/meta-intake/rerun', { method: 'POST' })
        if (!rerun.ok) {
          const body = await rerun.json().catch(() => ({})) as { error?: string }
          resumeNotice = body.error ?? 'Could not restart the setup step. Open recovery for details.'
          return
        }
      }
      const resumed = await ensureCoordinatorRunning()
      await refreshLaunchActivity()
      if (resumed) {
        resumeNotice = 'Coordinator restarted. Watching for the next setup update.'
        runBootstrapWatch()
      }
    } finally {
      bootstrapBusy = false
    }
  }

  async function refreshLaunchActivity(draft?: MetaIntakeDraft): Promise<void> {
    try {
      activityNow = Date.now()
      const [projectRes, draftRes] = await Promise.all([
        setupFetch('/api/project', { cache: 'no-store' }),
        draft ? Promise.resolve(null) : setupFetch('/api/project/meta-intake/draft', { cache: 'no-store' }),
      ])
      const projectDetail = await projectRes.json()
      const draftInfo = draft ?? ((await draftRes?.json()) as MetaIntakeDraft | undefined)
      const task = (projectDetail?.tasks ?? []).find((t: { id?: string }) => t.id === 'task-meta-intake') as
        | { id?: string; status?: string; updatedAt?: string; spec?: string; blockReason?: string | null }
        | undefined
      launchActivity = {
        taskId: task?.id ?? 'task-meta-intake',
        taskStatus: task?.status ?? draftInfo?.taskStatus ?? 'unknown',
        outputStatus: draftInfo?.status ?? 'checking',
        runStatus: projectDetail?.run?.status ?? 'stopped',
        updatedAt: task?.updatedAt ?? null,
        specLength: typeof task?.spec === 'string' ? task.spec.length : 0,
        blockReason: task?.blockReason ?? draftInfo?.blockReason ?? null,
      }
    } catch {
      /* keep prior activity */
    }
  }

  const activityItems = $derived([
    ['Task', launchActivity?.taskId],
    ['Agent phase', launchActivity?.taskStatus],
    ['Coordinator', launchActivity?.runStatus],
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

  function isStarterRoutingDraft(drafts: DraftCoordinator[] | null): boolean {
    if (!drafts?.length) return false
    const domains = new Set(drafts.map(d => d.domain))
    return domains.has('_meta') && domains.has('project-implementation')
  }

  function runBootstrapWatch() {
    if (bootstrapWatchActive) return
    bootstrapWatchActive = true
    const poll = async () => {
      if (!bootstrapWatchActive || destroyed) return
      try {
        const r = await setupFetch('/api/project/meta-intake/draft')
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
          setTimeout(() => nav(dashboardHref()), 400)
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
      const r = await setupFetch('/api/project/meta-intake/draft', { cache: 'no-store' })
      if (!r.ok) return
      const j = (await r.json()) as MetaIntakeDraft
      await refreshLaunchActivity(j)
      if (j.status === 'draft-ready' && j.drafts && j.drafts.length > 0) {
        setupComplete = false
        approvalDrafts = j.drafts
        bootstrapLive = false
        return
      }
      if (j.status === 'approved') {
        setupComplete = true
        bootstrapLive = false
        approvalDrafts = null
        return
      }
      if (j.taskExists && (j.status === 'in-progress' || j.status === 'spec-but-no-fence')) {
        setupComplete = false
        bootstrapLive = true
        approvalDrafts = null
        const resumed = await ensureCoordinatorRunning()
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
      const r = await setupFetch('/api/project/meta-intake/approve', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        approvalError = j.error
        return
      }
      setTimeout(() => nav(dashboardHref()), 500)
    } finally {
      approving = false
    }
  }
</script>

{#if !loaded}
  <div class="page"><p class="muted">Loading setup...</p></div>
{:else}
  <div class="page">
    {#if setupLoadError}
      <Card title="Setup needs a project folder">
        <Stack gap="3">
          <p class="muted">
            Open setup from a project in the Projects view so the app knows which folder it is configuring.
          </p>
          <p class="error">{setupLoadError}</p>
        </Stack>
      </Card>
      <Row justify="end" gap="2">
        <Button variant="primary" onclick={() => nav('/projects')}>Projects</Button>
      </Row>
    {:else}
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
          {@const projectPath = displayProjectPath(identity.path)}
          <p class="muted">
            Guildhall will write <code>guildhall.yaml</code> in this project folder.
            These are just labels — you can change them later from Settings or by editing the file.
          </p>
          {#if projectPath}
            <div class="project-orientation">
              <span>Project folder</span>
              <code title={identity.path}>{projectPath}</code>
            </div>
          {:else}
            <p class="error">Project folder unavailable. Open setup from a project in the Projects view.</p>
          {/if}
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
        <Button variant="secondary" onclick={() => nav(dashboardHref())}>Cancel</Button>
        <Button variant="primary" disabled={busy || !identity.path} onclick={saveIdentity}>
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
            <p class="muted">Detecting providers...</p>
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
          {#if providerSaveError}
            <p class="error" role="alert">{providerSaveError}</p>
          {/if}
        </Stack>
      </Card>
      <Row justify="end" gap="2">
        <Button
          variant="secondary"
          onclick={() => {
            step = 1
            history.replaceState({}, '', setupHref(1))
          }}
        >
          ← Back
        </Button>
        <Button variant="primary" disabled={busy || !selectedProvider} onclick={saveProvider}>
          {busy ? 'Saving...' : 'Save and continue →'}
        </Button>
      </Row>
    {:else if setupComplete}
      <Card title="Setup is complete">
        <Stack gap="3">
          <p class="muted">
            This project’s structure and starter contract map are saved. You can review the
            graph or keep working from the overview.
          </p>
          <Row gap="2">
            <Button variant="primary" onclick={() => nav(currentProjectHref('/structure'))}>
              Review structure
            </Button>
            <Button variant="secondary" onclick={skipToDashboard}>
              Open overview
            </Button>
          </Row>
        </Stack>
      </Card>
    {:else}
      <Card title="You're ready to bootstrap.">
        <Stack gap="3">
          <p class="muted">
            Your identity and chosen provider are saved. Next, meta-intake will scan the
            codebase, infer the project structure, and draft starter tasks. It should only stop to
            ask you something if confidence is low and the consequence of being wrong is meaningful.
          </p>
          {#if worktreeIncludeCandidates.length > 0}
            <div class="local-config-prompt">
              <div>
                <strong>Local files for task worktrees</strong>
                <p class="muted">
                  Local config filenames that agents may need for bootstrap or tests were found.
                  Check only the files task worktrees are allowed to copy.
                </p>
              </div>
              <div class="local-config-list">
                {#each worktreeIncludeCandidates as candidate (candidate.path)}
                  <label class="local-config-option" title={candidate.reason}>
                    <input
                      type="checkbox"
                      checked={selectedWorktreeIncludes.includes(candidate.path)}
                      onchange={() => toggleWorktreeInclude(candidate.path)}
                    />
                    <span>{candidate.path}</span>
                  </label>
                {/each}
              </div>
              {#if worktreeIncludeError}
                <p class="error">{worktreeIncludeError}</p>
              {/if}
            </div>
          {/if}
          <Row gap="2">
            <Button variant="agent" disabled={bootstrapBusy || bootstrapLive} onclick={startBootstrap}>
              {#if !bootstrapBusy && !bootstrapLive}
                <Icon name="sparkles" size={14} />
              {/if}
              {bootstrapBusy ? 'Seeding...' : bootstrapLive ? 'Running' : 'Start meta-intake'}
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
              <p class="muted">
                {launchRecoverableInterruption
                  ? 'Setup stopped before the agent saved a draft. Use the saved repo scan to finish setup.'
                  : launchBlocked
                  ? 'The setup task needs a recovery decision before work can continue.'
                  : 'The task is saved. Resume the coordinator to continue meta-intake.'}
              </p>
              <Row justify="start">
                {#if launchBlocked && !launchRecoverableInterruption && launchActivity?.taskId}
                  <Button variant="primary" onclick={() => nav(currentProjectHref(`/task/${launchActivity?.taskId}`))}>
                    Open recovery
                  </Button>
                {:else}
                  <Button variant="agent" disabled={bootstrapBusy} onclick={resumeBootstrap}>
                    <Icon name="sparkles" size={14} />
                    {bootstrapBusy ? 'Resuming...' : launchRecoverableInterruption ? 'Finish from repo scan' : 'Resume'}
                  </Button>
                {/if}
              </Row>
              {#if resumeNotice}
                <p class="muted">{resumeNotice}</p>
              {/if}
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
        {@const proposedCount = approvalDrafts.length}
        {@const starterRoutingDraft = isStarterRoutingDraft(approvalDrafts)}
        <Card title={starterRoutingDraft
          ? `Proposed ${proposedCount} starter ${proposedCount === 1 ? 'lane' : 'lanes'}`
          : `Inferred ${proposedCount} ${proposedCount === 1 ? 'repo slice' : 'repo slices'}`}
        >
          <Stack gap="3">
            <div class="section-title">
              <strong>{starterRoutingDraft ? 'An empty project was found, so starter routing placeholders were proposed.' : 'This was inferred from the repo.'}</strong>
            </div>
            <p class="muted">
              {starterRoutingDraft
                ? 'Confirm only if these starter lanes are materially wrong. They give spec shaping a safe place to happen until real product code exists.'
                : 'Confirm it only if something here is materially wrong. The routing and review structure should be handled underneath.'}
            </p>
            <div class="draft-summary-list">
              {#each approvalDrafts as d, i (i)}
                <div class="draft-summary-item">
                  <strong>{friendlyStewardName(undefined, d.domain, d.domain)}</strong>
                  {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                </div>
              {/each}
            </div>
            <details class="draft-details">
              <summary>{starterRoutingDraft ? 'See why this starter split was proposed' : 'See why this was inferred'}</summary>
              <div class="coord-list">
                {#each approvalDrafts as d, i (i)}
                  <div class="coord">
                    <div class="coord-title">
                      <strong>{friendlyStewardName(undefined, d.domain, d.domain)}</strong>
                      {#if d.path}<span class="muted"> — {d.path}</span>{/if}
                    </div>
                    {#if d.mandate}
                      <div class="coord-mandate">
                        <strong>Owns:</strong>
                        <Markdown source={d.mandate.trim()} />
                      </div>
                    {/if}
                    {#if d.concerns?.length}
                      <div class="coord-concerns">
                        <strong>Review checks:</strong> {d.concerns.map(c => c.id).join(', ')}
                      </div>
                    {/if}
                  </div>
                {/each}
              </div>
            </details>
            {#if approvalError}<p class="error">Failed: {approvalError}</p>{/if}
            <Row justify="end">
              <Button variant="primary" disabled={approving} onclick={approveDrafts}>
                {approving ? 'Saving...' : 'Looks right'}
              </Button>
            </Row>
          </Stack>
        </Card>
      {/if}
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
    font-size: var(--gh-type-size-meta);
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
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
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
    font-weight: var(--gh-type-weight-strong);
    margin-right: var(--s-2);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--gh-type-size-body);
  }
  .field > span:first-child {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .hint {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
  }
  .error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .project-orientation {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .project-orientation span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .project-orientation code {
    width: fit-content;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .section-title {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }
  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--gh-type-size-meta);
  }
  .coord-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .draft-summary-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .draft-summary-item {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    font-size: var(--gh-type-size-body);
  }
  .draft-details {
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
    padding: var(--s-2) var(--s-3);
  }
  .draft-details summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
  }
  .draft-details[open] summary {
    margin-bottom: var(--s-2);
  }
  .coord {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
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
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
  }
  .status-line {
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }
  .activity {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .local-config-prompt {
    display: grid;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised-2);
  }
  .local-config-prompt strong {
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }
  .local-config-list {
    display: grid;
    gap: var(--s-2);
  }
  .local-config-option {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    font-family: var(--font-mono);
    cursor: pointer;
  }
  .local-config-option:hover {
    border-color: var(--accent);
  }
  .local-config-option input {
    inline-size: 1rem;
    block-size: 1rem;
  }
</style>
