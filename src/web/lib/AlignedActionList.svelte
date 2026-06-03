<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    ariaLabel: string
    columns: string
    headers?: string[]
    children?: Snippet
  }

  let { ariaLabel, columns, headers = [], children }: Props = $props()
</script>

<section class="aligned-list" aria-label={ariaLabel} style={`--aligned-list-columns: ${columns};`}>
  {#if headers.length > 0}
    <div class="aligned-list-head" aria-hidden="true">
      {#each headers as header}
        <span>{header}</span>
      {/each}
    </div>
  {/if}
  <div class="aligned-list-grid" role="list">
    {@render children?.()}
  </div>
</section>

<style>
  .aligned-list {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .aligned-list-head,
  .aligned-list-grid {
    display: grid;
    grid-template-columns: var(--aligned-list-columns);
    gap: var(--s-2);
  }
  .aligned-list-head {
    align-items: center;
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.05em;
    line-height: var(--gh-type-line-height-tight);
    text-transform: uppercase;
  }
  .aligned-list-head span {
    min-width: 0;
  }
  .aligned-list-head span:last-child {
    padding-inline-end: var(--s-3);
    text-align: right;
  }
  .aligned-list-grid {
    align-items: stretch;
  }
  .aligned-list-grid :global(.aligned-list-row) {
    display: grid;
    grid-column: 1 / -1;
    grid-template-columns: subgrid;
    align-items: center;
    gap: var(--s-2);
    min-width: 0;
  }
  @supports not (grid-template-columns: subgrid) {
    .aligned-list-grid :global(.aligned-list-row) {
      grid-template-columns: var(--aligned-list-columns);
    }
  }
  @media (max-width: 860px) {
    .aligned-list-head {
      display: none;
    }
    .aligned-list-grid {
      grid-template-columns: minmax(0, 1fr);
    }
    .aligned-list-grid :global(.aligned-list-row) {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
