<!--
  Inline pill/badge. State-signals pair a tone with an explicit label — never
  color alone (per frontend.md a11y rule).
-->
<script lang="ts">
  import Tooltip from './Tooltip.svelte'

  type Tone =
    | 'neutral'
    | 'ok'
    | 'warn'
    | 'danger'
    | 'accent'
    | 'running'

  /*
   * Chip tone taxonomy:
   * - ok: healthy, available, accepted, or completed state.
   * - running: Guildhall/agent-owned active, queued, or current-step state.
   * - warn: human decision or risk state. Use when the user must answer,
   *   approve, triage, handle a blocker, or when Guildhall needs cleanup before
   *   work can safely continue.
   * - accent: human/primary emphasis that is not itself a success or warning.
   */

  interface Props {
    label: string
    tone?: Tone
    size?: 'default' | 'compact'
    title?: string
  }

  let { label, tone = 'neutral', size = 'default', title }: Props = $props()

  const countLike = $derived(/^\d+\+?$/.test(label.trim()))
  const tooltipText = $derived(title ?? label)
</script>

{#snippet chipElement()}
  <span class="chip tone-{tone} size-{size}" class:chip-count={countLike} aria-label={tooltipText}>
    {#if countLike}
      <span class="count-glyph">{label}</span>
    {:else}
      {label}
    {/if}
  </span>
{/snippet}

<Tooltip text={tooltipText} disabled={!countLike}>
  {@render chipElement()}
</Tooltip>

<style>
  .chip {
    --chip-font-size: var(--gh-type-size-caption);
    display: inline-block;
    box-sizing: border-box;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--chip-font-size);
    font-weight: var(--gh-type-weight-emphasis);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--gh-space-2);
    border: 1px solid var(--chip-neutral-border);
    border-radius: var(--gh-radius-full);
    line-height: var(--gh-type-line-height-control);
    white-space: nowrap;
  }
  .size-compact {
    font-size: var(--chip-font-size);
    padding: 0 var(--gh-space-1);
    letter-spacing: 0.04em;
  }
  .chip-count {
    display: inline-grid;
    align-items: center;
    justify-content: center;
    place-items: center;
    min-width: var(--gh-space-4);
    height: var(--gh-space-4);
    padding: 0 calc(var(--gh-space-1) * 0.75);
    box-sizing: border-box;
    border-radius: var(--gh-radius-full);
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--chip-font-size);
    font-weight: var(--gh-type-weight-emphasis);
    font-variant-numeric: tabular-nums;
    line-height: var(--gh-type-line-height-control);
  }
  .chip-count.size-compact {
    min-width: var(--gh-space-4);
    height: var(--gh-space-4);
    padding: 0 calc(var(--gh-space-1) / 2);
  }
  .count-glyph {
    display: block;
    line-height: var(--gh-type-line-height-control);
  }
  .tone-neutral {
    background: var(--chip-neutral-bg);
    color: var(--chip-neutral-fg);
    border-color: var(--chip-neutral-border);
  }
  .tone-ok,
  .tone-running {
    background: var(--chip-ok-bg);
    color: var(--chip-ok-fg);
    border-color: var(--chip-ok-border);
  }
  .tone-warn {
    background: var(--chip-warn-bg);
    color: var(--chip-warn-fg);
    border-color: var(--chip-warn-border);
    font-weight: var(--gh-type-weight-strong);
  }
  .tone-danger {
    background: var(--chip-danger-bg);
    color: var(--chip-danger-fg);
    border-color: var(--chip-danger-border);
    font-weight: var(--gh-type-weight-strong);
  }
  .tone-accent {
    background: var(--chip-accent-bg);
    color: var(--chip-accent-fg);
    border-color: var(--chip-accent-border);
  }
</style>
