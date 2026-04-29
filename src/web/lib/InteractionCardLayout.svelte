<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    status?: Snippet | undefined
    meta?: Snippet | undefined
    live?: Snippet | undefined
    children?: Snippet | undefined
  }

  let { status, meta, live, children }: Props = $props()
</script>

<div class="interaction-card-layout">
  {#if status || meta}
    <header class="interaction-card-head">
      {#if meta}
        <div class="interaction-card-meta">{@render meta()}</div>
      {/if}
      {#if status}
        <div class="interaction-card-status">{@render status()}</div>
      {/if}
    </header>
  {/if}

  {#if live}
    <div class="interaction-card-live">{@render live()}</div>
  {/if}

  <div class="interaction-card-content">
    {@render children?.()}
  </div>
</div>

<style>
  .interaction-card-layout {
    display: grid;
    gap: var(--s-2);
  }
  .interaction-card-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: var(--s-2);
  }
  .interaction-card-status {
    display: inline-flex;
    align-items: center;
    justify-self: end;
    gap: var(--s-2);
    min-height: var(--control-h);
  }
  .interaction-card-meta {
    min-width: 0;
  }
  .interaction-card-live {
    min-width: 0;
  }
  .interaction-card-content {
    display: grid;
    gap: var(--s-2);
    min-width: 0;
  }
</style>
