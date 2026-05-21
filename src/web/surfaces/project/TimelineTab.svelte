<!--
  Timeline view: full coordinator event log, newest first. SSE appends to
  the top so the user sees new events without scrolling.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
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

  const visibleEvents = $derived(events.filter(ev => !isProviderHealthEvent(ev)))
  const hiddenProviderHealthCount = $derived(events.length - visibleEvents.length)
</script>

<Card title="Coordinator timeline">
  {#if events.length === 0}
    <p class="muted">No events recorded yet. Start the coordinator to populate the timeline.</p>
  {:else if visibleEvents.length === 0}
    <p class="muted">
      Only provider health updates are hidden. Project activity will appear here when tasks move.
    </p>
    <p class="muted compact">{hiddenProviderHealthCount} connection checks hidden.</p>
  {:else}
    {#if hiddenProviderHealthCount > 0}
      <p class="muted compact">{hiddenProviderHealthCount} connection checks hidden.</p>
    {/if}
    <div class="feed">
      {#each visibleEvents as ev, i (i)}
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
    font-size: var(--fs-2);
  }
  .compact {
    margin: 0 0 var(--s-3);
    font-size: var(--fs-1);
  }
  .feed {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-family: 'SF Mono', monospace;
    font-size: var(--fs-1);
    max-height: 70vh;
    overflow-y: auto;
  }
  .ev {
    display: flex;
    gap: var(--s-2);
    line-height: var(--lh-body);
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
