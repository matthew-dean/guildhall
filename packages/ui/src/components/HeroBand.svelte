<script lang="ts">
  import StatusPill from './StatusPill.svelte'
  import type { HeroBandProps } from './types.js'

  const defaultBadges = [
    { label: 'Local-first control', tone: 'accent', emphasis: 'quiet' },
    { label: 'Auditable reviewer flow', tone: 'info', emphasis: 'quiet' },
    { label: 'Operator-grade shell', tone: 'ok', emphasis: 'quiet' },
  ] as const satisfies NonNullable<HeroBandProps['badges']>

  const defaultStats = [
    { label: 'Inspection', value: 'Drawer-first', detail: 'Keep context while opening task history and transcripts.' },
    { label: 'Autonomy', value: 'Supervised', detail: 'Let work keep moving without hiding why decisions were made.' },
    { label: 'Surface', value: 'Display mode', detail: 'Share the product story with the same tokens used in the app.' },
  ] as const satisfies NonNullable<HeroBandProps['stats']>

  let {
    eyebrow,
    title,
    description,
    note,
    headingTag = 'h2',
    mode = 'display',
    density = 'comfortable',
    badges = defaultBadges,
    stats = defaultStats,
    media,
    actions,
    class: className = '',
    ...restProps
  }: HeroBandProps = $props()
</script>

<section
  {...restProps}
  class={['gh-hero-band', `mode-${mode}`, `density-${density}`, className].filter(Boolean).join(' ')}
