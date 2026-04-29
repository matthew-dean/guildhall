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
    { key: 'spec', label: 'Spec', statuses: ['exploring', 'spec_review'] },
    { key: 'work', label: 'Working', statuses: ['ready', 'in_progress'] },
    { key: 'review', label: 'Review & gates', statuses: ['review', 'gate_check'] },
    { key: 'done', label: 'Done / terminal', statuses: ['done', 'shelved', 'blocked'] },
  ]

  const tasks = $derived<Task[]>(detail.tasks ?? [])
  const running = $derived((detail.run?.status ?? 'stopped') === 'running')
  const runMode = $derived(detail.run?.mode === 'one_task' ? 'one_task' : 'continuous')

  const priorityRank: Record<string, number> = {
    critical: 0,
    high: 1,
    normal: 2,
    low: 3,
  }
  const selectionStatuses = ['gate_check', 'review', 'in_progress', 'proposed', 'exploring', 'spec_review', 'ready']

  function statusOf(task: Task): string {
    return task.status === 'pending' ? 'ready' : task.status ?? ''
  }

  function dependenciesSatisfied(task: Task): boolean {
    const deps = task.dependsOn ?? []
    if (deps.length === 0) return true
    return deps.every(id => tasks.find(t => t.id === id)?.status === 'done')
  }

  function isDependencyBlocked(task: Task): boolean {
    return !dependenciesSatisfied(task)
  }

  const dependencyBlocked = $derived(tasks.filter(t => !dependenciesSatisfied(t)))
  const nextFocus = $derived.by(() => {
    for (const status of selectionStatuses) {
      const candidates = tasks
        .filter(t => statusOf(t) === status && dependenciesSatisfied(t))
        .sort((a, b) => (priorityRank[a.priority ?? 'normal'] ?? 2) - (priorityRank[b.priority ?? 'normal'] ?? 2))
      if (candidates[0]) return candidates[0]
    }
    return null
  })

  const stages = $derived(
    PLANNER_STAGES.map(stage => ({
      ...stage,
      cards: tasks.filter(t => stage.statuses.includes(statusOf(t))),
    })),
  )
</script>

<div class="planner-wrap">
  <div class="focus-strip">
    <div>
      <div class="focus-label">{running && runMode === 'one_task' ? 'Finishing one task' : 'Next focus'}</div>
      <div class="focus-title">{nextFocus?.title ?? 'No eligible task'}</div>
    </div>
    {#if dependencyBlocked.length > 0}
      <div class="blocked-count">{dependencyBlocked.length} waiting on dependencies</div>
    {/if}
  </div>

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
              <TaskCard
                task={t}
                orchestratorRunning={running}
                displayStatusLabel={isDependencyBlocked(t) ? 'Waiting' : undefined}
                displayStatusTone={isDependencyBlocked(t) ? 'warn' : undefined}
                displayStatusIcon={isDependencyBlocked(t) ? 'alert-triangle' : undefined}
              />
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .planner-wrap {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .focus-strip {
    border: 1px solid var(--border);
    background: var(--bg-raised);
    border-radius: var(--r-2);
    padding: var(--s-3);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
  }
  .focus-label {
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .focus-title {
    color: var(--text);
    font-weight: 700;
    line-height: var(--lh-body);
  }
  .blocked-count {
    color: var(--warn);
    font-size: var(--fs-1);
    white-space: nowrap;
  }
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
    .focus-strip { align-items: flex-start; flex-direction: column; }
    .blocked-count { white-space: normal; }
  }
  @media (max-width: 600px) {
    .planner { grid-template-columns: 1fr; }
  }
</style>
