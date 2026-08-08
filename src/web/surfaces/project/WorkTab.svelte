<!--
  Work surface. List is the primary management view; Board is a secondary
  spatial view. Live activity belongs in Thread/project chrome so this stays
  a usable backlog management surface.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import { tick } from 'svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import ProgressFeed from '../../lib/ProgressFeed.svelte'
  import Select from '../../lib/Select.svelte'
  import SegmentedControl from '../../lib/SegmentedControl.svelte'
  import TaskCard from '../../lib/TaskCard.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import { friendlyPriority } from '../../lib/display.js'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../../lib/project-routes.js'
  import { sourceRefsSummary } from '../../lib/source-refs.js'
  import { taskGroundingDetail } from '../../lib/task-grounding.js'
  import { buildWorkSurface } from '../../lib/project-data.js'
  import { friendlyRuntimeMessage } from '../../lib/runtime-message.js'
  import { hasUnmetDependencies, unmetDependencyIds } from '../../lib/task-dependencies.js'
  import { isCompleteForWorkerHandoff, needsSourceRecoveryShaping, needsWorkerHandoffSpecCleanup } from '../../lib/task-state.js'
  import { taskStagePresentation, type TaskPresentationTone } from '../../lib/task-presentation.js'
  import { buildWorkHierarchy, nestedWorkCountLabel, workKindLabel } from '../../lib/work-hierarchy.js'
  import { deliveryProgressBadge, type DeliveryProgressBadge } from '../../lib/work-progress-display.js'
  import { orientationPathByWorkId } from '../../lib/orientation-paths.js'
  import { taskDisplayLabel, taskSourceQuestion } from '@guildhall/shared'
  import type { ProjectDetail, Task } from '../../lib/types.js'
  import PlannerTab from './PlannerTab.svelte'
  import WorkTreePreview from './WorkTreePreview.svelte'

  interface Props {
    detail: ProjectDetail
    mode?: 'list' | 'board'
  }

  type SortKey = 'title' | 'status' | 'area' | 'priority' | 'updated' | 'revisions'
  type SortDir = 'asc' | 'desc'
  type WorkView = 'list' | 'board'
  type WorkFilter = 'queued' | 'scope' | 'planning' | 'open' | 'all' | 'blocked' | 'needs-proof' | 'review' | 'needs-you'

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
  const importDrafts = $derived<Task[]>(viewModel.importDrafts)
  const importDraftCount = $derived(viewModel.importDraftCount)
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
  let workFilter = $state<WorkFilter>('queued')
  let partFilter = $state('all')
  let workFilterUserSelected = $state(false)
  let workFilterProjectId = $state<string | null>(null)
  let selectedWorkId = $state<string | null>(null)
  let runWorkBusyId = $state<string | null>(null)
  let runWorkActiveId = $state<string | null>(null)
  let runWorkError = $state<string | null>(null)
  let inventoryLoadBusy = $state(false)
  let pendingRouteScrollTaskId = $state<string | null>(null)
  const workRowEls = new Map<string, HTMLElement>()

  const viewOptions = [
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
  ]

  const workFilterOptions = [
    { value: 'queued', label: 'Ready to run' },
    { value: 'scope', label: 'Current scope' },
    { value: 'planning', label: 'Planning' },
    { value: 'open', label: 'Open' },
    { value: 'all', label: 'All' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'needs-proof', label: 'Needs proof' },
    { value: 'review', label: 'Review required' },
    { value: 'needs-you', label: 'Needs you' },
  ]

  const boardMode = $derived(mode === 'board')
  const activeWorkView = $derived<WorkView>(routeWorkView)
  const hierarchy = $derived(buildWorkHierarchy(tasks))
  const deliveryQueue = $derived(detail.deliverySpine?.queue ?? null)
  const orientationPaths = $derived(orientationPathByWorkId(detail.orientationSpine))
  const deliveryFirstRunnable = $derived(deliveryQueue?.firstRunnable ?? null)
  const projectRunning = $derived(detail.run?.status === 'running')
  const projectRunActive = $derived(detail.run?.status === 'running' || detail.run?.status === 'stopping')
  const deliveryReadyCount = $derived(deliveryQueue?.runnable?.length ?? 0)
  const selectedReleaseShipped = $derived(detail.releaseSummary?.release?.state === 'shipped')
  const scopeSourceSummary = $derived.by(() => {
    const rows = detail.orientationSpine?.scopeRows ?? []
    const refs = rows
      .filter(row => row.scope !== 'deferred')
      .flatMap(row => row.sourceRefs ?? [])
    return sourceRefsSummary(refs)
  })
  const scopeProofSummary = $derived.by(() => {
    const contracts = detail.orientationSpine?.proofContracts ?? []
    if (contracts.length === 0) return null
    const proven = contracts.filter(contract => contract.state === 'proven').length
    const missing = contracts.reduce((sum, contract) => sum + (contract.missing?.length ?? 0), 0)
    if (proven === 0 && missing === 0) return null
    return missing > 0
      ? `${countLabel(proven, 'proven item')} · ${countLabel(missing, 'missing proof', 'missing proof')}`
      : `${countLabel(proven, 'proven item')} · 0 missing proof`
  })
  const orientationScopeCounts = $derived.by(() => {
    const spine = detail.orientationSpine
    const summary = spine?.summary
    if (!summary) return null
    const includedRows = spine?.scopeRows?.filter(row => row.scope === 'included') ?? []
    const deferredRows = spine?.scopeRows?.filter(row => row.scope === 'deferred') ?? []
    const current = summary.includedWorkCount ?? summary.includedCount ?? includedRows.length
    const deferred = summary.deferredWorkCount ?? summary.deferredCount ?? deferredRows.length
    const blocked = summary.progress?.blocked ?? includedRows.filter(row => row.blocksRelease || row.blocksStart).length
    const title = summary.headline ?? summary.selectedScopeLabel ?? spine?.scope?.label ?? 'Current task scope'
    const nextAction = typeof summary.nextAction === 'string'
      ? summary.nextAction
      : summary.nextAction?.label
    return {
      current,
      blocked,
      deferred,
      title,
      detail: nextAction ?? 'Open the current scoped work to inspect its current and deferred items.',
    }
  })
  const proofMissingTaskIds = $derived.by(() => {
    const ids = detail.startReadiness?.proofTaskIds ?? []
    if (ids.length > 0) return new Set(ids.filter(Boolean))
    if (detail.startReadiness?.code === 'proof_evidence_missing' && detail.startReadiness.focusTaskId) {
      return new Set([detail.startReadiness.focusTaskId])
    }
    return new Set<string>()
  })
  const scopeTaskIds = $derived.by(() => {
    const ids = (detail.orientationSpine?.scopeRows ?? [])
      .map(row => row.taskId)
      .filter((id): id is string => Boolean(id))
    return new Set(ids)
  })
  // This set comes from the same selected-release snapshot that produced the
  // primary Review action. Work only presents it; it never re-decides who is
  // reviewable from task prose or a route-local status scan.
  const ownerReviewTaskIds = $derived.by(() => new Set(detail.startReadiness?.reviewTaskIds ?? []))
  const scopeByTaskId = $derived.by(() => {
    const entries = (detail.orientationSpine?.scopeRows ?? [])
      .filter((row): row is typeof row & { taskId: string } => Boolean(row.taskId))
      .map(row => [row.taskId, row.scope] as const)
    return new Map(entries)
  })
  const scopeRowByTaskId = $derived.by(() => {
    const entries = (detail.orientationSpine?.scopeRows ?? [])
      .filter((row): row is typeof row & { taskId: string } => Boolean(row.taskId))
      .map(row => [row.taskId, row] as const)
    return new Map(entries)
  })
  const releaseBlockerTaskIds = $derived.by(() => {
    const taskIds = new Set((detail.tasks ?? []).map(task => task.id))
    return new Set((detail.releaseReadiness?.releaseBlockers ?? [])
      .map(blocker => blocker.id)
      .filter((id): id is string => Boolean(id && taskIds.has(id))))
  })
  const releaseBlockerRankByTaskId = $derived.by(() => {
    const taskIds = new Set((detail.tasks ?? []).map(task => task.id))
    const entries = (detail.releaseReadiness?.releaseBlockers ?? [])
      .map((blocker, index) => ({ id: blocker.id, index }))
      .filter((entry): entry is { id: string; index: number } => Boolean(entry.id && taskIds.has(entry.id)))
      .map(entry => [entry.id, entry.index] as const)
    return new Map(entries)
  })
  const proofMissingCount = $derived(proofMissingTaskIds.size || (detail.startReadiness?.code === 'proof_evidence_missing' ? detail.startReadiness.count ?? 0 : 0))
  const deliveryPrimitiveBlockers = $derived.by(() => {
    return deliveryQueue?.blocked
      ?.flatMap(candidate => candidate.structuralBlockers ?? [])
      .filter((primitive, index, all) => primitive.id && all.findIndex(item => item.id === primitive.id) === index)
      .slice(0, 5) ?? []
  })
  const scopeQueueFallback = $derived.by(() => {
    if (deliveryFirstRunnable) return null
    const orientationCounts = orientationScopeCounts
    const scopeLabel = detail.orientationSpine?.summary?.selectedScopeLabel ?? detail.orientationSpine?.scope?.label
    if (!scopeLabel) return null
    const primaryAction = detail.actionModel?.primaryAction
    if (orientationCounts) {
      if (orientationCounts.current + orientationCounts.blocked + orientationCounts.deferred + proofMissingCount <= 0) return null
      return {
        label: scopeLabel,
        title: primaryAction?.label ?? orientationCounts.title,
        detail: primaryAction?.detail ?? orientationCounts.detail,
        current: orientationCounts.current,
        blocked: orientationCounts.blocked,
        proofMissing: proofMissingCount,
        deferred: orientationCounts.deferred,
      }
    }
    const counts = detail.workProgress?.counts
    if (!counts) return null
    if (counts.visibleActive + counts.visibleBlocked + counts.visibleShelved <= 0) return null
    return {
      label: scopeLabel,
      title: primaryAction?.label ?? scopeLabel,
      detail: primaryAction?.detail ?? detail.orientationSpine?.summary?.nextAction ?? 'Open the current scoped work to continue shaping it.',
      current: counts.visibleActive,
      blocked: counts.visibleBlocked,
      proofMissing: proofMissingCount,
      deferred: counts.visibleShelved,
    }
  })
  const allWorkItems = $derived([...tasks, ...importDrafts])
  const workAreasByTaskId = $derived(viewModel.workAreasByTaskId)
  const workAreaOptions = $derived(viewModel.workAreaOptions)
  const showsPlanningArtifacts = $derived(['scope', 'planning', 'open', 'all'].includes(workFilter))
  const filterableTasks = $derived(showsPlanningArtifacts ? allWorkItems : tasks)
  const visibleTasks = $derived(filterableTasks.filter(matchesWorkFilter))
  const partFilterOptions = $derived.by(() => {
    const visibleIds = new Set(allWorkItems.map(task => workAreaForTask(task).id))
    const parts = workAreaOptions
      .filter(area => area.id !== 'project' && visibleIds.has(area.id))
      .map(area => ({ value: area.id, label: area.label }))
    return [{ value: 'all', label: 'All parts' }, ...parts]
  })
  const visibleImportDrafts = $derived(importDrafts.filter(task => partFilter === 'all' || workAreaForTask(task).id === partFilter))
  const visibleImportDraftCount = $derived(showsPlanningArtifacts ? visibleImportDrafts.length : 0)
  const nextImportDraft = $derived(visibleImportDrafts[0] ?? null)
  const selectedWork = $derived(selectedWorkId ? allWorkItems.find(task => task.id === selectedWorkId) ?? null : null)
  const inventoryPage = $derived(detail.taskPayload?.surface === 'work' ? detail.taskPayload : null)
  const effectiveRunActiveId = $derived(runWorkActiveId ?? (
    projectRunActive && selectedWork && isActiveWorkTask(selectedWork) ? selectedWork.id : null
  ))
  const boardDetail = $derived({
    ...detail,
    tasks: visibleTasks,
  } as ProjectDetail)

  const taskCounts = $derived.by(() => {
    const all = visibleTasks
    const running = detail.run?.status === 'running'
    const readyTasks = all.filter(task => task.status === 'ready' && !hasUnmetDependencies(task, tasks))
    const stageCounts = all.reduce<Record<string, number>>((counts, task) => {
      const key = taskPresentation(task).key
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    }, {})
    return {
      total: filterableTasks.length,
      agentActive: all.filter(task => running && ['in_progress', 'review', 'gate_check'].includes(task.status ?? '')).length,
      paused: stageCounts.paused ?? 0,
      waiting: stageCounts.waiting_dependency ?? 0,
      reviewWaiting: stageCounts.review_waiting ?? 0,
      gatesWaiting: stageCounts.gates_waiting ?? 0,
      shaping: stageCounts.guildhall_shaping ?? 0,
      specRevisionQueued: stageCounts.spec_revision_queued ?? 0,
      readyForWorker: readyTasks.filter(isCompleteForWorkerHandoff).length,
      needsSpecCleanup: readyTasks.filter(needsWorkerHandoffSpecCleanup).length,
      awaitingApproval: (stageCounts.brief_review ?? 0) + (stageCounts.spec_review ?? 0),
      done: all.filter(task => ['done', 'pending_pr'].includes(task.status ?? '')).length,
    }
  })
  const scopeVisibleCounts = $derived.by(() => {
    return visibleTasks.reduce(
      (counts, task) => {
        if (scopeByTaskId.get(task.id) === 'deferred') counts.deferred += 1
        else counts.current += 1
        return counts
      },
      { current: 0, deferred: 0 },
    )
  })
  const workListCountLabel = $derived.by(() => {
    if (workFilter !== 'scope') return `${visibleTasks.length} shown · ${taskCounts.total} total`
    const pieces = [
      countLabel(scopeVisibleCounts.current, 'current item'),
      countLabel(scopeVisibleCounts.deferred, 'deferred item'),
    ]
    return `${pieces.join(' · ')} · ${taskCounts.total} total`
  })

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  const sortedTasks = $derived.by(() => {
    const list = [...visibleTasks]
    list.sort((left, right) => {
      if (workFilter === 'scope') {
        const scopeDelta = compareScopedTasks(left, right)
        if (scopeDelta !== 0) return scopeDelta
      }
      return compareTasks(left, right, sortKey, sortDir)
    })
    return list
  })
  const selectedWorkVisible = $derived(Boolean(selectedWorkId && allWorkItems.some(task => task.id === selectedWorkId)))

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
        delta = compareText(workAreaForTask(left).label, workAreaForTask(right).label)
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

  function compareScopedTasks(left: Task, right: Task): number {
    const delta = scopeTaskRank(left) - scopeTaskRank(right)
    if (delta !== 0) return delta
    return 0
  }

  function scopeTaskRank(task: Task): number {
    const row = scopeRowByTaskId.get(task.id)
    if (!row) return 50
    if (row.scope === 'deferred') return 40
    if (detail.startReadiness?.focusTaskId === task.id) return 0
    const releaseBlockerRank = releaseBlockerRankByTaskId.get(task.id)
    if (typeof releaseBlockerRank === 'number') return 1 + releaseBlockerRank
    if (releaseBlockerTaskIds.has(task.id) || row.blocksStart || row.blocksRelease || row.humanBlocking) return 10
    if (!['done', 'pending_pr'].includes(task.status ?? '')) return 10
    return 20
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

  async function postTaskAction(taskId: string, action: string, body: Record<string, unknown>): Promise<Response> {
    return projectFetch(`/api/project/task/${encodeURIComponent(taskId)}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, detail.id)
  }

  async function runWorkItem(taskId: string): Promise<void> {
    runWorkBusyId = taskId
    runWorkError = null
    try {
      const task = allWorkItems.find(item => item.id === taskId)
      if (task?.status === 'import_draft' || (task && needsSourceRecoveryShaping(task))) {
        const shapeRes = await postTaskAction(taskId, 'shape-draft', { projectId: detail.id })
        if (!shapeRes.ok) {
          const body = await shapeRes.json().catch(() => ({})) as { error?: string }
          runWorkError = body.error ?? `Draft failed (HTTP ${shapeRes.status})`
          return
        }
      }
      if (task && isProofMissingTask(task)) {
        const retryRes = await postTaskAction(taskId, 'retry-work', {
          projectId: detail.id,
          instruction: 'Recover the missing release proof for this completed work item. Do not treat the task as complete again until the expected proof evidence is recorded.',
        })
        if (!retryRes.ok) {
          const body = await retryRes.json().catch(() => ({})) as { error?: string }
          runWorkError = body.error ?? `Proof recovery failed (HTTP ${retryRes.status})`
          return
        }
      }
      const res = await postTaskAction(taskId, 'start', { projectId: detail.id, mode: 'one_task', scope: 'work_item' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        runWorkError = body.error ?? `Start failed (HTTP ${res.status})`
        return
      }
      runWorkActiveId = taskId
      await project.refresh(detail.id)
      setTimeout(() => void project.refresh(detail.id), 500)
      setTimeout(() => void project.refresh(detail.id), 1800)
    } finally {
      runWorkBusyId = null
    }
  }

  function selectWork(task: Task): void {
    selectedWorkId = task.id
    runWorkError = null
  }

  function selectWorkById(taskId: string): void {
    if (allWorkItems.some(task => task.id === taskId)) {
      selectedWorkId = taskId
      runWorkError = null
    }
  }

  async function loadMoreWork(): Promise<void> {
    const projectId = detail.id
    const nextOffset = inventoryPage?.nextOffset
    if (!projectId || !inventoryPage?.hasMore || typeof nextOffset !== 'number' || inventoryLoadBusy) return
    inventoryLoadBusy = true
    try {
      await project.refresh(projectId, 'work', selectedWorkId, { inventoryOffset: nextOffset })
    } finally {
      inventoryLoadBusy = false
    }
  }

  function setWorkRowElement(taskId: string, node: HTMLElement | null): void {
    if (node) {
      workRowEls.set(taskId, node)
    } else {
      workRowEls.delete(taskId)
    }
  }

  async function scrollWorkRowIntoView(taskId: string): Promise<void> {
    await tick()
    workRowEls.get(taskId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  function workFilterForTask(task: Task): WorkFilter {
    if (isProofMissingTask(task)) return 'needs-proof'
    if (task.status === 'blocked') return 'blocked'
    if (isSelectedScopeOwnerReview(task)) return 'review'
    if (hasOpenQuestion(task)) return 'needs-you'
    if (isQueuedWorkTask(task)) return 'queued'
    if (isPlanningTask(task)) return 'planning'
    return 'open'
  }

  function taskProgress(task: Task) {
    const id = typeof task.id === 'string' ? task.id : ''
    return id ? detail.workProgress?.byTaskId?.[id] : null
  }

  function semanticUnitCount(task: Task): number {
    return task.workUnitCount ?? task.workUnitAnalysis?.units?.length ?? 0
  }

  function dependencyLabel(taskId: string): string {
    const dependency = tasks.find(candidate => candidate.id === taskId)
    return dependency ? taskDisplayLabel(dependency) : friendlyTaskId(taskId)
  }

  function taskDeliveryBadge(task: Task): DeliveryProgressBadge | null {
    const childCount = hierarchy.byId.get(task.id)?.childIds.length ?? 0
    const semanticUnits = semanticUnitCount(task)
    if (childCount === 0 && semanticUnits > 0 && isPlanningTask(task)) {
      return {
        label: `${semanticUnits} planned ${semanticUnits === 1 ? 'unit' : 'units'}`,
        title: `${semanticUnits} semantic work ${semanticUnits === 1 ? 'unit is' : 'units are'} already shaped for this task before proof steps begin.`,
        tone: 'neutral',
      }
    }
    return deliveryProgressBadge(taskProgress(task))
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
      selectWork(task)
    }
  }

  function hasOpenQuestion(task: Task): boolean {
    return Boolean(task.openQuestions?.some(question => !question.answeredAt && !question.answer))
  }

  function isSelectedScopeOwnerReview(task: Task): boolean {
    return ownerReviewTaskIds.has(task.id)
  }

  function isQueuedWorkTask(task: Task): boolean {
    if (hasUnmetDependencies(task, tasks)) return false
    if (task.status === 'ready') return isCompleteForWorkerHandoff(task)
    return ['in_progress', 'review', 'gate_check'].includes(task.status ?? '')
  }

  function isActiveWorkTask(task: Task): boolean {
    return ['in_progress', 'review', 'gate_check'].includes(task.status ?? '')
  }

  function isPlanningTask(task: Task): boolean {
    if (task.status === 'ready') return needsWorkerHandoffSpecCleanup(task)
    return ['proposed', 'import_draft', 'exploring', 'spec_review'].includes(task.status ?? '')
  }

  function emptyFilterTitle(): string {
    if (selectedReleaseShipped && workFilter === 'open') return 'Release work is complete.'
    if (workFilter === 'queued') return 'No work is ready to run yet.'
    if (workFilter === 'scope') return 'No current-scope work is visible yet.'
    if (workFilter === 'planning') return 'No planning work.'
    if (workFilter === 'blocked') return 'No blocked work.'
    if (workFilter === 'needs-proof') return 'No proof gaps.'
    if (workFilter === 'review') return 'No selected-scope reviews are waiting.'
    if (workFilter === 'needs-you') return 'Nothing needs you.'
    return 'No matching work.'
  }

  function emptyFilterDetail(): string {
    if (selectedReleaseShipped && workFilter === 'open') return 'This release has shipped. Completed work stays available when you need the record.'
    if (workFilter === 'queued') return 'Planning and review work is still waiting. Use Planning to inspect intake and spec work.'
    if (workFilter === 'scope') return 'Current and deferred scope rows will appear here once Guildhall maps them to work records.'
    if (workFilter === 'planning') return 'Planning, intake, and spec items will appear here while they are being shaped.'
    if (workFilter === 'blocked') return 'Blocked work will appear here once a task cannot continue.'
    if (workFilter === 'needs-proof') return 'Completed work with missing release proof will appear here.'
    if (workFilter === 'review') return 'Owner-held specs in the selected release will appear here when review is required.'
    if (workFilter === 'needs-you') return 'Questions and owner-held work will appear here when input is needed.'
    return 'Adjust the filter to inspect a different slice of the project.'
  }

  function emptyFilterAction(): { label: string; filter: WorkFilter } | null {
    if (selectedReleaseShipped && workFilter === 'open') return { label: 'Show completed work', filter: 'scope' }
    if (workFilter === 'queued' && allWorkItems.some(isPlanningTask)) return { label: 'Show planning', filter: 'planning' }
    if (workFilter !== 'queued') return { label: 'Show queued work', filter: 'queued' }
    return null
  }

  function matchesWorkFilter(task: Task): boolean {
    if (partFilter !== 'all' && workAreaForTask(task).id !== partFilter) return false
    if (workFilter === 'all') return true
    if (workFilter === 'scope') return scopeTaskIds.has(task.id)
    if (workFilter === 'queued') return isQueuedWorkTask(task)
    if (workFilter === 'planning') return isPlanningTask(task)
    if (workFilter === 'open') return !['done', 'pending_pr', 'shelved'].includes(task.status ?? '')
    if (workFilter === 'blocked') return task.status === 'blocked'
    if (workFilter === 'needs-proof') return isProofMissingTask(task)
    if (workFilter === 'review') return isSelectedScopeOwnerReview(task)
    if (workFilter === 'needs-you') return hasOpenQuestion(task)
    return false
  }

  function defaultWorkFilterForTasks(): WorkFilter {
    if (selectedReleaseShipped) return 'open'
    if (scopeTaskIds.size > 0) return 'scope'
    if (tasks.some(isQueuedWorkTask)) return 'queued'
    if (tasks.some(isPlanningTask)) return 'planning'
    if (tasks.some(task => task.status === 'blocked')) return 'blocked'
    if (tasks.some(isProofMissingTask)) return 'needs-proof'
    if (tasks.length > 0) return 'all'
    return 'queued'
  }

  function isProofMissingTask(task: Task): boolean {
    return proofMissingTaskIds.has(task.id)
  }

  function workAreaForTask(task: Task) {
    return workAreasByTaskId[task.id] ?? {
      id: 'project',
      label: 'Project',
      kind: 'project',
      source: 'fallback',
      confidence: 'fallback',
    }
  }

  function taskPresentation(task: Task) {
    return taskStagePresentation(task, {
      runStatus: detail.run?.status,
      availabilityStatus: detail.availability?.status ?? 'active',
      tasks,
      focusTaskId: detail.startReadiness?.focusTaskId,
      focusKind: detail.startReadiness?.focusKind,
    })
  }

  type ChipTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral' | 'running'
  type CardTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'

  function chipTone(tone: TaskPresentationTone): ChipTone {
    return tone
  }

  function effectiveStatusLabel(task: Task): string {
    return needsBreakdownReview(task) ? 'Review breakdown' : taskPresentation(task).label
  }

  function effectiveStatusTone(task: Task): ChipTone {
    return needsBreakdownReview(task) ? 'warn' : chipTone(taskPresentation(task).tone)
  }

  function priorityTone(priority: string | undefined): CardTone {
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

  function listItemTone(task: Task): CardTone {
    const tone = effectiveStatusTone(task)
    return tone === 'running' ? 'accent' : tone
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
    if (needsBreakdownReview(task)) {
      const count = task.acceptanceCriteriaCount ?? task.acceptanceCriteria?.length ?? 0
      return `${count} requirements; no contained work or decomposition proposal yet.`
    }
    const blockers = unmetDependencyIds(task, tasks)
    if (blockers.length > 0) {
      const prefix = task.status === 'blocked' ? 'Blocked by' : 'Waiting on'
      return `${prefix} ${blockers.map(dependencyLabel).join(', ')}`
    }
    const semanticUnits = semanticUnitCount(task)
    if (childCount === 0 && semanticUnits > 0 && isPlanningTask(task)) {
      return `${semanticUnits} planned work ${semanticUnits === 1 ? 'unit' : 'units'} already shaped.`
    }
    if (task.workKind) return workKindLabel(task.workKind)
    if (task.blockReason) return friendlyRuntimeMessage(task.blockReason)
    if (task.terminalSummary?.headline) return task.terminalSummary.headline
    if (task.latestCheckpoint?.nextPlannedAction) return task.latestCheckpoint.nextPlannedAction
    const grounding = taskGroundingDetail(task)
    if (grounding) return grounding
    if (taskSourceQuestion(task)) return taskSourceQuestion(task)!
    if (task.description) return task.description
    return friendlyTaskId(task.id)
  }

  function primitiveLabel(primitive: { id?: string; label?: string }): string {
    return primitive.label?.trim() || primitive.id || 'Primitive'
  }

  function orientationPathForTask(task: Task): string {
    return orientationPaths.get(task.id) ?? ''
  }

  function hierarchyBreadcrumb(task: Task): string {
    const orientationPath = orientationPathForTask(task)
    if (orientationPath) return orientationPath
    const crumbs = hierarchy.byId.get(task.id)?.breadcrumb ?? []
    if (crumbs.length <= 1) return ''
    return crumbs.map(crumb => crumb.title).join(' / ')
  }

  function needsBreakdownReview(task: Task): boolean {
    const node = hierarchy.byId.get(task.id)
    const childCount = node?.childIds.length ?? 0
    return task.status === 'ready' &&
      childCount === 0 &&
      !hasDecompositionProposal(task) &&
      (task.acceptanceCriteriaCount ?? task.acceptanceCriteria?.length ?? 0) >= 6
  }

  function hasDecompositionProposal(task: Task): boolean {
    const decomposition = (task as Task & { decomposition?: unknown }).decomposition
    if (!decomposition) return false
    if (Array.isArray(decomposition)) return decomposition.length > 0
    if (typeof decomposition === 'object') return Object.keys(decomposition).length > 0
    return true
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
    if (next === 'list') nav(currentProjectHref('/work?view=list'))
    if (next === 'board') nav(currentProjectHref('/work?view=board'))
  }

  function readWorkViewFromUrl(fallbackBoard: boolean): WorkView {
    if (fallbackBoard) return 'board'
    const params = new URL(window.location.href).searchParams
    const view = params.get('view')
    if (view === 'list' || view === 'board') return view
    return 'list'
  }

  function readSelectedWorkIdFromUrl(): string | null {
    const params = new URL(window.location.href).searchParams
    return params.get('task') ?? params.get('work') ?? null
  }

  function onWorkFilterSelect(value: string): void {
    workFilterUserSelected = true
    workFilter = value as WorkFilter
  }

  $effect(() => {
    const projectId = detail.id ?? null
    const taskSignature = tasks.map(task => `${task.id}:${task.status ?? ''}:${(task.dependsOn ?? []).join(',')}`).join('|')
    taskSignature
    if (projectId !== workFilterProjectId) {
      workFilterProjectId = projectId
      workFilterUserSelected = false
      partFilter = 'all'
    }
    if (!workFilterUserSelected) {
      workFilter = defaultWorkFilterForTasks()
    }
  })

  $effect(() => {
    path.href
    path.value
    const routeTaskId = readSelectedWorkIdFromUrl()
    if (!routeTaskId) return
    const routeTask = allWorkItems.find(task => task.id === routeTaskId)
    if (!routeTask) return
    selectedWorkId = routeTaskId
    runWorkError = null
    workFilter = workFilterForTask(routeTask)
    workFilterUserSelected = true
    partFilter = 'all'
    pendingRouteScrollTaskId = routeTaskId
  })

  $effect(() => {
    const taskId = pendingRouteScrollTaskId
    if (!taskId || selectedWorkId !== taskId || !sortedTasks.some(task => task.id === taskId)) return
    pendingRouteScrollTaskId = null
    void scrollWorkRowIntoView(taskId)
  })

  $effect(() => {
    if (!selectedWorkVisible) selectedWorkId = null
  })

  $effect(() => {
    if (!projectRunActive) runWorkActiveId = null
  })
</script>

<div class="work-list-view">
  <UtilityPanel as="div" className="work-view-header" tone="neutral" role="toolbar" ariaLabel="Work view controls">
    <SegmentedControl label="Work view" ariaLabel="Work view" value={activeWorkView} options={viewOptions} onChange={setWorkView} />
    <div class="work-view-actions">
      <div class="show-picker" role="group" aria-label="Shown work">
        <label for="work-view-show">Show</label>
        <Select id="work-view-show" value={workFilter} options={workFilterOptions} onchange={onWorkFilterSelect} />
      </div>
      {#if partFilterOptions.length > 2}
        <div class="show-picker" role="group" aria-label="Work part">
          <label for="work-view-part">Part</label>
          <Select id="work-view-part" value={partFilter} options={partFilterOptions} onchange={(value) => { partFilter = value }} />
        </div>
      {/if}
    </div>
  </UtilityPanel>

  {#if activeWorkView === 'board'}
    <PlannerTab detail={boardDetail} />
  {:else}
    {#if deliveryQueue}
      <UtilityPanel as="section" className="delivery-queue-panel" tone={deliveryFirstRunnable ? 'ok' : scopeQueueFallback ? 'warn' : deliveryQueue.blocked?.length ? 'warn' : 'neutral'} ariaLabel="Delivery queue">
        <div class="queue-copy">
          <p class="queue-label">{scopeQueueFallback?.label ?? 'Delivery queue'}</p>
          <div class="queue-main">
            <strong>{deliveryFirstRunnable?.task ? taskDisplayLabel(deliveryFirstRunnable.task, deliveryFirstRunnable.task.id) : scopeQueueFallback?.title ?? 'No runnable task'}</strong>
            {#if deliveryFirstRunnable?.why}
              <span>{projectRunning ? deliveryFirstRunnable.why : 'Ready when resumed.'}</span>
            {:else if scopeQueueFallback?.detail}
              <span>{scopeQueueFallback.detail}</span>
            {/if}
          </div>
          {#if scopeSourceSummary}
            <p class="queue-sources">Sources: {scopeSourceSummary}</p>
          {/if}
          {#if scopeProofSummary}
            <p class="queue-sources">Proof: {scopeProofSummary}</p>
          {/if}
          <div class="queue-chips">
            {#if scopeQueueFallback}
              {#if scopeQueueFallback.current > 0 || scopeQueueFallback.proofMissing === 0}
                <Chip label={countLabel(scopeQueueFallback.current, 'current task')} tone="accent" />
              {/if}
              {#if scopeQueueFallback.blocked > 0 || scopeQueueFallback.proofMissing === 0}
                <Chip label={`${scopeQueueFallback.blocked} blocked`} tone={scopeQueueFallback.blocked ? 'warn' : 'neutral'} />
              {/if}
              {#if scopeQueueFallback.proofMissing > 0}
                <Chip label={countLabel(scopeQueueFallback.proofMissing, 'need proof', 'need proof')} tone="warn" />
              {/if}
              <Chip label={countLabel(scopeQueueFallback.deferred, 'deferred', 'deferred')} tone="neutral" />
            {:else}
              <Chip label={projectRunning ? `${deliveryReadyCount} runnable` : `${deliveryReadyCount} ready to resume`} tone={deliveryFirstRunnable ? 'ok' : 'neutral'} />
              <Chip label={`${deliveryQueue.blocked?.length ?? 0} waiting on dependencies`} tone={deliveryQueue.blocked?.length ? 'warn' : 'neutral'} />
              {#each deliveryPrimitiveBlockers as primitive (`primitive-${primitive.id}`)}
                <Chip label={primitiveLabel(primitive)} tone="warn" />
              {/each}
            {/if}
          </div>
        </div>
      </UtilityPanel>
    {/if}
    <div class="work-list-inspector-layout" class:has-selection={Boolean(selectedWorkId)}>
      <Card title="Work list" titleTag="h2">

        <div class="work-list-overview">
          <div class="work-list-count">{workListCountLabel}</div>
          <div class="work-summary">
            {#if taskCounts.agentActive > 0}
              <Chip label={countLabel(taskCounts.agentActive, 'Working', 'Working')} tone="running" />
            {/if}
            {#if taskCounts.paused > 0}
              <Chip label={countLabel(taskCounts.paused, 'paused task')} tone="neutral" />
            {/if}
            {#if taskCounts.waiting > 0}
              <Chip label={countLabel(taskCounts.waiting, 'waiting task')} tone="warn" />
            {/if}
            {#if taskCounts.reviewWaiting > 0}
              <Chip label={countLabel(taskCounts.reviewWaiting, 'Review', 'Review')} tone="warn" />
            {/if}
            {#if taskCounts.gatesWaiting > 0}
              <Chip label={countLabel(taskCounts.gatesWaiting, 'Gates', 'Gates')} tone="warn" />
            {/if}
            {#if taskCounts.shaping > 0}
              <Chip label={countLabel(taskCounts.shaping, 'Queued', 'Queued')} tone="running" />
            {/if}
            {#if taskCounts.specRevisionQueued > 0}
              <Chip label={countLabel(taskCounts.specRevisionQueued, 'Queued', 'Queued')} tone="running" />
            {/if}
            {#if taskCounts.readyForWorker > 0}
              <Chip label={countLabel(taskCounts.readyForWorker, 'Ready', 'Ready')} tone="ok" />
            {/if}
            {#if taskCounts.needsSpecCleanup > 0}
              <Chip label={countLabel(taskCounts.needsSpecCleanup, 'Needs brief', 'Needs brief')} tone="warn" />
            {/if}
            {#if taskCounts.awaitingApproval > 0}
              <Chip label={countLabel(taskCounts.awaitingApproval, 'Review', 'Review')} tone="warn" />
            {/if}
            {#if taskCounts.done > 0}
              <Chip label={`${taskCounts.done} done`} tone="ok" />
            {/if}
            {#if visibleImportDraftCount > 0}
              <Chip label={countLabel(visibleImportDraftCount, 'import draft')} tone="neutral" />
            {/if}
          </div>
        </div>

        {#if visibleImportDraftCount > 0 && nextImportDraft}
          <UtilityPanel as="div" className="draft-queue-card" tone="neutral">
            <div class="draft-queue-copy">
              <p class="draft-queue-label">Imported draft queue</p>
              <div class="draft-queue-title">{nextImportDraft.title ?? 'Imported draft'}</div>
              <p class="draft-queue-detail">
                {#if visibleImportDraftCount === 1}
                  Review this imported draft and decide whether to shape it now.
                {:else}
                  Start with "{nextImportDraft.title ?? 'Imported draft'}". {visibleImportDraftCount - 1} more drafts are queued behind it.
                {/if}
              </p>
            </div>
            <Button variant="secondary" size="sm" onclick={() => openImportedDraft(nextImportDraft)}>
              {nextImportDraft.id === 'task-workspace-import' ? 'Open import review' : 'Draft task brief'}
            </Button>
          </UtilityPanel>
        {/if}

        {#if allWorkItems.length === 0}
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
        {:else if visibleTasks.length === 0}
          <UtilityPanel as="div" className="work-empty-filter" tone="neutral">
            <div>
              <strong>{emptyFilterTitle()}</strong>
              <p class="muted">{emptyFilterDetail()}</p>
            </div>
            {@const action = emptyFilterAction()}
            {#if action}
              <Button variant="secondary" size="sm" onclick={() => onWorkFilterSelect(action.filter)}>
                {action.label}
              </Button>
            {/if}
          </UtilityPanel>
        {:else}
          <div class="work-list-scroll" role="region" aria-label="Scrollable work list columns">
            <CardList className="work-list-stack">
              <div class="list-column-head" aria-label="Sort work list">
                <button type="button" class:active={sortKey === 'title'} onclick={() => toggleSort('title')}>Work{sortLabel('title')}</button>
                <button type="button" class:active={sortKey === 'status'} onclick={() => toggleSort('status')}>Stage{sortLabel('status')}</button>
                <button type="button" class:active={sortKey === 'area'} onclick={() => toggleSort('area')}>Part{sortLabel('area')}</button>
                <button type="button" class:active={sortKey === 'priority'} onclick={() => toggleSort('priority')}>Priority{sortLabel('priority')}</button>
                <button type="button" class:active={sortKey === 'updated'} onclick={() => toggleSort('updated')}>Updated{sortLabel('updated')}</button>
                <button type="button" class:active={sortKey === 'revisions'} onclick={() => toggleSort('revisions')}>Revs{sortLabel('revisions')}</button>
              </div>
              {#each sortedTasks as task (task.id)}
                {@const deliveryBadge = taskDeliveryBadge(task)}
                <CardListItem
                  as="button"
                  className="work-list-row"
                  tone={listItemTone(task)}
                  railTone={listItemTone(task) === 'neutral' ? 'neutral' : listItemTone(task)}
                  railStrength="strong"
                  ariaLabel={`Inspect work ${taskDisplayLabel(task, task.id)}`}
                  ariaCurrent={selectedWorkId === task.id ? 'true' : null}
                  selected={selectedWorkId === task.id}
                  elementRef={(node) => setWorkRowElement(task.id, node)}
                  onclick={() => selectWork(task)}
                  onkeydown={(event) => onTaskKey(event, task)}
                >
                  <span class="row-main">
                    <span class="task-title">{taskDisplayLabel(task)}</span>
                    {#if hierarchyBreadcrumb(task)}
                      <span class="task-breadcrumb">{hierarchyBreadcrumb(task)}</span>
                    {/if}
                    <span class="task-subcopy">{taskSecondaryText(task)}</span>
                  </span>
                  <span class="row-status">
                    <Chip label={effectiveStatusLabel(task)} tone={effectiveStatusTone(task)} />
                    {#if deliveryBadge}
                      <Chip label={deliveryBadge.label} tone={deliveryBadge.tone} title={deliveryBadge.title} size="compact" />
                    {/if}
                  </span>
                  <span class="row-domain">
                    {workAreaForTask(task).label}
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
          </div>
          {#if inventoryPage?.hasMore}
            <div class="inventory-more">
              <Button variant="secondary" size="sm" disabled={inventoryLoadBusy} onclick={() => void loadMoreWork()}>
                {inventoryLoadBusy ? 'Loading more work' : 'Load more work'}
              </Button>
              <span class="muted">Showing {allWorkItems.length} of {inventoryPage.totalEffectiveCount ?? allWorkItems.length} work items.</span>
            </div>
          {/if}
        {/if}
      </Card>

      {#if selectedWorkId}
        <WorkTreePreview
          tasks={allWorkItems}
          selectedTaskId={selectedWorkId}
          workProgress={detail.workProgress}
          onSelectTask={selectWorkById}
          onRunTask={runWorkItem}
          runBusyTaskId={runWorkBusyId}
          runActiveTaskId={effectiveRunActiveId}
          proofMissingTaskIds={[...proofMissingTaskIds]}
          runError={runWorkError}
        />
      {/if}
    </div>
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
  .work-list-inspector-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--s-4);
    align-items: start;
  }
  .work-list-inspector-layout.has-selection {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 380px);
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
  :global(.delivery-queue-panel) {
    display: block;
  }
  .queue-copy {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
  .queue-main {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--s-1) var(--s-2);
    min-width: 0;
  }
  :global(.delivery-queue-panel) strong {
    overflow-wrap: anywhere;
  }
  :global(.delivery-queue-panel) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .queue-label {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .queue-sources {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .queue-chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-start;
    gap: var(--s-2);
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
  .work-list-scroll {
    max-inline-size: 100%;
    min-inline-size: 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding-block: var(--gh-space-1) var(--gh-space-2);
    scrollbar-gutter: stable;
  }
  .work-list-scroll:focus-visible {
    outline: var(--gh-layout-focus-ring-width) solid var(--gh-color-border-focus);
    outline-offset: var(--gh-space-1);
  }

  .inventory-more {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    margin-top: var(--gh-space-3);
  }
  :global(.work-list-stack) {
    --work-list-columns:
      minmax(280px, 1fr)
      minmax(120px, max-content)
      minmax(96px, 124px)
      minmax(84px, max-content)
      minmax(96px, max-content)
      48px;
    display: grid;
    grid-template-columns: var(--work-list-columns);
    gap: var(--gh-space-2);
    inline-size: max(100%, 860px);
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
    .work-list-inspector-layout.has-selection {
      grid-template-columns: minmax(0, 1fr);
    }
    .work-list-scroll {
      overflow-x: visible;
      padding-block-end: 0;
    }
    :global(.work-list-stack) {
      --work-list-columns: minmax(0, 1fr);
      inline-size: 100%;
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
