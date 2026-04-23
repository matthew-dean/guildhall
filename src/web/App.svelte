<!--
  Root Svelte component. Owns the outer shell (Header + Router) and the
  imperative bridge that lets legacy inline JS open the drawer during the
  incremental port.
-->
<script lang="ts">
  import Header from './surfaces/Header.svelte'
  import Router from './Router.svelte'
  import { nav } from './lib/nav.svelte.js'

  // Expose a tiny imperative bridge so any remaining legacy inline JS can
  // still open a task drawer. Once the whole UI is ported we can drop it.
  $effect(() => {
    ;(window as unknown as { __guildhall?: { openTask: (id: string) => void } }).__guildhall = {
      openTask: (id: string) => nav('/task/' + encodeURIComponent(id)),
    }
  })
</script>

<Header />
<main class="app-main">
  <Router />
</main>

<style>
  .app-main {
    display: block;
  }
</style>
