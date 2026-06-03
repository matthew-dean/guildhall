<!--
  Timeline view: full coordinator event log, newest first. SSE appends to
  the top so the user sees new events without scrolling.
-->
<script lang="ts">
  import Card from '../../lib/ui-compat/Card.svelte'
  import { onEvent, summarizeEvent, eventTaskId, eventCssClass } from '../../lib/events.js'
  import { nav, path } from '../../lib/nav.svelte.js'
  import { currentTaskHref } from '../../lib/project-routes.js'
  import type { ProjectDetail, EventEnvelope } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
  }

  let { detail }: Props = $props()

  let events = $state<EventEnvelope[]>([])

  $effect(() => {
    events = (detail.recentEvents ?? []).slice().reverse()
  })

  $effect(() => {
    const off = onEvent(ev => {
      const text = summarizeEvent(ev)
      if (!text) return
      events = [ev, ...events]
    })
    return off
  })

  function onClickEvent(ev: EventEnvelope) {
    const id = eventTaskId(ev)
    if (id) nav(currentTaskHref(id), { backgroundPath: path.value })
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

  const emptyModelEvents = $derived(events.filter(isEmptyModelEvent))
  const operatorEvents = $derived(dedupeEvents(events.filter(ev => !isProviderHealthEvent(ev) && !isRawTraceEvent(ev) && !isEmptyModelEvent(ev))))
  const rawTraceEvents = $derived(events.filter(isRawTraceEvent))
  const hiddenProviderHealthCount = $derived(events.filter(isProviderHealthEvent).length)
  const hiddenRawTraceCount = $derived(rawTraceEvents.length)
  const hiddenEmptyModelCount = $derived(emptyModelEvents.length)
</script>

<Card title="Coordinator timeline">
  {#if events.length === 0}
    <p class="muted">No events recorded yet. Start the coordinator to populate the timeline.</p>
  {:else if operatorEvents.length === 0}
    <p class="muted">
      Only connection checks and raw agent trace events are hidden. Project activity will appear here when tasks move.
    </p>
    <p class="muted compact">{hiddenProviderHealthCount} connection checks hidden. {hiddenRawTraceCount} background agent events hidden.</p>
  {:else}
    {#if hiddenEmptyModelCount > 0}
      <div class="recovery-summary" role="note">
        <strong>{hiddenEmptyModelCount} model-recovery event{hiddenEmptyModelCount === 1 ? '' : 's'} summarized</strong>
        <span>Guildhall saw empty model replies during unattended work, kept task state intact, and recorded recovery guidance instead of repeating each raw failure here.</span>
      </div>
    {/if}
    {#if hiddenProviderHealthCount > 0}
      <p class="muted compact">{hiddenProviderHealthCount} connection checks hidden.</p>
    {/if}
    {#if hiddenRawTraceCount > 0}
      <details class="raw-trace">
        <summary>{hiddenRawTraceCount} background agent event{hiddenRawTraceCount === 1 ? '' : 's'} hidden</summary>
        <div class="feed raw">
          {#each rawTraceEvents as ev, i (i)}
            {@const text = summarizeEvent(ev)}
            {#if text}
              <div class="ev ev-raw">
                <span class="ts">{(ev.at ?? '').slice(11, 19)}</span>
                <span>{text}</span>
              </div>
            {/if}
          {/each}
        </div>
      </details>
    {/if}
    <div class="feed">
      {#each operatorEvents as ev, i (i)}
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
  .feed {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-family: 'SF Mono', monospace;
    font-size: var(--gh-type-size-meta);
    max-height: 70vh;
    overflow-y: auto;
  }
  .feed.raw {
    margin-top: var(--s-2);
    max-height: 240px;
  }
  .raw-trace {
    margin: 0 0 var(--s-3);
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .raw-trace summary {
    cursor: pointer;
  }
  .recovery-summary {
    display: grid;
    gap: var(--s-1);
    margin: 0 0 var(--s-3);
    padding: var(--s-2) var(--s-3);
    border: 1px solid color-mix(in oklab, var(--warn) 34%, transparent);
    border-radius: var(--r-2);
    background: color-mix(in oklab, var(--warn) 10%, transparent);
    color: var(--text);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }
  .recovery-summary span {
    color: var(--text-muted);
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
  .ev-transition { color: var(--accent-2); }
  .ev-escalation { color: var(--warn); }
  .ev-error      { color: var(--danger); }
  .ev-issue      { color: var(--warn); }
  .ev-supervisor { color: var(--text-muted); }
</style>