>
  <div class="gh-hero-copy">
    {#if eyebrow}
      <p class="gh-hero-eyebrow">{eyebrow}</p>
    {/if}

    <div class="gh-hero-header">
      <svelte:element this={headingTag} class="gh-hero-title">{title}</svelte:element>
      <p class="gh-hero-description">{description}</p>
    </div>

    {#if badges.length}
      <div class="gh-hero-badges" aria-label="Hero highlights">
        {#each badges as badge (badge.label)}
          <StatusPill
            label={badge.label}
            tone={badge.tone ?? 'neutral'}
            emphasis={badge.emphasis ?? 'quiet'}
            mode={mode}
            density={density}
          />
        {/each}
      </div>
    {/if}

    {#if note}
      <p class="gh-hero-note">{note}</p>
    {/if}

    {#if actions}
      <div class="gh-hero-actions">
        {@render actions()}
      </div>
    {/if}
  </div>

  <div class="gh-hero-stage">
    <div class="gh-hero-media">
      {#if media}
        {@render media()}
      {:else}
        <div class="gh-hero-scene" aria-hidden="true">
          <div class="gh-hero-banner">
            <span class="gh-hero-banner-mark"></span>
            <span class="gh-hero-banner-copy">Guild Hall</span>
          </div>
          <div class="gh-hero-map">
            <span class="gh-hero-room room-hall"></span>
            <span class="gh-hero-room room-audit"></span>
            <span class="gh-hero-room room-review"></span>
            <span class="gh-hero-room room-work"></span>
            <span class="gh-hero-route route-a"></span>
            <span class="gh-hero-route route-b"></span>
            <span class="gh-hero-route route-c"></span>
          </div>
        </div>
      {/if}
    </div>

    {#if stats.length}
      <dl class="gh-hero-stats">
        {#each stats as stat (stat.label)}
          <div class="gh-hero-stat">
            <dt>{stat.label}</dt>
            <dd class="gh-hero-stat-value">{stat.value}</dd>
            {#if stat.detail}
              <dd class="gh-hero-stat-detail">{stat.detail}</dd>
            {/if}
          </div>
        {/each}
      </dl>
    {/if}
  </div>
</section>

<style>
  .gh-hero-band {
    display: grid;
    gap: var(--gh-space-5);
    min-inline-size: 0;
    padding: clamp(var(--gh-space-5), 3cqi, var(--gh-space-6));
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-accent) 28%, var(--gh-color-border-subtle));
    border-radius: var(--gh-radius-3);
    background:
      radial-gradient(circle at top right, color-mix(in srgb, var(--gh-color-action-primary) 16%, transparent), transparent 34%),
      radial-gradient(circle at bottom left, color-mix(in srgb, var(--gh-color-action-secondary) 14%, transparent), transparent 32%),
      linear-gradient(180deg, color-mix(in srgb, var(--gh-color-surface-raised-alt) 88%, #1c1620) 0, var(--gh-color-surface-sunken) 100%);
    color: var(--gh-color-text-primary);
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, white 7%, transparent),
      0 20px 44px color-mix(in srgb, black 26%, transparent);
    container-type: inline-size;
    overflow: clip;
  }

  .gh-hero-copy,
  .gh-hero-stage,
  .gh-hero-media {
    display: grid;
    gap: var(--gh-space-4);
    min-inline-size: 0;
  }

  .gh-hero-eyebrow,
  .gh-hero-description,
  .gh-hero-note,
  .gh-hero-stat dt,
  .gh-hero-stat dd {
    margin: 0;
  }

  .gh-hero-eyebrow {
    color: color-mix(in srgb, var(--gh-color-action-secondary) 72%, var(--gh-color-text-secondary));
    font-size: var(--gh-type-size-1);
    font-weight: var(--gh-type-weight-strong);
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .gh-hero-header {
    display: grid;
    gap: var(--gh-space-3);
  }

  .gh-hero-title {
    margin: 0;
    max-inline-size: 12ch;
    font-size: clamp(var(--gh-type-size-6), 4.5cqi, 2.95rem);
    font-weight: var(--gh-type-weight-strong);
    line-height: 0.98;
    text-wrap: balance;
  }

  .gh-hero-description {
    max-inline-size: min(60ch, 100%);
    color: color-mix(in srgb, var(--gh-color-text-secondary) 92%, white);
    font-size: var(--gh-type-size-4);
    line-height: var(--gh-type-line-height-relaxed);
    text-wrap: pretty;
  }

  .gh-hero-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
  }

  .gh-hero-note {
    max-inline-size: min(56ch, 100%);
    color: color-mix(in srgb, var(--gh-color-text-muted) 90%, white);
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-body);
  }

  .gh-hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
  }

  .gh-hero-stage {
    align-content: start;
  }

  .gh-hero-media {
    min-block-size: min(24rem, 55cqi);
    padding: var(--gh-space-4);
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-subtle) 62%, transparent);
    border-radius: calc(var(--gh-radius-3) - 2px);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--gh-color-surface-raised-alt) 84%, #201821), var(--gh-color-surface-raised) 100%);
  }

  .gh-hero-scene {
    position: relative;
    display: grid;
    gap: var(--gh-space-4);
    min-block-size: 100%;
  }

  .gh-hero-banner {
    display: inline-flex;
    align-items: center;
    gap: var(--gh-space-2);
    inline-size: fit-content;
    padding: 0.55rem 0.8rem;
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-accent) 66%, black);
    border-radius: var(--gh-radius-full);
    background: color-mix(in srgb, var(--gh-color-surface-sunken) 72%, transparent);
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-1);
    text-transform: uppercase;
  }

  .gh-hero-banner-mark {
    inline-size: 0.8rem;
    block-size: 0.8rem;
    border-radius: 999px;
    background:
      radial-gradient(circle at center, var(--gh-color-action-secondary) 0 24%, transparent 24%),
      radial-gradient(circle at center, color-mix(in srgb, var(--gh-color-action-primary) 70%, white) 0 55%, transparent 58%);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--gh-color-border-accent) 75%, transparent);
  }

  .gh-hero-map {
    position: relative;
    flex: 1;
    min-block-size: 13.5rem;
    border-radius: calc(var(--gh-radius-3) - 2px);
    background:
      linear-gradient(135deg, color-mix(in srgb, var(--gh-color-border-subtle) 75%, transparent) 0 2px, transparent 2px) 0 0 / 1.2rem 1.2rem,
      linear-gradient(180deg, color-mix(in srgb, var(--gh-color-surface-canvas) 90%, black), color-mix(in srgb, var(--gh-color-surface-raised) 92%, black));
    overflow: hidden;
  }

  .gh-hero-room,
  .gh-hero-route {
    position: absolute;
    display: block;
  }

  .gh-hero-room {
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-strong) 82%, white);
    border-radius: var(--gh-radius-2);
    background: color-mix(in srgb, var(--gh-color-surface-raised-alt) 82%, black);
    box-shadow: inset 0 1px 0 color-mix(in srgb, white 6%, transparent);
  }

  .gh-hero-room::after {
    content: '';
    position: absolute;
    inset: 0.65rem;
    border-radius: calc(var(--gh-radius-2) - 2px);
    border: 1px dashed color-mix(in srgb, var(--gh-color-border-subtle) 85%, transparent);
  }

  .gh-hero-room.room-hall {
    inset: 14% auto auto 12%;
    inline-size: 34%;
    block-size: 34%;
  }

  .gh-hero-room.room-audit {
    inset: 18% 10% auto auto;
    inline-size: 24%;
    block-size: 24%;
  }

  .gh-hero-room.room-review {
    inset: auto 18% 15% auto;
    inline-size: 28%;
    block-size: 28%;
  }

  .gh-hero-room.room-work {
    inset: auto auto 11% 18%;
    inline-size: 26%;
    block-size: 26%;
  }

  .gh-hero-route {
    border-radius: 999px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--gh-color-action-primary) 40%, transparent), color-mix(in srgb, var(--gh-color-action-secondary) 50%, transparent));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--gh-color-border-subtle) 55%, transparent);
    opacity: 0.95;
  }

  .gh-hero-route.route-a {
    inset: 28% 30% auto 34%;
    block-size: 2px;
  }

  .gh-hero-route.route-b {
    inset: auto 31% 27% 43%;
    block-size: 2px;
    transform: rotate(55deg);
    transform-origin: center;
  }

  .gh-hero-route.route-c {
    inset: 55% auto auto 29%;
    inline-size: 2px;
    block-size: 18%;
  }

  .gh-hero-stats {
    display: grid;
    gap: var(--gh-space-3);
    min-inline-size: 0;
  }

  .gh-hero-stat {
    display: grid;
    gap: var(--gh-space-1);
    padding: var(--gh-space-3);
    border: var(--gh-layout-rule-default) solid color-mix(in srgb, var(--gh-color-border-subtle) 58%, transparent);
    border-radius: var(--gh-radius-2);
    background: color-mix(in srgb, var(--gh-color-surface-raised) 88%, #18141c);
  }

  .gh-hero-stat dt {
    color: var(--gh-color-text-muted);
    font-size: var(--gh-type-size-1);
    text-transform: uppercase;
  }

  .gh-hero-stat-value {
    font-size: var(--gh-type-size-5);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  .gh-hero-stat-detail {
    display: block;
    color: var(--gh-color-text-secondary);
    font-size: var(--gh-type-size-2);
    line-height: var(--gh-type-line-height-body);
  }

  .gh-hero-band.density-compact {
    gap: var(--gh-space-4);
    padding: var(--gh-space-5);
  }

  .gh-hero-band.density-compact .gh-hero-header,
  .gh-hero-band.density-compact .gh-hero-copy,
  .gh-hero-band.density-compact .gh-hero-stage {
    gap: var(--gh-space-3);
  }

  .gh-hero-band.density-compact .gh-hero-title {
    font-size: clamp(var(--gh-type-size-6), 4cqi, 2.35rem);
  }

  .gh-hero-band.density-dense {
    gap: var(--gh-space-3);
    padding: var(--gh-space-4);
  }

  .gh-hero-band.density-dense .gh-hero-title {
    font-size: clamp(var(--gh-type-size-5), 3.8cqi, 2rem);
  }

  .gh-hero-band.density-dense .gh-hero-description {
    font-size: var(--gh-type-size-3);
  }

  .gh-hero-band.density-dense .gh-hero-media,
  .gh-hero-band.density-dense .gh-hero-stat {
    padding: var(--gh-space-3);
  }

  @container (min-width: 48rem) {
    .gh-hero-band {
      grid-template-columns: minmax(0, 1.05fr) minmax(18rem, 0.95fr);
      align-items: start;
    }

    .gh-hero-stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
