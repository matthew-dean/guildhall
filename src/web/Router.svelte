<!--
  Top-level client-router. Decodes location.pathname into a surface +
  parameters and renders the matching Svelte component.
-->
<script lang="ts">
  import ProjectView from './surfaces/ProjectView.svelte'
  import TaskDrawer from './surfaces/TaskDrawer.svelte'
  import SetupWizard from './surfaces/SetupWizard.svelte'
  import ProvidersPage from './surfaces/ProvidersPage.svelte'
  import { path, nav } from './lib/nav.svelte.js'
  import { connectStream } from './lib/events.js'
  import type { ProjectView as Tab } from './lib/types.js'

  type Route =
    | { kind: 'project'; view: Tab; drawerTaskId: string | null }
    | { kind: 'setup' }
    | { kind: 'providers' }

  function parse(p: string): Route {
    if (p === '/setup') return { kind: 'setup' }
    if (p === '/providers') return { kind: 'providers' }
    const taskMatch = /^\/task\/(.+)$/.exec(p)
    if (taskMatch) {
      return { kind: 'project', view: 'work', drawerTaskId: decodeURIComponent(taskMatch[1]) }
    }
    if (p === '/settings') return { kind: 'project', view: 'settings', drawerTaskId: null }
    if (p === '/release') return { kind: 'project', view: 'release', drawerTaskId: null }
    return { kind: 'project', view: 'work', drawerTaskId: null }
  }

  const route = $derived(parse(path.value))

  // A single SSE connection for the lifetime of the Svelte app. Subscribers
  // register via onEvent() / onStatus().
  $effect(() => {
    connectStream()
  })

  function closeDrawer() {
    // Preserve the current tab — Task drawer is modal, not a route leaf.
    if (path.value.startsWith('/task/')) nav('/')
  }
</script>

{#if route.kind === 'project'}
  <ProjectView initialView={route.view} />
  {#if route.drawerTaskId}
    <TaskDrawer taskId={route.drawerTaskId} onClose={closeDrawer} />
  {/if}
{:else if route.kind === 'setup'}
  <SetupWizard />
{:else if route.kind === 'providers'}
  <ProvidersPage />
{/if}
