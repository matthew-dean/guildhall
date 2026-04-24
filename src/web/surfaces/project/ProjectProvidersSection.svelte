<!--
  Project-level providers sub-tab: SELECT which configured provider this
  project should prefer. Credentials live globally (~/.guildhall/providers.yaml)
  — this view is read-only for credentials and only writes
  `preferredProvider` to the project's guildhall.yaml.

  Providers that aren't configured globally are shown disabled with a hint
  to open the global /providers page.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Row from '../../lib/Row.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    verifiedAt: string | null
    url?: string
  }

  const ORDER = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']

  let providers = $state<Record<string, ProviderMeta> | null>(null)
  let preferred = $state<string | null>(null)
  let originalPreferred = $state<string | null>(null)
  let loadError = $state<string | null>(null)
  let saving = $state(false)
  let status = $state<{ text: string; error: boolean } | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/setup/providers')
      const j = await r.json()
      if (j.error) {
        loadError = j.error
        return
      }
      providers = j.providers as Record<string, ProviderMeta>
      preferred = j.preferredProvider ?? null
      originalPreferred = preferred
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  $effect(() => {
    void load()
  })

  function flash(text: string, error: boolean) {
    status = { text, error }
    setTimeout(() => {
      if (status?.text === text) status = null
    }, 2500)
  }

  async function save() {
    if (!preferred) return flash('Pick a provider first', true)
    saving = true
    try {
      const r = await fetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ preferredProvider: preferred }),
      })
      const j = await r.json()
      if (j.error) return flash(j.error, true)
      originalPreferred = preferred
      flash('Saved', false)
    } finally {
      saving = false
    }
  }

  const dirty = $derived(preferred !== originalPreferred)
</script>

<Card title="Project provider">
  <Stack gap="3">
    <p class="muted">
      Pick which configured provider this project should use by default.
      Credentials are machine-scoped — manage them in
      <button type="button" class="inline-link" onclick={() => nav('/providers')}>
        global Providers
      </button>.
    </p>

    {#if loadError}
      <p class="error">{loadError}</p>
    {:else if !providers}
      <p class="muted">Loading…</p>
    {:else}
      <div class="list">
        {#each ORDER.filter(k => providers?.[k]) as key (key)}
          {@const meta = providers[key]}
          {@const disabled = !meta.detected}
          <button
            type="button"
            class="row"
            class:selected={preferred === key}
            class:disabled
            {disabled}
            onclick={() => (preferred = key)}
          >
            <span class="radio" aria-hidden="true"></span>
            <span class="body">
              <span class="label">{meta.label}</span>
              <span class="detail">
                {disabled ? 'Not configured globally — set up in /providers first.' : meta.detail}
              </span>
            </span>
            {#if meta.verifiedAt}
              <Chip label="verified" tone="ok" />
            {:else if meta.detected}
              <Chip label="configured" tone="ok" />
            {:else}
              <Chip label="unavailable" tone="warn" />
            {/if}
          </button>
        {/each}
      </div>

      <Row justify="end" gap="2" align="center">
        {#if status}
          <span class="status" class:error={status.error}>{status.text}</span>
        {/if}
        <Button variant="primary" disabled={saving || !dirty || !preferred} onclick={save}>
          {saving ? 'Saving…' : 'Save selection'}
        </Button>
      </Row>
    {/if}
  </Stack>
</Card>

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
  .inline-link {
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-3);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: var(--text);
    width: 100%;
  }
  .row:hover:not(.disabled) {
    border-color: var(--accent);
  }
  .row.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
  }
  .row.disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .radio {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid var(--border);
    flex-shrink: 0;
  }
  .row.selected .radio {
    border-color: var(--accent);
    background: radial-gradient(circle, var(--accent) 35%, transparent 40%);
  }
  .body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .label {
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .detail {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .status.error {
    color: var(--danger);
  }
</style>
