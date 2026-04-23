<!--
  Single-variant button. Label is the only required prop per ADHD-minimal-UI
  feedback: one verb, no helper text. For icon-only buttons, pass `ariaLabel`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
  type Size = 'sm' | 'md'

  interface Props {
    variant?: Variant
    size?: Size
    disabled?: boolean
    type?: 'button' | 'submit'
    ariaLabel?: string
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    type = 'button',
    ariaLabel,
    onclick,
    children,
  }: Props = $props()
</script>

<button
  class="btn v-{variant} s-{size}"
  {type}
  {disabled}
  {onclick}
  aria-label={ariaLabel}
>
  {@render children?.()}
</button>

<style>
  .btn {
    border: 1px solid transparent;
    border-radius: var(--r-1);
    font-weight: 600;
    font-size: var(--fs-2);
    font-family: inherit;
    cursor: pointer;
    line-height: var(--lh-tight);
    min-height: var(--control-h);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn:not(:disabled):hover {
    filter: brightness(1.1);
  }

  .v-primary {
    background: var(--accent);
    color: white;
  }
  .v-secondary {
    background: var(--bg-raised-2);
    color: var(--text);
    border-color: var(--border);
  }
  .v-danger {
    background: var(--danger);
    color: white;
  }
  .v-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: transparent;
  }
  .v-ghost:not(:disabled):hover {
    color: var(--text);
    background: var(--bg-raised-2);
    filter: none;
  }

  .s-sm {
    padding: 2px var(--s-2);
    font-size: var(--fs-1);
    min-height: 22px;
  }
  .s-md {
    padding: var(--control-pad-y) var(--control-pad-x);
  }
</style>
