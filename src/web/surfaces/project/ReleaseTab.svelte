<!--
  Release readiness view. Primary/secondary/overflow IA:
    · Primary: single verdict band — shared status treatment + one-line reason.
    · Secondary: criteria list, one row per check, expandable into task links.
    · Overflow: compact release counts and task-state tally.
-->
<script lang="ts">
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../packages/ui/src/components/StatusPill.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { projectFetch } from '../../lib/project-routes.js'

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
    dirtyCheckout?: {
      ownedCount: number
      files: string[]
      error?: string
    }
    statusCounts: Record<string, number>
    totals: {
      blockingCount: number
      humanBlockingCount?: number
      unfinishedCount?: number
      designSystemBlockingCount?: number
      dirtyCheckoutBlockingCount?: number
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
    projectFetch('/api/project/release-readiness')
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
    if (ds.approved) {
      return { label: `approved · rev ${ds.revision ?? 0}`, tone: 'ok' as const, clear: true }
    }
    return { label: `draft · rev ${ds.revision ?? 0}`, tone: 'warn' as const, clear: false }
  })

  const unfinishedCount = $derived.by(() => {
    if (!data) return 0
    const terminal = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
    return Object.entries(data.statusCounts).reduce((total, [status, count]) => {
      return terminal.has(status) ? total : total + count
    }, 0)
  })
  const dirtyCheckoutCount = $derived(data?.dirtyCheckout?.ownedCount ?? 0)

  const verdict = $derived.by(() => {
    if (!data) return { label: 'Loading', tone: 'neutral' as const, reason: '' }
    if (data.totals.tasks === 0) {
      return {
        label: 'Not yet',
        tone: 'warn' as const,
        reason: 'No tasks in this project.',
      }
    }
    if (data.totals.blockingCount === 0 && unfinishedCount === 0 && dirtyCheckoutCount === 0 && dsLabel().clear) {
      return {
        label: 'Ready to ship',
        tone: 'ok' as const,
        reason: `${data.totals.done}/${data.totals.tasks} tasks done · no human blockers.`,
      }
    }
    if (unfinishedCount > 0) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: `${unfinishedCount} task${unfinishedCount === 1 ? '' : 's'} still need shaping, worker execution, review, or recovery.`,
      }
    }
    if (dirtyCheckoutCount > 0) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: `${dirtyCheckoutCount} Guildhall-owned project file${dirtyCheckoutCount === 1 ? '' : 's'} still need cleanup or landing.`,
      }
    }
    if (!dsLabel().clear) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: data.designSystem?.drafted
          ? 'Design system is drafted but not approved yet.'
          : 'Design system is not drafted yet.',
      }
    }
    return {
      label: 'Blocked',
      tone: 'warn' as const,
      reason: `${data.totals.blockingCount} item${data.totals.blockingCount === 1 ? '' : 's'} waiting on you.`,
    }
  })

  const sectionCopy = $derived(
    section === 'criteria'
      ? {
          title: 'Release criteria',
          description: 'Expand any row to inspect the tasks or approvals still holding this release.',
        }
      : {
          title: 'Release readiness',
          description: 'A quick read on whether this project is ready to ship right now.',
        },
  )

  const statusRows = $derived(
    data ? Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]) : [],
  )
  const releaseBlockerLabel = $derived(
    data
      ? `${data.totals.blockingCount} release blocker${data.totals.blockingCount === 1 ? '' : 's'}`
      : '0 release blockers',
  )
</script>

