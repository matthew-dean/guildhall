// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { project } from '../project.svelte.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('project store', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('coalesces duplicate project refreshes while one request is in flight', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(() => new Promise<Response>(resolve => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = project.refresh('font-something')
    const second = project.refresh('font-something')

    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolveFetch?.(json({
      id: 'font-something',
      name: 'Font Something',
      path: '/repo/font-something',
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [],
    }))

    await expect(first).resolves.toMatchObject({ id: 'font-something' })
    await expect(second).resolves.toMatchObject({ id: 'font-something' })
  })

  it('requests a Work-scoped project payload when the active surface is work', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [],
    })))
    vi.stubGlobal('fetch', fetchMock)

    await project.refresh('looma-knit', 'work')

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requested.pathname).toBe('/api/project')
    expect(requested.searchParams.get('projectId')).toBe('looma-knit')
    expect(requested.searchParams.get('surface')).toBe('work')
  })

  it('requests a Map-scoped project payload when the active surface is map', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({
      id: 'narrative-harness',
      name: 'Narrative Harness',
      path: '/repo/narrative-harness',
      tasks: [],
    })))
    vi.stubGlobal('fetch', fetchMock)

    await project.refresh('narrative-harness', 'map')

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requested.pathname).toBe('/api/project')
    expect(requested.searchParams.get('projectId')).toBe('narrative-harness')
    expect(requested.searchParams.get('surface')).toBe('map')
  })

  it('passes the route-focused work item through Work-scoped project refreshes', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(json({
      id: 'looma-knit',
      name: 'Looma + Knit',
      path: '/repo/looma-knit',
      selectedTaskId: 'task-storybook',
      run: { status: 'stopped', mode: 'continuous' },
      tasks: [],
    })))
    vi.stubGlobal('fetch', fetchMock)

    await project.refresh('looma-knit', 'work', 'task-storybook')

    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requested.pathname).toBe('/api/project')
    expect(requested.searchParams.get('projectId')).toBe('looma-knit')
    expect(requested.searchParams.get('surface')).toBe('work')
    expect(requested.searchParams.get('task')).toBe('task-storybook')
  })
})
