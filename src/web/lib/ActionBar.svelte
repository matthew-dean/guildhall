<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    align?: 'start' | 'end' | 'between'
    wrap?: boolean
    className?: string
    children: Snippet
  }

  let { align = 'end', wrap = true, className = '', children }: Props = $props()
</script>

<div class={`action-bar align-${align} ${wrap ? 'wrap' : 'nowrap'} ${className}`.trim()}>
  {@render children()}
</div>

<style>
  .action-bar {
    display: flex;
    align-items: center;
    gap: var(--s-2);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .nowrap {
    flex-wrap: nowrap;
  }
  .align-start {
    justify-content: flex-start;
  }
  .align-end {
    justify-content: flex-end;
  }
  .align-between {
    justify-content: space-between;
  }
  @media (max-width: 560px) {
    .action-bar {
      justify-content: stretch;
    }
    .action-bar :global(.btn) {
      flex: 1 1 auto;
    }
  }
</style>
