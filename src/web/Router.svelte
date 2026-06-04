<!--
  Top-level client-router. Decodes location.pathname into a surface +
  parameters and renders the matching Svelte component.
-->
<script lang="ts">
  import ProjectsHome from './surfaces/ProjectsHome.svelte'
  import FleetNeedsYou from './surfaces/FleetNeedsYou.svelte'
  import ProjectView from './surfaces/ProjectView.svelte'
  import TaskDrawer from './surfaces/TaskDrawer.svelte'
  import SetupWizard from './surfaces/SetupWizard.svelte'
  import ProvidersPage from './surfaces/ProvidersPage.svelte'
  import ToastHost from './lib/ToastHost.svelte'
  import { path, nav } from './lib/nav.svelte.js'
  import { connectStream, disconnectStream } from './lib/events.js'
  import { parseRoute } from './lib/router.js'
  import { currentProjectHref } from './lib/project-routes.js'

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
</script>

<ToastHost />

{#if route.kind === 'projects'}
  <ProjectsHome />
{:else if route.kind === 'fleet-inbox'}
  <FleetNeedsYou />
{:else if route.kind === 'project'}
  <ProjectView initialView={route.view} initialSub={route.sub} projectId={route.projectId} />
  {#if route.drawerTaskId}
    <TaskDrawer taskId={route.drawerTaskId} projectId={route.projectId} onClose={closeDrawer} />
  {/if}
{:else if route.kind === 'setup'}
  <div class="route-document-scroll">
    <SetupWizard projectId={route.projectId} />
  </div>
{:else if route.kind === 'providers'}
  <div class="route-document-scroll">
    <ProvidersPage />
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
