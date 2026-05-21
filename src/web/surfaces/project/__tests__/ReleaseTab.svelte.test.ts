// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import ReleaseTab from '../ReleaseTab.svelte'
import { path } from '../../../lib/nav.svelte.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

const readyPayload = {
  openEscalations: [],
  unapprovedBriefs: [],
  unapprovedSpecs: [],
  shelvedUnclaimed: [],
  blockedByAgent: [],
  designSystem: { drafted: true, approved: true, revision: 4 },
  statusCounts: { done: 3, ready: 1 },
  totals: { blockingCount: 0, tasks: 4, done: 3 },
}

describe('ReleaseTab', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('surfaces initialization-needed state before release readiness is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ initializationNeeded: true })))

    render(ReleaseTab)

    expect(await screen.findByText('Project not initialized yet')).toBeTruthy()
    expect(screen.getByText('Complete the setup wizard before you can assess release readiness.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open setup wizard' }).getAttribute('href')).toBe('/setup')
  })

  it('surfaces release-readiness load failures instead of showing a stale verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'missing project root' })))

    render(ReleaseTab)

    expect(await screen.findByText('Could not load release readiness')).toBeTruthy()
    expect(screen.getByText('missing project root')).toBeTruthy()
  })

  it('renders a ready-to-ship verdict with the counts that feed it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(readyPayload)))

    render(ReleaseTab)

    expect(await screen.findByText('Release readiness')).toBeTruthy()
    expect(screen.getAllByText('Ready to ship')).toHaveLength(2)
    expect(screen.getByText('3/4 tasks done · no human blockers.')).toBeTruthy()
    expect(screen.getByText('Current counts')).toBeTruthy()
    expect(screen.getByText('Human blockers')).toBeTruthy()
    expect(screen.getByText('approved · rev 4')).toBeTruthy()
  })

  it('renders criteria blockers and the task-state tally', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          openEscalations: [
            {
              id: 'task-blocked',
              title: 'Choose project scope',
              reason: 'Waiting on user decision',
            },
          ],
          unapprovedSpecs: [{ taskId: 'task-spec', taskTitle: 'Approve editor spec' }],
          designSystem: { drafted: true, approved: false, revision: 2 },
          statusCounts: { blocked: 2, done: 1, ready: 1 },
          totals: { blockingCount: 2, tasks: 4, done: 1 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Release criteria')).toBeTruthy()
    expect(screen.getByText('Open escalations')).toBeTruthy()
    expect(screen.getAllByText('1 task still open.')).toHaveLength(2)
    expect(screen.getByText('Choose project scope')).toBeTruthy()
    expect(screen.getByText('Waiting on user decision')).toBeTruthy()
    expect(screen.getByText('Approve editor spec')).toBeTruthy()
    expect(screen.getByText('draft · rev 2')).toBeTruthy()
    expect(screen.getByText('Task-state tally')).toBeTruthy()
    expect(screen.getByText('blocked')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/project/release-readiness')
    })
  })

  it('uses the current project route when loading release readiness', async () => {
    window.history.replaceState({}, '', '/projects/t-minus-t/release')
    path.value = '/projects/t-minus-t/release'
    const fetchMock = vi.fn(async () => json(readyPayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ReleaseTab)

    await screen.findByText('Release readiness')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/project/release-readiness?projectId=t-minus-t')
    })
  })

  it('names design-system readiness as the hard release blocker', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          designSystem: { drafted: false, approved: false },
          totals: { blockingCount: 0, tasks: 3, done: 3 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Release readiness')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('Design system is not drafted yet.')).toBeTruthy()
  })
})
