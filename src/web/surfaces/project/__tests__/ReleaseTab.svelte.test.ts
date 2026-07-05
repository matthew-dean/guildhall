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

  it('surfaces initialization-needed state before release checks are available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ initializationNeeded: true })))
    window.history.replaceState({}, '', '/projects/looma-knit/release')
    path.value = '/projects/looma-knit/release'

    render(ReleaseTab)

    expect(await screen.findByText('Project not initialized yet')).toBeTruthy()
    expect(screen.getByText('Complete the setup wizard before assessing release readiness.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open setup wizard' }).getAttribute('href')).toBe('/projects/looma-knit/setup')
  })

  it('surfaces release-check load failures instead of showing a stale verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'missing project root' })))

    render(ReleaseTab)

    expect(await screen.findByText('Could not load release checks')).toBeTruthy()
    expect(screen.getByText('missing project root')).toBeTruthy()
  })

  it('renders a ready verdict with the counts that feed it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(readyPayload)))

    render(ReleaseTab)

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.getByText('Scope readiness')).toBeTruthy()
    expect(screen.getByText('4/4 tasks done · no open scope blockers.')).toBeTruthy()
    expect(screen.getByText('Current counts')).toBeTruthy()
    expect(screen.getByText('Open checks')).toBeTruthy()
    expect(screen.getByText('Unfinished tasks')).toBeTruthy()
    expect(screen.getByText('approved · rev 4')).toBeTruthy()
  })

  it('uses release wording when a named release exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      ...readyPayload,
      release: { id: '2-0-alpha', label: '2.0 alpha' },
    })))

    render(ReleaseTab)

    expect(await screen.findByText('2.0 alpha')).toBeTruthy()
    expect(screen.getByText('Release readiness')).toBeTruthy()
    expect(screen.getByText('4/4 tasks done · no open release blockers.')).toBeTruthy()
    expect(screen.getByText('Open release checks')).toBeTruthy()
  })

  it('renders the shared orientation spine blocker before release details', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/project/spine')) {
        return json({
          spine: {
            scope: { label: 'Current MVP' },
            summary: {
              headline: 'Current MVP is blocked on proof.',
              purpose: 'Build a fiction-first evaluation and reasoning harness.',
              selectedScopeLabel: 'Current MVP',
              includedWorkCount: 3,
              deferredWorkCount: 2,
              topBlocker: 'Anti-sameness proof missing',
            },
            release: {
              blockers: [{
                id: 'proof:anti-sameness',
                label: 'Anti-sameness proof missing',
                owningNodeId: 'work:task-anti-sameness',
              }],
            },
            nodes: {
              'work:task-anti-sameness': {
                id: 'work:task-anti-sameness',
                title: 'Anti-sameness safeguards',
              },
            },
          },
        })
      }
      return json({
        ...readyPayload,
        ready: false,
        notReadyReason: 'Anti-sameness proof missing',
        totals: { blockingCount: 1, tasks: 3, done: 2 },
      })
    }))

    render(ReleaseTab)

    expect(await screen.findByText('Current MVP is blocked on proof.')).toBeTruthy()
    expect(screen.getAllByText('Current MVP').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('3 included · 2 later')).toBeTruthy()
    expect(screen.getAllByText('Anti-sameness proof missing').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Anti-sameness safeguards')).toBeTruthy()
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

    expect(await screen.findByText('Scope checks')).toBeTruthy()
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

    expect(await screen.findByText('Scope checks')).toBeTruthy()
    expect(screen.getByText('Incomplete briefs')).toBeTruthy()
    expect(screen.getByText('Needs brief cleanup')).toBeTruthy()
    expect(screen.getByText('Task brief needs user job, why it matters now, success metric, and at least one non-goal before approval.')).toBeTruthy()
    expect(screen.getByText('Unapproved briefs')).toBeTruthy()
    expect(screen.getByText('Ready for brief approval')).toBeTruthy()
  })

  it('uses the current project route when loading release checks', async () => {
    window.history.replaceState({}, '', '/projects/t-minus-t/release')
    path.value = '/projects/t-minus-t/release'
    const fetchMock = vi.fn(async () => json(readyPayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ReleaseTab)

    await screen.findByText('Current task scope')
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
          totals: { blockingCount: 1, designSystemBlockingCount: 1, tasks: 3, done: 3 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('No design-system guardrail is captured yet.')).toBeTruthy()
  })

  it('does not override a ready release when the shared model says design-system capture is informational', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          ready: true,
          designSystem: {
            drafted: false,
            approved: false,
            source: 'none',
            label: 'not captured',
            reason: 'No design-system guardrail is captured yet.',
          },
          totals: { blockingCount: 0, designSystemBlockingCount: 0, unfinishedCount: 0, tasks: 3, done: 3 },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getAllByText('Ready')).toHaveLength(2)
    expect(screen.getByText('3/3 tasks done · no open scope blockers.')).toBeTruthy()
    expect(screen.getByText('not captured')).toBeTruthy()
    expect(screen.queryByText('No design-system guardrail is captured yet.')).toBeNull()
  })

  it('prioritizes API not-ready reasons over generic design-system readiness copy', async () => {
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

    expect(await screen.findByText('Current task scope')).toBeTruthy()
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

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getByText('detected in repo')).toBeTruthy()
    expect(screen.queryByText('not drafted')).toBeFalsy()
  })

  it('labels unfinished runnable work as remaining work instead of blocked', async () => {
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

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getAllByText('Work remaining')).toHaveLength(2)
    expect(screen.getByText('38 tasks still need shaping, worker execution, review, or recovery.')).toBeTruthy()
    expect(screen.getByText('38 open scope checks')).toBeTruthy()
  })

  it('blocks current work readiness on Guildhall-owned dirty checkout residue', async () => {
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

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(2)
    expect(screen.getByText('3 Guildhall-owned project files still need cleanup or landing.')).toBeTruthy()
    expect(screen.getByText('3 Guildhall files dirty')).toBeTruthy()
    expect(screen.getByText(/3 project-local Guildhall files need cleanup before current work can be ready/)).toBeTruthy()
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

    expect(await screen.findByText('Current task scope')).toBeTruthy()
    expect(screen.getByText('Could not inspect checkout')).toBeTruthy()
    expect(screen.getByText(/Guildhall could not inspect the configured repository boundary with git/)).toBeTruthy()
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

    expect(await screen.findByText('Scope checks')).toBeTruthy()
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

    expect(await screen.findByText('Scope checks')).toBeTruthy()
    expect(screen.getByText('A branch needs a sharing decision.')).toBeTruthy()
    expect(screen.getByText('Push it, open a PR, or mark the work local-only/deferred if it should not be shared.')).toBeTruthy()
    expect(screen.queryByText(/has no upstream branch/)).toBeNull()
  })

  it('shows workspace child repo labels on friendly git story blockers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          gitStory: {
            state: 'dirty_uncommitted',
            blockers: [
              {
                id: 'repo-knit',
                repoId: 'knit',
                repoLabel: 'Knit',
                label: 'Knit: main',
                state: 'dirty_uncommitted',
                reason: '28 changed files are not committed.',
                nextAction: 'Review the diff, then commit or mark the work local-only/deferred.',
              },
              {
                id: 'task-looma',
                taskId: 'task-toolbar',
                repoId: 'looma',
                repoLabel: 'Looma',
                label: 'Looma: Floating toolbar',
                state: 'no_upstream',
                reason: 'guildhall/task-toolbar has no upstream branch',
              },
            ],
          },
          totals: { ...readyPayload.totals, gitStoryBlockingCount: 2 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Scope checks')).toBeTruthy()
    expect(screen.getByText('Knit: A checkout has uncommitted work.')).toBeTruthy()
    expect(screen.getByText('Looma: A branch needs a sharing decision.')).toBeTruthy()
  })

  it('does not tell workspace envelopes that the parent path must be a git checkout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          gitStory: {
            state: 'unknown',
            blockers: [
              {
                id: 'repo-knit',
                repoId: 'knit',
                repoLabel: 'Knit',
                label: 'Knit',
                state: 'unknown',
                reason: 'fatal: not a git repository',
                nextAction: 'Inspect git state manually; Guildhall could not read it.',
              },
            ],
          },
          totals: { ...readyPayload.totals, gitStoryBlockingCount: 1 },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Scope checks')).toBeTruthy()
    expect(screen.getByText('Knit: Could not inspect this checkout.')).toBeTruthy()
    expect(screen.getByText(/attached path or child repo is reachable/)).toBeTruthy()
    expect(screen.queryByText(/project path is a Git checkout/)).toBeNull()
    expect(screen.queryByText(/fatal: not a git repository/)).toBeNull()
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

    await screen.findByText('Scope checks')
    await userEvent.click(screen.getByRole('button', { name: 'A branch needs a sharing decision.' }))

    expect(path.value).toBe('/projects/looma-knit/task/task-import-1y7kmp6')
  })
})
