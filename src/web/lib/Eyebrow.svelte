<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'neutral' | 'warn' | 'accent'

  interface Props {
    as?: 'span' | 'div' | 'p'
    tone?: Tone
    className?: string
    children?: Snippet
  }

  let {
    as = 'span',
    tone = 'neutral',
    className = '',
    children,
  }: Props = $props()
</script>

<svelte:element
  this={as}
  class={['eyebrow', `tone-${tone}`, className].filter(Boolean).join(' ')}
>
  {@render children?.()}
</svelte:element>

<style>
  .eyebrow {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    color: var(--text-muted);
    font-size: var(--fs-0);
    font-weight: 800;
    line-height: 1.25;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .tone-warn {
    color: var(--warn);
  }

  .tone-accent {
    color: var(--accent-2);
  }
</style>
