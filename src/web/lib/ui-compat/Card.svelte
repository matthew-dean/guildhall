<!-- Temporary compatibility wrapper for the retired src/web/lib/Card.svelte API. -->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import FrameCard from '../../../../packages/ui/src/components/FrameCard.svelte'
  import ActionBar from '../ActionBar.svelte'

  type Tone = 'default' | 'warn' | 'danger' | 'ok' | 'accent'
  type Variant = 'default' | 'callout'
  type RailTone = 'neutral' | 'warn' | 'danger' | 'ok' | 'accent'
  type RailStrength = 'subtle' | 'strong'

  interface Props {
    title?: string
    titleTag?: 'h2' | 'h3' | 'h4'
    tone?: Tone
    variant?: Variant
    railTone?: RailTone | null
    railStrength?: RailStrength
    className?: string
    role?: string
    tabindex?: number
    ariaLabel?: string
    frosted?: boolean
    onclick?: (event: MouseEvent) => void
    onkeydown?: (event: KeyboardEvent) => void
    children?: Snippet
    actions?: Snippet
  }

  let {
    title,
    titleTag = 'h3',
    tone = 'default',
    variant = 'default',
    railTone = null,
    railStrength = 'subtle',
    className = '',
    role,
    tabindex,
    ariaLabel,
    frosted = false,
    onclick,
    onkeydown,
    children,
    actions,
  }: Props = $props()

  const frameTone = $derived(tone === 'default' ? 'default' : tone)
  const frameMode = $derived(variant === 'callout' ? 'display' : 'operator')
  const effectiveRailTone = $derived<RailTone | null>(
    railTone ?? (tone === 'default' ? null : tone),
  )
  const frameClass = $derived([
    'gh-ui-compat-card',
    `variant-${variant}`,
    frosted ? 'is-frosted' : '',
    effectiveRailTone ? `rail-${effectiveRailTone}` : 'rail-none',
    railStrength === 'strong' ? 'rail-strong' : 'rail-subtle',
    className,
  ].filter(Boolean).join(' '))
</script>

{#snippet header()}
  {#if title || actions}
    <div class="card-head">
      {#if title}
        <svelte:element this={titleTag} class="card-title">{title}</svelte:element>
      {/if}
      {#if actions}
        <ActionBar align="end" className="card-actions">{@render actions()}</ActionBar>
      {/if}
    </div>
  {/if}
{/snippet}

<FrameCard
  tone={frameTone}
  mode={frameMode}
  density="comfortable"
  class={frameClass}
  {role}
  {tabindex}
  {ariaLabel}
  {onclick}
  {onkeydown}
  header={title || actions ? header : undefined}
>
  {@render children?.()}
</FrameCard>

<style>
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--gh-space-3);
    min-inline-size: 0;
  }

  .card-title {
    margin: 0;
    min-inline-size: 0;
    color: var(--gh-color-text-primary);
    font-size: var(--gh-type-size-4);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }

  .card-head :global(.card-actions) {
    flex: none;
  }

  :global(.gh-ui-compat-card) {
    isolation: isolate;
  }

  :global(.gh-ui-compat-card.rail-none)::before,
  :global(.gh-ui-compat-card.rail-neutral)::before,
  :global(.gh-ui-compat-card.rail-warn)::before,
  :global(.gh-ui-compat-card.rail-danger)::before,
  :global(.gh-ui-compat-card.rail-ok)::before,
  :global(.gh-ui-compat-card.rail-accent)::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: var(--gh-layout-rule-strong, 2px);
    background: transparent;
    z-index: var(--gh-layer-surface-content, 1);
  }

  :global(.gh-ui-compat-card.rail-strong)::before {
    inline-size: var(--gh-layout-notice-accent-width);
  }

  :global(.gh-ui-compat-card.rail-neutral)::before {
    background: var(--gh-color-feedback-neutral);
  }

  :global(.gh-ui-compat-card.rail-warn)::before {
    background: var(--gh-color-feedback-warn);
  }

  :global(.gh-ui-compat-card.rail-danger)::before {
    background: var(--gh-color-feedback-danger);
  }

  :global(.gh-ui-compat-card.rail-ok)::before {
    background: var(--gh-color-feedback-ok);
  }

  :global(.gh-ui-compat-card.rail-accent)::before {
    background: var(--gh-color-border-accent);
  }
</style>
