import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../nav.svelte.js', () => ({
  path: { value: '' },
}))

describe('project-routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'http://localhost:7777',
          pathname: '/projects/t-minus-t/thread',
        },
      },
      configurable: true,
    })
  })

  it('falls back to window.location.pathname when nav path is empty', async () => {
    const { currentProjectId } = await import('../project-routes.js')
    expect(currentProjectId()).toBe('t-minus-t')
  })

  it('injects projectId into JSON project mutations', async () => {
    const { projectFetch } = await import('../project-routes.js')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await projectFetch('/api/project/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'continuous' }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [href, init] = fetchMock.mock.calls[0]!
    expect(href).toBe('/api/project/start?projectId=t-minus-t')
    expect(init?.body).toBe(JSON.stringify({ mode: 'continuous', projectId: 't-minus-t' }))
  })

  it('can scope setup follow-up mutations before the URL has moved to /projects/:id', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'http://localhost:7777',
          pathname: '/setup',
        },
      },
      configurable: true,
    })
    const { projectFetch } = await import('../project-routes.js')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await projectFetch('/api/project/meta-intake', { method: 'POST' }, 'new-project')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [href] = fetchMock.mock.calls[0]!
    expect(href).toBe('/api/project/meta-intake?projectId=new-project')
  })

  it('builds scoped project hrefs from an explicit id even before the URL has a project id', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'http://localhost:7777',
          pathname: '/project/thread',
        },
      },
      configurable: true,
    })
    const { currentProjectHref } = await import('../project-routes.js')

    expect(currentProjectHref('/settings/ready', 'font-something')).toBe('/projects/font-something/settings/ready')
  })

  it('falls back to Projects Home when no URL or explicit project id is available', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'http://localhost:7777',
          pathname: '/project/thread',
        },
      },
      configurable: true,
    })
    const { currentProjectHref, currentTaskHref } = await import('../project-routes.js')

    expect(currentProjectHref('/settings/ready')).toBe('/projects')
    expect(currentTaskHref('task-123')).toBe('/projects')
  })

  it('normalizes project action hrefs that come from runtime inbox and thread payloads', async () => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: {
          origin: 'http://localhost:7777',
          pathname: '/projects/looma-knit/thread',
        },
      },
      configurable: true,
    })
    const { projectActionHref } = await import('../project-routes.js')

    expect(projectActionHref('/overview')).toBe('/projects/looma-knit/overview')
    expect(projectActionHref('/workspace-import')).toBe('/projects/looma-knit/workspace-import')
    expect(projectActionHref('/settings/advanced')).toBe('/projects/looma-knit/settings/advanced')
    expect(projectActionHref('/task/task-003')).toBe('/projects/looma-knit/task/task-003')
    expect(projectActionHref('/providers')).toBe('/providers')
    expect(projectActionHref('/projects/fair-labor-license/thread')).toBe('/projects/fair-labor-license/thread')
  })
})
