<!--
  Card container. Surface with border + padding.
  Title is an <h3> by default; callers can opt into h2 for a page's top-level card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import ActionBar from './ActionBar.svelte'

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
  const effectiveRailTone = $derived<RailTone | null>(
    railTone ?? (tone === 'default' ? null : tone),
  )
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
  class={[
    'card',
    `tone-${tone}`,
    `variant-${variant}`,
    frosted ? 'is-frosted' : '',
    effectiveRailTone ? `rail-${effectiveRailTone}` : 'rail-none',
    railStrength === 'strong' ? 'rail-strong' : 'rail-subtle',
    className,
  ].filter(Boolean).join(' ')}
  {role}
  {tabindex}
  aria-label={ariaLabel}
  {onclick}
  {onkeydown}
>
  {#if title || actions}
    <header class="card-head">
      {#if title}
        {#if titleTag === 'h2'}
          <h2>{title}</h2>
        {:else if titleTag === 'h3'}
          <h3>{title}</h3>
        {:else}
          <h4>{title}</h4>
        {/if}
      {/if}
      {#if actions}
        <ActionBar align="end" className="card-actions">{@render actions()}</ActionBar>
      {/if}
    </header>
  {/if}
  <div class="card-body">
    {@render children?.()}
  </div>
</section>

<style>
  .card {
    --card-bg:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-bg);
    --card-border: var(--glass-border);
    --card-shadow: var(--glass-shadow), var(--glass-etch);
    --card-reflect: var(--glass-reflect-violet), var(--glass-reflect-mint);
    --card-reflect-opacity: 0.48;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--r-3);
    box-shadow: var(--card-shadow);
    padding: var(--s-4);
    position: relative;
    overflow: clip;
  }
  .card.is-frosted {
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
  }
  /* Tone stripes are a 3px solid left border rendered via ::before so they
     don't shift content (padding stays constant across tones). */
  .card::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    border-top-left-radius: var(--r-3);
    border-bottom-left-radius: var(--r-3);
    background: transparent;
    z-index: 2;
  }
  .card.rail-none::before { background: transparent; }
  .card.rail-subtle::before { width: 2px; }
  .card.rail-strong::before { width: 4px; }
  .card.rail-neutral::before { background: color-mix(in srgb, var(--glass-border-strong) 72%, var(--border)); }
  .card.rail-warn::before { background: var(--stripe-warn); }
  .card.rail-danger::before { background: var(--stripe-danger); }
  .card.rail-ok::before { background: var(--stripe-ok); }
  .card.rail-accent::before { background: var(--stripe-accent); }
  .card.tone-warn { --card-reflect: var(--glass-reflect-warn), var(--glass-reflect-violet); }
  .card.tone-danger {
    --card-reflect:
      radial-gradient(circle at 12% 16%, color-mix(in srgb, var(--danger) 15%, transparent), transparent 26%),
      var(--glass-reflect-violet);
  }
  .card.tone-ok { --card-reflect: var(--glass-reflect-mint), var(--glass-reflect-violet); }
  .card.tone-accent { --card-reflect: var(--glass-reflect-violet), var(--glass-reflect-mint); }
  .card.variant-callout {
    --card-border: color-mix(in srgb, var(--glass-border) 84%, var(--border));
    --card-shadow:
      0 12px 28px color-mix(in srgb, black 12%, transparent),
      0 1px 0 color-mix(in srgb, white 4%, transparent),
      var(--glass-etch);
    --card-reflect-opacity: 0.62;
  }
  .card.variant-callout.tone-warn {
    --card-border: color-mix(in srgb, var(--warn) 24%, var(--glass-border));
    --card-reflect:
      radial-gradient(circle at 12% 50%, color-mix(in srgb, var(--warn) 22%, transparent), transparent 22%),
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 26%),
      var(--glass-reflect-warn);
  }
  .card.variant-callout.tone-danger {
    --card-border: color-mix(in srgb, var(--danger) 26%, var(--glass-border));
    --card-reflect:
      radial-gradient(circle at 12% 48%, color-mix(in srgb, var(--danger) 18%, transparent), transparent 22%),
      radial-gradient(circle at 14% 16%, color-mix(in srgb, var(--danger) 15%, transparent), transparent 26%),
      var(--glass-reflect-violet);
  }
  .card.variant-callout.tone-accent {
    --card-border: color-mix(in srgb, var(--accent) 22%, var(--glass-border));
    --card-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 26%),
      radial-gradient(circle at 18% 84%, color-mix(in srgb, var(--accent-2) 7%, transparent), transparent 30%),
      var(--glass-reflect-violet);
  }
  .card.variant-callout.tone-ok {
    --card-border: color-mix(in srgb, var(--ok) 22%, var(--glass-border));
    --card-reflect:
      radial-gradient(circle at 84% 18%, color-mix(in srgb, var(--ok) 10%, transparent), transparent 24%),
      var(--glass-reflect-mint);
  }
  .card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--card-reflect);
    opacity: var(--card-reflect-opacity);
    pointer-events: none;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
    position: relative;
    z-index: 1;
  }
  .card-body {
    position: relative;
    z-index: 1;
  }
</style>
