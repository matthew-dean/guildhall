<!--
  Global providers page (/providers). Credentials are machine-scoped and live
  in ~/.guildhall/providers.yaml. Projects only SELECT which of these to
  prefer (see the project Settings → Providers sub-tab).
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Input from '../lib/Input.svelte'
  import PageHeader from '../lib/PageHeader.svelte'

  interface ProviderMeta {
    label: string
    detail: string
    detected: boolean
    verifiedAt: string | null
    url?: string
  }

  let providers = $state<Record<string, ProviderMeta> | null>(null)
  let status = $state<{ text: string; error: boolean } | null>(null)
  let loadError = $state<string | null>(null)
  let testing = $state<string | null>(null)
  let saving = $state<string | null>(null)
  let disconnecting = $state<string | null>(null)

  // Editable fields (only for providers that accept a pasted credential).
  let anthropicKey = $state('')
  let openaiKey = $state('')
  let llamaUrl = $state('')

  const ORDER = ['claude-oauth', 'codex', 'anthropic-api', 'openai-api', 'llama-cpp']

  async function load() {
    try {
      const r = await fetch('/api/setup/providers')
      const j = await r.json()
      if (j.error) {
        loadError = j.error
        return
      }
      providers = j.providers as Record<string, ProviderMeta>
      if (providers['llama-cpp']?.url && !llamaUrl) llamaUrl = providers['llama-cpp'].url
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
    }, 3500)
  }

  async function saveCreds(key: 'anthropic-api' | 'openai-api' | 'llama-cpp') {
    saving = key
    try {
      const body: Record<string, unknown> = {}
      if (key === 'anthropic-api') {
        if (!anthropicKey.trim()) return flash('Paste a key first', true)
        body.anthropicApiKey = anthropicKey.trim()
      } else if (key === 'openai-api') {
        if (!openaiKey.trim()) return flash('Paste a key first', true)
        body.openaiApiKey = openaiKey.trim()
      } else if (key === 'llama-cpp') {
        if (!llamaUrl.trim()) return flash('Enter a URL first', true)
        body.lmStudioUrl = llamaUrl.trim()
      }
      const r = await fetch('/api/setup/providers/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.error) return flash(j.error, true)
      if (key === 'anthropic-api') anthropicKey = ''
      if (key === 'openai-api') openaiKey = ''
      flash('Saved', false)
      await load()
    } finally {
      saving = null
    }
  }

  async function runTest(key: string) {
    testing = key
    try {
      const r = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: key }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string; sample?: string }
      if (j.ok) {
        flash(`Test ok${j.sample ? ` — "${j.sample}"` : ''}`, false)
        await load()
      } else {
        flash(j.error ?? 'Test failed', true)
      }
    } finally {
      testing = null
    }
  }

  async function disconnect(key: string) {
    disconnecting = key
    try {
      const r = await fetch('/api/providers/disconnect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: key }),
      })
      const j = (await r.json()) as { ok: boolean; error?: string; note?: string }
      if (!j.ok) return flash(j.error ?? 'Disconnect failed', true)
      flash(j.note ?? 'Disconnected', false)
      if (key === 'llama-cpp') llamaUrl = ''
      await load()
    } finally {
      disconnecting = null
    }
  }

  function isOauth(key: string) {
    return key === 'claude-oauth' || key === 'codex'
  }

  function configuredLocally(key: string): boolean {
    const p = providers?.[key]
    if (!p) return false
    // OAuth providers are "configured" when their CLI credential file exists.
    if (isOauth(key)) return p.detected
    // Credentialed / URL-based providers: detected === has creds somewhere.
    return p.detected
  }

  function fmtVerified(iso: string | null): string {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      const now = Date.now()
      const diffMs = now - d.getTime()
      const min = Math.round(diffMs / 60000)
      if (min < 1) return 'just now'
      if (min < 60) return `${min}m ago`
      const hr = Math.round(min / 60)
      if (hr < 24) return `${hr}h ago`
      return d.toLocaleDateString()
    } catch {
      return ''
    }
  }
</script>

<PageHeader title="LLM providers" helpTopic="web.providers" />

