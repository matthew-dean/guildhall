<!--
  Top-level client-router. Decodes location.pathname into a surface +
  parameters and renders the matching Svelte component.
-->
<script lang="ts">
  import ToastHost from './lib/ToastHost.svelte'
  import { path, nav } from './lib/nav.svelte.js'
  import { connectStream, disconnectStream } from './lib/events.js'
  import { parseRoute } from './lib/router.js'
  import { currentProjectHref } from './lib/project-routes.js'

  type LazyComponent = any

  let ProjectsHome = $state<LazyComponent | null>(null)
  let FleetNeedsYou = $state<LazyComponent | null>(null)
  let ProjectView = $state<LazyComponent | null>(null)
  let TaskDrawer = $state<LazyComponent | null>(null)
  let SetupWizard = $state<LazyComponent | null>(null)
  let ProvidersPage = $state<LazyComponent | null>(null)

  const route = $derived(parseRoute(path.value, path.state))

  // A single SSE connection for the lifetime of the Svelte app. Subscribers
  // register via onEvent() / onStatus().
  $effect(() => {
    path.value
    disconnectStream()
    const handle = setTimeout(() => connectStream(), 750)
    return () => clearTimeout(handle)
  })

  function closeDrawer() {
    if (route.kind === 'project' && route.drawerTaskId) {
      nav(route.backgroundPath ?? currentProjectHref('/thread', route.projectId))
    }
  }

  async function loadRouteSurface(kind: typeof route.kind, hasDrawer: boolean): Promise<void> {
    if (kind === 'projects' && !ProjectsHome) ProjectsHome = (await import('./surfaces/ProjectsHome.svelte')).default
    if (kind === 'fleet-inbox' && !FleetNeedsYou) FleetNeedsYou = (await import('./surfaces/FleetNeedsYou.svelte')).default
    if (kind === 'project' && !ProjectView) ProjectView = (await import('./surfaces/ProjectView.svelte')).default
    if (kind === 'project' && hasDrawer && !TaskDrawer) TaskDrawer = (await import('./surfaces/TaskDrawer.svelte')).default
    if (kind === 'setup' && !SetupWizard) SetupWizard = (await import('./surfaces/SetupWizard.svelte')).default
    if (kind === 'providers' && !ProvidersPage) ProvidersPage = (await import('./surfaces/ProvidersPage.svelte')).default
  }

  $effect(() => {
    void loadRouteSurface(route.kind, route.kind === 'project' && Boolean(route.drawerTaskId))
  })
</script>

<ToastHost />

{#if route.kind === 'projects'}
  {#if ProjectsHome}<ProjectsHome />{/if}
{:else if route.kind === 'fleet-inbox'}
  {#if FleetNeedsYou}<FleetNeedsYou />{/if}
{:else if route.kind === 'project'}
  {#if ProjectView}<ProjectView initialView={route.view} initialSub={route.sub} projectId={route.projectId} />{/if}
  {#if route.drawerTaskId && TaskDrawer}
    <TaskDrawer taskId={route.drawerTaskId} projectId={route.projectId} onClose={closeDrawer} />
  {/if}
{:else if route.kind === 'setup'}
  <div class="route-document-scroll">
    {#if SetupWizard}<SetupWizard projectId={route.projectId} />{/if}
  </div>
{:else if route.kind === 'providers'}
  <div class="route-document-scroll">
    {#if ProvidersPage}<ProvidersPage />{/if}
  </div>
{/if}

<style>
  .route-document-scroll {
    block-size: 100%;
    min-block-size: 0;
    overflow-y: auto;
    overflow-x: hidden;
    overflow-anchor: auto;
  }
</style>
