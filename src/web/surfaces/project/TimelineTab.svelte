<!--
  Timeline view: full coordinator event log, newest first. SSE appends to
  the top so the user sees new events without scrolling.
-->
<script lang="ts">
  import Button from '../../lib/Button.svelte'
  import Card from '../../lib/ui-compat/Card.svelte'
  import { onEvent, summarizeEvent, eventTaskId, eventCssClass } from '../../lib/events.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentTaskHref, projectActionHref } from '../../lib/project-routes.js'
  import type { ProjectActivityHistoryPage, ProjectDetail, EventEnvelope } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
  }

  let { detail }: Props = $props()

  let events = $state<EventEnvelope[]>([])
  let historyLoading = $state(false)
  let historyLoadingMore = $state(false)
  let historyError = $state<string | null>(null)
  let historyPage = $state<ProjectActivityHistoryPage | null>(null)
  let historyResult = $state<string | null>(null)

  $effect(() => {
    if ('recentEvents' in detail) {
      events = newestFirst(detail.recentEvents ?? [])
      historyPage = null
      return
    }
    let cancelled = false
    historyLoading = true
    historyError = null
    fetch(`/api/project/activity/history?projectId=${encodeURIComponent(detail.id ?? '')}&limit=100`, { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return await response.json() as ProjectActivityHistoryPage
      })
      .then(page => {
        if (cancelled) return
        historyPage = page
        events = mergeEvents(events, page.events)
      })
      .catch(error => {
        if (cancelled) return
        historyError = error instanceof Error ? error.message : String(error)
      })
      .finally(() => {
        if (!cancelled) historyLoading = false
      })
    return () => { cancelled = true }
  })

  async function loadOlderActivity() {
    let cursor = historyPage?.nextCursor
    if (cursor === undefined || historyLoadingMore) return
    historyLoadingMore = true
    historyError = null
    historyResult = null
    try {
      const before = operatorEventCount(events)
      let page = historyPage
      let pagesRead = 0
      const visitedCursors = new Set<number>()

      // Recent SSE history can overlap the first durable page. One owner click
      // should skip that overlap instead of appearing to do nothing.
      while (cursor !== undefined && pagesRead < 12 && !visitedCursors.has(cursor)) {
        visitedCursors.add(cursor)
        const response = await fetch(
          `/api/project/activity/history?projectId=${encodeURIComponent(detail.id ?? '')}&limit=100&cursor=${cursor}`,
          { cache: 'no-store' },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        page = await response.json() as ProjectActivityHistoryPage
        events = mergeEvents(events, page.events)
        pagesRead += 1
        if (operatorEventCount(events) > before || !page.hasMore) break
        cursor = page.nextCursor
      }

      historyPage = page
      const added = operatorEventCount(events) - before
      historyPage = added > 0 || !page
        ? page
        : { ...page, hasMore: false, nextCursor: undefined }
      historyResult = added > 0
        ? `Loaded ${added} earlier update${added === 1 ? '' : 's'}.`
        : 'No earlier user-visible updates.'
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error)
    } finally {
      historyLoadingMore = false
    }
  }

  $effect(() => {
    const off = onEvent(ev => {
      const text = summarizeEvent(ev)
      if (!text) return
      events = mergeEvents(events, [ev])
    })
    return off
  })

  function onClickEvent(ev: EventEnvelope) {
    const id = eventTaskId(ev)
    if (id) nav(currentTaskHref(id), { backgroundPath: path.value })
  }

  function openCurrentAction(): void {
    const href = detail.actionModel?.primaryAction?.href
    if (!href) return
    nav(projectActionHref(href, detail.id), { backgroundPath: path.value })
  }

  function isProviderHealthEvent(ev: EventEnvelope): boolean {
    return (ev.event?.type ?? '') === 'provider_health_changed'
  }

  function isRawTraceEvent(ev: EventEnvelope): boolean {
    const type = ev.event?.type ?? ev.type ?? ''
    return [
      'assistant_delta',
      'assistant_complete',
      'tool_started',
      'tool_completed',
      'line_complete',
    ].includes(type)
  }

  function isEmptyModelEvent(ev: EventEnvelope): boolean {
    const inner = ev.event ?? ev
    const text = `${inner.type ?? ''}\n${inner.message ?? ''}\n${inner.reason ?? ''}`.toLowerCase()
    return text.includes('empty assistant message') || text.includes('empty model reply') || text.includes('empty assistant reply')
  }

  function isDiagnosticEvent(ev: EventEnvelope): boolean {
    const type = ev.event?.type ?? ev.type ?? ''
    return type === 'error' || type === 'agent_error'
  }

  function eventKey(ev: EventEnvelope): string {
    const inner = ev.event ?? ev
    return [
      ev.at ?? '',
      inner.type ?? ev.type ?? '',
      inner.task_id ?? inner.taskId ?? '',
      inner.agent_name ?? '',
      inner.from_status ?? '',
      inner.to_status ?? '',
      summarizeEvent(ev),
    ].join('|')
  }

  function dedupeEvents(input: EventEnvelope[]): EventEnvelope[] {
    const seen = new Set<string>()
    const out: EventEnvelope[] = []
    for (const ev of input) {
      const key = eventKey(ev)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(ev)
    }
    return out
  }

  function eventTime(ev: EventEnvelope): number {
    const parsed = Date.parse(ev.at ?? '')
    return Number.isFinite(parsed) ? parsed : 0
  }

  function newestFirst(input: EventEnvelope[]): EventEnvelope[] {
    return [...input].sort((left, right) => eventTime(right) - eventTime(left))
  }

  function mergeEvents(current: EventEnvelope[], incoming: EventEnvelope[]): EventEnvelope[] {
    return newestFirst(dedupeEvents([...current, ...incoming]))
  }

  function operatorEventCount(input: EventEnvelope[]): number {
    return dedupeEvents(input.filter(ev => !isProviderHealthEvent(ev) && !isRawTraceEvent(ev) && !isEmptyModelEvent(ev))).length
  }

  const operatorEvents = $derived(dedupeEvents(events.filter(ev => !isProviderHealthEvent(ev) && !isRawTraceEvent(ev) && !isEmptyModelEvent(ev))))
  const recentHistoryEvents = $derived(operatorEvents.filter(ev => !isDiagnosticEvent(ev)).slice(0, 5))
  const diagnosticEvents = $derived(operatorEvents.filter(isDiagnosticEvent))
  const currentAction = $derived(detail.actionModel?.primaryAction ?? null)
  const currentStatus = $derived.by(() => {
    if (currentAction) {
      return {
        title: currentAction.label ?? 'Work needs your attention',
        detail: currentAction.taskLabel
          ? `Current item: ${currentAction.taskLabel}`
          : currentAction.detail ?? 'Open the current work to continue.',
        buttonLabel: currentAction.buttonLabel ?? 'Open Work',
      }
    }
    if (detail.run?.status === 'running' || detail.run?.status === 'stopping') {
      return {
        title: detail.run.status === 'stopping' ? 'Stopping work' : 'Work in progress',
        detail: 'Guildhall is working on the current project.',
        buttonLabel: null,
      }
    }
    return {
      title: 'Nothing needs your attention',
      detail: 'There is no project decision waiting right now.',
      buttonLabel: null,
    }
  })
