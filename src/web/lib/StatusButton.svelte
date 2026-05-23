<!--
  Compact semantic status control. Use this for clickable status signals that
  need an outline, tone-colored icon/text, and an optional count badge.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon, { type IconName } from './Icon.svelte'
  import Tooltip from './Tooltip.svelte'

  type Tone = 'neutral' | 'warn' | 'danger'

  interface Props {
    tone?: Tone
    icon: IconName
    label: string
    count?: number
    ariaLabel: string
    title?: string
    tooltip?: boolean
    showLabel?: boolean
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
    tooltip = false,
    showLabel = true,
    disabled = false,
    onclick,
    children,
  }: Props = $props()

  const countLabel = $derived(
    typeof count === 'number'
      ? count > 99 ? '99+' : String(Math.max(0, count))
      : '',
  )
</script>

{#snippet statusButtonElement()}
  <button
    type="button"
    class="status-button tone-{tone}"
    {disabled}
    {onclick}
    aria-label={ariaLabel}
>
    <Icon name={icon} size={16} />
    {#if showLabel}
      <span class="status-label">{label}</span>
    {/if}
    {#if typeof count === 'number'}
      <span class="status-count" aria-hidden="true"><span class="count-glyph">{countLabel}</span></span>
    {/if}
    {@render children?.()}
</button>
{/snippet}

{#if title && tooltip}
  <Tooltip text={title}>
    {@render statusButtonElement()}
  </Tooltip>
{:else}
  {@render statusButtonElement()}
{/if}

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
    position: relative;
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
    display: inline-grid;
    align-items: center;
    justify-content: center;
    place-items: center;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    box-sizing: border-box;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-base) 24%, transparent);
    color: currentColor;
    font-size: var(--fs-0);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
    letter-spacing: 0;
  }
  .count-glyph {
    display: block;
    line-height: 1;
  }
</style>
