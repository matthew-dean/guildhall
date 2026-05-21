<!--
  Single-variant button. Label is the only required prop per ADHD-minimal-UI
  feedback: one verb, no helper text. For icon-only buttons, pass `ariaLabel`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'human' | 'agent'
  type Size = 'sm' | 'md'

  interface Props {
    variant?: Variant
    size?: Size
    disabled?: boolean
    iconOnly?: boolean
    type?: 'button' | 'submit'
    ariaLabel?: string
    title?: string
    className?: string
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    iconOnly = false,
    type = 'button',
    ariaLabel,
    title,
    className = '',
    onclick,
    children,
  }: Props = $props()
</script>

<button
  class={`btn v-${variant} s-${size} ${iconOnly ? 'icon-only' : ''} ${className}`.trim()}
  {type}
  {disabled}
  {onclick}
  aria-label={ariaLabel}
  {title}
>
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    border: 1px solid transparent;
    border-radius: var(--r-1);
    font-weight: 600;
    font-size: var(--fs-2);
    font-family: inherit;
    cursor: pointer;
    line-height: 1;
    min-height: var(--control-h);
    white-space: nowrap;
    transition:
      background-color 120ms ease,
      border-color 120ms ease,
      color 120ms ease,
      box-shadow 120ms ease,
      filter 120ms ease;
  }
  .btn :global(svg) {
    display: block;
    flex: none;
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
    border-color: color-mix(in srgb, var(--accent) 65%, white 18%);
  }
  .v-human {
    background: var(--accent);
    color: white;
    border-color: color-mix(in srgb, var(--accent) 65%, white 18%);
  }
  .v-agent {
    background: var(--accent-2);
    color: var(--bg-base);
    border-color: color-mix(in srgb, var(--accent-2) 72%, white 14%);
  }
  .v-agent:not(:disabled):hover {
    background: color-mix(in srgb, var(--accent-2) 88%, white 12%);
    border-color: color-mix(in srgb, var(--accent-2) 62%, white 24%);
    filter: none;
  }
  .v-secondary {
    background: color-mix(in srgb, var(--bg-raised-2) 84%, var(--text) 16%);
    color: var(--text);
    border-color: color-mix(in srgb, var(--text) 24%, var(--bg-raised-2) 76%);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 6%, transparent);
  }
  .v-secondary:not(:disabled):hover {
    background: color-mix(in srgb, var(--bg-raised-2) 76%, var(--text) 24%);
    border-color: color-mix(in srgb, var(--text) 34%, var(--bg-raised-2) 66%);
    filter: none;
  }
  .v-danger {
    background: var(--danger);
    color: white;
    border-color: color-mix(in srgb, var(--danger) 70%, white 14%);
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
    padding: var(--control-pad-y) var(--s-3);
    font-size: var(--fs-1);
    min-height: 28px;
  }
  .s-md {
    padding: var(--control-pad-y) var(--control-pad-x);
  }
  .icon-only {
    width: var(--control-h);
    min-width: var(--control-h);
    padding-inline: 0;
  }
  .s-sm.icon-only {
    width: 28px;
    min-width: 28px;
  }
</style>
