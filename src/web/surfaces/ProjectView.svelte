<!--
  Project root view. Shell layout:
    · Left rail (220px, collapses to 56px icon-only under 1100px viewport):
      primary nav entries + accordion sub-nav + Providers link pinned
      to the bottom.
    · Top bar (slim): workspace name chip + run-status chip + Start/Stop
      + New Task. No tab strip.
    · Main: the active view component (sub-paths pass a `subView` prop to
      surfaces that support it).
-->
<script lang="ts">
  import Button from '../lib/Button.svelte'
  import Chip from '../lib/Chip.svelte'
  import Icon, { type IconName } from '../lib/Icon.svelte'
  import NoticeBand from '../lib/NoticeBand.svelte'
  import StatusDot from '../lib/StatusDot.svelte'
  import ProjectShell from '../lib/layout/ProjectShell.svelte'
  import Tooltip from '../lib/Tooltip.svelte'
  import ThreadTab from './project/ThreadTab.svelte'
  import InboxTab from './project/InboxTab.svelte'
  import WorkTab from './project/WorkTab.svelte'
  import WorkspaceImportTab from './project/WorkspaceImportTab.svelte'
  import ProjectAttachFlow from './project/ProjectAttachFlow.svelte'
  import FactsTab from './project/FactsTab.svelte'
  import TimelineTab from './project/TimelineTab.svelte'
  import ReleaseTab from './project/ReleaseTab.svelte'
  import SettingsTab from './project/SettingsTab.svelte'
  import DoThisNext from './DoThisNext.svelte'
  import IntakeModal from './IntakeModal.svelte'
  import { project } from '../lib/project.svelte.js'
  import { onEvent } from '../lib/events.js'
  import { path, nav } from '../lib/nav.svelte.js'
  import { currentProjectHref, projectFetch } from '../lib/project-routes.js'
  import { activeEscalations } from '../lib/escalation.js'
  import { buildProjectTicker } from '../lib/project-activity.js'
  import { buildProviderIndicator } from '../lib/provider-indicator.js'
  import { formatUserPath } from '../lib/display-path.js'
  import { humanizeProjectName } from '../lib/project-name.js'
  import type { InboxItem } from '../lib/inbox-item-key.js'
  import type { EventEnvelope, ProjectView, ProviderStatus } from '../lib/types.js'

  interface Props {
    initialView?: ProjectView
    initialSub?: string | null
    projectId?: string | null
  }

  const props = $props<Props>()

  const currentView = $derived<ProjectView>(props.initialView ?? 'thread')
  const currentSub = $derived<string | null>(props.initialSub ?? null)
  let busy = $state(false)
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
  const RAIL_PREFERENCE_KEY = 'guildhall:project-rail'

  // Inbox blockers drive disabled-state on top-bar actions so hard blockers
  // (e.g. bootstrap not verified) can't be bypassed by pressing Start.
  interface Blockers { bootstrap: boolean; workspaceImport: boolean }
  let blockers = $state<Blockers>({ bootstrap: false, workspaceImport: false })
  let inboxActionableCount = $state(0)
  let inboxHasHighSeverity = $state(false)
  let inboxItems = $state<InboxItem[]>([])
  let inboxLoaded = $state(false)
  let inboxError = $state<string | null>(null)
  let latestTickerEvent = $state<EventEnvelope | null>(null)
  let tickerNow = $state(Date.now())
  const projectDisplayName = $derived(humanizeProjectName(project.detail?.name ?? project.detail?.id ?? 'Project'))
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
    try {
      const r = await projectFetch('/api/project/inbox', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as {
        items?: InboxItem[]
        blockers?: Blockers
      }
      inboxItems = j.items ?? []
      if (j.blockers) blockers = j.blockers
      inboxActionableCount = inboxItems.filter(i => i.severity !== 'low').length
      inboxHasHighSeverity = inboxItems.some(i => i.severity === 'high')
      inboxError = null
    } catch (err) {
      inboxError = err instanceof Error ? err.message : String(err)
    } finally {
      inboxLoaded = true
    }
  }

  $effect(() => {
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
    void project.refresh()
  })

  $effect(() => {
    if (refreshHandle) clearInterval(refreshHandle)
    refreshHandle = setInterval(() => {
      void project.refresh()
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
    const saved = window.localStorage.getItem(RAIL_PREFERENCE_KEY)
    if (saved === 'expanded' || saved === 'collapsed') {
      railPreference = saved
    }
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  })

  function toggleRail(): void {
    if (railForcedCollapsed) return
    railPreference = railCollapsed ? 'expanded' : 'collapsed'
    railCollapsed = railPreference === 'collapsed'
    railPreviewOpen = false
    window.localStorage.setItem(RAIL_PREFERENCE_KEY, railPreference)
  }

  function openRailPreview(): void {
    if (!railForcedCollapsed && railCollapsed) railPreviewOpen = true
  }

  function closeRailPreview(event?: FocusEvent | MouseEvent): void {
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
    const off = onEvent(ev => {
      const t = ev.event?.type ?? ''
      if (t.startsWith('supervisor_') || t === 'provider_health_changed') void project.refresh()
    })
    return off
  })

  interface NavEntry {
    id: ProjectView
    label: string
    icon: IconName
    path: string
    subs?: Array<{ id: string; label: string; path: string }>
  }

  const coordinators = $derived(project.detail?.config?.coordinators ?? [])
  const needsMeta = $derived(coordinators.length === 0)

  const entries = $derived<NavEntry[]>([
    { id: 'thread', label: 'Thread', icon: 'sparkles', path: currentProjectHref('/thread') },
    { id: 'inbox', label: 'Needs you', icon: 'inbox', path: currentProjectHref('/notifications') },
    { id: 'work', label: 'Work', icon: 'activity', path: currentProjectHref('/work') },
    { id: 'timeline', label: 'Timeline', icon: 'clock', path: currentProjectHref('/timeline') },
    {
      id: 'release',
      label: 'Release',
      icon: 'rocket',
      path: currentProjectHref('/release'),
      subs: [
        { id: 'verdict', label: 'Verdict', path: currentProjectHref('/release') },
        { id: 'criteria', label: 'Criteria', path: currentProjectHref('/release/criteria') },
      ],
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: 'settings',
      path: currentProjectHref('/settings'),
      subs: [
        { id: 'ready', label: 'Ready', path: currentProjectHref('/settings') },
        { id: 'providers', label: 'Providers', path: currentProjectHref('/settings/providers') },
        { id: 'facts', label: 'Facts', path: currentProjectHref('/settings/facts') },
        { id: 'learning', label: 'Learning', path: currentProjectHref('/settings/learning') },
        { id: 'advanced', label: 'Advanced', path: currentProjectHref('/settings/advanced') },
      ],
    },
  ])

  function go(href: string) {
    closeMobileRail()
    nav(href)
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
    runError = null
    try {
      const res = await projectFetch('/api/project/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string; code?: string }
          runError = body.error ?? `Start failed (HTTP ${res.status})`
        } catch {
          runError = `Start failed (HTTP ${res.status})`
        }
        return
      }
      setTimeout(() => void project.refresh(), 300)
      setTimeout(() => {
        void project.refresh()
        void loadInbox()
      }, 1500)
      setTimeout(() => {
        void project.refresh()
        void loadInbox()
      }, 3200)
    } finally {
      busy = false
    }
  }

  async function stop() {
    busy = true
    runError = null
    try {
      const res = await projectFetch('/api/project/stop', { method: 'POST' })
      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: string }
          runError = body.error ?? `Stop failed (HTTP ${res.status})`
        } catch {
          runError = `Stop failed (HTTP ${res.status})`
        }
        return
      }
      setTimeout(() => void project.refresh(), 300)
    } finally {
      busy = false
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

  const detail = $derived(project.detail)
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
  const runStatus = $derived(detail?.run?.status ?? 'stopped')
  const runMode = $derived(detail?.run?.mode === 'one_task' ? 'one_task' : 'continuous')
  const providerStatus = $derived(detail?.providerStatus ?? detail?.run?.providerStatus ?? null)
  const startReadiness = $derived(detail?.startReadiness ?? null)
  const providerIndicator = $derived(buildProviderIndicator(providerStatus, runStatus))
  const providerHeaderLabel = $derived(providerIndicator?.summaryLabel ?? null)
  const providerTitle = $derived(providerIndicator?.title ?? 'Provider not selected')
  const providerDecisionText = $derived(
    providerStatus?.decisions?.[0]?.message ?? providerStatus?.reason ?? null,
  )
  const providerDecisionSeverity = $derived(
    providerStatus?.decisions?.[0]?.severity ?? 'info',
  )
  const providerNoticeText = $derived(
    providerStatus?.fallback
      ? providerDecisionText ??
        'Preferred provider is unavailable; Guildhall is using a fallback for this run.'
      : null,
  )
  const providerWarningText = $derived(
    providerStatus?.warnings?.[0]?.message ?? null,
  )
  const providerWarningSeverity = $derived(
    providerStatus?.warnings?.[0]?.severity ?? 'info',
  )
  const providerHealthText = $derived(
    providerStatus?.health?.state === 'degraded'
      ? `${providerHeaderLabel ?? 'Current provider'} has seen ${providerStatus.health.consecutiveFailures} consecutive pooled failures${providerStatus.health.lastError ? ` (${providerStatus.health.lastError})` : ''}.`
      : null,
  )
  const projectTicker = $derived(buildProjectTicker(detail, latestTickerEvent, new Date(tickerNow)))
  const currentStopSummary = $derived.by(() => {
    if (runStatus === 'running' || runStatus === 'stopping') return null
    const tasks = detail?.tasks ?? []
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
      const unansweredQuestions = (task.openQuestions ?? []).filter(q => !q.answeredAt).length
      if (unansweredQuestions > 0) counts.waitingOnUser += 1
      if ((task.escalations ?? []).some(escalation => !escalation.resolvedAt)) counts.escalated += 1
      if (status === 'spec_review') counts.awaitingApproval += 1
      if (status === 'import_draft') counts.draftReview += 1
      if (status === 'blocked') counts.blocked += 1
      if (status === 'done') counts.done += 1
      if (status === 'shelved') counts.shelved += 1
      if (status === 'proposed' || status === 'ready' || status === 'import_draft') counts.fresh += 1
      if (status === 'exploring' || status === 'in_progress' || status === 'review' || status === 'gate_check') counts.active += 1
      const dependencyBlocked =
        typeof task.blockReason === 'string' &&
        /dependency/i.test(task.blockReason)
      if (dependencyBlocked) counts.dependencyBlocked += 1
    }
    if (counts.active > 0 || counts.fresh > 0) return null
    if (counts.waitingOnUser > 0 || counts.awaitingApproval > 0 || counts.draftReview > 0) {
      return {
        stopReason: 'awaiting_human',
        stopMessage: 'Waiting on input.',
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
    const tasks = detail?.tasks ?? []
    return tasks.some((task) => {
      const status = task.status ?? ''
      const hasUnansweredQuestion = (task.openQuestions ?? []).some((question) => !question.answeredAt)
      const hasOpenEscalation = (task.escalations ?? []).some((escalation) => !escalation.resolvedAt)
      return (
        hasUnansweredQuestion ||
        hasOpenEscalation ||
        ['proposed', 'import_draft', 'exploring', 'spec_review', 'ready', 'in_progress', 'review', 'gate_check'].includes(status)
      )
    })
  })
  const runStopSummary = $derived.by(() => {
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
    if (reason === 'awaiting_human' || reason === 'blocked_only' || reason === 'dependency_blocked') return 'warn'
    return 'info'
  })
  const runStopSummaryText = $derived.by(() => {
    if (runStatus === 'running' || runStatus === 'stopping') return null
    const summary = runStopSummary
    if (!summary?.stopMessage) return null
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
            ? 'One task pass finished. Guildhall is waiting on your input.'
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
  const failedBootstrapStep = $derived(
    detail?.bootstrapStatus?.success === false
      ? detail.bootstrapStatus.steps?.find(s => s.result === 'fail') ?? null
      : null,
  )
  const bootstrapFailureText = $derived.by(() => {
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
  type Phase = 'setting-up' | 'paused' | 'running' | 'error'
  const phase = $derived<Phase>(
    runStatus === 'error'
      ? 'error'
      : runStatus === 'running'
        ? 'running'
        : needsMeta || blockers.bootstrap
          ? 'setting-up'
          : 'paused',
  )
  const phaseLabel = $derived(
    phase === 'setting-up'
      ? 'Setting up'
      : phase === 'running'
        ? 'Running'
        : phase === 'error'
          ? 'Error'
          : 'Paused',
  )
  const phaseTone = $derived(
    phase === 'running'
      ? 'ok'
      : phase === 'error'
        ? 'danger'
        : phase === 'setting-up'
          ? 'warn'
          : 'neutral',
  )
  const providersActive = $derived(path.value === '/providers')

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
      return s && !['done', 'blocked', 'cancelled', 'archived', 'spec_review'].includes(s)
    }).length,
  )
  const activeCountLabel = $derived(
    runStatus === 'running' || runStatus === 'stopping' ? 'active' : 'paused',
  )
  const awaitingApprovalCount = $derived(
    taskList.filter(t => (t as { status?: string }).status === 'spec_review').length,
  )
  const stuckCount = $derived(
    taskList.filter(t => {
      return activeEscalations(t).length > 0
    }).length,
  )

  const startDisabledReason = $derived(
    !startReadiness?.canStart
      ? startReadiness?.message ?? 'Finish setup before starting'
      : blockers.bootstrap && !metaIntakePending
        ? failedBootstrapStep
          ? 'Fix the bootstrap failure before starting'
          : 'Complete bootstrap in Thread before starting'
        : null,
  )
  const newTaskDisabledReason = $derived(
    needsMeta
      ? 'Bootstrap the project first'
      : blockers.bootstrap
        ? failedBootstrapStep
          ? 'Fix the bootstrap failure before adding tasks'
          : 'Complete bootstrap in Thread before adding tasks'
        : null,
  )
</script>

<svelte:document onclick={handleDocumentClick} />
<svelte:window onkeydown={handleKeydown} />

{#if detail?.initializationNeeded}
  <ProjectShell
    uninitialized
    railCollapsed={railCollapsed && !railOverlayOpen}
    railPreviewOpen={railPreviewOpen}
  >
    {#snippet rail()}
    {#if railOverlayOpen}
      <button type="button" class="rail-scrim" aria-label="Close project navigation" onclick={closeMobileRail}></button>
    {/if}
    <aside
      class="rail"
      class:rail-collapsed={railCollapsed && !railOverlayOpen}
      class:rail-mobile-open={railOverlayOpen}
      class:rail-preview-open={railPreviewOpen}
      aria-label="Project navigation"
      onmouseenter={openRailPreview}
      onmouseleave={closeRailPreview}
      onfocusin={openRailPreview}
      onfocusout={closeRailPreview}
    >
      <div class="rail-head" title={projectDisplayPath}>
        <div class="rail-head-top">
          <div class="rail-project">{projectDisplayName}</div>
          <div class="rail-head-actions">
            <button
              type="button"
              class="rail-pin"
              onclick={toggleRail}
              aria-label={railCollapsed ? 'Pin project navigation open' : 'Collapse project navigation'}
              title={railCollapsed ? 'Pin navigation open' : 'Collapse navigation'}
            >
              <Icon name={railCollapsed ? 'panel-left-open' : 'panel-left-close'} size={16} />
            </button>
          {#if railOverlayOpen}
              <button
                type="button"
                class="rail-close"
                onclick={closeMobileRail}
                aria-label="Close project navigation"
                title="Close navigation"
              >
                <Icon name="x" size={16} />
              </button>
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
            className="toolbar-btn toolbar-btn--back"
            onclick={() => go('/')}
            ariaLabel="Back to Projects"
            title="Back to Projects"
          >
            <Icon name="chevron-left" size={16} />
            <span class="toolbar-btn-label">Projects</span>
          </Button>
        </div>
        <div class="topbar-leading"></div>
        <div class="topbar-actions"></div>
      </header>
    {/snippet}
    <ProjectAttachFlow
      projectName={projectDisplayPathLeaf}
      projectPath={projectDisplayPath}
    />
  </ProjectShell>
{:else if project.error}
  <div class="page-centered">
    <p class="muted">Error: {project.error}</p>
  </div>
{:else if !detail}
  <div class="page-centered">
    <p class="muted">Loading project...</p>
  </div>
{:else}
  <ProjectShell
    railCollapsed={railCollapsed && !railOverlayOpen}
    railPreviewOpen={railPreviewOpen}
  >
    {#snippet rail()}
    {#if railOverlayOpen}
      <button type="button" class="rail-scrim" aria-label="Close project navigation" onclick={closeMobileRail}></button>
    {/if}
    <aside
      class="rail"
      class:rail-collapsed={railCollapsed && !railOverlayOpen}
      class:rail-mobile-open={railOverlayOpen}
      class:rail-preview-open={railPreviewOpen}
      aria-label="Project navigation"
      onmouseenter={openRailPreview}
      onmouseleave={closeRailPreview}
      onfocusin={openRailPreview}
      onfocusout={closeRailPreview}
    >
      <div class="rail-head" title={detail.name}>
        <div class="rail-head-top">
          <div class="rail-project">{projectDisplayName}</div>
          <div class="rail-head-actions">
            <button
              type="button"
              class="rail-pin"
              onclick={toggleRail}
              aria-label={railCollapsed ? 'Pin project navigation open' : 'Collapse project navigation'}
              title={railCollapsed ? 'Pin navigation open' : 'Collapse navigation'}
            >
              <Icon name={railCollapsed ? 'panel-left-open' : 'panel-left-close'} size={16} />
            </button>
            {#if railOverlayOpen}
              <button
                type="button"
                class="rail-close"
                onclick={closeMobileRail}
                aria-label="Close project navigation"
                title="Close navigation"
              >
                <Icon name="x" size={16} />
              </button>
            {/if}
          </div>
        </div>
        <div class="rail-status">
          <Chip label={phaseLabel} tone={phaseTone} />
        </div>
      </div>
      <nav class="rail-nav">
        {#each entries as e (e.id)}
          {@const active = currentView === e.id}
          <Tooltip text={e.label} placement="right" className="rail-tooltip" disabled={railLabelsVisible}>
            <button
              type="button"
              class="rail-item"
              class:active
              onclick={() => go(e.path)}
              aria-current={active ? 'page' : undefined}
            >
              <span class="rail-stripe"></span>
              <Icon name={e.icon} size={18} />
              <span class="rail-label">{e.label}</span>
            </button>
          </Tooltip>
          {#if active && e.subs}
            <ul class="rail-subs">
              {#each e.subs as s (s.id)}
                {@const subActive = path.value === s.path ||
                  (e.id === 'settings' && currentSub === s.id) ||
                  (e.id === 'release' && currentSub === s.id) ||
                  (e.id === 'release' && !currentSub && s.id === 'verdict') ||
                  (e.id === 'settings' && !currentSub && s.id === 'ready')}
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
        <Tooltip text="Providers" placement="right" className="rail-tooltip" disabled={railLabelsVisible}>
          <button
            type="button"
            class="rail-item"
            class:active={providersActive}
            onclick={() => go('/providers')}
          >
            <span class="rail-stripe"></span>
            <Icon name="plug" size={18} />
            <span class="rail-label">Providers</span>
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
            className="toolbar-btn toolbar-btn--back"
            onclick={() => go('/')}
            ariaLabel="Back to Projects"
            title="Back to Projects"
          >
            <Icon name="chevron-left" size={16} />
            <span class="toolbar-btn-label">Projects</span>
          </Button>
        </div>
        <div class="topbar-leading">
          {#if activeCount > 0 || awaitingApprovalCount > 0 || stuckCount > 0}
            <button
              type="button"
              class="tasks-indicator"
              class:has-stuck={stuckCount > 0}
              onclick={() => go(currentProjectHref('/work'))}
              title="Jump to Work"
              aria-label="{activeCount} {activeCountLabel}, {awaitingApprovalCount} awaiting approval, {stuckCount} stuck"
            >
              <span class="tasks-count">{activeCount} {activeCountLabel}</span>
              {#if awaitingApprovalCount > 0}
                <span class="tasks-approval">· {awaitingApprovalCount} awaiting approval</span>
              {/if}
              {#if stuckCount > 0}
                <span class="tasks-stuck">· {stuckCount} stuck</span>
              {/if}
            </button>
          {/if}
          {#if inboxActionableCount > 0}
            <button
              type="button"
              class="inbox-indicator"
              class:warn-only={!inboxHasHighSeverity}
              onclick={() => go(currentProjectHref('/notifications'))}
              title="Jump to Notifications"
              aria-label="{inboxActionableCount} notifications need you"
            >
              <Icon name="inbox" size={14} />
              <span>{inboxActionableCount}</span>
            </button>
          {/if}
          {#if providerHeaderLabel}
            <button
              type="button"
              class="provider-indicator"
              class:fallback={providerStatus?.fallback}
              onclick={() => go('/providers')}
              title={providerTitle}
              aria-label={providerTitle}
            >
              <Icon name="plug" size={14} />
              <span class="provider-summary">{providerHeaderLabel}</span>
              {#if providerStatus?.fallback}
                <span class="provider-fallback">fallback</span>
              {/if}
            </button>
          {/if}
        </div>
        <div class="topbar-actions">
          <Button
            variant="secondary"
            size="sm"
            className="toolbar-btn toolbar-btn--new-task"
            disabled={busy || newTaskDisabledReason !== null}
            onclick={newTask}
            ariaLabel={newTaskDisabledReason ?? 'New task'}
            title={newTaskDisabledReason ?? 'New task'}
          >
            <Icon name="plus" size={16} />
            <span class="toolbar-btn-label">New task</span>
          </Button>
          <Button
            variant={runStatus === 'running' ? 'danger' : 'primary'}
            size="sm"
            className="toolbar-btn toolbar-btn--primary"
            disabled={busy || (runStatus !== 'running' && (runStatus === 'stopping' || startDisabledReason !== null))}
            onclick={runStatus === 'running' ? stop : () => start('continuous')}
            ariaLabel={
              runStatus === 'running'
                ? (runMode === 'one_task' ? 'Stop one-step run' : 'Stop')
                : (startDisabledReason ?? 'Start')
            }
            title={
              runStatus === 'running'
                ? (runMode === 'one_task' ? 'Stop the current one-step run' : 'Stop Guildhall')
                : (startDisabledReason ?? 'Let Guildhall advance this project')
            }
          >
            <span class="btn-inner">
              <Icon name={runStatus === 'running' ? 'square' : 'play'} size={16} />
              {runStatus === 'running' ? (runMode === 'one_task' ? 'Stop 1' : 'Stop') : 'Start'}
            </span>
          </Button>
          <div class="actions-menu" bind:this={actionsMenuEl}>
            <Button
              variant="secondary"
              size="sm"
              className={`toolbar-btn toolbar-btn--icon ${actionsMenuOpen ? 'toolbar-btn--menu-open' : ''}`}
              ariaLabel="Open actions menu"
              title="Open actions menu"
              onclick={toggleActionsMenu}
            >
              ...
            </Button>
            {#if actionsMenuOpen}
              <div class="actions-menu-panel">
                <button
                  type="button"
                  class="actions-menu-item"
                  disabled={busy || startDisabledReason !== null || runStatus === 'running' || runStatus === 'stopping'}
                  title={startDisabledReason ?? ''}
                  onclick={() => { closeActionsMenu(); start('one_task') }}
                >
                  <Icon name="check-circle-2" size={16} />
                  <span>Advance one task</span>
                </button>
              </div>
            {/if}
          </div>
        </div>
      </header>
    {/snippet}
    {#snippet band()}
        {#if runError}
          <NoticeBand tone="danger" icon="alert-triangle" density="compact">
            <strong>{runError}</strong>
            {#snippet actions()}
            {#if /provider/i.test(runError)}
              <a href="/providers" onclick={(e) => { e.preventDefault(); nav('/providers') }}>Open Providers</a>
            {/if}
            <button class="dismiss" onclick={() => (runError = null)} aria-label="Dismiss">×</button>
            {/snippet}
          </NoticeBand>
        {/if}
        {#if bootstrapFailureText}
          <NoticeBand tone="danger" icon="alert-triangle" density="compact">
            <strong>{bootstrapFailureText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/ready')} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/ready')) }}>Open Ready</a>
            {/snippet}
          </NoticeBand>
        {/if}
        {#if providerStatus?.fallback}
          <NoticeBand
            tone={providerDecisionSeverity === 'warn' ? 'warn' : providerDecisionSeverity === 'error' ? 'danger' : 'accent'}
            icon="plug"
            density="compact"
          >
            <strong>{providerNoticeText}</strong>
            {#snippet actions()}
              <a href="/providers" onclick={(e) => { e.preventDefault(); nav('/providers') }}>Open Providers</a>
            {/snippet}
          </NoticeBand>
        {/if}
        {#if providerWarningText}
          <NoticeBand
            tone={providerWarningSeverity === 'warn' ? 'warn' : providerWarningSeverity === 'error' ? 'danger' : 'accent'}
            icon="alert-triangle"
            density="compact"
          >
            <strong>{providerWarningText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/providers')} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers')) }}>Open Settings</a>
            {/snippet}
          </NoticeBand>
        {/if}
        {#if providerHealthText}
          <NoticeBand tone="warn" icon="activity" density="compact">
            <strong>{providerHealthText}</strong>
            {#snippet actions()}
              <a href={currentProjectHref('/settings/providers')} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/settings/providers')) }}>Open Settings</a>
            {/snippet}
          </NoticeBand>
        {/if}
        {#if runStopSummaryText}
          <NoticeBand
            tone={runStopSummarySeverity === 'warn' ? 'warn' : runStopSummarySeverity === 'error' ? 'danger' : 'accent'}
            icon={runStopSummarySeverity === 'warn' || runStopSummarySeverity === 'error' ? 'alert-triangle' : 'check-circle-2'}
            density="compact"
          >
            <strong>{runStopSummaryText}</strong>
            {#snippet actions()}
              {#if runStopSummary?.stopReason === 'awaiting_human'}
                <a href={currentProjectHref('/thread')} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/thread')) }}>Open Thread</a>
              {:else if runStopSummary?.stopReason === 'blocked_only'}
                <a href={currentProjectHref('/notifications')} onclick={(e) => { e.preventDefault(); nav(currentProjectHref('/notifications')) }}>Open Notifications</a>
              {/if}
            {/snippet}
          </NoticeBand>
        {/if}
    {/snippet}
        {#if currentView !== 'thread' && currentView !== 'inbox'}
          <DoThisNext />
        {/if}

        <div class="body">
          {#if currentView === 'thread'}
            <ThreadTab />
          {:else if currentView === 'inbox'}
            <InboxTab items={inboxItems} loaded={inboxLoaded} error={inboxError} refresh={loadInbox} />
          {:else if currentView === 'workspace-import'}
            <WorkspaceImportTab />
          {:else if currentView === 'work'}
            <WorkTab {detail} mode="list" />
          {:else if currentView === 'planner'}
            <WorkTab {detail} mode="board" />
          {:else if currentView === 'facts'}
            <FactsTab />
          {:else if currentView === 'timeline'}
            <TimelineTab {detail} />
          {:else if currentView === 'release'}
            <ReleaseTab subView={currentSub} />
        {:else if currentView === 'settings'}
          <SettingsTab subView={currentSub} />
        {/if}
        </div>

    {#snippet footer()}
      <div class="project-ticker ticker-{projectTicker.tone}" aria-label="Live project ticker">
        <div class="project-ticker-main">
          <StatusDot tone={projectTicker.tone} pulse={projectTicker.pulse} size="sm" />
          <span class="project-ticker-actor">{projectTicker.actorLabel ?? projectTicker.label}</span>
          <span class="project-ticker-message">{projectTicker.message}</span>
        </div>
        {#if projectTicker.timeLabel}
          <span class="project-ticker-time">{projectTicker.timeLabel}</span>
        {/if}
      </div>
    {/snippet}

  {#if intakeOpen}
    <IntakeModal onClose={() => (intakeOpen = false)} />
  {/if}
  </ProjectShell>
{/if}

<style>
  .rail {
    width: 240px;
    border-right: 1px solid var(--border);
    background: var(--bg-raised);
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
    box-shadow: 14px 0 26px rgba(0, 0, 0, 0.22);
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
    border-top: 1px solid var(--border);
    padding-top: var(--s-2);
  }
  .rail-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s-2);
    padding: var(--s-2) var(--s-3);
    background: transparent;
    border: none;
    color: var(--text-muted);
    font: inherit;
    font-size: var(--fs-2);
    font-weight: 600;
    cursor: pointer;
    width: 100%;
    text-align: left;
    border-radius: 0;
    line-height: var(--lh-tight);
  }
  :global(.rail-tooltip) {
    display: block;
    width: 100%;
  }
  .rail-item:hover {
    color: var(--text);
    background: var(--bg-raised-2);
  }
  .rail-item.active {
    color: var(--text);
    background: var(--bg-elevated);
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
    background: var(--stripe-accent);
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
    font-size: var(--fs-1);
    padding: var(--s-1) var(--s-3) var(--s-1) calc(var(--s-3) + 24px);
    cursor: pointer;
    border-radius: 0;
  }
  .rail-sub:hover { color: var(--text); }
  .rail-sub.active {
    color: var(--text);
    font-weight: 700;
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
    border-bottom: 1px solid var(--border);
    background: var(--bg-raised);
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
    overflow: hidden;
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
    border-bottom: 1px solid var(--border);
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
  .rail-pin {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-elevated);
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
  }
  .rail-close {
    display: none;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    margin-left: auto;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-elevated);
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
  }
  .rail-close:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }
  .rail-pin:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-head {
    padding-inline: calc((56px - 30px) / 2);
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-head-top {
    justify-content: center;
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-head-actions {
    margin-left: 0;
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-project,
  .rail.rail-collapsed:not(.rail-preview-open) .rail-status,
  .rail.rail-collapsed:not(.rail-preview-open) .rail-label,
  .rail.rail-collapsed:not(.rail-preview-open) .rail-subs {
    display: none;
  }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-item {
    justify-content: center;
    padding-inline: 0;
  }
  .rail-project {
    font-size: var(--fs-2);
    font-weight: 700;
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
  .tasks-indicator,
  .inbox-indicator,
  .provider-indicator {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    color: var(--text-muted);
    font-size: var(--fs-1);
    padding: 2px 8px;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }
  .tasks-indicator:hover,
  .inbox-indicator:hover,
  .provider-indicator:hover {
    color: var(--text);
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }
  .tasks-indicator.has-stuck {
    color: var(--warn);
    border-color: var(--warn);
  }
  .tasks-stuck { font-weight: 600; }
  .inbox-indicator {
    color: var(--danger);
    border-color: var(--danger);
    font-weight: 600;
  }
  .inbox-indicator.warn-only {
    color: var(--warn);
    border-color: var(--warn);
  }
  .provider-indicator {
    color: var(--text-muted);
    max-width: min(100%, 42ch);
    min-width: 0;
  }
  .provider-indicator.fallback {
    color: var(--warn);
    border-color: var(--warn);
    font-weight: 600;
  }
  .provider-summary {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .provider-fallback {
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .btn-inner {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .toolbar-btn {
    min-height: 40px;
    padding: 0 14px;
    border-radius: 10px;
    flex: none;
  }
  .toolbar-btn--primary {
    min-width: 116px;
  }
  .toolbar-btn--new-task {
    min-width: 118px;
  }
  .toolbar-btn--icon {
    width: 40px;
    min-width: 40px;
    padding: 0;
    border-radius: 999px;
  }
  .toolbar-btn--menu-open {
    background: var(--bg-elevated);
    border-color: var(--border-strong);
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
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-elevated);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28);
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
    font-size: var(--fs-2);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .actions-menu-item:hover:not(:disabled) {
    background: var(--bg-raised-2);
  }
  .actions-menu-item:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 1180px) {
    .tasks-approval,
    .tasks-stuck,
    .provider-fallback {
      display: none;
    }
    .toolbar-btn--back .toolbar-btn-label {
      display: none;
    }
  }

  @media (max-width: 900px) {
    .rail-pin {
      display: none;
    }
    .toolbar-btn-label {
      display: none;
    }
    .toolbar-btn--new-task {
      width: 40px;
      min-width: 40px;
      padding: 0;
      border-radius: 999px;
    }
    .topbar {
      grid-template-columns: auto auto;
      grid-template-rows: auto auto;
      row-gap: var(--s-2);
    }
    .topbar-start {
      grid-column: 1;
      grid-row: 1;
    }
    .topbar-actions {
      grid-column: 2;
      grid-row: 1;
      justify-self: end;
    }
    .topbar-leading {
      grid-column: 1 / -1;
      grid-row: 2;
      justify-self: stretch;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .topbar-leading::-webkit-scrollbar {
      display: none;
    }
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding-top: var(--s-5);
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }
  .band {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .page-centered {
  }
  .dismiss {
    background: none;
    border: none;
    color: inherit;
    font-size: 16px;
    cursor: pointer;
    padding: 0 var(--s-1);
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
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .project-ticker-actor {
    flex: none;
    color: var(--text);
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .project-ticker-message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .project-ticker-time {
    flex: none;
    color: var(--text-muted);
    font-size: var(--fs-0);
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
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }

  .rail.rail-collapsed:not(.rail-preview-open) .rail-label { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-subs { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-item { justify-content: center; padding: var(--s-2); }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-project { display: none; }
  .rail.rail-collapsed:not(.rail-preview-open) .rail-head { padding: var(--s-2); align-items: center; }

  @media (max-width: 920px) {
    .rail-pin {
      display: none;
    }
    .rail.rail-mobile-open .rail-close {
      display: inline-flex;
    }
    .rail:not(.rail-mobile-open) .rail-label { display: none; }
    .rail:not(.rail-mobile-open) .rail-subs { display: none; }
    .rail:not(.rail-mobile-open) .rail-item { justify-content: center; padding: var(--s-2); }
    .rail:not(.rail-mobile-open) .rail-project { display: none; }
    .rail:not(.rail-mobile-open) .rail-head { padding: var(--s-2); align-items: center; }
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
      padding: var(--s-2) var(--s-4) var(--s-2) calc(var(--s-4) + 24px);
    }
    .rail.rail-mobile-open .rail-nav {
      gap: var(--s-1);
    }
    .rail.rail-mobile-open .rail-bottom {
      padding: var(--s-3) 0 0 0;
    }
    .page {
      gap: var(--s-4);
      padding-top: var(--s-4);
    }
    .body {
      gap: var(--s-4);
    }
    .project-ticker {
      padding: var(--s-2) var(--s-4);
    }
    .project-ticker-message {
      white-space: normal;
    }
  }
</style>
