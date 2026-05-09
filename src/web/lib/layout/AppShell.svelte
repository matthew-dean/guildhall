<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    shellClass?: string
    railClass?: string
    mainClass?: string
    topbarClass?: string
    pageClass?: string
    rail?: Snippet
    topbar?: Snippet
    children?: Snippet
  }

  let {
    shellClass = '',
    railClass = '',
    mainClass = '',
    topbarClass = '',
    pageClass = '',
    rail,
    topbar,
    children,
  }: Props = $props()
</script>

<div class={`app-shell ${shellClass}`.trim()}>
  <aside class={`app-shell-rail ${railClass}`.trim()}>
    {@render rail?.()}
  </aside>
  <div class={`app-shell-main ${mainClass}`.trim()}>
    <header class={`app-shell-topbar ${topbarClass}`.trim()}>
      {@render topbar?.()}
    </header>
    <div class={`app-shell-page ${pageClass}`.trim()}>
      {@render children?.()}
    </div>
  </div>
</div>

<style>
  .app-shell {
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr);
    min-height: 100%;
  }
  .app-shell-rail {
    min-width: 0;
  }
  .app-shell-main {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .app-shell-topbar {
    min-width: 0;
  }
  .app-shell-page {
    min-width: 0;
    flex: 1 1 auto;
  }
  @media (max-width: 1100px) {
    .app-shell {
      grid-template-columns: 56px minmax(0, 1fr);
    }
  }
</style>
