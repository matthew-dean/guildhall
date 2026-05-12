<!--
  Top-level client-router. Decodes location.pathname into a surface +
  parameters and renders the matching Svelte component.
-->
<script lang="ts">
  import ProjectsHome from './surfaces/ProjectsHome.svelte'
  import ProjectView from './surfaces/ProjectView.svelte'
  import TaskDrawer from './surfaces/TaskDrawer.svelte'
  import SetupWizard from './surfaces/SetupWizard.svelte'
  import ProvidersPage from './surfaces/ProvidersPage.svelte'
  import { Toaster } from 'svelte-sonner'
  import { path, nav } from './lib/nav.svelte.js'
  import { connectStream } from './lib/events.js'
  import { currentProjectHref } from './lib/project-routes.js'
  import type { ProjectView as Tab } from './lib/types.js'

  type Route =
    | { kind: 'projects' }
    | { kind: 'project'; projectId: string | null; view: Tab; sub: string | null; drawerTaskId: string | null; backgroundPath: string | null }
    | { kind: 'setup'; projectId: string | null }
    | { kind: 'providers' }

  function parse(p: string, state: unknown = null): Route {
    if (p === '/' || p === '/projects') return { kind: 'projects' }
    if (p === '/setup') return { kind: 'setup', projectId: null }
    const projectSetupMatch = /^\/projects\/([^/]+)\/setup$/.exec(p)
    if (projectSetupMatch) return { kind: 'setup', projectId: decodeURIComponent(projectSetupMatch[1] ?? '') }
    if (p === '/providers') return { kind: 'providers' }
    const projectTaskMatch = /^\/projects\/([^/]+)\/task\/(.+)$/.exec(p)
    if (projectTaskMatch) {
      const projectId = decodeURIComponent(projectTaskMatch[1] ?? '')
      const backgroundPath =
        state && typeof state === 'object' && typeof (state as { backgroundPath?: unknown }).backgroundPath === 'string'
          ? ((state as { backgroundPath: string }).backgroundPath)
          : `/projects/${encodeURIComponent(projectId)}/thread`
      const backgroundRoute = parse(backgroundPath)
      if (backgroundRoute.kind === 'project') {
        return {
          kind: 'project',
          projectId,
          view: backgroundRoute.view,
          sub: backgroundRoute.sub,
          drawerTaskId: decodeURIComponent(projectTaskMatch[2]),
          backgroundPath,
        }
      }
      return {
        kind: 'project',
        projectId,
        view: 'thread',
        sub: null,
        drawerTaskId: decodeURIComponent(projectTaskMatch[2]),
        backgroundPath,
      }
    }
    const taskMatch = /^\/task\/(.+)$/.exec(p)
    if (taskMatch) {
      const backgroundPath =
        state && typeof state === 'object' && typeof (state as { backgroundPath?: unknown }).backgroundPath === 'string'
          ? ((state as { backgroundPath: string }).backgroundPath)
          : '/project/thread'
      const backgroundRoute = parse(backgroundPath)
      if (backgroundRoute.kind === 'project') {
        return {
          kind: 'project',
          projectId: backgroundRoute.projectId,
          view: backgroundRoute.view,
          sub: backgroundRoute.sub,
          drawerTaskId: decodeURIComponent(taskMatch[1]),
          backgroundPath,
        }
      }
      return {
        kind: 'project',
        projectId: null,
        view: 'thread',
        sub: null,
        drawerTaskId: decodeURIComponent(taskMatch[1]),
        backgroundPath,
      }
    }
    const projectMatch = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(p)
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1] ?? '')
      const suffix = projectMatch[2] ? `/${projectMatch[2]}` : '/thread'
      const normalized = suffix
      if (normalized === '/thread')
        return { kind: 'project', projectId, view: 'thread', sub: null, drawerTaskId: null, backgroundPath: null }
      if (normalized === '/inbox' || normalized === '/notifications')
        return { kind: 'project', projectId, view: 'inbox', sub: null, drawerTaskId: null, backgroundPath: null }
      if (normalized === '/work')
        return { kind: 'project', projectId, view: 'work', sub: null, drawerTaskId: null, backgroundPath: null }
      if (normalized === '/workspace-import')
        return { kind: 'project', projectId, view: 'workspace-import', sub: null, drawerTaskId: null, backgroundPath: null }
      const settingsSub = /^\/settings\/(.+)$/.exec(normalized)
      if (settingsSub)
        return { kind: 'project', projectId, view: 'settings', sub: settingsSub[1], drawerTaskId: null, backgroundPath: null }
      if (normalized === '/settings')
        return { kind: 'project', projectId, view: 'settings', sub: null, drawerTaskId: null, backgroundPath: null }
      const releaseSub = /^\/release\/(.+)$/.exec(normalized)
      if (releaseSub)
        return { kind: 'project', projectId, view: 'release', sub: releaseSub[1], drawerTaskId: null, backgroundPath: null }
      if (normalized === '/release')
        return { kind: 'project', projectId, view: 'release', sub: null, drawerTaskId: null, backgroundPath: null }
      const routingSub = /^\/routing\/(.+)$/.exec(normalized)
      if (routingSub)
        return { kind: 'project', projectId, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
      if (normalized === '/routing')
        return { kind: 'project', projectId, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
      const coordSub = /^\/coordinators\/(.+)$/.exec(normalized)
      if (coordSub)
        return { kind: 'project', projectId, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
      if (normalized === '/coordinators')
        return { kind: 'project', projectId, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
      if (normalized === '/planner') return { kind: 'project', projectId, view: 'planner', sub: null, drawerTaskId: null, backgroundPath: null }
      if (normalized === '/facts') return { kind: 'project', projectId, view: 'facts', sub: null, drawerTaskId: null, backgroundPath: null }
      if (normalized === '/timeline') return { kind: 'project', projectId, view: 'timeline', sub: null, drawerTaskId: null, backgroundPath: null }
      return { kind: 'project', projectId, view: 'thread', sub: null, drawerTaskId: null, backgroundPath: null }
    }
    const projectPath = p === '/project' ? '/project/thread' : p
    const normalized = projectPath.startsWith('/project/')
      ? projectPath.slice('/project'.length)
      : projectPath
    if (normalized === '/thread')
      return { kind: 'project', projectId: null, view: 'thread', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/inbox' || normalized === '/notifications')
      return { kind: 'project', projectId: null, view: 'inbox', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/work')
      return { kind: 'project', projectId: null, view: 'work', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/workspace-import')
      return { kind: 'project', projectId: null, view: 'workspace-import', sub: null, drawerTaskId: null, backgroundPath: null }
    const settingsSub = /^\/settings\/(.+)$/.exec(normalized)
    if (settingsSub)
      return { kind: 'project', projectId: null, view: 'settings', sub: settingsSub[1], drawerTaskId: null, backgroundPath: null }
    if (normalized === '/settings')
      return { kind: 'project', projectId: null, view: 'settings', sub: null, drawerTaskId: null, backgroundPath: null }
    const releaseSub = /^\/release\/(.+)$/.exec(normalized)
    if (releaseSub)
      return { kind: 'project', projectId: null, view: 'release', sub: releaseSub[1], drawerTaskId: null, backgroundPath: null }
    if (normalized === '/release')
      return { kind: 'project', projectId: null, view: 'release', sub: null, drawerTaskId: null, backgroundPath: null }
    const routingSub = /^\/routing\/(.+)$/.exec(normalized)
    if (routingSub)
      return { kind: 'project', projectId: null, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/routing')
      return { kind: 'project', projectId: null, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
    const coordSub = /^\/coordinators\/(.+)$/.exec(normalized)
    if (coordSub)
      return { kind: 'project', projectId: null, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/coordinators')
      return { kind: 'project', projectId: null, view: 'settings', sub: 'routing', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/planner') return { kind: 'project', projectId: null, view: 'planner', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/facts') return { kind: 'project', projectId: null, view: 'facts', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/timeline') return { kind: 'project', projectId: null, view: 'timeline', sub: null, drawerTaskId: null, backgroundPath: null }
    return { kind: 'project', projectId: null, view: 'thread', sub: null, drawerTaskId: null, backgroundPath: null }
  }

  const route = $derived(parse(path.value, path.state))

  // A single SSE connection for the lifetime of the Svelte app. Subscribers
  // register via onEvent() / onStatus().
  $effect(() => {
    path.value
    connectStream()
  })

  function closeDrawer() {
    if (route.kind === 'project' && route.drawerTaskId) {
      nav(route.backgroundPath ?? (route.projectId ? currentProjectHref('/thread') : '/project/thread'))
    }
  }
</script>

<Toaster theme="dark" position="bottom-right" richColors closeButton />

{#if route.kind === 'projects'}
  <ProjectsHome />
{:else if route.kind === 'project'}
  <ProjectView initialView={route.view} initialSub={route.sub} projectId={route.projectId} />
  {#if route.drawerTaskId}
    <TaskDrawer taskId={route.drawerTaskId} projectId={route.projectId} onClose={closeDrawer} />
  {/if}
{:else if route.kind === 'setup'}
  <SetupWizard projectId={route.projectId} />
{:else if route.kind === 'providers'}
  <ProvidersPage />
{/if}
