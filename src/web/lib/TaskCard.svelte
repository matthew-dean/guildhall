<!--
  Task mini-card. Used by Work, Planner, and Coordinators tabs.
  Clicking opens the drawer via the nav helper (which pushState's
  /task/:id and lets Router swap the drawer on).
-->
<script lang="ts">
  import { nav } from './nav.svelte.js'
  import Icon, { type IconName } from './Icon.svelte'
  import StatusLight from './StatusLight.svelte'
  import { friendlyDomain, friendlyStatus } from './display.js'
  import { activeEscalations } from './escalation.js'
  import type { TaskLite } from './types.js'

  const ACTIVE_STATUSES = new Set([
    'in_progress',
    'review',
    'gate_check',
    'exploring',
  ])

  type StatusTone = 'danger' | 'warn' | 'ok' | 'accent' | 'neutral'

  interface Props {
    task: TaskLite
    orchestratorRunning?: boolean
    displayStatusLabel?: string
    displayStatusTone?: StatusTone
    displayStatusIcon?: IconName
  }

  let {
    task,
    orchestratorRunning = false,
    displayStatusLabel,
    displayStatusTone,
    displayStatusIcon,
  }: Props = $props()

  const status = $derived(task.status ?? 'unknown')
  const statusLabel = $derived(displayStatusLabel ?? friendlyStatus(status))
  const isQueued = $derived(ACTIVE_STATUSES.has(status))
  const isActive = $derived(isQueued && orchestratorRunning)
  const prio = $derived(task.priority && task.priority !== 'normal' ? task.priority : '')
  const domainLabel = $derived(friendlyDomain(task.domain))
  const hasEscalations = $derived(
    activeEscalations(task).length > 0,
  )
  const reviewerBlurb = $derived.by(() => {
    const raw = typeof task.latestReviewerSummary === 'string' ? task.latestReviewerSummary : ''
    if (!raw) return ''
    const cleaned = raw
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/^- /gm, '')
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return ''
    return cleaned.length > 180 ? `${cleaned.slice(0, 177).trimEnd()}…` : cleaned
  })
  const checkpointBlurb = $derived.by(() => {
    const next = typeof task.latestCheckpoint?.nextPlannedAction === 'string'
      ? task.latestCheckpoint.nextPlannedAction.trim()
      : ''
    if (!next) return ''
    return next.length > 140 ? `${next.slice(0, 137).trimEnd()}…` : next
  })
  const terminalHeadline = $derived.by(() => {
    const raw = typeof task.terminalSummary?.headline === 'string'
      ? task.terminalSummary.headline.trim()
      : ''
    if (!raw) return ''
    return raw.length > 140 ? `${raw.slice(0, 137).trimEnd()}…` : raw
  })
  const terminalDetail = $derived.by(() => {
    const raw = typeof task.terminalSummary?.detail === 'string'
      ? task.terminalSummary.detail.trim()
      : ''
    if (!raw) return ''
    return raw.length > 140 ? `${raw.slice(0, 137).trimEnd()}…` : raw
  })
  const summaryLabel = $derived.by(() => {
    if (
      reviewerBlurb &&
      (task.revisionCount ?? 0) > 0 &&
      ['review', 'gate_check', 'blocked'].includes(status)
    ) return 'Latest review'
    if (checkpointBlurb && status === 'in_progress') return 'Next'
    if (terminalHeadline && ['done', 'pending_pr'].includes(status)) return 'Outcome'
    return ''
  })
  const summaryText = $derived.by(() => {
    if (
      reviewerBlurb &&
      (task.revisionCount ?? 0) > 0 &&
      ['review', 'gate_check', 'blocked'].includes(status)
    ) return reviewerBlurb
    if (checkpointBlurb && status === 'in_progress') return checkpointBlurb
    if (terminalHeadline && ['done', 'pending_pr'].includes(status)) {
      return terminalDetail ? `${terminalHeadline} ${terminalDetail}` : terminalHeadline
    }
    return ''
  })

  const statusTone = $derived<StatusTone>(
    displayStatusTone ??
      (status === 'blocked'
        ? 'danger'
        : status === 'shelved'
          ? 'warn'
          : status === 'pending_pr'
            ? 'warn'
          : status === 'done'
            ? 'ok'
            : isActive
              ? 'accent'
              : 'neutral'),
  )

  const statusIcon = $derived<IconName>(
    displayStatusIcon ?? (status === 'blocked'
      ? 'alert-triangle'
      : status === 'done'
        ? 'check-circle-2'
        : isActive
          ? 'loader'
          : 'circle'),
  )

  function open() {
    nav('/task/' + encodeURIComponent(task.id))
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

</script>

<div
  class="task-card st-{status} tone-{statusTone}"
  class:st-active={isActive}
  class:st-blocked-bold={status === 'blocked'}
  role="button"
  tabindex="0"
  onclick={open}
  onkeydown={onKey}
>
  <div class="tc-head">
    <span class="tc-status chip-{statusTone}" class:chip-loud={status === 'blocked'}>
      {#if isActive}
        <StatusLight pulse />
      {:else}
        <Icon name={statusIcon} size={12} />
      {/if}
      <span>{statusLabel}</span>
    </span>
    {#if isQueued && !orchestratorRunning}
      <span class="tc-queued" title="Queued — orchestrator is stopped">paused</span>
    {/if}
    {#if hasEscalations}
      <span class="tc-flag" title="Open escalation">
        <Icon name="alert-triangle" size={12} />
      </span>
    {/if}
  </div>
  <div class="tc-title">{task.title ?? '(untitled)'}</div>
  <div class="tc-meta">
    {#if domainLabel}<span>{domainLabel}</span>{/if}
    {#if prio}<span>· {prio}</span>{/if}
    {#if (task.revisionCount ?? 0) > 0}
      <span class="tc-rev">r{task.revisionCount}</span>
    {/if}
  </div>
  {#if summaryText}
    <div class="tc-summary">
      <span class="tc-summary-label">{summaryLabel}:</span>
      <span>{summaryText}</span>
    </div>
  {/if}
</div>

<style>
  .task-card {
    background: var(--bg-raised);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-2);
    padding: var(--s-2) var(--s-3);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    border-left-width: 3px;
    border-left-color: var(--stripe-neutral);
  }
  .task-card:hover {
    border-color: var(--accent);
    border-left-width: 3px;
  }
  .tone-danger { border-left-color: var(--stripe-danger); }
  .tone-warn { border-left-color: var(--stripe-warn); }
  .tone-ok { border-left-color: var(--stripe-ok); }
  .tone-accent { border-left-color: var(--stripe-accent); }

  .st-active {
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-raised));
  }
  .st-done {
    background: color-mix(in srgb, var(--accent-2) 6%, var(--bg-raised));
    border-color: color-mix(in srgb, var(--accent-2) 24%, var(--border-strong));
  }
  .st-shelved {
    background: color-mix(in srgb, var(--warn) 6%, var(--bg-raised));
    border-color: color-mix(in srgb, var(--warn) 24%, var(--border-strong));
  }
  .st-blocked-bold {
    background: color-mix(in srgb, var(--danger) 8%, var(--bg-raised));
  }

  .tc-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .tc-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    color: var(--text-muted);
    background: rgba(136, 136, 153, 0.12);
  }
  .chip-danger {
    color: var(--danger);
    background: rgba(224, 82, 82, 0.15);
  }
  .chip-warn {
    color: var(--warn);
    background: rgba(212, 162, 60, 0.15);
  }
  .chip-ok {
    color: var(--accent-2);
    background: rgba(78, 204, 163, 0.15);
  }
  .chip-accent {
    color: var(--accent);
    background: rgba(124, 109, 240, 0.15);
  }
  .chip-loud {
    font-weight: 800;
    box-shadow: 0 0 0 1px var(--danger);
  }
  .tc-queued {
    color: var(--warn);
    text-transform: none;
    letter-spacing: 0;
  }
  .tc-flag {
    color: var(--warn);
    display: inline-flex;
    align-items: center;
  }
  .tc-title {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    font-weight: 600;
  }
  .tc-meta {
    font-size: var(--fs-0);
    color: var(--text-muted);
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .tc-summary {
    font-size: var(--fs-1);
    color: color-mix(in srgb, var(--text) 78%, var(--text-muted));
    line-height: var(--lh-body);
    display: grid;
    gap: 2px;
    overflow: hidden;
  }
  .tc-summary > span:last-child {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
    word-break: break-word;
  }
  .tc-summary-label {
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-dim);
  }
  .st-done .tc-title,
  .st-shelved .tc-title {
    color: color-mix(in srgb, var(--text) 88%, var(--text-muted));
  }
  .st-done .tc-meta,
  .st-shelved .tc-meta {
    color: color-mix(in srgb, var(--text-muted) 88%, var(--text-dim));
  }
  .tc-rev {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
  }
</style>
