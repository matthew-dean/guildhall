<!--
  Work view. Primary/secondary/overflow IA:
    · Primary (LEFT): task grid. "Needs you" attention now lives on the
      Inbox tab, which owns the coordinator ↔ human prompts; the Work tab
      shows tasks + live activity only.
    · Secondary (RIGHT rail): live activity feed.
    · Overflow: "Recent progress" (PROGRESS.md) collapsed behind <details>.
-->
<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import TaskCard from '../../lib/TaskCard.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import { onEvent, summarizeEvent, eventTaskId, eventCssClass } from '../../lib/events.js'
  import { nav } from '../../lib/nav.svelte.js'
  import type { ProjectDetail, EventEnvelope, Task } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
  }

  let { detail }: Props = $props()

  const tasks = $derived<Task[]>(detail.tasks ?? [])
  const coordinators = $derived(detail.config?.coordinators ?? [])
  const needsMeta = $derived(coordinators.length === 0)
  const runStatus = $derived(detail.run?.status ?? 'stopped')
  const running = $derived(runStatus === 'running')

  let progress = $state('Loading…')
  let events = $state<EventEnvelope[]>([])

  function sortEventsChronologically(items: EventEnvelope[]): EventEnvelope[] {
    return [...items].sort((a, b) => {
      const left = a.at ? Date.parse(a.at) : 0
      const right = b.at ? Date.parse(b.at) : 0
      return left - right
    })
  }

  function scrollFeedToBottom(): void {
    queueMicrotask(() => {
      const feed = document.getElementById('work-feed')
      if (feed) feed.scrollTop = feed.scrollHeight
    })
  }

  $effect(() => {
    events = sortEventsChronologically(detail.recentEvents ?? [])
    scrollFeedToBottom()
  })

  $effect(() => {
    fetch('/api/project/progress')
      .then(r => r.json())
      .then(j => {
        progress = j.progress || '(empty)'
      })
      .catch(() => {
        progress = '(failed to load)'
      })
  })

  $effect(() => {
    const off = onEvent(ev => {
      const text = summarizeEvent(ev)
      if (!text) return
      events = sortEventsChronologically([...events, ev])
      scrollFeedToBottom()
    })
    return off
  })

  function onEventClick(ev: EventEnvelope) {
    const id = eventTaskId(ev)
    if (id) nav('/task/' + encodeURIComponent(id))
  }
</script>

<div class="two-col">
  <div class="col col-primary">
    <Card title="Tasks ({tasks.length})">
      {#if tasks.length === 0}
        {#if needsMeta}
          <p class="muted">No tasks yet — <strong>Bootstrap project</strong> first.</p>
        {:else}
          <p class="muted">No tasks yet — <strong>+ New Task</strong> to begin.</p>
        {/if}
      {:else}
        <div class="task-grid">
          {#each tasks as t (t.id)}
            <TaskCard task={t} orchestratorRunning={running} />
          {/each}
        </div>
      {/if}
    </Card>
  </div>

  <div class="col col-rail">
    <Card title="Live activity">
      <div class="feed" id="work-feed">
        {#if events.length === 0 && !running}
          <p class="muted">Idle — press Start to begin.</p>
        {:else if events.length === 0}
          <p class="muted">Connecting…</p>
        {:else}
          {#each events as ev, i (i)}
            {@const text = summarizeEvent(ev)}
            {#if text}
              {@const tid = eventTaskId(ev)}
              {@const cls = eventCssClass(ev)}
              <div class="ev ev-{cls}">
                <span class="ts">{(ev.at ?? '').slice(11, 19)}</span>
                {#if tid}
                  <button type="button" class="ev-link" onclick={() => onEventClick(ev)}>
                    {text}
                  </button>
                {:else}
                  <span>{text}</span>
                {/if}
              </div>
            {/if}
          {/each}
        {/if}
      </div>
    </Card>

    <details class="progress-more">
      <summary>Recent progress</summary>
      <div class="progress">
        <Markdown source={progress} />
      </div>
    </details>
  </div>
</div>

<style>
  .two-col {
    display: grid;
    grid-template-columns: 2fr minmax(280px, 1fr);
    gap: var(--s-4);
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
    min-width: 0;
  }
  .feed {
    max-height: 40vh;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
    font-family: 'SF Mono', monospace;
    font-size: var(--fs-1);
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
  .progress-more > summary {
    cursor: pointer;
    color: var(--text-muted);
    font-size: var(--fs-1);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    list-style: none;
    padding: var(--s-2) 0;
  }
  .progress-more > summary::-webkit-details-marker {
    display: none;
  }
  .progress-more > summary::before {
    content: '▸ ';
  }
  .progress-more[open] > summary::before {
    content: '▾ ';
  }
  .progress {
    max-height: 260px;
    overflow: auto;
    margin-top: var(--s-2);
  }
  .task-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--s-2);
  }
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  @media (max-width: 900px) {
    .two-col { grid-template-columns: 1fr; }
  }
</style>
