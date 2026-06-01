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
    mobileRailMode?: boolean
    railOverlayOpen?: boolean
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
    mobileRailMode = false,
    railOverlayOpen = false,
    rail,
    topbar,
    band,
    footer,
    children,
  }: Props = $props()

</script>

<div class={`app-shell ${railCollapsed ? 'rail-collapsed' : ''} ${railPreviewOpen ? 'rail-preview-open' : ''} ${mobileRailMode ? 'mobile-rail-mode' : ''} ${railOverlayOpen ? 'rail-overlay-open' : ''} ${shellClass}`.trim()}>
  <aside class={`app-shell-rail ${railClass}`.trim()} aria-hidden={mobileRailMode && !railOverlayOpen}>
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
  .app-shell.mobile-rail-mode,
  .app-shell.mobile-rail-mode.rail-collapsed,
  .app-shell.mobile-rail-mode.rail-preview-open {
    grid-template-columns: minmax(0, 1fr);
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
  .app-shell.mobile-rail-mode .app-shell-rail {
    display: none;
    width: 0;
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
  .app-shell.mobile-rail-mode .app-shell-main {
    grid-column: 1;
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
    --app-shell-page-padding-block-start: var(--s-5);
    min-width: 0;
    min-height: 0;
    width: min(100%, 1400px);
    margin: 0 auto;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: auto;
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
    padding: var(--s-5) var(--s-5) var(--s-6);
    box-sizing: border-box;
  }
  .app-shell-page.page--surface-fill {
    width: 100%;
    max-width: none;
    margin: 0;
    display: grid;
    grid-template-rows: minmax(0, 1fr);
    align-items: stretch;
    gap: 0;
    padding: 0;
    overflow: hidden;
    --app-shell-page-padding-block-start: 0px;
  }
  .app-shell-footer {
    min-width: 0;
    min-height: 0;
    z-index: var(--z-sticky-local);
  }
  @media (max-width: 920px) {
    .app-shell,
    .app-shell.rail-collapsed,
    .app-shell.rail-preview-open {
      grid-template-columns: minmax(0, 1fr);
    }
    .app-shell-rail {
      display: none;
      width: 0;
    }
    .app-shell.rail-overlay-open .app-shell-rail {
      display: block;
      position: fixed;
      inset: 0;
      width: 100vw;
      z-index: calc(var(--z-drawer) + 1);
      pointer-events: none;
    }
    .app-shell.rail-overlay-open .app-shell-rail :global(*) {
      pointer-events: auto;
    }
    .app-shell-main {
      grid-column: 1;
    }
    .app-shell-page {
      --app-shell-page-padding-block-start: var(--s-4);
      gap: var(--s-4);
      padding: var(--s-4);
    }
    .app-shell-page.page--surface-fill { padding: 0; }
  }
  @media (max-width: 520px) {
    .app-shell-page {
      --app-shell-page-padding-block-start: var(--s-3);
      gap: var(--s-3);
      padding: var(--s-3) var(--s-2) var(--s-4);
    }
    .app-shell-page.page--surface-fill { padding: 0; }
  }
</style>
