<script lang="ts">
  import type { Snippet } from 'svelte'
  import AppShell from './AppShell.svelte'

  interface Props {
    uninitialized?: boolean
    pageMode?: 'document' | 'surface-fill'
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
    uninitialized = false,
    pageMode = 'document',
    railCollapsed = false,
    railPreviewOpen = false,
    mobileRailMode = false,
    railOverlayOpen = false,
    rail: railContent,
    topbar: topbarContent,
    band: bandContent,
    footer: footerContent,
    children,
  }: Props = $props()
</script>

<AppShell
  shellClass={`project-shell ${uninitialized ? 'project-shell--uninitialized' : ''}`}
  railClass="rail"
  mainClass="main"
  topbarClass={`shell-topbar ${uninitialized ? 'shell-topbar--uninitialized' : ''}`}
  bandClass="band"
  pageClass={`page ${pageMode === 'surface-fill' ? 'page--surface-fill' : ''}`.trim()}
  {railCollapsed}
  {railPreviewOpen}
  {mobileRailMode}
  {railOverlayOpen}
>
  {#snippet rail()}
    {@render railContent?.()}
  {/snippet}
  {#snippet topbar()}
    {@render topbarContent?.()}
  {/snippet}
  {#snippet band()}
    {@render bandContent?.()}
  {/snippet}
  {#snippet footer()}
    {@render footerContent?.()}
  {/snippet}
  {@render children?.()}
</AppShell>
