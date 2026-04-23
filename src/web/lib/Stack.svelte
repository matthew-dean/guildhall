<!--
  Vertical stack. Children flow top-to-bottom with a token-scale gap.
  Owns its layout; callers do not set margin-top on children.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Gap = '1' | '2' | '3' | '4' | '5' | '6'

  interface Props {
    gap?: Gap
    children?: Snippet
  }

  let { gap = '3', children }: Props = $props()
</script>

<div class="stack" style="--gap: var(--s-{gap})">
  {@render children?.()}
</div>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
</style>