</script>

<Card title="Project activity">
  <section class="timeline-status" aria-label="Current project status">
    <p class="timeline-status-label">Current status</p>
    <div class="timeline-status-main">
      <div>
        <h2>{currentStatus.title}</h2>
        <p>{currentStatus.detail}</p>
      </div>
      {#if currentAction && currentStatus.buttonLabel}
        <Button variant="primary" size="sm" onclick={openCurrentAction}>{currentStatus.buttonLabel}</Button>
      {/if}
    </div>
  </section>

  <details class="timeline-history">
    <summary>Activity history</summary>
    <div class="timeline-history-body">
      {#if historyLoading && events.length === 0}
        <p class="muted">Loading retained activity...</p>
      {:else if historyError && events.length === 0}
        <p class="muted">Activity history is unavailable right now: {historyError}</p>
      {:else if events.length === 0}
        <p class="muted">No events recorded yet. Start the coordinator to populate the timeline.</p>
      {:else if recentHistoryEvents.length === 0}
        <p class="muted">No owner-readable activity is ready to show yet.</p>
      {:else}
        <div class="feed">
          {#each recentHistoryEvents as ev, i (i)}
            {@const text = summarizeEvent(ev)}
            {#if text}
              {@const tid = eventTaskId(ev)}
              {@const cls = eventCssClass(ev)}
              <div class="ev ev-{cls}">
                <span class="ts">{(ev.at ?? '').slice(11, 19)}</span>
                {#if tid}
                  <button type="button" class="ev-link" onclick={() => onClickEvent(ev)}>
                    {text}
                  </button>
                {:else}
                  <span>{text}</span>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}

      {#if diagnosticEvents.length > 0}
        <details class="timeline-diagnostics">
          <summary>Technical event details</summary>
          <div class="feed">
            {#each diagnosticEvents as ev, i (`diagnostic-${i}`)}
              {@const text = summarizeEvent(ev)}
              {#if text}
                <div class="ev ev-{eventCssClass(ev)}">
                  <span class="ts">{(ev.at ?? '').slice(11, 19)}</span>
                  <span>{text}</span>
                </div>
              {/if}
            {/each}
          </div>
        </details>
      {/if}

      <div class="history-pagination">
        {#if historyPage?.hasMore}
          <button type="button" class="history-more" onclick={loadOlderActivity} disabled={historyLoadingMore}>
            {historyLoadingMore ? 'Loading earlier updates...' : 'Show earlier updates'}
          </button>
        {/if}
        {#if historyResult}
          <p class="muted compact history-result" role="status" aria-live="polite">{historyResult}</p>
        {/if}
      </div>
    </div>
  </details>
</Card>

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
  }
  .compact {
    margin: 0 0 var(--s-3);
    font-size: var(--gh-type-size-meta);
  }
  .timeline-status {
    display: grid;
    gap: var(--s-2);
  }
  .timeline-status-label {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: 700;
    text-transform: uppercase;
  }
  .timeline-status-main {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .timeline-status h2,
  .timeline-status p {
    margin: 0;
  }
  .timeline-status h2 {
    font-size: var(--gh-type-size-heading-sm);
  }
  .timeline-status-main > div {
    display: grid;
    gap: var(--s-1);
  }
  .timeline-history {
    margin-top: var(--s-4);
  }
  .timeline-history > summary,
  .timeline-diagnostics > summary {
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--gh-type-size-meta);
    font-weight: 700;
  }
  .timeline-history-body,
  .timeline-diagnostics {
    margin-top: var(--s-3);
  }
  .feed {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-family: 'SF Mono', monospace;
    font-size: var(--gh-type-size-meta);
    max-height: 70vh;
    overflow-y: auto;
  }
  .ev {
    display: flex;
    gap: var(--s-2);
    line-height: var(--gh-type-line-height-body);
    color: var(--text);
  }
  .ev .ts {
    color: var(--text-muted);
  }
  .ev-link {
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
    text-align: left;
  }
  .ev-link:hover {
    text-decoration: underline;
  }
  .history-more {
    display: block;
    margin: var(--s-3) auto 0;
    padding: var(--s-1) var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .history-pagination {
    display: grid;
    justify-items: center;
    gap: var(--gh-space-2);
  }
  .history-result {
    margin: 0;
  }
  .history-more:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent) 10%, transparent);
  }
  .history-more:disabled {
    cursor: wait;
    opacity: 0.7;
  }
  .ev-transition { color: var(--accent-2); }
  .ev-escalation { color: var(--warn); }
  .ev-error      { color: var(--danger); }
  .ev-issue      { color: var(--warn); }
  .ev-supervisor { color: var(--text-muted); }
</style>
