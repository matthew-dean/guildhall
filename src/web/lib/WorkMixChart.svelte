<!--
  Shared work-mix visualization. Keep project/home work charts on this molecule
  so state colors, segment sizing, and legend density do not drift by surface.
-->
<script lang="ts">
  import Tooltip from './Tooltip.svelte'

  export type WorkMixTone =
    | 'active'
    | 'attention'
    | 'blocked'
    | 'done'
    | 'draft'
    | 'ready'
    | 'shelved'
    | 'working'

  export interface WorkMixSegment {
    key: string
    label: string
    count: number
    tone: WorkMixTone
    ariaLabel?: string
    tooltip?: string
  }

  interface Props {
    ariaLabel: string
    segments: WorkMixSegment[]
    emptyLabel?: string
    onLegendClick?: (segment: WorkMixSegment) => void
  }

  let {
    ariaLabel,
    segments,
    emptyLabel = 'No tasks yet',
    onLegendClick,
  }: Props = $props()

  const visibleSegments = $derived(segments.filter(segment => segment.count > 0))
  const hasLegendAction = $derived(Boolean(onLegendClick))

  function segmentFlex(count: number): string {
    return `flex-grow: ${Math.max(1, count)}; flex-shrink: 1; flex-basis: 0;`
  }
</script>

<div class="work-mix-chart" aria-label={ariaLabel}>
  {#if visibleSegments.length}
    {#each visibleSegments as segment (segment.key)}
      <Tooltip text={segment.tooltip ?? segment.ariaLabel ?? segment.label} style={segmentFlex(segment.count)} className="work-mix-segment-tip">
        <span
          class="work-mix-segment tone-{segment.tone}"
          aria-label={segment.ariaLabel ?? `${segment.count} ${segment.label}`}
        ></span>
      </Tooltip>
    {/each}
  {:else}
    <Tooltip text={emptyLabel} style={segmentFlex(1)} className="work-mix-segment-tip">
      <span class="work-mix-segment tone-empty" aria-label={emptyLabel}></span>
    </Tooltip>
  {/if}
</div>

<div class="work-mix-legend">
  {#each segments as segment (segment.key)}
    {#if hasLegendAction}
      <button type="button" class="legend-item" onclick={() => onLegendClick?.(segment)}>
        <span class="legend-dot tone-{segment.tone}"></span>
        <span>{segment.count} {segment.label}</span>
      </button>
    {:else}
      <span class="legend-item">
        <span class="legend-dot tone-{segment.tone}"></span>
        <span>{segment.count} {segment.label}</span>
      </span>
    {/if}
  {/each}
  {#if !segments.length}
    <p class="muted">{emptyLabel}</p>
  {/if}
</div>

<style>
  .work-mix-chart {
    display: flex;
    gap: 3px;
    height: 1.45rem;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: var(--r-2);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 8%, transparent);
    overflow: hidden;
  }
  :global(.work-mix-chart .work-mix-segment-tip) {
    min-width: 0.75rem;
    height: 100%;
  }
  .work-mix-segment {
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0.75rem;
    border-radius: calc(var(--r-2) - 3px);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 24%, transparent), transparent 52%),
      var(--work-mix-color);
  }
  .work-mix-legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--s-2);
    margin-top: var(--s-3);
    color: var(--text-muted);
    font-size: var(--gh-type-size-caption);
    line-height: var(--gh-type-line-height-control);
  }
  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    color: inherit;
    font: inherit;
  }
  button.legend-item {
    appearance: none;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: pointer;
  }
  button.legend-item:hover {
    color: var(--text);
  }
  .legend-dot {
    display: inline-block;
    width: 0.55rem;
    height: 0.55rem;
    flex: none;
    border-radius: 999px;
    background: var(--work-mix-color);
  }
  .tone-active,
  .tone-working {
    --work-mix-color: var(--accent-2);
  }
  .tone-ready {
    --work-mix-color: var(--accent);
  }
  .tone-attention,
  .tone-draft {
    --work-mix-color: var(--signal-warn-strong);
  }
  .tone-blocked {
    --work-mix-color: var(--danger);
  }
  .tone-done {
    --work-mix-color: color-mix(in srgb, var(--text-soft) 72%, var(--accent) 28%);
  }
  .tone-shelved {
    --work-mix-color: color-mix(in srgb, var(--text-muted) 55%, transparent);
  }
  .tone-empty {
    --work-mix-color: color-mix(in srgb, var(--text-muted) 22%, transparent);
  }
  .muted {
    margin: 0;
    color: var(--text-muted);
  }
</style>
