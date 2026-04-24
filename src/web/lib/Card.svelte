<!--
  Card container. Surface with border + padding.
  Title is an <h3> by default; callers can opt into h2 for a page's top-level card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'default' | 'warn' | 'danger' | 'ok' | 'accent'

  interface Props {
    title?: string
    titleTag?: 'h2' | 'h3' | 'h4'
    tone?: Tone
    children?: Snippet
    actions?: Snippet
  }

  let {
    title,
    titleTag = 'h3',
    tone = 'default',
    children,
    actions,
  }: Props = $props()
</script>

<section class="card tone-{tone}">
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
        <div class="card-actions">{@render actions()}</div>
      {/if}
    </header>
  {/if}
  <div class="card-body">
    {@render children?.()}
  </div>
</section>

<style>
  .card {
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--r-3);
    padding: var(--s-4);
    position: relative;
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
  }
  .card.tone-warn::before { background: var(--stripe-warn); }
  .card.tone-danger::before { background: var(--stripe-danger); }
  .card.tone-ok::before { background: var(--stripe-ok); }
  .card.tone-accent::before { background: var(--stripe-accent); }
  .card-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--s-3);
    margin-bottom: var(--s-3);
  }
  .card-actions {
    display: flex;
    gap: var(--s-2);
  }
</style>
