<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    shellClass?: string
    railClass?: string
    mainClass?: string
    topbarClass?: string
    bandClass?: string
    pageClass?: string
    railCollapsed?: boolean
    railPreviewOpen?: boolean
    rail?: Snippet
    topbar?: Snippet
    band?: Snippet
    footer?: Snippet
    children?: Snippet
  }

  let {
    shellClass = '',
    railClass = '',
    mainClass = '',
    topbarClass = '',
    bandClass = '',
    pageClass = '',
    railCollapsed = false,
    railPreviewOpen = false,
    rail,
    topbar,
    band,
    footer,
    children,
  }: Props = $props()

</script>

<div class={`app-shell ${railCollapsed ? 'rail-collapsed' : ''} ${railPreviewOpen ? 'rail-preview-open' : ''} ${shellClass}`.trim()}>
  <aside class={`app-shell-rail ${railClass}`.trim()}>
    {@render rail?.()}
  </aside>
  <div class={`app-shell-main ${mainClass}`.trim()}>
    <div class={`app-shell-topbar ${topbarClass}`.trim()}>
      {@render topbar?.()}
    </div>
    {#if band}
      <div class={`app-shell-band ${bandClass}`.trim()}>
        {@render band?.()}
      </div>
    {/if}
    <div class={`app-shell-page ${pageClass}`.trim()}>
      {@render children?.()}
    </div>
    {#if footer}
      <div class="app-shell-footer">
        {@render footer?.()}
      </div>
    {/if}
  </div>
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    block-size: 100%;
    min-block-size: 100%;
    align-items: stretch;
    overflow: hidden;
  }
  .app-shell.rail-collapsed {
    grid-template-columns: 56px minmax(0, 1fr);
  }
  .app-shell-rail {
    min-width: 0;
    width: 240px;
    block-size: 100%;
    min-block-size: 0;
    align-self: stretch;
    overflow: visible;
    z-index: calc(var(--z-drawer) + 1);
  }
  .app-shell.rail-collapsed .app-shell-rail {
    width: 56px;
  }
  .app-shell.rail-preview-open .app-shell-rail {
    width: 240px;
  }
  .app-shell-main {
    min-width: 0;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    min-block-size: 0;
    block-size: 100%;
    align-self: stretch;
    position: relative;
    grid-column: 2;
    overflow: hidden;
  }
  .app-shell-topbar {
    min-width: 0;
    flex: 0 0 auto;
    z-index: var(--z-topbar);
  }
  .app-shell-band {
    min-width: 0;
    flex: 0 0 auto;
    position: relative;
    z-index: var(--z-sticky-local);
  }
  .app-shell-page {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 0 var(--s-5) var(--s-6);
    box-sizing: border-box;
  }
  .app-shell-footer {
    min-width: 0;
    min-height: 0;
    z-index: var(--z-sticky-local);
  }
  @media (max-width: 920px) {
    .app-shell {
      grid-template-columns: 56px minmax(0, 1fr);
    }
    .app-shell-rail {
      width: 56px;
    }
    .app-shell-page {
      padding: 0 var(--s-4) var(--s-4);
    }
  }
</style>
