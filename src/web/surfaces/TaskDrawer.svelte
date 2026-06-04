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
  import JourneyTab from './drawer/JourneyTab.svelte'
  import TranscriptTab from './drawer/TranscriptTab.svelte'
  import HistoryTab from './drawer/HistoryTab.svelte'
  import ExpertsTab from './drawer/ExpertsTab.svelte'
  import ProvenanceTab from './drawer/ProvenanceTab.svelte'
  import ResolveEscalationModal from './drawer/ResolveEscalationModal.svelte'
  import type { DrawerPayload, DrawerTab, Escalation, Task } from '../lib/types.js'
  import { onEvent, eventTaskId } from '../lib/events.js'
  import { currentProjectHref, currentTaskHref, projectFetch } from '../lib/project-routes.js'
  import { project } from '../lib/project.svelte.js'
  import { nav, path as navPath } from '../lib/nav.svelte.js'
  import { onMount, onDestroy } from 'svelte'
  import { toast } from '../lib/toast.svelte.js'
  import { activeEscalations } from '../lib/escalation.js'
  import { escalationPrimaryAction, escalationUserGuidance } from '../lib/escalation-labels.js'
  import { readableTaskDescription } from '../lib/task-display.js'
  import { unresolvedCompletionEscalations } from '../lib/task-drawer-integrity.js'

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

  interface Props {
    taskId: string
    projectId?: string | null
    onClose: () => void
  }

  let { taskId, projectId = null, onClose }: Props = $props()

  let payload = $state<DrawerPayload | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)
  let runBusy = $state(false)
  let runError = $state<string | null>(null)
  let devServers = $state<RuntimeDevServer[]>([])
  let devServerBusyId = $state<string | null>(null)
  let activeTab = $state<DrawerTab>('overview')
  let initializedTabForTaskId = $state<string | null>(null)
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

  function truncateDisplayTitle(value: string, max = 72): string {
    const singleLine = value.replace(/\s+/g, ' ').trim()
    if (singleLine.length <= max) return singleLine
    return `${singleLine.slice(0, max - 1).trim()}...`
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

  function requestedInitialTab(): DrawerTab | null {
    if (typeof window === 'undefined') return null
    const raw = new URLSearchParams(window.location.search).get('tab')
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
      payload = (await res.json()) as DrawerPayload
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
        error = b.error ?? `HTTP ${res.status}`
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

  async function submitApproveSpec() {
    const note = approveSpecNote.trim()
    const body = note ? { approvalNote: note } : undefined
    approveSpecOpen = false
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
        return
      } catch (err) {
        error = friendlyFetchError(err)
        return
      } finally {
        busy = false
      }
    }
    await post('approve-spec', body)
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
    toast.success('Guildhall can continue this task.')
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
    toast.success('Draft handed to Guildhall. Starting now.')
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
      intro: 'Use this when the task is still valuable, but Guildhall should transform how it is structured, saved, or handed back to agents.',
      label: 'How should Guildhall rework this?',
      placeholder: 'e.g. keep the implementation spec, but add an external setup checklist and split live verification into a separate task.',
      fallbackInstruction: 'Rework this task according to the current blocker and project context while preserving useful existing context.',
      submitLabel: 'Rework task',
      success: 'Guildhall will rework this task.',
    }
  }

  function handleOpenSplit() {
    moreActionsOpen = false
    reworkNote = ''
    reworkModal = {
      mode: 'split',
      title: 'Split task',
      intro: 'Use this when one work item is hiding separate pieces of work, external setup, or decisions. Guildhall will keep the original as containing work and draft smaller nested work.',
      label: 'What should be separated?',
      placeholder: 'Optional: e.g. split Google OAuth setup, Apple OAuth setup, and live sign-in verification.',
      fallbackInstruction: 'Split this work into smaller nested work before implementation.',
      submitLabel: 'Split task',
      success: 'Guildhall will split this into smaller tasks.',
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

  const task = $derived(payload?.task)
  const runStatus = $derived(payload?.runStatus ?? project.detail?.run?.status ?? 'stopped')
  const availabilityStatus = $derived(payload?.availability?.status ?? project.detail?.availability?.status ?? 'active')
  const hasCurrentTurns = $derived((payload?.threadTurns?.length ?? 0) > 0)
  const tabs = $derived(
    hasCurrentTurns
      ? ([BASE_TABS[0], { id: 'current', label: 'Action' }, ...BASE_TABS.slice(1)] as const)
      : BASE_TABS,
  )
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
    readinessRecommendation(task) === 'split',
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
  const openEscalations = $derived(task ? activeEscalations(task) : [])
  const completionEscalations = $derived(task ? unresolvedCompletionEscalations(task) : [])
  const hasCompletionEscalationHygieneWarning = $derived(completionEscalations.length > 0)
  const firstOpenEscalation = $derived(hasCompletionEscalationHygieneWarning ? null : (openEscalations[0] ?? null))
  const projectStartBlocker = $derived(
    project.detail?.startReadiness?.canStart === false
      ? project.detail.startReadiness
      : null,
  )
  const projectStartBlockerMessage = $derived(projectStartBlocker?.message ?? null)
  const canRunTaskDirectly = $derived(!projectStartBlocker && !hasCurrentTurns && !isTerminalRunTask && !isContainingWorkTask && !firstOpenEscalation)
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
    if (task.status === 'shelved') {
      return {
        tone: 'warn',
        eyebrow: 'Put aside',
        title: 'This task is out of the active queue.',
        detail: task.shelveReason?.detail
          ?? 'Guildhall will not work on it again until you return it to the queue.',
      }
    }
    if (isHeld) {
      return {
        tone: 'warn',
        eyebrow: 'On hold',
        title: 'This task is out of the active queue for now.',
        detail: task.hold?.reason
          ? `Reason: ${task.hold.reason}`
        : 'Resume it when you want Guildhall to continue from the saved stage.',
      }
    }
    if (isContainingWorkTask) {
      return {
        tone: 'info',
        eyebrow: 'Containing work',
        title: 'Work happens in the nested work below.',
        detail: 'Open Overview to move through the linked work.',
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
          : 'Guildhall has no active next step for this task.',
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
          ? 'Guildhall saved where to resume.'
          : 'Guildhall saved a recovery checkpoint.',
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
      if (summary) return `Starter task spec: ${truncateDisplayTitle(summary)}`
      return 'Starter task spec draft'
    }
    return raw || taskId
  })
  const drawerProjectLabel = $derived.by(() => {
    const name = project.detail?.name?.trim()
    if (name) return name
    const id = scopedProjectId()
    return id ? id.replace(/[-_]+/g, ' ') : 'Project'
  })
  const displayTaskDescription = $derived.by(() => {
    if (!task || typeof task.description !== 'string') return ''
    const description = readableTaskDescription(task.description, displayTaskTitle)
    if (!description || description === displayTaskTitle) return ''
    return description
  })
  const stageRerun = $derived.by(() => {
    if (!task) return null
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
    void project.refresh()
  })

  $effect(() => {
    if (!payload) return
    if (initializedTabForTaskId === taskId) return
    const requested = requestedInitialTab()
    activeTab = requested && (requested !== 'current' || hasCurrentTurns)
      ? requested
      : 'overview'
    initializedTabForTaskId = taskId
  })

  $effect(() => {
    if (activeTab === 'current' && !hasCurrentTurns) {
      activeTab = 'overview'
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
          toast.info('Guildhall is already running. This task stays queued for the coordinator.')
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
        <span aria-hidden="true">/</span>
        <span>{task?.id ?? taskId}</span>
      </nav>
      <h3>{displayTaskTitle}</h3>
      {#if displayTaskDescription}
        <p>{displayTaskDescription}</p>
      {/if}
    </div>
    <Button variant="ghost" size="sm" ariaLabel="Close" onclick={onClose}>
      <Icon name="x" size={16} />
    </Button>
  </header>

  {#if payload}
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
      {#if drawerOutcome && !activeTabOwnsEscalationDecision}
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
      {#if devServers.length > 0}
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
      {#if activeTab === 'current'}
        <CurrentTab
          task={payload.task}
          turns={payload.threadTurns ?? []}
          {busy}
          {runBusy}
          {runError}
          {runStatus}
          {availabilityStatus}
          {projectStartBlockerMessage}
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
          task={payload.task}
          projectId={scopedProjectId()}
          onNavigateTask={navigateToRelatedTask}
          onCreateSplitChildren={handleCreateSplitChildren}
          createSplitBusy={splitTaskBusy}
        />
      {:else if activeTab === 'spec'}
        <SpecTab
          task={payload.task}
          {busy}
          onApproveBrief={() => post('approve-brief')}
          onApproveSpec={handleApproveSpec}
          onPause={handleOpenHold}
          onShelve={() => confirmed('Shelve') && post('shelve')}
          onUnshelve={() => confirmed('Unshelve') && post('unshelve')}
          onResolveEscalation={handleResolveEscalation}
          onRunEscalationAction={handleRunEscalationAction}
          onSendFollowUp={handleSendFollowUp}
          onAddAcceptance={handleAddAcceptance}
        />
      {:else if activeTab === 'journey'}
        <JourneyTab task={payload.task} projectId={scopedProjectId()} />
      {:else if activeTab === 'transcript'}
        <TranscriptTab task={payload.task} exploringTranscript={payload.exploringTranscript} />
      {:else if activeTab === 'experts'}
        <ExpertsTab taskId={taskId} />
      {:else if activeTab === 'history'}
        <HistoryTab task={payload.task} />
      {:else if activeTab === 'provenance'}
        <ProvenanceTab task={payload.task} contextDebug={payload.contextDebug ?? []} />
      {/if}
    {/if}
  </div>

  {#if payload && task}
    <footer class="gh-drawer-foot">
      {#if isWorkspaceImportTask}
        <div class="footer-actions-left">
          <Button variant="ghost" size="sm" onclick={() => copyTaskLink(task.id)}>
            Copy link
          </Button>
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
      {:else}
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
                class="more-actions-trigger"
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
                    class="more-action-button agent"
                    disabled={busy || runBusy}
                  >
                    Reframe task...
                  </button>
                {/if}
                {#if canReworkTask}
                  <Button
                    variant="agent"
                    size="sm"
                    disabled={busy || runBusy}
                    onclick={handleOpenRework}
                  >
                    <Icon name="sparkles" size={14} />
                    Rework task...
                  </Button>
                {/if}
                {#if canSplitTask}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy || runBusy}
                    onclick={handleOpenSplit}
                  >
                    Split task...
                  </Button>
                {/if}
                {#if canHold}
                  {#if stageRerun}
                    <Button
                      variant="agent"
                      size="sm"
                      disabled={busy || rerunStageBusy !== null}
                      onclick={() => rerunStage(stageRerun.stage)}
                    >
                      <Icon name="sparkles" size={14} />
                      {rerunStageBusy === stageRerun.stage ? 'Re-running...' : stageRerun.label}
                    </Button>
                  {/if}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onclick={handleOpenHold}
                  >
                    Pause and keep in queue...
                  </Button>
                {/if}
                {#if !isShelved && canShelve}
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onclick={handleShelve}
                  >
                    Shelve task...
                  </Button>
                {/if}
              </div>
              {/if}
            </div>
          {/if}
          <Button variant="ghost" size="sm" onclick={() => copyTaskLink(task.id)}>
            Copy link
          </Button>
        </div>
        <div class="footer-actions-right">
          {#if firstOpenEscalation && !activeTabOwnsEscalationDecision}
            {#if firstOpenEscalationGuidance.actionOwner === 'user' && canReframeTask}
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || runBusy}
                onclick={handleOpenReframe}
              >
                Reframe task...
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
                I handled this...
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
        Use this when the task is still valid but should wait. Guildhall keeps
        it in the queue, skips it for now, and lets you resume it later. It does
        not stop a running Guildhall pass; use Stop first if Guildhall is
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
      Shelving removes this task from the active plan. Guildhall will not pick it
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
  :global(.drawer-outcome) span:last-child {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-relaxed);
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
  }
  .more-actions-trigger {
    appearance: none;
    border: 0;
    background: transparent;
    padding: 0;
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    font-family: inherit;
  }
  .more-actions.is-open .more-actions-trigger,
  .more-actions-trigger:hover,
  .more-actions-trigger:focus-visible {
    color: var(--text);
  }
  .more-action-menu {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--s-2));
    display: grid;
    gap: var(--s-2);
    min-width: 180px;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-raised);
    box-shadow: var(--shadow-lg);
    z-index: 20;
  }
  .more-action-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    padding: 0 var(--s-3);
    border: 1px solid transparent;
    border-radius: var(--r-1);
    font-family: inherit;
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-control);
    cursor: pointer;
    white-space: nowrap;
  }
  .more-action-button.agent {
    color: var(--text);
    border-color: rgba(139, 108, 255, 0.5);
    background: rgba(139, 108, 255, 0.22);
  }
  .more-action-button:hover:not(:disabled),
  .more-action-button:focus-visible {
    border-color: var(--accent);
    background: rgba(139, 108, 255, 0.32);
  }
  .more-action-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
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
