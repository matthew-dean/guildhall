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
  const routePath = path.value?.trim()
  if (routePath) {
    const parsed = parseProjectRoute(routePath)
    if (parsed.projectId) return parsed.projectId
  }
  if (typeof window !== 'undefined') {
    return parseProjectRoute(window.location.pathname).projectId
  }
  return null
}

function normalizedProjectId(projectId?: string | null): string | null {
  const normalized = projectId?.trim()
  return normalized ? normalized : null
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

export function currentProjectHref(suffix = '/thread', explicitProjectId?: string | null): string {
  const projectId = normalizedProjectId(explicitProjectId) ?? currentProjectId()
  if (!projectId) {
    const normalized = suffix.startsWith('/') ? suffix : `/${suffix}`
    if (normalized === '' || normalized === '/') return '/project'
    return normalized === '/thread' ? '/project/thread' : `/project${normalized}`
  }
  return projectHref(projectId, suffix)
}

export function currentTaskHref(taskId: string, explicitProjectId?: string | null): string {
  const projectId = normalizedProjectId(explicitProjectId) ?? currentProjectId()
  if (!projectId) return `/task/${encodeURIComponent(taskId)}`
  return projectTaskHref(projectId, taskId)
}

export function projectActionHref(href: string, explicitProjectId?: string | null): string {
  const projectId = normalizedProjectId(explicitProjectId) ?? currentProjectId()
  if (!projectId) return href
  let url: URL
  try {
    url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  } catch {
    return href
  }
  if (typeof window !== 'undefined' && url.origin !== window.location.origin) return href
  const suffix = `${url.pathname}${url.search}${url.hash}`
  if (url.pathname.startsWith('/projects/')) return suffix
  if (url.pathname === '/task' || url.pathname.startsWith('/task/')) {
    const taskId = url.pathname.slice('/task/'.length)
    return taskId ? `${projectTaskHref(projectId, decodeURIComponent(taskId))}${url.search}${url.hash}` : href
  }
  const projectSurface =
    url.pathname === '/thread' ||
    url.pathname === '/inbox' ||
    url.pathname === '/notifications' ||
    url.pathname === '/work' ||
    url.pathname === '/workspace-import' ||
    url.pathname === '/planner' ||
    url.pathname === '/facts' ||
    url.pathname === '/timeline' ||
    url.pathname === '/release' ||
    url.pathname.startsWith('/release/') ||
    url.pathname === '/settings' ||
    url.pathname.startsWith('/settings/') ||
    url.pathname === '/routing' ||
    url.pathname.startsWith('/routing/') ||
    url.pathname === '/coordinators' ||
    url.pathname.startsWith('/coordinators/')
  if (!projectSurface) return href
  return projectHref(projectId, suffix)
}

export function withCurrentProjectQuery(href: string): string {
  return withProjectQuery(href, currentProjectId())
}

export function withProjectQuery(href: string, projectId: string | null): string {
  const scopedProjectId = normalizedProjectId(projectId)
  if (!scopedProjectId) return href
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
  if (!url.searchParams.has('projectId')) url.searchParams.set('projectId', scopedProjectId)
  return `${url.pathname}${url.search}${url.hash}`
}

export function projectFetch(input: string, init?: RequestInit, explicitProjectId?: string | null): Promise<Response> {
  const callFetch = (href: string) => init === undefined ? fetch(href) : fetch(href, init)
  const projectId = normalizedProjectId(explicitProjectId) ?? currentProjectId()
  const href = projectId ? withProjectQuery(input, projectId) : withCurrentProjectQuery(input)
  if (!projectId || typeof input !== 'string') return callFetch(href)

  let url: URL
  try {
    url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  } catch {
    return callFetch(href)
  }

  const method = (init?.method ?? 'GET').toUpperCase()
  const projectScoped =
    url.pathname === '/api/project' ||
    url.pathname.startsWith('/api/project/') ||
    url.pathname === '/api/config' ||
    url.pathname.startsWith('/api/config/')
  const mutating = !['GET', 'HEAD'].includes(method)
  if (!projectScoped || !mutating) return callFetch(href)

  const headers = new Headers(init?.headers)
  const contentType = headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return callFetch(href)

  let bodyObject: Record<string, unknown> = {}
  if (typeof init?.body === 'string' && init.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(init.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        bodyObject = parsed as Record<string, unknown>
      } else {
        return callFetch(href)
      }
    } catch {
      return callFetch(href)
    }
  }
  if (typeof bodyObject.projectId !== 'string' || bodyObject.projectId.trim().length === 0) {
    bodyObject = { ...bodyObject, projectId }
  }

  return fetch(href, {
    ...init,
    headers,
    body: JSON.stringify(bodyObject),
  })
}
