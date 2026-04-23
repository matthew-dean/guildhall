<!--
  Setup wizard (/setup). Three steps: Identity → Provider → Launch.
  Each step persists server-side before advancing so the user can close the
  tab and resume later on the same step.
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import Input from '../lib/Input.svelte'
  import Markdown from '../lib/Markdown.svelte'
  import LogViewer from '../lib/LogViewer.svelte'
  import ProviderPicker from '../lib/ProviderPicker.svelte'
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
  let llamaUrl = $state('')

  let bootstrapBusy = $state(false)
  let bootstrapLive = $state(false)
  let bootstrapLog = $state<string[]>([])
  let approvalDrafts = $state<Array<{ name: string; domain: string; path?: string; mandate?: string; concerns?: Array<{ id: string }> }> | null>(null)
  let approving = $state(false)
  let approvalError = $state<string | null>(null)

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
      if (selectedProvider === 'openai-api' && apiKey.trim()) body.openaiApiKey = apiKey.trim()
      if (selectedProvider === 'llama-cpp' && llamaUrl.trim()) body.lmStudioUrl = llamaUrl.trim()
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
      await fetch('/api/project/start', { method: 'POST' })
      bootstrapLive = true
      bootstrapLog = ['Connecting to event stream…']
      runBootstrapStream()
    } finally {
      bootstrapBusy = false
    }
  }

  function runBootstrapStream() {
    const es = new EventSource('/api/project/events')
    let stopped = false
    es.onmessage = ev => {
      try {
        const payload = JSON.parse(ev.data)
        const label = payload.type || 'event'
        const extra = payload.taskId ? ' · ' + payload.taskId : ''
        bootstrapLog = [...bootstrapLog, label + extra]
      } catch {
        bootstrapLog = [...bootstrapLog, 'event']
      }
    }
    es.onerror = () => {
      bootstrapLog = [...bootstrapLog, 'stream disconnected']
    }
    const poll = async () => {
      if (stopped) return
      try {
        const r = await fetch('/api/project/meta-intake/draft')
        const j = await r.json()
        if (j.status === 'draft-ready' && j.drafts?.length > 0) {
          approvalDrafts = j.drafts
          stopped = true
          es.close()
          return
        }
        if (j.status === 'approved') {
          stopped = true
          es.close()
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
            a paste-in API key stored in <code>.guildhall/config.yaml</code> (gitignored).
          </p>
          {#if !providers}
            <p class="muted">Detecting providers…</p>
          {:else}
            <ProviderPicker
              {providers}
              selected={selectedProvider}
              onselect={k => (selectedProvider = k)}
              {apiKey}
              {llamaUrl}
              onApiKeyChange={v => (apiKey = v)}
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
            Guildhall has saved your identity and chosen provider. Next, the coordinator agent will
            interview you about the codebase and draft a set of coordinators plus an initial task
            list. You can also skip ahead and add coordinators manually in
            <code>guildhall.yaml</code>.
          </p>
          <Row gap="2">
            <Button variant="primary" disabled={bootstrapBusy || bootstrapLive} onclick={startBootstrap}>
              {bootstrapBusy ? 'Seeding meta-intake task…' : 'Start agent-guided bootstrap'}
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
            <p class="muted">
              The orchestrator is running. Watch events below; when a coordinator draft is ready,
              you can approve it without leaving this page.
            </p>
            <LogViewer lines={bootstrapLog} followTail />
          </Stack>
        </Card>
      {/if}
      {#if approvalDrafts}
        <Card title="Draft coordinators are ready for review" tone="warn">
          <Stack gap="3">
            <p class="muted">
              The meta-intake agent produced {approvalDrafts.length}
              coordinator{approvalDrafts.length === 1 ? '' : 's'} based on your codebase. Approve
              to merge into <code>guildhall.yaml</code>.
            </p>
            <div class="coord-list">
              {#each approvalDrafts as d, i (i)}
                <div class="coord">
                  <div class="coord-title">
                    <strong>{d.name}</strong>
                    <span class="muted"> — {d.domain}{d.path ? ' · ' + d.path : ''}</span>
                  </div>
                  {#if d.mandate}
                    <div class="coord-mandate"><Markdown source={d.mandate.trim()} /></div>
                  {/if}
                  {#if d.concerns?.length}
                    <div class="coord-concerns">
                      <strong>Concerns:</strong> {d.concerns.map(c => c.id).join(', ')}
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
  .coord-concerns {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
</style>
