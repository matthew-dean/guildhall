<!--
  Project Overview - a live project dashboard. This is the project-card idea
  expanded into a first-stop surface: work mix, attention, motion, health, and
  recent meaningful changes.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import CardList from '../../lib/CardList.svelte'
  import CardListItem from '../../lib/CardListItem.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import OverviewTaskRow from '../../lib/OverviewTaskRow.svelte'
  import StatusDot from '../../lib/StatusDot.svelte'
  import UtilityPanel from '../../lib/UtilityPanel.svelte'
  import WorkMixChart from '../../lib/WorkMixChart.svelte'
  import type { WorkMixSegment } from '../../lib/WorkMixChart.svelte'
  import { friendlyDomain, friendlyStatus } from '../../lib/display.js'
  import { formatUserPath } from '../../lib/display-path.js'
  import { summarizeEvent } from '../../lib/events.js'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref } from '../../lib/project-routes.js'
  import { inboxItemKey, type InboxItem } from '../../lib/inbox-item-key.js'
  import { sourceRefsSummary } from '../../lib/source-refs.js'
  import type { EventEnvelope, ProjectDetail, ProjectMemoryHealth, Task } from '../../lib/types.js'
  import { hasCurrentGitUnavailableStory, type ProjectActivityLine } from '../../lib/project-activity.js'
  import { isGitUnavailableMessage } from '../../lib/runtime-message.js'
  import { activeEscalations } from '../../lib/escalation.js'
  import { needsWorkerHandoffSpecCleanup } from '../../lib/task-state.js'
  import { taskStagePresentation } from '../../lib/task-presentation.js'

  interface Props {
    detail: ProjectDetail
    inboxItems?: InboxItem[]
    inboxLoaded?: boolean
    inboxError?: string | null
    projectTicker: ProjectActivityLine
    activeProjectId?: string | null
    onMigrate?: () => void | Promise<void>
    orientationOnly?: boolean
  }

  let {
    detail,
    inboxItems = [],
    inboxLoaded = false,
    inboxError = null,
    projectTicker,
    activeProjectId = null,
    onMigrate,
    orientationOnly = false,
  }: Props = $props()

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'
  type NextActionKind = 'navigate' | 'migration'

  interface BlockedRow {
    task: Task
    reason: string
    category: string
    href: string
  }

  interface RunPlanRow {
    task: Task | null
    label: string
    detail: string
    tone: Tone
    href: string
  }

  function isProjectSetupTask(task: Task | null | undefined): boolean {
    const id = task?.id ?? ''
    return id === 'task-meta-intake' || id === 'task-workspace-import'
  }

  function isArchivedTask(task: Task | null | undefined): boolean {
    return task?.status === 'archived' || task?.status === 'cancelled'
  }

  const tasks = $derived((detail.tasks ?? []).filter(task => !isProjectSetupTask(task) && !isArchivedTask(task)))
  const displayPath = $derived(formatUserPath(detail.path))
  const running = $derived(detail.run?.status === 'running')
  const requiredMigrationBlocked = $derived(detail.startReadiness?.code === 'required_migration_pending')
  const allTerminalStart = $derived(detail.startReadiness?.code === 'all_terminal')
  const startBlocked = $derived(detail.startReadiness?.canStart === false)
  const actionableInbox = $derived.by(() => {
    const visible = inboxItems.filter(item => {
      if (item.severity === 'low') return false
      if (requiredMigrationBlocked) return item.kind === 'required_migration'
      return true
    })
    return visible.slice(0, 3)
  })
  const runtime = $derived(detail.runtime ?? null)
  const memoryHealth = $derived(detail.memoryHealth ?? null)
  const structuralMapReview = $derived(detail.structuralMapReview ?? null)
  const orientationSpine = $derived(detail.orientationSpine ?? null)
  const releaseRoadmap = $derived(orientationSpine?.releases ?? (orientationSpine?.selectedRelease ? [orientationSpine.selectedRelease] : []))
  const laterReleaseCount = $derived(releaseRoadmap.filter(release => release.id !== orientationSpine?.selectedRelease?.id).length)
  const releaseReadiness = $derived(detail.releaseReadiness ?? null)
  const releaseReadinessLabel = $derived(
    releaseReadiness?.release?.label ??
    releaseReadiness?.scope?.label ??
    orientationSpine?.summary?.selectedReleaseLabel ??
    orientationSpine?.summary?.selectedScopeLabel ??
    'Current scope',
  )
  const releaseReadinessTitle = $derived(
    releaseReadiness?.release?.kind === 'release' || releaseReadiness?.scope?.kind === 'release'
      ? 'Current release'
      : 'Current scope',
  )
  const releaseWorkComplete = $derived.by(() => {
    const totals = releaseReadiness?.totals
    if (!totals) return Boolean(releaseReadiness?.ready)
    const taskCount = totals.tasks ?? 0
    return taskCount > 0 && (totals.done ?? 0) >= taskCount && (totals.unfinishedCount ?? 0) === 0 && (totals.humanBlockingCount ?? 0) === 0
  })
  const releaseReadinessTone = $derived<Tone>(
    releaseReadiness?.ready
      ? 'ok'
      : (releaseReadiness?.totals?.blockingCount ?? 0) > 0
        || (releaseReadiness?.totals?.unfinishedCount ?? 0) > 0
          ? 'warn'
          : 'neutral',
  )
  const releaseReadinessProgress = $derived.by(() => {
    const totals = releaseReadiness?.totals
    if (!totals) return releaseReadiness?.notReadyReason ?? 'Open Release for the current scope check.'
    const done = totals.done ?? 0
    const total = totals.tasks ?? 0
    const pieces = [
      `${done} / ${total} done`,
      totals.unfinishedCount ? `${totals.unfinishedCount} unfinished` : null,
      totals.humanBlockingCount ? releaseHumanBlockingPhrase(totals.humanBlockingCount, releaseReadiness?.releaseBlockers ?? []) : null,
    ].filter(Boolean)
    return pieces.length ? pieces.join(' · ') : 'No release blockers reported.'
  })
  const releaseReadinessChipLabel = $derived(releaseReadiness?.ready ? 'Complete' : releaseWorkComplete ? 'Work complete' : 'Not complete')
  const releaseReadinessChipTone = $derived<Tone>(releaseReadiness?.ready || releaseWorkComplete ? 'ok' : releaseReadinessTone === 'warn' ? 'warn' : 'neutral')
  const releaseGitBlockers = $derived((releaseReadiness?.gitStory?.blockers ?? []).slice(0, 2))
  const currentScopeTaskIds = $derived.by(() => {
    const nodeIds = [
      ...(releaseReadiness?.scope?.nodeIds ?? []),
      ...(releaseReadiness?.release?.nodeIds ?? []),
      ...(orientationSpine?.scope?.nodeIds ?? []),
      ...(orientationSpine?.selectedRelease?.nodeIds ?? []),
    ]
    return new Set(nodeIds
      .map(nodeId => nodeId.startsWith('work:') ? nodeId.slice(5) : nodeId)
      .filter(Boolean))
  })
  const currentScopeTasks = $derived(currentScopeTaskIds.size > 0 ? tasks.filter(task => currentScopeTaskIds.has(task.id)) : tasks)
  const tasksById = $derived(new Map(tasks.map(task => [task.id, task])))
  const releaseBlockerRows = $derived.by(() => {
    const rows: Array<{ id: string; title: string; reason: string; category: string; href: string }> = []
    const seen = new Set<string>()
    for (const blocker of releaseReadiness?.releaseBlockers ?? []) {
      const id = blocker.id?.trim() || blocker.title?.trim() || blocker.label?.trim()
      if (!id || seen.has(id)) continue
      const task = blocker.id ? tasksById.get(blocker.id) : null
      const title = task ? taskLabel(task) : blocker.title ?? blocker.label ?? id
      rows.push({
        id,
        title,
        reason: friendlyBlockerText(blocker.label ?? blocker.title ?? 'This work blocks the current scope.'),
        category: task ? inferBlockerCategory(task) : 'Scope blocker',
        href: task ? currentTaskHref(task.id, activeProjectId) : currentProjectHref('/release', activeProjectId),
      })
      seen.add(id)
      if (rows.length >= 3) break
    }
    return rows
  })
  const primaryProofPaths = $derived.by(() => {
    const proofTasks = currentScopeTaskIds.size > 0 ? currentScopeTasks : tasks.filter(task => task.status !== 'shelved')
    return proofTasks
      .flatMap(task => (task.proofPaths ?? []).map(proofPath => ({ task, proofPath })))
      .sort((left, right) => proofRank(left.proofPath.status) - proofRank(right.proofPath.status))
      .slice(0, 3)
  })
  const orientationPins = $derived.by(() => {
    if ((orientationSpine?.activePins?.length ?? 0) > 0) {
      return orientationSpine?.activePins?.slice(0, 3).map(pin => ({
        nodeId: pin.nodeId,
        label: pin.label ?? 'Pinned work',
        reason: pin.kind ? friendlyStatus(pin.kind) : undefined,
        href: pin.href,
      })) ?? []
    }
    return orientationSpine?.summary?.pinnedNow?.slice(0, 3).map(pin => {
      if (typeof pin === 'string') return { label: pin }
      return pin
    }) ?? []
  })
  const orientationTopBlocker = $derived.by(() => {
    const blocker = orientationSpine?.summary?.topBlocker
    if (!blocker) return null
    return typeof blocker === 'string' ? { label: blocker } : blocker
  })
  const orientationHasSourceConflict = $derived(orientationSpine?.gaps?.some(gap => gap.kind === 'source_conflict') ?? false)
  const orientationNextAction = $derived.by(() => {
    const action = orientationSpine?.summary?.nextAction
    if (!action) return null
    return typeof action === 'string'
      ? { label: action, href: currentProjectHref(orientationHasSourceConflict ? '/map' : '/work', activeProjectId) }
      : action
  })
  const orientationGap = $derived(orientationSpine?.gaps?.find(gap => gap.severity === 'high' || gap.kind === 'missing_charter' || gap.kind === 'source_conflict') ?? orientationSpine?.gaps?.[0] ?? null)
  const orientationScopeLabel = $derived(orientationSpine?.summary?.selectedScopeLabel ?? orientationSpine?.selectedTaskScope?.label ?? orientationSpine?.scope?.label ?? orientationSpine?.summary?.selectedReleaseLabel ?? orientationSpine?.selectedRelease?.label ?? 'Current task scope')
  const orientationIncludedCount = $derived(orientationSpine?.summary?.includedWorkCount ?? orientationSpine?.summary?.includedCount ?? 0)
  const orientationDeferredCount = $derived(
    orientationSpine?.summary?.progress?.deferred ??
    orientationSpine?.summary?.deferredWorkCount ??
    orientationSpine?.summary?.deferredCount ??
    0,
  )
  const orientationProofGapCount = $derived(orientationSpine?.gaps?.filter(gap => gap.kind === 'proof_needed').length ?? 0)
  const orientationScopeSourceSummary = $derived.by(() => {
    const rows = orientationSpine?.scopeRows ?? []
    const refs = rows
      .filter(row => row.scope !== 'deferred')
      .flatMap(row => row.sourceRefs ?? [])
    return sourceRefsSummary(refs, 2)
  })
  const orientationScopeProofSummary = $derived.by(() => {
    const contracts = orientationSpine?.proofContracts ?? []
    if (contracts.length === 0) return null
    const proven = contracts.filter(contract => contract.state === 'proven').length
    const missing = contracts.reduce((sum, contract) => sum + (contract.missing?.length ?? 0), 0)
    if (proven === 0 && missing === 0) return null
    return missing > 0
      ? `${countLabel(proven, 'proven item')} · ${countLabel(missing, 'missing proof', 'missing proof')}`
      : `${countLabel(proven, 'proven item')} · 0 missing proof`
  })
  const orientationBlockedCount = $derived.by(() => {
    const progress = orientationSpine?.summary?.progress
    return progress?.blockedCount ?? progress?.blocked ?? 0
  })
  const orientationScopeTitle = $derived.by(() => {
    if (!orientationSpine) return 'Scope not mapped yet'
    return orientationScopeLabel
  })
  const orientationScopeDetail = $derived.by(() => {
    if (!orientationSpine) return 'No bounded scope has been derived for this project yet.'
    const proven = orientationSpine.summary?.progress?.provenCount ?? orientationSpine.summary?.progress?.proven ?? 0
    const pieces = [
      `${orientationIncludedCount} work items in view`,
      `${orientationProofGapCount} missing verification`,
      `${orientationBlockedCount} blocked`,
      `${proven} verified`,
      `${orientationDeferredCount} deferred`,
    ]
    return pieces.join(' · ')
  })
  const orientationScopeSecondaryDetail = $derived.by(() => {
    if (!orientationSpine) return null
    const blockerPrefix = orientationBlockedCount > 0 ? 'Blocking' : 'Waiting on'
    const pieces = [
      orientationScopeProofSummary ? `Proof: ${orientationScopeProofSummary}` : null,
      orientationScopeSourceSummary ? `Sources: ${orientationScopeSourceSummary}` : null,
      orientationPins[0]?.label ? `Current focus: ${orientationPins[0].label}` : null,
      orientationTopBlocker?.label ? `${blockerPrefix}: ${orientationTopBlocker.label}` : orientationGap?.label ? `Needs attention: ${orientationGap.label}` : null,
    ]
    return pieces.filter(Boolean).join(' · ') || null
  })
  const orientationScopeTone = $derived.by((): Tone => {
    if (!orientationSpine) return 'neutral'
    if (orientationTopBlocker || orientationGap || orientationProofGapCount > 0) return 'warn'
    if (orientationPins.length > 0) return 'accent'
    return 'ok'
  })

  function orientationActionButtonLabel(href: string | undefined): string {
    return href?.includes('/map') ? 'Open map' : 'Open Work'
  }

  function releaseHumanBlockingPhrase(count: number, blockers: NonNullable<ProjectDetail['releaseReadiness']>['releaseBlockers']): string {
    const needsShaping = blockers?.some(blocker => /brief|source-backed|shaping|clearer/i.test(`${blocker.label ?? ''} ${blocker.title ?? ''}`)) ?? false
    if (needsShaping) return `${count} ${count === 1 ? 'needs shaping' : 'need shaping'}`
    return `${count} ${count === 1 ? 'needs you' : 'need you'}`
  }

  const orientationMapStatus = $derived.by(() => {
    if (!orientationSpine) return 'No project spine has been generated yet.'
    const roots = orientationSpine.roots?.length ?? 0
    const inferred = orientationSpine.sourceHealth?.inferred ?? 0
    const gaps = orientationSpine.sourceHealth?.gaps ?? orientationSpine.gaps?.length ?? 0
    const documented = (orientationSpine.roots ?? []).reduce((sum, root) =>
      sum + (root.children ?? []).filter(child => child.visibility?.kind === 'supporting').length,
    0)
    const releasePiece = releaseRoadmap.length > 0
      ? `${releaseRoadmap.length} ${releaseRoadmap.length === 1 ? 'release/scope' : 'release/scopes'}`
      : null
    return [
      releasePiece,
      `${orientationIncludedCount} scoped work items`,
      `${documented} documented capabilities`,
      `${inferred} inferred nodes`,
      `${gaps} gaps`,
    ].filter(Boolean).join(' · ')
  })
  const orientationMapPreviewTitle = $derived.by(() => {
    if (!orientationSpine) return 'Project map not generated yet'
    return orientationSpine.charter?.goal ?? orientationSpine.summary?.purpose ?? 'Project shape is being inferred'
  })
  const orientationMapPreviewDetail = $derived.by(() => {
    if (!orientationSpine) return 'Open the map when this project has imported work or confirmed planning docs.'
    const progress = orientationSpine.summary?.progress
    const laterDocumented = (orientationSpine.roots ?? []).reduce((sum, root) =>
      sum + (root.children ?? []).filter(child => child.visibility?.kind === 'supporting' && child.maturity === 'deferred').length,
    0)
    const pieces = [
      releaseRoadmap.length > 1 ? `${laterReleaseCount} later release/scope ${laterReleaseCount === 1 ? 'container' : 'containers'}` : null,
      progress?.specced ? `${progress.specced} specced work items` : null,
      progress?.active ? `${progress.active} active work items` : null,
      progress?.blocked ? `${progress.blocked} blocked work items` : null,
      laterDocumented ? `${laterDocumented} later capabilities` : null,
      orientationProofGapCount ? `${orientationProofGapCount} proof gaps` : null,
    ].filter(Boolean)
    return pieces.length ? pieces.join(' · ') : orientationScopeDetail
  })

  const counts = $derived.by(() => {
    const count = (statuses: string[]) => tasks.filter(task => statuses.includes(task.status ?? '')).length
    const briefCleanup = tasks.filter(needsOverviewBriefCleanup).length
    return {
      total: tasks.length,
      shaping: count(['import_draft', 'exploring']) + briefCleanup,
      approval: count(['spec_review']),
      ready: tasks.filter(task => task.status === 'ready' && !needsOverviewBriefCleanup(task)).length,
      working: count(['in_progress', 'review', 'gate_check']),
      blocked: count(['blocked']),
      done: count(['done', 'pending_pr']),
      shelved: count(['shelved']),
    }
  })

  const workProgressCounts = $derived(detail.workProgress?.counts ?? null)

  const segments = $derived<WorkMixSegment[]>([
    { key: 'working', label: running ? 'Moving now' : 'Paused work', count: counts.working, tone: 'working' },
    { key: 'draft', label: 'Being shaped', count: counts.shaping + counts.approval, tone: 'draft' },
    { key: 'ready', label: 'Ready', count: counts.ready, tone: 'ready' },
    { key: 'blocked', label: 'Blocked', count: counts.blocked, tone: 'blocked' },
    { key: 'done', label: 'Done', count: counts.done, tone: 'done' },
    { key: 'shelved', label: 'Shelved', count: counts.shelved, tone: 'shelved' },
  ].filter(segment => segment.count > 0))
  const workMixSegments = $derived.by((): WorkMixSegment[] => {
    if (!orientationSpine || orientationIncludedCount + orientationDeferredCount <= 0) return segments
    return [
      {
        key: 'current-scope',
        label: 'Current scope',
        count: orientationIncludedCount,
        tone: requiredMigrationBlocked ? 'attention' : 'ready',
        tooltip: `${orientationIncludedCount} work items are in the current scoped work.`,
      },
      {
        key: 'deferred-scope',
        label: 'Deferred',
        count: orientationDeferredCount,
        tone: 'shelved',
        tooltip: `${orientationDeferredCount} work items are documented for later scope.`,
      },
    ].filter(segment => segment.count > 0)
  })

  const activeTask = $derived.by(() => {
    const priority = ['in_progress', 'review', 'gate_check', 'blocked', 'spec_review', 'ready', 'exploring', 'import_draft']
    return [...currentScopeTasks]
      .filter(task => priority.includes(task.status ?? ''))
      .sort((left, right) => {
        const a = priority.indexOf(left.status ?? '')
        const b = priority.indexOf(right.status ?? '')
        if (a !== b) return a - b
        return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      })[0] ?? null
  })

  const movingTasks = $derived.by(() => {
    const wanted = new Set(['in_progress', 'review', 'gate_check', 'ready', 'spec_review', 'exploring'])
    return [...currentScopeTasks]
      .filter(task => wanted.has(task.status ?? ''))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .slice(0, 4)
  })
  const runPanelTitle = $derived(
    running
      ? 'Moving now'
      : requiredMigrationBlocked || (startBlocked && !allTerminalStart)
        ? 'Execution blocked'
        : allTerminalStart
          ? 'No runnable work'
          : 'Ready to resume',
  )
  const nextActionCardTitle = $derived(allTerminalStart ? 'Scope status' : 'Do this next')
  const emptyWorkMixLabel = $derived(
    requiredMigrationBlocked
      ? 'Run the required migration before creating or running work.'
      : allTerminalStart
        ? 'The selected scope has no runnable work left.'
        : startBlocked
        ? 'Resolve the project blocker before adding more work.'
        : 'No tasks yet. Create a request when you are ready.',
  )

  const recentEvents = $derived.by(() => {
    return (detail.recentEvents ?? [])
      .slice()
      .reverse()
      .map(event => ({ event, label: summarizeEvent(event) }))
      .filter(item => !isResolvedGitUnavailableEvent(item.event))
      .filter(item => item.label && !isLowSignalEvent(item.event))
      .filter(item => !(requiredMigrationBlocked && isAllTerminalStoppedEvent(item.event)))
      .slice(0, 5)
  })

  const healthItems = $derived.by(() => {
    const items: Array<{ label: string; detail: string; tone: Tone; href: string }> = []
    const provider = detail.providerStatus
    if (provider?.fallback) {
      items.push({
        label: 'Provider fallback',
        detail: provider.decisions?.[0]?.message ?? 'A fallback provider is being used.',
        tone: 'warn',
        href: currentProjectHref('/settings/providers', activeProjectId),
      })
    } else if (provider?.health?.state) {
      items.push({
        label: provider.health.state === 'healthy' ? 'Provider healthy' : 'Provider status',
        detail: provider.activeProviderLabel ?? provider.preferredProviderLabel ?? provider.activeProvider ?? 'Provider configured.',
        tone: provider.health.state === 'healthy' ? 'ok' : 'warn',
        href: currentProjectHref('/settings/providers', activeProjectId),
      })
    }

    const scopedGitStory = releaseReadiness?.gitStory ?? detail.gitStory
    const gitBlockers = releaseReadiness ? releaseGitBlockers : (detail.gitStory?.blockers ?? [])
    if (gitBlockers.length > 0) {
      items.push({
        label: 'Repository follow-up',
        detail: friendlyBlockerText(gitBlockers[0]?.reason ?? gitBlockers[0]?.label ?? `${gitBlockers.length} git ${gitBlockers.length === 1 ? 'item' : 'items'} need attention.`),
        tone: 'warn',
        href: currentProjectHref('/release', activeProjectId),
      })
    } else if (scopedGitStory?.ready) {
      items.push({
        label: 'Repository clear',
        detail: 'No repository follow-ups are currently reported.',
        tone: 'ok',
        href: currentProjectHref('/release', activeProjectId),
      })
    }

    if (detail.bootstrapStatus?.success === false) {
      items.push({
        label: 'Setup checks need attention',
        detail: 'A setup or readiness check failed.',
        tone: 'danger',
        href: currentProjectHref('/settings/ready', activeProjectId),
      })
    } else if (detail.bootstrapStatus?.success === true) {
      items.push({
        label: 'Setup checks passed',
        detail: detail.bootstrapStatus.lastRunAt ? `Checked ${formatDate(detail.bootstrapStatus.lastRunAt)}.` : 'Readiness checks passed.',
        tone: 'ok',
        href: currentProjectHref('/settings/ready', activeProjectId),
      })
    }

    if (runtime) {
      items.push({
        label: runtimeHealthLabel(runtime.status, runtime.health?.status),
        detail: runtimeModeLabel(runtime.migration?.mode, runtime.backend),
        tone: runtimeTone(runtime.status, runtime.health?.status),
        href: currentProjectHref('/settings/ready', activeProjectId),
      })
    }

    if (memoryHealth) {
      items.push({
        label: 'Memory health',
        detail: `${memoryCoreLabel(memoryHealth.memoryCore)} · ${memoryHealth.active ?? 0} active, ${memoryHealth.proposed ?? 0} proposed.`,
        tone: memoryCoreTone(memoryHealth.memoryCore, memoryHealth),
        href: currentProjectHref('/settings/learning', activeProjectId),
      })
    }

    if (!items.length) {
      items.push({
        label: 'Health unknown',
        detail: 'Open Settings or Release for deeper checks.',
        tone: 'neutral',
        href: currentProjectHref('/settings', activeProjectId),
      })
    }
    return items.slice(0, 4)
  })

  const knowledgeCards = $derived.by(() => {
    const scopedProgress = orientationSpine?.summary?.progress
    const orientationTotalCount = orientationSpine
      ? orientationIncludedCount + orientationDeferredCount
      : null
    const activeCount = workProgressCounts
      ? workProgressCounts.visibleActive
      : counts.working + counts.ready + counts.approval + counts.shaping
    const blockedCount = workProgressCounts?.visibleBlocked ?? counts.blocked
    const doneCount = workProgressCounts?.visibleDone ?? counts.done
    const totalCount = workProgressCounts?.visibleTotal ?? counts.total
    const displayedActiveCount = orientationSpine ? orientationIncludedCount : activeCount
    const displayedBlockedCount = orientationSpine
      ? scopedProgress?.blockedCount ?? scopedProgress?.blocked ?? blockedCount
      : blockedCount
    const displayedDoneCount = orientationSpine
      ? scopedProgress?.doneCount ?? scopedProgress?.done ?? doneCount
      : doneCount
    const displayedTotalCount = orientationTotalCount ?? totalCount
    const deliveryDetail = workProgressCounts && workProgressCounts.deliveryRequired > 0
      ? `${workProgressCounts.deliveryDone} / ${workProgressCounts.deliveryRequired} delivery steps done${workProgressCounts.deliveryBlocked ? ` · ${workProgressCounts.deliveryBlocked} blocked` : ''}.`
      : null
    const baseCards = [
      {
        label: 'Work',
        title: orientationSpine
          ? `${displayedTotalCount} mapped ${displayedTotalCount === 1 ? 'work item' : 'work items'}`
          : `${displayedTotalCount} total ${displayedTotalCount === 1 ? 'work item' : 'work items'}`,
        detail: orientationSpine
          ? `${displayedActiveCount} in current scope · ${displayedDoneCount} completed · ${displayedBlockedCount} blocked.`
          : `${displayedActiveCount} active or shaping · ${displayedDoneCount} completed · ${displayedBlockedCount} blocked.`,
        secondaryDetail: deliveryDetail,
        href: currentProjectHref('/work', activeProjectId),
        tone: displayedBlockedCount > 0 || (workProgressCounts?.deliveryBlocked ?? 0) > 0 ? 'warn' as Tone : displayedActiveCount > 0 ? 'accent' as Tone : 'neutral' as Tone,
      },
      {
        label: 'History',
        title: recentEvents.length > 0 ? `${countLabel(recentEvents.length, 'recent change')}` : 'No recent changes',
        detail: recentEvents[0]?.label ?? 'Timeline will fill in as runs, reviews, and decisions are recorded.',
        href: currentProjectHref('/timeline', activeProjectId),
        tone: 'neutral' as Tone,
      },
    ]
    if (!orientationSpine) return baseCards
    return [
      {
        label: 'Scope',
        title: orientationScopeTitle,
        detail: orientationScopeDetail,
        secondaryDetail: orientationScopeSecondaryDetail,
        href: currentProjectHref('/work', activeProjectId),
        tone: orientationScopeTone,
      },
      ...baseCards,
    ]
  })

  const workMixTotalCount = $derived(
    orientationSpine && orientationIncludedCount + orientationDeferredCount > 0
      ? orientationIncludedCount + orientationDeferredCount
      : workProgressCounts?.visibleTotal ?? workMixSegments.reduce((sum, segment) => sum + segment.count, 0),
  )

  const nextAction = $derived.by(() => {
    const shared = detail.actionModel?.primaryAction
    if (detail.startReadiness?.canStart === false && detail.startReadiness.code === 'all_terminal') {
      return {
        label: detail.startReadiness.message ?? startReadinessLabel(detail.startReadiness.code),
        detail: 'All scoped work is terminal. Open Work to inspect completed and deferred items.',
        button: 'Open Work',
        href: currentProjectHref('/work', activeProjectId),
        tone: 'neutral' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    if (shared) {
      return {
        label: shared.label ?? 'Open Work',
        detail: shared.detail ?? '',
        content: shared.content,
        button: shared.buttonLabel ?? 'Open',
        href: shared.href ?? '/overview',
        tone: shared.tone === 'danger'
          ? 'danger' as Tone
          : shared.tone === 'warn'
            ? 'warn' as Tone
            : shared.tone === 'running'
              ? 'running' as Tone
              : shared.tone === 'accent'
                ? 'accent' as Tone
                : 'neutral' as Tone,
        action: shared.code === 'required_migration_pending' ? 'migration' as NextActionKind : 'navigate' as NextActionKind,
      }
    }
    if (detail.startReadiness?.code === 'required_migration_pending') {
      return {
        label: 'Required migration',
        detail: detail.startReadiness.message ?? 'Run the required migration before this project can update.',
        button: 'Migrate project',
        href: '/migrations',
        tone: 'danger' as Tone,
        action: 'migration' as NextActionKind,
      }
    }
    if (detail.startReadiness?.canStart === false) {
      const href = detail.startReadiness.actionHref ?? currentProjectHref('/overview', activeProjectId)
      const matchingInbox = inboxItems.find(item => item.severity !== 'low' && item.actionHref === href)
      return {
        label: detail.startReadiness.message ?? matchingInbox?.title ?? startReadinessLabel(detail.startReadiness.code),
        detail: matchingInbox?.detail ?? 'Resolve this before Start can move work.',
        content: matchingInbox?.taskDescription,
        button: matchingInbox ? inboxActionLabel(matchingInbox) : 'Open item',
        href,
        tone: matchingInbox?.severity === 'high' ? 'danger' as Tone : 'warn' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    const inbox = actionableInbox[0]
    if (inbox) {
      return {
        label: inbox.title,
        detail: inbox.detail,
        content: inbox.taskDescription,
        button: inboxActionLabel(inbox),
        href: inbox.actionHref ?? '/thread',
        tone: inbox.severity === 'high' ? 'danger' as Tone : 'warn' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    if (orientationNextAction) {
      return {
        label: orientationNextAction.label,
        detail: orientationNextAction.reason ?? orientationTopBlocker?.label ?? orientationGap?.label ?? 'Open the work list to review the next task.',
        button: orientationActionButtonLabel(orientationNextAction.href),
        href: orientationNextAction.href ?? currentProjectHref('/work', activeProjectId),
        tone: orientationTopBlocker || orientationGap ? 'warn' as Tone : 'accent' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    if (activeTask?.status === 'blocked') {
      return {
        label: taskLabel(activeTask),
        detail: activeTask.blockReason ? friendlyBlockerText(activeTask.blockReason) : 'This task needs recovery or a decision.',
        button: 'Open task',
        href: currentTaskHref(activeTask.id, activeProjectId),
        tone: 'warn' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    if (activeTask?.status === 'spec_review') {
      return {
        label: taskLabel(activeTask),
        detail: 'A spec is ready for review.',
        button: 'Review in Thread',
        href: currentProjectHref('/thread', activeProjectId),
        tone: 'warn' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    if (activeTask) {
      const label = taskLabel(activeTask)
      const detailText = statusDetail(activeTask)
      return {
        label,
        detail: detailText === label ? taskPresentation(activeTask).label : detailText,
        button: 'Open work',
        href: currentProjectHref('/work', activeProjectId),
        tone: running ? 'running' as Tone : 'accent' as Tone,
        action: 'navigate' as NextActionKind,
      }
    }
    return {
      label: 'Nothing needs your answer',
      detail: 'Guildhall does not see a blocking owner decision right now.',
      button: 'Open Work',
      href: currentProjectHref('/work', activeProjectId),
      tone: 'neutral' as Tone,
      action: 'navigate' as NextActionKind,
    }
  })
  const nextActionChipLabel = $derived(
    allTerminalStart
      ? 'Closed scope'
      : nextAction.tone === 'running'
        ? 'Live'
        : nextAction.tone === 'warn' || nextAction.tone === 'danger'
          ? 'Needs attention'
          : 'Ready',
  )
  const showHeroStatus = $derived(!orientationOnly && nextAction.tone !== 'warn' && nextAction.tone !== 'danger')

  function inboxActionLabel(item: InboxItem): string {
    switch (item.kind) {
      case 'project_understanding': return 'Review update'
      case 'workspace_import_pending': return 'Review import'
      case 'proof_reconciliation': return 'Review proof'
      case 'required_migration': return 'Migrate'
      default: return 'Open'
    }
  }

  const structuralMapMetricRows = $derived.by(() => {
    const counts = structuralMapReview?.counts
    if (!counts) return []
    return [
      countLabel(counts.packages ?? 0, 'package'),
      countLabel(counts.domains ?? 0, 'domain'),
      countLabel(counts.crossCuttingDomains ?? 0, 'cross-cutting'),
      countLabel(counts.executableUnits ?? 0, 'command'),
      countLabel(counts.gitRoots ?? 0, 'Git root'),
      countLabel(counts.ignoredGitRoots ?? 0, 'ignored root'),
      countLabel(counts.conflicts ?? 0, 'conflict'),
      countLabel(counts.questions ?? 0, 'question'),
    ]
  })

  const blockedRows = $derived.by(() => {
    const rows: BlockedRow[] = []
    const seen = new Set<string>()
    for (const blocker of releaseReadiness?.releaseBlockers ?? []) {
      const id = blocker.id?.trim()
      if (!id || seen.has(id)) continue
      const task = tasksById.get(id)
      if (!task) continue
      rows.push({
        task,
        reason: friendlyBlockerText(blocker.label ?? blocker.title ?? blocker.id ?? 'This work is blocking the current scope.'),
        category: inferBlockerCategory(task),
        href: currentTaskHref(task.id, activeProjectId),
      })
      seen.add(id)
    }
    const scopedBlockedRows = currentScopeTasks
      .filter(task => task.status === 'blocked' || activeEscalations(task).length > 0 || (Boolean(task.blockReason) && !isRunnableStatus(task.status)))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .map(task => ({
        task,
        reason: blockerReason(task),
        category: inferBlockerCategory(task),
        href: currentTaskHref(task.id, activeProjectId),
      }))
    for (const row of scopedBlockedRows) {
      if (seen.has(row.task.id)) continue
      rows.push(row)
      seen.add(row.task.id)
    }
    return rows.slice(0, 4)
  })

  function isRunnableStatus(status: string | undefined): boolean {
    return status === 'ready' || status === 'in_progress' || status === 'review' || status === 'gate_check'
  }

  function needsOverviewBriefCleanup(task: Task): boolean {
    return needsWorkerHandoffSpecCleanup(task)
  }

  function overviewTaskStatusLabel(task: Task): string {
    return needsOverviewBriefCleanup(task) ? 'Needs brief' : taskPresentation(task).label
  }

  const runBlocker = $derived.by(() => {
    const shared = detail.actionModel?.primaryAction
    if (detail.startReadiness?.canStart === false && detail.startReadiness.code !== 'all_terminal') {
      return {
        label: shared?.label ?? startReadinessLabel(detail.startReadiness.code),
        detail: shared?.detail ?? detail.startReadiness.message ?? 'Resolve the blocker before starting more work.',
        href: shared?.href ?? detail.startReadiness.actionHref ?? currentProjectHref('/overview', activeProjectId),
      }
    }
    if (detail.providerStatus?.fallback) {
      return {
        label: 'Provider fallback active',
        detail: detail.providerStatus.decisions?.[0]?.message ?? 'A fallback provider is being used for this project.',
        href: currentProjectHref('/settings/providers', activeProjectId),
      }
    }
    return null
  })

  const runPlanRows = $derived.by(() => {
    const rows: RunPlanRow[] = []
    const addTasks = (wanted: string[], tone: Tone | ((task: Task) => Tone), detail: (task: Task) => string, limit: number) => {
      for (const task of sortedTasks(wanted)) {
        if (rows.length >= limit) return
        const rowTone = typeof tone === 'function' ? tone(task) : tone
        rows.push({
          task,
          label: taskLabel(task),
          detail: detail(task),
          tone: rowTone,
          href: currentTaskHref(task.id, activeProjectId),
        })
      }
    }

    addTasks(['in_progress', 'review', 'gate_check'], running ? 'running' : 'accent', task => `${taskPresentation(task).label}: ${statusDetail(task)}`, 4)
    addTasks(
      ['ready'],
      task => needsOverviewBriefCleanup(task) ? 'warn' : 'accent',
      task => needsOverviewBriefCleanup(task)
        ? 'Needs brief: add enough detail before this can start.'
        : `${taskPresentation(task).label}: ready to start.`,
      4,
    )
    addTasks(['spec_review', 'import_draft'], 'warn', task => `${taskPresentation(task).label}: needs review.`, 4)
    addTasks(['exploring'], 'neutral', task => `${taskPresentation(task).label}: still being shaped.`, 4)

    if (!rows.length && blockedRows.length > 0) {
      rows.push({
        task: blockedRows[0]?.task ?? null,
        label: blockedRows[0]?.task ? taskLabel(blockedRows[0].task) : 'Resolve the blocker',
        detail: blockedRows[0]?.reason ?? 'A blocker needs attention before the next run is useful.',
        tone: 'warn',
        href: blockedRows[0]?.href ?? currentProjectHref('/work', activeProjectId),
      })
    }

    return rows.slice(0, 4)
  })

  function isLowSignalEvent(event: EventEnvelope): boolean {
    const type = event.event?.type ?? event.type ?? ''
    return [
      'connected',
      'heartbeat',
      'assistant_delta',
      'assistant_complete',
      'tool_started',
      'tool_completed',
      'line_complete',
    ].includes(type)
  }

  function isResolvedGitUnavailableEvent(event: EventEnvelope): boolean {
    const message = event.event?.message ?? event.message
    return isGitUnavailableMessage(message) && !hasCurrentGitUnavailableStory(detail)
  }

  function isAllTerminalStoppedEvent(event: EventEnvelope): boolean {
    const type = event.event?.type ?? event.type ?? ''
    const reason = event.event?.reason ?? event.reason
    return type === 'supervisor_stopped' && reason === 'all_terminal'
  }

  function formatDate(value: string | undefined): string {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  function statusDetail(task: Task): string {
    if (task.blockReason) return friendlyBlockerText(task.blockReason)
    if (task.latestCheckpoint?.nextPlannedAction) return friendlyBlockerText(task.latestCheckpoint.nextPlannedAction)
    if (task.description) return task.description
    return taskPresentation(task).label
  }

  function taskPresentation(task: Task) {
    return taskStagePresentation(task, { runStatus: detail.run?.status })
  }

  function taskLabel(task: Task): string {
    const title = task.title?.trim() ?? ''
    const description = task.description?.trim() ?? ''
    if (title && description) {
      const expanded = fullTitleFromDescription(title, description)
      if (expanded) return expanded
    }
    return title || friendlyTaskId(task.id)
  }

  function fullTitleFromDescription(title: string, description: string): string | null {
    const compactTitle = title.replace(/\.\.\.$/, '').trim()
    const candidate = description
      .replace(/^[^:\n]{1,180}:\s*/, '')
      .replace(/^\d+[\).\s-]+/, '')
      .trim()
    if (!candidate || candidate.length <= title.length) return null
    const titleLooksClipped = title.length >= 118 || title.endsWith('...')
    if (!titleLooksClipped) return null
    if (candidate.toLowerCase().startsWith(compactTitle.toLowerCase())) return candidate
    return null
  }

  function sortedTasks(statuses: string[]): Task[] {
    const wanted = new Set(statuses)
    return [...currentScopeTasks]
      .filter(task => wanted.has(task.status ?? ''))
      .sort((left, right) => {
        const statusDelta = statuses.indexOf(left.status ?? '') - statuses.indexOf(right.status ?? '')
        if (statusDelta !== 0) return statusDelta
        return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      })
  }

  function blockerReason(task: Task): string {
    if (task.blockReason) return friendlyBlockerText(task.blockReason)
    const escalation = activeEscalations(task)[0]
    if (escalation?.summary) return friendlyBlockerText(escalation.summary)
    const inbox = inboxItems.find(item => item.taskId === task.id || item.title === task.title)
    if (inbox?.detail) return inbox.detail
    return 'This task is blocked and needs triage.'
  }

  function friendlyBlockerText(value: string): string {
    const text = value.trim()
    if (!text) return text
    if (/Model returned an empty assistant message|Model returned an empty reply/i.test(text)) {
      return 'The model returned an empty reply, so task state stayed intact. Retry the run or switch providers if this keeps happening.'
    }
    if (/\bstopped\s*\(\s*Idle Limit\s*\)|\bIdle Limit\b/i.test(text)) {
      return 'The run stopped after reaching the idle limit. Start it again when you are ready to continue.'
    }
    if (/already have the question posted|posted (?:a |the )?(?:choice|freeform)?\s*question|wait for the user's answer|yield now|q-\d/i.test(text)) {
      return 'A question is waiting for an answer.'
    }
    if (/research budget exhausted|hit the research budget|refusing more read-only tool calls|do not call more read-only tools now/i.test(text)) {
      return 'Work paused after gathering enough context. Open the task to choose the next step.'
    }
    if (/spec (?:author|agent|shaping).*(?:turn limit|maximum turn|timed out)|kept researching after guildhall asked for durable progress/i.test(text)) {
      return 'Spec shaping stopped before the next draft was saved. Open the task to retry from the transcript or reframe the work.'
    }
    if (/\bAC-\d+\b/i.test(text) && /\bevidence\b/i.test(text)) {
      return 'One missing verification check needs to run or be saved before this task can finish.'
    }
    if (/authoritative verification|upstream workspace build failure|checkpoint-touched|task worktree/i.test(text)) {
      return 'The project build is failing outside this task. Decide whether to reframe the task, fix the wider build first, or retry after the build is healthy.'
    }
    if (/no visible progress|made no visible progress|no saved (?:spec|draft)|no durable (?:draft|update)/i.test(text)) {
      return 'Useful context was found, but the next draft was not saved. Decide whether to retry from those notes or reframe the task.'
    }
    const withoutCodePrefix = text
      .replace(/^ERROR:\s*/i, '')
      .replace(/^[a-z][a-z0-9_]*:\s*/i, '')
      .trim()
    if (/^ERROR:\s*spec_ambiguous\b/i.test(text) || /^spec_ambiguous\b/i.test(text)) return withoutCodePrefix || 'The task brief is missing a concrete implementation path.'
    if (/^ERROR:\s*human_judgment_required\b/i.test(text) || /^human_judgment_required\b/i.test(text)) return withoutCodePrefix || 'A product or recovery decision is needed before work can continue.'
    return withoutCodePrefix
  }

  function inferBlockerCategory(task: Task): string {
    const reason = blockerReason(task)
    const haystack = `${task.title ?? ''} ${reason} ${task.description ?? ''}`.toLowerCase()

    const inbox = inboxItems.find(item => item.taskId === task.id || item.title === task.title)

    if (task.status === 'import_draft' || /brief|source-backed|shaping|clearer/.test(haystack)) return 'Needs shaping'
    if (/provider|oauth|api key|model|fallback|stripe|supabase auth/.test(haystack)) return 'Provider settings'
    if (/git|branch|commit|push|dirty|merge/.test(haystack)) return 'Repository follow-up'
    if (/bootstrap|readiness|database|migration|db\b/.test(haystack)) return 'Project readiness / bootstrap'
    if ((task.dependsOn ?? []).length > 0 || referencesAnotherTask(task, haystack)) return 'Dependencies'
    if (inbox?.missingSteps?.length) return 'Missing prerequisite'
    return 'Needs triage'
  }

  function referencesAnotherTask(task: Task, haystack: string): boolean {
    return tasks.some(candidate => {
      if (candidate.id === task.id) return false
      const title = candidate.title?.trim().toLowerCase()
      return haystack.includes(candidate.id.toLowerCase()) || (title && title.length > 8 && haystack.includes(title))
    })
  }

  function startReadinessLabel(code: string | undefined): string {
    switch (code) {
      case 'import_drafts_waiting': return 'Drafts need review'
      case 'all_terminal': return 'No runnable tasks'
      case 'provider_unavailable': return 'Provider unavailable'
      case 'bootstrap_blocked': return 'Readiness blocked'
      case 'proof_evidence_missing': return 'Proof needed'
      case 'no_unattended_progress': return 'Nothing ready to run'
      case 'required_migration_pending': return 'Required migration'
      default: return 'Start is blocked'
    }
  }

  function toneForTask(task: Task): Tone {
    if (needsOverviewBriefCleanup(task)) return 'warn'
    switch (task.status) {
      case 'blocked': return 'danger'
      case 'review':
      case 'gate_check':
      case 'spec_review': return 'warn'
      case 'in_progress': return running ? 'running' : 'neutral'
      case 'ready':
      case 'exploring':
      case 'import_draft': return 'accent'
      case 'done':
      case 'pending_pr': return 'ok'
      default: return 'neutral'
    }
  }

  function go(href: string): void {
    nav(projectActionHref(href, activeProjectId), { backgroundPath: path.value })
  }

  function proofPathTitle(task: Task, proofPath: NonNullable<Task['proofPaths']>[number]): string {
    return proofPath.title ?? taskLabel(task)
  }

  function proofRank(status: string | undefined): number {
    switch (status) {
      case 'blocked': return 0
      case 'in_progress': return 1
      case 'planned': return 2
      case 'stale': return 3
      case 'verified': return 4
      default: return 5
    }
  }

  function runtimeTone(status: string | undefined, health: string | undefined): Tone {
    if (status === 'failed' || health === 'unhealthy') return 'danger'
    if (health === 'degraded' || status === 'creating') return 'warn'
    if (status === 'running' && health === 'healthy') return 'ok'
    if (status === 'running') return 'running'
    return 'neutral'
  }

  function runtimeHealthLabel(status: string | undefined, health: string | undefined): string {
    if (status === 'failed') return 'Runtime failed'
    if (status === 'running') return health === 'healthy' ? 'Runtime healthy' : 'Runtime running'
    if (status === 'creating') return 'Runtime starting'
    return 'Runtime stopped'
  }

  function runtimeModeLabel(mode: string | undefined, backend: string | undefined): string {
    if (mode === 'runtime-backed') {
      if (backend === 'docker') return 'Running in Docker'
      if (backend === 'podman') return 'Running in Podman'
      return 'Container runtime mode'
    }
    if (mode === 'host-run') {
      if (backend === 'none') return 'Host-run mode'
      return 'Compatibility mode'
    }
    return 'Runtime mode unknown'
  }

  function memoryCoreLabel(memoryCore: ProjectMemoryHealth['memoryCore'] | undefined): string {
    if (!memoryCore) return 'Memory status unavailable'
    const storage = (memoryCore.repoLocalWrites?.length ?? 0) === 0 ? 'project repo protected' : 'repo write blocked'
    const compaction = memoryCore.compactionStatus === 'active' ? 'auto-compacted' : 'compaction needs attention'
    const semantics = memoryCore.semanticValidity === 'valid' ? 'semantically valid' : 'semantic check needs attention'
    if (memoryCore.fallbackUsed || (memoryCore.warnings?.length ?? 0) > 0) {
      return `Memory protected · ${compaction} · ${semantics} · fallback active · ${storage}`
    }
    return `Memory protected · ${compaction} · ${semantics} · source-backed · ${storage}`
  }

  function memoryCoreTone(memoryCore: ProjectMemoryHealth['memoryCore'] | undefined, health: ProjectMemoryHealth | null | undefined): Tone {
    if ((memoryCore?.repoLocalWrites?.length ?? 0) > 0) return 'danger'
    if (memoryCore?.fallbackUsed || (memoryCore?.warnings?.length ?? 0) > 0) return 'warn'
    if ((health?.active ?? 0) > 0 || memoryCore?.adapter === 'mastra') return 'ok'
    if ((health?.proposed ?? 0) > 0) return 'warn'
    return 'neutral'
  }

  function countLabel(value: number, singular: string): string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`
  }

  function structuralStateLabel(value: string | undefined): string {
    switch (value) {
      case 'accepted': return 'Accepted'
      case 'owner_review': return 'Owner review'
      case 'correction_requested': return 'Correction requested'
      case 'draft': return 'Draft'
      case 'superseded': return 'Superseded'
      default: return 'Unknown'
    }
  }
</script>

<div class="overview">
  <section class="hero" class:hero-single={!showHeroStatus} aria-label="Project overview">
    <div class="hero-copy">
      <p class="eyebrow">Overview</p>
      <h1>{detail.name ?? detail.id ?? 'Project'}</h1>
      {#if displayPath}
        <p class="path">{displayPath}</p>
      {/if}
    </div>
    {#if showHeroStatus}
      <UtilityPanel className={`live-card live-card-${projectTicker.tone}`} tone={projectTicker.tone === 'danger' ? 'danger' : projectTicker.tone === 'warn' ? 'warn' : projectTicker.tone === 'active' || projectTicker.tone === 'running' ? 'ok' : 'accent'}>
        <StatusDot tone={projectTicker.tone} pulse={projectTicker.pulse} size="sm" />
        <div>
          <strong>{projectTicker.actorLabel ?? projectTicker.label}</strong>
          <span>{projectTicker.message}</span>
        </div>
        {#if projectTicker.timeLabel}
          <small>{projectTicker.timeLabel}</small>
        {/if}
      </UtilityPanel>
    {/if}
  </section>

  <section class="overview-orientation" aria-label="Project orientation">
    <div class="orientation-primary-stack">
      <Card title={nextActionCardTitle} titleTag="h2" tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'accent'} variant="callout" railStrength="strong" className="overview-card overview-priority-card">
        <div class="next-action">
          <Chip label={nextActionChipLabel} tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'neutral'} />
          <h2>{nextAction.label}</h2>
          <p>{nextAction.detail}</p>
          <Button
            variant={nextAction.tone === 'warn' || nextAction.tone === 'danger' ? 'human' : 'secondary'}
            onclick={() => {
              if (nextAction.action === 'migration') {
                void onMigrate?.()
                return
              }
              go(nextAction.href)
            }}
          >
            {#if nextAction.action === 'migration'}
              <Icon name="refresh-cw" size={16} />
            {/if}
            {nextAction.button}
          </Button>
        </div>
      </Card>

      <Card title="Work mix" titleTag="h2" padding="compact" density="dense" className="overview-card orientation-work-mix">
        <WorkMixChart
          ariaLabel={`Work mix: ${workMixTotalCount} tasks`}
          segments={workMixSegments}
          emptyLabel={emptyWorkMixLabel}
          onLegendClick={() => go(currentProjectHref('/work', activeProjectId))}
        />
      </Card>

      {#if releaseReadiness}
        <Card title={releaseReadinessTitle} titleTag="h2" padding="compact" density="dense" className="overview-card orientation-release-readiness">
          <CardList className="release-readiness-list">
            <CardListItem
              as="button"
              tone={releaseReadinessChipTone}
              railStrength="strong"
              onclick={() => go(currentProjectHref('/release', activeProjectId))}
            >
              <Chip label={releaseReadinessChipLabel} tone={releaseReadinessChipTone} />
              <div>
                <strong>{releaseReadinessLabel}</strong>
                <p>{releaseReadinessProgress}</p>
                {#if releaseReadiness?.notReadyReason}
                  <p>{releaseReadiness.notReadyReason}</p>
                {/if}
              </div>
              <span class="preview-action">Open release</span>
            </CardListItem>
            {#each releaseBlockerRows as row (row.id)}
              <CardListItem
                as="button"
                tone="warn"
                onclick={() => go(row.href)}
              >
                <Chip label={row.category} tone={row.category === 'Needs triage' ? 'danger' : 'warn'} />
                <div>
                  <strong>{row.title}</strong>
                  <p>{row.reason}</p>
                </div>
              </CardListItem>
            {/each}
            {#each releaseGitBlockers as blocker (blocker.id ?? blocker.label)}
              <CardListItem
                as="button"
                tone="warn"
                onclick={() => go(currentProjectHref('/release', activeProjectId))}
              >
                <Icon name="git-branch" size={16} />
                <div>
                  <strong>{blocker.label ?? 'Repository follow-up'}</strong>
                  <p>{friendlyBlockerText(blocker.reason ?? blocker.nextAction ?? 'Review the repository follow-up for this scope.')}</p>
                </div>
              </CardListItem>
            {/each}
          </CardList>
        </Card>
      {/if}

      <Card title="Project map" titleTag="h2" padding="compact" density="dense" className="overview-card orientation-map-preview-card">
        <CardList className="orientation-map-preview-list">
          <CardListItem
            as="button"
            className="orientation-map-preview"
            tone={orientationScopeTone === 'warn' ? 'warn' : orientationScopeTone === 'ok' ? 'ok' : 'accent'}
            railStrength="strong"
            onclick={() => go(currentProjectHref('/map', activeProjectId))}
          >
            <Icon name="package" size={18} />
            <div>
              <strong>{orientationMapPreviewTitle}</strong>
              <p>{orientationMapStatus}</p>
              <p>{orientationMapPreviewDetail}</p>
            </div>
            <span class="preview-action">Open map</span>
          </CardListItem>
        </CardList>
      </Card>
    </div>

    <Card title="At a glance" titleTag="h2" padding="compact" density="dense" className="overview-card orientation-map-card">
      <CardList className="orientation-summary-list">
        {#each knowledgeCards as card (card.label)}
          <CardListItem
            as="button"
            className="knowledge-summary-item orientation-summary-item"
            tone={card.tone === 'danger' ? 'danger' : card.tone === 'warn' ? 'warn' : card.tone === 'ok' || card.tone === 'running' ? 'ok' : card.tone === 'accent' ? 'accent' : 'neutral'}
            onclick={() => go(card.href)}
          >
            <Chip label={card.label} tone={card.tone === 'danger' ? 'danger' : card.tone === 'warn' ? 'warn' : card.tone === 'ok' || card.tone === 'running' ? 'ok' : card.tone === 'accent' ? 'accent' : 'neutral'} />
            <div>
              <strong>{card.title}</strong>
              <p>{card.detail}</p>
              {#if 'secondaryDetail' in card && card.secondaryDetail}
                <p>{card.secondaryDetail}</p>
              {/if}
            </div>
          </CardListItem>
        {/each}
      </CardList>
    </Card>

  </section>

  {#if !orientationOnly}
    <section class="overview-work-section">
      <Card title={runPanelTitle} titleTag="h2" padding="compact" density="dense" className="overview-card">
        {#if movingTasks.length === 0}
          <p class="muted">{running ? 'The run is active, but no task is currently active.' : 'No task is moving right now.'}</p>
        {:else}
          <div class="motion-list">
            {#each movingTasks as task (task.id)}
              <OverviewTaskRow
                title={taskLabel(task)}
                detail={friendlyDomain(task.domain) || statusDetail(task)}
                chipLabel={overviewTaskStatusLabel(task)}
                chipTone={toneForTask(task) === 'danger' ? 'danger' : toneForTask(task) === 'warn' ? 'warn' : toneForTask(task) === 'running' ? 'ok' : 'neutral'}
                onclick={() => go(currentTaskHref(task.id, activeProjectId))}
              />
            {/each}
          </div>
        {/if}
      </Card>
    </section>

    <section class="overview-grid overview-planning-grid">
      <Card title="Blocked work" titleTag="h2" padding="compact" density="dense" className="overview-card">
        {#if blockedRows.length === 0}
          <p class="muted">No blocked tasks are visible right now.</p>
        {:else}
          <div class="blocked-work-list">
            {#each blockedRows as row (row.task.id)}
              <OverviewTaskRow
                title={taskLabel(row.task)}
                detail={row.reason}
                chipLabel={row.category}
                chipTone={row.category === 'Needs triage' ? 'danger' : 'warn'}
                onclick={() => go(row.href)}
              />
            {/each}
          </div>
        {/if}
      </Card>

      <Card title="Next run" titleTag="h2" padding="compact" density="dense" className="overview-card">
        {#if runBlocker}
          <UtilityPanel
            as="button"
            interactive
            className="run-blocker"
            tone="warn"
            onclick={() => {
              if (detail.startReadiness?.code === 'required_migration_pending') {
                void onMigrate?.()
                return
              }
              go(runBlocker.href)
            }}
          >
            <Chip label="Blocked" tone="warn" />
            <div>
              <strong>{runBlocker.label}</strong>
              <span>{runBlocker.detail}</span>
            </div>
          </UtilityPanel>
        {/if}
        {#if runPlanRows.length === 0}
          <p class="muted">
            {#if requiredMigrationBlocked}
              The next run is blocked until the required migration is applied.
            {:else if allTerminalStart}
              The selected scope is complete. Choose another release or open Work to inspect completed and deferred items.
            {:else if startBlocked}
              The next run is blocked until the project blocker is resolved.
            {:else}
              Nothing is queued for the next run yet.
            {/if}
          </p>
        {:else}
          <div class="run-plan-list" aria-label="Likely next run order">
            {#each runPlanRows as row, index (`${row.task?.id ?? 'fallback'}:${index}`)}
              <UtilityPanel as="button" interactive className="run-plan-row" tone={row.tone === 'warn' ? 'warn' : row.tone === 'running' ? 'ok' : row.tone === 'accent' ? 'accent' : 'neutral'} onclick={() => go(row.href)}>
                <span class="run-index">{index + 1}</span>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.detail}</span>
                </div>
                <Chip label={row.tone === 'running' ? 'Live' : row.tone === 'warn' ? 'Needs review' : row.tone === 'accent' ? 'Likely next' : 'Later'} tone={row.tone === 'running' ? 'ok' : row.tone === 'warn' ? 'warn' : row.tone === 'accent' ? 'accent' : 'neutral'} />
              </UtilityPanel>
            {/each}
          </div>
        {/if}
      </Card>
    </section>

    <section>
      <Card title="Signals" titleTag="h2" padding="compact" density="dense" className="overview-card overview-signals-card">
        <div class="signals-grid">
        {#if inboxError}
          <UtilityPanel className="signal-row" tone="warn">
            <Icon name="alert-triangle" size={16} />
            <div>
              <strong>Needs you</strong>
              <span>Could not load owner actions: {inboxError}</span>
            </div>
          </UtilityPanel>
        {:else if !inboxLoaded}
          <UtilityPanel className="signal-row" tone="neutral">
            <Icon name="inbox" size={16} />
            <div>
              <strong>Needs you</strong>
              <span>Checking for owner actions...</span>
            </div>
          </UtilityPanel>
        {:else if actionableInbox.length > 0}
          {#each actionableInbox as item (inboxItemKey(item))}
            <UtilityPanel as="button" interactive className="signal-row" tone="warn" onclick={() => go(item.actionHref ?? '/thread')}>
              <Icon name="inbox" size={16} />
              <div>
                <strong>Needs you</strong>
                <span>{item.title}</span>
                <span>{item.detail}</span>
              </div>
            </UtilityPanel>
          {/each}
        {/if}

        {#each healthItems as item (`${item.label}:${item.detail}`)}
          <UtilityPanel
            as="button"
            interactive
            className="signal-row"
            tone={item.tone === 'running' ? 'ok' : item.tone === 'ok' ? 'ok' : item.tone === 'danger' ? 'danger' : item.tone === 'warn' ? 'warn' : 'neutral'}
            onclick={() => go(item.href)}
          >
            <StatusDot tone={item.tone === 'running' ? 'active' : item.tone === 'ok' ? 'ok' : item.tone === 'danger' ? 'danger' : item.tone === 'warn' ? 'warn' : 'idle'} pulse={item.tone === 'running'} size="sm" />
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          </UtilityPanel>
        {/each}

        {#if structuralMapReview}
          <UtilityPanel as="button" interactive className="signal-row" tone={(structuralMapReview.conflicts ?? []).length > 0 || (structuralMapReview.questions ?? []).length > 0 ? 'warn' : structuralMapReview.state === 'accepted' ? 'ok' : 'neutral'} onclick={() => go(currentProjectHref('/structure', activeProjectId))}>
            <Icon name="package" size={16} />
            <div>
              <strong>Structure</strong>
              <span>
                {structuralStateLabel(structuralMapReview.state)}
                {#if structuralMapMetricRows.length > 0}
                  · {structuralMapMetricRows.slice(0, 3).join(' · ')}
                {/if}
              </span>
            </div>
          </UtilityPanel>
        {/if}

        <UtilityPanel as="button" interactive className="signal-row" tone={primaryProofPaths.some(item => item.proofPath.status === 'blocked') ? 'warn' : primaryProofPaths.some(item => item.proofPath.status === 'verified') ? 'ok' : 'neutral'} onclick={() => go(currentProjectHref('/work', activeProjectId))}>
          <Icon name="check-circle-2" size={16} />
          <div>
            <strong>Verification</strong>
            {#if primaryProofPaths.length === 0}
              <span>No verification checks linked yet.</span>
            {:else}
              <span>{proofPathTitle(primaryProofPaths[0].task, primaryProofPaths[0].proofPath)}</span>
              <span>{friendlyStatus(primaryProofPaths[0].proofPath.status)}</span>
            {/if}
          </div>
        </UtilityPanel>

        <UtilityPanel as="button" interactive className="signal-row" tone="neutral" onclick={() => go(currentProjectHref('/timeline', activeProjectId))}>
          <Icon name="clock" size={16} />
          <div>
            <strong>Recent changes</strong>
            <span>{recentEvents[0]?.label ?? 'No meaningful recent activity yet.'}</span>
          </div>
        </UtilityPanel>
        </div>
      </Card>
    </section>
  {/if}
</div>

<style>
  .overview {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    padding: var(--s-4) var(--s-4) var(--s-6);
    min-width: 0;
  }
  .hero {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 420px);
    gap: var(--s-4);
    align-items: stretch;
  }
  .hero-single {
    grid-template-columns: minmax(0, 1fr);
  }
  .hero-copy {
    min-width: 0;
  }
  .eyebrow {
    margin: 0 0 var(--s-1);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-display-title);
    line-height: var(--gh-type-line-height-tight);
    letter-spacing: 0;
  }
  .path {
    margin: var(--s-2) 0 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    overflow-wrap: anywhere;
  }
  :global(.live-card) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  :global(.live-card) div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  :global(.live-card) strong {
    color: var(--text);
    font-size: var(--gh-type-size-meta);
  }
  :global(.live-card) span,
  :global(.live-card) small,
  .muted {
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.live-card) span {
    overflow-wrap: anywhere;
  }
  .overview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-4);
    align-items: start;
  }
  .overview-work-section {
    display: grid;
    gap: var(--s-4);
    min-width: 0;
  }
  .overview-planning-grid {
    align-items: stretch;
  }
  .overview-orientation {
    display: grid;
    grid-template-columns: minmax(0, 1.28fr) minmax(22rem, 0.72fr);
    gap: var(--s-4);
    align-items: start;
    min-width: 0;
  }
  .orientation-primary-stack {
    display: grid;
    gap: var(--s-4);
    min-width: 0;
  }
  :global(.overview-card) {
    min-width: 0;
  }
  :global(.orientation-map-card) {
    grid-column: 2;
    align-self: start;
  }
  :global(.orientation-work-mix .work-mix-chart) {
    height: 1.1rem;
  }
  :global(.orientation-work-mix .work-mix-legend) {
    margin-top: var(--s-2);
    gap: var(--s-1) var(--s-3);
  }
  :global(.orientation-map-preview) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
  }
  :global(.orientation-map-preview div) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  :global(.orientation-map-preview) strong {
    color: var(--text);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  :global(.orientation-map-preview) p,
  .preview-action {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  .preview-action {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
    white-space: nowrap;
  }
  :global(.orientation-summary-list) {
    display: grid;
    gap: var(--s-2);
  }
  :global(.knowledge-summary-item) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-content: start;
    align-items: start;
    gap: var(--s-3);
    min-height: 0;
  }
  :global(.knowledge-summary-item div) {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  :global(.knowledge-summary-item) strong {
    color: var(--text);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  :global(.knowledge-summary-item) p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  :global(.signal-row),
  :global(.run-blocker),
  :global(.run-plan-row) {
    color: var(--text);
  }
  .next-action {
    display: grid;
    gap: var(--s-3);
    justify-items: start;
    max-width: 56rem;
  }
  .next-action h2 {
    margin: 0;
    color: var(--text);
    font-size: var(--gh-type-size-section-title);
    line-height: var(--gh-type-line-height-tight);
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: anywhere;
  }
  .next-action p {
    margin: 0;
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  .motion-list,
  .signals-grid,
  .blocked-work-list,
  .run-plan-list {
    display: grid;
    gap: var(--s-2);
  }
  .signals-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  :global(.signal-row) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.signal-row),
  :global(.run-blocker),
  :global(.run-plan-row) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
  }
  :global(.signal-row) div,
  :global(.run-blocker) div,
  :global(.run-plan-row) div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  :global(.signal-row) strong,
  :global(.run-blocker) strong,
  :global(.run-plan-row) strong {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .motion-list :global(.overview-task-row),
  .blocked-work-list :global(.overview-task-row) {
    min-height: 0;
  }
  :global(.run-blocker) span,
  :global(.signal-row) span,
  :global(.run-plan-row) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.run-blocker) {
    margin-bottom: var(--s-2);
    border-color: color-mix(in srgb, var(--warn) 52%, var(--border));
    background: color-mix(in srgb, var(--warn) 8%, var(--bg-raised));
  }
  .run-index {
    display: inline-grid;
    place-items: center;
    width: 1.7rem;
    height: 1.7rem;
    border-radius: 999px;
    background: var(--chip-neutral-bg);
    color: var(--chip-neutral-fg) !important;
    font-size: var(--gh-type-size-caption) !important;
    font-weight: var(--gh-type-weight-strong);
  }
  :global(.run-plan-row) {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  :global(.signal-row:hover),
  :global(.run-plan-row:hover),
  :global(.run-blocker:hover),
  :global(.overview-task-row:hover) {
    border-color: var(--border-strong);
  }

  @media (max-width: 980px) {
    .hero,
    .overview-orientation,
    .overview-grid {
      grid-template-columns: 1fr;
    }
    :global(.orientation-map-card) {
      grid-column: auto;
    }
    .signals-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .overview {
      padding: var(--s-4);
    }
  }

  @media (max-width: 640px) {
    .overview {
      padding: var(--s-3);
      gap: var(--s-3);
    }
    .signals-grid {
      grid-template-columns: 1fr;
    }
    :global(.live-card) {
      grid-template-columns: auto minmax(0, 1fr);
    }
    h1 {
      font-size: var(--gh-type-size-page-title);
    }
    :global(.live-card) small {
      grid-column: 2;
    }
    :global(.orientation-map-preview) {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .preview-action {
      grid-column: 2;
    }
    .next-action :global(.btn) {
      width: 100%;
    }
    :global(.run-blocker),
    :global(.run-plan-row) {
      padding: var(--s-2);
    }
    :global(.run-plan-row) { grid-template-columns: 1fr; }
    .run-index {
      width: 1.5rem;
      height: 1.5rem;
    }
  }
</style>
