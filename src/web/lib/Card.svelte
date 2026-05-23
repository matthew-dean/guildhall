<!--
  Card container. Surface with border + padding.
  Title is an <h3> by default; callers can opt into h2 for a page's top-level card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import ActionBar from './ActionBar.svelte'

  type Tone = 'default' | 'warn' | 'danger' | 'ok' | 'accent'

  interface Props {
    title?: string
    titleTag?: 'h2' | 'h3' | 'h4'
    tone?: Tone
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
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<section
  class={`card tone-${tone} ${frosted ? 'is-frosted' : ''} ${className}`.trim()}
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
    --card-reflect: var(--glass-reflect-violet), var(--glass-reflect-mint);
    background:
      linear-gradient(180deg, color-mix(in srgb, white 4%, transparent), color-mix(in srgb, white 1%, transparent)),
      var(--glass-bg);
    border: 1px solid var(--glass-border);
    border-radius: var(--r-3);
    box-shadow: var(--glass-shadow), var(--glass-etch);
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
    width: 3px;
    border-top-left-radius: var(--r-3);
    border-bottom-left-radius: var(--r-3);
    background: transparent;
    z-index: 2;
  }
  .card.tone-warn::before { background: var(--stripe-warn); }
  .card.tone-danger::before { background: var(--stripe-danger); }
  .card.tone-ok::before { background: var(--stripe-ok); }
  .card.tone-accent::before { background: var(--stripe-accent); }
  .card.tone-warn { --card-reflect: var(--glass-reflect-warn), var(--glass-reflect-violet); }
  .card.tone-danger {
    --card-reflect:
      radial-gradient(circle at 12% 16%, color-mix(in srgb, var(--danger) 15%, transparent), transparent 26%),
      var(--glass-reflect-violet);
  }
  .card.tone-ok { --card-reflect: var(--glass-reflect-mint), var(--glass-reflect-violet); }
  .card.tone-accent { --card-reflect: var(--glass-reflect-violet), var(--glass-reflect-mint); }
  .card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--card-reflect);
    opacity: 0.48;
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
