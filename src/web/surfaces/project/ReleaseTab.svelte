<!--
  Current work closure view. Primary/secondary/overflow IA:
    · Primary: single verdict band — shared status treatment + one-line reason.
    · Secondary: criteria list, one row per check, expandable into task links.
    · Overflow: compact closure counts and task-state tally.
-->
<script lang="ts">
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../packages/ui/src/components/StatusPill.svelte'
  import { nav } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../../lib/project-routes.js'

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
    scope?: {
      kind: string
      label: string
      description: string
    }
    openEscalations: ReleaseItem[]
    unapprovedBriefs: ReleaseItem[]
    unapprovedSpecs: ReleaseItem[]
    shelvedUnclaimed: ReleaseItem[]
    blockedByAgent: ReleaseItem[]
    designSystem: {
      drafted: boolean
      approved: boolean
      revision?: number
      source?: 'guildhall' | 'repo' | 'none' | string
      label?: string
      reason?: string
    }
    dirtyCheckout?: {
      ownedCount: number
      files: string[]
      error?: string
    }
    gitStory?: {
      ready?: boolean
      state?: string
      blockers?: Array<{
        id?: string
        label?: string
        state?: string
        reason?: string
        nextAction?: string
        taskId?: string
      }>
    }
    statusCounts: Record<string, number>
    totals: {
      blockingCount: number
      humanBlockingCount?: number
      unfinishedCount?: number
      designSystemBlockingCount?: number
      dirtyCheckoutBlockingCount?: number
      gitStoryBlockingCount?: number
      tasks: number
      done: number
    }
  }

  type GitStoryBlocker = NonNullable<NonNullable<ReleasePayload['gitStory']>['blockers']>[number]

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
    if (id) nav(currentTaskHref(id))
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
            clearLabel: 'No specs awaiting approval.',
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
    if (!ds) return { label: 'not captured', tone: 'warn' as const, clear: false }
    if (!ds.drafted) return { label: ds.label ?? 'not captured', tone: 'warn' as const, clear: false }
    if (ds.source === 'repo') {
      return { label: ds.label ?? 'detected in repo', tone: 'ok' as const, clear: true }
    }
    if (ds.approved) {
      return { label: ds.label ?? `approved · rev ${ds.revision ?? 0}`, tone: 'ok' as const, clear: true }
    }
    return { label: ds.label ?? `draft · rev ${ds.revision ?? 0}`, tone: 'warn' as const, clear: false }
  })

  const unfinishedCount = $derived.by(() => {
    if (!data) return 0
    const terminal = new Set(['done', 'shelved', 'cancelled', 'archived', 'pending_pr'])
    return Object.entries(data.statusCounts).reduce((total, [status, count]) => {
      return terminal.has(status) ? total : total + count
    }, 0)
  })
  const dirtyCheckoutCount = $derived(data?.dirtyCheckout?.ownedCount ?? 0)
  const dirtyCheckoutError = $derived(data?.dirtyCheckout?.error ?? '')
  const checkoutInspectionError = $derived(
    dirtyCheckoutError
      ? /git status|fatal: not a git repository|spawn git enoent/i.test(dirtyCheckoutError)
        ? 'Guildhall could not inspect this checkout with git. Check that the project path is a Git checkout and that git is available to Guildhall.'
        : dirtyCheckoutError
      : '',
  )
  function normalizedGitStoryState(state: string | undefined): string {
    return String(state ?? '').trim().toLowerCase()
  }

  function isGitInspectionFailure(blocker: GitStoryBlocker): boolean {
    const haystack = `${blocker.state ?? ''}\n${blocker.reason ?? ''}\n${blocker.nextAction ?? ''}`.toLowerCase()
    return (
      normalizedGitStoryState(blocker.state) === 'unknown' ||
      haystack.includes('spawn git enoent') ||
      haystack.includes('fatal: not a git repository') ||
      haystack.includes('could not read it')
    )
  }

  function gitBlockerCopy(blocker: GitStoryBlocker): { label: string; detail: string } {
    if (isGitInspectionFailure(blocker)) {
      return {
        label: 'Guildhall could not inspect this checkout.',
        detail: 'Check that this project path is a Git checkout and that git is available to the Guildhall runtime.',
      }
    }
    const haystack = `${blocker.state ?? ''}\n${blocker.reason ?? ''}\n${blocker.nextAction ?? ''}`.toLowerCase()
    if (haystack.includes('no upstream')) {
      return {
        label: 'A branch needs a sharing decision.',
        detail: 'Push it, open a PR, or mark the work local-only/deferred if it should not be shared.',
      }
    }
    if (haystack.includes('dirty') || haystack.includes('uncommitted')) {
      return {
        label: 'A checkout has uncommitted work.',
        detail: 'Review the diff, then commit it or mark the work local-only/deferred.',
      }
    }
    return {
      label: blocker.reason ?? blocker.label ?? blocker.state ?? 'Git story needs closure.',
      detail: blocker.nextAction ?? (blocker.label && blocker.reason ? blocker.reason : ''),
    }
  }

  function gitBlockerKey(blocker: GitStoryBlocker): string {
    const copy = gitBlockerCopy(blocker)
    if (isGitInspectionFailure(blocker)) return `inspection:${blocker.taskId ?? blocker.id ?? 'project'}`
    return [
      normalizedGitStoryState(blocker.state),
      blocker.taskId ?? '',
      blocker.id ?? '',
      copy.label,
      copy.detail,
    ].join('|')
  }

  function dedupeGitBlockers(blockers: GitStoryBlocker[]): GitStoryBlocker[] {
    const seen = new Set<string>()
    const out: GitStoryBlocker[] = []
    for (const blocker of blockers) {
      const key = gitBlockerKey(blocker)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(blocker)
    }
    return out
  }

  function statusLabel(status: string): string {
    switch (status) {
      case 'exploring': return 'Being shaped'
      case 'import_draft': return 'Imported drafts'
      case 'gate_check': return 'Gate checks'
      case 'spec_review': return 'Spec review'
      case 'in_progress': return 'In progress'
      case 'pending_pr': return 'Pending PR'
      case 'ready': return 'Ready'
      case 'blocked': return 'Blocked'
      case 'done': return 'Done'
      case 'shelved': return 'Shelved'
      default: return status.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    }
  }

  const gitStoryBlockers = $derived(dedupeGitBlockers(data?.gitStory?.blockers ?? []))
  const visibleGitStoryBlockers = $derived(gitStoryBlockers.slice(0, 5))

  const verdict = $derived.by(() => {
    if (!data) return { label: 'Loading', tone: 'neutral' as const, reason: '' }
    if (data.totals.tasks === 0) {
      return {
        label: 'Not yet',
        tone: 'warn' as const,
        reason: 'No tracked work yet. Shape the first task before judging closure.',
      }
    }
    if (data.totals.blockingCount === 0 && unfinishedCount === 0 && dirtyCheckoutCount === 0 && !dirtyCheckoutError && dsLabel().clear) {
      return {
        label: 'Closed',
        tone: 'ok' as const,
        reason: `${data.totals.done}/${data.totals.tasks} tasks done · no open closure blockers.`,
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
    if (dirtyCheckoutError) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: 'Guildhall could not inspect the project checkout.',
      }
    }
    if (gitStoryBlockers.length > 0) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: `${gitStoryBlockers.length} git stor${gitStoryBlockers.length === 1 ? 'y needs' : 'ies need'} closure.`,
      }
    }
    if (!dsLabel().clear) {
      return {
        label: 'Blocked',
        tone: 'warn' as const,
        reason: data.designSystem?.reason
          ?? (data.designSystem?.drafted
            ? 'A design guardrail is drafted but still needs approval.'
            : 'No design-system guardrail is captured yet.'),
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
          title: 'Closure checks',
          description: 'Expand any row to inspect the tasks, approvals, or Git stories still keeping the current work open.',
        }
      : {
          title: 'Current work closure',
          description: data?.scope?.description
            ?? 'A quick read on whether the work Guildhall is tracking now is closed enough to hand off, ship, or deliberately defer.',
        },
  )

  const statusRows = $derived(
    data ? Object.entries(data.statusCounts).sort((a, b) => b[1] - a[1]) : [],
  )
  const releaseBlockerLabel = $derived(
    data
      ? `${data.totals.blockingCount} closure blocker${data.totals.blockingCount === 1 ? '' : 's'}`
      : '0 closure blockers',
  )
  const taskDoneLabel = $derived(data?.totals.tasks === 0 ? 'No tracked work yet' : `${data?.totals.done ?? 0}/${data?.totals.tasks ?? 0} done`)
