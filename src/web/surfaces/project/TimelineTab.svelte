<!--
  Timeline view: full orchestrator event log, newest first. SSE appends to
  the top so the user sees new events without scrolling.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import { onEvent, summarizeEvent, eventTaskId, eventCssClass } from '../../lib/events.js'
  import { nav } from '../../lib/nav.svelte.js'
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
    if (id) nav('/task/' + encodeURIComponent(id))
  }
</script>

<Card title="Orchestrator timeline">
  {#if events.length === 0}
    <p class="muted">No events recorded yet. Start the orchestrator to populate the timeline.</p>
  {:else}
    <div class="feed">
      {#each events as ev, i (i)}
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
