<!--
  Compact semantic status control. Use this for clickable status signals that
  need an outline, tone-colored icon/text, and an optional count badge.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon, { type IconName } from './Icon.svelte'

  type Tone = 'neutral' | 'warn' | 'danger'

  interface Props {
    tone?: Tone
    icon: IconName
    label: string
    count?: number
    ariaLabel: string
    title?: string
    disabled?: boolean
    onclick?: (e: MouseEvent) => void
    children?: Snippet
  }

  let {
    tone = 'neutral',
    icon,
    label,
    count,
    ariaLabel,
    title,
    disabled = false,
    onclick,
    children,
  }: Props = $props()
</script>

<button
  type="button"
  class="status-button tone-{tone}"
  {disabled}
  {onclick}
  aria-label={ariaLabel}
  {title}
>
  <Icon name={icon} size={16} />
  <span>{label}</span>
  {#if typeof count === 'number'}
    <span class="status-count">{count}</span>
  {/if}
  {@render children?.()}
</button>

<style>
  .status-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--s-2);
    min-height: 28px;
    padding: var(--control-pad-y) var(--s-3);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: color-mix(in srgb, var(--bg-raised-2) 84%, var(--text) 16%);
    color: var(--text);
    font: inherit;
    font-size: var(--fs-1);
    font-weight: 600;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
  }
  .status-button :global(svg) {
    display: block;
    flex: none;
  }
  .status-button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--bg-raised-2) 76%, var(--text) 24%);
    border-color: var(--border-strong);
  }
  .status-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .status-button:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  .tone-warn {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 44%, var(--border) 56%);
    background: color-mix(in srgb, var(--surface-warn) 34%, var(--bg-raised-2) 66%);
  }
  .tone-danger {
    color: var(--danger);
    border-color: color-mix(in srgb, var(--danger) 48%, var(--border) 52%);
    background: color-mix(in srgb, var(--surface-danger) 34%, var(--bg-raised-2) 66%);
  }
  .status-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: calc(var(--s-3) + var(--s-1));
    height: calc(var(--s-3) + var(--s-1));
    padding: 0 var(--s-1);
    border: 1px solid currentColor;
    border-radius: var(--r-1);
    background: color-mix(in srgb, currentColor 16%, transparent);
    color: currentColor;
    font-size: var(--fs-0);
    font-weight: 750;
    line-height: 1;
  }
</style>
