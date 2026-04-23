<!--
  Card container. Surface with border + padding.
  Title is an <h3> by default; callers can opt into h2 for a page's top-level card.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  type Tone = 'default' | 'warn' | 'danger' | 'ok'

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
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--r-3);
    padding: var(--s-4);
  }
  /* Tone stripes use an inset shadow so they don't shift content inward
     the way a thicker border would (same padding/alignment across tones). */
  .card.tone-warn {
    box-shadow: inset 3px 0 0 var(--warn);
  }
  .card.tone-danger {
    box-shadow: inset 3px 0 0 var(--danger);
  }
  .card.tone-ok {
    box-shadow: inset 3px 0 0 var(--accent-2);
  }
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
