<!--
  Project root view. Shell layout:
    · Left rail (220px, collapses to 56px icon-only on medium viewports;
      mobile hides the rail until the hamburger opens a full-screen menu):
      primary nav entries + accordion sub-nav + Settings pinned as a utility
      to the bottom.
    · Top bar (slim): workspace name chip + run-status chip + Resume/Pause
      + New thread. No tab strip.
    · Main: the active view component (sub-paths pass a `subView` prop to
      surfaces that support it).
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import Icon, { type IconName } from '../lib/Icon.svelte'
  import Modal from '../lib/Modal.svelte'
  import AlertBand from '../../../packages/ui/src/components/AlertBand.svelte'
  import NoticeBand from '../../../packages/ui/src/components/NoticeBand.svelte'
  import StatusDot from '../lib/StatusDot.svelte'
  import ProjectShell from '../lib/layout/ProjectShell.svelte'
  import Tooltip from '../lib/Tooltip.svelte'
  import IntakeModal from './IntakeModal.svelte'
  import { project } from '../lib/project.svelte.js'
  import { onEvent } from '../lib/events.js'
  import { path, nav } from '../lib/nav.svelte.js'
  import { currentProjectHref, projectActionHref, projectFetch } from '../lib/project-routes.js'
  import { buildProjectTicker } from '../lib/project-activity.js'
  import { dedupeProjectAttention } from '../lib/project-attention.js'
  import { buildProviderIndicator } from '../lib/provider-indicator.js'
  import { formatUserPath } from '../lib/display-path.js'
  import { humanizeProjectName } from '../lib/project-name.js'
  import { isWorkerRunnableStatus } from '../lib/task-state.js'
  import { activeEscalations } from '../lib/escalation.js'
  import type { InboxItem } from '../lib/inbox-item-key.js'
  import type { AlertBandTone } from '../../../packages/ui/src/components/types.js'
  import type { AgentQuestion, EventEnvelope, ProjectDetail, ProjectMigrationStatus, ProjectMigrationStatusItem, ProjectView, ProviderStatus, StartReadiness, Task } from '../lib/types.js'

  type MigrationApplyStage = 'idle' | 'applying' | 'refreshing-project' | 'refreshing-inbox' | 'checking-status' | 'complete'
  type MigrationApplyResult = {
    applied?: ProjectMigrationStatusItem[]
    skipped?: ProjectMigrationStatusItem[]
    failed?: Array<ProjectMigrationStatusItem & { error?: string }>
  }

  const loadProjectOverviewTab = () => import('./project/ProjectOverviewTab.svelte')
  const loadThreadTab = () => import('./project/ThreadTab.svelte')
  const loadNeedsYouTab = () => import('./project/NeedsYouTab.svelte')
  const loadWorkTab = () => import('./project/WorkTab.svelte')
  const loadWorkspaceImportTab = () => import('./project/WorkspaceImportTab.svelte')
  const loadProjectAttachFlow = () => import('./project/ProjectAttachFlow.svelte')
  const loadFactsTab = () => import('./project/FactsTab.svelte')
  const loadTimelineTab = () => import('./project/TimelineTab.svelte')
  const loadReleaseTab = () => import('./project/ReleaseTab.svelte')
  const loadSettingsTab = () => import('./project/SettingsTab.svelte')
  const loadProjectMapTab = () => import('./project/ProjectMapTab.svelte')
  const loadProjectStructurePanel = () => import('./project/structure/ProjectStructurePanel.svelte')

  interface ShellAttentionNotice {
    id: string
    key?: string
    code?: string | null
    reason?: string | null
    message: string
    href?: string | null
    priority: number
    tone: AlertBandTone
    role: 'alert' | 'status'
    ariaLabel: string
    actionHref?: string | null
    actionLabel?: string | null
  }

  function readinessAttentionReason(readiness: StartReadiness | null | undefined): string | null {
    if (!readiness) return null
    if (readiness.code === 'no_unattended_progress') return readiness.focusKind ?? null
    if (readiness.code === 'owner_input_required') return 'awaiting_human'
    return null
  }

  interface Props {
    initialView?: ProjectView
    initialSub?: string | null
    projectId?: string | null
  }

  const props = $props<Props>()

  const currentView = $derived<ProjectView>(props.initialView ?? 'overview')
  const currentSub = $derived<string | null>(props.initialSub ?? null)
  const routeProjectId = $derived(props.projectId?.trim() || null)
  const activeProjectId = $derived(routeProjectId)
  let busy = $state(false)
  let optimisticRunStatus = $state<'running' | 'stopping' | null>(null)
  let runError = $state<string | null>(null)
  let intakeOpen = $state(false)
  let refreshHandle: ReturnType<typeof setInterval> | null = null
  let actionsMenuEl = $state<HTMLDivElement | null>(null)
  let actionsMenuOpen = $state(false)
  let railCollapsed = $state(true)
  let railForcedCollapsed = $state(false)
  let mobileRailOpen = $state(false)
  let railPreviewOpen = $state(false)
  let railPreference = $state<'collapsed' | 'expanded'>('collapsed')
  let navContextMode = $state<'project' | 'list' | 'detail' | 'split'>('project')
  let topbarLabelsCollapsed = $state(false)
  let newTaskInOverflow = $state(false)
  let migrationModalOpen = $state(false)
  let migrationStatus = $state<ProjectMigrationStatus | null>(null)
  let migrationStatusLoading = $state(false)
  let migrationApplyBusy = $state(false)
  let migrationApplyStage = $state<MigrationApplyStage>('idle')
  let migrationError = $state<string | null>(null)
  let migrationAppliedMessage = $state<string | null>(null)
  let migrationApplyResult = $state<MigrationApplyResult | null>(null)
  const RAIL_PREFERENCE_KEY = 'guildhall:project-rail'

  // Inbox blockers drive disabled-state on top-bar actions so hard blockers
  // (e.g. bootstrap not verified) can't be bypassed by pressing Resume.
  interface Blockers { bootstrap: boolean; workspaceImport: boolean }
  let blockers = $state<Blockers>({ bootstrap: false, workspaceImport: false })
  let inboxItems = $state<InboxItem[]>([])
  let inboxHistory = $state<InboxItem[]>([])
  let inboxLoaded = $state(false)
  let inboxError = $state<string | null>(null)
  let inboxLoadInFlight = false
  let inboxLoadQueued = false
  let latestTickerEvent = $state<EventEnvelope | null>(null)
  let tickerNow = $state(Date.now())
  const detail = $derived.by(() => {
    const current = project.detail
    if (!current) return null
    if (!activeProjectId || !current.id || current.id === activeProjectId) return current
    return null
  })
  const projectDisplayName = $derived(
    detail?.name?.trim() || humanizeProjectName(detail?.id ?? activeProjectId ?? 'Project'),
  )
  const pageMode = $derived<'document' | 'surface-fill'>(
    currentView === 'thread' ? 'surface-fill' : 'document',
  )
  const projectDetailSurface = $derived<'overview' | 'work' | 'map' | null>(
    currentView === 'overview' ? 'overview' : currentView === 'work' ? 'work' : currentView === 'map' ? 'map' : null,
  )
  const surfaceDetailPending = $derived.by(() => {
    if (!project.surfaceLoading || !detail) return false
    if (currentView === 'overview' || currentView === 'map') {
      return !detail.orientationSpine && !detail.tasks
    }
    if (currentView === 'work' || currentView === 'planner') return !('tasks' in detail)
    return false
  })
  const routeFocusedTaskId = $derived.by(() => {
    path.value
    if (currentView !== 'work' || typeof window === 'undefined') return null
    const params = new URL(window.location.href).searchParams
    return params.get('task') ?? params.get('work') ?? null
  })
  const RAIL_PREVIEW_OPEN_DELAY_MS = 150
  let railPreviewTimer = $state<ReturnType<typeof setTimeout> | null>(null)
  const projectDisplayPath = $derived(formatUserPath(project.detail?.path))
  const projectDisplayPathLeaf = $derived(projectDisplayPath.split('/').filter(Boolean).pop() ?? 'This project')

  $effect(() => {
    window.dispatchEvent(
      new CustomEvent('guildhall:set-project-title', {
        detail: { title: projectDisplayName },
      }),
    )
    return () => {
      window.dispatchEvent(
        new CustomEvent('guildhall:set-project-title', {
          detail: { title: null },
        }),
      )
    }
  })

  async function loadInbox(): Promise<void> {
    if (inboxLoadInFlight) {
      inboxLoadQueued = true
      return
    }
    inboxLoadInFlight = true
    try {
      const includeHistory = currentView === 'inbox' || currentSub === 'inbox'
      const endpoint = includeHistory ? '/api/project/inbox?includeHistory=true' : '/api/project/inbox?includeHistory=false'
      const r = await projectFetch(endpoint, { cache: 'no-store' }, activeProjectId)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as {
        items?: InboxItem[]
        history?: InboxItem[]
        blockers?: Blockers
      }
      inboxItems = j.items ?? []
      inboxHistory = j.history ?? inboxItems
      if (j.blockers) blockers = j.blockers
      inboxError = null
    } catch (err) {
      inboxError = err instanceof Error ? err.message : String(err)
    } finally {
      inboxLoaded = true
      inboxLoadInFlight = false
      if (inboxLoadQueued) {
        inboxLoadQueued = false
        void loadInbox()
      }
    }
  }

  $effect(() => {
    activeProjectId
    currentView
    currentSub
    void loadInbox()
  })
  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (
        t === 'agent_started' ||
        t === 'agent_finished' ||
        t === 'task_transition' ||
        t === 'tool_started' ||
        t === 'tool_completed' ||
        t === 'assistant_complete' ||
        t === 'line_complete' ||
        t === 'error' ||
        t === 'escalation_raised' ||
        t === 'provider_health_changed' ||
        t.startsWith('supervisor_')
      ) {
        latestTickerEvent = pickLatestEvent(latestTickerEvent, ev)
      }
      // Refresh on anything that might change inbox state.
      if (
        t.startsWith('task_') ||
        t.startsWith('escalation_') ||
        t.startsWith('bootstrap_') ||
        t.startsWith('supervisor_') ||
        t === 'provider_health_changed'
      ) {
        void loadInbox()
      }
    })
    return off
  })

  $effect(() => {
    path.value
    void project.refresh(routeProjectId, projectDetailSurface, routeFocusedTaskId)
  })

  $effect(() => {
    if (refreshHandle) clearInterval(refreshHandle)
    refreshHandle = setInterval(() => {
      void project.refresh(activeProjectId, projectDetailSurface, routeFocusedTaskId)
    }, 5000)
    return () => {
      if (refreshHandle) {
        clearInterval(refreshHandle)
        refreshHandle = null
      }
    }
  })

  $effect(() => {
    const media = window.matchMedia('(max-width: 920px)')
    const sync = () => {
      railForcedCollapsed = media.matches
      if (!railForcedCollapsed) mobileRailOpen = false
      if (railForcedCollapsed || railPreference === 'expanded') railPreviewOpen = false
      railCollapsed = railForcedCollapsed || railPreference === 'collapsed'
    }
    const saved = typeof window.localStorage?.getItem === 'function'
      ? window.localStorage.getItem(RAIL_PREFERENCE_KEY)
      : null
    if (saved === 'expanded' || saved === 'collapsed') {
      railPreference = saved
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  })

  $effect(() => {
    const compactLabels = window.matchMedia('(max-width: 720px)')
    const overflowNewTask = window.matchMedia('(max-width: 640px)')
    const sync = () => {
      topbarLabelsCollapsed = compactLabels.matches
      newTaskInOverflow = overflowNewTask.matches
    }
    sync()
    compactLabels.addEventListener('change', sync)
    overflowNewTask.addEventListener('change', sync)
    return () => {
      compactLabels.removeEventListener('change', sync)
      overflowNewTask.removeEventListener('change', sync)
    }
  })

  function toggleRail(): void {
    if (railForcedCollapsed) return
    railPreference = railCollapsed ? 'expanded' : 'collapsed'
    railCollapsed = railPreference === 'collapsed'
    railPreviewOpen = false
    if (typeof window.localStorage?.setItem === 'function') {
      window.localStorage.setItem(RAIL_PREFERENCE_KEY, railPreference)
    }
  }

  function cancelRailPreviewTimer(): void {
    if (railPreviewTimer) {
      clearTimeout(railPreviewTimer)
      railPreviewTimer = null
    }
  }

  function openRailPreviewImmediately(): void {
    cancelRailPreviewTimer()
    if (!railForcedCollapsed && railCollapsed) railPreviewOpen = true
  }

  let railPointerFocusGuard = false
  let railPointerFocusTimer: ReturnType<typeof setTimeout> | null = null

  function handleRailPointerDown(): void {
    railPointerFocusGuard = true
    cancelRailPreviewTimer()
    if (railPointerFocusTimer) clearTimeout(railPointerFocusTimer)
    railPointerFocusTimer = setTimeout(() => {
      railPointerFocusGuard = false
      railPointerFocusTimer = null
    }, 0)
  }

  function handleRailFocusIn(): void {
    if (railPointerFocusGuard) return
    openRailPreviewImmediately()
  }

  function scheduleRailPreviewOpen(): void {
    if (railForcedCollapsed || !railCollapsed) return
    cancelRailPreviewTimer()
    railPreviewTimer = window.setTimeout(() => {
      railPreviewTimer = null
      if (!railForcedCollapsed && railCollapsed) railPreviewOpen = true
    }, RAIL_PREVIEW_OPEN_DELAY_MS)
  }

  function closeRailPreview(event?: FocusEvent | MouseEvent): void {
    cancelRailPreviewTimer()
    if (railForcedCollapsed || !railCollapsed) return
    const current = event?.currentTarget
    const related = event?.relatedTarget
    if (current instanceof HTMLElement && related instanceof Node && current.contains(related)) return
    railPreviewOpen = false
  }

  const railOverlayOpen = $derived(railForcedCollapsed && mobileRailOpen)
  const railLabelsVisible = $derived(!railCollapsed || railPreviewOpen || railOverlayOpen)

  function closeMobileRail(): void {
    mobileRailOpen = false
  }

  function toggleMobileRail(): void {
    if (!railForcedCollapsed) return
    mobileRailOpen = !mobileRailOpen
  }

  $effect(() => {
    window.addEventListener('guildhall:toggle-project-nav', toggleMobileRail)
    return () => window.removeEventListener('guildhall:toggle-project-nav', toggleMobileRail)
  })

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && mobileRailOpen) closeMobileRail()
  }

  $effect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<{ surface?: string; mode?: 'project' | 'list' | 'detail' | 'split' }>).detail
      navContextMode = detail?.mode ?? 'project'
    }
    window.addEventListener('guildhall:set-nav-context', handle as EventListener)
    return () => window.removeEventListener('guildhall:set-nav-context', handle as EventListener)
  })

  $effect(() => {
    if (railForcedCollapsed && currentView === 'thread' && navContextMode === 'detail' && mobileRailOpen) {
      mobileRailOpen = false
    }
  })

  $effect(() => {
    return () => {
      cancelRailPreviewTimer()
      if (railPointerFocusTimer) clearTimeout(railPointerFocusTimer)
    }
  })

  $effect(() => {
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (t.startsWith('supervisor_') || t === 'provider_health_changed') void project.refresh(activeProjectId)
    })
    return off
  })

  type NavSectionId = ProjectView | 'project'

  interface NavEntry {
    id: NavSectionId
    label: string
    icon: IconName
    suffix: string
    subs?: Array<{ id: string; label: string; path: string }>
  }

  const needsMeta = $derived(
    (project.detail?.coordinatorCount ?? project.detail?.config?.coordinators?.length ?? 0) === 0,
  )
  const entries = $derived<NavEntry[]>([
    {
      id: 'project',
      label: 'Project',
      icon: 'activity',
      suffix: '/overview',
      subs: [
        { id: 'overview', label: 'Overview', path: currentProjectHref('/overview', activeProjectId) },
        { id: 'inbox', label: 'Needs you', path: currentProjectHref('/overview/inbox', activeProjectId) },
        { id: 'map', label: 'Map', path: currentProjectHref('/map', activeProjectId) },
        { id: 'facts', label: 'Facts', path: currentProjectHref('/facts', activeProjectId) },
        { id: 'structure', label: 'Structure', path: currentProjectHref('/structure', activeProjectId) },
      ],
    },
    { id: 'thread', label: 'Threads', icon: 'sparkles', suffix: '/thread' },
    {
      id: 'work',
      label: 'Work',
      icon: 'list-checks',
      suffix: '/work',
      subs: [
        { id: 'queue', label: 'Queue', path: currentProjectHref('/work?view=list', activeProjectId) },
        { id: 'board', label: 'Board', path: currentProjectHref('/work?view=board', activeProjectId) },
      ],
    },
    { id: 'timeline', label: 'Timeline', icon: 'clock', suffix: '/timeline' },
    {
      id: 'release',
      label: 'Release',
      icon: 'check-circle-2',
      suffix: '/release',
      subs: [
        { id: 'verdict', label: 'Summary', path: currentProjectHref('/release', activeProjectId) },
        { id: 'criteria', label: 'Checks', path: currentProjectHref('/release/criteria', activeProjectId) },
      ],
    },
  ])
  const settingsPath = $derived(currentProjectHref('/settings', activeProjectId))
  const canRenderWithoutProjectDetail = $derived(
    currentView === 'thread' ||
    currentView === 'inbox' ||
    currentView === 'release',
  )
  const showingCompactThreadDetail = $derived(
    railForcedCollapsed && currentView === 'thread' && navContextMode === 'detail',
  )
  const topbarBackLabel = $derived(showingCompactThreadDetail ? 'Threads' : 'Projects')
  const topbarBackTitle = $derived(showingCompactThreadDetail ? 'Back to Threads' : 'Back to Projects')
  const showTopbarBackLabel = $derived(showingCompactThreadDetail || !topbarLabelsCollapsed)

  function go(href: string) {
    closeMobileRail()
    nav(href)
  }

  function sectionIsActive(id: NavSectionId) {
    if (id === 'project') return currentView === 'overview' || currentView === 'map' || currentView === 'facts' || currentView === 'structure'
    return currentView === id
  }

  function railSubIsActive(sectionId: NavSectionId, subId: string, subPath: string) {
    if (path.value === subPath) return true

    if (sectionId === 'project') {
      if (currentView === 'overview') return currentSub === 'inbox' ? subId === 'inbox' : subId === 'overview'
      if (currentView === 'map') return subId === 'map'
      if (currentView === 'facts') return subId === 'facts'
      if (currentView === 'structure') return subId === 'structure'
    }

    if (sectionId === 'work' && currentView === 'work') {
      return path.href.includes('view=board') ? subId === 'board' : subId === 'queue'
    }

    if (sectionId === 'release' && currentView === 'release') {
      return currentSub === 'criteria' ? subId === 'criteria' : subId === 'verdict'
    }

    return false
  }

  function handleTopbarBack(): void {
    if (showingCompactThreadDetail) {
      window.dispatchEvent(new CustomEvent('guildhall:thread-show-list'))
      return
    }
    go('/')
  }

  function closeActionsMenu(): void {
    actionsMenuOpen = false
  }

  function toggleActionsMenu(event: MouseEvent): void {
    event.stopPropagation()
    actionsMenuOpen = !actionsMenuOpen
  }

  function handleDocumentClick(event: MouseEvent): void {
    const target = event.target
    if (!(target instanceof Node)) return
    if (!actionsMenuEl?.contains(target)) {
      actionsMenuOpen = false
    }
  }

  async function start(mode: 'continuous' | 'one_task' = 'continuous') {
    busy = true
    optimisticRunStatus = 'running'
    runError = null
    try {
      const res = await projectFetch('/api/project/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      }, activeProjectId)
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string; code?: string }
          runError = body.error ?? `Resume failed (HTTP ${res.status})`
        } catch {
          runError = `Resume failed (HTTP ${res.status})`
        }
        optimisticRunStatus = null
        return
      }
      setTimeout(() => void project.refresh(activeProjectId), 300)
      setTimeout(() => {
        void project.refresh(activeProjectId)
        void loadInbox()
      }, 1500)
      setTimeout(() => {
        void project.refresh(activeProjectId)
        void loadInbox()
      }, 3200)
    } finally {
      busy = false
    }
  }

  async function stop() {
    busy = true
    optimisticRunStatus = 'stopping'
    runError = null
    try {
      const res = await projectFetch('/api/project/stop', { method: 'POST' }, activeProjectId)
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string }
          runError = body.error ?? `Pause failed (HTTP ${res.status})`
        } catch {
          runError = `Pause failed (HTTP ${res.status})`
        }
        optimisticRunStatus = null
        return
      }
      setTimeout(() => void project.refresh(activeProjectId), 300)
    } finally {
      busy = false
    }
  }

  async function loadMigrationStatus(): Promise<void> {
    migrationStatusLoading = true
    migrationError = null
    try {
      const res = await projectFetch('/api/project/migrations', { cache: 'no-store' }, activeProjectId)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      migrationStatus = (await res.json()) as ProjectMigrationStatus
    } catch (err) {
      migrationError = err instanceof Error ? err.message : String(err)
    } finally {
      migrationStatusLoading = false
    }
  }

  async function openMigrationModal(): Promise<void> {
    migrationModalOpen = true
    migrationAppliedMessage = null
    migrationApplyResult = null
    migrationApplyStage = 'idle'
    await loadMigrationStatus()
  }

  function closeMigrationModal(): void {
    if (migrationApplyBusy) return
    migrationModalOpen = false
  }

  $effect(() => {
    path.href
    if (typeof window === 'undefined') return
    if (new URL(window.location.href).searchParams.get('repair') !== 'migration') return
    void openMigrationModal()
  })

  async function applyRequiredMigration(): Promise<void> {
    const migration = primaryRequiredMigration
    if (!migration) return
    migrationApplyBusy = true
    migrationApplyStage = 'applying'
    migrationError = null
    migrationAppliedMessage = null
    migrationApplyResult = null
    try {
      const res = await projectFetch('/api/project/migrations/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ includePrompt: true, migrationId: migration.id }),
      }, activeProjectId)
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        status?: ProjectMigrationStatus
        result?: MigrationApplyResult
      }
      if (!res.ok || body.result?.failed?.length) {
        const failed = body.result?.failed?.[0]
        throw new Error(failed?.error ?? body.error ?? `Migration failed (HTTP ${res.status})`)
      }
      migrationStatus = body.status ?? null
      migrationApplyResult = body.result ?? null
      migrationApplyStage = 'refreshing-project'
      await project.refresh(activeProjectId)
      migrationApplyStage = 'refreshing-inbox'
      await loadInbox()
      if (!body.status) {
        migrationApplyStage = 'checking-status'
        await loadMigrationStatus()
      }
      migrationApplyStage = 'complete'
      migrationAppliedMessage = 'Migration complete.'
    } catch (err) {
      migrationError = err instanceof Error ? err.message : String(err)
      migrationApplyStage = 'idle'
    } finally {
      migrationApplyBusy = false
    }
  }

  function newTask() {
    intakeOpen = true
  }

  function bootstrapOutputLine(output: string): string | null {
    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line.length > 0 &&
        !line.startsWith('>') &&
        !line.startsWith('Scope:') &&
        !line.startsWith(' ERR_PNPM_') &&
        !line.startsWith(' ELIFECYCLE'),
      )
    return lines.find(line => /\berror\b|failed|Cannot find module|command not found|spawn ENOENT/i.test(line)) ?? lines[0] ?? null
  }

  function eventAtMillis(event: EventEnvelope | null | undefined): number {
    const at = event?.at
    if (!at) return -1
    const value = Date.parse(at)
    return Number.isFinite(value) ? value : -1
  }

  function pickLatestEvent(current: EventEnvelope | null, candidate: EventEnvelope | null): EventEnvelope | null {
    if (!candidate) return current
    if (!current) return candidate
    return eventAtMillis(candidate) >= eventAtMillis(current) ? candidate : current
  }

  function hasVisibleUnansweredQuestion(task: Task): boolean {
    const status = task.status ?? ''
    if (['done', 'shelved', 'blocked', 'pending_pr'].includes(status)) return false
    return (task.openQuestions ?? []).some((question: AgentQuestion) => !question.answeredAt)
  }

  function isClosedTaskStatus(status: string): boolean {
    return status === 'done' || status === 'shelved' || status === 'pending_pr'
  }

  $effect(() => {
    latestTickerEvent = (detail?.recentEvents ?? []).reduce<EventEnvelope | null>(
      (current, candidate) => pickLatestEvent(current, candidate),
      null,
    )
  })
  $effect(() => {
    const handle = setInterval(() => {
      tickerNow = Date.now()
    }, 5000)
    return () => clearInterval(handle)
  })
  const actualRunStatus = $derived(detail?.run?.status ?? 'stopped')
  const runStatus = $derived(optimisticRunStatus ?? actualRunStatus)
  $effect(() => {
    if (optimisticRunStatus === 'running' && actualRunStatus === 'running') optimisticRunStatus = null
    if (optimisticRunStatus === 'stopping' && actualRunStatus !== 'running') optimisticRunStatus = null
  })
  const runMode = $derived(detail?.run?.mode === 'one_task' ? 'one_task' : 'continuous')
  const availabilityStatus = $derived(detail?.availability?.status ?? 'active')
  const availabilityPaused = $derived(availabilityStatus === 'paused')
  const providerStatus = $derived(detail?.providerStatus ?? detail?.run?.providerStatus ?? null)
  const startReadiness = $derived(detail?.startReadiness ?? null)
  const primaryAction = $derived(detail?.actionModel?.primaryAction ?? null)
  const actionRunControl = $derived(detail?.actionModel?.runControl ?? null)
  // Both fields are projections of the selected release. Older compact reads
  // may omit `decision`, so lifecycle truth must not depend on that optional
  // presentation field and resurrect stale owner urgency after shipment.
  const selectedReleaseShipped = $derived(
    detail?.decision?.release?.lifecycleState === 'shipped' ||
    detail?.releaseReadiness?.release?.state === 'shipped' ||
    detail?.releaseReadiness?.scope?.state === 'shipped',
  )
  const providerIndicator = $derived(buildProviderIndicator(providerStatus, runStatus))
  const providerHeaderLabel = $derived(providerIndicator?.summaryLabel ?? null)
  const providerDecisionText = $derived(
    providerStatus?.decisions?.[0]?.message ?? providerStatus?.reason ?? null,
  )
  const providerDecisionSeverity = $derived(
    providerStatus?.decisions?.[0]?.severity ?? 'info',
  )
  const providerNoticeText = $derived(
    !selectedReleaseShipped && providerStatus?.fallback
      ? providerDecisionText ??
        'Preferred provider is unavailable; this run is using a fallback.'
      : null,
  )
  const providerWarningText = $derived(
    selectedReleaseShipped ? null : providerStatus?.warnings?.[0]?.message ?? null,
  )
  const providerWarningSeverity = $derived(
    providerStatus?.warnings?.[0]?.severity ?? 'info',
  )
  const providerHealthText = $derived(
    !selectedReleaseShipped && providerStatus?.health?.state === 'degraded'
      ? `${providerHeaderLabel ?? 'Current provider'} has seen ${providerStatus.health.consecutiveFailures} consecutive pooled failures${providerStatus.health.lastError ? ` (${providerStatus.health.lastError})` : ''}.`
      : null,
  )
  const allTerminalStart = $derived(startReadiness?.code === 'all_terminal')
  const requiredMigrationBlocked = $derived(startReadiness?.code === 'required_migration_pending')
  const primaryRequiredMigration = $derived<ProjectMigrationStatusItem | null>(migrationStatus?.blocked?.[0] ?? null)
  const migrationProgressLabel = $derived.by(() => {
    switch (migrationApplyStage) {
      case 'applying': return 'Applying migration'
      case 'refreshing-project': return 'Refreshing project state'
      case 'refreshing-inbox': return 'Refreshing Needs You'
      case 'checking-status': return 'Checking remaining migrations'
      case 'complete': return 'Migration complete'
      default: return null
    }
  })
  const migrationChangedPaths = $derived.by(() => {
    const paths = migrationApplyResult?.applied?.flatMap(item => item.affectedPaths ?? []) ?? []
    return [...new Set(paths)].slice(0, 8)
  })
  function orientationLabel(value: unknown): string | null {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    if (value && typeof value === 'object') {
      const label = (value as { label?: unknown }).label
      return typeof label === 'string' && label.trim().length > 0 ? label.trim() : null
    }
    return null
  }
  const allTerminalReviewNotice = $derived.by(() => {
    if (!allTerminalStart) return null
    // Source-map gaps describe documentation provenance, not a release
    // blocker. A closed release must remain closed in the shell even when its
    // descriptive spine still contains non-blocking source cleanup notes.
    if (detail?.releaseReadiness?.ready === true) return null
    const spine = detail?.orientationSpine
    const releaseBlockerCount = detail?.releaseReadiness?.releaseBlockers?.length ?? 0
    const actionableGap = spine?.gaps?.find(gap => [
      'source_conflict',
      'missing_charter',
      'missing_execution_boundary',
      'needs_breakdown',
    ].includes(gap.kind))
    const gapCount = releaseBlockerCount > 0 || actionableGap ? Math.max(1, releaseBlockerCount) : 0
    const topBlocker = releaseBlockerCount > 0
      ? orientationLabel(spine?.summary?.topBlocker)
      : orientationLabel(actionableGap?.label)
    if (gapCount <= 0 && !topBlocker) return null
    return {
      message: orientationLabel(spine?.summary?.headline) ?? 'Current scope needs review.',
      detail: topBlocker ?? orientationLabel(spine?.summary?.nextAction),
    }
  })
  const allTerminalReadinessMessage = $derived(
    selectedReleaseShipped
      ? 'Release shipped.'
      : allTerminalStart && !allTerminalReviewNotice
        ? startReadiness?.message ?? 'All tasks are already finished.'
      : null,
  )
  const projectTicker = $derived(buildProjectTicker(detail, latestTickerEvent, new Date(tickerNow)))
  const currentScopedTasks = $derived.by(() => {
    const tasks = detail?.tasks ?? []
    const includedRows = detail?.orientationSpine?.scopeRows?.filter(row => row.scope === 'included') ?? []
    if (includedRows.length === 0) return tasks
    const includedTaskIds = new Set(includedRows.map(row => row.taskId))
    return tasks.filter(task => includedTaskIds.has(task.id))
  })
  const currentStopSummary = $derived.by(() => {
    if (runStatus === 'running' || runStatus === 'stopping') return null
    const tasks = currentScopedTasks
    if (tasks.length === 0) return null
    const counts = {
      active: 0,
      fresh: 0,
      done: 0,
      blocked: 0,
      shelved: 0,
      escalated: 0,
      waitingOnUser: 0,
      awaitingApproval: 0,
      draftReview: 0,
      dependencyBlocked: 0,
    }
    for (const task of tasks) {
      const status = task.status ?? ''
      const closed = isClosedTaskStatus(status)
      if (hasVisibleUnansweredQuestion(task)) counts.waitingOnUser += 1
      if (!closed && activeEscalations(task).length > 0) counts.escalated += 1
      if (!closed && status === 'spec_review') counts.awaitingApproval += 1
      if (!closed && status === 'import_draft') counts.draftReview += 1
      if (status === 'blocked') counts.blocked += 1
      if (status === 'done') counts.done += 1
      if (status === 'shelved') counts.shelved += 1
      if (!closed && (status === 'proposed' || status === 'ready' || status === 'import_draft')) counts.fresh += 1
      if (!closed && (status === 'exploring' || status === 'in_progress' || status === 'review' || status === 'gate_check')) counts.active += 1
      const dependencyBlocked =
        !closed &&
        typeof task.blockReason === 'string' &&
        /dependency/i.test(task.blockReason)
      if (dependencyBlocked) counts.dependencyBlocked += 1
    }
    if (counts.active > 0 || counts.fresh > 0) return null
    if (counts.waitingOnUser > 0 || counts.awaitingApproval > 0 || counts.draftReview > 0) {
      return {
        stopReason: 'awaiting_human',
        stopMessage: 'Waiting on input.',
        attentionCode: counts.awaitingApproval > 0
          ? 'no_unattended_progress'
          : counts.draftReview > 0
            ? 'import_drafts_waiting'
            : counts.waitingOnUser > 0
              ? 'owner_input_required'
              : null,
        attentionReason: counts.awaitingApproval > 0
          ? 'spec_review'
          : counts.draftReview > 0
            ? null
            : counts.waitingOnUser > 0
              ? 'awaiting_human'
              : null,
        idleSummary: { counts },
      }
    }
    if (counts.escalated > 0 || counts.blocked > 0) {
      return {
        stopReason: 'blocked_only',
        stopMessage: 'Blocked.',
        idleSummary: { counts },
      }
    }
    if (counts.dependencyBlocked > 0) {
      return {
        stopReason: 'dependency_blocked',
        stopMessage: 'Blocked on dependencies.',
        idleSummary: { counts },
      }
    }
    if (counts.done + counts.blocked + counts.shelved === tasks.length) {
      return {
        stopReason: 'all_terminal',
        stopMessage: counts.done ? `Run finished: ${counts.done} done.` : 'Run finished.',
        idleSummary: { counts },
      }
    }
    return null
  })
  const hasCurrentQueueActivity = $derived.by(() => {
    const tasks = currentScopedTasks
    return tasks.some((task) => {
      const status = task.status ?? ''
      if (isClosedTaskStatus(status)) return false
      const hasUnansweredQuestion = hasVisibleUnansweredQuestion(task)
      const hasOpenEscalation = activeEscalations(task).length > 0
      return (
        hasUnansweredQuestion ||
        hasOpenEscalation ||
        ['proposed', 'import_draft', 'exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check'].includes(status)
      )
    })
  })
  const runStopSummary = $derived.by(() => {
    if (startReadiness?.code === 'required_migration_pending') {
      return {
        stopReason: 'required_migration_pending',
        stopMessage: startReadiness.message ?? 'Run the required migration before starting this project.',
      }
    }
    if (startReadiness?.code === 'owner_input_required') {
      return {
        stopReason: 'awaiting_human',
        stopMessage: startReadiness.message ?? 'Waiting on your answer.',
        attentionCode: startReadiness.code,
        attentionReason: readinessAttentionReason(startReadiness),
      }
    }
    if (currentStopSummary) return currentStopSummary
    if (hasCurrentQueueActivity) return null
    if (detail?.run?.stopSummary) return detail.run.stopSummary
    const latestStop = [...(detail?.recentEvents ?? [])]
      .reverse()
      .find((entry) => entry.event?.type === 'supervisor_stopped')
    if (!latestStop?.event?.message) return null
    return {
      stopReason: latestStop.event.reason,
      stopMessage: latestStop.event.message,
    }
  })
  const runStopSummarySeverity = $derived<'info' | 'warn' | 'error'>(() => {
    const reason = runStopSummary?.stopReason
    if (!reason) return 'info'
    if (reason === 'awaiting_human' || reason === 'blocked_only' || reason === 'dependency_blocked' || reason === 'required_migration_pending') return 'warn'
    return 'info'
  })

  function shellAlertTone(severity: 'info' | 'warn' | 'error'): AlertBandTone {
    if (severity === 'error') return 'danger'
    if (severity === 'warn') return 'warn'
    return 'accent'
  }
  const runStopSummaryText = $derived.by(() => {
    if (selectedReleaseShipped) return null
    if (runStatus === 'running' || runStatus === 'stopping') return null
    if (allTerminalStart) return null
    const summary = runStopSummary
    if (!summary?.stopMessage) return null
    if (startReadinessNoticeHref && summary.stopReason === 'all_terminal') return null
    const counts = summary.idleSummary?.counts
    if (!counts) {
      if (summary.stopReason === 'one_task') return 'One task finished.'
      return summary.stopMessage
    }
    switch (summary.stopReason) {
      case 'all_terminal':
        return counts.done ? `Run finished: ${counts.done} done.` : 'Run finished.'
      case 'awaiting_human': {
        const fragments: string[] = []
        if (counts.waitingOnUser) fragments.push(`${counts.waitingOnUser} waiting on you`)
        if (counts.draftReview) fragments.push(`${counts.draftReview} draft${counts.draftReview === 1 ? '' : 's'} to review`)
        if (counts.awaitingApproval) fragments.push(`${counts.awaitingApproval} awaiting approval`)
        return fragments.length > 0 ? `Waiting on input: ${fragments.join(' · ')}.` : 'Waiting on input.'
      }
      case 'blocked_only':
        return counts.escalated
          ? `Blocked: ${counts.escalated} escalated.`
          : counts.blocked
            ? `Blocked: ${counts.blocked} task${counts.blocked === 1 ? '' : 's'}.`
            : 'Blocked.'
      case 'dependency_blocked':
        return counts.dependencyBlocked
          ? `Blocked on dependencies: ${counts.dependencyBlocked}.`
          : 'Blocked on dependencies.'
      case 'one_task':
        return counts.awaitingApproval
          ? 'One task pass finished. Review the updated draft in Thread.'
          : counts.waitingOnUser
            ? 'One task pass finished. Waiting on your input.'
            : counts.done
              ? `One task pass finished: ${counts.done} done.`
              : 'One task pass finished.'
      default: {
        const fragments: string[] = []
        if (counts.done) fragments.push(`${counts.done} done`)
        if (counts.blocked) fragments.push(`${counts.blocked} blocked`)
        if (counts.waitingOnUser) fragments.push(`${counts.waitingOnUser} waiting on you`)
        if (counts.awaitingApproval) fragments.push(`${counts.awaitingApproval} awaiting approval`)
        if (counts.dependencyBlocked) fragments.push(`${counts.dependencyBlocked} dependency-blocked`)
        if (counts.escalated) fragments.push(`${counts.escalated} escalated`)
        return fragments.length > 0 ? `${summary.stopMessage} (${fragments.join(' · ')})` : summary.stopMessage
      }
    }
  })
  const runStopActionHref = $derived.by(() => {
    if (runStopSummary?.stopReason === 'awaiting_human') {
      return projectActionHref(primaryAction?.href ?? startReadiness?.actionHref ?? '/overview/inbox', activeProjectId)
    }
    if (runStopSummary?.stopReason === 'required_migration_pending') {
      return projectActionHref(startReadiness?.actionHref ?? '/migrations', activeProjectId)
    }
    if (runStopSummary?.stopReason === 'blocked_only') {
      return currentProjectHref('/overview', activeProjectId)
    }
    return null
  })
  const runStopActionLabel = $derived(
    runStopSummary?.stopReason === 'awaiting_human'
      ? primaryAction?.buttonLabel ?? startReadinessActionLabel(startReadiness)
      : runStopSummary?.stopReason === 'required_migration_pending'
        ? 'Migrate project'
      : runStopSummary?.stopReason === 'blocked_only'
        ? 'Open Overview'
        : null,
  )
  const failedBootstrapStep = $derived(
    detail?.bootstrapStatus?.success === false
      ? detail.bootstrapStatus.steps?.find(s => s.result === 'fail') ?? null
      : null,
  )
  const startReadinessNoticeHref = $derived.by(() => {
    if (selectedReleaseShipped || !startReadiness || startReadiness.canStart || allTerminalStart || requiredMigrationBlocked) return null
    if (primaryAction?.href) return projectActionHref(primaryAction.href, activeProjectId)
    if (startReadiness.actionHref) return projectActionHref(startReadiness.actionHref, activeProjectId)
    if (metaIntakePending) return currentProjectHref('/setup', activeProjectId)
    if (blockers.bootstrap) return currentProjectHref('/settings/ready', activeProjectId)
    return null
  })
  const startReadinessNoticeLabel = $derived.by(() => {
    if (!startReadinessNoticeHref) return null
    if (primaryAction?.buttonLabel) return primaryAction.buttonLabel
    if (metaIntakePending) return 'Open project setup'
    if (startReadiness?.code === 'import_drafts_waiting') return 'Review drafts'
    if (blockers.bootstrap) return 'Open readiness checks'
    return startReadinessActionLabel(startReadiness)
  })
  const shellAttentionNotices = $derived.by(() => {
    // Overview owns the project-level decision. Repeating it in shell chrome
    // turns one action into competing instructions before the owner reaches
    // the surface that can actually explain and complete it.
    if (!detail || selectedReleaseShipped || currentView === 'overview') return []
    const notices: ShellAttentionNotice[] = []
    if (startReadinessNoticeHref && startReadinessNoticeLabel && startReadiness?.message) {
      notices.push({
        id: 'start-readiness',
        code: startReadiness.code,
        reason: readinessAttentionReason(startReadiness),
        message: startReadiness.message,
        href: startReadinessNoticeHref,
        priority: 10,
        tone: 'attention',
        role: 'alert',
        ariaLabel: 'Needs you',
        actionHref: startReadinessNoticeHref,
        actionLabel: startReadinessNoticeLabel,
      })
    }
    if (runStopSummaryText) {
      const runStopTone = shellAlertTone(runStopSummarySeverity)
      notices.push({
        id: 'run-stop-summary',
        code: runStopSummary?.attentionCode ?? null,
        reason: runStopSummary?.attentionReason ?? runStopSummary?.stopReason ?? null,
        message: runStopSummaryText,
        href: runStopActionHref,
        priority: 20,
        tone: runStopTone,
        role: runStopTone === 'accent' ? 'status' : 'alert',
        ariaLabel: runStopTone === 'danger' ? 'Blocked' : runStopTone === 'warn' ? 'Needs attention' : 'Status',
        actionHref: runStopActionHref,
        actionLabel: runStopActionLabel,
      })
    }
    return dedupeProjectAttention(notices)
  })
  const bootstrapFailureText = $derived.by(() => {
    if (selectedReleaseShipped) return null
    const step = failedBootstrapStep
    if (!step) return null
    const command = step.command ?? 'Bootstrap'
    const exit = typeof step.exitCode === 'number' ? ` exited ${step.exitCode}` : ' failed'
    const usefulLine = bootstrapOutputLine(step.output ?? '')
    return usefulLine ? `${command}${exit}: ${usefulLine}` : `${command}${exit}.`
  })

  // Project phase surfaced in the top-bar chip. Distinguishes "setup isn't
  // done yet" (hard blockers open, or no coordinator) from "operating — just
  // not currently running". Gives the user a clear mental model of what the
  // controls actually do right now.
  type Phase = 'setting-up' | 'paused' | 'stable' | 'running' | 'error'
  const phase = $derived<Phase>(
    runStatus === 'error'
      ? 'error'
      : runStatus === 'running'
        ? 'running'
        : selectedReleaseShipped
          ? 'stable'
        : availabilityPaused
          ? 'paused'
        : needsMeta || blockers.bootstrap
          ? 'setting-up'
          : activeCount === 0 && awaitingApprovalCount === 0 && taskList.length > 0
            ? 'stable'
          : 'paused',
  )
  const phaseLabel = $derived(
    phase === 'setting-up'
      ? 'Setting up'
      : phase === 'running'
        ? 'Running'
        : phase === 'error'
          ? 'Error'
          : phase === 'stable'
            ? 'Stable'
          : 'Paused',
  )
  const phaseTone = $derived(
    phase === 'running'
      ? 'ok'
      : phase === 'error'
        ? 'danger'
        : phase === 'setting-up'
          ? 'warn'
          : phase === 'stable'
            ? 'ok'
          : 'neutral',
  )
  // Task counts for the top-bar indicator. Stuck = has at least one open
  // escalation. Active = running/in-progress-like statuses.
  const taskList = $derived(detail?.tasks ?? [])
  const metaIntakePending = $derived(
    taskList.some(t => {
      const id = (t as { id?: string }).id
      const status = (t as { status?: string }).status
      return id === 'task-meta-intake' && status !== 'done' && status !== 'shelved'
    }),
  )
  const activeCount = $derived(
    taskList.filter(t => {
      const s = (t as { status?: string }).status
      if (!s || ['done', 'blocked', 'cancelled', 'archived', 'spec_review', 'shelved', 'import_draft'].includes(s)) return false
      return isWorkerRunnableStatus(t)
    }).length,
  )
  const awaitingApprovalCount = $derived(
    taskList.filter(t => (t as { status?: string }).status === 'spec_review').length,
  )

  const startDisabledReason = $derived(
    actionRunControl?.startEnabled === false
      ? actionRunControl.disabledReason ?? 'Finish setup before starting'
      : requiredMigrationBlocked
      ? startReadiness?.message ?? 'Run the required migration before starting this project'
      : !startReadiness?.canStart
      ? startReadiness?.message ?? 'Finish setup before starting'
      : activeCount === 0 && awaitingApprovalCount === 0 && taskList.length > 0
        ? 'No tasks to start'
      : null,
  )
  const newTaskDisabledReason = $derived(
    requiredMigrationBlocked
      ? startReadiness?.message ?? 'Run the required migration before creating a request'
      : needsMeta
      ? 'Finish project setup before creating a request'
      : blockers.bootstrap
        ? failedBootstrapStep
          ? 'Fix the bootstrap failure before creating a request'
          : 'Complete bootstrap in Thread before creating a request'
        : null,
  )
  const showRunButton = $derived(
    !selectedReleaseShipped &&
      (
        availabilityPaused ||
        runStatus === 'running' ||
        runStatus === 'stopping' ||
        (!allTerminalStart && (!availabilityPaused || startDisabledReason !== 'No tasks to start'))
      ),
  )
  const runControlPauses = $derived(
    runStatus === 'running' ||
      runStatus === 'stopping' ||
      (
        !availabilityPaused &&
        actionRunControl?.pauseEnabled === true &&
        actionRunControl?.startEnabled === false &&
        !requiredMigrationBlocked
      ),
  )
  const pausedBlockedControl = $derived(
    runControlPauses && runStatus !== 'running' && runStatus !== 'stopping',
  )
  const runButtonIdleLabel = $derived(
    actionRunControl?.label && actionRunControl.startEnabled === false
      ? actionRunControl.label
    : requiredMigrationBlocked
      ? 'Migrate'
    : startReadiness?.canStart === false
      ? startReadinessActionLabel(startReadiness)
      : 'Resume',
  )
  const showAdvanceOneTaskAction = $derived(
    !selectedReleaseShipped && !allTerminalStart,
  )

  function startReadinessActionLabel(readiness: StartReadiness | null | undefined): string {
    if (!readiness) return 'Open next action'
    if (readiness.code === 'owner_input_required') {
      if (readiness.focusKind === 'blocked_work') return 'Needs recovery'
      return readiness.focusKind === 'spec_review' ? 'Review spec' : 'Answer question'
    }
    if (readiness.code === 'import_drafts_waiting') return 'Review drafts'
    if (readiness.code === 'proof_evidence_missing') return 'Attach proof'
    if (readiness.code === 'repository_followup_required') return 'Open release'
    if (readiness.code === 'no_unattended_progress') {
      if (readiness.focusKind === 'spec_review') return readiness.count && readiness.count > 1 ? 'Review next spec' : 'Review spec'
      if (readiness.focusKind === 'brief_cleanup') return 'Review brief'
      if (readiness.focusKind === 'blocked_work') return 'Review recovery'
    }
    return 'Open next action'
  }
