<!--
  Root Svelte component. Owns the outer shell (Header + Router) and the
  imperative bridge that lets legacy inline JS open the drawer during the
  incremental port.
-->
<script lang="ts">
  import Header from './surfaces/Header.svelte'
  import Router from './Router.svelte'
  import StaleServerBanner from './lib/StaleServerBanner.svelte'
  import { nav } from './lib/nav.svelte.js'
  import { currentTaskHref, withCurrentProjectQuery } from './lib/project-routes.js'

  // Expose a tiny imperative bridge so any remaining legacy inline JS can
  // still open a task drawer. Once the whole UI is ported we can drop it.
  $effect(() => {
    ;(window as unknown as { __guildhall?: { openTask: (id: string) => void } }).__guildhall = {
      openTask: (id: string) => nav(currentTaskHref(id)),
    }
  })

  // Project-scoped APIs should never guess from ambient daemon state. Keep
  // requests anchored to the current route's project id unless the caller
  // already specified one explicitly.
  $effect(() => {
    const originalFetch = window.fetch.bind(window)
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string') return originalFetch(withCurrentProjectQuery(input), init)
      if (input instanceof URL) return originalFetch(new URL(withCurrentProjectQuery(input.toString()), window.location.origin), init)
      if (input instanceof Request) {
        const nextUrl = withCurrentProjectQuery(input.url)
        if (nextUrl !== input.url) return originalFetch(new Request(nextUrl, input), init)
      }
      return originalFetch(input, init)
    }) as typeof window.fetch
    return () => {
      window.fetch = originalFetch
    }
  })
</script>

<div class="app-shell">
  <StaleServerBanner />
  <Header />
  <main class="app-main">
    <div class="app-router">
      <Router />
    </div>
  </main>
</div>

<style>
  .app-shell {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .app-main {
    position: relative;
    z-index: var(--z-drawer);
    flex: 1 1 auto;
    block-size: 0;
    min-height: 0;
    overflow: hidden;
  }
  .app-router {
    block-size: 100%;
    min-height: 0;
    overflow: hidden;
  }
</style>
