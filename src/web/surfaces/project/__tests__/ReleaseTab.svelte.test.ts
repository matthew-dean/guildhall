// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
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
  incompleteBriefs: [],
  unapprovedBriefs: [],
  unapprovedSpecs: [],
  shelvedUnclaimed: [],
  blockedByAgent: [],
  designSystem: { drafted: true, approved: true, revision: 4 },
  statusCounts: { done: 4 },
  totals: { blockingCount: 0, tasks: 4, done: 4 },
}

describe('ReleaseTab', () => {
  afterEach(() => {
    window.history.replaceState({}, '', '/release')
    path.value = '/release'
    vi.restoreAllMocks()
    cleanup()
  })

  it('surfaces initialization-needed state before closure checks are available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ initializationNeeded: true })))
    window.history.replaceState({}, '', '/projects/looma-knit/release')
    path.value = '/projects/looma-knit/release'

    render(ReleaseTab)

    expect(await screen.findByText('Project not initialized yet')).toBeTruthy()
    expect(screen.getByText('Complete the setup wizard before Guildhall can assess whether the current work is closed.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open setup wizard' }).getAttribute('href')).toBe('/projects/looma-knit/setup')
  })

  it('surfaces closure-check load failures instead of showing a stale verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'missing project root' })))

    render(ReleaseTab)

    expect(await screen.findByText('Could not load closure checks')).toBeTruthy()
    expect(screen.getByText('missing project root')).toBeTruthy()
  })

  it('renders a closed verdict with the counts that feed it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(readyPayload)))

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getAllByText('Closed')).toHaveLength(2)
    expect(screen.getByText('4/4 tasks done · no open closure blockers.')).toBeTruthy()
    expect(screen.getByText('Current counts')).toBeTruthy()
    expect(screen.getByText('Total closure blockers')).toBeTruthy()
    expect(screen.getByText('Unfinished tasks')).toBeTruthy()
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

    expect(await screen.findByText('Closure checks')).toBeTruthy()
    expect(screen.getByText('Open escalations')).toBeTruthy()
    expect(screen.getAllByText('1 task still open.')).toHaveLength(2)
    expect(screen.getByText('Choose project scope')).toBeTruthy()
    expect(screen.getByText('Waiting on user decision')).toBeTruthy()
    expect(screen.getByText('Approve editor spec')).toBeTruthy()
    expect(screen.getByText('draft · rev 2')).toBeTruthy()
    expect(screen.getByText('Task-state tally')).toBeTruthy()
    expect(screen.getAllByText('Blocked').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('2')).toBeTruthy()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/project/release-readiness')
    })
  })

  it('renders incomplete task briefs as a separate owner action', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          incompleteBriefs: [
            {
              id: 'task-incomplete',
              title: 'Needs brief cleanup',
              reason: 'Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.',
            },
          ],
          unapprovedBriefs: [
            {
              id: 'task-unapproved',
              title: 'Ready for brief approval',
            },
          ],
          statusCounts: { proposed: 2 },
          totals: {
            blockingCount: 4,
            humanBlockingCount: 2,
            incompleteBriefBlockingCount: 1,
            unfinishedCount: 2,
            tasks: 2,
            done: 0,
          },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Closure checks')).toBeTruthy()
    expect(screen.getByText('Incomplete briefs')).toBeTruthy()
    expect(screen.getByText('Needs brief cleanup')).toBeTruthy()
    expect(screen.getByText('Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.')).toBeTruthy()
    expect(screen.getByText('Unapproved briefs')).toBeTruthy()
    expect(screen.getByText('Ready for brief approval')).toBeTruthy()
  })

  it('uses the current project route when loading closure checks', async () => {
    window.history.replaceState({}, '', '/projects/t-minus-t/release')
    path.value = '/projects/t-minus-t/release'
    const fetchMock = vi.fn(async () => json(readyPayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ReleaseTab)

    await screen.findByText('Current work closure')
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
          designSystem: { drafted: false, approved: false, source: 'none' },
          totals: { blockingCount: 0, tasks: 3, done: 3 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('No design-system guardrail is captured yet.')).toBeTruthy()
  })

  it('prioritizes API not-ready reasons over generic design-system closure copy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          ready: false,
          notReadyReason: 'Answer the pressure-test question before closing this work.',
          designSystem: { drafted: false, approved: false, source: 'none' },
          totals: { blockingCount: 0, tasks: 3, done: 3 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('Answer the pressure-test question before closing this work.')).toBeTruthy()
    expect(screen.queryByText('No design-system guardrail is captured yet.')).toBeNull()
  })

  it('shows repo-detected design systems as satisfied instead of not drafted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          designSystem: {
            drafted: true,
            approved: true,
            source: 'repo',
            label: 'detected in repo',
            revision: 0,
          },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getByText('detected in repo')).toBeTruthy()
    expect(screen.queryByText('not drafted')).toBeFalsy()
  })

  it('prioritizes unfinished work over design-system readiness', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          designSystem: { drafted: false, approved: false },
          statusCounts: { done: 18, ready: 33, exploring: 4, in_progress: 1, shelved: 40 },
          totals: { blockingCount: 0, tasks: 96, done: 18 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('38 tasks still need shaping, worker execution, review, or recovery.')).toBeTruthy()
  })

  it('blocks current work closure on Guildhall-owned dirty checkout residue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          dirtyCheckout: {
            ownedCount: 3,
            files: ['.gitignore', 'guildhall.yaml', 'memory/TASKS.json'],
          },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('3 Guildhall-owned project files still need cleanup or landing.')).toBeTruthy()
    expect(screen.getByText('3 Guildhall files dirty')).toBeTruthy()
    expect(screen.getByText(/3 project-local Guildhall files need cleanup before the current work can close/)).toBeTruthy()
    expect(screen.queryByText(/memory\/TASKS.json/)).toBeNull()
  })

  it('surfaces checkout inspection errors instead of calling the project clean', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          dirtyCheckout: {
            ownedCount: 0,
            files: [],
            error: 'fatal: not a git repository',
          },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current work closure')).toBeTruthy()
    expect(screen.getByText('Could not inspect checkout')).toBeTruthy()
    expect(screen.getByText(/Guildhall could not inspect this checkout with git/)).toBeTruthy()
    expect(screen.queryByText(/fatal: not a git repository/)).toBeNull()
    expect(screen.queryByText('Project checkout clean.')).toBeNull()
  })

  it('caps the visible Git Story blocker list and keeps the full count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          gitStory: {
            state: 'dirty_uncommitted',
            blockers: Array.from({ length: 9 }, (_, index) => ({
              id: `repo-${index}`,
              reason: `Repo ${index} needs commit or push.`,
              projectPath: `/repo/${index}`,
            })),
          },
          totals: { ...readyPayload.totals, gitStoryBlockingCount: 9 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Closure checks')).toBeTruthy()
    expect(screen.getByText('9 unresolved git stories.')).toBeTruthy()
    expect(screen.getByText('Showing 5 of 9 git stories.')).toBeTruthy()
    expect(screen.getByText('Repo 0 needs commit or push.')).toBeTruthy()
    expect(screen.queryByText('Repo 8 needs commit or push.')).toBeNull()
  })

  it('frames git story blockers as owner decisions instead of raw branch plumbing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          gitStory: {
            state: 'no_upstream',
            blockers: [
              {
                id: 'repo-0',
                taskId: 'task-branch',
                label: 'guildhall/task-task-import-123 has no upstream branch',
                reason: 'guildhall/task-task-import-123 has no upstream branch',
              },
            ],
          },
          totals: { ...readyPayload.totals, gitStoryBlockingCount: 1 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Closure checks')).toBeTruthy()
    expect(screen.getByText('A branch needs a sharing decision.')).toBeTruthy()
    expect(screen.getByText('Push it, open a PR, or mark the work local-only/deferred if it should not be shared.')).toBeTruthy()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
  })

  it('opens git story task links inside the current project route', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/release/criteria')
    path.value = '/projects/looma-knit/release/criteria'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          gitStory: {
            state: 'no_upstream',
            blockers: [
              {
                id: 'repo-0',
                taskId: 'task-import-1y7kmp6',
                label: 'guildhall/task-task-import-1y7kmp6 has no upstream branch',
                reason: 'guildhall/task-task-import-1y7kmp6 has no upstream branch',
              },
            ],
          },
          totals: { ...readyPayload.totals, gitStoryBlockingCount: 1 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    await screen.findByText('Closure checks')
    await userEvent.click(screen.getByRole('button', { name: 'A branch needs a sharing decision.' }))

    expect(path.value).toBe('/projects/looma-knit/task/task-import-1y7kmp6')
  })
})
