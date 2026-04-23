<!--
  Planner view: kanban columns by task-lifecycle stage.
-->
<script lang="ts">
  import TaskCard from '../../lib/TaskCard.svelte'
  import type { ProjectDetail, Task } from '../../lib/types.js'

  interface Props {
    detail: ProjectDetail
  }

  let { detail }: Props = $props()

  const PLANNER_STAGES: Array<{ key: string; label: string; statuses: string[] }> = [
    { key: 'backlog', label: 'Backlog', statuses: ['proposed'] },
    { key: 'spec', label: 'Specing', statuses: ['exploring', 'spec_review'] },
    { key: 'work', label: 'Working', statuses: ['ready', 'in_progress'] },
    { key: 'review', label: 'Review & gates', statuses: ['review', 'gate_check'] },
    { key: 'done', label: 'Done / terminal', statuses: ['done', 'shelved', 'blocked'] },
  ]

  const tasks = $derived<Task[]>(detail.tasks ?? [])
  const running = $derived((detail.run?.status ?? 'stopped') === 'running')

  const stages = $derived(
    PLANNER_STAGES.map(stage => ({
      ...stage,
      cards: tasks.filter(t => stage.statuses.includes(t.status ?? '')),
    })),
  )
</script>

<div class="planner">
  {#each stages as stage (stage.key)}
    <div class="col">
      <div class="col-head">
        <span>{stage.label}</span>
        <span class="count">{stage.cards.length}</span>
      </div>
      {#if stage.cards.length === 0}
        <div class="empty">empty</div>
      {:else}
        <div class="stack">
          {#each stage.cards as t (t.id)}
            <TaskCard task={t} orchestratorRunning={running} />
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .planner {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
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
    justify-content: space-between;
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .count {
    color: var(--text);
  }
  .empty {
    color: var(--text-muted);
    font-size: var(--fs-1);
    padding: var(--s-4) 0;
    text-align: center;
    border: 1px dashed var(--border);
    border-radius: var(--r-2);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  @media (max-width: 1100px) {
    .planner { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 600px) {
    .planner { grid-template-columns: 1fr; }
  }
</style>
