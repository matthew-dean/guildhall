<script lang="ts">
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
</script>

<Card tone={summary.selected ? 'accent' : summary.tone === 'warn' ? 'warn' : summary.tone === 'active' ? 'ok' : 'default'}>
  {#snippet actions()}
    <Chip label={summary.statusLabel} tone={summary.tone === 'active' ? 'running' : summary.tone === 'warn' ? 'warn' : summary.tone === 'success' ? 'ok' : summary.selected ? 'accent' : 'neutral'} />
  {/snippet}

  <div class="stack">
    <div>
      <h3>{summary.name}</h3>
      <p class="path">{summary.path}</p>
      {#if summary.blurb}
        <p class="blurb">{summary.blurb}</p>
      {/if}
      {#if summary.tags.length > 0}
        <div class="tags">
          {#each summary.tags.slice(0, 3) as tag (tag)}
            <span class="tag">{tag}</span>
          {/each}
        </div>
      {/if}
    </div>

    <dl class="story">
      <div>
        <dt>Stage</dt>
        <dd>{summary.stageLabel}</dd>
      </div>
      <div>
        <dt>Activity</dt>
        <dd>{summary.activityLabel}</dd>
      </div>
      {#if summary.recentLabel}
        <div>
          <dt>Recent</dt>
          <dd>{summary.recentLabel}</dd>
        </div>
      {/if}
    </dl>

    <dl class="stats">
      <div><dt>Active</dt><dd>{summary.counts.active}</dd></div>
      <div><dt>Blocked</dt><dd>{summary.counts.blocked}</dd></div>
      <div><dt>Done</dt><dd>{summary.counts.done}</dd></div>
      <div><dt>Total</dt><dd>{summary.counts.total}</dd></div>
    </dl>

    <div class="actions">
      <Button variant="secondary" size="sm" disabled={busy || !summary.canOpen} onclick={() => onOpen?.(summary.id)}>
        {summary.actionLabel}
      </Button>
      <Button variant="primary" size="sm" disabled={busy || !summary.canStart} onclick={() => onStart?.(summary.id)}>
        Start
      </Button>
      <Button variant="danger" size="sm" disabled={busy || !summary.canStop} onclick={() => onStop?.(summary.id)}>
        Stop
      </Button>
    </div>
  </div>
</Card>

<style>
  h3 {
    margin: 0;
    font-size: var(--fs-5);
    line-height: var(--lh-tight);
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .path {
    margin: var(--s-1) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-1);
    overflow-wrap: anywhere;
  }
  .blurb {
    margin: var(--s-2) 0 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-1);
    margin-top: var(--s-2);
  }
  .tag {
    display: inline-flex;
    align-items: center;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated));
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 700;
  }
  .story {
    display: grid;
    gap: var(--s-2);
    margin: 0;
  }
  .story div {
    display: grid;
    gap: 0.15rem;
  }
  .story dt {
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .story dd {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--s-3);
    margin: 0;
  }
  .stats div {
    display: flex;
    flex-direction: column;
    gap: var(--s-1);
  }
  .stats dt {
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .stats dd {
    margin: 0;
    font-size: var(--fs-5);
    font-weight: 700;
  }
  .actions {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  @media (max-width: 720px) {
    .stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
