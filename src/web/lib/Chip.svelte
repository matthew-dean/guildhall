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
    | 'agent'
    | 'agent-attention'

  /*
   * Chip tone taxonomy:
   * - agent: passive Guildhall automation state. Use for queued/running/shaping
   *   information where Guildhall is or will be the actor, but the chip is not
   *   itself a call to action.
   * - agent-attention: Guildhall-owned state that needs a handoff before it can
   *   proceed, such as brief cleanup needed. It shares the automation hue, but
   *   remains quieter than an agent button so the button still wins.
   * - warn: human decision or risk state. Use when the user must answer,
   *   approve, triage, or handle a real blocker.
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
    display: inline-block;
    box-sizing: border-box;
    font-size: var(--gh-type-size-caption);
    font-weight: var(--gh-type-weight-emphasis);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0 var(--gh-space-2);
    border: 1px solid var(--chip-neutral-border);
    border-radius: var(--gh-radius-full);
    line-height: var(--gh-type-line-height-control);
  }
  .size-compact {
    font-size: var(--gh-type-size-caption);
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
    font-size: var(--gh-type-size-caption);
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
  }
  .tone-danger {
    background: var(--chip-danger-bg);
    color: var(--chip-danger-fg);
    border-color: var(--chip-danger-border);
  }
  .tone-accent {
    background: var(--chip-accent-bg);
    color: var(--chip-accent-fg);
    border-color: var(--chip-accent-border);
  }
  .tone-agent {
    background: color-mix(in srgb, var(--accent-2) 68%, var(--bg-base));
    color: var(--chip-status-on-dark-fg);
    border-color: var(--chip-agent-border);
  }
  .tone-agent-attention {
    background: color-mix(in srgb, var(--accent-2) 62%, var(--chip-warn-bg) 28%);
    color: var(--chip-status-on-dark-fg);
    border-color: var(--chip-agent-attention-border);
  }
</style>
