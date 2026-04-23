<!--
  Settings tab: workspace identity, coordinators (read-only), levers (read-only
  grouped by scope), design-system card (approve the current draft).
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Row from '../../lib/Row.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Input from '../../lib/Input.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import Byline from '../../lib/Byline.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'

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

  $effect(() => {
    fetch('/api/setup/status')
      .then(r => r.json())
      .then(s => {
        initialized = Boolean(s.initialized)
        name = s.name ?? ''
        id = s.id ?? ''
      })
      .catch(() => (initialized = false))
    fetch('/api/config/levers')
      .then(r => r.json())
      .then(j => {
        if (j.error) leversError = String(j.error)
        else levers = j.levers ?? []
      })
      .catch(err => (leversError = err instanceof Error ? err.message : String(err)))
    fetch('/api/project/design-system')
      .then(r => r.json())
      .then(j => (designSystem = j?.designSystem ?? null))
      .catch(() => (designSystem = null))
  })

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])

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
      const r = await fetch('/api/setup/identity', {
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
    const r = await fetch('/api/project/design-system/approve', { method: 'POST' })
    const j = await r.json()
    if (j.error) return alert('Approve failed: ' + j.error)
    const reload = await fetch('/api/project/design-system').then(r => r.json())
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
  <p class="muted">Loading settings…</p>
{:else if !initialized}
  <Card title="Project not initialized yet">
    <p class="muted">Complete the setup wizard first.</p>
    <Row justify="end">
      <Button variant="primary" onclick={() => nav('/setup')}>Open setup wizard →</Button>
    </Row>
  </Card>
{:else}
  <div class="grid">
    <Card title="Workspace identity">
      <Stack gap="3">
        <p class="muted">
          Stored in <code>guildhall.yaml</code>. Renaming the ID doesn't rewrite existing memory
          logs — prefer to set it once.
        </p>
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

    <Card title="Coordinators">
      {#if coordinators.length === 0}
        <p class="muted">
          No coordinators defined yet. Run meta-intake from the project page to bootstrap them.
        </p>
      {:else}
        <div class="coord-list">
          {#each coordinators as c, i (c.id ?? c.name ?? i)}
            <div class="coord">
              <div class="coord-title">
                <strong>{c.name ?? c.id}</strong>
                <span class="muted"> · {c.domain ?? ''}</span>
              </div>
              {#if c.mandate}<Markdown source={c.mandate} />{/if}
            </div>
          {/each}
        </div>
      {/if}
    </Card>

    <Card title="Levers">
      <Stack gap="2">
        <p class="muted">
          Every policy is a named lever with an explicit position. Stored with provenance in
          <code>memory/agent-settings.yaml</code> — read-only here for now.
        </p>
        {#if leversError}
          <p class="error">Could not load levers: {leversError}</p>
        {:else if !levers}
          <p class="muted">Loading…</p>
        {:else if levers.length === 0}
          <p class="muted">No levers configured.</p>
        {:else}
          {#each leversByScope as [scope, entries] (scope)}
            <div class="lever-scope">{scope}</div>
            <table class="lever-table">
              <tbody>
                {#each entries as l, i (l.name + i)}
                  <tr>
                    <td><code>{l.name}</code></td>
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
        <p class="muted">
          Tokens, primitives, interactions, a11y, and copy voice. Drafted by the spec agent or a
          human; stored in <code>memory/design-system.yaml</code>. Implementers see a summary of
          the approved revision in every context.
        </p>
        {#if designSystem === undefined}
          <p class="muted">Loading…</p>
        {:else if !designSystem}
          <p class="muted">
            No design system drafted yet. The spec agent will propose one during exploring; you
            can also author or edit <code>memory/design-system.yaml</code> directly.
          </p>
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

    <Card title="LLM provider">
      <p class="muted">
        LLM credentials are configured globally. <a href="/providers">Open Providers →</a>
      </p>
    </Card>
  </div>
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
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--s-3);
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
