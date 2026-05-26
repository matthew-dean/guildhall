<!--
  Reusable project-overview task row. The status chip owns a stable upper-right
  column so long task titles wrap without pushing the chip into the content.
-->
<script lang="ts">
  import Chip from './Chip.svelte'

  type ChipTone =
    | 'neutral'
    | 'ok'
    | 'warn'
    | 'danger'
    | 'accent'
    | 'running'
    | 'agent'
    | 'agent-attention'

  interface Props {
    title: string
    detail?: string
    chipLabel: string
    chipTone?: ChipTone
    onclick?: () => void
  }

  let {
    title,
    detail = '',
    chipLabel,
    chipTone = 'neutral',
    onclick,
  }: Props = $props()
</script>

<button type="button" class="overview-task-row" {onclick}>
  <div class="row-copy">
    <div class="row-head">
      <strong>{title}</strong>
      <Chip label={chipLabel} tone={chipTone} />
    </div>
    {#if detail}
      <span>{detail}</span>
    {/if}
  </div>
</button>

<style>
  .overview-task-row {
    display: grid;
    gap: var(--s-3);
    align-items: start;
    min-width: 0;
    width: 100%;
    padding: var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-raised) 84%, transparent);
    color: var(--text);
    cursor: pointer;
    font: inherit;
    text-align: left;
  }

  .row-copy {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }

  .row-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content;
    align-items: flex-start;
    gap: var(--s-2);
    min-width: 0;
  }

  .row-head strong {
    min-width: 0;
    max-width: 100%;
    color: var(--text);
    overflow-wrap: anywhere;
  }

  .row-head :global(.chip) {
    justify-self: end;
  }

  .overview-task-row span {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }

  .overview-task-row:hover {
    border-color: var(--border-strong);
    background: var(--bg-raised-2);
  }

  @media (max-width: 640px) {
    .overview-task-row {
      padding: var(--s-2);
    }
  }
</style>
