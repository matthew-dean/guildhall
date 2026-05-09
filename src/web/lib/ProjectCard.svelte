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
    </div>

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
