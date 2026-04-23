<!--
  Task mini-card. Used by Work, Planner, and Coordinators tabs.
  Clicking opens the drawer via the nav helper (which pushState's
  /task/:id and lets Router swap the drawer on).
-->
<script lang="ts">
  import { nav } from './nav.svelte.js'
  import type { TaskLite } from './types.js'

  const ACTIVE_STATUSES = new Set([
    'in_progress',
    'review',
    'gate_check',
    'exploring',
    'spec_review',
  ])

  interface Props {
    task: TaskLite
    orchestratorRunning?: boolean
  }

  let { task, orchestratorRunning = false }: Props = $props()

  const status = $derived(task.status ?? 'unknown')
  const isQueued = $derived(ACTIVE_STATUSES.has(status))
  const isActive = $derived(isQueued && orchestratorRunning)
  const prio = $derived(task.priority && task.priority !== 'normal' ? task.priority : '')
  const hasEscalations = $derived(
    Array.isArray(task.escalations) && task.escalations.some(e => !e.resolvedAt),
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
  class="task-card st-{status}"
  class:st-active={isActive}
  role="button"
  tabindex="0"
  onclick={open}
  onkeydown={onKey}
>
  <div class="tc-head">
    <span class="tc-status">{status}</span>
    {#if isActive}
      <span class="tc-spin" title="Orchestrator is ticking this task"></span>
    {/if}
    {#if isQueued && !orchestratorRunning}
      <span class="tc-queued" title="Queued — orchestrator is stopped">⏸</span>
    {/if}
    {#if hasEscalations}
      <span class="tc-flag" title="Open escalation">⚑</span>
    {/if}
    <span class="grow"></span>
    <span class="tc-id">{task.id}</span>
  </div>
  <div class="tc-title">{task.title ?? '(untitled)'}</div>
  <div class="tc-meta">
    {#if task.domain}<span>{task.domain}</span>{/if}
    {#if prio}<span>· {prio}</span>{/if}
    {#if (task.revisionCount ?? 0) > 0}
      <span class="tc-rev">r{task.revisionCount}</span>
    {/if}
  </div>
</div>

<style>
  .task-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    padding: var(--s-2) var(--s-3);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .task-card:hover {
    border-color: var(--accent);
  }
  .st-active {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 6%, var(--bg));
  }
  .st-done {
    opacity: 0.6;
  }
  .st-blocked {
    border-left: 3px solid var(--danger);
  }
  .st-shelved {
    opacity: 0.5;
    border-left: 3px solid var(--warn);
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
    color: var(--text);
  }
  .grow {
    flex: 1;
  }
  .tc-id {
    font-family: 'SF Mono', monospace;
    text-transform: none;
    letter-spacing: 0;
    font-weight: 400;
    color: var(--text-muted);
    font-size: var(--fs-0);
  }
  .tc-spin {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent);
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .tc-queued {
    color: var(--warn);
    text-transform: none;
    letter-spacing: 0;
  }
  .tc-flag {
    color: var(--warn);
    text-transform: none;
    letter-spacing: 0;
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
  .tc-rev {
    font-family: 'SF Mono', monospace;
    background: var(--bg-raised-2);
    padding: 0 4px;
    border-radius: var(--r-1);
  }
</style>
