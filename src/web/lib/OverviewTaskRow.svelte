<!--
  Reusable project-overview task row. The status chip owns a stable upper-right
  column so long task titles wrap without pushing the chip into the content.
-->
<script lang="ts">
  import Chip from './Chip.svelte'
  import UtilityPanel from './UtilityPanel.svelte'

  type ChipTone =
    | 'neutral'
    | 'ok'
    | 'warn'
    | 'danger'
    | 'accent'
    | 'running'

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

<UtilityPanel as="button" interactive className="overview-task-row" {onclick}>
  <div class="row-copy">
    <div class="row-head">
      <strong>{title}</strong>
      <Chip label={chipLabel} tone={chipTone} />
    </div>
    {#if detail}
      <span>{detail}</span>
    {/if}
  </div>
</UtilityPanel>

<style>
  :global(.overview-task-row) {
    align-items: start;
    width: 100%;
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

  :global(.overview-task-row) span {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    line-height: var(--gh-type-line-height-body);
  }

  @media (max-width: 640px) {
    :global(.overview-task-row) {
      padding: var(--s-2);
    }
  }
</style>
