<!--
  Inline pill/badge. State-signals pair a tone with an explicit label — never
  color alone (per frontend.md a11y rule).
-->
<script lang="ts">
  import Tooltip from './Tooltip.svelte'

  type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' | 'running'

  interface Props {
    label: string
    tone?: Tone
    title?: string
  }

  let { label, tone = 'neutral', title }: Props = $props()

  const countLike = $derived(/^\d+\+?$/.test(label.trim()))
  const tooltipText = $derived(title ?? label)
</script>

{#snippet chipElement()}
  <span class="chip tone-{tone}" class:chip-count={countLike} aria-label={tooltipText}>
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
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 2px var(--s-2);
    border-radius: 10px;
    line-height: var(--lh-tight);
  }
  .chip-count {
    display: inline-grid;
    align-items: center;
    justify-content: center;
    place-items: center;
    min-width: 1.15rem;
    height: 1.15rem;
    padding: 0 0.3rem;
    box-sizing: border-box;
    border-radius: 999px;
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--fs-0);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }
  .count-glyph {
    display: block;
    line-height: 1;
  }
  .tone-neutral {
    background: var(--chip-neutral-bg);
    color: var(--chip-neutral-fg);
  }
  .tone-ok,
  .tone-running {
    background: var(--chip-ok-bg);
    color: var(--chip-ok-fg);
  }
  .tone-warn {
    background: var(--chip-warn-bg);
    color: var(--chip-warn-fg);
  }
  .tone-danger {
    background: var(--chip-danger-bg);
    color: var(--chip-danger-fg);
  }
  .tone-accent {
    background: var(--chip-accent-bg);
    color: var(--chip-accent-fg);
  }
</style>
