<!--
  Bootstrap state for a freshly-created project. Shows, in order:
    1. "not yet bootstrapped" banner with Bootstrap button
    2. "meta-intake working" progress line while the draft is being produced
    3. Draft coordinators approval card once the spec agent yields them
-->
<script lang="ts">
  import Card from '../lib/Card.svelte'
  import Button from '../lib/Button.svelte'
  import Stack from '../lib/Stack.svelte'
  import Row from '../lib/Row.svelte'
  import { project } from '../lib/project.svelte.js'

  interface DraftCoord {
    name: string
    domain: string
    path?: string
    mandate?: string
    concerns?: Array<{ id: string }>
  }

  let bootstrapBusy = $state(false)
  let bootstrapError = $state<string | null>(null)
  let draftStatus = $state<'unknown' | 'in-progress' | 'spec-but-no-fence' | 'draft-ready' | 'approved'>('unknown')
  let drafts = $state<DraftCoord[]>([])
  let approving = $state(false)
  let approvalStatus = $state<{ text: string; error: boolean } | null>(null)

  $effect(() => {
    loadDraft()
  })

  async function loadDraft() {
    try {
      const r = await fetch('/api/project/meta-intake/draft')
      const j = await r.json()
      if (!j?.taskExists) return
      draftStatus = j.status ?? 'unknown'
      if (j.status === 'draft-ready' && Array.isArray(j.drafts)) drafts = j.drafts
    } catch {
      /* silent; banner stays on the "not bootstrapped" message */
    }
  }

  async function bootstrap() {
    bootstrapBusy = true
    bootstrapError = null
    try {
      const r = await fetch('/api/project/meta-intake', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        bootstrapError = j.error
        return
      }
      await fetch('/api/project/start', { method: 'POST' })
      setTimeout(() => {
        void project.refresh()
        void loadDraft()
      }, 400)
    } finally {
      bootstrapBusy = false
    }
  }

  async function approve() {
    approving = true
    approvalStatus = null
    try {
      const r = await fetch('/api/project/meta-intake/approve', { method: 'POST' })
      const j = await r.json()
      if (j.error) {
        approvalStatus = { text: 'Failed: ' + j.error, error: true }
        return
      }
      approvalStatus = {
        text: `Merged ${j.coordinatorsAdded ?? 0} coordinator(s).`,
        error: false,
      }
      setTimeout(() => void project.refresh(), 600)
    } finally {
      approving = false
    }
  }
</script>

{#if draftStatus === 'draft-ready' && drafts.length > 0}
  <Card title="Draft coordinators are ready for review" tone="warn">
    <Stack gap="3">
      <p class="muted">
        The meta-intake agent produced {drafts.length}
        coordinator{drafts.length === 1 ? '' : 's'} based on your codebase. Approve to merge into
        <code>guildhall.yaml</code>.
      </p>
      <div class="list">
        {#each drafts as d, i (i)}
          <div class="coord">
            <div class="title">
              <strong>{d.name}</strong>
              <span class="muted"> — {d.domain}{d.path ? ' · ' + d.path : ''}</span>
            </div>
            {#if d.mandate}<div class="mandate">{d.mandate.trim()}</div>{/if}
            {#if d.concerns?.length}
              <div class="concerns">
                <strong>Concerns:</strong> {d.concerns.map(c => c.id).join(', ')}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <Row justify="end" gap="2" align="center">
        {#if approvalStatus}
          <span class="status" class:error={approvalStatus.error}>{approvalStatus.text}</span>
        {/if}
        <Button variant="primary" disabled={approving} onclick={approve}>
          {approving ? 'Merging…' : 'Approve and merge'}
        </Button>
      </Row>
    </Stack>
  </Card>
{:else if draftStatus === 'in-progress' || draftStatus === 'spec-but-no-fence'}
  <Card title="Meta-intake agent is working…" tone="warn">
    <p class="muted">
      {draftStatus === 'spec-but-no-fence'
        ? 'The spec is partially drafted but does not yet include a coordinators YAML block.'
        : 'Watch the live activity feed for progress.'}
    </p>
  </Card>
{:else}
  <Card title="Project not yet bootstrapped" tone="warn">
    <Stack gap="3">
      <p class="muted">
        No coordinators are configured — click Bootstrap and the meta-intake agent will interview
        you about the codebase and draft a <code>guildhall.yaml</code> with coordinators for each
        domain it finds.
      </p>
      {#if bootstrapError}
        <p class="error">Bootstrap failed: {bootstrapError}</p>
      {/if}
      <Row justify="end">
        <Button variant="primary" disabled={bootstrapBusy} onclick={bootstrap}>
          {bootstrapBusy ? 'Creating…' : 'Bootstrap project'}
        </Button>
      </Row>
    </Stack>
  </Card>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .error {
    color: var(--danger);
    font-size: var(--fs-2);
  }
  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
  }
  .list {
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
  .mandate {
    line-height: var(--lh-body);
  }
  .concerns {
    font-size: var(--fs-1);
    color: var(--text-muted);
  }
  .status {
    font-size: var(--fs-1);
    color: var(--accent-2);
  }
  .status.error {
    color: var(--danger);
  }
</style>
