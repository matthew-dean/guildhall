<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    className?: string
    children?: Snippet
  }

  let { className = '', children }: Props = $props()
</script>

<div class={['card-list', className].filter(Boolean).join(' ')}>
  {@render children?.()}
</div>

<style>
  .card-list {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
</style>
