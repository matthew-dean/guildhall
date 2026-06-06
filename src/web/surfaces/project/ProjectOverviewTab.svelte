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
  import { currentProjectHref, currentTaskHref, projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { inboxItemKey, type InboxItem } from '../../lib/inbox-item-key.js'
  import type { EventEnvelope, ProjectDetail, Task } from '../../lib/types.js'
  import { hasCurrentGitUnavailableStory, type ProjectActivityLine } from '../../lib/project-activity.js'
  import { isGitUnavailableMessage } from '../../lib/runtime-message.js'
  import { activeEscalations } from '../../lib/escalation.js'
  import { needsWorkerHandoffSpecCleanup } from '../../lib/task-state.js'
  import { taskStagePresentation } from '../../lib/task-presentation.js'
  import { advancedStructureEnabled } from '../../lib/feature-flags.js'

  interface Props {
    detail: ProjectDetail
    inboxItems?: InboxItem[]
    inboxLoaded?: boolean
    inboxError?: string | null
    projectTicker: ProjectActivityLine
    activeProjectId?: string | null
    onMigrate?: () => void | Promise<void>
  }

  let {
    detail,
    inboxItems = [],
    inboxLoaded = false,
    inboxError = null,
    projectTicker,
    activeProjectId = null,
    onMigrate,
  }: Props = $props()

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'
  type NextActionKind = 'navigate' | 'migration'
  type StructuralMapAction =
    | { kind: 'accept' }
    | { kind: 'rename_node'; nodeId: string; label: string }
    | { kind: 'merge_nodes'; sourceNodeId: string; targetNodeId: string; label?: string }
    | { kind: 'split_node'; nodeId: string; newNodeId: string; label: string }
    | { kind: 'mark_cross_cutting'; nodeId: string }
    | { kind: 'mark_package_only'; nodeId: string }
    | { kind: 'ignore_node'; nodeId: string; reason: string }

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

  let localStructuralMapReview = $state<ProjectDetail['structuralMapReview'] | null>(null)
  let structuralMapActionError = $state<string | null>(null)
  let structuralMapActionBusy = $state(false)
  const showAdvancedStructure = advancedStructureEnabled()

  const tasks = $derived(detail.tasks ?? [])
  const displayPath = $derived(formatUserPath(detail.path))
  const running = $derived(detail.run?.status === 'running')
  const actionableInbox = $derived(inboxItems.filter(item => item.severity !== 'low').slice(0, 3))
  const runtime = $derived(detail.runtime ?? null)
  const memoryHealth = $derived(detail.memoryHealth ?? null)
  const structuralMapReview = $derived(localStructuralMapReview ?? detail.structuralMapReview ?? null)
  const deliverySpine = $derived(detail.deliverySpine ?? null)
  const primaryDriver = $derived(deliverySpine?.model?.drivers?.find(driver => driver.role === 'primary') ?? null)
  const nextQueueCandidate = $derived(deliverySpine?.queue?.firstRunnable ?? null)
  const primitiveBlockerSummary = $derived.by(() => {
    const blockers = deliverySpine?.queue?.blocked
      ?.flatMap(candidate => candidate.structuralBlockers ?? [])
      .filter((primitive, index, all) => primitive.id && all.findIndex(item => item.id === primitive.id) === index)
      .slice(0, 4) ?? []
    return blockers
  })
  const primaryProofPaths = $derived.by(() => {
    return tasks
      .flatMap(task => (task.proofPaths ?? []).map(proofPath => ({ task, proofPath })))
      .sort((left, right) => proofRank(left.proofPath.status) - proofRank(right.proofPath.status))
      .slice(0, 3)
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

  const segments = $derived<WorkMixSegment[]>([
    { key: 'working', label: running ? 'Moving now' : 'Paused work', count: counts.working, tone: 'working' },
    { key: 'draft', label: 'Being shaped', count: counts.shaping + counts.approval, tone: 'draft' },
    { key: 'ready', label: 'Ready', count: counts.ready, tone: 'ready' },
    { key: 'blocked', label: 'Blocked', count: counts.blocked, tone: 'blocked' },
    { key: 'done', label: 'Done', count: counts.done, tone: 'done' },
    { key: 'shelved', label: 'Shelved', count: counts.shelved, tone: 'shelved' },
  ].filter(segment => segment.count > 0))

  const activeTask = $derived.by(() => {
    const priority = ['in_progress', 'review', 'gate_check', 'blocked', 'spec_review', 'ready', 'exploring', 'import_draft']
    return [...tasks]
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
    return [...tasks]
      .filter(task => wanted.has(task.status ?? ''))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .slice(0, 4)
  })
  const requiredMigrationBlocked = $derived(detail.startReadiness?.code === 'required_migration_pending')
  const startBlocked = $derived(detail.startReadiness?.canStart === false)
  const emptyWorkMixLabel = $derived(
    requiredMigrationBlocked
      ? 'Run the required migration before creating or running work.'
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

    const gitBlockers = detail.gitStory?.blockers ?? []
    if (gitBlockers.length > 0) {
      items.push({
        label: 'Git story needs closure',
        detail: friendlyBlockerText(gitBlockers[0]?.reason ?? gitBlockers[0]?.label ?? `${gitBlockers.length} git ${gitBlockers.length === 1 ? 'item' : 'items'} need attention.`),
        tone: 'warn',
        href: currentProjectHref('/release', activeProjectId),
      })
    } else if (detail.gitStory?.ready) {
      items.push({
        label: 'Git story clear',
        detail: 'No git closure blockers are currently reported.',
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
        detail: runtimeModeLabel(runtime.migration?.mode),
        tone: runtimeTone(runtime.status, runtime.health?.status),
        href: currentProjectHref('/settings/ready', activeProjectId),
      })
    }

    if (memoryHealth) {
      items.push({
        label: 'Memory health',
        detail: `${memoryHealth.active ?? 0} active, ${memoryHealth.proposed ?? 0} proposed, ${memoryHealth.used ?? 0} recently used.`,
        tone: (memoryHealth.active ?? 0) > 0 ? 'ok' : (memoryHealth.proposed ?? 0) > 0 ? 'warn' : 'neutral',
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
    const activeCount = counts.working + counts.ready + counts.approval + counts.shaping
    return [
      {
        label: 'Work',
        title: `${counts.total} total ${counts.total === 1 ? 'task' : 'tasks'}`,
        detail: `${activeCount} active or shaping · ${counts.done} completed · ${counts.blocked} blocked.`,
        href: currentProjectHref('/work', activeProjectId),
        tone: counts.blocked > 0 ? 'warn' as Tone : activeCount > 0 ? 'accent' as Tone : 'neutral' as Tone,
      },
      {
        label: 'Runtime',
        title: runtimeHealthLabel(runtime?.status, runtime?.health?.status),
        detail: `${runtimeModeLabel(runtime?.migration?.mode)} · ${(memoryHealth?.active ?? 0)} active memories · ${(memoryHealth?.proposed ?? 0)} proposed.`,
        href: currentProjectHref('/settings/ready', activeProjectId),
        tone: runtimeTone(runtime?.status, runtime?.health?.status),
      },
      {
        label: 'Proof',
        title: primaryProofPaths.length > 0 ? `${countLabel(primaryProofPaths.length, 'tracked proof path')}` : 'No proof paths yet',
        detail: primaryProofPaths[0]?.proofPath.title ?? 'Proof paths appear here once verification is planned.',
        href: currentProjectHref('/work', activeProjectId),
        tone: primaryProofPaths.some(item => item.proofPath.status === 'blocked') ? 'warn' as Tone : primaryProofPaths.some(item => item.proofPath.status === 'verified') ? 'ok' as Tone : 'neutral' as Tone,
      },
      {
        label: 'History',
        title: recentEvents.length > 0 ? `${countLabel(recentEvents.length, 'recent change')}` : 'No recent changes',
        detail: recentEvents[0]?.label ?? 'Timeline will fill in as runs, reviews, and decisions are recorded.',
        href: currentProjectHref('/timeline', activeProjectId),
        tone: 'neutral' as Tone,
      },
    ]
  })

  const nextAction = $derived.by(() => {
    const shared = detail.actionModel?.primaryAction
    if (shared) {
      return {
        label: shared.label ?? 'Open project action',
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
      label: 'No urgent action',
      detail: 'This project has no active task pressure right now.',
      button: 'Open Work',
      href: currentProjectHref('/work', activeProjectId),
      tone: 'neutral' as Tone,
      action: 'navigate' as NextActionKind,
    }
  })

  function inboxActionLabel(item: InboxItem): string {
    switch (item.kind) {
      case 'project_understanding': return 'Review update'
      case 'workspace_import_pending': return 'Review import'
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
    return tasks
      .filter(task => task.status === 'blocked' || activeEscalations(task).length > 0 || (Boolean(task.blockReason) && !isRunnableStatus(task.status)))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .map(task => ({
        task,
        reason: blockerReason(task),
        category: inferBlockerCategory(task),
        href: currentTaskHref(task.id, activeProjectId),
      }))
      .slice(0, 4)
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
    if (detail.startReadiness?.canStart === false) {
      return {
        label: shared?.label ?? startReadinessLabel(detail.startReadiness.code),
        detail: shared?.detail ?? detail.startReadiness.message ?? 'Resolve one thing before Start can move work.',
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
        ? 'Needs brief: finish the handoff before a worker can start.'
        : `${taskPresentation(task).label}: available for the next worker slot.`,
      4,
    )
    addTasks(['spec_review', 'import_draft'], 'warn', task => `${taskPresentation(task).label}: needs review before it can move.`, 4)
    addTasks(['exploring'], 'neutral', task => `${taskPresentation(task).label}: awaiting the next pass.`, 4)

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

  function primitiveLabel(primitive: { id?: string; label?: string }): string {
    return primitive.label?.trim() || primitive.id || 'Primitive'
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
    return [...tasks]
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

    if (/provider|oauth|api key|model|fallback|stripe|supabase auth/.test(haystack)) return 'Provider settings'
    if (/git|branch|commit|push|dirty|merge/.test(haystack)) return 'Git story closure'
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

  async function applyStructuralMapAction(action: StructuralMapAction): Promise<void> {
    if (!structuralMapReview?.id || structuralMapActionBusy) return
    structuralMapActionBusy = true
    structuralMapActionError = null
    try {
      const res = await projectFetch('/api/project/structural-map/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mapId: structuralMapReview.id, action }),
      }, activeProjectId)
      const body = await res.json().catch(() => ({})) as {
        structuralMapReview?: ProjectDetail['structuralMapReview']
        error?: string
      }
      if (!res.ok) throw new Error(body.error ?? 'Could not update the project map.')
      localStructuralMapReview = body.structuralMapReview ?? null
    } catch (err) {
      structuralMapActionError = err instanceof Error ? err.message : String(err)
    } finally {
      structuralMapActionBusy = false
    }
  }

  function promptStructuralRename(nodeId: string, currentLabel: string): void {
    const label = window.prompt('Rename structural item', currentLabel)?.trim()
    if (!label || label === currentLabel) return
    void applyStructuralMapAction({ kind: 'rename_node', nodeId, label })
  }

  function promptStructuralSplit(nodeId: string, currentLabel: string): void {
    const label = window.prompt('New structural item label', currentLabel)?.trim()
    if (!label) return
    void applyStructuralMapAction({ kind: 'split_node', nodeId, newNodeId: `domain:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, label })
  }

  function promptStructuralIgnore(nodeId: string): void {
    const reason = window.prompt('Reason to ignore this structural item')?.trim()
    if (!reason) return
    void applyStructuralMapAction({ kind: 'ignore_node', nodeId, reason })
  }

  function promptStructuralMerge(sourceNodeId: string): void {
    const targetNodeId = window.prompt('Merge into structural item id')?.trim()
    if (!targetNodeId || targetNodeId === sourceNodeId) return
    void applyStructuralMapAction({ kind: 'merge_nodes', sourceNodeId, targetNodeId })
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

  function runtimeModeLabel(mode: string | undefined): string {
    if (mode === 'runtime-backed') return 'Podman runtime mode'
    if (mode === 'host-run') return 'Compatibility mode'
    return 'Runtime mode unknown'
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
  <section class="hero" aria-label="Project overview">
    <div class="hero-copy">
      <p class="eyebrow">Overview</p>
      <h1>{detail.name ?? detail.id ?? 'Project'}</h1>
      {#if displayPath}
        <p class="path">{displayPath}</p>
      {/if}
    </div>
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
  </section>

  <section class="knowledge-band" aria-label="Project knowledge summary">
    {#each knowledgeCards as card (card.label)}
      <CardListItem
        as="button"
        className="knowledge-summary-item"
        tone={card.tone === 'danger' ? 'danger' : card.tone === 'warn' ? 'warn' : card.tone === 'ok' || card.tone === 'running' ? 'ok' : card.tone === 'accent' ? 'accent' : 'neutral'}
        onclick={() => go(card.href)}
      >
        <Chip label={card.label} tone={card.tone === 'danger' ? 'danger' : card.tone === 'warn' ? 'warn' : card.tone === 'ok' || card.tone === 'running' ? 'ok' : card.tone === 'accent' ? 'accent' : 'neutral'} />
        <strong>{card.title}</strong>
        <p>{card.detail}</p>
      </CardListItem>
    {/each}
  </section>

  <section class="overview-priority" aria-label="Priority action">
    <Card title="Do this next" titleTag="h2" tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'accent'} variant="callout" railStrength="strong" className="overview-card overview-priority-card">
      <div class="next-action">
        <Chip label={nextAction.tone === 'running' ? 'Live' : nextAction.tone === 'warn' || nextAction.tone === 'danger' ? 'Needs attention' : 'Ready'} tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'neutral'} />
        <h2>{nextAction.label}</h2>
        {#if nextAction.content && nextAction.content !== nextAction.label}
          <p class="task-content">{nextAction.content}</p>
        {/if}
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
  </section>

  {#if deliverySpine}
    <section class="delivery-band" aria-label="Delivery spine">
      <Card title="Delivery spine" titleTag="h2" className="overview-card">
        <div class="delivery-summary">
          <div>
            <span>Driver</span>
            <strong>{primaryDriver?.label ?? 'No primary driver set'}</strong>
          </div>
          <div>
            <span>Next runnable work</span>
            <strong>{nextQueueCandidate?.task ? taskLabel(nextQueueCandidate.task) : 'No runnable task'}</strong>
          </div>
          <div>
            <span>Primitive proof blockers</span>
            <strong>{primitiveBlockerSummary.length ? primitiveBlockerSummary.map(primitiveLabel).join(', ') : 'None'}</strong>
          </div>
          <div>
            <span>Validation</span>
            <strong>{deliverySpine.validation?.valid === false ? 'Needs review' : 'Valid'}</strong>
          </div>
        </div>
        {#if nextQueueCandidate?.why}
          <p class="muted">{nextQueueCandidate.why}</p>
        {/if}
      </Card>
    </section>
  {/if}

  <section class="overview-grid overview-grid-main">
    <Card title="Moving now" titleTag="h2" className="overview-card">
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

    <Card title="Needs you" titleTag="h2" className="overview-card">
      {#if inboxError}
        <p class="muted">Could not load owner actions: {inboxError}</p>
      {:else if !inboxLoaded}
        <p class="muted">Checking for owner actions...</p>
      {:else if actionableInbox.length === 0}
        <p class="muted">No owner action is blocking the project right now.</p>
      {:else}
        <CardList className="action-list">
          {#each actionableInbox as item (inboxItemKey(item))}
            <CardListItem as="button" className="action-row" onclick={() => go(item.actionHref ?? '/thread')}>
              <span class="action-title">{item.title}</span>
              {#if item.taskDescription && item.taskDescription !== item.title}
                <span class="action-content">{item.taskDescription}</span>
              {/if}
              <span>{item.detail}</span>
            </CardListItem>
          {/each}
        </CardList>
      {/if}
    </Card>
  </section>

  <section class="overview-grid">
    <Card title="Work mix" titleTag="h2" className="overview-card">
      <WorkMixChart
        ariaLabel={`Work mix: ${counts.total} tasks`}
        {segments}
        emptyLabel={emptyWorkMixLabel}
        onLegendClick={() => go(currentProjectHref('/work', activeProjectId))}
      />
    </Card>

    <Card title="Blocked work" titleTag="h2" className="overview-card">
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

    <Card title="Next run" titleTag="h2" className="overview-card">
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

  <section class="overview-grid">
    <Card title="Runtime and memory" titleTag="h2" className="overview-card">
      <div class="signal-list">
        <UtilityPanel as="button" interactive className="signal-row" tone="neutral" onclick={() => go(currentProjectHref('/settings/ready', activeProjectId))}>
          <StatusDot tone={runtimeTone(runtime?.status, runtime?.health?.status) === 'running' ? 'active' : runtimeTone(runtime?.status, runtime?.health?.status) === 'ok' ? 'ok' : runtimeTone(runtime?.status, runtime?.health?.status) === 'danger' ? 'danger' : runtimeTone(runtime?.status, runtime?.health?.status) === 'warn' ? 'warn' : 'idle'} pulse={runtime?.status === 'running'} size="sm" />
          <div>
            <strong>{runtimeHealthLabel(runtime?.status, runtime?.health?.status)}</strong>
            <span>{runtimeModeLabel(runtime?.migration?.mode)}{#if runtime?.lastActivityAt} · active {formatDate(runtime.lastActivityAt)}{/if}</span>
          </div>
        </UtilityPanel>
        <UtilityPanel as="button" interactive className="signal-row" tone={(memoryHealth?.active ?? 0) > 0 ? 'ok' : (memoryHealth?.proposed ?? 0) > 0 ? 'warn' : 'neutral'} onclick={() => go(currentProjectHref('/settings/learning', activeProjectId))}>
          <StatusDot tone={(memoryHealth?.active ?? 0) > 0 ? 'ok' : (memoryHealth?.proposed ?? 0) > 0 ? 'warn' : 'idle'} size="sm" />
          <div>
            <strong>Memory health</strong>
            <span>
              {memoryHealth?.active ?? 0} active · {memoryHealth?.proposed ?? 0} proposed · {memoryHealth?.used ?? 0} used
            </span>
          </div>
        </UtilityPanel>
      </div>
    </Card>

    {#if showAdvancedStructure && structuralMapReview}
      <Card title="Project map" titleTag="h2" className="overview-card">
        <div class="structural-map-review">
          <div class="map-review-head">
            <Chip label={structuralStateLabel(structuralMapReview.state)} tone={structuralMapReview.state === 'accepted' ? 'ok' : structuralMapReview.state === 'correction_requested' ? 'warn' : 'neutral'} />
            {#if structuralMapReview.generatedAt}
              <span>Mapped {formatDate(structuralMapReview.generatedAt)}</span>
            {/if}
          </div>
          <div class="map-action-bar">
            {#if structuralMapReview.state !== 'accepted'}
              <Button variant="secondary" size="sm" onclick={() => void applyStructuralMapAction({ kind: 'accept' })} disabled={structuralMapActionBusy}>
                <Icon name="check" size={14} />
                Accept map
              </Button>
            {/if}
            {#if (structuralMapReview.domains ?? [])[0]}
              <Button variant="ghost" size="sm" onclick={() => promptStructuralRename((structuralMapReview.domains ?? [])[0].id, (structuralMapReview.domains ?? [])[0].label)} disabled={structuralMapActionBusy}>
                Rename
              </Button>
              <Button variant="ghost" size="sm" onclick={() => promptStructuralMerge((structuralMapReview.domains ?? [])[0].id)} disabled={structuralMapActionBusy}>
                Merge
              </Button>
              <Button variant="ghost" size="sm" onclick={() => promptStructuralSplit((structuralMapReview.domains ?? [])[0].id, (structuralMapReview.domains ?? [])[0].label)} disabled={structuralMapActionBusy}>
                Split
              </Button>
              <Button variant="ghost" size="sm" onclick={() => void applyStructuralMapAction({ kind: 'mark_cross_cutting', nodeId: (structuralMapReview.domains ?? [])[0].id })} disabled={structuralMapActionBusy}>
                Cross-cutting
              </Button>
              <Button variant="ghost" size="sm" onclick={() => promptStructuralIgnore((structuralMapReview.domains ?? [])[0].id)} disabled={structuralMapActionBusy}>
                Ignore
              </Button>
            {/if}
            {#if (structuralMapReview.packages ?? [])[0]}
              <Button variant="ghost" size="sm" onclick={() => void applyStructuralMapAction({ kind: 'mark_package_only', nodeId: (structuralMapReview.packages ?? [])[0].id })} disabled={structuralMapActionBusy}>
                Package-only
              </Button>
            {/if}
          </div>
          {#if structuralMapActionError}
            <p class="map-action-error">{structuralMapActionError}</p>
          {/if}

          <div class="map-metrics" aria-label="Project map counts">
            {#each structuralMapMetricRows as metric (metric)}
              <span>{metric}</span>
            {/each}
          </div>

          <div class="map-review-sections">
            {#if (structuralMapReview.domains ?? []).length > 0 || (structuralMapReview.crossCuttingDomains ?? []).length > 0}
              <div class="map-review-section">
                <strong>Domains</strong>
                <div class="map-token-list">
                  {#each [...(structuralMapReview.domains ?? []), ...(structuralMapReview.crossCuttingDomains ?? [])] as item (item.id)}
                    <span>{item.label}</span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if (structuralMapReview.packages ?? []).length > 0}
              <div class="map-review-section">
                <strong>Packages</strong>
                <div class="map-token-list">
                  {#each (structuralMapReview.packages ?? []).slice(0, 4) as item (item.id)}
                    <span>{item.label}</span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if (structuralMapReview.executableUnits ?? []).length > 0}
              <div class="map-review-section">
                <strong>Executable units</strong>
                <div class="map-token-list">
                  {#each (structuralMapReview.executableUnits ?? []).slice(0, 3) as item (item.id)}
                    <span>{item.command ?? item.label}</span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if (structuralMapReview.gitRoots ?? []).length > 0 || (structuralMapReview.ignoredGitRoots ?? []).length > 0}
              <div class="map-review-section">
                <strong>Git authority</strong>
                <div class="map-token-list">
                  {#each [...(structuralMapReview.gitRoots ?? []), ...(structuralMapReview.ignoredGitRoots ?? [])] as item (item.id)}
                    <span>{item.path ?? item.label}</span>
                  {/each}
                </div>
              </div>
            {/if}

            {#if (structuralMapReview.conflicts ?? []).length > 0}
              <div class="map-review-section map-review-warning">
                <strong>Conflicts</strong>
                <span>{(structuralMapReview.conflicts ?? []).map(item => item.message).filter(Boolean).join(' ')}</span>
              </div>
            {/if}

            {#if (structuralMapReview.questions ?? []).length > 0}
              <div class="map-review-section map-review-warning">
                <strong>Owner input</strong>
                <span>{(structuralMapReview.questions ?? []).map(item => item.prompt).filter(Boolean).join(' ')}</span>
                <a
                  class="map-thread-link"
                  href={currentProjectHref('/thread', activeProjectId)}
                  onclick={(event) => {
                    event.preventDefault()
                    go(currentProjectHref('/thread', activeProjectId))
                  }}
                >Open Thread</a>
              </div>
            {/if}
          </div>
        </div>
      </Card>
    {/if}

    <Card title="Primary proof paths" titleTag="h2" className="overview-card">
      {#if primaryProofPaths.length === 0}
        <p class="muted">No proof paths have been planned yet.</p>
      {:else}
        <div class="proof-path-list">
          {#each primaryProofPaths as item (`${item.task.id}:${item.proofPath.id ?? item.proofPath.title}`)}
            <UtilityPanel as="button" interactive className="proof-path-row" tone={item.proofPath.status === 'blocked' ? 'warn' : item.proofPath.status === 'verified' ? 'ok' : 'neutral'} onclick={() => go(currentTaskHref(item.task.id, activeProjectId))}>
              <div>
                <strong>{item.proofPath.title ?? 'Proof path'}</strong>
                <span>{item.proofPath.summary ?? taskLabel(item.task)}</span>
              </div>
              <Chip label={friendlyStatus(item.proofPath.status)} tone={item.proofPath.status === 'verified' ? 'ok' : item.proofPath.status === 'blocked' ? 'warn' : 'neutral'} />
            </UtilityPanel>
          {/each}
        </div>
      {/if}
    </Card>
  </section>

  <section class="overview-grid">
    <Card title="Project health" titleTag="h2" className="overview-card">
      <div class="health-list">
        {#each healthItems as item (`${item.label}:${item.detail}`)}
          <UtilityPanel
            as="button"
            interactive
            className="health-row"
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
      </div>
    </Card>

    <Card title="Recent changes" titleTag="h2" className="overview-card">
      {#if recentEvents.length === 0}
        <p class="muted">No meaningful recent activity yet.</p>
      {:else}
        <div class="event-list">
          {#each recentEvents as item (`${item.event.at ?? ''}:${item.label}`)}
            <div class="event-row">
              <span>{item.event.at ? item.event.at.slice(11, 16) : '--:--'}</span>
              <p>{item.label}</p>
            </div>
          {/each}
        </div>
        <Button variant="secondary" size="sm" onclick={() => go(currentProjectHref('/timeline', activeProjectId))}>
          <Icon name="clock" size={14} />
          Open Timeline
        </Button>
      {/if}
    </Card>
  </section>
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
    align-items: stretch;
  }
  .overview-grid-main {
    grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
  }
  .overview-priority {
    min-width: 0;
  }
  :global(.overview-card) {
    min-width: 0;
  }
  .knowledge-band {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-3);
  }
  :global(.knowledge-summary-item) {
    display: grid;
    align-content: start;
    gap: var(--s-2);
    min-height: 8.2rem;
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
  :global(.action-row),
  :global(.health-row),
  :global(.signal-row),
  :global(.proof-path-row),
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
  }
  .next-action p {
    margin: 0;
    color: var(--text-muted);
    line-height: var(--gh-type-line-height-body);
  }
  .next-action .task-content {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  :global(.action-list),
  .motion-list,
  .health-list,
  .signal-list,
  .proof-path-list,
  .event-list,
  .blocked-work-list,
  .run-plan-list {
    display: grid;
    gap: var(--s-2);
  }
  :global(.action-row) {
    display: grid;
    gap: var(--s-1);
  }
  .action-title {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
  }
  .action-content {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  :global(.action-row) span:last-child,
  :global(.health-row) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  :global(.health-row),
  :global(.signal-row),
  :global(.proof-path-row),
  :global(.run-blocker),
  :global(.run-plan-row) {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
  }
  :global(.health-row) div,
  :global(.signal-row) div,
  :global(.proof-path-row) div,
  :global(.run-blocker) div,
  :global(.run-plan-row) div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  :global(.health-row) strong,
  :global(.signal-row) strong,
  :global(.proof-path-row) strong,
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
  :global(.proof-path-row) span,
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
  .structural-map-review,
  .map-review-sections {
    display: grid;
    gap: var(--s-3);
    min-width: 0;
  }
  .delivery-summary {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--s-3);
  }
  .delivery-summary div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .delivery-summary span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .delivery-summary strong {
    overflow-wrap: anywhere;
  }
  .map-review-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .map-metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .map-action-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .map-action-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .map-metrics span {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.2rem 0.45rem;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
  }
  .map-review-section {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
    padding-top: var(--s-2);
    border-top: 1px solid var(--border);
  }
  .map-review-section strong {
    color: var(--text);
    font-size: var(--gh-type-size-meta);
  }
  .map-review-section span,
  .map-token-list span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  .map-token-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
  }
  .map-token-list span {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.15rem 0.4rem;
  }
  .map-review-warning span {
    color: var(--text);
  }
  .map-thread-link {
    justify-self: start;
    color: var(--accent);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-strong);
    text-decoration: none;
  }
  .map-thread-link:hover {
    text-decoration: underline;
  }
  .event-row {
    display: grid;
    grid-template-columns: 48px minmax(0, 1fr);
    gap: var(--s-2);
    align-items: start;
    padding: var(--s-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .event-row:last-child {
    border-bottom: 0;
  }
  .event-row span {
    color: var(--text-muted);
    font-family: 'SF Mono', monospace;
    font-size: var(--gh-type-size-caption);
  }
  .event-row p {
    margin: 0;
    color: var(--text);
    line-height: var(--gh-type-line-height-body);
    overflow-wrap: anywhere;
  }
  :global(.action-row:hover),
  :global(.signal-row:hover),
  :global(.proof-path-row:hover),
  :global(.run-plan-row:hover),
  :global(.run-blocker:hover),
  :global(.overview-task-row:hover) {
    border-color: var(--border-strong);
  }

  @media (max-width: 980px) {
    .hero,
    .overview-grid,
    .overview-grid-main {
      grid-template-columns: 1fr;
    }
    .knowledge-band {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .delivery-summary {
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
    .knowledge-band {
      grid-template-columns: 1fr;
    }
    .delivery-summary {
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
    .next-action :global(.btn) {
      width: 100%;
    }
    :global(.health-row),
    :global(.run-blocker),
    :global(.run-plan-row),
    :global(.action-row) {
      padding: var(--s-2);
    }
    :global(.run-plan-row) { grid-template-columns: 1fr; }
    .run-index {
      width: 1.5rem;
      height: 1.5rem;
    }
  }
</style>
