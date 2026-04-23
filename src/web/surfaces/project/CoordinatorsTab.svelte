<!--
  Coordinators view: one column per coordinator with a textual sparkline of
  recent task statuses, mandate line, and the tasks in that domain.
-->
<script lang="ts">
  import TaskCard from '../../lib/TaskCard.svelte'
  import type { ProjectDetail, Task } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
  }

  let { detail }: Props = $props()

  const coordinators = $derived(detail.config?.coordinators ?? [])
  const tasks = $derived<Task[]>(detail.tasks ?? [])
  const running = $derived((detail.run?.status ?? 'stopped') === 'running')

  const GLYPH: Record<string, string> = {
    done: '■',
    in_progress: '◉',
    review: '◎',
    gate_check: '◎',
    spec_review: '◐',
    exploring: '◐',
    ready: '○',
    proposed: '·',
    blocked: '✕',
    shelved: '–',
  }

  function sparkline(domainTasks: Task[]): string {
    if (domainTasks.length === 0) return '(empty)'
    return domainTasks
      .slice(-24)
      .map(t => GLYPH[t.status ?? ''] ?? '?')
      .join('')
  }

  const columns = $derived(
    coordinators.map(c => {
      const domainTasks = tasks.filter(t => t.domain === c.domain)
      const active = domainTasks.filter(t =>
        ['in_progress', 'review', 'gate_check', 'exploring', 'spec_review'].includes(t.status ?? ''),
      ).length
      const done = domainTasks.filter(t => t.status === 'done').length
      return { c, domainTasks, active, done, spark: sparkline(domainTasks) }
    }),
  )
</script>

{#if coordinators.length === 0}
  <p class="muted">No coordinators yet. Bootstrap the project first.</p>
{:else}
  <div class="board">
    {#each columns as col (col.c.id ?? col.c.name)}
      <div class="col">
        <div class="col-head">
          <span class="name">{col.c.name ?? col.c.id ?? '—'}</span>
          <span class="mini">{col.active} active · {col.done} done · {col.domainTasks.length} total</span>
        </div>
        <div class="spark">{col.spark}</div>
        {#if col.c.mandate}
          <div class="mandate">
            {col.c.mandate.slice(0, 140)}{col.c.mandate.length > 140 ? '…' : ''}
          </div>
        {/if}
        {#if col.domainTasks.length === 0}
          <div class="empty">no tasks in this domain</div>
        {:else}
          <div class="stack">
            {#each col.domainTasks as t (t.id)}
              <TaskCard task={t} orchestratorRunning={running} />
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .muted {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .board {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--s-3);
  }
  .col {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    padding: var(--s-3);
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .col-head {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .name {
    font-size: var(--fs-2);
    font-weight: 600;
    color: var(--text);
  }
  .mini {
    font-size: var(--fs-0);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .spark {
    font-family: 'SF Mono', monospace;
    font-size: var(--fs-2);
    color: var(--accent-2);
    letter-spacing: 0.1em;
  }
  .mandate {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
  }
  .empty {
    color: var(--text-muted);
    font-size: var(--fs-1);
    padding: var(--s-3) 0;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--r-2);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
</style>