<div class="page">
  {#if loadError}
    <Card title="Could not load" tone="danger">
      <p class="muted">{loadError}</p>
    </Card>
  {:else if !providers}
    <p class="muted">Loading providers…</p>
  {:else}
    <Card title="Providers">
      <Stack gap="3">
        <p class="muted">
          Configured here apply to every project on this machine. Credentials live
          in <code>~/.guildhall/providers.yaml</code> (chmod 600, never committed).
        </p>

        {#each ORDER.filter(k => providers?.[k]) as key (key)}
          {@const meta = providers[key]}
          <div class="row" class:verified={Boolean(meta.verifiedAt)}>
            <div class="row-head">
              <div class="row-id">
                <span class="label">{meta.label}</span>
                {#if meta.verifiedAt}
                  <span class="chip ok" title={`Verified ${fmtVerified(meta.verifiedAt)}`}>
                    ✓ verified · {fmtVerified(meta.verifiedAt)}
                  </span>
                {:else if meta.detected}
                  <span class="chip ready">configured</span>
                {:else}
                  <span class="chip missing">not configured</span>
                {/if}
              </div>
              <div class="row-actions">
                {#if configuredLocally(key)}
                  <Button
                    disabled={testing === key}
                    onclick={() => runTest(key)}
                  >
                    {testing === key ? 'Testing…' : 'Test'}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={disconnecting === key}
                    onclick={() => disconnect(key)}
                  >
                    {disconnecting === key ? 'Removing…' : 'Disconnect'}
                  </Button>
                {/if}
              </div>
            </div>
            <div class="row-detail muted">{meta.detail}</div>

            {#if key === 'anthropic-api'}
              <div class="row-edit">
                <Input
                  type="password"
                  placeholder="sk-ant-…"
                  value={anthropicKey}
                  oninput={v => (anthropicKey = v)}
                />
                <Button
                  variant="primary"
                  disabled={saving === key || !anthropicKey.trim()}
                  onclick={() => saveCreds('anthropic-api')}
                >
                  {saving === key ? 'Saving…' : 'Save'}
                </Button>
              </div>
            {:else if key === 'openai-api'}
              <div class="row-edit">
                <Input
                  type="password"
                  placeholder="sk-…"
                  value={openaiKey}
                  oninput={v => (openaiKey = v)}
                />
                <Button
                  variant="primary"
                  disabled={saving === key || !openaiKey.trim()}
                  onclick={() => saveCreds('openai-api')}
                >
                  {saving === key ? 'Saving…' : 'Save'}
                </Button>
              </div>
            {:else if key === 'llama-cpp'}
              <div class="row-edit">
                <Input
                  placeholder="http://localhost:1234/v1"
                  value={llamaUrl}
                  oninput={v => (llamaUrl = v)}
                />
                <Button
                  variant="primary"
                  disabled={saving === key || !llamaUrl.trim()}
                  onclick={() => saveCreds('llama-cpp')}
                >
                  {saving === key ? 'Saving…' : 'Save'}
                </Button>
              </div>
            {/if}
          </div>
        {/each}

        {#if status}
          <div class="status" class:error={status.error}>{status.text}</div>
        {/if}
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
    max-width: 760px;
    margin: 0 auto;
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

  .row {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg);
  }
  .row.verified {
    border-color: color-mix(in srgb, var(--accent-2) 50%, var(--border));
  }
  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .row-id {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .label {
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .row-actions {
    display: flex;
    gap: var(--s-2);
    flex-shrink: 0;
  }
  .row-detail {
    font-size: var(--fs-1);
  }
  .row-edit {
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .row-edit :global(input) {
    flex: 1;
  }

  .chip {
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px var(--s-2);
    border-radius: 10px;
  }
  .chip.ok {
    background: rgba(78, 204, 163, 0.15);
    color: var(--accent-2);
    text-transform: none;
    letter-spacing: 0;
  }
  .chip.ready {
    background: rgba(78, 204, 163, 0.10);
    color: var(--accent-2);
  }
  .chip.missing {
    background: rgba(136, 136, 153, 0.12);
    color: var(--text-muted);
  }

  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
    padding: var(--s-2);
    border-radius: var(--r-1);
    background: rgba(78, 204, 163, 0.08);
  }
  .status.error {
    color: var(--danger);
    background: rgba(255, 100, 100, 0.08);
  }
</style>
