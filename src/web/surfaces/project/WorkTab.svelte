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
  import { taskDisplayKey } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { project } from '../../lib/project.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { sourceRefsSummary } from '../../lib/source-refs.js'
  import { buildWorkSurface } from '../../lib/project-data.js'
  import { hasUnmetDependencies } from '../../lib/task-dependencies.js'
  import { isCompleteForWorkerHandoff, needsSourceRecoveryShaping, needsWorkerHandoffSpecCleanup } from '../../lib/task-state.js'
  import { taskStagePresentation, type TaskPresentationTone } from '../../lib/task-presentation.js'
  import { buildWorkHierarchy } from '../../lib/work-hierarchy.js'
  import { taskDisplayLabel, taskSourceQuestion } from '@guildhall/shared'
  import type { ProjectDetail, Task } from '../../lib/types.js'
  import PlannerTab from './PlannerTab.svelte'
  import WorkTreePreview from './WorkTreePreview.svelte'

  interface Props {
    detail: ProjectDetail
    mode?: 'list' | 'board'
  }

  type WorkView = 'list' | 'board'
  type WorkFilter = 'current' | 'queued' | 'scope' | 'planning' | 'open' | 'all' | 'blocked' | 'needs-proof' | 'review' | 'needs-you'

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
  let pendingLocalSelectionTaskId = $state<string | null>(null)
  const workRowEls = new Map<string, HTMLElement>()

  const viewOptions = [
    { value: 'list', label: 'List' },
    { value: 'board', label: 'Board' },
  ]

  const workFilterOptions = [
    { value: 'current', label: 'Current work' },
    { value: 'queued', label: 'Ready to run' },
    { value: 'scope', label: 'Scope history' },
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
  const selectedScopeRows = $derived(detail.orientationSpine?.scopeRows ?? [])
  const scopeTaskIds = $derived.by(() => {
    const ids = selectedScopeRows
      .map(row => row.taskId)
      .filter((id): id is string => Boolean(id))
    return new Set(ids)
  })
  // This set comes from the same selected-release snapshot that produced the
  // primary Review action. Work only presents it; it never re-decides who is
  // reviewable from task prose or a route-local status scan.
  const ownerReviewTaskIds = $derived.by(() => new Set(detail.startReadiness?.reviewTaskIds ?? []))
  const scopeByTaskId = $derived.by(() => {
    const entries = selectedScopeRows
      .filter((row): row is typeof row & { taskId: string } => Boolean(row.taskId))
      .map(row => [row.taskId, row.scope] as const)
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
  const ownerReviewQueueTasks = $derived.by(() => {
    const tasksById = new Map(allWorkItems.map(task => [task.id, task]))
    return (detail.startReadiness?.reviewTaskIds ?? []).flatMap(taskId => {
      const task = tasksById.get(taskId)
      return task ? [task] : []
    })
  })
  const workAreasByTaskId = $derived(viewModel.workAreasByTaskId)
  const workAreaOptions = $derived(viewModel.workAreaOptions)
  const showsPlanningArtifacts = $derived(['current', 'scope', 'planning', 'open', 'all'].includes(workFilter))
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
  const readyWorkTaskId = $derived(
    detail.actionModel?.primaryAction?.code === 'ready_work'
      ? detail.actionModel.primaryAction.taskId ?? null
      : null,
  )
  const boardDetail = $derived({
    ...detail,
    tasks: visibleTasks,
  } as ProjectDetail)

  const localTaskCounts = $derived.by(() => {
    const all = visibleTasks
    const contextualTasks = workFilter === 'queued'
      ? filterableTasks.filter(task => partFilter === 'all' || workAreaForTask(task).id === partFilter)
      : all
    const running = detail.run?.status === 'running'
    const readyTasks = all.filter(task => task.status === 'ready' && !hasUnmetDependencies(task, tasks))
    const stageCounts = contextualTasks.reduce<Record<string, number>>((counts, task) => {
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
  const taskCounts = $derived(detail.actionModel?.workSummary ?? localTaskCounts)
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
    if (workFilter === 'current') return countLabel(visibleTasks.length, 'current item')
    if (workFilter !== 'scope') {
      const noun = workFilter === 'review'
        ? 'review'
        : workFilter === 'needs-you'
          ? 'decision'
          : workFilter === 'needs-proof'
            ? 'proof gap'
            : 'work item'
      return countLabel(visibleTasks.length, noun)
    }
    const current = orientationScopeCounts?.current ?? scopeVisibleCounts.current
    const deferred = orientationScopeCounts?.deferred ?? scopeVisibleCounts.deferred
    const pieces = [
      countLabel(current, 'current item'),
      countLabel(deferred, 'deferred item'),
    ]
    return `${pieces.join(' · ')} · ${current + deferred} total`
  })

  function countLabel(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
  }

  // The server ordering is the project ordering. This surface deliberately
  // does not invent a second ranking for people to decipher.
  const sortedTasks = $derived([...visibleTasks])
  const selectedWorkVisible = $derived(Boolean(selectedWorkId && allWorkItems.some(task => task.id === selectedWorkId)))
  const focusedMode = $derived.by(() => {
    path.href
    if (boardMode || typeof window === 'undefined') return false
    const params = new URL(window.location.href).searchParams
    if (params.get('view') === 'queue') return false
    const routeTaskId = readSelectedWorkIdFromUrl()
    const actionTaskId = detail.actionModel?.primaryAction?.taskId
    const readinessTaskId = detail.startReadiness?.focusTaskId
    // Focus mode is only for an actual shared decision. A raw task URL is a
    // useful diagnostic/deep-link compatibility path, not permission to
    // invent an owner decision from a task's local status.
    return Boolean(
      actionTaskId ||
      readinessTaskId ||
      // Starting the focused work clears its pending action. Keep the active
      // route in the same concise handoff instead of dropping the owner into
      // the inventory dashboard mid-flow.
      (projectRunActive && routeTaskId) ||
      selectedReleaseShipped,
    )
  })
  const queueMode = $derived.by(() => {
    path.href
    if (typeof window === 'undefined') return false
    return new URL(window.location.href).searchParams.get('view') === 'queue'
  })
  const allWorkRequested = $derived.by(() => {
    path.href
    if (typeof window === 'undefined') return false
    return new URL(window.location.href).searchParams.get('all') === '1'
  })
  // A shared action keeps the generic queue concise. Owner review is stricter:
  // its ordered task IDs are the only rows relevant to the decision.
  const actionQueueMode = $derived(
    queueMode &&
      !allWorkRequested &&
      Boolean(detail.actionModel?.primaryAction?.taskId),
  )
  const ownerReviewQueueMode = $derived(
    actionQueueMode &&
      detail.startReadiness?.code === 'owner_review_required' &&
      ownerReviewQueueTasks.length > 0,
  )
  const displayedTasks = $derived(ownerReviewQueueMode ? ownerReviewQueueTasks : sortedTasks)
  const displayedWorkListCountLabel = $derived(
    ownerReviewQueueMode
      ? `${ownerReviewQueueTasks.length} ${ownerReviewQueueTasks.length === 1 ? 'spec needs' : 'specs need'} your review`
      : workListCountLabel,
  )
  const focusedWork = $derived.by(() => {
    path.href
    const routeTaskId = readSelectedWorkIdFromUrl()
    const actionTaskId = detail.actionModel?.primaryAction?.taskId
    const readinessTaskId = detail.startReadiness?.focusTaskId
    const taskId = routeTaskId ?? actionTaskId ?? readinessTaskId
    return taskId ? allWorkItems.find(task => task.id === taskId) ?? null : null
  })
  const workMilestone = $derived(
    detail.orientationSpine?.summary?.headline
      ?? detail.releaseSummary?.release?.label
      ?? detail.releaseReadiness?.release?.label
      ?? 'Current work',
  )
  const completedWorkLabel = $derived.by(() => {
    const counts = detail.releaseSummary?.counts
    if (!counts || !Number.isFinite(counts.total) || counts.total <= 0) return null
    return `${counts.done ?? 0} of ${counts.total} complete`
  })
  const focusedDecisionDetail = $derived.by(() => {
    if (focusedWork && isFocusedRunnableWork(focusedWork)) return null
    const sharedDetail = detail.actionModel?.primaryAction?.detail?.trim()
    if (sharedDetail) return sharedDetail
    if (focusedWork?.status === 'spec_review') return 'Review this spec so Guildhall can continue.'
    if (focusedWork?.status === 'exploring') return 'Review the brief before Guildhall starts this work.'
    if (focusedWork?.status === 'blocked') return 'Open this work to resolve what is blocking it.'
    return 'Open this work to take the next step.'
  })
  const focusedCardTitle = $derived.by(() => {
    if (focusedWork && isFocusedRunnableWork(focusedWork)) return 'Ready to continue'
    if (focusedWork && (effectiveStatusTone(focusedWork) === 'warn' || effectiveStatusTone(focusedWork) === 'danger')) {
      return 'What needs your attention'
    }
    return 'Current work'
  })
  const primaryActionCardTitle = $derived(
    detail.actionModel?.primaryAction?.code === 'ready_work' ? 'Ready to continue' : 'What needs your attention',
  )

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
    // The route is the selection authority. Keeping an older `?task=` after a
    // user click lets a refresh silently put the old row back in focus.
    const url = new URL(window.location.href)
    if (url.searchParams.get('task') !== task.id || url.searchParams.has('work')) {
      pendingLocalSelectionTaskId = task.id
      url.searchParams.set('task', task.id)
      url.searchParams.delete('work')
      nav(`${url.pathname}${url.search}${url.hash}`, { backgroundPath: path.value })
    }
  }

  function selectWorkById(taskId: string): void {
    const task = allWorkItems.find(candidate => candidate.id === taskId)
    if (task) selectWork(task)
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
    if (workFilter === 'current') return 'No current work.'
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
    if (workFilter === 'current') return 'Completed scope history is available when you need it.'
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
    if (workFilter === 'current' && scopeTaskIds.size > 0) return { label: 'Show scope history', filter: 'scope' }
    if (workFilter !== 'queued') return { label: 'Show queued work', filter: 'queued' }
    return null
  }

  function matchesWorkFilter(task: Task): boolean {
    if (partFilter !== 'all' && workAreaForTask(task).id !== partFilter) return false
    if (workFilter === 'all') return true
    if (workFilter === 'current') {
      const isCurrentScopeTask = scopeTaskIds.size > 0
        ? scopeTaskIds.has(task.id)
        : task.id === detail.actionModel?.primaryAction?.taskId
      return isCurrentScopeTask && (
        !['done', 'pending_pr', 'shelved'].includes(task.status ?? '') ||
        isProofMissingTask(task)
      )
    }
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
    if (actionQueueMode) return 'current'
    if (scopeTaskIds.size > 0) return 'current'
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
    return taskPresentation(task).label
  }

  function effectiveStatusTone(task: Task): ChipTone {
    return chipTone(taskPresentation(task).tone)
  }

  function listItemTone(task: Task): CardTone {
    const tone = effectiveStatusTone(task)
    return tone === 'running' ? 'accent' : tone
  }

  function primitiveLabel(primitive: { id?: string; label?: string }): string {
    return primitive.label?.trim() || primitive.id || 'Primitive'
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

  function browseWork(): void {
    // Focused mode may have selected a narrower review/queued filter. Browsing
    // is an explicit request for the current release slice, not that old view.
    workFilterUserSelected = false
    workFilter = 'current'
    partFilter = 'all'
    selectedWorkId = null
    nav(currentProjectHref('/work?view=queue', detail.id))
  }

  function browseAllWork(): void {
    selectedWorkId = null
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'queue')
    url.searchParams.set('all', '1')
    url.searchParams.delete('task')
    url.searchParams.delete('work')
    nav(`${url.pathname}${url.search}${url.hash}`, { backgroundPath: path.value })
  }

  function openFocusedWork(task: Task): void {
    const tab = task.status === 'spec_review' ? '?tab=spec' : ''
    nav(`${currentTaskHref(task.id, detail.id)}${tab}`, { backgroundPath: path.value })
  }

  function focusedActionLabel(task: Task): string {
    if (task.status === 'spec_review') return 'Review spec'
    if (task.status === 'blocked') return 'Open task'
    if (task.status === 'done' || task.status === 'pending_pr') return 'View record'
    if (isFocusedRunnableWork(task)) return 'Resume this work item'
    return 'Open task'
  }

  function isFocusedRunnableWork(task: Task): boolean {
    return detail.actionModel?.primaryAction?.code === 'ready_work' &&
      detail.actionModel.primaryAction.taskId === task.id
  }

  function focusedStatusLabel(task: Task): string {
    return isFocusedRunnableWork(task) ? 'Ready' : effectiveStatusLabel(task)
  }

  function focusedStatusTone(task: Task): ChipTone {
    return isFocusedRunnableWork(task) ? 'ok' : effectiveStatusTone(task)
  }

  function goToSharedAction(): void {
    const action = detail.actionModel?.primaryAction
    if (!action?.href) return
    nav(projectActionHref(action.href, detail.id), { backgroundPath: path.value })
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
    // A user click writes the route after local selection is set. That route
    // update must not reinterpret the click as a deep-link and replace their
    // deliberately chosen list filter.
    if (selectedWorkId === routeTaskId) {
      if (pendingLocalSelectionTaskId === routeTaskId) pendingLocalSelectionTaskId = null
      return
    }
    const isLocalSelectionEcho = pendingLocalSelectionTaskId === routeTaskId
    pendingLocalSelectionTaskId = null
    selectedWorkId = routeTaskId
    runWorkError = null
    // A click from the current queue writes the route after selection. Do not
    // turn that route echo into a different filter and make the list jump.
    if (!isLocalSelectionEcho) {
      workFilter = workFilterForTask(routeTask)
    }
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

{#if focusedMode}
  <section class="work-focus" aria-label="Current work">
    <header class="work-focus-header">
      <p class="work-focus-eyebrow">{workMilestone}</p>
      <h1>Current work</h1>
      {#if completedWorkLabel}
        <p class="work-focus-progress">{completedWorkLabel}</p>
      {/if}
    </header>

    {#if focusedWork}
      <Card title={focusedCardTitle} titleTag="h2" tone={effectiveStatusTone(focusedWork) === 'danger' ? 'danger' : effectiveStatusTone(focusedWork) === 'warn' ? 'warn' : 'accent'} variant="callout" railStrength="strong">
        <div class="work-focus-decision">
          <div class="work-focus-copy">
            <div class="work-focus-meta">
              <span>{taskDisplayKey(focusedWork, allWorkItems, detail.id)}</span>
              <Chip label={focusedStatusLabel(focusedWork)} tone={focusedStatusTone(focusedWork)} />
            </div>
            <h2>{taskDisplayLabel(focusedWork, focusedWork.id)}</h2>
            {#if focusedDecisionDetail}
              <p>{focusedDecisionDetail}</p>
            {/if}
          </div>
          <Button
            variant={effectiveStatusTone(focusedWork) === 'warn' || effectiveStatusTone(focusedWork) === 'danger' ? 'human' : 'primary'}
            disabled={runWorkBusyId === focusedWork.id || runWorkActiveId === focusedWork.id}
            onclick={() => isFocusedRunnableWork(focusedWork) ? void runWorkItem(focusedWork.id) : openFocusedWork(focusedWork)}
          >
            {focusedActionLabel(focusedWork)}
          </Button>
        </div>
        {#if runWorkError}
          <p class="work-focus-error" role="alert">{runWorkError}</p>
        {/if}
      </Card>
    {:else if detail.actionModel?.primaryAction}
      <Card title={primaryActionCardTitle} titleTag="h2" tone="accent" variant="callout" railStrength="strong">
        <div class="work-focus-decision">
          <div class="work-focus-copy">
            <h2>{detail.actionModel.primaryAction.label ?? 'Continue project work'}</h2>
            {#if detail.actionModel.primaryAction.detail}
              <p>{detail.actionModel.primaryAction.detail}</p>
            {/if}
          </div>
          <Button variant="primary" onclick={goToSharedAction}>{detail.actionModel.primaryAction.buttonLabel ?? 'Continue'}</Button>
        </div>
      </Card>
    {:else if selectedReleaseShipped}
      <Card title="Current release" titleTag="h2" tone="ok" variant="callout" railStrength="strong">
        <div class="work-focus-decision">
          <div class="work-focus-copy">
            <h2>Shipped</h2>
            <p>This release is complete. There is nothing you need to do here.</p>
          </div>
          <Button variant="secondary" onclick={browseWork}>Browse work</Button>
        </div>
      </Card>
    {:else}
      <Card title="Current work" titleTag="h2" tone="neutral" variant="callout">
        <div class="work-focus-decision">
          <div class="work-focus-copy">
            <h2>Nothing needs your attention</h2>
            <p>Guildhall has no owner decision waiting right now.</p>
          </div>
          <Button variant="secondary" onclick={browseWork}>Browse work</Button>
        </div>
      </Card>
    {/if}

    {#if focusedWork}
      <div class="work-focus-footer">
        <Button variant="secondary" onclick={browseWork}>Browse work</Button>
      </div>
    {/if}
  </section>
{:else}
<div class="work-list-view">
  {#if !actionQueueMode}
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
  {/if}

  {#if activeWorkView === 'board'}
    <PlannerTab detail={boardDetail} />
  {:else}
    {#if deliveryQueue && !queueMode}
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
      <Card title={ownerReviewQueueMode ? 'Specs to review' : 'Work list'} titleTag="h2">

        <div class="work-list-overview">
          <div>
            <div class="work-list-count">{displayedWorkListCountLabel}</div>
            {#if ownerReviewQueueMode}
              <p class="review-queue-detail">Choose a spec to review. Guildhall can continue after these decisions are resolved.</p>
            {/if}
          </div>
          {#if ownerReviewQueueMode}
            <Button variant="secondary" size="sm" onclick={browseAllWork}>Show all work</Button>
          {/if}
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
                  ? 'Review project update'
                  : setupInboxItem?.kind === 'workspace_import_pending' || setupInboxItem?.kind === 'import_draft_queue'
                    ? 'Review import'
                    : 'Open setup'}
              </Button>
            </UtilityPanel>
          {:else}
            <p class="muted">No tasks yet — <strong>New thread</strong> to begin.</p>
          {/if}
        {:else if displayedTasks.length === 0}
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
          <CardList className="work-list-stack" ariaLabel="Work items">
            {#each displayedTasks as task (task.id)}
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
                  <span class="task-key">{taskDisplayKey(task.id, allWorkItems, detail.id)}</span>
                  <span class="task-title" title={taskDisplayLabel(task)}>{taskDisplayLabel(task)}</span>
                </span>
                <span class="row-status">
                  <Chip label={effectiveStatusLabel(task)} tone={effectiveStatusTone(task)} />
                </span>
              </CardListItem>
            {/each}
          </CardList>
          {#if !ownerReviewQueueMode && inventoryPage?.hasMore && workFilter === 'all'}
            <div class="inventory-more">
              <Button variant="secondary" size="sm" disabled={inventoryLoadBusy} onclick={() => void loadMoreWork()}>
                {inventoryLoadBusy ? 'Loading more work' : 'Load more work'}
              </Button>
              <span class="muted">More work is available.</span>
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
          actionOnly={queueMode}
          {readyWorkTaskId}
        />
      {/if}
    </div>
  {/if}

  {#if !queueMode}
    <details class="progress-more progress-more--full">
      <summary>Recent progress</summary>
      <ProgressFeed {progress} {tasks} />
    </details>
  {/if}
</div>
{/if}

<style>
  .work-focus {
    display: grid;
    gap: var(--s-4);
    max-width: var(--gh-layout-measure-wide);
    min-width: 0;
    padding: var(--s-4) var(--s-4) var(--s-6);
  }
  .work-focus-header,
  .work-focus-copy {
    min-width: 0;
  }
  .work-focus-eyebrow,
  .work-focus-progress,
  .work-focus-copy p {
    margin: 0;
    color: var(--text-muted);
  }
  .work-focus-eyebrow {
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .work-focus h1,
  .work-focus h2 {
    margin: var(--s-1) 0 0;
    color: var(--text);
    line-height: var(--gh-type-line-height-tight);
  }
  .work-focus h1 { font-size: var(--gh-type-size-5); }
  .work-focus h2 { font-size: var(--gh-type-size-4); }
  .work-focus-progress { margin-top: var(--s-1); }
  .work-focus-decision {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--s-4);
  }
  .work-focus-copy {
    display: grid;
    gap: var(--s-2);
  }
  .work-focus-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
  }
  .work-focus-footer {
    display: flex;
    justify-content: flex-start;
  }
  .work-focus-error {
    margin: var(--s-3) 0 0;
    color: var(--gh-color-danger-text, #c43a3a);
  }
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
  .review-queue-detail {
    max-width: 56ch;
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
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
  .inventory-more {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    margin-top: var(--gh-space-3);
  }
  :global(.work-list-stack) {
    display: grid;
    gap: var(--gh-space-2);
  }
  :global(.work-list-row) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gh-space-3);
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
    gap: var(--gh-space-1);
    min-width: 0;
  }
  :global(.work-list-row) .task-key {
    color: var(--text-muted);
    font-family: var(--gh-font-mono, ui-monospace, monospace);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-tight);
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
  :global(.work-list-row) .row-status {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: flex-start;
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
    .work-focus {
      padding: var(--s-3) var(--s-3) var(--s-5);
    }
    .work-focus-decision {
      align-items: stretch;
      flex-direction: column;
    }
    .work-focus-decision :global(button) {
      inline-size: 100%;
    }
    :global(.work-view-header) {
      align-items: stretch;
      flex-direction: column;
    }
    .work-view-actions {
      justify-content: flex-start;
    }
    .work-list-overview {
      align-items: stretch;
      flex-direction: column;
    }
    :global(.draft-queue-card) {
      flex-direction: column;
      align-items: stretch;
    }
    .work-list-inspector-layout.has-selection {
      grid-template-columns: minmax(0, 1fr);
    }
    :global(.work-list-row) {
      align-items: stretch;
      flex-direction: column;
    }
    :global(.work-list-row) .task-title {
      font-size: var(--gh-type-size-meta);
    }
    :global(.work-list-row) .row-status {
      justify-content: flex-start;
    }
  }
</style>
