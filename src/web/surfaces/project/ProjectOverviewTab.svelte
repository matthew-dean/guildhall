<!--
  Project Overview - a live project dashboard. This is the project-card idea
  expanded into a first-stop surface: work mix, attention, motion, health, and
  recent meaningful changes.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/Card.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import StatusDot from '../../lib/StatusDot.svelte'
  import { friendlyDomain, friendlyStatus } from '../../lib/display.js'
  import { formatUserPath } from '../../lib/display-path.js'
  import { summarizeEvent } from '../../lib/events.js'
  import { friendlyTaskId } from '../../lib/identifier-labels.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentProjectHref, currentTaskHref, projectActionHref } from '../../lib/project-routes.js'
  import type { InboxItem } from '../../lib/inbox-item-key.js'
  import type { EventEnvelope, ProjectDetail, Task } from '../../lib/types.js'
  import { hasCurrentGitUnavailableStory, type ProjectActivityLine } from '../../lib/project-activity.js'
  import { isGitUnavailableMessage } from '../../lib/runtime-message.js'

  interface Props {
    detail: ProjectDetail
    inboxItems?: InboxItem[]
    inboxLoaded?: boolean
    inboxError?: string | null
    projectTicker: ProjectActivityLine
    activeProjectId?: string | null
  }

  let {
    detail,
    inboxItems = [],
    inboxLoaded = false,
    inboxError = null,
    projectTicker,
    activeProjectId = null,
  }: Props = $props()

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  interface Segment {
    key: string
    label: string
    count: number
    tone: 'working' | 'draft' | 'ready' | 'blocked' | 'done' | 'shelved'
  }

  interface BlockedRow {
    task: Task
    reason: string
    dependency: string
    href: string
  }

  interface RunPlanRow {
    task: Task | null
    label: string
    detail: string
    tone: Tone
    href: string
  }

  const tasks = $derived(detail.tasks ?? [])
  const displayPath = $derived(formatUserPath(detail.path))
  const running = $derived(detail.run?.status === 'running')
  const actionableInbox = $derived(inboxItems.filter(item => item.severity !== 'low').slice(0, 3))

  const counts = $derived.by(() => {
    const count = (statuses: string[]) => tasks.filter(task => statuses.includes(task.status ?? '')).length
    return {
      total: tasks.length,
      shaping: count(['import_draft', 'exploring']),
      approval: count(['spec_review']),
      ready: count(['ready']),
      working: count(['in_progress', 'review', 'gate_check']),
      blocked: count(['blocked']),
      done: count(['done', 'pending_pr']),
      shelved: count(['shelved']),
    }
  })

  const segments = $derived<Segment[]>([
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

  const recentEvents = $derived.by(() => {
    return (detail.recentEvents ?? [])
      .slice()
      .reverse()
      .map(event => ({ event, label: summarizeEvent(event) }))
      .filter(item => !isResolvedGitUnavailableEvent(item.event))
      .filter(item => item.label && !isLowSignalEvent(item.event))
      .slice(0, 5)
  })

  const healthItems = $derived.by(() => {
    const items: Array<{ label: string; detail: string; tone: Tone; href: string }> = []
    const provider = detail.providerStatus
    if (provider?.fallback) {
      items.push({
        label: 'Provider fallback',
        detail: provider.decisions?.[0]?.message ?? 'Guildhall is using a fallback provider.',
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
        detail: gitBlockers[0]?.reason ?? gitBlockers[0]?.label ?? `${gitBlockers.length} git ${gitBlockers.length === 1 ? 'item' : 'items'} need attention.`,
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

  const nextAction = $derived.by(() => {
    const inbox = actionableInbox[0]
    if (inbox) {
      return {
        label: inbox.title,
        detail: inbox.detail,
        button: 'Open',
        href: inbox.actionHref ?? '/thread',
        tone: inbox.severity === 'high' ? 'danger' as Tone : 'warn' as Tone,
      }
    }
    if (activeTask?.status === 'blocked') {
      return {
        label: activeTask.title ?? friendlyTaskId(activeTask.id),
        detail: activeTask.blockReason ?? 'This task needs recovery or a decision.',
        button: 'Open task',
        href: currentTaskHref(activeTask.id, activeProjectId),
        tone: 'warn' as Tone,
      }
    }
    if (activeTask?.status === 'spec_review') {
      return {
        label: activeTask.title ?? friendlyTaskId(activeTask.id),
        detail: 'A spec is ready for review.',
        button: 'Review in Thread',
        href: currentProjectHref('/thread', activeProjectId),
        tone: 'warn' as Tone,
      }
    }
    if (activeTask) {
      return {
        label: activeTask.title ?? friendlyTaskId(activeTask.id),
        detail: statusDetail(activeTask),
        button: 'Open work',
        href: currentProjectHref('/work', activeProjectId),
        tone: running ? 'running' as Tone : 'accent' as Tone,
      }
    }
    return {
      label: 'No urgent action',
      detail: 'This project has no active task pressure right now.',
      button: 'Open Work',
      href: currentProjectHref('/work', activeProjectId),
      tone: 'neutral' as Tone,
    }
  })

  const blockedRows = $derived.by(() => {
    return tasks
      .filter(task => task.status === 'blocked' || Boolean(task.blockReason) || (task.escalations ?? []).some(escalation => !escalation.resolvedAt))
      .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .map(task => ({
        task,
        reason: blockerReason(task),
        dependency: inferDependency(task),
        href: currentTaskHref(task.id, activeProjectId),
      }))
      .slice(0, 4)
  })

  const runBlocker = $derived.by(() => {
    if (detail.startReadiness?.canStart === false) {
      return {
        label: startReadinessLabel(detail.startReadiness.code),
        detail: detail.startReadiness.message ?? 'Guildhall needs one thing resolved before Start can move work.',
        href: detail.startReadiness.actionHref ?? currentProjectHref('/overview', activeProjectId),
      }
    }
    if (detail.providerStatus?.fallback) {
      return {
        label: 'Provider fallback active',
        detail: detail.providerStatus.decisions?.[0]?.message ?? 'Guildhall is using a fallback provider for this project.',
        href: currentProjectHref('/settings/providers', activeProjectId),
      }
    }
    return null
  })

  const runPlanRows = $derived.by(() => {
    const rows: RunPlanRow[] = []
    const addTasks = (wanted: string[], tone: Tone, detail: (task: Task) => string, limit: number) => {
      for (const task of sortedTasks(wanted)) {
        if (rows.length >= limit) return
        rows.push({
          task,
          label: task.title ?? friendlyTaskId(task.id),
          detail: detail(task),
          tone,
          href: currentTaskHref(task.id, activeProjectId),
        })
      }
    }

    addTasks(['in_progress', 'review', 'gate_check'], running ? 'running' : 'accent', task => `${friendlyStatus(task.status)}: ${statusDetail(task)}`, 4)
    addTasks(['ready'], 'accent', task => `${friendlyStatus(task.status)}: ready for the next worker slot.`, 4)
    addTasks(['spec_review', 'import_draft'], 'warn', task => `${friendlyStatus(task.status)}: needs review before it can move.`, 4)
    addTasks(['exploring'], 'neutral', task => `${friendlyStatus(task.status)}: still being shaped.`, 4)

    if (!rows.length && blockedRows.length > 0) {
      rows.push({
        task: blockedRows[0]?.task ?? null,
        label: blockedRows[0]?.task.title ?? 'Resolve the blocker',
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
    return friendlyStatus(task.status)
  }

  function taskLabel(task: Task): string {
    return task.title ?? friendlyTaskId(task.id)
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
    const escalation = (task.escalations ?? []).find(item => !item.resolvedAt)
    if (escalation?.summary) return friendlyBlockerText(escalation.summary)
    const inbox = inboxItems.find(item => item.taskId === task.id || item.title === task.title)
    if (inbox?.detail) return inbox.detail
    return 'This task is blocked and needs triage.'
  }

  function friendlyBlockerText(value: string): string {
    const text = value.trim()
    if (!text) return text
    if (/\bAC-\d+\b/i.test(text) && /\bevidence\b/i.test(text)) {
      return 'Guildhall needs to run or save one missing verification check before this task can finish.'
    }
    if (/authoritative verification|upstream workspace build failure|checkpoint-touched|task worktree/i.test(text)) {
      return 'The project build is failing outside this task. Decide whether to reframe the task, fix the wider build first, or retry after the build is healthy.'
    }
    if (/no visible progress|made no visible progress|no saved (?:spec|draft)|no durable (?:draft|update)/i.test(text)) {
      return 'Guildhall found useful context but did not save the next draft. Decide whether to retry from those notes or reframe the task.'
    }
    const withoutCodePrefix = text.replace(/^[a-z][a-z0-9_]*:\s*/i, '').trim()
    if (/^spec_ambiguous\b/i.test(text)) return withoutCodePrefix || 'The task brief is missing a concrete implementation path.'
    if (/^human_judgment_required\b/i.test(text)) return withoutCodePrefix || 'Guildhall needs a product or recovery decision before it can continue.'
    return withoutCodePrefix
  }

  function inferDependency(task: Task): string {
    const explicit = (task.dependsOn ?? [])
      .map(id => tasks.find(candidate => candidate.id === id))
      .filter((candidate): candidate is Task => Boolean(candidate))
    if (explicit.length > 0) return explicit.map(taskLabel).join(', ')

    const reason = blockerReason(task)
    const haystack = `${reason} ${task.description ?? ''}`.toLowerCase()
    const referenced = tasks.find(candidate => {
      if (candidate.id === task.id) return false
      const title = candidate.title?.trim().toLowerCase()
      return haystack.includes(candidate.id.toLowerCase()) || (title && title.length > 8 && haystack.includes(title))
    })
    if (referenced) return taskLabel(referenced)

    const inbox = inboxItems.find(item => item.taskId === task.id || item.title === task.title)
    if (inbox?.missingSteps?.length) return inbox.missingSteps[0] ?? 'Missing prerequisite'

    if (/bootstrap|readiness|setup|supabase|database|migration|db\b/i.test(reason)) return 'Project readiness / bootstrap'
    if (/provider|model|api key|fallback/i.test(reason)) return 'Provider settings'
    if (/git|branch|commit|push|dirty|merge/i.test(reason)) return 'Git story closure'
    return 'Needs triage'
  }

  function startReadinessLabel(code: string | undefined): string {
    switch (code) {
      case 'import_drafts_waiting': return 'Drafts need review'
      case 'all_terminal': return 'No runnable tasks'
      case 'provider_unavailable': return 'Provider unavailable'
      case 'bootstrap_blocked': return 'Readiness blocked'
      default: return 'Start is blocked'
    }
  }

  function toneForTask(task: Task): Tone {
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
    <div class="live-card live-card-{projectTicker.tone}">
      <StatusDot tone={projectTicker.tone} pulse={projectTicker.pulse} size="sm" />
      <div>
        <strong>{projectTicker.actorLabel ?? projectTicker.label}</strong>
        <span>{projectTicker.message}</span>
      </div>
      {#if projectTicker.timeLabel}
        <small>{projectTicker.timeLabel}</small>
      {/if}
    </div>
  </section>

  <section class="overview-grid overview-grid-main">
    <Card title="Work mix" titleTag="h2" className="overview-card">
      <div class="workline" aria-label={`Work mix: ${counts.total} tasks`}>
        {#if segments.length}
          {#each segments as segment (segment.key)}
            <span
              class={`segment segment-${segment.tone}`}
              style={`flex: ${Math.max(1, segment.count)} 1 0;`}
              aria-label={`${segment.count} ${segment.label}`}
            ></span>
          {/each}
        {:else}
          <span class="segment segment-empty" aria-label="No tasks yet"></span>
        {/if}
      </div>
      <div class="segment-legend">
        {#each segments as segment (segment.key)}
          <button type="button" class="legend-item" onclick={() => go(currentProjectHref('/work', activeProjectId))}>
            <span class={`legend-dot segment-${segment.tone}`}></span>
            <span>{segment.label}</span>
            <strong>{segment.count}</strong>
          </button>
        {/each}
        {#if !segments.length}
          <p class="muted">No tasks yet. Create a request when you are ready.</p>
        {/if}
      </div>
    </Card>

    <Card title="Do this next" titleTag="h2" tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'accent'} className="overview-card">
      <div class="next-action">
        <Chip label={nextAction.tone === 'running' ? 'Live' : nextAction.tone === 'warn' || nextAction.tone === 'danger' ? 'Needs attention' : 'Ready'} tone={nextAction.tone === 'danger' ? 'danger' : nextAction.tone === 'warn' ? 'warn' : nextAction.tone === 'running' ? 'ok' : 'neutral'} />
        <h2>{nextAction.label}</h2>
        <p>{nextAction.detail}</p>
        <Button variant={nextAction.tone === 'warn' || nextAction.tone === 'danger' ? 'human' : 'secondary'} onclick={() => go(nextAction.href)}>
          {nextAction.button}
        </Button>
      </div>
    </Card>
  </section>

  <section class="overview-grid">
    <Card title="Needs you" titleTag="h2" className="overview-card">
      {#if inboxError}
        <p class="muted">Could not load owner actions: {inboxError}</p>
      {:else if !inboxLoaded}
        <p class="muted">Checking for owner actions...</p>
      {:else if actionableInbox.length === 0}
        <p class="muted">No owner action is blocking the project right now.</p>
      {:else}
        <div class="action-list">
          {#each actionableInbox as item (`${item.kind}:${item.taskId ?? ''}:${item.title}`)}
            <button type="button" class="action-row" onclick={() => go(item.actionHref ?? '/thread')}>
              <span class="action-title">{item.title}</span>
              <span>{item.detail}</span>
            </button>
          {/each}
        </div>
      {/if}
    </Card>

    <Card title="Moving now" titleTag="h2" className="overview-card">
      {#if movingTasks.length === 0}
        <p class="muted">{running ? 'Guildhall is running, but no task is currently active.' : 'No task is moving right now.'}</p>
      {:else}
        <div class="motion-list">
          {#each movingTasks as task (task.id)}
            <button type="button" class="motion-row" onclick={() => go(currentTaskHref(task.id, activeProjectId))}>
              <Chip label={friendlyStatus(task.status)} tone={toneForTask(task) === 'danger' ? 'danger' : toneForTask(task) === 'warn' ? 'warn' : toneForTask(task) === 'running' ? 'ok' : 'neutral'} />
              <div>
                <strong>{task.title ?? friendlyTaskId(task.id)}</strong>
                <span>{friendlyDomain(task.domain) || statusDetail(task)}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </Card>
  </section>

  <section class="overview-grid">
    <Card title="Blocked / depends on" titleTag="h2" className="overview-card">
      {#if blockedRows.length === 0}
        <p class="muted">No blocked task dependencies are visible right now.</p>
      {:else}
        <div class="dependency-list">
          {#each blockedRows as row (row.task.id)}
            <button type="button" class="dependency-row" onclick={() => go(row.href)}>
              <div>
                <strong>{taskLabel(row.task)}</strong>
                <span>{row.reason}</span>
              </div>
              <div class="depends-pill">
                <span>Depends on</span>
                <strong>{row.dependency}</strong>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </Card>

    <Card title="Next run" titleTag="h2" className="overview-card">
      {#if runBlocker}
        <button type="button" class="run-blocker" onclick={() => go(runBlocker.href)}>
          <Chip label="Blocked" tone="warn" />
          <div>
            <strong>{runBlocker.label}</strong>
            <span>{runBlocker.detail}</span>
          </div>
        </button>
      {/if}
      {#if runPlanRows.length === 0}
        <p class="muted">Nothing is queued for the next run yet.</p>
      {:else}
        <div class="run-plan-list" aria-label="Likely next run order">
          {#each runPlanRows as row, index (`${row.task?.id ?? 'fallback'}:${index}`)}
            <button type="button" class="run-plan-row" onclick={() => go(row.href)}>
              <span class="run-index">{index + 1}</span>
              <div>
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
              </div>
              <Chip label={row.tone === 'running' ? 'Live' : row.tone === 'warn' ? 'Needs review' : row.tone === 'accent' ? 'Likely next' : 'Later'} tone={row.tone === 'running' ? 'ok' : row.tone === 'warn' ? 'warn' : row.tone === 'accent' ? 'accent' : 'neutral'} />
            </button>
          {/each}
        </div>
      {/if}
    </Card>
  </section>

  <section class="overview-grid">
    <Card title="Project health" titleTag="h2" className="overview-card">
      <div class="health-list">
        {#each healthItems as item (`${item.label}:${item.detail}`)}
          <button type="button" class="health-row" onclick={() => go(item.href)}>
            <StatusDot tone={item.tone === 'running' ? 'active' : item.tone === 'ok' ? 'ok' : item.tone === 'danger' ? 'danger' : item.tone === 'warn' ? 'warn' : 'idle'} pulse={item.tone === 'running'} size="sm" />
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </div>
          </button>
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
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-6);
    line-height: 1.05;
    letter-spacing: 0;
  }
  .path {
    margin: var(--s-2) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    overflow-wrap: anywhere;
  }
  .live-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--s-3);
    min-width: 0;
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: var(--bg-raised);
  }
  .live-card div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .live-card strong {
    color: var(--text);
    font-size: var(--fs-1);
  }
  .live-card span,
  .live-card small,
  .muted {
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .live-card span {
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
  :global(.overview-card) {
    min-width: 0;
  }
  .workline {
    display: flex;
    gap: 3px;
    height: 18px;
    min-width: 0;
    overflow: hidden;
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-raised-2) 74%, black);
    border: 1px solid var(--border);
  }
  .segment {
    min-width: 12px;
  }
  .segment-working { background: var(--accent-2); }
  .segment-draft { background: var(--accent); }
  .segment-ready { background: var(--light-violet-warm); }
  .segment-blocked { background: var(--danger); }
  .segment-done { background: var(--ok); }
  .segment-shelved { background: var(--text-muted); }
  .segment-empty { background: var(--border); flex: 1; }
  .segment-legend {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--s-2);
    margin-top: var(--s-3);
  }
  .legend-item,
  .action-row,
  .motion-row,
  .health-row,
  .dependency-row,
  .run-blocker,
  .run-plan-row {
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-raised) 84%, transparent);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .legend-item {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--s-2);
    align-items: center;
    padding: var(--s-2);
    min-width: 0;
  }
  .legend-item span:not(.legend-dot) {
    color: var(--text-muted);
    font-size: var(--fs-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .legend-item strong {
    color: var(--text);
  }
  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 999px;
  }
  .next-action {
    display: grid;
    gap: var(--s-3);
  }
  .next-action h2 {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }
  .next-action p {
    margin: 0;
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .action-list,
  .motion-list,
  .health-list,
  .event-list,
  .dependency-list,
  .run-plan-list {
    display: grid;
    gap: var(--s-2);
  }
  .action-row {
    display: grid;
    gap: var(--s-1);
    padding: var(--s-3);
  }
  .action-title {
    color: var(--text);
    font-weight: 700;
  }
  .action-row span:last-child,
  .motion-row span,
  .health-row span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .motion-row,
  .health-row,
  .run-blocker,
  .run-plan-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--s-3);
    align-items: center;
    padding: var(--s-3);
  }
  .motion-row div,
  .health-row div,
  .run-blocker div,
  .run-plan-row div,
  .dependency-row div {
    display: grid;
    gap: var(--s-1);
    min-width: 0;
  }
  .motion-row strong,
  .health-row strong,
  .run-blocker strong,
  .run-plan-row strong,
  .dependency-row strong {
    color: var(--text);
    overflow-wrap: anywhere;
  }
  .dependency-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(160px, 0.42fr);
    gap: var(--s-3);
    align-items: stretch;
    padding: var(--s-3);
  }
  .dependency-row span,
  .run-blocker span,
  .run-plan-row span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .depends-pill {
    align-content: center;
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
  }
  .depends-pill span {
    color: var(--danger);
    font-size: var(--fs-0);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .run-blocker {
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
    font-size: var(--fs-0) !important;
    font-weight: 800;
  }
  .run-plan-row {
    grid-template-columns: auto minmax(0, 1fr) auto;
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
    font-size: var(--fs-0);
  }
  .event-row p {
    margin: 0;
    color: var(--text);
    line-height: var(--lh-body);
    overflow-wrap: anywhere;
  }
  button:hover {
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }

  @media (max-width: 980px) {
    .hero,
    .overview-grid,
    .overview-grid-main {
      grid-template-columns: 1fr;
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
    .live-card {
      grid-template-columns: auto minmax(0, 1fr);
    }
    h1 {
      font-size: var(--fs-5);
    }
    .live-card small {
      grid-column: 2;
    }
    .segment-legend {
      grid-template-columns: 1fr;
    }
    .next-action :global(.btn) {
      width: 100%;
    }
    .motion-row,
    .health-row,
    .dependency-row,
    .run-blocker,
    .run-plan-row,
    .action-row {
      padding: var(--s-2);
    }
    .dependency-row,
    .run-plan-row {
      grid-template-columns: 1fr;
    }
    .run-index {
      width: 1.5rem;
      height: 1.5rem;
    }
  }
</style>
