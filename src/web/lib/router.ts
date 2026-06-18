import type { ProjectView as Tab } from './types.js'

export type Route =
  | { kind: 'projects' }
  | { kind: 'fleet-inbox' }
  | { kind: 'project'; projectId: string | null; view: Tab; sub: string | null; drawerTaskId: string | null; backgroundPath: string | null }
  | { kind: 'setup'; projectId: string | null }
  | { kind: 'providers' }

export function parseRoute(p: string, state: unknown = null): Route {
  const pathname = p.split(/[?#]/, 1)[0] || '/'
  p = pathname
  if (p === '/' || p === '/projects' || p === '/overview') return { kind: 'projects' }
  if (p === '/inbox' || p === '/needs-you' || p === '/notifications') return { kind: 'fleet-inbox' }
  if (p === '/setup') return { kind: 'projects' }
  const projectSetupMatch = /^\/projects\/([^/]+)\/setup$/.exec(p)
  if (projectSetupMatch) return { kind: 'setup', projectId: decodeURIComponent(projectSetupMatch[1] ?? '') }
  if (p === '/providers') return { kind: 'providers' }
  const projectTaskMatch = /^\/projects\/([^/]+)\/task\/(.+)$/.exec(p)
  if (projectTaskMatch) {
    const projectId = decodeURIComponent(projectTaskMatch[1] ?? '')
    const backgroundPath =
      state && typeof state === 'object' && typeof (state as { backgroundPath?: unknown }).backgroundPath === 'string'
        ? ((state as { backgroundPath: string }).backgroundPath)
        : `/projects/${encodeURIComponent(projectId)}/overview`
    const backgroundRoute = parseRoute(backgroundPath)
    if (backgroundRoute.kind === 'project') {
      return {
        kind: 'project',
        projectId,
        view: backgroundRoute.view,
        sub: backgroundRoute.sub,
        drawerTaskId: decodeURIComponent(projectTaskMatch[2] ?? ''),
        backgroundPath,
      }
    }
    return {
      kind: 'project',
      projectId,
      view: 'overview',
      sub: null,
      drawerTaskId: decodeURIComponent(projectTaskMatch[2] ?? ''),
      backgroundPath,
    }
  }
  const taskMatch = /^\/task\/(.+)$/.exec(p)
  if (taskMatch) {
    const backgroundPath =
      state && typeof state === 'object' && typeof (state as { backgroundPath?: unknown }).backgroundPath === 'string'
        ? ((state as { backgroundPath: string }).backgroundPath)
        : '/projects'
    const backgroundRoute = parseRoute(backgroundPath)
    if (backgroundRoute.kind === 'project') {
      return {
        kind: 'project',
        projectId: backgroundRoute.projectId,
        view: backgroundRoute.view,
        sub: backgroundRoute.sub,
        drawerTaskId: decodeURIComponent(taskMatch[1] ?? ''),
        backgroundPath,
      }
    }
    return { kind: 'projects' }
  }
  const projectMatch = /^\/projects\/([^/]+)(?:\/(.*))?$/.exec(p)
  if (projectMatch) {
    const projectId = decodeURIComponent(projectMatch[1] ?? '')
    const suffix = projectMatch[2] ? `/${projectMatch[2]}` : '/overview'
    const normalized = suffix
    if (normalized === '/overview')
      return { kind: 'project', projectId, view: 'overview', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/overview/inbox')
      return { kind: 'project', projectId, view: 'overview', sub: 'inbox', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/thread')
      return { kind: 'project', projectId, view: 'thread', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/inbox' || normalized === '/needs-you' || normalized === '/notifications')
      return { kind: 'project', projectId, view: 'overview', sub: 'inbox', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/work')
      return { kind: 'project', projectId, view: 'work', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/work/board')
      return { kind: 'project', projectId, view: 'planner', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/workspace-import')
      return { kind: 'project', projectId, view: 'workspace-import', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/structure')
      return { kind: 'project', projectId, view: 'structure', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/map')
      return { kind: 'project', projectId, view: 'map', sub: null, drawerTaskId: null, backgroundPath: null }
    const settingsSub = /^\/settings\/(.+)$/.exec(normalized)
    if (settingsSub)
      return { kind: 'project', projectId, view: 'settings', sub: settingsSub[1] ?? '', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/settings')
      return { kind: 'project', projectId, view: 'settings', sub: null, drawerTaskId: null, backgroundPath: null }
    const releaseSub = /^\/release\/(.+)$/.exec(normalized)
    if (releaseSub)
      return { kind: 'project', projectId, view: 'release', sub: releaseSub[1] ?? '', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/release')
      return { kind: 'project', projectId, view: 'release', sub: null, drawerTaskId: null, backgroundPath: null }
    const routingSub = /^\/routing\/(.+)$/.exec(normalized)
    if (routingSub)
      return { kind: 'project', projectId, view: 'settings', sub: 'coordinators', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/routing')
      return { kind: 'project', projectId, view: 'settings', sub: 'coordinators', drawerTaskId: null, backgroundPath: null }
    const coordSub = /^\/coordinators\/(.+)$/.exec(normalized)
    if (coordSub)
      return { kind: 'project', projectId, view: 'settings', sub: 'coordinators', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/coordinators')
      return { kind: 'project', projectId, view: 'settings', sub: 'coordinators', drawerTaskId: null, backgroundPath: null }
    if (normalized === '/planner') return { kind: 'project', projectId, view: 'planner', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/facts') return { kind: 'project', projectId, view: 'facts', sub: null, drawerTaskId: null, backgroundPath: null }
    if (normalized === '/timeline') return { kind: 'project', projectId, view: 'timeline', sub: null, drawerTaskId: null, backgroundPath: null }
    return { kind: 'project', projectId, view: 'overview', sub: null, drawerTaskId: null, backgroundPath: null }
  }
  return { kind: 'projects' }
}
