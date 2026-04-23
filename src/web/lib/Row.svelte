<!--
  Horizontal row. Children flow left-to-right with a token-scale gap.
  `align` controls cross-axis, `justify` controls main-axis.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Gap = '1' | '2' | '3' | '4' | '5' | '6'
  type Align = 'start' | 'center' | 'baseline' | 'stretch' | 'end'
  type Justify = 'start' | 'end' | 'between' | 'center'

  interface Props {
    gap?: Gap
    align?: Align
    justify?: Justify
    wrap?: boolean
    children?: Snippet
  }

  let {
    gap = '2',
    align = 'center',
    justify = 'start',
    wrap = false,
    children,
  }: Props = $props()

  const justifyMap: Record<Justify, string> = {
    start: 'flex-start',
    end: 'flex-end',
    between: 'space-between',
    center: 'center',
  }
</script>

<div
  class="row"
  class:wrap
  style="--gap: var(--s-{gap}); --align: {align}; --justify: {justifyMap[justify]}"
>
  {@render children?.()}
</div>

<style>
  .row {
    display: flex;
    flex-direction: row;
    gap: var(--gap);
    align-items: var(--align);
    justify-content: var(--justify);
  }
  .row.wrap {
    flex-wrap: wrap;
  }
</style>
