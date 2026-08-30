<!--
  Task drawer shell. Loads /api/project/task/:id, exposes the four-tab UI,
  and hosts every action (approve/hold/shelve/unshelve/resolve/follow-up).
  Child components handle rendering; this file owns state and HTTP.

  Uses ResolveEscalationModal (no window.prompt) and an inline ApproveSpecModal
  for the optional approval note. Footer with primary actions is sticky.
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import Icon from '../lib/Icon.svelte'
  import UtilityPanel from '../lib/UtilityPanel.svelte'
  import Tabs from '../lib/Tabs.svelte'
  import Modal from '../lib/Modal.svelte'
  import Textarea from '../lib/Textarea.svelte'
  import Field from '../lib/Field.svelte'
  import Stack from '../lib/Stack.svelte'
  import OverviewTab from './drawer/OverviewTab.svelte'
  import SpecTab from './drawer/SpecTab.svelte'
  import CurrentTab from './drawer/CurrentTab.svelte'
  import SpecReviewDecision from './drawer/SpecReviewDecision.svelte'
  import JourneyTab from './drawer/JourneyTab.svelte'
  import TranscriptTab from './drawer/TranscriptTab.svelte'
  import HistoryTab from './drawer/HistoryTab.svelte'
  import ExpertsTab from './drawer/ExpertsTab.svelte'
  import ProvenanceTab from './drawer/ProvenanceTab.svelte'
  import ResolveEscalationModal from './drawer/ResolveEscalationModal.svelte'
  import type { DrawerPayload, DrawerTab, Escalation, Task } from '../lib/types.js'
  import { onEvent, eventTaskId } from '../lib/events.js'
  import { currentProjectHref, currentTaskHref, isRequiredProjectMigrationError, projectFetch } from '../lib/project-routes.js'
  import { project } from '../lib/project.svelte.js'
  import { nav, path as navPath } from '../lib/nav.svelte.js'
  import { onMount, onDestroy } from 'svelte'
  import { toast } from '../lib/toast.svelte.js'
  import { activeEscalations } from '../lib/escalation.js'
  import { escalationPrimaryAction, escalationUserGuidance } from '../lib/escalation-labels.js'
  import { taskDisplayKey } from '../lib/identifier-labels.js'
  import { humanizeProjectName } from '../lib/project-name.js'
  import { unresolvedCompletionEscalations } from '../lib/task-drawer-integrity.js'
  import { deliveryProgressBadge } from '../lib/work-progress-display.js'

  type RuntimeDevServerStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'stale'
  interface RuntimeDevServer {
    id: string
    taskId?: string
    status: RuntimeDevServerStatus
    readiness: 'unknown' | 'ready' | 'failed'
    command: { cwd: string; argv: string[] }
    ports: Array<{ container: number; host: number; purpose: string }>
    url: string
    browserProof: { ok: boolean; status: number | null; error: string | null } | null
  }

  interface TaskHistoryEvent {
    kind?: string
    recordedAt?: string
    payload?: Record<string, unknown>
  }

  interface TaskExtrasState extends Pick<DrawerPayload, 'contextDebug' | 'exploringTranscript' | 'recentEvents' | 'threadTurns'> {
    historyEvents?: TaskHistoryEvent[]
    reviewVerdicts?: TaskHistoryEvent[]
    reviewAdjudications?: TaskHistoryEvent[]
  }

  interface Props {
    taskId: string
    projectId?: string | null
    routeHref?: string
    onClose: () => void
    onMigrationRequired?: () => void
  }

  let { taskId, projectId = null, routeHref = '', onClose, onMigrationRequired }: Props = $props()

  let payload = $state<DrawerPayload | null>(null)
  let taskExtras = $state<TaskExtrasState>({})
  let loadedExtras = $state<Set<string>>(new Set())
  let loadingExtras = $state<Set<string>>(new Set())
  let error = $state<string | null>(null)
  let busy = $state(false)
  let runBusy = $state(false)
  let runError = $state<string | null>(null)
  let devServers = $state<RuntimeDevServer[]>([])
  let devServerBusyId = $state<string | null>(null)
  function currentBrowserHref(): string {
    if (typeof window === 'undefined') return ''
    return `${window.location.pathname}${window.location.search}${window.location.hash}`
  }

  let activeTab = $state<DrawerTab>(requestedInitialTab(currentBrowserHref()) ?? 'overview')
  let initializedTabForTaskId = $state<string | null>(null)
  let initializedTabForHref = $state<string | null>(null)
  let pollHandle: ReturnType<typeof setInterval> | null = null

  // Modal state
  let resolveModal = $state<{ escalation: Escalation; mode: 'retry' | 'resolve' } | null>(null)
  let approveSpecOpen = $state(false)
  let approveSpecNote = $state('')
  let reframeOpen = $state(false)
  let reframeNote = $state('')
  let reworkModal = $state<null | {
    mode: 'general' | 'split' | 'checklist'
    title: string
    intro: string
    label: string
    placeholder: string
    fallbackInstruction: string
    submitLabel: string
    success: string
  }>(null)
  let reworkNote = $state('')
  let holdOpen = $state(false)
  let holdReason = $state('')
  let shelveOpen = $state(false)
  let rerunStageBusy = $state<null | 'spec' | 'review' | 'gate'>(null)
  let splitTaskBusy = $state(false)
  let moreActionsOpen = $state(false)
  let moreActionsEl = $state<HTMLElement | null>(null)
  let reframeButtonEl = $state<HTMLButtonElement | null>(null)

  function friendlyFetchError(err: unknown): string {
    const message = err instanceof Error ? err.message : String(err)
    if (/failed to fetch|networkerror|load failed/i.test(message)) {
      return 'Could not reach the local Guildhall server. Restart `pnpm exec guildhall serve` and reload.'
    }
    return message
  }

  function firstSpecSummaryLine(spec: string | undefined): string | null {
    if (typeof spec !== 'string' || !spec.trim()) return null
    const anchor = /^##\s+(?:Summary|What this is)\s*$/im.exec(spec)
    const normalized = anchor ? spec.slice(anchor.index + anchor[0].length).trim() : spec.trim()
    const nextHeadingIndex = normalized.search(/\n##\s|\n###\s/)
    const summaryBlock = (nextHeadingIndex >= 0 ? normalized.slice(0, nextHeadingIndex) : normalized).trim()
    if (!summaryBlock) return null
    const firstParagraph = summaryBlock.split(/\n\s*\n/)[0]?.trim() ?? ''
    if (!firstParagraph) return null
    const singleLine = firstParagraph.replace(/\s+/g, ' ').trim()
    if (!singleLine) return null
    const sentence = singleLine.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? singleLine
    return sentence.trim()
  }

  function scopedProjectId(): string | null {
    const normalized = projectId?.trim()
    return normalized ? normalized : null
  }

  function drawerFetch(input: string, init?: RequestInit): Promise<Response> {
    return projectFetch(input, init, scopedProjectId())
  }

  function drawerProjectHref(suffix = '/thread'): string {
    return currentProjectHref(suffix, scopedProjectId())
  }

  function drawerBackgroundPath(): string {
    const state = navPath.state
    if (state && typeof state === 'object' && typeof (state as { backgroundPath?: unknown }).backgroundPath === 'string') {
      return (state as { backgroundPath: string }).backgroundPath
    }
    return scopedProjectId() ? drawerProjectHref('/thread') : '/project/thread'
  }

  function navigateToRelatedTask(nextTaskId: string): void {
    if (!nextTaskId || nextTaskId === taskId) return
    nav(currentTaskHref(nextTaskId, scopedProjectId()), { backgroundPath: drawerBackgroundPath() })
  }

  async function copyTaskLink(taskId: string): Promise<void> {
    const href = currentTaskHref(taskId, scopedProjectId())
    const absolute = typeof window === 'undefined'
      ? href
      : new URL(href, window.location.origin).toString()
    try {
      await navigator.clipboard?.writeText(absolute)
      toast.success('Task link copied.')
    } catch {
      toast.error('Could not copy the task link.')
    }
  }

  function requestedInitialTab(href: string): DrawerTab | null {
    const queryStart = href.indexOf('?')
    const hashStart = href.indexOf('#', queryStart)
    const search = queryStart >= 0
      ? href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
      : (typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, ''))
    const raw = new URLSearchParams(search).get('tab')
    if (raw === 'action') return 'current'
    if (
      raw === 'current' ||
      raw === 'overview' ||
      raw === 'spec' ||
      raw === 'journey' ||
      raw === 'transcript' ||
      raw === 'experts' ||
      raw === 'history' ||
      raw === 'provenance'
    ) {
      return raw
    }
    return null
  }

  function requestedFullRecord(href: string): boolean {
    const queryStart = href.indexOf('?')
    const hashStart = href.indexOf('#', queryStart)
    const search = queryStart >= 0
      ? href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
      : (typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, ''))
    return new URLSearchParams(search).get('detail') === 'full'
  }

  function requestedDiagnosticContext(href: string): boolean {
    const queryStart = href.indexOf('?')
    const hashStart = href.indexOf('#', queryStart)
    const search = queryStart >= 0
      ? href.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart)
      : (typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, ''))
    return new URLSearchParams(search).get('diagnostics') === 'context'
  }

  const BASE_TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'spec', label: 'Spec' },
    { id: 'journey', label: 'Journey' },
    { id: 'transcript', label: 'Transcript' },
    { id: 'experts', label: 'Experts' },
    { id: 'history', label: 'History' },
    { id: 'provenance', label: 'Origin' },
  ] as const

  async function load() {
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(taskId)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        error = body.error ?? `HTTP ${res.status}`
        return
      }
      const nextPayload = (await res.json()) as DrawerPayload
      payload = nextPayload
      // Accept the legacy detail payload during rolling installed-app updates.
      taskExtras = nextPayload.threadTurns ? { threadTurns: nextPayload.threadTurns } : {}
      loadedExtras = new Set()
      loadingExtras = new Set()
      await loadDevServers()
      error = null
    } catch (err) {
      error = friendlyFetchError(err)
    }
  }

  async function loadDevServers(): Promise<void> {
    try {
      const res = await drawerFetch('/api/project/runtime/dev-servers', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json().catch(() => ({}))) as { devServers?: RuntimeDevServer[] }
      devServers = (body.devServers ?? []).filter(server => server.taskId === taskId)
    } catch {
      devServers = []
    }
  }

  async function loadTaskExtras(include: 'context' | 'transcript' | 'events' | 'thread'): Promise<void> {
    if (loadedExtras.has(include) || loadingExtras.has(include)) return
    const requestedTaskId = taskId
    loadingExtras = new Set([...loadingExtras, include])
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(requestedTaskId)}/extras?include=${include}`)
      if (!res.ok) return
      const extras = await res.json() as Pick<DrawerPayload, 'contextDebug' | 'exploringTranscript' | 'recentEvents' | 'threadTurns'>
      if (requestedTaskId !== taskId) return
      taskExtras = { ...taskExtras, ...extras }
    } catch {
      // The selected tab can render its normal empty/error state when optional
      // diagnostics are unavailable.
    } finally {
      if (requestedTaskId === taskId) {
        // Do not refetch an unavailable optional diagnostic on every render.
        loadedExtras = new Set([...loadedExtras, include])
      }
      loadingExtras = new Set([...loadingExtras].filter(value => value !== include))
    }
  }

  async function loadTaskHistory(): Promise<void> {
    if (loadedExtras.has('history') || loadingExtras.has('history')) return
    loadingExtras = new Set([...loadingExtras, 'history'])
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(taskId)}/history`)
      if (!res.ok) return
      const body = await res.json() as { events?: TaskHistoryEvent[] }
      taskExtras = { ...taskExtras, historyEvents: Array.isArray(body.events) ? body.events : [] }
    } catch {
      taskExtras = { ...taskExtras, historyEvents: [] }
    } finally {
      loadedExtras = new Set([...loadedExtras, 'history'])
      loadingExtras = new Set([...loadingExtras].filter(value => value !== 'history'))
    }
  }

  async function loadTaskReview(): Promise<void> {
    if (loadedExtras.has('review') || loadingExtras.has('review')) return
    loadingExtras = new Set([...loadingExtras, 'review'])
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(taskId)}/review`)
      if (!res.ok) return
      const body = await res.json() as { verdicts?: TaskHistoryEvent[]; adjudications?: TaskHistoryEvent[] }
      taskExtras = {
        ...taskExtras,
        reviewVerdicts: Array.isArray(body.verdicts) ? body.verdicts : [],
        reviewAdjudications: Array.isArray(body.adjudications) ? body.adjudications : [],
      }
    } catch {
      taskExtras = { ...taskExtras, reviewVerdicts: [], reviewAdjudications: [] }
    } finally {
      loadedExtras = new Set([...loadedExtras, 'review'])
      loadingExtras = new Set([...loadingExtras].filter(value => value !== 'review'))
    }
  }

  async function loadTaskGitStory(): Promise<void> {
    if (loadedExtras.has('git-story') || loadingExtras.has('git-story')) return
    const requestedTaskId = taskId
    loadingExtras = new Set([...loadingExtras, 'git-story'])
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(requestedTaskId)}/git-story`)
      if (!res.ok) return
      const body = await res.json() as { gitStory?: Task['gitStory'] }
      if (requestedTaskId !== taskId || !payload) return
      payload = {
        ...payload,
        task: {
          ...payload.task,
          ...(body.gitStory ? { gitStory: body.gitStory } : {}),
        },
      }
    } catch {
      // The Origin tab still shows the durable task provenance when Git is
      // unavailable; a live repository snapshot is an optional detail.
    } finally {
      if (requestedTaskId === taskId) {
        loadedExtras = new Set([...loadedExtras, 'git-story'])
      }
      loadingExtras = new Set([...loadingExtras].filter(value => value !== 'git-story'))
    }
  }

  async function openGitPullRequest(): Promise<void> {
    busy = true
    try {
      const res = await drawerFetch(`/api/project/task/${encodeURIComponent(taskId)}/git-story/open-pr`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; url?: string }
      if (!res.ok) {
        error = body.error ?? `HTTP ${res.status}`
        return
      }
      await load()
      await project.refresh(scopedProjectId())
      toast.success(body.url ? 'Pull request opened.' : 'Pull request requested.')
    } catch (err) {
      error = friendlyFetchError(err)
    } finally {
      busy = false
    }
  }

  function eventPayload(event: TaskHistoryEvent): Record<string, unknown> {
    const payload = event.payload && typeof event.payload === 'object' ? { ...event.payload } : {}
    if (!payload.timestamp && event.recordedAt) payload.timestamp = event.recordedAt
    return payload
  }

  async function stopDevServer(id: string): Promise<void> {
    devServerBusyId = id
    try {
      const res = await drawerFetch(`/api/project/runtime/dev-servers/${encodeURIComponent(id)}/stop`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await loadDevServers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      devServerBusyId = null
    }
  }

  async function restartDevServer(id: string): Promise<void> {
    devServerBusyId = id
    try {
      const res = await drawerFetch(`/api/project/runtime/dev-servers/${encodeURIComponent(id)}/restart`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await loadDevServers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      devServerBusyId = null
    }
  }

  async function post(
    action: string,
    body?: Record<string, unknown>,
  ): Promise<boolean> {
    busy = true
    try {
      const res = await drawerFetch(
        `/api/project/task/${encodeURIComponent(taskId)}/${action}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        },
      )
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        const message = b.error ?? `HTTP ${res.status}`
        if (isRequiredProjectMigrationError(message)) {
          onMigrationRequired?.()
          return false
        }
        error = message
        return false
      }
      await load()
      return true
    } catch (err) {
      error = friendlyFetchError(err)
      return false
    } finally {
      busy = false
    }
  }

  function openThreadFromDrawer(): void {
    nav(drawerProjectHref('/thread'))
  }

  function handleApproveSpec() {
    approveSpecNote = ''
    approveSpecOpen = true
  }

  async function handleRequestSpecChanges(message: string): Promise<void> {
    if (!(await post('resume', { message, revisionTarget: 'spec' }))) return
    await project.refresh(scopedProjectId())
    toast.success('Guildhall will revise this spec.')
  }

  function openFullTaskRecord(): void {
    nav(`${currentTaskHref(taskId, scopedProjectId())}?detail=full&tab=overview`, {
      backgroundPath: drawerBackgroundPath(),
    })
  }

  async function openProjectDecision(): Promise<void> {
    const targetTaskId = projectPrimaryAction?.taskId
    if (!targetTaskId) return
    if (projectPrimaryAction?.operation === 'repair_spec') {
      await runProject('start', targetTaskId)
      return
    }
    nav(currentTaskHref(targetTaskId, scopedProjectId()), {
      backgroundPath: drawerBackgroundPath(),
    })
  }

  async function submitApproveSpec() {
    const note = approveSpecNote.trim()
    const body = note ? { approvalNote: note } : undefined
    if (taskId === 'task-workspace-import') {
      busy = true
      try {
        const res = await drawerFetch('/api/project/workspace-import/approve', {
          method: 'POST',
          headers: body ? { 'content-type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        })
        if (!res.ok) {
          const b = await res.json().catch(() => ({}))
          error = b.error ?? `HTTP ${res.status}`
          return
        }
        await load()
        approveSpecOpen = false
        return
      } catch (err) {
        error = friendlyFetchError(err)
        return
      } finally {
        busy = false
      }
    }
    if (await post('approve-spec', body)) {
      approveSpecOpen = false
      // The task record is current after `post`, but the drawer's next branch
      // belongs to the shared project action. Refresh it before rendering so a
      // completed approval never strands the owner in the old spec document.
      await project.refresh(scopedProjectId())
    }
  }

  function handleResolveEscalation(escalation: Escalation, mode: 'retry' | 'resolve' = 'resolve') {
    resolveModal = { escalation, mode }
  }

  function handleOpenEscalationAction(escalationId: string, mode: 'retry' | 'resolve') {
    const escalation = openEscalations.find(item => item.id === escalationId)
    if (!escalation) return
    handleResolveEscalation(escalation, mode)
  }

  async function handleRunEscalationAction(escalation: Escalation) {
    const action = escalationPrimaryAction(escalation)
    if (!(await post('resolve-escalation', {
      escalationId: escalation.id,
      resolution: action.resolution,
      nextStatus: action.nextStatus,
    }))) return
    await project.refresh()
    toast.success('This task can continue.')
    await runProject('start', taskId)
  }

  function handleRunEscalationById(escalationId: string) {
    const escalation = openEscalations.find(item => item.id === escalationId)
    if (!escalation) return
    void handleRunEscalationAction(escalation)
  }

  async function submitResolveEscalation(args: { resolution: string; nextStatus: string }) {
    const current = resolveModal
    if (!current) return
    resolveModal = null
    await post('resolve-escalation', {
      escalationId: current.escalation.id,
      resolution: args.resolution,
      nextStatus: args.nextStatus,
    })
  }

  async function handleSendFollowUp(message: string) {
    await post('resume', { message })
  }

  async function handleShapeDraft() {
    if (!(await post('shape-draft'))) return
    await project.refresh()
    await load()
    toast.success('Draft handed off. Starting now.')
    await runProject('start', taskId)
  }

  async function handleShelve() {
    moreActionsOpen = false
    shelveOpen = true
  }

  async function submitShelveTask() {
    shelveOpen = false
    if (!(await post('shelve'))) return
    await project.refresh()
    toast.success('Task shelved.')
    onClose()
  }

  async function handleUnshelve() {
    if (!confirmed('Unshelve')) return
    if (!(await post('unshelve'))) return
    await project.refresh()
    toast.success('Task returned to the queue.')
  }

  async function handleAddAcceptance(description: string) {
    await post('add-acceptance', { description })
  }

  async function handleSetAcceptanceCommand(criterionId: string, command: string) {
    await post('set-acceptance-command', { criterionId, command })
  }

  function handleOpenReframe() {
    moreActionsOpen = false
    reframeNote = ''
    reframeOpen = true
  }

  async function submitReframeTask() {
    const reason = reframeNote.trim()
    reframeOpen = false
    if (!(await post('reframe-task', reason ? { reason } : undefined))) return
    await project.refresh()
    toast.success('Task sent back for a fresh, plain-language frame.')
    await runProject('start', taskId)
  }

  function handleOpenRework() {
    moreActionsOpen = false
    reworkNote = ''
    reworkModal = {
      mode: 'general',
      title: 'Rework task',
      intro: 'Use this when the task is still valuable, but its structure, saved state, or agent handoff should change.',
      label: 'How should this be reworked?',
      placeholder: 'e.g. keep the implementation spec, but add an external setup checklist and split live verification into a separate task.',
      fallbackInstruction: 'Rework this task according to the current blocker and project context while preserving useful existing context.',
      submitLabel: 'Rework task',
      success: 'This task will be reworked.',
    }
  }

  function handleOpenSplit() {
    moreActionsOpen = false
    reworkNote = ''
    reworkModal = {
      mode: 'split',
      title: 'Split task',
      intro: 'Use this when one work item is hiding separate pieces of work, external setup, or decisions. The original stays as containing work while smaller nested work is drafted.',
      label: 'What should be separated?',
      placeholder: 'Optional: e.g. split Google OAuth setup, Apple OAuth setup, and live sign-in verification.',
      fallbackInstruction: 'Split this work into smaller nested work before implementation.',
      submitLabel: 'Split task',
      success: 'This will be split into smaller tasks.',
    }
  }

  async function submitReworkTask() {
    const modal = reworkModal
    if (!modal) return
    const note = reworkNote.trim()
    reworkModal = null
    if (!(await post('enrich-task', {
      mode: modal.mode,
      instruction: note || modal.fallbackInstruction,
    }))) return
    await project.refresh()
    toast.success(modal.success)
    await runProject('start', taskId)
  }

  function handleOpenHold() {
    moreActionsOpen = false
    holdReason = ''
    holdOpen = true
  }

  async function submitHoldTask() {
    const reason = holdReason.trim()
    holdOpen = false
    if (!(await post('hold', reason ? { reason } : undefined))) return
    await project.refresh()
    toast.success('Task put on hold.')
  }

  async function handleResumeHold() {
    if (!(await post('resume-hold'))) return
    await project.refresh()
    toast.success('Task returned to the queue.')
  }

  async function rerunStage(stage: 'spec' | 'review' | 'gate') {
    moreActionsOpen = false
    rerunStageBusy = stage
    try {
      await post('rerun-stage', { stage })
      await project.refresh(scopedProjectId())
    } finally {
      rerunStageBusy = null
    }
  }

  async function handleCreateSplitChildren() {
    splitTaskBusy = true
    try {
      if (!(await post('create-split-children'))) return
      await project.refresh()
      await load()
      toast.success('Work split into containing work with linked nested items.')
    } finally {
      splitTaskBusy = false
    }
  }

  function confirmed(action: string): boolean {
    return window.confirm(`${action} task ${taskId}?`)
  }

  const task = $derived.by(() => {
    const base = payload?.task
    if (!base) return undefined
    const next = { ...base } as Task
    if (taskExtras.historyEvents) {
      const history = taskExtras.historyEvents
      next.notes = history.filter(event => event.kind === 'note').map(event => eventPayload(event) as Task['notes'][number])
      const gates = history.filter(event => event.kind === 'gate_result').map(event => eventPayload(event) as Task['gateResults'][number])
      const escalations = history.filter(event => event.kind === 'escalation').map(event => eventPayload(event) as Task['escalations'][number])
      if (gates.length > 0) next.gateResults = gates
      if (escalations.length > 0) next.escalations = escalations
    }
    if (taskExtras.reviewVerdicts) {
      next.reviewVerdicts = taskExtras.reviewVerdicts.map(event => eventPayload(event) as Task['reviewVerdicts'][number])
    }
    if (taskExtras.reviewAdjudications) {
      next.adjudications = taskExtras.reviewAdjudications.map(event => eventPayload(event) as Task['adjudications'][number])
    }
    return next
  })
  const fullRecordRequested = $derived(requestedFullRecord(routeHref || navPath.href || currentBrowserHref()))
  const diagnosticContextRequested = $derived(requestedDiagnosticContext(routeHref || navPath.href || currentBrowserHref()))
  const scopeHandoffState = $derived.by(() => task?.id
    ? project.detail?.orientationSpine?.scopeRows?.find(row => row.taskId === task.id)?.handoffState
    : null)
  const isSpecRepair = $derived(scopeHandoffState === 'spec_shaping')
  const focusedSpecRepair = $derived(task?.status === 'spec_review' && isSpecRepair && !fullRecordRequested)
  // Status alone does not grant the owner an approval. Legacy review rows
  // default to owner authority; an explicit coordinator gate must remain
  // runnable by Guildhall instead of presenting a false owner decision.
  const ownerSpecReview = $derived(task?.specReviewGate?.authority !== 'coordinator')
  const focusedSpecReview = $derived(task?.status === 'spec_review' && ownerSpecReview && !isSpecRepair && !fullRecordRequested)
  const openEscalations = $derived(task ? activeEscalations(task) : [])
  const completionEscalations = $derived(task ? unresolvedCompletionEscalations(task) : [])
  const hasCompletionEscalationHygieneWarning = $derived(completionEscalations.length > 0)
  const firstOpenEscalation = $derived(hasCompletionEscalationHygieneWarning ? null : (openEscalations[0] ?? null))
  // Detail carries a revision-matched action model. The page store may still
  // describe a previous project decision while a drawer is open.
  const projectPrimaryAction = $derived(payload?.actionModel?.primaryAction ?? project.detail?.actionModel?.primaryAction ?? null)
  const projectDecisionEyebrow = $derived(
    projectPrimaryAction?.operation === 'repair_spec'
      ? 'One repair is ready'
      : 'Next action',
  )
  const systemRepairedGateBlocker = $derived(Boolean(
    task?.status === 'ready' &&
    (task.escalations ?? []).some(escalation =>
      escalation.reason === 'gate_hard_failure' && escalation.resolvedBy === 'system',
    ),
  ))
  const projectDecisionContext = $derived(
    firstOpenEscalation
      ? 'The task you opened stopped. Guildhall has selected the next work item that can move forward.'
      : systemRepairedGateBlocker
        ? 'Guildhall cleared a blocker that was not tied to this task. This task is ready again after the current work item.'
      : null,
  )
  const projectDecisionElsewhere = $derived(Boolean(
    !fullRecordRequested &&
    !focusedSpecReview &&
    !focusedSpecRepair &&
    // The shared project action is the single owner-facing priority. A
    // selected task's recovery remains reachable as its full record, but it
    // cannot independently replace a newer project decision.
    task?.id &&
    projectPrimaryAction?.taskId &&
    projectPrimaryAction.taskId !== task.id,
  ))
  const currentWorkProgress = $derived(task ? payload?.workProgress?.byTaskId?.[task.id] ?? null : null)
  const currentDeliveryBadge = $derived(deliveryProgressBadge(currentWorkProgress))
  const allTaskContext = $derived.by(() => {
    const byId = new Map<string, Task>()
    for (const candidate of [...(project.detail?.tasks ?? []), ...(payload?.relatedTasks ?? []), task]) {
      if (candidate?.id && !byId.has(candidate.id)) byId.set(candidate.id, candidate)
    }
    return [...byId.values()]
  })
  const taskLinkContext = $derived.by(() => {
    const byId = new Map<string, Task>()
    for (const candidate of [...(payload?.relatedTasks ?? []), ...(project.detail?.tasks ?? [])]) {
      if (candidate?.id && candidate.id !== task?.id) byId.set(candidate.id, candidate)
    }
    return [...byId.values()]
  })
  const breadcrumbTasks = $derived.by(() => {
    if (!task) return []
    const byId = new Map(allTaskContext.map(candidate => [candidate.id, candidate]))
    const trail: Task[] = []
    const seen = new Set<string>([task.id])
    let next = task.hierarchy?.parentId?.trim()
    while (next && !seen.has(next)) {
      const parent = byId.get(next)
      if (!parent) break
      trail.unshift(parent)
      seen.add(next)
      next = parent.hierarchy?.parentId?.trim()
    }
    return [...trail, task]
  })
  const runStatus = $derived(payload?.runStatus ?? project.detail?.run?.status ?? 'stopped')
  const availabilityStatus = $derived(payload?.availability?.status ?? project.detail?.availability?.status ?? 'active')
  const hasCurrentTurns = $derived((taskExtras.threadTurns?.length ?? payload?.threadTurns?.length ?? 0) > 0)
  // Normal detail only answers the owner's two jobs: understand the current
  // work or deliberately read its specification. Diagnostic views stay
  // linkable for audit evidence, but do not compete as peer navigation.
  const tabs = $derived.by(() => {
    const diagnosticTab = BASE_TABS.find(tab =>
      tab.id === activeTab && !['overview', 'spec'].includes(tab.id),
    )
    return [
      BASE_TABS[0],
      ...(hasCurrentTurns ? [{ id: 'current', label: 'Action' } as const] : []),
      BASE_TABS[1],
      ...(diagnosticTab ? [diagnosticTab] : []),
    ]
  })
  function isTerminalRunStatus(status: string | undefined): boolean {
    return status === 'done' || status === 'shelved' || status === 'pending_pr'
  }

  const isTerminalRunTask = $derived(isTerminalRunStatus(task?.status))
  function readinessRecommendation(value: Task | undefined): string | null {
    const recommendation = value?.taskReadiness?.recommendation
    return typeof recommendation === 'string' ? recommendation : null
  }

  const isContainingWorkTask = $derived(Boolean(
    (task?.hierarchy?.childIds?.length ?? 0) > 0 ||
    readinessRecommendation(task) === 'requires_child_work',
  ))
  const canReframeTask = $derived(Boolean(
    task &&
    !isTerminalRunTask &&
    !isContainingWorkTask &&
    task.status !== 'in_progress' &&
    task.status !== 'review' &&
    task.status !== 'gate_check',
  ))
  const canSplitTask = $derived(Boolean(
    canReframeTask &&
    task?.id !== 'task-meta-intake' &&
    task?.id !== 'task-workspace-import',
  ))
  const canReworkTask = $derived(canSplitTask)
  const isHeld = $derived(task?.status === 'blocked' && Boolean(task?.hold))
  const canHold = $derived(task && !isTerminalRunTask && !isContainingWorkTask && task.status !== 'blocked')
  const canShelve = $derived(task && !isContainingWorkTask && task.status !== 'done' && task.status !== 'pending_pr')
  const isShelved = $derived(task?.status === 'shelved')
  const isWorkspaceImportTask = $derived(task?.id === 'task-workspace-import')
  const hasUnansweredTaskQuestion = $derived(Boolean(task?.openQuestions?.some(question => !question.answeredAt && !question.answer)))
  const projectStartBlocker = $derived(
    project.detail?.startReadiness?.canStart === false
      ? project.detail.startReadiness
      : null,
  )
  const requiredProjectUpdateBeforeSpecReview = $derived(
    focusedSpecReview && projectStartBlocker?.code === 'required_migration_pending',
  )
  const projectStartBlockerMessage = $derived(projectStartBlocker?.message ?? null)
  $effect(() => {
    if (!requiredProjectUpdateBeforeSpecReview) return
    onMigrationRequired?.()
  })
  const canRunTaskDirectly = $derived(
    !projectStartBlocker &&
    !isSpecRepair &&
    !isTerminalRunTask &&
    !isContainingWorkTask &&
    !firstOpenEscalation &&
    !hasUnansweredTaskQuestion &&
    (!hasCurrentTurns || task?.status === 'ready'),
  )
  // The shared project action has already chosen this task. Lead with that
  // command; the record is available only when the owner explicitly asks for it.
  const showFocusedRunAction = $derived(Boolean(
    task &&
    !fullRecordRequested &&
    !focusedSpecReview &&
    !focusedSpecRepair &&
    !projectDecisionElsewhere &&
    !isWorkspaceImportTask &&
    runStatus !== 'running' &&
    runStatus !== 'stopping' &&
    canRunTaskDirectly &&
    projectPrimaryAction?.taskId === task.id,
  ))
  // A focused task that has actually started owns this surface too. The owner
  // needs confirmation and an exit ramp, not the task's implementation record.
  const showFocusedRunningState = $derived(Boolean(
    task &&
    !fullRecordRequested &&
    !focusedSpecReview &&
    !focusedSpecRepair &&
    !projectDecisionElsewhere &&
    runStatus === 'running' &&
    task.status === 'in_progress',
  ))
  const showFocusedRunHandoff = $derived(showFocusedRunAction || showFocusedRunningState)
  const canResumeHold = $derived(!projectStartBlocker && isHeld && !firstOpenEscalation)
  const firstOpenEscalationAction = $derived(escalationPrimaryAction(firstOpenEscalation))
  const firstOpenEscalationGuidance = $derived(escalationUserGuidance(firstOpenEscalation))
  const firstOpenEscalationText = $derived(
    `${firstOpenEscalation?.summary ?? ''}\n${firstOpenEscalation?.details ?? ''}`,
  )
  const firstOpenEscalationIsWorkspaceBuild = $derived(
    /authoritative verification|upstream workspace build failure|checkpoint-touched|task worktree/i.test(firstOpenEscalationText),
  )
  const drawerOutcome = $derived.by(() => {
    if (!task) return null
    // An unrelated task record must not compete with the project's owner decision.
    if (projectDecisionElsewhere) return null
    // A direct repository-decision route owns the task's next move. Historical
    // merge failures belong in diagnostics, not above the actionable branch card.
    if (fullRecordRequested && activeTab === 'provenance' && task.gitStory?.state === 'no_upstream') return null
    if (task.status === 'shelved') {
      return {
        tone: 'warn',
        eyebrow: 'Put aside',
        title: 'This task is out of the active queue.',
        detail: task.shelveReason?.detail
          ?? 'It will not be picked up again until you return it to the queue.',
      }
    }
    if (isHeld) {
      return {
        tone: 'warn',
        eyebrow: 'On hold',
        title: 'This task is out of the active queue for now.',
        detail: task.hold?.reason
          ? `Reason: ${task.hold.reason}`
        : 'Resume it when you want work to continue from the saved stage.',
      }
    }
    if (hasCompletionEscalationHygieneWarning) {
      const firstEscalation = completionEscalations[0]
      return {
        tone: 'warn',
        eyebrow: 'Completion hygiene',
        title: 'This task is marked done but still has unresolved escalation history.',
        detail: firstEscalation?.summary ?? 'Review the unresolved escalation before treating the completion as clean.',
      }
    }
    if (task.terminalSummary?.headline) {
      return {
        tone: 'ok',
        eyebrow: 'Finished',
        title: task.terminalSummary.headline,
        detail: task.terminalSummary.detail ?? 'This task has a terminal result.',
      }
    }
    if (isTerminalRunStatus(task.status)) {
      return {
        tone: task.status === 'shelved' ? 'warn' : 'ok',
        eyebrow: task.status === 'done' ? 'Finished' : 'Closed',
        title: task.status === 'done'
          ? 'This task is done.'
          : `This task is ${friendlyStatus(task.status)}.`,
        detail: task.completedAt
          ? `Completed at ${task.completedAt}.`
          : 'There is no active next step for this task.',
      }
    }
    if (firstOpenEscalation) {
      const guidance = escalationUserGuidance(firstOpenEscalation)
      return {
        tone: guidance.actionOwner === 'guildhall' ? 'info' : 'warn',
        eyebrow: guidance.actionOwner === 'guildhall' ? 'Queued' : 'Needs recovery',
        title: guidance.title,
        detail: guidance.nextStep,
      }
    }
    if (task.latestCheckpoint?.nextPlannedAction || task.latestCheckpoint?.intent) {
      return {
        tone: 'info',
        eyebrow: 'Checkpoint saved',
        title: task.latestCheckpoint.nextPlannedAction
          ? 'Resume point saved.'
          : 'Recovery checkpoint saved.',
        detail: task.latestCheckpoint.nextPlannedAction
          ?? task.latestCheckpoint.intent
          ?? 'The next worker pass can resume from the latest checkpoint.',
      }
    }
    return null
  })
  const drawerOutcomeTone = $derived<'accent' | 'warn' | 'ok'>(() => {
    if (!drawerOutcome) return 'accent'
    return drawerOutcome.tone === 'info' ? 'accent' : drawerOutcome.tone
  })
  const activeTabOwnsEscalationDecision = $derived(
    Boolean(firstOpenEscalation) && (activeTab === 'current' || activeTab === 'spec'),
  )
  const displayTaskTitle = $derived.by(() => {
    if (!task) return taskId
    const raw = typeof task.title === 'string' ? task.title.trim() : ''
    const spec = typeof task.spec === 'string' ? task.spec : ''
    const acceptanceCount = Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria.length : 0
    if (
      task.status === 'exploring' &&
      acceptanceCount > 0 &&
      spec.trim().length > 0 &&
      /^Draft a first starter task for /i.test(raw)
    ) {
      const summary = firstSpecSummaryLine(spec)
      if (summary) return `Starter task spec: ${summary}`
      return 'Starter task spec draft'
    }
    return raw || taskId
  })
  const drawerProjectLabel = $derived.by(() => {
    const name = project.detail?.name?.trim()
    if (name) return name
    const id = scopedProjectId()
    return humanizeProjectName(id)
  })
  const stageRerun = $derived.by(() => {
    if (!task) return null
    if (isSpecRepair) return null
    if (task.id === 'task-meta-intake' || task.id === 'task-workspace-import') return null
    if (['exploring', 'spec_review', 'ready', 'proposed'].includes(task.status ?? '')) {
      return { stage: 'spec' as const, label: 'Re-draft spec' }
    }
    if (task.status === 'review') {
      return { stage: 'review' as const, label: 'Re-run review' }
    }
    if (task.status === 'gate_check') {
      return { stage: 'gate' as const, label: 'Re-run gates' }
    }
    return null
  })

  $effect(() => {
    void load()
  })

  $effect(() => {
    const href = routeHref || navPath.href || currentBrowserHref()
    if (!payload) return
    const taskChanged = initializedTabForTaskId !== taskId
    const hrefChanged = initializedTabForHref !== href
    const requested = requestedInitialTab(href)
    if (!taskChanged && (!hrefChanged || !requested)) return
    if (requested && (requested !== 'current' || hasCurrentTurns)) {
      activeTab = requested
    } else if (taskChanged) {
      // A direct recovery route is the first owner job for this task. Do not
      // make the owner discover it behind an Overview tab.
      activeTab = firstOpenEscalation && hasCurrentTurns ? 'current' : 'overview'
    }
    initializedTabForTaskId = taskId
    initializedTabForHref = href
  })

  $effect(() => {
    if (activeTab === 'current' && !hasCurrentTurns) {
      activeTab = 'overview'
    }
  })

  $effect(() => {
    if (!payload) return
    if (activeTab === 'transcript') void loadTaskExtras('transcript')
    if (activeTab === 'transcript' || activeTab === 'spec' || activeTab === 'history') void loadTaskHistory()
    if (activeTab === 'journey' || activeTab === 'history') void loadTaskReview()
    if (activeTab === 'current') {
      void loadTaskExtras('thread')
      void loadTaskExtras('context')
    }
    if (activeTab === 'provenance') {
      if (diagnosticContextRequested) void loadTaskExtras('context')
      void loadTaskGitStory()
    }
  })

  $effect(() => {
    const button = reframeButtonEl
    if (!button) return
    const openReframe = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      handleOpenReframe()
    }
    button.addEventListener('click', openReframe)
    return () => button.removeEventListener('click', openReframe)
  })

  onMount(() => {
    pollHandle = setInterval(() => {
      void load()
    }, 4000)
    const closeMoreActions = (event: MouseEvent) => {
      if (!moreActionsOpen) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (moreActionsEl?.contains(target)) return
      moreActionsOpen = false
    }
    const closeMoreActionsOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') moreActionsOpen = false
    }
    document.addEventListener('click', closeMoreActions)
    document.addEventListener('keydown', closeMoreActionsOnEscape)
    return () => {
      document.removeEventListener('click', closeMoreActions)
      document.removeEventListener('keydown', closeMoreActionsOnEscape)
    }
  })

  async function runProject(action: 'start' | 'stop', nextTaskId?: string, retryStaleActive = true) {
    runBusy = true
    runError = null
    try {
      const endpoint = action === 'start' && nextTaskId
        ? `/api/project/task/${encodeURIComponent(nextTaskId)}/start`
        : `/api/project/${action}`
      const res = await drawerFetch(endpoint, {
        method: 'POST',
        headers: action === 'start' ? { 'content-type': 'application/json' } : undefined,
        body: action === 'start'
          ? JSON.stringify({
              mode: nextTaskId ? 'one_task' : 'continuous',
              scope: nextTaskId ? 'work_item' : 'project',
            })
          : undefined,
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({})) as { code?: string; error?: string; status?: string }
        if (b.code === 'run_already_active') {
          await load()
          await project.refresh(scopedProjectId())
          const latestRunStatus = payload?.runStatus ?? project.detail?.run?.status ?? 'stopped'
          if (
            retryStaleActive &&
            action === 'start' &&
            nextTaskId &&
            latestRunStatus !== 'running' &&
            latestRunStatus !== 'stopping'
          ) {
            await runProject(action, nextTaskId, false)
            return
          }
          toast.info('A run is already active. This task stays queued for the coordinator.')
          return
        }
        runError = b.error ?? `${action === 'start' ? 'Start' : 'Stop'} failed (HTTP ${res.status})`
        return
      }
      await project.refresh()
      await load()
      if (action === 'start') {
        const stopMessage = project.detail?.run?.status === 'stopped'
          ? project.detail?.run?.stopMessage
          : null
        if (typeof stopMessage === 'string' && stopMessage.trim()) {
          toast.info(stopMessage)
        }
      }
      setTimeout(() => void project.refresh(scopedProjectId()), 500)
      setTimeout(() => void project.refresh(scopedProjectId()), 1800)
      // A cross-task repair can finish in one focused pass. Refresh the
      // drawer packet alongside the project cache so its stale action does
      // not remain clickable until the ordinary polling interval.
      setTimeout(() => void load(), 500)
      setTimeout(() => void load(), 1800)
    } catch (err) {
      runError = friendlyFetchError(err)
    } finally {
      runBusy = false
    }
  }

  // Live updates: whenever the orchestrator emits an event for THIS task,
  // re-fetch the drawer payload so transitions, notes, escalations, and
  // history reflect reality without the user having to close/reopen the drawer.
  // Coarse refresh is cheaper and simpler than selective merging, and the
  // drawer payload is small.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRefresh() {
    if (refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      void load()
    }, 150)
  }
  const offEvent = onEvent((env) => {
    const tid = eventTaskId(env)
    if (tid && tid === taskId) scheduleRefresh()
  })
  onDestroy(() => {
    offEvent()
    if (pollHandle) {
      clearInterval(pollHandle)
      pollHandle = null
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer)
      refreshTimer = null
    }
  })
</script>

<div
  class="gh-drawer-backdrop"
  role="button"
  tabindex="0"
  aria-label="Close drawer"
  onclick={onClose}
  onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onClose()}
></div>

<aside class="gh-drawer" aria-label="Task drawer">
  <header class="gh-drawer-head">
    <div class="drawer-title-block">
      <nav class="drawer-breadcrumb" aria-label="Task breadcrumb">
        <a href={drawerProjectHref('/overview')}>{drawerProjectLabel}</a>
        {#each breadcrumbTasks as crumb, index (crumb.id)}
          <span aria-hidden="true">/</span>
          {#if index < breadcrumbTasks.length - 1}
            <a
              href={currentTaskHref(crumb.id, scopedProjectId())}
              onclick={(event) => {
                event.preventDefault()
                navigateToRelatedTask(crumb.id)
              }}
            >
              {taskDisplayKey(crumb, allTaskContext, scopedProjectId())}
            </a>
          {:else}
            <span>{taskDisplayKey(crumb, allTaskContext, scopedProjectId())}</span>
          {/if}
        {/each}
        {#if breadcrumbTasks.length === 0}
          <span aria-hidden="true">/</span>
          <span>{taskDisplayKey(taskId, allTaskContext, scopedProjectId())}</span>
        {/if}
      </nav>
      <h3 title={displayTaskTitle}>{displayTaskTitle}</h3>
      {#if currentDeliveryBadge && !showFocusedRunHandoff && !focusedSpecRepair}
        <div class="drawer-progress-line">
          <Chip
            label={currentDeliveryBadge.label}
            tone={currentDeliveryBadge.tone === 'warn' ? 'warn' : currentDeliveryBadge.tone === 'ok' ? 'ok' : 'neutral'}
          />
        </div>
      {/if}
    </div>
    <Button variant="ghost" size="sm" ariaLabel="Close" onclick={onClose}>
      <Icon name="x" size={16} />
    </Button>
  </header>

  {#if payload && isSpecRepair && fullRecordRequested}
    <UtilityPanel as="section" className="drawer-spec-repair" tone="neutral" railStrength="strong" ariaLabel="Spec repair">
      <span class="outcome-eyebrow">Guildhall is repairing this spec</span>
      <strong>{runStatus === 'running' ? 'Repair in progress.' : 'Run one repair pass.'}</strong>
      <span>{runStatus === 'running' ? 'Guildhall will bring this back for review when the spec is ready.' : 'Guildhall needs one focused pass before this spec can be reviewed.'}</span>
      {#if task && runStatus !== 'running' && runStatus !== 'stopping'}
        <div class="drawer-spec-repair-actions">
          <Button variant="agent" size="sm" disabled={runBusy} onclick={() => runProject('start', task.id)}>
            <Icon name="sparkles" size={14} />
            Repair spec
          </Button>
        </div>
      {/if}
      {#if runError}
        <span class="drawer-run-action-error">{runError}</span>
      {/if}
    </UtilityPanel>
  {/if}

  {#if payload && !focusedSpecReview && !focusedSpecRepair && !projectDecisionElsewhere && !showFocusedRunHandoff}
    <div class="gh-drawer-tabs">
      <Tabs
        tabs={tabs}
        active={activeTab}
        onselect={(id) => (activeTab = id as DrawerTab)}
      />
    </div>
  {/if}

  <div class="gh-drawer-body">
    {#if error}
      <div class="error-stack">
        <p class="error">Error: {error}</p>
        <Button variant="ghost" size="sm" onclick={() => void load()}>Retry</Button>
      </div>
    {:else if !payload}
      <p class="loading">Loading...</p>
      {:else}
      {#if showFocusedRunAction && task}
        <UtilityPanel
          as="section"
          className="drawer-run-action"
          tone="accent"
          railStrength="strong"
          ariaLabel="Current task action"
        >
          <span class="outcome-eyebrow">Ready to continue</span>
          <strong>Resume this work item</strong>
          <span class="drawer-run-action-copy">Guildhall can continue this work item.</span>
          {#if runError}
            <span class="drawer-run-action-error">{runError}</span>
          {/if}
          <div class="drawer-run-action-actions">
            <Button
              variant="agent"
              size="sm"
              disabled={runBusy || runStatus === 'stopping'}
              onclick={() => runProject('start', task.id)}
            >
              <Icon name="sparkles" size={14} />
              Resume only this work item
            </Button>
            <Button variant="secondary" size="sm" onclick={openFullTaskRecord}>View task details</Button>
          </div>
        </UtilityPanel>
      {:else if showFocusedRunningState && task}
        <UtilityPanel
          as="section"
          className="drawer-run-action"
          tone="accent"
          railStrength="strong"
          ariaLabel="Current work is running"
        >
          <span class="outcome-eyebrow">Work is underway</span>
          <strong>Guildhall is working on {displayTaskTitle}.</strong>
          <span class="drawer-run-action-copy">Nothing is waiting on you right now. Guildhall will return when it needs a decision or reaches a result.</span>
          <div class="drawer-run-action-actions">
            <Button variant="secondary" size="sm" onclick={openFullTaskRecord}>View task details</Button>
          </div>
        </UtilityPanel>
      {:else}
      {#if drawerOutcome && !activeTabOwnsEscalationDecision && !focusedSpecReview && !focusedSpecRepair}
        <UtilityPanel
          as="section"
          className="drawer-outcome"
          tone={drawerOutcomeTone}
          railStrength="strong"
          ariaLabel={drawerOutcome.eyebrow}
        >
          <span class="outcome-eyebrow">{drawerOutcome.eyebrow}</span>
          <strong>{drawerOutcome.title}</strong>
          <span>{drawerOutcome.detail}</span>
        </UtilityPanel>
      {/if}
      {#if devServers.length > 0 && !focusedSpecReview}
        <section class="drawer-dev-servers" aria-label="Runtime dev servers">
          {#each devServers as server}
            <UtilityPanel as="div" className="drawer-dev-server" tone="neutral">
              <div>
                <div class="drawer-dev-server-head">
                  <strong>{server.id}</strong>
                  <Chip label={server.status} tone={server.status === 'running' ? 'ok' : server.status === 'failed' ? 'danger' : server.status === 'stale' ? 'warn' : 'neutral'} />
                  <Chip label={server.readiness} tone={server.readiness === 'ready' ? 'ok' : server.readiness === 'failed' ? 'danger' : 'neutral'} />
                </div>
                <p>{server.command.argv.join(' ')} · {server.command.cwd}</p>
                <p>
                  {server.ports[0]?.container ?? '?'} -> {server.ports[0]?.host ?? '?'}
                  {#if server.browserProof}
                    · Browser proof {server.browserProof.ok ? 'passed' : 'failed'}
                  {/if}
                </p>
              </div>
              <div class="drawer-dev-server-actions">
                <Button variant="secondary" size="sm" onclick={() => window.open(server.url, '_blank', 'noopener')}>Open</Button>
                {#if server.status === 'running' || server.status === 'starting'}
                  <Button variant="secondary" size="sm" disabled={devServerBusyId === server.id} onclick={() => void stopDevServer(server.id)}>Stop</Button>
                {:else}
                  <Button variant="secondary" size="sm" disabled={devServerBusyId === server.id} onclick={() => void restartDevServer(server.id)}>Restart</Button>
                {/if}
              </div>
            </UtilityPanel>
          {/each}
        </section>
      {/if}
      {#if requiredProjectUpdateBeforeSpecReview}
        <p class="loading">Opening project update...</p>
      {:else if focusedSpecRepair && task}
        <UtilityPanel as="section" className="drawer-spec-repair" tone="neutral" railStrength="strong" ariaLabel="Spec repair">
          <span class="outcome-eyebrow">Guildhall is repairing this spec</span>
          <strong>{runStatus === 'running' ? 'Repair in progress.' : 'Run one repair pass.'}</strong>
          <span>{runStatus === 'running' ? 'Guildhall will bring this back for review when the spec is ready.' : 'Guildhall needs one focused pass before this spec can be reviewed.'}</span>
          <div class="drawer-spec-repair-actions">
            {#if runStatus !== 'running' && runStatus !== 'stopping'}
              <Button variant="agent" size="sm" disabled={runBusy} onclick={() => runProject('start', task.id)}>
                <Icon name="sparkles" size={14} />
                Repair spec
              </Button>
            {/if}
            <Button variant="secondary" size="sm" onclick={openFullTaskRecord}>Read full task record</Button>
          </div>
          {#if runError}
            <span class="drawer-run-action-error">{runError}</span>
          {/if}
        </UtilityPanel>
      {:else if focusedSpecReview && task}
        <SpecReviewDecision
          {busy}
          onApprove={handleApproveSpec}
          onRequestChanges={handleRequestSpecChanges}
          onOpenFullRecord={openFullTaskRecord}
        />
      {:else if projectDecisionElsewhere && projectPrimaryAction}
        <UtilityPanel as="section" className="drawer-project-decision" tone="warn" railStrength="strong" ariaLabel="Project decision">
          <span class="outcome-eyebrow">{projectDecisionEyebrow}</span>
          <strong>{projectPrimaryAction.label}</strong>
          {#if projectPrimaryAction.taskLabel}
            <span class="drawer-project-decision-task" title={projectPrimaryAction.taskLabel}>
              {projectPrimaryAction.taskLabel}
            </span>
          {/if}
          {#if projectPrimaryAction.detail}
            <span class="drawer-project-decision-detail">{projectPrimaryAction.detail}</span>
          {/if}
          {#if projectDecisionContext}
            <span class="drawer-project-decision-context">{projectDecisionContext}</span>
          {/if}
          <div class="drawer-project-decision-actions">
            <Button variant="primary" size="sm" disabled={busy || runBusy} onclick={openProjectDecision}>{projectPrimaryAction.buttonLabel}</Button>
            <Button variant="secondary" size="sm" onclick={openFullTaskRecord}>View this task record</Button>
          </div>
        </UtilityPanel>
      {:else if activeTab === 'current'}
        <CurrentTab
          {task}
          turns={taskExtras.threadTurns ?? payload.threadTurns ?? []}
          {busy}
          {runBusy}
          {runError}
          {runStatus}
          {availabilityStatus}
          {projectStartBlockerMessage}
          contextDebug={taskExtras.contextDebug ?? []}
          workProgress={currentWorkProgress}
          canApproveSpec={!isSpecRepair}
          onApproveBrief={() => post('approve-brief')}
          onApproveSpec={handleApproveSpec}
          onRunTask={() => runProject('start', taskId)}
          onShapeDraft={handleShapeDraft}
          onOpenSpecTab={() => (activeTab = 'spec')}
          onOpenEscalationAction={handleOpenEscalationAction}
          onRunEscalationAction={handleRunEscalationById}
          onOpenThread={openThreadFromDrawer}
        />
      {:else if activeTab === 'overview'}
        <OverviewTab
          {task}
          tasks={taskLinkContext}
          projectId={scopedProjectId()}
          deliverySpine={payload.deliverySpine}
          workProgress={currentWorkProgress}
          handoffState={scopeHandoffState}
          onNavigateTask={navigateToRelatedTask}
          onCreateSplitChildren={handleCreateSplitChildren}
          createSplitBusy={splitTaskBusy}
        />
      {:else if activeTab === 'spec'}
        <SpecTab
          {task}
          {busy}
          specRepair={isSpecRepair}
          canApproveSpec={ownerSpecReview && !isSpecRepair}
          onApproveBrief={() => post('approve-brief')}
          onApproveSpec={handleApproveSpec}
          onPause={handleOpenHold}
          onShelve={() => confirmed('Shelve') && post('shelve')}
          onUnshelve={() => confirmed('Unshelve') && post('unshelve')}
          onResolveEscalation={handleResolveEscalation}
          onRunEscalationAction={handleRunEscalationAction}
          onSendFollowUp={handleSendFollowUp}
          onAddAcceptance={handleAddAcceptance}
          onSetAcceptanceCommand={handleSetAcceptanceCommand}
        />
      {:else if activeTab === 'journey'}
        <JourneyTab {task} projectId={scopedProjectId()} workProgress={currentWorkProgress} />
      {:else if activeTab === 'transcript'}
        {#if loadingExtras.has('transcript')}
          <p class="loading">Loading transcript...</p>
        {:else}
          <TranscriptTab {task} exploringTranscript={taskExtras.exploringTranscript} />
        {/if}
      {:else if activeTab === 'experts'}
        <ExpertsTab taskId={taskId} />
      {:else if activeTab === 'history'}
        <HistoryTab {task} />
      {:else if activeTab === 'provenance'}
        {#if loadingExtras.has('context') || loadingExtras.has('git-story')}
          <p class="loading">Loading provenance...</p>
        {:else}
          <ProvenanceTab
            {task}
            contextDebug={taskExtras.contextDebug ?? []}
            gitStoryLoaded={loadedExtras.has('git-story')}
            {busy}
            onOpenPullRequest={openGitPullRequest}
          />
        {/if}
      {/if}
      {/if}
    {/if}
  </div>

  {#if payload && task && !focusedSpecRepair && !projectDecisionElsewhere && !showFocusedRunHandoff}
    <footer class="gh-drawer-foot">
      {#if isWorkspaceImportTask}
        <div class="footer-actions-left">
          <button
            type="button"
            class="footer-utility-action"
            onclick={() => copyTaskLink(task.id)}
          >
            Copy link
          </button>
        </div>
        <div class="footer-actions-right">
          <Button
            variant="primary"
            size="sm"
            onclick={() => {
              window.history.pushState({}, '', drawerProjectHref('/workspace-import'))
              window.dispatchEvent(new PopStateEvent('popstate'))
            }}
          >
            Open import review
          </Button>
        </div>
      {:else if !focusedSpecReview}
        <div class="footer-actions-left">
          <div class="run-controls">
            {#if runError}
              <span class="run-error">{runError}</span>
            {/if}
            {#if projectStartBlockerMessage}
              <span class="run-error">{projectStartBlockerMessage}</span>
            {/if}
            {#if canRunTaskDirectly}
              {#if runStatus === 'running'}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={runBusy}
                  onclick={() => runProject('stop')}
                >
                  Pause run
                </Button>
              {:else}
                <Button
                  variant="agent"
                  size="sm"
                  disabled={runBusy || runStatus === 'stopping'}
                  onclick={() => runProject('start', task.id)}
                >
                  <Icon name="sparkles" size={14} />
                  Resume only this work item
                </Button>
              {/if}
            {/if}
          </div>
          {#if canReframeTask || canReworkTask || canSplitTask || canHold || (!isShelved && canShelve) || stageRerun}
            <div class="more-actions" class:is-open={moreActionsOpen} bind:this={moreActionsEl}>
              <button
                type="button"
                class="footer-utility-action more-actions-trigger"
                aria-haspopup="menu"
                aria-expanded={moreActionsOpen}
                onclick={() => (moreActionsOpen = !moreActionsOpen)}
              >
                More task actions
              </button>
              {#if moreActionsOpen}
              <div class="more-action-menu">
                {#if canReframeTask}
                  <button
                    bind:this={reframeButtonEl}
                    type="button"
                    class="more-action-button"
                    disabled={busy || runBusy}
                  >
                    Reframe task...
                  </button>
                {/if}
                {#if canReworkTask}
                  <button
                    type="button"
                    class="more-action-button"
                    disabled={busy || runBusy}
                    onclick={handleOpenRework}
                  >
                    <Icon name="sparkles" size={14} />
                    Rework task...
                  </button>
                {/if}
                {#if canSplitTask}
                  <button
                    type="button"
                    class="more-action-button"
                    disabled={busy || runBusy}
                    onclick={handleOpenSplit}
                  >
                    Split task...
                  </button>
                {/if}
                {#if canHold}
                  {#if stageRerun}
                    <button
                      type="button"
                      class="more-action-button"
                      disabled={busy || rerunStageBusy !== null}
                      onclick={() => rerunStage(stageRerun.stage)}
                    >
                      <Icon name="sparkles" size={14} />
                      {rerunStageBusy === stageRerun.stage ? 'Re-running...' : stageRerun.label}
                    </button>
                  {/if}
                  <button
                    type="button"
                    class="more-action-button"
                    disabled={busy}
                    onclick={handleOpenHold}
                  >
                    Pause and keep in queue...
                  </button>
                {/if}
                {#if !isShelved && canShelve}
                  <button
                    type="button"
                    class="more-action-button destructive"
                    disabled={busy}
                    onclick={handleShelve}
                  >
                    Shelve task...
                  </button>
                {/if}
              </div>
              {/if}
            </div>
          {/if}
          <button
            type="button"
            class="footer-utility-action"
            onclick={() => copyTaskLink(task.id)}
          >
            Copy link
          </button>
        </div>
        <div class="footer-actions-right">
          {#if firstOpenEscalation && !activeTabOwnsEscalationDecision}
            {#if firstOpenEscalationGuidance.actionOwner === 'user' && canReframeTask}
              <Button
                variant="agent"
                size="sm"
                disabled={busy || runBusy}
                onclick={() => handleOpenEscalationAction(firstOpenEscalation.id, 'retry')}
              >
                <Icon name="sparkles" size={14} />
                {firstOpenEscalationAction.label}
              </Button>
              {#if firstOpenEscalationIsWorkspaceBuild}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onclick={handleOpenHold}
                >
                  Track upstream build fix...
                </Button>
              {/if}
            {/if}
            {#if firstOpenEscalationGuidance.actionOwner === 'guildhall'}
              <Button
                variant="agent"
                size="sm"
                disabled={busy || runBusy}
                onclick={() => handleRunEscalationAction(firstOpenEscalation)}
              >
                <Icon name="sparkles" size={14} />
                {firstOpenEscalationAction.label}
              </Button>
            {:else}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onclick={() => handleResolveEscalation(firstOpenEscalation, 'resolve')}
              >
                Mark blocker resolved...
              </Button>
            {/if}
          {/if}
          {#if isShelved}
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onclick={handleUnshelve}
            >
              Unshelve
            </Button>
          {/if}
          {#if canResumeHold}
            <Button
              variant="agent"
              size="sm"
              disabled={busy}
              onclick={handleResumeHold}
            >
              <Icon name="sparkles" size={14} />
              Resume task
            </Button>
          {/if}
        </div>
      {/if}
    </footer>
  {/if}
</aside>

<ResolveEscalationModal
  open={resolveModal !== null}
  escalation={resolveModal?.escalation ?? null}
  mode={resolveModal?.mode ?? 'resolve'}
  {busy}
  onClose={() => (resolveModal = null)}
  onSubmit={submitResolveEscalation}
/>

<Modal
  open={approveSpecOpen}
  title="Approve spec"
  onClose={() => (approveSpecOpen = false)}
  size="sm"
>
  {#snippet children()}
    {#if error}
      <p class="form-error" role="alert">{error}</p>
    {/if}
    <Field label="Note (optional)">
      <Textarea
        bind:value={approveSpecNote}
        rows={3}
        placeholder="Context for the coordinator on resume."
      />
    </Field>
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (approveSpecOpen = false)}>
      Cancel
    </Button>
    <Button variant="primary" disabled={busy} onclick={submitApproveSpec}>
      Approve
    </Button>
  {/snippet}
</Modal>

<Modal
  open={holdOpen}
  title="Put task on hold"
  onClose={() => (holdOpen = false)}
  size="md"
>
  {#snippet children()}
    <Stack gap="3">
      <p class="modal-copy">
        Use this when the task is still valid but should wait. The app keeps
        it in the queue, skips it for now, and lets you resume it later. It does
        not stop a running pass; use Stop first if work is
        currently working.
      </p>
      <Field label="Why is this on hold?">
        <Textarea
          bind:value={holdReason}
          rows={4}
          placeholder="Optional: waiting on a decision, not needed this release, blocked by another project..."
        />
      </Field>
    </Stack>
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (holdOpen = false)}>
      Cancel
    </Button>
    <Button variant="secondary" disabled={busy || runStatus === 'running' || runStatus === 'stopping'} onclick={submitHoldTask}>
      Pause task
    </Button>
  {/snippet}
</Modal>

<Modal
  open={shelveOpen}
  title="Shelve task"
  onClose={() => (shelveOpen = false)}
  size="sm"
>
  {#snippet children()}
    <p class="modal-copy">
      Shelving removes this task from the active plan. It will not be picked up
      up during normal runs unless you unshelve it later.
    </p>
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (shelveOpen = false)}>
      Cancel
    </Button>
    <Button variant="danger" disabled={busy} onclick={submitShelveTask}>
      Shelve task
    </Button>
  {/snippet}
</Modal>

<Modal
  open={reworkModal !== null}
  title={reworkModal?.title ?? 'Rework task'}
  onClose={() => (reworkModal = null)}
  size="md"
>
  {#snippet children()}
    {#if reworkModal}
      <Stack gap="3">
        <p class="modal-copy">{reworkModal.intro}</p>
        <Field label={reworkModal.label}>
          <Textarea
            bind:value={reworkNote}
            rows={5}
            placeholder={reworkModal.placeholder}
          />
        </Field>
      </Stack>
    {/if}
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (reworkModal = null)}>
      Cancel
    </Button>
    <Button variant="agent" disabled={busy} onclick={submitReworkTask}>
      <Icon name="sparkles" size={14} />
      {reworkModal?.submitLabel ?? 'Rework task'}
    </Button>
  {/snippet}
</Modal>

<Modal
  open={reframeOpen}
  title="Reframe task"
  onClose={() => (reframeOpen = false)}
  size="md"
>
  {#snippet children()}
    <Field label="What to ask the coordinator">
      <Textarea
        bind:value={reframeNote}
        rows={5}
        placeholder="Optional: explain what is confusing, stale, or wrong about this task."
      />
    </Field>
  {/snippet}
  {#snippet footer()}
    <Button variant="ghost" disabled={busy} onclick={() => (reframeOpen = false)}>
      Cancel
    </Button>
    <Button variant="agent" disabled={busy} onclick={submitReframeTask}>
      Reframe task
    </Button>
  {/snippet}
</Modal>

<style>
  .gh-drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: var(--z-drawer-backdrop);
  }
  .gh-drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: min(640px, 92vw);
    height: 100vh;
    background: var(--bg-raised);
    border-left: 1px solid var(--border);
    z-index: var(--z-drawer);
    display: flex;
    flex-direction: column;
  }
  .gh-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--s-4);
    border-bottom: 1px solid var(--border);
  }
  .gh-drawer-tabs {
    padding: 0 var(--s-4);
  }
  .gh-drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: var(--s-4);
  }
  :global(.drawer-outcome) {
    display: grid;
    gap: var(--s-1);
    margin-bottom: var(--s-4);
  }
  :global(.drawer-outcome) strong {
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-tight);
  }
  .drawer-title-block {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .drawer-title-block h3 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-breadcrumb {
    display: flex;
    align-items: center;
    gap: var(--s-1);
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .drawer-breadcrumb a,
  .drawer-breadcrumb span:last-child {
    min-width: 0;
    max-width: 18rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .drawer-breadcrumb a {
    color: inherit;
    text-decoration: none;
  }
  .drawer-breadcrumb a:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .drawer-title-block p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
    overflow-wrap: anywhere;
  }
  .drawer-progress-line {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-items: center;
  }
  :global(.drawer-outcome) span:last-child {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
  }
  :global(.drawer-project-decision) {
    display: grid;
    gap: var(--s-3);
  }
  .drawer-project-decision-task {
    color: var(--text);
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
  }
  .drawer-project-decision-detail {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
  }
  .drawer-project-decision-context {
    color: var(--text-subtle);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-relaxed);
  }
  :global(.drawer-run-action) {
    display: grid;
    gap: var(--s-3);
  }
  :global(.drawer-run-action) strong {
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-tight);
  }
  :global(.drawer-run-action-copy) {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
  }
  .drawer-run-action-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .drawer-run-action-error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
  }
  .drawer-project-decision-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .modal-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .outcome-eyebrow {
    color: var(--text-subtle);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .drawer-dev-servers {
    display: grid;
    gap: var(--s-2);
    margin-bottom: var(--s-3);
  }
  :global(.drawer-dev-server) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--s-3);
  }
  :global(.drawer-dev-server) .drawer-dev-server-head,
  :global(.drawer-dev-server) .drawer-dev-server-actions {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  :global(.drawer-dev-server) p {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    overflow-wrap: anywhere;
  }
  .gh-drawer-foot {
    position: relative;
    z-index: 3;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-top: 1px solid var(--border);
    background: var(--bg-sunken, var(--bg));
    overflow: visible;
  }
  .footer-actions-left,
  .footer-actions-right {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .footer-actions-left {
    flex: 1 1 auto;
    justify-content: flex-start;
  }
  .footer-actions-right {
    flex: 0 0 auto;
    justify-content: flex-end;
  }
  .run-controls {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .run-error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-tight);
    max-width: 28ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .more-actions {
    position: relative;
    margin-right: var(--s-4);
  }
  .footer-utility-action {
    appearance: none;
    border: 0;
    background: transparent;
    padding: var(--s-1) 0;
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    font-family: inherit;
    line-height: var(--gh-type-line-height-control);
  }
  .more-actions.is-open .more-actions-trigger,
  .footer-utility-action:hover,
  .footer-utility-action:focus-visible {
    color: var(--text);
    outline: none;
  }
  .more-action-menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--s-2));
    display: grid;
    gap: var(--s-1);
    min-width: 220px;
    padding: var(--s-2);
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-md);
    background:
      var(--glass-reflect-violet),
      color-mix(in srgb, var(--glass-bg-strong) 92%, var(--bg-raised));
    box-shadow: var(--glass-shadow), var(--glass-etch);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    z-index: 20;
  }
  .more-action-button {
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--s-2);
    width: 100%;
    min-height: 34px;
    padding: 0 var(--s-3);
    border: 1px solid transparent;
    border-radius: var(--r-1);
    color: var(--text);
    background: transparent;
    font-family: inherit;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
    cursor: pointer;
    white-space: nowrap;
  }
  .more-action-button:hover:not(:disabled),
  .more-action-button:focus-visible {
    border-color: color-mix(in srgb, var(--glass-border-strong) 76%, var(--accent));
    background: color-mix(in srgb, var(--glass-inset-bg-strong) 84%, var(--accent) 8%);
    outline: none;
  }
  .more-action-button.destructive {
    color: color-mix(in srgb, var(--danger) 78%, var(--text));
  }
  .more-action-button.destructive:hover:not(:disabled),
  .more-action-button.destructive:focus-visible {
    border-color: color-mix(in srgb, var(--danger) 42%, var(--glass-border));
    background: color-mix(in srgb, var(--danger) 12%, var(--glass-inset-bg-strong));
  }
  .more-action-button:disabled {
    color: var(--text-dim);
    cursor: not-allowed;
    opacity: 0.72;
  }
  .error-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--s-2);
  }
  .loading,
  .error {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .error {
    color: var(--danger);
  }
  @media (max-width: 720px) {
    :global(.drawer-dev-server) {
      grid-template-columns: 1fr;
    }
    .gh-drawer-foot,
    .footer-actions-left,
    .footer-actions-right {
      align-items: stretch;
    }
    .gh-drawer-foot {
      flex-direction: column;
    }
    .footer-actions-left,
    .footer-actions-right {
      width: 100%;
      flex-wrap: wrap;
    }
    .footer-actions-right {
      justify-content: flex-end;
    }
  }
</style>