{#if initNeeded}
  <NoticeBand tone="warn" role="note" label="Release" title="Project not initialized yet">
    {#snippet actions()}
      <a class="notice-link" href="/setup">Open setup wizard</a>
    {/snippet}
    <p>Complete the setup wizard before you can assess release readiness.</p>
  </NoticeBand>
{:else if error}
  <NoticeBand tone="danger" role="alert" label="Release" title="Could not load release readiness">
    <p>{error}</p>
  </NoticeBand>
{:else if !data}
  <NoticeBand tone="neutral" role="status" label="Release" title="Loading release readiness">
    <p>Collecting release status, approvals, and task counts…</p>
  </NoticeBand>
{:else}
  <div class="release-shell">
    <SectionHeader
      eyebrow="Release"
      title={sectionCopy.title}
      description={sectionCopy.description}
      headingTag="h2"
      density="compact"
    >
      {#snippet meta()}
        <StatusPill label={verdict.label} tone={verdict.tone} emphasis="default" />
        <StatusPill label={`${data.totals.done}/${data.totals.tasks} done`} tone="neutral" />
      {/snippet}
    </SectionHeader>

    {#if section === 'verdict'}
      <NoticeBand
        tone={verdict.tone === 'ok' ? 'ok' : 'warn'}
        role="status"
        label="Verdict"
        title={verdict.label}
      >
        <p>{verdict.reason}</p>
      </NoticeBand>

      <FrameCard
        tone={data.totals.blockingCount === 0 ? 'ok' : 'warn'}
        padding="compact"
        class="summary-card"
      >
        {#snippet header()}
          <SectionHeader
            title="Current counts"
            description="A compact view of the signals feeding the release verdict."
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill label={releaseBlockerLabel} tone={data.totals.blockingCount === 0 ? 'ok' : 'warn'} />
            {/snippet}
          </SectionHeader>
        {/snippet}

        <div class="summary-grid" aria-label="Release summary counts">
          <div class="summary-stat">
            <span class="summary-label">Tasks done</span>
            <strong>{data.totals.done}/{data.totals.tasks}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Total release blockers</span>
            <strong>{data.totals.blockingCount}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Unfinished tasks</span>
            <strong>{data.totals.unfinishedCount ?? unfinishedCount}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Design system</span>
            <StatusPill label={dsLabel().label} tone={dsLabel().tone} />
          </div>
          {#if data.dirtyCheckout}
            <div class="summary-stat">
              <span class="summary-label">Project checkout</span>
              <StatusPill
                label={dirtyCheckoutCount > 0 ? `${dirtyCheckoutCount} Guildhall files dirty` : 'clean'}
                tone={dirtyCheckoutCount > 0 ? 'warn' : 'ok'}
              />
            </div>
          {/if}
        </div>
        {#if data.dirtyCheckout && dirtyCheckoutCount > 0}
          <p class="dirty-detail">
            Guildhall-owned metadata is still present in the project checkout:
            {data.dirtyCheckout.files.slice(0, 4).join(', ')}{dirtyCheckoutCount > 4 ? ', …' : ''}.
          </p>
        {/if}
      </FrameCard>
    {/if}

    {#if section === 'criteria'}
      <FrameCard class="criteria-card">
        {#snippet header()}
          <SectionHeader
            title="Criteria"
            description="Each row stays compact until you need the task-level detail."
            headingTag="h3"
            density="dense"
          />
        {/snippet}

        <ul class="criteria">
          {#each criteria as c (c.key)}
            {@const clear = c.items.length === 0}
            <li class="crit-row">
              <details class="crit-det" open={false}>
                <summary class="crit-summary" aria-disabled={clear}>
                  <span class="crit-copy">
                    <span class="crit-label">{c.label}</span>
                    <span class="crit-detail">{clear ? c.clearLabel : `${c.items.length} task${c.items.length === 1 ? '' : 's'} still open.`}</span>
                  </span>
                  <StatusPill
                    label={clear ? 'clear' : `${c.items.length} open`}
                    tone={clear ? 'ok' : 'warn'}
                  />
                </summary>

                {#if !clear}
                  <ul class="crit-items">
                    {#each c.items as it, i (i)}
                      <li>
                        <button type="button" class="link" onclick={() => openTask(idOf(it))}>
                          {titleOf(it)}
                        </button>
                        {#if extraOf(it)}
                          <span class="muted">{extraOf(it)}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </details>
            </li>
          {/each}

          <li class="crit-row">
            <div class="crit-summary crit-static">
              <span class="crit-copy">
                <span class="crit-label">Design system</span>
                <span class="crit-detail">Current approval state for the operator-facing design system draft.</span>
              </span>
              <StatusPill label={dsLabel().label} tone={dsLabel().tone} />
            </div>
          </li>
        </ul>
      </FrameCard>

      <FrameCard padding="compact" class="tally-card">
        {#snippet header()}
          <SectionHeader
            title="Task-state tally"
            description="Status distribution across the current project backlog."
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill label={`${data.totals.done}/${data.totals.tasks} done`} tone="neutral" />
            {/snippet}
          </SectionHeader>
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
      </FrameCard>
    {/if}
  </div>
{/if}

<style>
  .release-shell {
    display: grid;
    gap: var(--gh-space-4);
    container-type: inline-size;
  }

  :global(.summary-card),
  :global(.criteria-card),
  :global(.tally-card) {
    min-inline-size: 0;
  }

  .summary-grid {
    display: grid;
    gap: var(--gh-space-3);
  }

  .summary-stat {
    display: grid;
    gap: var(--gh-space-1);
  }

  .summary-label,
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .summary-stat strong {
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }

  .dirty-detail {
    margin: var(--gh-space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .criteria {
    list-style: none;
    display: grid;
    gap: 0;
    padding: 0;
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
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: center;
    list-style: none;
    cursor: pointer;
    padding: var(--gh-space-3) 0;
  }

  .crit-summary::-webkit-details-marker {
    display: none;
  }

  .crit-static {
    cursor: default;
  }

  .crit-copy {
    display: grid;
    gap: var(--gh-space-1);
    min-inline-size: 0;
  }

  .crit-label {
    color: var(--text);
    font-size: var(--fs-3);
    font-weight: 600;
    line-height: var(--lh-tight);
  }

  .crit-detail {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .crit-items {
    list-style: none;
    display: grid;
    gap: var(--gh-space-2);
    padding: 0 0 var(--gh-space-3) 0;
  }

  .crit-items li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: baseline;
  }

  .link,
  .notice-link {
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    text-decoration: underline;
  }

  .notice-link {
    min-height: var(--gh-control-height-default);
    padding: var(--gh-control-padding-block) var(--gh-control-padding-inline);
    border: 1px solid var(--gh-color-border-strong);
    border-radius: var(--gh-radius-full);
    color: var(--gh-color-text-primary);
    text-decoration: none;
  }

  .notice-link:hover {
    background: color-mix(in srgb, var(--gh-color-feedback-warn) 14%, transparent);
  }

  .tally {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-2);
  }

  .tally td {
    padding: var(--gh-space-2) 0;
    border-top: 1px solid var(--border);
  }

  .tally tbody tr:first-child td {
    border-top: none;
  }

  code {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
    font-size: var(--fs-1);
  }

  @container (min-width: 42rem) {
    .summary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
