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
})
