<script lang="ts">
  import StatusPill from './StatusPill.svelte'
  import type { GuildDiagramProps } from './types.js'

  type GuildDiagramLinePoint = {
    x1: number
    y1: number
    x2: number
    y2: number
    labelX: number
    labelY: number
  }

  const defaultNodes = [
    { id: 'charter', label: 'Guild charter', detail: 'Policy, environment, and scope live in one visible frame.', x: 18, y: 18, tone: 'accent' },
    { id: 'captain', label: 'Coordinator', detail: 'Routes work, keeps context, and hands off with receipts.', x: 50, y: 14, tone: 'info' },
    { id: 'scribe', label: 'Review desk', detail: 'Captures outcome, rationale, and whether the task can ship.', x: 82, y: 18, tone: 'ok' },
    { id: 'crew', label: 'Guild members', detail: 'Parallel workers move tasks through bounded lanes.', x: 24, y: 72, tone: 'neutral' },
    { id: 'ledger', label: 'Activity ledger', detail: 'The auditable record stays inspectable after the run.', x: 56, y: 72, tone: 'warn' },
    { id: 'gate', label: 'Release gate', detail: 'Approves only what is verified and ready to leave the hall.', x: 84, y: 72, tone: 'danger' },
  ] as const satisfies NonNullable<GuildDiagramProps['nodes']>

  const defaultLinks = [
    { from: 'charter', to: 'captain', label: 'sets bounds' },
    { from: 'captain', to: 'scribe', label: 'requests review' },
    { from: 'captain', to: 'crew', label: 'dispatches' },
    { from: 'crew', to: 'ledger', label: 'emits evidence' },
    { from: 'scribe', to: 'ledger', label: 'records verdict' },
    { from: 'ledger', to: 'gate', label: 'authorizes release' },
  ] as const satisfies NonNullable<GuildDiagramProps['links']>

  let {
    title = 'A guild that works in the open',
    description = 'Map-room framing for teams that want autonomy, reviewer visibility, and release discipline without flattening the evidence trail.',
    eyebrow,
    headingTag = 'h3',
    mode = 'display',
    density = 'comfortable',
    nodes = defaultNodes,
    links = defaultLinks,
    class: className = '',
    ...restProps
  }: GuildDiagramProps = $props()

  const componentId = $props.id()
  const linkGradientId = `${componentId}-guild-link`
  const relationshipsDescriptionId = `${componentId}-guild-relationships`
  const nodeMap = $derived(new Map(nodes.map((node) => [node.id, node])))
  const linePointsByKey = $derived(
    new Map(
      links.map((link) => {
        const key = `${link.from}-${link.to}`
        return [key, linePoint(link, nodeMap)] as const
      }),
    ),
  )

  function linePoint(link: { from: string; to: string }, nodeLookup: Map<string, (typeof nodes)[number]>): GuildDiagramLinePoint | null {
    const from = nodeLookup.get(link.from)
    const to = nodeLookup.get(link.to)

    if (!from || !to) {
      return null
    }

    return {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      labelX: (from.x + to.x) / 2,
      labelY: (from.y + to.y) / 2,
    }
  }
</script>

