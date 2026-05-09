<script lang="ts">
  import type { Snippet } from 'svelte'
  import AppShell from './AppShell.svelte'

  interface Props {
    uninitialized?: boolean
    rail?: Snippet
    topbar?: Snippet
    children?: Snippet
  }

  let { uninitialized = false, rail: railContent, topbar: topbarContent, children }: Props = $props()
</script>

<AppShell
  shellClass={`project-shell ${uninitialized ? 'project-shell--uninitialized' : ''}`}
  railClass="rail"
  mainClass="main"
  topbarClass={`topbar ${uninitialized ? 'topbar--uninitialized' : ''}`}
  pageClass="page"
>
  {#snippet rail()}
    {@render railContent?.()}
  {/snippet}
  {#snippet topbar()}
    {@render topbarContent?.()}
  {/snippet}
  {@render children?.()}
</AppShell>
