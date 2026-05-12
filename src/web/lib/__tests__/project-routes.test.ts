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
})
