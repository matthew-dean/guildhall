<script lang="ts">
  import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    FolderOpen,
    PauseCircle,
    Play,
    Square,
  } from 'lucide-svelte'
  import Button from './Button.svelte'
  import Card from './Card.svelte'
  import Chip from './Chip.svelte'
  import type { ProjectCardSummary } from './project-summary.js'

  interface Props {
    summary: ProjectCardSummary
    busy?: boolean
    onOpen?: (id: string) => void
    onStart?: (id: string) => void
    onStop?: (id: string) => void
  }

  let {
    summary,
    busy = false,
    onOpen,
    onStart,
    onStop,
  }: Props = $props()

  const statusTone = $derived(
    summary.tone === 'active'
      ? 'running'
      : summary.tone === 'warn'
        ? 'warn'
        : summary.tone === 'success'
          ? 'ok'
          : 'neutral',
  )
</script>

<Card
  className="project-card"
  tone={summary.tone === 'warn' ? 'warn' : summary.tone === 'active' ? 'ok' : summary.tone === 'success' ? 'accent' : 'default'}
>
  {#snippet actions()}
    <div class="top-chips">
      <Chip label={summary.statusLabel} tone={statusTone} />
    </div>
  {/snippet}

  <div class="card-layout">
    <div class="stack">
      <div class="title-block">
        <h3>{summary.name}</h3>
        <p class="path" title={summary.path}>{summary.path}</p>
        {#if summary.blurb}
          <p class="blurb">{summary.blurb}</p>
      {/if}
    </div>

    <div class="story">
      <p class="activity">
        <Activity size={14} />
        <span>{summary.activityLabel}</span>
      </p>
      {#if summary.recentLabel}
        <p class="recent">{summary.recentLabel}</p>
      {/if}
    </div>

    <div class="metrics" aria-label="Project task summary">
      {#if summary.counts.active > 0}
        <span class="metric tone-running">
          <Activity size={13} />
          <strong>{summary.counts.active}</strong>
          <span>active</span>
        </span>
      {/if}
      {#if summary.counts.blocked > 0}
        <span class="metric tone-warn">
          <AlertTriangle size={13} />
          <strong>{summary.counts.blocked}</strong>
          <span>blocked</span>
        </span>
      {/if}
      {#if summary.counts.done > 0}
        <span class="metric tone-ok">
          <CheckCircle2 size={13} />
          <strong>{summary.counts.done}</strong>
          <span>done</span>
        </span>
      {/if}
      {#if summary.counts.total > 0}
        <span class="metric tone-neutral">
          <PauseCircle size={13} />
          <strong>{summary.counts.total}</strong>
          <span>total</span>
        </span>
      {/if}
    </div>

    </div>
    <div class="actions">
      <Button variant="secondary" size="sm" disabled={busy || !summary.canOpen} onclick={() => onOpen?.(summary.id)}>
        <FolderOpen size={14} />
        {summary.actionLabel}
      </Button>
      {#if summary.canStart}
        <Button variant="primary" size="sm" disabled={busy} onclick={() => onStart?.(summary.id)}>
          <Play size={14} />
          {summary.runActionLabel}
        </Button>
      {:else if summary.canStop}
        <Button variant="danger" size="sm" disabled={busy} onclick={() => onStop?.(summary.id)}>
          <Square size={13} />
          {summary.runActionLabel}
        </Button>
      {/if}
    </div>
  </div>
</Card>

<style>
  :global(section.project-card) {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  :global(section.project-card .card-body) {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  .card-layout {
    width: 100%;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--fs-4);
    line-height: var(--lh-tight);
  }
  .top-chips {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-start;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    min-width: 0;
  }
  .title-block {
    min-width: 0;
  }
  .path {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .blurb {
    margin: var(--s-2) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .story {
    display: grid;
    gap: var(--s-2);
    align-content: start;
  }
  .activity,
  .recent {
    margin: 0;
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .activity {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text);
  }
  .activity :global(svg) {
    color: var(--accent-2);
    flex: none;
  }
  .recent {
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .metrics {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    align-content: start;
  }
  .metric {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.2rem 0.45rem;
    border-radius: 999px;
    font-size: var(--fs-0);
    font-weight: 700;
    line-height: 1;
  }
  .metric strong {
    font-size: var(--fs-1);
  }
  .tone-running {
    background: rgba(78, 204, 163, 0.15);
    color: var(--accent-2);
  }
  .tone-warn {
    background: rgba(212, 162, 60, 0.15);
    color: var(--warn);
  }
  .tone-ok {
    background: rgba(93, 114, 255, 0.12);
    color: var(--accent);
  }
  .tone-neutral {
    background: rgba(136, 136, 153, 0.12);
    color: var(--text-muted);
  }
  .actions {
    display: flex;
    width: 100%;
    gap: var(--s-2);
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    margin-top: auto;
    padding-top: var(--s-4);
    border-top: 1px solid var(--border);
  }
  @media (max-width: 640px) {
    .actions {
      justify-content: stretch;
    }
    .actions :global(button) {
      flex: 1 1 12rem;
    }
  }
</style>
