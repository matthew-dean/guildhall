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
  const href = withCurrentProjectQuery(input)
  const projectId = currentProjectId()
  if (!projectId || typeof input !== 'string') return fetch(href, init)

  let url: URL
  try {
    url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  } catch {
    return fetch(href, init)
  }

  const method = (init?.method ?? 'GET').toUpperCase()
  const projectScoped =
    url.pathname === '/api/project' ||
    url.pathname.startsWith('/api/project/') ||
    url.pathname === '/api/config' ||
    url.pathname.startsWith('/api/config/')
  const mutating = !['GET', 'HEAD'].includes(method)
  if (!projectScoped || !mutating) return fetch(href, init)

  const headers = new Headers(init?.headers)
  const contentType = headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return fetch(href, init)

  let bodyObject: Record<string, unknown> = {}
  if (typeof init?.body === 'string' && init.body.trim().length > 0) {
    try {
      const parsed = JSON.parse(init.body)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        bodyObject = parsed as Record<string, unknown>
      } else {
        return fetch(href, init)
      }
    } catch {
      return fetch(href, init)
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
