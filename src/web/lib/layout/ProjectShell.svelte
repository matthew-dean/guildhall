<script lang="ts">
  import type { Snippet } from 'svelte'
  import AppShell from './AppShell.svelte'

  interface Props {
    uninitialized?: boolean
    railCollapsed?: boolean
    railPreviewOpen?: boolean
    rail?: Snippet
    topbar?: Snippet
    band?: Snippet
    children?: Snippet
  }

  let {
    uninitialized = false,
    railCollapsed = false,
    railPreviewOpen = false,
    rail: railContent,
    topbar: topbarContent,
    band: bandContent,
    children,
  }: Props = $props()
</script>

<AppShell
  shellClass={`project-shell ${uninitialized ? 'project-shell--uninitialized' : ''}`}
  railClass="rail"
  mainClass="main"
  topbarClass={`shell-topbar ${uninitialized ? 'shell-topbar--uninitialized' : ''}`}
  bandClass="band"
  pageClass="page"
  {railCollapsed}
  {railPreviewOpen}
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
  {@render children?.()}
</AppShell>
