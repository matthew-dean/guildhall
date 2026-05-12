import { path } from './nav.svelte.js'

export interface ParsedProjectRoute {
  projectId: string | null
  projectScoped: boolean
}

export function parseProjectRoute(pathname: string): ParsedProjectRoute {
  const taskMatch = /^\/projects\/([^/]+)\/task\/[^/]+$/.exec(pathname)
  if (taskMatch) return { projectId: decodeURIComponent(taskMatch[1] ?? ''), projectScoped: true }
  const projectMatch = /^\/projects\/([^/]+)(?:\/.*)?$/.exec(pathname)
  if (projectMatch) return { projectId: decodeURIComponent(projectMatch[1] ?? ''), projectScoped: true }
  return { projectId: null, projectScoped: false }
}

export function currentProjectId(): string | null {
  return parseProjectRoute(path.value).projectId
}

export function projectHref(projectId: string, suffix = '/thread'): string {
  const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`
  return normalized === '/' || normalized === ''
    ? `/projects/${encodeURIComponent(projectId)}`
    : `/projects/${encodeURIComponent(projectId)}${normalized}`
}

export function projectTaskHref(projectId: string, taskId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`
}

export function currentProjectHref(suffix = '/thread'): string {
  const projectId = currentProjectId()
  if (!projectId) {
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`
    if (normalized === '' || normalized === '/') return '/project'
    return normalized === '/thread' ? '/project/thread' : `/project${normalized}`
  }
  return projectHref(projectId, suffix)
}

export function currentTaskHref(taskId: string): string {
  const projectId = currentProjectId()
  if (!projectId) return `/task/${encodeURIComponent(taskId)}`
  return projectTaskHref(projectId, taskId)
}

export function withCurrentProjectQuery(href: string): string {
  const projectId = currentProjectId()
  if (!projectId) return href
  let url: URL
  try {
    url = new URL(href, window.location.origin)
  } catch {
    return href
  }
  if (url.origin !== window.location.origin) return href
  const projectScoped =
    url.pathname === '/api/project' ||
    url.pathname.startsWith('/api/project/') ||
    url.pathname === '/api/config' ||
    url.pathname.startsWith('/api/config/') ||
    url.pathname === '/api/setup' ||
    url.pathname.startsWith('/api/setup/')
  if (!projectScoped) return href
  if (!url.searchParams.has('projectId')) url.searchParams.set('projectId', projectId)
  return `${url.pathname}${url.search}${url.hash}`
}

export function projectFetch(input: string, init?: RequestInit): Promise<Response> {
  return fetch(withCurrentProjectQuery(input), init)
}
