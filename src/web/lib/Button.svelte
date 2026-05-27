<!--
  Single-variant button. Label is the only required prop per ADHD-minimal-UI
  feedback: one verb, no helper text. For icon-only buttons, pass `ariaLabel`.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Tooltip from './Tooltip.svelte'

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

{#snippet buttonElement()}
  <button
    class={`btn v-${variant} s-${size} ${iconOnly ? 'icon-only' : ''} ${className}`.trim()}
    {type}
    {disabled}
    {onclick}
    aria-label={ariaLabel}
  >
    {@render children?.()}
  </button>
{/snippet}

{#if title && iconOnly}
  <Tooltip text={title}>
    {@render buttonElement()}
  </Tooltip>
{:else}
  {@render buttonElement()}
{/if}

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
    background:
      linear-gradient(180deg, color-mix(in srgb, white 18%, transparent), transparent 48%),
      linear-gradient(100deg, var(--light-violet-warm), var(--accent) 64%, color-mix(in srgb, var(--accent) 88%, black));
    color: white;
    border-color: color-mix(in srgb, var(--accent) 65%, white 18%);
    box-shadow:
      var(--light-emitted-accent),
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
  }
  .v-human {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 18%, transparent), transparent 48%),
      linear-gradient(100deg, var(--light-violet-warm), var(--accent) 64%, color-mix(in srgb, var(--accent) 88%, black));
    color: white;
    border-color: color-mix(in srgb, var(--accent) 65%, white 18%);
    box-shadow:
      var(--light-emitted-accent),
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
  }
  .v-agent {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 22%, transparent), transparent 50%),
      var(--accent-2);
    color: var(--bg-base);
    border-color: color-mix(in srgb, var(--accent-2) 72%, white 14%);
    box-shadow:
      var(--light-emitted-agent),
      inset 0 1px 0 color-mix(in srgb, white 20%, transparent);
  }
  .v-agent:not(:disabled):hover {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 26%, transparent), transparent 50%),
      color-mix(in srgb, var(--accent-2) 88%, white 12%);
    border-color: color-mix(in srgb, var(--accent-2) 62%, white 24%);
    filter: none;
  }
  .v-secondary {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 8%, transparent), transparent 48%),
      color-mix(in srgb, var(--button-secondary-bg) 76%, transparent);
    color: var(--text);
    border-color: var(--button-secondary-border);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 9%, transparent);
  }
  .v-secondary:not(:disabled):hover {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 10%, transparent), transparent 48%),
      color-mix(in srgb, var(--button-secondary-bg-hover) 82%, transparent);
    border-color: var(--button-secondary-border-hover);
    filter: none;
  }
  .v-danger {
    background:
      linear-gradient(180deg, color-mix(in srgb, white 16%, transparent), transparent 48%),
      var(--danger);
    color: white;
    border-color: color-mix(in srgb, var(--danger) 70%, white 14%);
    box-shadow:
      0 0 16px color-mix(in srgb, var(--danger) 28%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
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
