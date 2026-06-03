<!--
  Work surface. List is the primary management view; Board is a secondary
  spatial view. Live activity belongs in Thread/project chrome so this stays
  a usable backlog management surface.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import ProgressFeed from '../../lib/ProgressFeed.svelte'
  import Select from '../../lib/Select.svelte'
  import SegmentedControl from '../../lib/SegmentedControl.svelte'
  import TaskCard from '../../lib/TaskCard.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import { friendlyDomain, friendlyPriority, friendlyStatus } from '../../lib/display.js'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../../lib/project-routes.js'
  import { buildWorkSurface } from '../../lib/project-data.js'
  import { friendlyRuntimeMessage } from '../../lib/runtime-message.js'
  import { effectiveWorkStatus, isCompleteForWorkerHandoff, needsWorkerHandoffSpecCleanup } from '../../lib/task-state.js'
  import { buildWorkHierarchy, nestedWorkCountLabel, workKindLabel } from '../../lib/work-hierarchy.js'
  import type { ProjectDetail, Task } from '../../lib/types.js'
  import PlannerTab from './PlannerTab.svelte'
  import WorkTreePreview from './WorkTreePreview.svelte'

  interface Props {
    detail: ProjectDetail
    mode?: 'list' | 'board'
  }

  type SortKey = 'title' | 'status' | 'area' | 'priority' | 'updated' | 'revisions'
  type SortDir = 'asc' | 'desc'
  type WorkView = 'columns' | 'list' | 'board'
  type WorkFilter = 'open' | 'all' | 'runnable' | 'blocked' | 'needs-you'

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
  const setupInboxItem = $derived.by(() => {
    const items = detail.inbox?.items ?? []
    const priority = [
      'required_migration',
      'setup_pending',
      'workspace_import_pending',
      'import_draft_queue',
    ]
    for (const kind of priority) {
      const match = items.find(item => item.kind === kind)
      if (match) return match
    }
    return items.find(item => item.actionHref === '/setup') ?? null
  })

  let progress = $state('Loading...')
  let sortKey = $state<SortKey>('updated')
  let sortDir = $state<SortDir>('desc')
  let routeWorkView = $state<WorkView>('list')
  let workFilter = $state<WorkFilter>('open')

  const viewOptions = [
    { value: 'columns', label: 'Columns' },
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
  ]

  const workFilterOptions = [
    { value: 'open', label: 'Open' },
    { value: 'all', label: 'All' },
    { value: 'runnable', label: 'Runnable' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'needs-you', label: 'Needs you' },
  ]

  const boardMode = $derived(mode === 'board')
  const activeWorkView = $derived<WorkView>(routeWorkView)
  const hierarchy = $derived(buildWorkHierarchy(tasks))
  const visibleTasks = $derived(tasks.filter(matchesWorkFilter))
  const boardDetail = $derived({
    ...detail,
    tasks: visibleTasks,
  } as ProjectDetail)

  const taskCounts = $derived.by(() => {
    const all = tasks
    const running = detail.run?.status === 'running'
    const readyTasks = all.filter(task => task.status === 'ready')
    return {
      total: all.length,
      agentActive: all.filter(task => running && ['in_progress', 'review', 'gate_check'].includes(task.status ?? '')).length,
      paused: all.filter(task => !running && task.status === 'in_progress').length,
      reviewWaiting: all.filter(task => !running && task.status === 'review').length,
      gatesWaiting: all.filter(task => !running && task.status === 'gate_check').length,
      shaping: all.filter(task => task.status === 'exploring').length,
      readyForWorker: readyTasks.filter(isCompleteForWorkerHandoff).length,
      needsSpecCleanup: readyTasks.filter(needsWorkerHandoffSpecCleanup).length,
      awaitingApproval: all.filter(task => task.status === 'spec_review').length,
      done: all.filter(task => ['done', 'pending_pr'].includes(task.status ?? '')).length,
    }
  })

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  const sortedTasks = $derived.by(() => {
    const list = [...visibleTasks]
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

  function effectiveStatus(task: Task): string | undefined {
    return effectiveWorkStatus(task, detail.run?.status === 'running')
  }

  function hasOpenQuestion(task: Task): boolean {
    return Boolean(task.openQuestions?.some(question => !question.answeredAt && !question.answer))
  }

  function matchesWorkFilter(task: Task): boolean {
    if (workFilter === 'all') return true
    if (workFilter === 'open') return !['done', 'pending_pr', 'shelved'].includes(task.status ?? '')
    if (workFilter === 'blocked') return task.status === 'blocked'
    if (workFilter === 'needs-you') return hasOpenQuestion(task)
    return ['ready', 'spec_review', 'review', 'gate_check'].includes(task.status ?? '')
  }

  function effectiveStatusLabel(task: Task): string {
    switch (effectiveStatus(task)) {
      case 'paused': return 'Paused'
      case 'review_waiting': return 'Review waiting'
      case 'gates_waiting': return 'Gates waiting'
      case 'needs_spec_cleanup': return 'Needs brief cleanup'
      default: return friendlyStatus(task.status)
    }
  }

  function effectiveStatusTone(task: Task): 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'agent' | 'agent-attention' {
    switch (effectiveStatus(task)) {
      case 'paused': return 'neutral'
      case 'review_waiting':
      case 'gates_waiting':
        return 'agent'
      case 'needs_spec_cleanup':
        return 'agent-attention'
      default:
        return statusTone(task.status)
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

  function listItemTone(task: Task): 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' {
    const tone = effectiveStatusTone(task)
    if (tone === 'agent' || tone === 'agent-attention') return 'accent'
    return tone
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
    const node = hierarchy.byId.get(task.id)
    const childCount = node?.childIds.length ?? 0
    if (childCount > 0) return nestedWorkCountLabel(childCount)
    if (task.workKind) return workKindLabel(task.workKind)
    if (task.blockReason) return friendlyRuntimeMessage(task.blockReason)
    if (task.terminalSummary?.headline) return task.terminalSummary.headline
    if (task.latestCheckpoint?.nextPlannedAction) return task.latestCheckpoint.nextPlannedAction
    if (task.description) return task.description
    return friendlyTaskId(task.id)
  }

  function hierarchyBreadcrumb(task: Task): string {
    const crumbs = hierarchy.byId.get(task.id)?.breadcrumb ?? []
    if (crumbs.length <= 1) return ''
    return crumbs.map(crumb => crumb.title).join(' / ')
  }

  $effect(() => {
    const projectId = detail.id ?? null
    progress = 'Loading...'
    projectFetch('/api/project/progress', undefined, projectId)
      .then(r => r.json())
      .then(j => {
        if (projectId !== (detail.id ?? null)) return
        progress = j.progress || '(empty)'
      })
      .catch(() => {
        if (projectId !== (detail.id ?? null)) return
        progress = '(failed to load)'
      })
  })

  $effect(() => {
    path.href
    path.value
    routeWorkView = readWorkViewFromUrl(boardMode)
  })

  function setWorkView(next: string) {
    if (next === 'columns') nav(currentProjectHref('/work?view=columns'))
    if (next === 'list') nav(currentProjectHref('/work?view=list'))
    if (next === 'board') nav(currentProjectHref('/work?view=board'))
  }

  function readWorkViewFromUrl(fallbackBoard: boolean): WorkView {
    if (fallbackBoard) return 'board'
    const params = new URL(window.location.href).searchParams
    const view = params.get('view')
    if (view === 'columns' || view === 'list' || view === 'board') return view
    if (params.get('tree') === 'preview') return 'columns'
    return 'list'
  }

  function onWorkFilterSelect(value: string): void {
    workFilter = value as WorkFilter
  }
</script>

<div class="work-list-view">
  <UtilityPanel as="div" className="work-view-header" tone="neutral" role="toolbar" ariaLabel="Work view controls">
    <SegmentedControl label="Work view" ariaLabel="Work view" value={activeWorkView} options={viewOptions} onChange={setWorkView} />
    <div class="work-view-actions">
      <div class="show-picker" role="group" aria-label="Shown work">
        <label for="work-view-show">Show</label>
        <Select id="work-view-show" value={workFilter} options={workFilterOptions} onchange={onWorkFilterSelect} />
      </div>
    </div>
  </UtilityPanel>

  {#if activeWorkView === 'board'}
    <PlannerTab detail={boardDetail} />
  {:else if activeWorkView === 'columns'}
    <WorkTreePreview tasks={tasks} filter={workFilter} />
  {:else}
    <Card title="Work list" titleTag="h2">

      <div class="work-list-overview">
        <div class="work-list-count">{visibleTasks.length} shown · {taskCounts.total} total</div>
        <div class="work-summary">
          {#if taskCounts.agentActive > 0}
            <Chip label={countLabel(taskCounts.agentActive, 'Guildhall working', 'Guildhall working')} tone="agent" />
          {/if}
          {#if taskCounts.paused > 0}
            <Chip label={countLabel(taskCounts.paused, 'paused task')} tone="neutral" />
          {/if}
          {#if taskCounts.reviewWaiting > 0}
            <Chip label={countLabel(taskCounts.reviewWaiting, 'review waiting', 'review waiting')} tone="warn" />
          {/if}
          {#if taskCounts.gatesWaiting > 0}
            <Chip label={countLabel(taskCounts.gatesWaiting, 'gates waiting', 'gates waiting')} tone="warn" />
          {/if}
          {#if taskCounts.shaping > 0}
            <Chip label={countLabel(taskCounts.shaping, 'being shaped', 'being shaped')} tone="agent" />
          {/if}
          {#if taskCounts.readyForWorker > 0}
            <Chip label={countLabel(taskCounts.readyForWorker, 'ready to start', 'ready to start')} tone="agent" />
          {/if}
          {#if taskCounts.needsSpecCleanup > 0}
            <Chip label={countLabel(taskCounts.needsSpecCleanup, 'need brief cleanup', 'need brief cleanup')} tone="agent-attention" />
          {/if}
          {#if taskCounts.awaitingApproval > 0}
            <Chip label={`${taskCounts.awaitingApproval} awaiting approval`} tone="warn" />
          {/if}
          {#if taskCounts.done > 0}
            <Chip label={`${taskCounts.done} done`} tone="ok" />
          {/if}
          {#if importDraftCount > 0}
            <Chip label={countLabel(importDraftCount, 'import draft')} tone="neutral" />
          {/if}
        </div>
      </div>

      {#if importDraftCount > 0 && nextImportDraft}
        <UtilityPanel as="div" className="draft-queue-card" tone="neutral">
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
            {nextImportDraft.id === 'task-workspace-import' ? 'Open import review' : 'Draft task brief'}
          </Button>
        </UtilityPanel>
      {/if}

      {#if tasks.length === 0}
        {#if needsMeta || setupInboxItem}
          <UtilityPanel as="div" className="setup-empty" tone="neutral">
            <p class="muted">{setupInboxItem?.detail ?? 'No tasks yet. Finish project setup first.'}</p>
            <Button variant="primary" size="sm" onclick={() => nav(currentProjectHref(setupInboxItem?.actionHref ?? '/setup'))}>
              {setupInboxItem?.kind === 'required_migration'
                ? 'Migrate project'
                : setupInboxItem?.kind === 'workspace_import_pending' || setupInboxItem?.kind === 'import_draft_queue'
                  ? 'Review import'
                  : 'Open setup'}
            </Button>
          </UtilityPanel>
        {:else}
          <p class="muted">No tasks yet — <strong>New thread</strong> to begin.</p>
        {/if}
      {:else}
        <CardList className="work-list-stack">
          <div class="list-column-head" aria-label="Sort work list">
            <button type="button" class:active={sortKey === 'title'} onclick={() => toggleSort('title')}>Task{sortLabel('title')}</button>
            <button type="button" class:active={sortKey === 'status'} onclick={() => toggleSort('status')}>Stage{sortLabel('status')}</button>
            <button type="button" class:active={sortKey === 'area'} onclick={() => toggleSort('area')}>Part{sortLabel('area')}</button>
            <button type="button" class:active={sortKey === 'priority'} onclick={() => toggleSort('priority')}>Priority{sortLabel('priority')}</button>
            <button type="button" class:active={sortKey === 'updated'} onclick={() => toggleSort('updated')}>Updated{sortLabel('updated')}</button>
            <button type="button" class:active={sortKey === 'revisions'} onclick={() => toggleSort('revisions')}>Revs{sortLabel('revisions')}</button>
          </div>
          {#each sortedTasks as task (task.id)}
            <CardListItem
              as="button"
              className="work-list-row"
              tone={listItemTone(task)}
              railTone={listItemTone(task) === 'neutral' ? 'neutral' : listItemTone(task)}
              railStrength="strong"
              ariaLabel={`Open task ${task.title ?? task.id}`}
              onclick={() => openTask(task)}
              onkeydown={(event) => onTaskKey(event, task)}
            >
              <span class="row-main">
                <span class="task-title">{task.title ?? '(untitled)'}</span>
                {#if hierarchyBreadcrumb(task)}
                  <span class="task-breadcrumb">{hierarchyBreadcrumb(task)}</span>
                {/if}
                <span class="task-subcopy">{taskSecondaryText(task)}</span>
              </span>
              <span class="row-status">
                <Chip label={effectiveStatusLabel(task)} tone={effectiveStatusTone(task)} />
              </span>
              <span class="row-domain">
                {friendlyDomain(task.domain) || 'Project'}
              </span>
              <span class="row-priority">
                <Chip label={friendlyPriority(task.priority)} tone={priorityTone(task.priority)} />
              </span>
              <span class="row-updated">
                {formatUpdatedAt(task.updatedAt)}
              </span>
              <span class="row-revisions">
                {task.revisionCount ?? 0}
              </span>
            </CardListItem>
          {/each}
        </CardList>
      {/if}
    </Card>
  {/if}

  <details class="progress-more progress-more--full">
    <summary>Recent progress</summary>
    <ProgressFeed {progress} {tasks} />
  </details>
</div>

<style>
  .work-list-view {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }
  :global(.work-view-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .work-view-actions {
    display: inline-flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gh-space-2);
    min-width: 0;
  }
  .show-picker {
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-2);
    white-space: nowrap;
  }
  .show-picker label {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .show-picker :global(.select) {
    min-width: 132px;
  }
  .work-list-overview {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .work-list-count {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    white-space: nowrap;
  }
  .work-summary {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--gh-space-2);
    min-width: 0;
  }
  :global(.setup-empty) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  :global(.setup-empty) p {
    margin: 0;
  }
  :global(.draft-queue-card) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-4);
    margin-bottom: var(--s-4);
  }
  .draft-queue-copy {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    min-width: 0;
  }
  .draft-queue-label {
    margin: 0;
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }
  .draft-queue-title {
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
  }
  .draft-queue-detail {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.work-list-stack) {
    --work-list-columns:
      minmax(220px, 1fr)
      minmax(160px, max-content)
      minmax(92px, 112px)
      minmax(84px, max-content)
      minmax(108px, max-content)
      32px;
    display: grid;
    grid-template-columns: var(--work-list-columns);
    gap: var(--gh-space-2);
  }
  .list-column-head {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    gap: var(--gh-space-2);
    padding: 0 var(--s-3);
  }
  .list-column-head button {
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.05em;
    line-height: var(--gh-type-line-height-tight);
    text-align: left;
    text-transform: uppercase;
    cursor: pointer;
  }
  .list-column-head button:nth-child(5),
  .list-column-head button:nth-child(6) {
    text-align: right;
  }
  .list-column-head button:hover,
  .list-column-head button.active {
    color: var(--text);
  }
  :global(.work-list-row) {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    gap: var(--gh-space-2);
    width: 100%;
    border-radius: var(--r-2);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  :global(.work-list-row:hover),
  :global(.work-list-row:focus-visible) {
    outline: none;
  }
  :global(.work-list-row) .row-main {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  :global(.work-list-row) .task-title {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
  }
  :global(.work-list-row) .task-subcopy {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--gh-type-size-meta);
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  :global(.work-list-row) .task-breadcrumb {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
  }
  :global(.work-list-row) .row-status,
  :global(.work-list-row) .row-domain,
  :global(.work-list-row) .row-priority,
  :global(.work-list-row) .row-updated,
  :global(.work-list-row) .row-revisions {
    min-width: 0;
  }
  :global(.work-list-row) .row-status,
  :global(.work-list-row) .row-priority {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
  }
  :global(.work-list-row) .row-domain {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :global(.work-list-row) .row-updated,
  :global(.work-list-row) .row-revisions {
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
    text-align: right;
    white-space: nowrap;
  }
  @supports not (grid-template-columns: subgrid) {
    .list-column-head,
    :global(.work-list-row) {
      grid-template-columns: var(--work-list-columns);
    }
  }
  .progress-more {
    align-self: stretch;
  }
  .progress-more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--gh-type-weight-strong);
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
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }

  @media (max-width: 860px) {
    :global(.work-view-header) {
      align-items: stretch;
      flex-direction: column;
    }
    .work-view-actions {
      justify-content: flex-start;
    }
    :global(.draft-queue-card) {
      flex-direction: column;
      align-items: stretch;
    }
    .work-list-overview {
      flex-direction: column;
      align-items: stretch;
    }
    .work-summary {
      justify-content: flex-start;
    }
    :global(.work-list-row) {
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
    }
    .list-column-head {
      display: flex;
      flex-wrap: wrap;
      gap: var(--gh-space-2);
      padding: 0;
    }
    :global(.work-list-row) .task-title {
      font-size: var(--gh-type-size-meta);
    }
    :global(.work-list-row) .task-subcopy {
      -webkit-line-clamp: 3;
    }
    :global(.work-list-row) .row-status,
    :global(.work-list-row) .row-priority {
      justify-content: flex-start;
    }
    :global(.work-list-row) .row-updated,
    :global(.work-list-row) .row-revisions {
      text-align: left;
    }
  }
</style>
