<!--
  Global providers page (/providers). Configures how agents call an LLM for
  every project on the machine. Credentials persist to ~/.guildhall/config.yaml.
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import ProviderPicker from '../lib/ProviderPicker.svelte'

  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    url?: string
  }

  let providers = $state<Record<string, ProviderMeta> | null>(null)
  let selected = $state<string | null>(null)
  let apiKey = $state('')
  let llamaUrl = $state('')
  let status = $state<{ text: string; error: boolean } | null>(null)
  let busy = $state(false)
  let loadError = $state<string | null>(null)

  const ORDER = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']

  $effect(() => {
    fetch('/api/setup/providers')
      .then(r => r.json())
      .then(j => {
        if (j.error) {
          loadError = j.error
          return
        }
        providers = j.providers as Record<string, ProviderMeta>
        selected =
          j.preferredProvider ??
          ORDER.find(k => providers?.[k]?.detected) ??
          null
      })
      .catch(err => {
        loadError = err instanceof Error ? err.message : String(err)
      })
  })

  function flash(text: string, error: boolean) {
    status = { text, error }
    setTimeout(() => {
      if (status?.text === text) status = null
    }, 2500)
  }

  async function save() {
    if (!selected) return flash('Pick a provider first', true)
    busy = true
    try {
      const body: Record<string, unknown> = { preferredProvider: selected }
      if (selected === 'anthropic-api' && apiKey.trim()) body.anthropicApiKey = apiKey.trim()
      if (selected === 'openai-api' && apiKey.trim()) body.openaiApiKey = apiKey.trim()
      if (selected === 'llama-cpp' && llamaUrl.trim()) body.lmStudioUrl = llamaUrl.trim()
      const r = await fetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.error) return flash(j.error, true)
      flash('Saved', false)
    } finally {
      busy = false
    }
  }
</script>

<div class="page">
  <h2>LLM providers</h2>
  <p class="intro">
    Global default used by every project on this machine. A project's <code>guildhall.yaml</code>
    can override <code>models:</code> per agent role, but credentials live here (out of the repo).
  </p>

  {#if loadError}
    <Card title="Could not load" tone="danger">
      <p class="muted">{loadError}</p>
    </Card>
  {:else if !providers}
    <p class="muted">Loading providers…</p>
  {:else}
    <Card title="Agent provider">
      <Stack gap="3">
        <p class="muted">
          Pick how Guildhall agents should call an LLM. Stored in
          <code>~/.guildhall/config.yaml</code>.
        </p>
        <ProviderPicker
          {providers}
          {selected}
          onselect={k => (selected = k)}
          {apiKey}
          {llamaUrl}
          onApiKeyChange={v => (apiKey = v)}
          onLlamaUrlChange={v => (llamaUrl = v)}
        />
        <div class="row-end">
          {#if status}
            <span class="save-status" class:error={status.error}>{status.text}</span>
          {/if}
          <Button variant="primary" disabled={busy} onclick={save}>Save provider</Button>
        </div>
      </Stack>
    </Card>
  {/if}
</div>

<style>
  .page {
    padding: var(--s-4);
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    max-width: 720px;
    margin: 0 auto;
  }
  h2 {
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .intro {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
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
  .row-end {
    display: flex;
    gap: var(--s-3);
    justify-content: flex-end;
    align-items: center;
  }
  .save-status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .save-status.error {
    color: var(--danger);
  }
</style>