</script>

{#if initNeeded}
  <NoticeBand tone="warn" role="note" label="Closure" title="Project not initialized yet">
    {#snippet actions()}
      <a class="notice-link" href={currentProjectHref('/setup')}>Open setup wizard</a>
    {/snippet}
    <p>Complete the setup wizard before Guildhall can assess whether the current work is closed.</p>
  </NoticeBand>
{:else if error}
  <NoticeBand tone="danger" role="alert" label="Closure" title="Could not load closure checks">
    <p>{error}</p>
  </NoticeBand>
{:else if !data}
  <NoticeBand tone="neutral" role="status" label="Closure" title="Loading closure checks">
    <p>Collecting task status, approvals, Git stories, and checkout state…</p>
  </NoticeBand>
{:else}
  <div class="release-shell">
    <SectionHeader
      eyebrow={data.scope?.label ?? 'Current Guildhall work'}
      title={sectionCopy.title}
      description={sectionCopy.description}
      headingTag="h2"
      density="compact"
    >
      {#snippet meta()}
        <StatusPill label={verdict.label} tone={verdict.tone} emphasis="default" />
        <StatusPill label={taskDoneLabel} tone="neutral" />
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
            description="A compact view of the signals feeding the closure verdict."
            headingTag="h3"
            density="dense"
          >
            {#snippet meta()}
              <StatusPill label={releaseBlockerLabel} tone={data.totals.blockingCount === 0 ? 'ok' : 'warn'} />
            {/snippet}
          </SectionHeader>
        {/snippet}

        <div class="summary-grid" aria-label="Current work closure summary counts">
          <div class="summary-stat">
            <span class="summary-label">Tasks done</span>
            <strong>{data.totals.tasks === 0 ? 'No tracked work' : `${data.totals.done}/${data.totals.tasks}`}</strong>
          </div>
          <div class="summary-stat">
            <span class="summary-label">Total closure blockers</span>
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
                label={dirtyCheckoutError ? 'inspection failed' : dirtyCheckoutCount > 0 ? `${dirtyCheckoutCount} Guildhall files dirty` : 'clean'}
                tone={dirtyCheckoutError || dirtyCheckoutCount > 0 ? 'warn' : 'ok'}
              />
            </div>
          {/if}
          {#if data.gitStory}
            <div class="summary-stat">
              <span class="summary-label">Git story</span>
              <StatusPill
                label={gitStoryBlockers.length > 0 ? `${gitStoryBlockers.length} unresolved` : 'closed'}
                tone={gitStoryBlockers.length > 0 ? 'warn' : 'ok'}
              />
            </div>
          {/if}
        </div>
        {#if data.dirtyCheckout && dirtyCheckoutCount > 0}
          <p class="dirty-detail">
            {dirtyCheckoutCount} project-local Guildhall {dirtyCheckoutCount === 1 ? 'file needs' : 'files need'} cleanup before the current work can close.
            Open diagnostics if you need the exact file list.
          </p>
        {:else if dirtyCheckoutError}
          <p class="dirty-detail">
            <strong>Could not inspect checkout</strong>. {checkoutInspectionError}
          </p>
        {/if}
        {#if gitStoryBlockers.length > 0}
          <div class="git-story-detail">
            <strong>Git story needs closure</strong>
            {#if gitStoryBlockers.length > visibleGitStoryBlockers.length}
              <p class="muted">Showing {visibleGitStoryBlockers.length} of {gitStoryBlockers.length} git stories.</p>
            {/if}
            <ul>
              {#each visibleGitStoryBlockers as blocker, index (`${blocker.id ?? 'git'}:${index}`)}
                {@const copy = gitBlockerCopy(blocker)}
                <li>
                  <span>{copy.label}</span>
                  {#if copy.detail}
                    <small>{copy.detail}</small>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
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
                <span class="crit-detail">How Guildhall knows which design rules apply here.</span>
              </span>
              <StatusPill label={dsLabel().label} tone={dsLabel().tone} />
            </div>
          </li>
          <li class="crit-row">
            <details class="crit-det" open={false}>
              <summary class="crit-summary" aria-disabled={gitStoryBlockers.length === 0}>
                <span class="crit-copy">
                  <span class="crit-label">Git story</span>
                  <span class="crit-detail">
                    {gitStoryBlockers.length === 0 ? 'No unresolved git stories.' : `${gitStoryBlockers.length} unresolved git stor${gitStoryBlockers.length === 1 ? 'y' : 'ies'}.`}
                  </span>
                </span>
                <StatusPill
                  label={gitStoryBlockers.length === 0 ? 'clear' : `${gitStoryBlockers.length} open`}
                  tone={gitStoryBlockers.length === 0 ? 'ok' : 'warn'}
                />
              </summary>
              {#if gitStoryBlockers.length > 0}
                {#if gitStoryBlockers.length > visibleGitStoryBlockers.length}
                  <p class="muted">Showing {visibleGitStoryBlockers.length} of {gitStoryBlockers.length} git stories.</p>
                {/if}
                <ul class="crit-items">
                  {#each visibleGitStoryBlockers as blocker, index (`${blocker.id ?? 'git'}:${index}`)}
                    {@const copy = gitBlockerCopy(blocker)}
                    <li>
                      {#if blocker.taskId}
                        <button type="button" class="link" onclick={() => openTask(blocker.taskId ?? '')}>
                          {copy.label}
                        </button>
                      {:else}
                        <span>{copy.label}</span>
                      {/if}
                      <span class="muted">{copy.detail}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </details>
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
              <StatusPill label={taskDoneLabel} tone="neutral" />
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
                  <td>{statusLabel(k)}</td>
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
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .summary-stat strong {
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
  }

  .dirty-detail {
    margin: var(--gh-space-3) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .git-story-detail {
    display: grid;
    gap: var(--gh-space-2);
    margin: var(--gh-space-3) 0 0;
    color: var(--text);
    font-size: var(--gh-type-size-body);
  }

  .git-story-detail ul {
    display: grid;
    gap: var(--gh-space-1);
    margin: 0;
    padding-inline-start: 1.1rem;
  }

  .git-story-detail li {
    display: grid;
    gap: 0.1rem;
  }

  .git-story-detail small {
    color: var(--text-muted);
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
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  .crit-detail {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
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
    font-size: var(--gh-type-size-body);
  }

  .tally td {
    padding: var(--gh-space-2) 0;
    border-top: 1px solid var(--border);
  }

  .tally tbody tr:first-child td {
    border-top: none;
  }

  @container (min-width: 42rem) {
    .summary-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
