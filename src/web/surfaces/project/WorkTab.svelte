<!--
  Work surface. List is the primary management view; Board is a secondary
  spatial view. Live activity belongs in Thread/project chrome so this stays
  a usable backlog management surface.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import TaskCard from '../../lib/TaskCard.svelte'
  import { friendlyDomain, friendlyPriority, friendlyStatus } from '../../lib/display.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../../lib/project-routes.js'
  import { buildWorkSurface } from '../../lib/project-data.js'
  import type { ProjectDetail, Task } from '../../lib/types.js'
  import PlannerTab from './PlannerTab.svelte'

  interface Props {
    detail: ProjectDetail
    mode?: 'list' | 'board'
  }

  type SortKey = 'title' | 'status' | 'area' | 'priority' | 'updated' | 'revisions'
  type SortDir = 'asc' | 'desc'

  const STATUS_SORT_ORDER: Record<string, number> = {
    proposed: 0,
    exploring: 1,
    spec_review: 2,
    ready: 3,
    pending: 3,
    in_progress: 4,
    review: 5,
    gate_check: 6,
    blocked: 7,
    shelved: 8,
    pending_pr: 9,
    done: 10,
  }

  const PRIORITY_SORT_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  }

  let { detail, mode = 'list' }: Props = $props()

  const viewModel = $derived(buildWorkSurface(detail))
  const tasks = $derived<Task[]>(viewModel.tasks)
  const importDraftCount = $derived(viewModel.importDraftCount)
  const nextImportDraft = $derived(viewModel.nextImportDraft)
  const needsMeta = $derived(viewModel.needsMeta)

  let progress = $state('Loading...')
  let sortKey = $state<SortKey>('updated')
  let sortDir = $state<SortDir>('desc')

  const boardMode = $derived(mode === 'board')

  const taskCounts = $derived.by(() => {
    const all = tasks
    return {
      total: all.length,
      active: all.filter(task => ['exploring', 'in_progress', 'review', 'gate_check'].includes(task.status ?? '')).length,
      awaitingApproval: all.filter(task => task.status === 'spec_review').length,
      done: all.filter(task => ['done', 'pending_pr'].includes(task.status ?? '')).length,
    }
  })

  const sortedTasks = $derived.by(() => {
    const list = [...tasks]
    list.sort((left, right) => compareTasks(left, right, sortKey, sortDir))
    return list
  })

  function compareTasks(left: Task, right: Task, key: SortKey, dir: SortDir): number {
    const direction = dir === 'asc' ? 1 : -1
    const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })

    let delta = 0
    switch (key) {
      case 'title':
        delta = compareText(left.title ?? '', right.title ?? '')
        break
      case 'status':
        delta = (STATUS_SORT_ORDER[left.status ?? ''] ?? 99) - (STATUS_SORT_ORDER[right.status ?? ''] ?? 99)
        break
      case 'area':
        delta = compareText(friendlyDomain(left.domain), friendlyDomain(right.domain))
        break
      case 'priority':
        delta = (PRIORITY_SORT_ORDER[left.priority ?? 'normal'] ?? 99) - (PRIORITY_SORT_ORDER[right.priority ?? 'normal'] ?? 99)
        break
      case 'updated':
        delta = Date.parse(left.updatedAt ?? '') - Date.parse(right.updatedAt ?? '')
        break
      case 'revisions':
        delta = (left.revisionCount ?? 0) - (right.revisionCount ?? 0)
        break
    }

    if (delta === 0) {
      delta = compareText(left.title ?? '', right.title ?? '')
    }
    return delta * direction
  }

  function toggleSort(next: SortKey): void {
    if (sortKey === next) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc'
      return
    }
    sortKey = next
    sortDir = next === 'title' || next === 'area' ? 'asc' : 'desc'
  }

  function sortLabel(key: SortKey): string {
    if (sortKey !== key) return ''
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  function openTask(task: Task): void {
    nav(currentTaskHref(task.id), { backgroundPath: path.value })
  }

  function openImportedDraft(task: Task): void {
    if (task.id === 'task-workspace-import') {
      nav(currentProjectHref('/workspace-import'))
      return
    }
    openTask(task)
  }

  function onTaskKey(event: KeyboardEvent, task: Task): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openTask(task)
    }
  }

  function statusTone(status: string | undefined): 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' {
    switch (status) {
      case 'done':
        return 'ok'
      case 'blocked':
        return 'danger'
      case 'shelved':
      case 'pending_pr':
        return 'warn'
      case 'in_progress':
      case 'review':
      case 'gate_check':
        return 'accent'
      default:
        return 'neutral'
    }
  }

  function priorityTone(priority: string | undefined): 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' {
    switch (priority) {
      case 'critical':
        return 'danger'
      case 'high':
        return 'warn'
      case 'low':
        return 'ok'
      default:
        return 'neutral'
    }
  }

  function formatUpdatedAt(value: string | undefined): string {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  function taskSecondaryText(task: Task): string {
    if (task.blockReason) return task.blockReason
    if (task.terminalSummary?.headline) return task.terminalSummary.headline
    if (task.latestCheckpoint?.nextPlannedAction) return task.latestCheckpoint.nextPlannedAction
    if (task.description) return task.description
    return task.id
  }

  $effect(() => {
    projectFetch('/api/project/progress')
      .then(r => r.json())
      .then(j => {
        progress = j.progress || '(empty)'
      })
      .catch(() => {
        progress = '(failed to load)'
      })
  })

  function setMode(next: 'list' | 'board') {
    if (next === mode) return
    nav(next === 'board' ? currentProjectHref('/planner') : currentProjectHref('/work'))
  }
</script>

{#if boardMode}
  <Card title="Task board" titleTag="h2">
    {#snippet actions()}
      <div class="view-switch" role="tablist" aria-label="Work view mode">
        <Button
          variant={mode === 'list' ? 'primary' : 'secondary'}
          size="sm"
          onclick={() => setMode('list')}
          ariaLabel="List view"
        >
          List
        </Button>
        <Button
          variant={mode === 'board' ? 'primary' : 'secondary'}
          size="sm"
          onclick={() => setMode('board')}
          ariaLabel="Board view"
        >
          Board
        </Button>
      </div>
    {/snippet}

    <PlannerTab {detail} />
  </Card>

  <details class="progress-more progress-more--full">
    <summary>Recent progress</summary>
    <div class="progress">
      <Markdown source={progress} />
    </div>
  </details>
{:else}
  <div class="work-list-view">
    <Card title={`Work list (${taskCounts.total})`} titleTag="h2">
      {#snippet actions()}
        <div class="view-switch" role="tablist" aria-label="Work view mode">
          <Button
            variant={mode === 'list' ? 'primary' : 'secondary'}
            size="sm"
            onclick={() => setMode('list')}
            ariaLabel="List view"
          >
            List
          </Button>
          <Button
            variant={mode === 'board' ? 'primary' : 'secondary'}
            size="sm"
            onclick={() => setMode('board')}
            ariaLabel="Board view"
          >
            Board
          </Button>
        </div>
      {/snippet}

      <div class="work-summary">
        <Chip label={`${taskCounts.total} tasks`} tone="neutral" />
        <Chip label={`${taskCounts.active} active`} tone="accent" />
        <Chip label={`${taskCounts.awaitingApproval} awaiting approval`} tone="warn" />
        <Chip label={`${taskCounts.done} done`} tone="ok" />
        {#if importDraftCount > 0}
          <Chip label={`${importDraftCount} imported drafts`} tone="neutral" />
        {/if}
      </div>

      {#if importDraftCount > 0 && nextImportDraft}
        <div class="draft-queue-card">
          <div class="draft-queue-copy">
            <p class="draft-queue-label">Imported draft queue</p>
            <div class="draft-queue-title">{nextImportDraft.title ?? 'Imported draft'}</div>
            <p class="draft-queue-detail">
              {#if importDraftCount === 1}
                Review this imported draft and decide whether to shape it now.
              {:else}
                Start with "{nextImportDraft.title ?? 'Imported draft'}". {importDraftCount - 1} more drafts are queued behind it.
              {/if}
            </p>
          </div>
          <Button variant="secondary" size="sm" onclick={() => openImportedDraft(nextImportDraft)}>
            {nextImportDraft.id === 'task-workspace-import' ? 'Open import review' : 'Review next draft'}
          </Button>
        </div>
      {/if}

      {#if tasks.length === 0}
        {#if needsMeta}
          <p class="muted">No tasks yet — <strong>Bootstrap project</strong> first.</p>
        {:else}
          <p class="muted">No tasks yet — <strong>New task</strong> to begin.</p>
        {/if}
      {:else}
        <div class="task-table-wrap">
          <table class="task-table">
            <thead>
              <tr>
                <th><button type="button" class="sort-btn" onclick={() => toggleSort('title')}>Task{sortLabel('title')}</button></th>
                <th><button type="button" class="sort-btn" onclick={() => toggleSort('status')}>Stage{sortLabel('status')}</button></th>
                <th><button type="button" class="sort-btn" onclick={() => toggleSort('area')}>Part{sortLabel('area')}</button></th>
                <th><button type="button" class="sort-btn" onclick={() => toggleSort('priority')}>Priority{sortLabel('priority')}</button></th>
                <th class="col-revisions"><button type="button" class="sort-btn" onclick={() => toggleSort('revisions')}>Revisions{sortLabel('revisions')}</button></th>
                <th><button type="button" class="sort-btn align-end" onclick={() => toggleSort('updated')}>Updated{sortLabel('updated')}</button></th>
              </tr>
            </thead>
            <tbody>
              {#each sortedTasks as task (task.id)}
                <tr
                  class="task-row"
                  tabindex="0"
                  role="button"
                  aria-label={`Open task ${task.title ?? task.id}`}
                  onclick={() => openTask(task)}
                  onkeydown={(event) => onTaskKey(event, task)}
                >
                  <td class="cell-task">
                    <div class="task-title">{task.title ?? '(untitled)'}</div>
                    <div class="task-subcopy">{taskSecondaryText(task)}</div>
                  </td>
                  <td class="cell-status">
                    <Chip label={friendlyStatus(task.status)} tone={statusTone(task.status)} />
                  </td>
                  <td class="cell-steward">{friendlyDomain(task.domain) || 'Project'}</td>
                  <td class="cell-priority">
                    <Chip label={friendlyPriority(task.priority)} tone={priorityTone(task.priority)} />
                  </td>
                  <td class="cell-revisions">{task.revisionCount ?? 0}</td>
                  <td class="cell-updated">{formatUpdatedAt(task.updatedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </Card>

    <details class="progress-more progress-more--full">
      <summary>Recent progress</summary>
      <div class="progress">
        <Markdown source={progress} />
      </div>
    </details>
  </div>
{/if}

<style>
  .work-list-view {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }
  .view-switch {
    display: flex;
    gap: var(--s-2);
  }
  .work-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  .task-table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
  }
  .draft-queue-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    padding: var(--s-4);
    margin-bottom: var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
  }
  .draft-queue-copy {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .draft-queue-label {
    margin: 0;
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }
  .draft-queue-title {
    font-size: var(--fs-2);
    font-weight: 700;
    color: var(--text);
    line-height: var(--lh-tight);
  }
  .draft-queue-detail {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .task-table {
    width: 100%;
    border-collapse: collapse;
    min-width: 780px;
  }
  .task-table th,
  .task-table td {
    padding: var(--s-3);
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  .task-table tbody tr:last-child td {
    border-bottom: none;
  }
  .task-table th {
    background: var(--bg-raised-2);
    text-align: left;
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    font-weight: 700;
    white-space: nowrap;
  }
  .sort-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    font-weight: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    padding: 0;
    cursor: pointer;
  }
  .sort-btn:hover {
    color: var(--text);
  }
  .sort-btn.align-end {
    margin-left: auto;
  }
  .task-row {
    cursor: pointer;
    transition: background 140ms ease, box-shadow 140ms ease;
  }
  .task-row:hover,
  .task-row:focus-visible {
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-raised));
    outline: none;
    box-shadow: inset 3px 0 0 var(--stripe-accent);
  }
  .cell-task {
    min-width: 260px;
  }
  .task-title {
    font-size: var(--fs-2);
    font-weight: 700;
    color: var(--text);
    line-height: var(--lh-tight);
  }
  .task-subcopy {
    margin-top: 6px;
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .cell-status,
  .cell-priority,
  .cell-revisions,
  .cell-updated,
  .col-revisions {
    white-space: nowrap;
  }
  .cell-steward,
  .cell-updated,
  .cell-revisions {
    color: var(--text-muted);
    font-size: var(--fs-1);
  }
  .cell-updated {
    text-align: right;
  }
  .cell-revisions {
    text-align: center;
  }
  .progress-more {
    align-self: stretch;
  }
  .progress-more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    list-style: none;
    padding: var(--s-2) 0;
  }
  .progress-more > summary::-webkit-details-marker {
    display: none;
  }
  .progress-more > summary::before {
    content: '▸ ';
  }
  .progress-more[open] > summary::before {
    content: '▾ ';
  }
  .progress {
    max-height: 260px;
    overflow: auto;
    margin-top: var(--s-2);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }

  @media (max-width: 720px) {
    .draft-queue-card {
      flex-direction: column;
      align-items: stretch;
    }
    .task-table th,
    .task-table td {
      padding: var(--s-2);
    }
    .task-title {
      font-size: var(--fs-1);
    }
  }
</style>
