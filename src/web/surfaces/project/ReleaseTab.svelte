<!--
  Release readiness view. Summarises what's blocking a release candidate:
  open escalations, unapproved briefs/specs, shelved/blocked tasks, design
  system approval, and a status-count tally.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import { nav } from '../../lib/nav.svelte.js'

  interface ReleaseItem {
    id?: string
    taskId?: string
    title?: string
    taskTitle?: string
    reason?: string
    detail?: string
    summary?: string
  }

  interface ReleasePayload {
    initializationNeeded?: boolean
    error?: string
    openEscalations: ReleaseItem[]
    unapprovedBriefs: ReleaseItem[]
    unapprovedSpecs: ReleaseItem[]
    shelvedUnclaimed: ReleaseItem[]
    blockedByAgent: ReleaseItem[]
    designSystem: {
      drafted: boolean
      approved: boolean
      revision?: number
    }
    statusCounts: Record<string, number>
    totals: {
      blockingCount: number
      tasks: number
      done: number
    }
  }

  let data = $state<ReleasePayload | null>(null)
  let error = $state<string | null>(null)
  let initNeeded = $state(false)

  $effect(() => {
    fetch('/api/project/release-readiness')
      .then(r => r.json())
      .then(j => {
        if (j?.initializationNeeded) {
          initNeeded = true
          return
        }
        if (j?.error) {
          error = j.error
          return
        }
        data = j as ReleasePayload
      })
      .catch(err => {
        error = err instanceof Error ? err.message : String(err)
      })
  })

  function idOf(it: ReleaseItem): string {
    return (it.id ?? it.taskId) ?? ''
  }

  function titleOf(it: ReleaseItem): string {
    return it.title ?? it.taskTitle ?? idOf(it)
  }

  function extraOf(it: ReleaseItem): string {
    return it.reason ?? it.detail ?? it.summary ?? ''
  }

  function openTask(id: string) {
    if (id) nav('/task/' + encodeURIComponent(id))
  }

  const statusRows = $derived(
    data ? Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]) : [],
  )
</script>

{#if initNeeded}
  <Card title="Project not initialized yet">
    <p class="muted">Complete the setup wizard before you can assess release readiness.</p>
    <p><a href="/setup">Open setup wizard →</a></p>
  </Card>
{:else if error}
  <Card title="Could not load" tone="danger">
    <p class="muted">{error}</p>
  </Card>
{:else if !data}
  <p class="muted">Loading release readiness…</p>
{:else}
  <div class="page">
    <h2 class="page-title">Release readiness</h2>

    {#if data.totals.blockingCount === 0}
      <Card title="✓ No human blockers" tone="ok">
        <p class="muted">Every task that needed you is cleared. Agents can keep moving.</p>
      </Card>
    {:else}
      <Card
        title="{data.totals.blockingCount} item{data.totals.blockingCount === 1 ? '' : 's'} waiting on you"
        tone="warn"
      >
        <p class="muted">Resolve these before the next release candidate.</p>
      </Card>
    {/if}

    <div class="grid">
      {#snippet section(title, subtitle, items, empty)}
        <Card {title}>
          {#snippet actions()}
            <Chip
              label={items.length === 0 ? 'clear' : items.length + ' open'}
              tone={items.length === 0 ? 'ok' : 'warn'}
            />
          {/snippet}
          {#if subtitle}<p class="sub muted">{subtitle}</p>{/if}
          {#if items.length === 0}
            <p class="muted">{empty}</p>
          {:else}
            <ul class="release-list">
              {#each items as it, i (i)}
                <li>
                  <button type="button" class="link" onclick={() => openTask(idOf(it))}>
                    {titleOf(it)}
                  </button>
                  {#if extraOf(it)}
                    <span class="muted"> · {extraOf(it)}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      {/snippet}

      {@render section(
        'Open escalations',
        'Agents have paused on these and need a human call (FR-10).',
        data.openEscalations,
        'No open escalations.'
      )}
      {@render section(
        'Unapproved briefs',
        'Tasks that authored a product brief but have not been approved yet.',
        data.unapprovedBriefs,
        'Every drafted brief has an approval.'
      )}
      {@render section(
        'Specs awaiting approval',
        'Tasks in spec_review — approve to let an implementer pick them up.',
        data.unapprovedSpecs,
        'Nothing in spec_review.'
      )}
      {@render section(
        'Shelved tasks',
        'Set aside and likely need a human decision about whether to revive.',
        data.shelvedUnclaimed,
        'No shelved tasks.'
      )}
      {@render section(
        'Agent-blocked tasks',
        'Orchestrator paused these; a human review may help.',
        data.blockedByAgent,
        'No agent-blocked tasks.'
      )}

      <Card title="Design system">
        <p class="sub muted">Approve the current revision so implementers are bound by it.</p>
        {#if data.designSystem.drafted}
          {#if data.designSystem.approved}
            <p>
              <Chip label="approved" tone="ok" />
              <span class="muted">revision {data.designSystem.revision}</span>
            </p>
          {:else}
            <p>
              <Chip label="draft" tone="warn" />
              <span class="muted">revision {data.designSystem.revision} — needs human approval</span>
            </p>
          {/if}
        {:else}
          <p><Chip label="not drafted" tone="warn" /></p>
        {/if}
      </Card>

      <Card title="Task-state tally">
        {#snippet actions()}
          <span class="muted">{data.totals.done}/{data.totals.tasks} done</span>
        {/snippet}
        {#if statusRows.length === 0}
          <p class="muted">No tasks yet.</p>
        {:else}
          <table class="tally">
            <tbody>
              {#each statusRows as [k, v] (k)}
                <tr>
                  <td><code>{k}</code></td>
                  <td>{v}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </Card>
    </div>
  </div>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .page-title {
    font-size: var(--fs-4);
    font-weight: 700;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--s-3);
  }
  .sub {
    margin-bottom: var(--s-2);
  }
  .release-list {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .link {
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .link:hover {
    text-decoration: underline;
  }
  .tally {
    border-collapse: collapse;
    width: 100%;
    font-size: var(--fs-2);
  }
  .tally td {
    padding: var(--s-1) var(--s-2);
    border-top: 1px solid var(--border);
  }
  .tally code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
  }
</style>