<figure
  {...restProps}
  class={['gh-guild-diagram', `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
>
  <figcaption class="gh-guild-diagram-copy">
    {#if eyebrow}
      <p class="gh-guild-diagram-eyebrow">{eyebrow}</p>
    {/if}
    <svelte:element this={headingTag} class="gh-guild-diagram-title">{title}</svelte:element>
    <p class="gh-guild-diagram-description">{description}</p>
  </figcaption>

  <div class="gh-guild-diagram-board">
    <svg
      class="gh-guild-diagram-svg"
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      aria-describedby={relationshipsDescriptionId}
    >
      <defs>
        <linearGradient id={linkGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="var(--gh-color-action-primary)"></stop>
          <stop offset="100%" stop-color="var(--gh-color-action-secondary)"></stop>
        </linearGradient>
      </defs>

      <rect x="3" y="4" width="94" height="92" rx="7" class="gh-guild-board-bg"></rect>

      {#each links as link (`${link.from}-${link.to}`)}
        {@const points = linePointsByKey.get(`${link.from}-${link.to}`)}
        {#if points}
          <line x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2} class="gh-guild-link" stroke={`url(#${linkGradientId})`}></line>
          {#if link.label}
            <text x={points.labelX} y={points.labelY - 1.5} class="gh-guild-link-label">{link.label}</text>
          {/if}
        {/if}
      {/each}

      {#each nodes as node (node.id)}
        <g transform={`translate(${node.x} ${node.y})`}>
          <circle r="7.8" class={`gh-guild-node-shell tone-${node.tone ?? 'neutral'}`}></circle>
          <circle r="3.2" class="gh-guild-node-core"></circle>
          <text y="12.8" class="gh-guild-node-label">{node.label}</text>
        </g>
      {/each}
    </svg>

    <div id={relationshipsDescriptionId} class="gh-guild-diagram-relationships">
      <p class="gh-guild-diagram-relationships-title">Relationship map</p>
      <ul class="gh-guild-diagram-relationship-list">
        {#each links as link (`screenreader-${link.from}-${link.to}`)}
          <li>
            {nodeMap.get(link.from)?.label ?? link.from}
            {#if link.label}
              {' '}
              {link.label}
              {' '}
            {:else}
              {' '}
              connects to
              {' '}
            {/if}
            {nodeMap.get(link.to)?.label ?? link.to}.
          </li>
        {/each}
      </ul>
    </div>

    <ol class="gh-guild-node-list">
      {#each nodes as node (node.id)}
        <li class="gh-guild-node-card">
          <div class="gh-guild-node-head">
            <StatusPill
              label={node.label}
              tone={node.tone ?? 'neutral'}
              emphasis="quiet"
              mode={mode}
              density="dense"
            />
            <span class="gh-guild-node-position">{node.x}% / {node.y}%</span>
          </div>
          {#if node.detail}
            <p class="gh-guild-node-detail">{node.detail}</p>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
</figure>

<style>
  .gh-guild-diagram,
  .gh-guild-diagram-copy,
  .gh-guild-diagram-board {
    display: grid;
    gap: var(--gh-space-4);
    min-inline-size: 0;
  }

  .gh-guild-diagram {
    color: var(--gh-color-text-primary);
    container-type: inline-size;
  }

  .gh-guild-diagram-eyebrow,
  .gh-guild-diagram-title,
  .gh-guild-diagram-description,
  .gh-guild-node-detail {
    margin: 0;
  }

  .gh-guild-diagram-eyebrow {
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    text-transform: uppercase;
  }

  .gh-guild-diagram-title {
    font-size: var(--gh-type-size-5);
    line-height: var(--gh-type-line-height-tight);
    text-wrap: balance;
  }

  .gh-guild-diagram-description {
    max-inline-size: min(62ch, 100%);
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-3);
    line-height: var(--gh-type-line-height-relaxed);
  }

  .gh-guild-diagram-svg {
    inline-size: 100%;
    block-size: auto;
    min-block-size: 18rem;
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-subtle) 84%, white);
    border-radius: var(--gh-radius-3);
    background:
      radial-gradient(circle at top right, color-mix(in srgb, var(--gh-color-action-primary) 14%, transparent), transparent 38%),
      linear-gradient(180deg, color-mix(in srgb, var(--gh-color-surface-raised-alt) 85%, black), color-mix(in srgb, var(--gh-color-surface-sunken) 95%, black));
    box-shadow: 0 16px 36px color-mix(in srgb, black 28%, transparent);
  }

  .gh-guild-diagram-relationships {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .gh-guild-diagram-relationships-title,
  .gh-guild-diagram-relationship-list {
    margin: 0;
    padding: 0;
  }

  .gh-guild-board-bg {
    fill: color-mix(in srgb, var(--gh-color-surface-raised) 75%, black);
    stroke: color-mix(in srgb, var(--gh-color-border-accent) 35%, var(--gh-color-border-subtle));
    stroke-width: 0.5;
  }

  .gh-guild-link {
    stroke-width: 1.15;
    stroke-linecap: round;
    opacity: 0.9;
  }

  .gh-guild-link-label {
    fill: var(--gh-color-text-muted);
    font-size: 2.6px;
    text-anchor: middle;
  }

  .gh-guild-node-shell {
    stroke: color-mix(in srgb, var(--gh-color-border-strong) 80%, white);
    stroke-width: 0.5;
  }

  .gh-guild-node-shell.tone-neutral {
    fill: color-mix(in srgb, var(--gh-color-feedback-neutral) 85%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-shell.tone-info {
    fill: color-mix(in srgb, var(--gh-color-feedback-info) 76%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-shell.tone-ok {
    fill: color-mix(in srgb, var(--gh-color-feedback-ok) 74%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-shell.tone-warn {
    fill: color-mix(in srgb, var(--gh-color-feedback-warn) 74%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-shell.tone-danger {
    fill: color-mix(in srgb, var(--gh-color-feedback-danger) 74%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-shell.tone-accent {
    fill: color-mix(in srgb, var(--gh-color-feedback-accent) 78%, var(--gh-color-surface-raised));
  }

  .gh-guild-node-core {
    fill: color-mix(in srgb, var(--gh-color-surface-canvas) 88%, white);
  }

  .gh-guild-node-label {
    fill: var(--gh-color-text-primary);
    font-size: 3px;
    text-anchor: middle;
  }

  .gh-guild-node-list {
    display: grid;
    gap: var(--gh-space-3);
    padding: 0;
    margin: 0;
    list-style: none;
  }

  .gh-guild-node-card {
    display: grid;
    gap: var(--gh-space-2);
    padding: var(--gh-space-3);
    border: var(--gh-layout-rule-default) solid var(--gh-color-border-subtle);
    border-radius: var(--gh-radius-2);
    background: color-mix(in srgb, var(--gh-color-surface-raised) 84%, black);
  }

  .gh-guild-node-head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    justify-content: space-between;
    align-items: center;
  }

  .gh-guild-node-position {
    color: var(--gh-color-text-muted);
    font-size: var(--gh-type-size-1);
  }

  .gh-guild-node-detail {
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-body);
  }

  .gh-guild-diagram.density-dense .gh-guild-diagram-copy,
  .gh-guild-diagram.density-dense .gh-guild-diagram-board {
    gap: var(--gh-space-3);
  }

  .gh-guild-diagram.density-dense .gh-guild-node-card {
    padding: var(--gh-space-2);
  }

  @container (min-width: 52rem) {
    .gh-guild-diagram-board {
      grid-template-columns: minmax(0, 1.25fr) minmax(18rem, 0.95fr);
      align-items: start;
    }
  }
</style>
