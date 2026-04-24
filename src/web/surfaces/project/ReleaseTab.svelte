<!--
  Release readiness view. Primary/secondary/overflow IA:
    · Primary: single VERDICT block — big status chip + one-line reason.
    · Secondary: criteria list, one row per check (icon + label + chip).
      Each row expandable via <details> to show the offending tasks.
    · No card grid; single column.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Stack from '../../lib/Stack.svelte'
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

  interface Props {
    subView?: string | null
  }
  let { subView = null }: Props = $props()
  const section = $derived(subView ?? 'verdict')

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

  interface Criterion {
    key: string
    label: string
    items: ReleaseItem[]
    clearLabel: string
  }

  const criteria = $derived<Criterion[]>(
    data
      ? [
          {
            key: 'escalations',
            label: 'Open escalations',
            items: data.openEscalations,
            clearLabel: 'No open escalations.',
          },
          {
            key: 'briefs',
            label: 'Unapproved briefs',
            items: data.unapprovedBriefs,
            clearLabel: 'All briefs approved.',
          },
          {
            key: 'specs',
            label: 'Specs awaiting approval',
            items: data.unapprovedSpecs,
            clearLabel: 'Nothing in spec_review.',
          },
          {
            key: 'shelved',
            label: 'Shelved tasks',
            items: data.shelvedUnclaimed,
            clearLabel: 'No shelved tasks.',
          },
          {
            key: 'blocked',
            label: 'Agent-blocked tasks',
            items: data.blockedByAgent,
            clearLabel: 'No agent-blocked tasks.',
          },
        ]
      : [],
  )

  const dsLabel = $derived(() => {
    const ds = data?.designSystem
    if (!ds) return { label: 'not drafted', tone: 'warn' as const, clear: false }
    if (!ds.drafted) return { label: 'not drafted', tone: 'warn' as const, clear: false }
    if (ds.approved)
      return { label: `approved · rev ${ds.revision ?? 0}`, tone: 'ok' as const, clear: true }
    return { label: `draft · rev ${ds.revision ?? 0}`, tone: 'warn' as const, clear: false }
  })

  const verdict = $derived.by(() => {
    if (!data) return { label: '…', tone: 'neutral' as const, reason: '' }
    if (data.totals.tasks === 0) {
      return {
        label: 'Not yet',
        tone: 'warn' as const,
        reason: 'No tasks in this project.',
      }
    }
    if (data.totals.blockingCount === 0 && dsLabel().clear) {
      return {
        label: 'Ready to ship',
        tone: 'ok' as const,
        reason: `${data.totals.done}/${data.totals.tasks} tasks done · no human blockers.`,
      }
    }
    return {
      label: 'Blocked',
      tone: 'warn' as const,
      reason: `${data.totals.blockingCount} item${data.totals.blockingCount === 1 ? '' : 's'} waiting on you.`,
    }
  })

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
  <Stack gap="4">
  {#if section === 'verdict'}
    <!-- PRIMARY: verdict -->
    <Card tone={verdict.tone === 'ok' ? 'ok' : verdict.tone === 'warn' ? 'warn' : 'default'}>
      <div class="verdict">
        <Chip label={verdict.label} tone={verdict.tone} />
        <span class="verdict-reason">{verdict.reason}</span>
      </div>
    </Card>
  {/if}

  {#if section === 'criteria'}
    <!-- SECONDARY: criteria list -->
    <Card title="Criteria">
      <ul class="criteria">
        {#each criteria as c (c.key)}
          {@const clear = c.items.length === 0}
          <li class="crit-row">
            {#if clear}
              <details class="crit-det" aria-disabled="true">
                <summary class="crit-summary crit-clear">
                  <span class="crit-icon">✓</span>
                  <span class="crit-label">{c.label}</span>
                  <Chip label="clear" tone="ok" />
                </summary>
              </details>
            {:else}
              <details class="crit-det">
                <summary class="crit-summary">
                  <span class="crit-icon">✗</span>
                  <span class="crit-label">{c.label}</span>
                  <Chip label={`${c.items.length} open`} tone="warn" />
                </summary>
                <ul class="crit-items">
                  {#each c.items as it, i (i)}
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
              </details>
            {/if}
          </li>
        {/each}

        {#if dsLabel()}
          {@const ds = dsLabel()}
          <li class="crit-row">
            <div class="crit-summary" style="cursor: default">
              <span class="crit-icon">{ds.clear ? '✓' : '✗'}</span>
              <span class="crit-label">Design system</span>
              <Chip label={ds.label} tone={ds.tone} />
            </div>
          </li>
        {/if}
      </ul>
    </Card>

    <!-- Overflow: status tally (kept within criteria sub-view) -->
    <details class="tally-more">
      <summary>Task-state tally ({data.totals.done}/{data.totals.tasks} done)</summary>
      <div class="tally-body">
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
      </div>
    </details>
  {/if}
  </Stack>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .verdict {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    flex-wrap: wrap;
  }
  .verdict-reason {
    font-size: var(--fs-3);
    color: var(--text);
    line-height: var(--lh-tight);
  }
  .criteria {
    list-style: none;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .crit-row {
    border-top: 1px solid var(--border);
  }
  .crit-row:first-child {
    border-top: none;
  }
  .crit-det {
    width: 100%;
  }
  .crit-summary {
    display: flex;
    align-items: center;
    gap: var(--s-3);
    padding: var(--s-2) 0;
    cursor: pointer;
    list-style: none;
  }
  .crit-summary::-webkit-details-marker {
    display: none;
  }
  .crit-icon {
    width: 16px;
    text-align: center;
    color: var(--warn);
    font-weight: 700;
  }
  .crit-clear .crit-icon {
    color: var(--accent-2);
  }
  .crit-label {
    flex: 1;
    font-size: var(--fs-2);
    font-weight: 600;
  }
  .crit-items {
    list-style: none;
    padding: 0 0 var(--s-2) var(--s-5);
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
  .tally-more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    list-style: none;
    padding: var(--s-2) 0;
  }
  .tally-more > summary::-webkit-details-marker {
    display: none;
  }
  .tally-more > summary::before {
    content: '▸ ';
  }
  .tally-more[open] > summary::before {
    content: '▾ ';
  }
  .tally-body {
    margin-top: var(--s-2);
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
