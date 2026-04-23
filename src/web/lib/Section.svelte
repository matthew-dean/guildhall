<!--
  Page-level section. Exactly one <h2> per top-level section.
  Prefer Section over hand-written section/h2 pairs so type rhythm stays consistent.
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    children?: Snippet
    actions?: Snippet
  }

  let { title, children, actions }: Props = $props()
</script>

<section class="section">
  <header class="section-head">
    <h2>{title}</h2>
    {#if actions}
      <div class="section-actions">{@render actions()}</div>
    {/if}
  </header>
  {@render children?.()}
</section>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
    margin-top: var(--s-5);
  }
  .section:first-child {
    margin-top: 0;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--s-3);
  }
  .section-actions {
    display: flex;
    gap: var(--s-2);
  }
</style>
