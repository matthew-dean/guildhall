<!--
  Settings tab. Primary/secondary/overflow IA:
    · Primary: "Ready to start?" checklist — Bootstrap / Coordinators /
      LLM provider — each a single-line row with status chip + action.
    · Secondary: Coordinators summary card.
    · Overflow (<details> "Advanced"): Workspace identity, rename, Levers
      (read-only), Design system.
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
  import LogViewer from '../../lib/LogViewer.svelte'
  import DefinitionList from '../../lib/DefinitionList.svelte'
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
  })

  async function loadBootstrap() {
    try {
      const r = await fetch('/api/project/bootstrap/status')
      bootstrapInfo = (await r.json()) as BootstrapInfo
    } catch {
      bootstrapInfo = null
    }
  }

  async function runBootstrap() {
    if (bootstrapRunning) return
    bootstrapRunning = true
    try {
      await fetch('/api/project/bootstrap/run', { method: 'POST' })
      await loadBootstrap()
    } finally {
      bootstrapRunning = false
    }
  }

  async function resetLevers() {
    try {
      leversError = null
      const r = await fetch('/api/config/levers/reset', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (j?.error) {
        leversError = String(j.error)
        return
      }
      const fresh = await fetch('/api/config/levers').then(r => r.json())
      levers = fresh.levers ?? []
    } catch (err) {
      leversError = err instanceof Error ? err.message : String(err)
    }
  }

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])

  const bootstrapReady = $derived(
    Boolean(bootstrapInfo?.configured && bootstrapInfo?.status?.success),
  )
  const providerReady = $derived(Boolean(providerStatus?.configured))
  const coordinatorsReady = $derived(coordinators.length > 0)

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
  <Stack gap="4">
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
              {bootstrapRunning ? 'Running…' : 'Configure →'}
            </button>
          {/if}
        </li>
        <li class="check-row">
          <span class="check-label">Coordinators</span>
          <Chip
            label={coordinatorsReady ? `${coordinators.length} defined` : 'none'}
            tone={coordinatorsReady ? 'ok' : 'warn'}
          />
          {#if !coordinatorsReady}
            <button type="button" class="linkbtn" onclick={() => nav('/')}>Configure →</button>
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

    <!-- SECONDARY: Coordinators summary -->
    <Card title="Coordinators">
      {#if coordinators.length === 0}
        <p class="muted">None yet — run meta-intake to bootstrap.</p>
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

          <Row justify="end">
            <Button onclick={runBootstrap} disabled={bootstrapRunning}>
              {bootstrapRunning ? 'Running…' : 'Re-run bootstrap'}
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}

    <!-- OVERFLOW: Advanced -->
    <details class="advanced">
      <summary>Advanced</summary>
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

          <Card title="Levers">
            <Stack gap="2">
              {#if leversError}
                <Row justify="between" align="center" gap="2">
                  <span class="error">Could not load levers: {leversError}</span>
                  <Button variant="secondary" size="sm" onclick={resetLevers}>
                    Reset to defaults
                  </Button>
                </Row>
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
              {#if designSystem === undefined}
                <p class="muted">Loading…</p>
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
    </details>
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
  .advanced > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    list-style: none;
    padding: var(--s-2) 0;
  }
  .advanced > summary::-webkit-details-marker {
    display: none;
  }
  .advanced > summary::before {
    content: '▸ ';
  }
  .advanced[open] > summary::before {
    content: '▾ ';
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