</script>

<svelte:document onclick={handleDocumentClick} />
<svelte:window onkeydown={handleKeydown} />

{#if detail?.initializationNeeded}
  <ProjectShell
    uninitialized
      pageMode={pageMode}
    railCollapsed={railCollapsed && !railOverlayOpen}
    railPreviewOpen={railPreviewOpen}
    mobileRailMode={railForcedCollapsed}
    railOverlayOpen={railOverlayOpen}
  >
    {#snippet rail()}
    {#if railOverlayOpen}
      <button type="button" class="rail-scrim" aria-hidden="true" tabindex="-1" onclick={closeMobileRail}></button>
    {/if}
    <aside
      class="rail"
      class:rail-collapsed={railCollapsed && !railOverlayOpen}
      class:rail-mobile-open={railOverlayOpen}
      class:rail-preview-open={railPreviewOpen}
      aria-label="Project navigation"
      onmouseenter={scheduleRailPreviewOpen}
      onmouseleave={closeRailPreview}
      onpointerdown={handleRailPointerDown}
      onfocusin={handleRailFocusIn}
      onfocusout={closeRailPreview}
    >
      <div class="rail-head" title={projectDisplayPath}>
        <div class="rail-head-top">
          <div class="rail-project">{projectDisplayName}</div>
          <div class="rail-head-actions">
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              className="rail-pin"
              onclick={toggleRail}
              ariaLabel={railCollapsed ? 'Pin project navigation open' : 'Collapse project navigation'}
              title={railCollapsed ? 'Pin navigation open' : 'Collapse navigation'}
            >
              <Icon name={railCollapsed ? 'panel-left-open' : 'panel-left-close'} size={16} />
            </Button>
          {#if railOverlayOpen}
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                className="rail-close"
                onclick={closeMobileRail}
                ariaLabel="Close project navigation"
                title="Close navigation"
              >
                <Icon name="x" size={16} />
              </Button>
            {/if}
          </div>
        </div>
        <div class="rail-status">
          <Chip label="Needs setup" tone="warn" />
        </div>
      </div>
      <div class="rail-bottom">
        <Tooltip text="Back to Projects" placement="right" className="rail-tooltip" disabled={railLabelsVisible}>
          <button
            type="button"
            class="rail-item active"
            onclick={() => go('/')}
            aria-label="Projects"
          >
            <span class="rail-stripe"></span>
            <Icon name="folder" size={18} />
            <span class="rail-label">Projects</span>
          </button>
        </Tooltip>
      </div>
    </aside>
    {/snippet}
    {#snippet topbar()}
      <header class="topbar topbar--uninitialized">
        <div class="topbar-start">
          <Button
            variant="secondary"
            size="sm"
            iconOnly={!showTopbarBackLabel}
            onclick={handleTopbarBack}
            ariaLabel={topbarBackTitle}
            title={topbarBackTitle}
          >
            <Icon name="chevron-left" size={16} />
            {#if showTopbarBackLabel}
              <span>{topbarBackLabel}</span>
            {/if}
          </Button>
        </div>
        <div class="topbar-leading"></div>
        <div class="topbar-actions"></div>
      </header>
    {/snippet}
    {#await loadProjectAttachFlow()}
      <div class="page-centered">
        <p class="muted">Loading project...</p>
      </div>
    {:then module}
      {@const ProjectAttachFlow = module.default}
      <ProjectAttachFlow
        projectName={projectDisplayPathLeaf}
        projectPath={projectDisplayPath}
        projectId={activeProjectId}
      />
    {:catch err}
      <div class="page-centered">
        <p class="muted">Error: {err instanceof Error ? err.message : String(err)}</p>
      </div>
    {/await}
  </ProjectShell>
{:else if project.error && !detail}
  <div class="page-centered">
    <p class="muted">Error: {project.error}</p>
  </div>
{:else if !detail && !canRenderWithoutProjectDetail}
  <div class="page-centered">
    <p class="muted">Loading project...</p>
  </div>
{:else}
  <ProjectShell
      pageMode={pageMode}
    railCollapsed={railCollapsed && !railOverlayOpen}
    railPreviewOpen={railPreviewOpen}
    mobileRailMode={railForcedCollapsed}
    railOverlayOpen={railOverlayOpen}
  >
    {#snippet rail()}
    {#if railOverlayOpen}
      <button type="button" class="rail-scrim" aria-hidden="true" tabindex="-1" onclick={closeMobileRail}></button>
    {/if}
    <aside
      class="rail"
      class:rail-collapsed={railCollapsed && !railOverlayOpen}
      class:rail-mobile-open={railOverlayOpen}
      class:rail-preview-open={railPreviewOpen}
      aria-label="Project navigation"
      onmouseenter={scheduleRailPreviewOpen}
      onmouseleave={closeRailPreview}
      onfocusin={openRailPreviewImmediately}
      onfocusout={closeRailPreview}
    >
      <div class="rail-head" title={projectDisplayPath}>
        <div class="rail-head-top">
          <div class="rail-project">{projectDisplayName}</div>
          <div class="rail-head-actions">
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              className="rail-pin"
              onclick={toggleRail}
              ariaLabel={railCollapsed ? 'Pin project navigation open' : 'Collapse project navigation'}
              title={railCollapsed ? 'Pin navigation open' : 'Collapse navigation'}
            >
              <Icon name={railCollapsed ? 'panel-left-open' : 'panel-left-close'} size={16} />
            </Button>
            {#if railOverlayOpen}
              <Button
                variant="secondary"
                size="sm"
                iconOnly
                className="rail-close"
                onclick={closeMobileRail}
                ariaLabel="Close project navigation"
                title="Close navigation"
              >
                <Icon name="x" size={16} />
              </Button>
            {/if}
          </div>
        </div>
        <div class="rail-status">
          <Chip label={detail ? phaseLabel : 'Loading'} tone={detail ? phaseTone : 'neutral'} />
        </div>
      </div>
      <nav class="rail-nav">
        {#each entries as e (e.id)}
          {@const active = sectionIsActive(e.id)}
          <Tooltip text={e.label} placement="right" className="rail-tooltip" disabled={railLabelsVisible}>
            <button
              type="button"
              class="rail-item"
              class:active
              onclick={() => go(currentProjectHref(e.suffix, activeProjectId))}
              aria-label={e.label}
              aria-current={active ? 'page' : undefined}
            >
              <span class="rail-stripe"></span>
              <Icon name={e.icon} size={18} />
              <span class="rail-label">{e.label}</span>
            </button>
          </Tooltip>
          {#if active && e.subs && (!railCollapsed || railOverlayOpen)}
            <ul class="rail-subs">
              {#each e.subs as s (s.id)}
                {@const subActive = railSubIsActive(e.id, s.id, s.path)}
                <li>
                  <button
                    type="button"
                    class="rail-sub"
                    class:active={subActive}
                    onclick={() => go(s.path)}
                  >
                    {s.label}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      </nav>
      <div class="rail-bottom">
        <Tooltip text="Settings" placement="right" className="rail-tooltip" disabled={railLabelsVisible}>
          <button
            type="button"
            class="rail-item"
            class:active={currentView === 'settings'}
            onclick={() => go(settingsPath)}
            aria-label="Settings"
            aria-current={currentView === 'settings' ? 'page' : undefined}
          >
            <span class="rail-stripe"></span>
            <Icon name="settings" size={18} />
            <span class="rail-label">Settings</span>
          </button>
        </Tooltip>
      </div>
    </aside>
    {/snippet}
    {#snippet topbar()}
      <header class="topbar">
        <div class="topbar-start">
          <Button
            variant="secondary"
            size="sm"
            iconOnly={!showTopbarBackLabel}
            onclick={handleTopbarBack}
            ariaLabel={topbarBackTitle}
            title={topbarBackTitle}
          >
            <Icon name="chevron-left" size={16} />
            {#if showTopbarBackLabel}
              <span>{topbarBackLabel}</span>
            {/if}
          </Button>
        </div>
        <div class="topbar-leading" aria-hidden="true"></div>
        <div class="topbar-actions">
          {#if detail && newTaskDisabledReason === null && !newTaskInOverflow}
            <Button
              variant="secondary"
              size="sm"
              iconOnly={topbarLabelsCollapsed}
              disabled={busy}
              onclick={newTask}
              ariaLabel="New thread"
              title="New thread"
            >
              <Icon name="plus" size={16} />
              {#if !topbarLabelsCollapsed}
                <span>New thread</span>
              {/if}
            </Button>
          {/if}
          {#if detail && showRunButton}
            <Button
              variant={runControlPauses ? (pausedBlockedControl ? 'secondary' : 'danger') : requiredMigrationBlocked ? 'human' : 'agent'}
              size="sm"
              iconOnly={topbarLabelsCollapsed}
              disabled={busy || migrationApplyBusy || runStatus === 'stopping' || (!runControlPauses && startDisabledReason !== null && !requiredMigrationBlocked)}
              onclick={runControlPauses ? stop : requiredMigrationBlocked ? () => { void openMigrationModal() } : () => start('continuous')}
              ariaLabel={
                runStatus === 'stopping'
                  ? 'Pausing'
                  : runControlPauses
                  ? (pausedBlockedControl ? 'Pause project processing' : runMode === 'one_task' ? 'Pause one-step run' : 'Pause')
                  : requiredMigrationBlocked
                  ? 'Migrate project'
                  : (startDisabledReason ?? runButtonIdleLabel)
              }
              title={
                runStatus === 'stopping'
                  ? 'Pausing the run'
                : runControlPauses
                  ? (pausedBlockedControl ? 'Pause Guildhall on this project' : runMode === 'one_task' ? 'Pause the current one-step run' : 'Pause the run')
                  : requiredMigrationBlocked
                  ? 'Migrate project'
                  : (startDisabledReason ?? runButtonIdleLabel)
              }
            >
              <Icon name={runControlPauses ? 'pause' : requiredMigrationBlocked ? 'refresh-cw' : 'sparkles'} size={16} />
              {#if !topbarLabelsCollapsed}
                {runStatus === 'stopping' ? 'Pausing...' : runControlPauses ? (pausedBlockedControl ? 'Pause' : runMode === 'one_task' ? 'Pause 1' : 'Pause') : runButtonIdleLabel}
              {/if}
            </Button>
          {/if}
          {#if detail}
            <div class="actions-menu" bind:this={actionsMenuEl}>
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                ariaLabel="Open actions menu"
                title={actionsMenuOpen ? undefined : 'Open actions menu'}
                onclick={toggleActionsMenu}
              >
                <Icon name="ellipsis" size={18} />
              </Button>
              {#if actionsMenuOpen}
                <div class="actions-menu-panel">
                  {#if newTaskDisabledReason === null && newTaskInOverflow}
                    <button
                      type="button"
                      class="actions-menu-item"
                      disabled={busy}
                      onclick={() => { closeActionsMenu(); void newTask() }}
                    >
                      <Icon name="plus" size={16} />
                      <span>New thread</span>
                    </button>
                  {/if}
                  {#if showAdvanceOneTaskAction}
                    <button
                      type="button"
                      class="actions-menu-item"
                      disabled={busy || requiredMigrationBlocked || startDisabledReason !== null || runStatus === 'running' || runStatus === 'stopping'}
                      title={startDisabledReason ?? ''}
                      onclick={() => { closeActionsMenu(); start('one_task') }}
                    >
                      <Icon name="check-circle-2" size={16} />
                      <span>Advance one task</span>
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </header>
    {/snippet}
    {#snippet band()}
        {#if detail && project.error}
          <AlertBand tone="warn" role="status" density="compact" singleLine ariaLabel="Project refresh warning">
            <strong>Couldn’t refresh project. Showing the last known state.</strong>
            {#snippet actions()}
              <button type="button" class="gh-notice-inline-action" onclick={() => void project.refresh(activeProjectId, projectDetailSurface, routeFocusedTaskId)}>Try again</button>
              <button type="button" class="gh-notice-inline-dismiss" aria-label="Dismiss" onclick={() => (project.error = null)}>×</button>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && runError}
          <AlertBand tone="danger" role="alert" density="compact" ariaLabel="Run error">
            <strong>{runError}</strong>
            {#snippet actions()}
              {#if /provider/i.test(runError)}
                <a href={currentProjectHref('/settings/providers', activeProjectId)} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers', activeProjectId)) }}>
                  Open project providers
                </a>
              {/if}
              <button type="button" class="gh-notice-inline-dismiss" aria-label="Dismiss" onclick={() => (runError = null)}>×</button>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && bootstrapFailureText}
          <AlertBand tone="danger" role="alert" density="compact" ariaLabel="Bootstrap failed">
            <strong>{bootstrapFailureText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/ready', activeProjectId)} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/ready', activeProjectId)) }}>
                Open readiness checks
              </a>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && providerStatus?.fallback}
          {@const providerFallbackTone = shellAlertTone(providerDecisionSeverity)}
          <AlertBand
            tone={providerFallbackTone}
            role={providerFallbackTone === 'accent' ? 'status' : 'alert'}
            density="compact"
            ariaLabel="Provider fallback"
          >
            <strong>{providerNoticeText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/providers', activeProjectId)} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers', activeProjectId)) }}>
                Open project providers
              </a>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && providerWarningText}
          {@const providerStatusTone = shellAlertTone(providerWarningSeverity)}
          <AlertBand
            tone={providerStatusTone}
            role={providerStatusTone === 'accent' ? 'status' : 'alert'}
            density="compact"
            ariaLabel="Provider attention"
          >
            <strong>{providerWarningText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/providers', activeProjectId)} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers', activeProjectId)) }}>
                Open settings
              </a>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && providerHealthText}
          <AlertBand tone="warn" role="alert" density="compact" ariaLabel="Provider health">
            <strong>{providerHealthText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/providers', activeProjectId)} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers', activeProjectId)) }}>
                Open settings
              </a>
            {/snippet}
          </AlertBand>
        {/if}
        {#if detail && allTerminalReadinessMessage && currentView !== 'release'}
          <AlertBand tone="ok" role="status" density="compact" singleLine ariaLabel={selectedReleaseShipped ? 'Release shipped' : 'Ready'}>
            {#if selectedReleaseShipped}<Icon name="check-circle-2" size={16} />{/if}
            <strong>{allTerminalReadinessMessage}</strong>
          </AlertBand>
        {/if}
        {#if detail && allTerminalReviewNotice}
          <AlertBand tone="warn" role="alert" density="compact" ariaLabel="Review current scope">
            <strong>{allTerminalReviewNotice.message}</strong>
            {#if allTerminalReviewNotice.detail}
              <span>{allTerminalReviewNotice.detail}</span>
            {/if}
          </AlertBand>
        {/if}
        {#each shellAttentionNotices as notice (notice.key ?? notice.id)}
          <AlertBand
            tone={notice.tone}
            role={notice.role}
            density="compact"
            singleLine={notice.code === 'repository_followup_required'}
            ariaLabel={notice.ariaLabel}
          >
            <strong title={notice.code === 'repository_followup_required' ? notice.message : undefined}>{notice.message}</strong>
            {#snippet actions()}
              {#if notice.actionHref && notice.actionLabel}
                <a href={notice.actionHref} onclick={(e) => { e.preventDefault(); nav(notice.actionHref ?? currentProjectHref('/overview', activeProjectId)) }}>
                  {notice.actionLabel}
                </a>
              {/if}
            {/snippet}
          </AlertBand>
        {/each}
    {/snippet}
        <div class="body">
          {#if !detail}
            {#if currentView === 'thread'}
              {#await loadThreadTab()}
                <div class="page-centered page-centered-inline">
                  <p class="muted">Loading project...</p>
                </div>
              {:then module}
                {@const ThreadTab = module.default}
                <ThreadTab projectId={activeProjectId} />
              {/await}
            {:else if currentView === 'inbox'}
              {#await loadNeedsYouTab()}
                <div class="page-centered page-centered-inline">
                  <p class="muted">Loading project...</p>
                </div>
              {:then module}
                {@const NeedsYouTab = module.default}
                <NeedsYouTab items={inboxItems} history={inboxHistory} loaded={inboxLoaded} error={inboxError} refresh={loadInbox} />
              {/await}
            {:else if currentView === 'release'}
              {#await loadReleaseTab()}
                <div class="page-centered page-centered-inline">
                  <p class="muted">Loading project...</p>
                </div>
              {:then module}
                {@const ReleaseTab = module.default}
                <ReleaseTab subView={currentSub} activeProjectId={activeProjectId} projectSummary={detail?.releaseSummary} />
              {/await}
            {:else}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {/if}
          {:else if surfaceDetailPending}
            <div class="page-centered page-centered-inline">
              <NoticeBand
                tone="neutral"
                role="status"
                density="compact"
                label="Project summary ready"
                title={detail.name ?? detail.id ?? 'Project'}
              >
                {detail.summary ?? 'The current project summary is ready.'} Loading the selected view...
              </NoticeBand>
            </div>
          {:else if currentView === 'overview'}
            {#if currentSub === 'inbox'}
              {#await loadNeedsYouTab()}
                <div class="page-centered page-centered-inline">
                  <p class="muted">Loading project...</p>
                </div>
              {:then module}
                {@const NeedsYouTab = module.default}
                <NeedsYouTab items={inboxItems} history={inboxHistory} loaded={inboxLoaded} error={inboxError} refresh={loadInbox} />
              {/await}
            {:else}
              {#await loadProjectOverviewTab()}
                <div class="page-centered page-centered-inline">
                  <p class="muted">Loading project...</p>
                </div>
              {:then module}
                {@const ProjectOverviewTab = module.default}
                <ProjectOverviewTab
                  {detail}
                  {inboxItems}
                  {inboxLoaded}
                  {inboxError}
                  {projectTicker}
                  {activeProjectId}
                  onMigrate={openMigrationModal}
                />
              {/await}
            {/if}
          {:else if currentView === 'thread'}
            {#await loadThreadTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const ThreadTab = module.default}
              <ThreadTab projectId={activeProjectId} />
            {/await}
          {:else if currentView === 'inbox'}
            {#await loadNeedsYouTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const NeedsYouTab = module.default}
              <NeedsYouTab items={inboxItems} history={inboxHistory} loaded={inboxLoaded} error={inboxError} refresh={loadInbox} />
            {/await}
          {:else if currentView === 'workspace-import'}
            {#await loadWorkspaceImportTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const WorkspaceImportTab = module.default}
              <WorkspaceImportTab />
            {/await}
          {:else if currentView === 'work'}
            {#await loadWorkTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const WorkTab = module.default}
              <WorkTab {detail} mode="list" />
            {/await}
          {:else if currentView === 'planner'}
            {#await loadWorkTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const WorkTab = module.default}
              <WorkTab {detail} mode="board" />
            {/await}
          {:else if currentView === 'facts'}
            {#await loadFactsTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const FactsTab = module.default}
              <FactsTab />
            {/await}
          {:else if currentView === 'map'}
            {#await loadProjectMapTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const ProjectMapTab = module.default}
              <ProjectMapTab
                {detail}
                activeProjectId={activeProjectId}
                onReleaseSelected={() => project.refresh(activeProjectId, 'map')}
              />
            {/await}
          {:else if currentView === 'structure'}
            {#await loadProjectStructurePanel()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const ProjectStructurePanel = module.default}
              <ProjectStructurePanel />
            {/await}
          {:else if currentView === 'timeline'}
            {#await loadTimelineTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const TimelineTab = module.default}
              <TimelineTab {detail} />
            {/await}
          {:else if currentView === 'release'}
            {#await loadReleaseTab()}
              <div class="page-centered page-centered-inline">
                <p class="muted">Loading project...</p>
              </div>
            {:then module}
              {@const ReleaseTab = module.default}
              <ReleaseTab subView={currentSub} activeProjectId={activeProjectId} projectSummary={detail?.releaseSummary} />
            {/await}
        {:else if currentView === 'settings'}
          {#await loadSettingsTab()}
            <div class="page-centered page-centered-inline">
              <p class="muted">Loading project...</p>
            </div>
          {:then module}
            {@const SettingsTab = module.default}
            <SettingsTab subView={currentSub} onMigrate={openMigrationModal} />
          {/await}
        {/if}
        </div>

    {#snippet footer()}
      {#if currentView !== 'overview'}
      <div class="project-ticker ticker-{projectTicker.tone}" aria-label="Live project ticker">
        <div class="project-ticker-main">
          <StatusDot tone={projectTicker.tone} pulse={projectTicker.pulse} size="sm" />
          <span class="project-ticker-actor">{projectTicker.actorLabel ?? projectTicker.label}</span>
          <span class="project-ticker-message">
            {projectTicker.message}
            {#if projectTicker.detail}
              {' - '}{projectTicker.detail}
            {/if}
          </span>
        </div>
        <div class="project-ticker-side">
          {#if runStatus === 'running' || runStatus === 'stopping'}
            <a
              class="project-ticker-link"
              href={currentProjectHref('/timeline', activeProjectId)}
              onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/timeline', activeProjectId)) }}
            >
              View live stream
            </a>
          {/if}
          {#if projectTicker.timeLabel}
            <span class="project-ticker-time">{projectTicker.timeLabel}</span>
          {/if}
        </div>
      </div>
      {/if}
    {/snippet}

  {#if intakeOpen}
    <IntakeModal onClose={() => setTimeout(() => (intakeOpen = false), 160)} />
  {/if}
  <Modal
    open={migrationModalOpen}
    title="Migrate project"
    size="md"
    closeDisabled={migrationApplyBusy}
    onClose={closeMigrationModal}
  >
    <div class="migration-modal">
      <p>
        This project needs an update before it can run. Some migrations move or remove old project-local files after copying them into Guildhall state.
      </p>
      {#if migrationApplyBusy && migrationProgressLabel}
        <NoticeBand
          tone="warn"
          role="alert"
          density="compact"
          label="Migration in progress"
          title={migrationProgressLabel}
        >
          Do not stop Guildhall until this finishes.
        </NoticeBand>
        <ol class="migration-steps" aria-label="Migration progress">
          <li class:active={migrationApplyStage === 'applying'} class:done={['refreshing-project', 'refreshing-inbox', 'checking-status', 'complete'].includes(migrationApplyStage)}>Apply migration</li>
          <li class:active={migrationApplyStage === 'refreshing-project'} class:done={['refreshing-inbox', 'checking-status', 'complete'].includes(migrationApplyStage)}>Refresh project state</li>
          <li class:active={migrationApplyStage === 'refreshing-inbox'} class:done={['checking-status', 'complete'].includes(migrationApplyStage)}>Refresh Needs You</li>
          <li class:active={migrationApplyStage === 'checking-status'} class:done={migrationApplyStage === 'complete'}>Check remaining migrations</li>
        </ol>
      {:else if migrationAppliedMessage}
        <NoticeBand
          tone="ok"
          role="status"
          density="compact"
          label="Migration complete"
          title={migrationAppliedMessage}
        />
        {#if migrationChangedPaths.length}
          <div class="migration-card migration-card-complete">
            <Chip label="Changed paths" tone="ok" />
            <div class="migration-paths" aria-label="Migration changed paths">
              {#each migrationChangedPaths as affectedPath}
                <code>{affectedPath}</code>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
      {#if migrationStatusLoading}
        <p class="muted">Checking migrations...</p>
      {:else if migrationError}
        <NoticeBand tone="danger" role="alert" density="compact" label="Migration error" title={migrationError} />
      {:else if primaryRequiredMigration}
        <div class="migration-card">
          <Chip label="Required migration" tone="danger" />
          <h4>{primaryRequiredMigration.title}</h4>
          {#if primaryRequiredMigration.summary}
            <p>{primaryRequiredMigration.summary}</p>
          {/if}
          {#if primaryRequiredMigration.affectedPaths?.length}
            <div class="migration-paths" aria-label="Affected paths">
              {#each primaryRequiredMigration.affectedPaths as affectedPath}
                <code>{affectedPath}</code>
              {/each}
            </div>
          {/if}
        </div>
      {:else if !migrationAppliedMessage}
        <NoticeBand
          tone="ok"
          role="status"
          density="compact"
          label="Migration status"
          title="No required migrations are blocking this project."
        />
      {/if}
    </div>
    {#snippet footer()}
      <Button variant="secondary" disabled={migrationApplyBusy} onclick={closeMigrationModal}>
        Close
      </Button>
      <Button
        variant="human"
        disabled={migrationStatusLoading || migrationApplyBusy || !primaryRequiredMigration}
        onclick={() => { void applyRequiredMigration() }}
      >
        <Icon name="refresh-cw" size={16} />
        {migrationApplyBusy ? 'Applying migration...' : 'Apply required migration'}
      </Button>
    {/snippet}
  </Modal>
  </ProjectShell>
{/if}

<style>
  .rail {
    width: 240px;
    border-right: 1px solid color-mix(in srgb, var(--glass-border) 78%, var(--border));
    background:
      linear-gradient(160deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 34%),
      color-mix(in srgb, var(--glass-bg-strong) 90%, var(--bg-raised));
    box-shadow:
      inset -1px 0 0 color-mix(in srgb, white 4%, transparent),
      10px 0 30px color-mix(in srgb, black 12%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    display: flex;
    flex-direction: column;
    block-size: 100%;
    padding: var(--s-3) 0;
    gap: var(--s-2);
    min-width: 0;
    min-block-size: 0;
    max-height: 100%;
    overflow-y: auto;
    transition:
      width 140ms ease,
      box-shadow 140ms ease;
    z-index: 20;
  }
  .rail.rail-collapsed {
    width: 56px;
    overflow-x: hidden;
    position: relative;
  }
  .rail.rail-collapsed.rail-preview-open {
    width: 240px;
    box-shadow:
      14px 0 30px color-mix(in srgb, black 28%, transparent),
      inset -1px 0 0 color-mix(in srgb, white 5%, transparent);
    overflow-x: visible;
    z-index: calc(var(--z-drawer) + 1);
  }
  .rail.rail-mobile-open {
    position: fixed;
    left: 0;
    top: 0;
    right: 0;
    bottom: 0;
    width: 100vw;
    min-height: 100%;
    max-height: none;
    box-shadow: none;
    z-index: var(--z-drawer);
    overflow-y: auto;
  }
  .rail-scrim {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-drawer) - 1);
    background: rgba(0, 0, 0, 0.36);
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .rail-nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .rail-bottom {
    border-top: 1px solid color-mix(in srgb, var(--glass-border) 78%, var(--border));
    padding-top: var(--s-2);
  }
  .rail-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3) var(--s-2) calc((56px - 18px) / 2);
    background: transparent;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    cursor: pointer;
    width: 100%;
    text-align: left;
    border-radius: 0;
    line-height: var(--gh-type-line-height-tight);
  }
  :global(.rail-tooltip) {
    display: block;
    width: 100%;
  }
  .rail-item:hover {
    color: var(--text);
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 10%, transparent), transparent 58%),
      color-mix(in srgb, var(--glass-bg-strong) 78%, var(--bg-raised-2));
  }
  .rail-item.active {
    color: var(--text);
    background:
      linear-gradient(90deg, color-mix(in srgb, var(--accent) 16%, transparent), transparent 62%),
      color-mix(in srgb, var(--glass-bg-strong) 88%, var(--bg-elevated));
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
  }
  .rail-stripe {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: transparent;
  }
  .rail-item.active .rail-stripe {
    background: linear-gradient(180deg, var(--light-violet-warm), var(--stripe-accent));
    box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 36%, transparent);
  }
  .rail-subs {
    list-style: none;
    padding: 0;
    margin: 0 0 var(--s-2) 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .rail-sub {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--gh-type-size-meta);
    padding: var(--s-1) var(--s-3) var(--s-1) calc((56px - 18px) / 2 + 18px + var(--s-2));
    cursor: pointer;
    border-radius: 0;
  }
  .rail-sub:hover { color: var(--text); }
  .rail-sub.active {
    color: var(--accent-2);
    font-weight: var(--gh-type-weight-strong);
  }

  .main {
    min-width: 0;
  }
  .topbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-3) var(--s-4);
    border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 80%, var(--border));
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, transparent), transparent 34%),
      color-mix(in srgb, var(--glass-bg-strong) 94%, var(--bg-raised));
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
      0 10px 28px color-mix(in srgb, black 16%, transparent);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    min-width: 0;
  }
  .topbar-start {
    display: flex;
    align-items: center;
    min-width: 0;
  }
  .topbar-leading {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: var(--s-2);
    min-width: 0;
    overflow: visible;
    justify-self: start;
  }
  .topbar-actions {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: var(--s-2);
    min-width: 0;
    justify-self: end;
  }
  .rail-head {
    padding: var(--s-3) var(--s-3) var(--s-4) var(--s-3);
    border-bottom: 1px solid color-mix(in srgb, var(--glass-border) 78%, var(--border));
    margin-bottom: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .rail-head-top {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  .rail-head-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: var(--s-1);
    flex: 0 0 auto;
  }
  :global(.rail-pin),
  :global(.rail-close) {
    flex: 0 0 28px;
  }
  :global(.rail-close) {
    display: none;
    margin-left: auto;
  }
  .rail.rail-collapsed .rail-head {
    padding-inline: calc((56px - 30px) / 2);
  }
  .rail.rail-collapsed .rail-head-actions {
    margin-left: 0;
  }
  .rail.rail-collapsed .rail-project,
  .rail.rail-collapsed .rail-status,
  .rail.rail-collapsed:not(.rail-preview-open) .rail-label,
  .rail.rail-collapsed:not(.rail-preview-open) .rail-subs {
    display: none;
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-item {
    padding-right: 0;
  }
  .rail-project {
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    color: var(--text);
    text-transform: none;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rail-status {
    display: flex;
  }
  .btn-inner {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .actions-menu {
    position: relative;
  }
  .actions-menu-panel {
    position: absolute;
    right: 0;
    top: calc(100% + var(--s-2));
    z-index: var(--z-popover);
    min-width: 180px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--s-2);
    border: 1px solid color-mix(in srgb, var(--glass-border-strong) 66%, var(--border));
    border-radius: var(--r-2);
    background:
      var(--glass-reflect-violet),
      color-mix(in srgb, var(--glass-bg-strong) 94%, var(--bg-elevated));
    box-shadow: var(--glass-shadow), var(--glass-etch);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  .actions-menu-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 34px;
    padding: 0 var(--s-2);
    border: 1px solid transparent;
    border-radius: var(--r-1);
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--gh-type-size-body);
    font-weight: var(--gh-type-weight-strong);
    text-align: left;
    cursor: pointer;
  }
  .actions-menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-raised-2));
  }
  .actions-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .migration-modal {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    color: var(--text);
  }
  .migration-modal p {
    margin: 0;
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  .migration-card {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    padding: var(--s-3);
    border: 1px solid color-mix(in srgb, var(--danger) 36%, var(--border));
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--surface-danger) 22%, var(--bg-raised-2));
  }
  .migration-card h4 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-panel-title);
    line-height: var(--gh-type-line-height-tight);
  }
  .migration-card-complete {
    border-color: color-mix(in srgb, var(--gh-color-feedback-ok) 36%, var(--border));
    background: color-mix(in srgb, var(--gh-color-feedback-ok) 14%, var(--bg-raised-2));
  }
  .migration-steps {
    display: grid;
    gap: var(--s-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .migration-steps li {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .migration-steps li::before {
    content: '';
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-raised-2);
  }
  .migration-steps li.active {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
  }
  .migration-steps li.active::before {
    border-color: var(--accent);
    background: var(--accent);
  }
  .migration-steps li.done {
    color: var(--text);
  }
  .migration-steps li.done::before {
    border-color: var(--gh-color-feedback-ok);
    background: var(--gh-color-feedback-ok);
  }
  .migration-paths {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
  }
  .migration-paths code {
    padding: 0.2rem 0.45rem;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-base) 62%, transparent);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
  }

  @media (max-width: 900px) {
    :global(.rail-pin) {
      display: none;
    }
    .topbar {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
    .topbar-start {
      grid-column: 1;
    }
    .topbar-actions {
      grid-column: 3;
      justify-self: end;
    }
    .topbar-leading {
      grid-column: 2;
      justify-self: start;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .topbar-leading::-webkit-scrollbar {
      display: none;
    }
  }

  .band {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .page-centered {
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }
  .project-ticker {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    min-width: 0;
    padding: var(--s-2) var(--s-5);
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-raised) 94%, black 6%);
  }
  .project-ticker-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .project-ticker-side {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  .project-ticker-link {
    color: var(--accent);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-decoration: none;
    white-space: nowrap;
  }
  .project-ticker-link:hover {
    text-decoration: underline;
  }
  .project-ticker-actor {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--text);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    overflow-wrap: anywhere;
  }
  .project-ticker-message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .project-ticker-time {
    flex: none;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    white-space: nowrap;
  }
  .ticker-active .project-ticker-actor,
  .ticker-ok .project-ticker-actor {
    color: var(--accent-2);
  }
  .ticker-warn .project-ticker-actor {
    color: var(--warn);
  }
  .ticker-danger .project-ticker-actor {
    color: var(--danger);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }

  .rail.rail-collapsed:not(.rail-preview-open) .rail-label { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-subs { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-item { justify-content: center; padding: var(--s-2); }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-project { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-head { padding: var(--s-2); align-items: center; }

  @media (max-width: 920px) {
    :global(.rail-pin) {
      display: none;
    }
    .rail:not(.rail-mobile-open) {
      display: none;
    }
    .rail.rail-mobile-open :global(.rail-close) {
      display: inline-flex;
    }
    .rail.rail-mobile-open {
      width: 100vw;
      padding: var(--s-4) 0;
      gap: var(--s-3);
    }
    .rail.rail-mobile-open .rail-head {
      padding: 0 var(--s-4) var(--s-4) var(--s-4);
    }
    .rail.rail-mobile-open .rail-head-top {
      align-items: center;
    }
    .rail.rail-mobile-open .rail-head-actions {
      margin-left: auto;
    }
    .rail.rail-mobile-open .rail-project { display: block; }
    .rail.rail-mobile-open .rail-status { display: flex; }
    .rail.rail-mobile-open .rail-label { display: inline; }
    .rail.rail-mobile-open .rail-subs { display: flex; }
    .rail.rail-mobile-open .rail-item {
      justify-content: flex-start;
      padding: var(--s-3) var(--s-4);
    }
    .rail.rail-mobile-open .rail-sub {
      padding: var(--s-2) var(--s-4) var(--s-2) calc(var(--s-4) + 18px + var(--s-2));
    }
    .rail.rail-mobile-open .rail-nav {
      gap: var(--s-1);
    }
    .rail.rail-mobile-open .rail-bottom {
      padding: var(--s-3) 0 0 0;
    }
    .body {
      gap: var(--s-4);
    }
    .project-ticker {
      padding: var(--s-2) var(--s-4);
    }
    .project-ticker-main {
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .project-ticker-actor {
      flex-basis: 100%;
      line-height: var(--gh-type-line-height-caption);
    }
    .project-ticker-side {
      display: none;
    }
    .project-ticker-message {
      white-space: normal;
    }
  }
  @media (max-width: 520px) {
    .topbar {
      padding: var(--s-2);
      gap: var(--s-2);
    }
    .topbar-start :global(.btn span:not(.ic)) {
      display: none;
    }
    .topbar-actions {
      max-width: 100%;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .topbar-actions::-webkit-scrollbar {
      display: none;
    }
  }
</style>
