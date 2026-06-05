<!--
  Task mini-card. Used by Work, Planner, and Coordinators tabs.
  Clicking opens the drawer via the nav helper (which pushState's
  /task/:id and lets Router swap the drawer on).
-->
<script lang="ts">
  import { nav, path } from './nav.svelte.js'
  import CardListItem from './CardListItem.svelte'
  import Chip from './Chip.svelte'
  import { currentTaskHref } from './project-routes.js'
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
  interface TaskCardSummary {
    label: string
    text: string
  }

  interface Props {
    task: TaskLite
    coordinatorRunning?: boolean
    displayStatusLabel?: string
    displayStatusTone?: StatusTone
    displayStatusIcon?: IconName
  }

  let {
    task,
    coordinatorRunning = false,
    displayStatusLabel,
    displayStatusTone,
    displayStatusIcon,
  }: Props = $props()

  const status = $derived(task.status ?? 'unknown')
  const statusLabel = $derived(displayStatusLabel ?? friendlyStatus(status))
  const isQueued = $derived(ACTIVE_STATUSES.has(status))
  const isActive = $derived(isQueued && coordinatorRunning)
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
    return cleaned.length > 180 ? `${cleaned.slice(0, 177).trimEnd()}...` : cleaned
  })
  const checkpointBlurb = $derived.by(() => {
    const next = typeof task.latestCheckpoint?.nextPlannedAction === 'string'
      ? task.latestCheckpoint.nextPlannedAction.trim()
      : ''
    if (!next) return ''
    return next.length > 140 ? `${next.slice(0, 137).trimEnd()}...` : next
  })
  const terminalHeadline = $derived.by(() => {
    const raw = typeof task.terminalSummary?.headline === 'string'
      ? task.terminalSummary.headline.trim()
      : ''
    if (!raw) return ''
    return raw.length > 140 ? `${raw.slice(0, 137).trimEnd()}...` : raw
  })
  const terminalDetail = $derived.by(() => {
    const raw = typeof task.terminalSummary?.detail === 'string'
      ? task.terminalSummary.detail.trim()
      : ''
    if (!raw) return ''
    return raw.length > 140 ? `${raw.slice(0, 137).trimEnd()}...` : raw
  })
  const summary = $derived.by<TaskCardSummary | null>(() => {
    if (
      reviewerBlurb &&
      (task.revisionCount ?? 0) > 0 &&
      ['review', 'gate_check', 'blocked'].includes(status)
    ) return { label: 'Latest review', text: reviewerBlurb }
    if (checkpointBlurb && status === 'in_progress') return { label: 'Next', text: checkpointBlurb }
    if (terminalHeadline && ['done', 'pending_pr'].includes(status)) {
      return {
        label: 'Outcome',
        text: terminalDetail ? `${terminalHeadline} ${terminalDetail}` : terminalHeadline,
      }
    }
    return null
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
  const statusChipTone = $derived<'danger' | 'warn' | 'ok' | 'accent' | 'neutral'>(
    statusTone,
  )

  function open() {
    nav(currentTaskHref(task.id), { backgroundPath: path.value })
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      open()
    }
  }

</script>

<CardListItem
  as="button"
  className={[
    'task-card',
    `st-${status}`,
    `tone-${statusTone}`,
    isActive ? 'st-active' : '',
    status === 'blocked' ? 'st-blocked-bold' : '',
  ].filter(Boolean).join(' ')}
  tone={statusTone === 'accent' ? 'accent' : statusTone === 'ok' ? 'ok' : statusTone === 'warn' ? 'warn' : statusTone === 'danger' ? 'danger' : 'neutral'}
  railTone={statusTone === 'accent' ? 'accent' : statusTone === 'ok' ? 'ok' : statusTone === 'warn' ? 'warn' : statusTone === 'danger' ? 'danger' : null}
  railStrength="strong"
  onclick={open}
  onkeydown={onKey}
>
  <div class="tc-head">
    <span class="tc-status">
      {#if isActive}
        <StatusLight pulse />
      {:else}
        <Icon name={statusIcon} size={12} />
      {/if}
      <Chip label={statusLabel} tone={statusChipTone} size="compact" />
    </span>
    {#if isQueued && !coordinatorRunning}
      <span class="tc-queued" title="Queued — coordinator is stopped">paused</span>
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
  {#if summary}
    <div class="tc-summary">
      <span class="tc-summary-label">{summary.label}:</span>
      <span>{summary.text}</span>
    </div>
  {/if}
</CardListItem>

<style>
  :global(.task-card) {
    padding: var(--s-2) var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  :global(.task-card:hover),
  :global(.task-card:focus-visible) {
    border-color: var(--accent);
  }

  :global(.task-card.st-active) {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 12%, transparent),
      var(--glass-etch);
  }
  :global(.task-card.st-done) {
    border-color: color-mix(in srgb, var(--accent-2) 24%, var(--border-strong));
  }
  :global(.task-card.st-shelved) {
    border-color: color-mix(in srgb, var(--warn) 24%, var(--border-strong));
  }
  :global(.task-card.st-blocked-bold) {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--danger) 12%, transparent),
      var(--glass-etch);
  }

  .tc-head {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    font-size: var(--gh-type-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--gh-type-weight-strong);
    color: var(--text-muted);
  }
  .tc-status {
    display: inline-flex;
    align-items: center;
    gap: var(--s-1);
    color: var(--text-muted);
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
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
    font-weight: var(--gh-type-weight-strong);
  }
  .tc-meta {
    font-size: var(--gh-type-size-caption);
    color: var(--text-muted);
    display: flex;
    gap: var(--s-2);
    align-items: center;
  }
  .tc-summary {
    font-size: var(--gh-type-size-meta);
    color: color-mix(in srgb, var(--text) 78%, var(--text-muted));
    line-height: var(--gh-type-line-height-body);
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
    font-size: var(--gh-type-size-caption);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: var(--gh-type-weight-strong);
    color: var(--text-dim);
  }
  :global(.task-card.st-done) .tc-title,
  :global(.task-card.st-shelved) .tc-title {
    color: color-mix(in srgb, var(--text) 88%, var(--text-muted));
  }
  :global(.task-card.st-done) .tc-meta,
  :global(.task-card.st-shelved) .tc-meta {
    color: color-mix(in srgb, var(--text-muted) 88%, var(--text-dim));
  }
  .tc-rev {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
  }
</style>
