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
  scope: { id: 'current-work', label: 'Current task scope' },
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

  it('renders a ready release as one status with optional detail inspection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(readyPayload)))

    render(ReleaseTab)

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Ready')).toHaveLength(1)
    expect(screen.queryByText('Scope readiness')).toBeNull()
    expect(screen.getByText('4/4 tasks done · no open scope blockers.')).toBeTruthy()
    expect(screen.getByText('Release status')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect release details' })).toBeTruthy()
    expect(screen.queryByText('Current counts')).toBeNull()
  })

  it('uses release wording when a named release exists', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      ...readyPayload,
      release: { id: '2-0-alpha', label: '2.0 alpha' },
      verdict: {
        state: 'ready',
        label: 'Ready',
        title: '2.0 alpha is ready',
        tone: 'ok',
        detail: '4/4 tasks done · no open release blockers.',
      },
    })))

    render(ReleaseTab)

    expect(await screen.findByText('2.0 alpha')).toBeTruthy()
    expect(screen.getByText('Release readiness')).toBeTruthy()
    expect(screen.getByText('2.0 alpha is ready')).toBeTruthy()
    expect(screen.getByText('4/4 tasks done · no open release blockers.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect release details' })).toBeTruthy()
  })

  it('replaces the release-ready self-link with the visible ship decision', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/project/release/close')) {
        return json({ ok: true, release: { id: '0.0.1', label: '0.0.1', state: 'shipped' } })
      }
      return json({
        ...readyPayload,
        ready: true,
        release: { id: '0.0.1', label: '0.0.1', state: 'active' },
        verdict: {
          state: 'ready',
          label: 'Ready',
          title: '0.0.1 is ready',
          tone: 'ok',
          detail: '2/2 tasks done · no open release blockers.',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    window.history.replaceState({}, '', '/projects/t-minus-t/release')
    path.value = '/projects/t-minus-t/release'

    render(ReleaseTab, {
      props: {
        activeProjectId: 't-minus-t',
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Release is ready',
              detail: '0.0.1 has no runnable work remaining.',
              buttonLabel: 'Open Release',
              href: '/release',
              tone: 'accent',
              code: 'release_ready',
              ownerHeading: 'Release is ready',
            },
          },
        },
      },
    })

    expect(await screen.findByText('0.0.1 is ready')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Release' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Ship release' }))
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/project/release/close?projectId=t-minus-t',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses the shared project action instead of turning release readiness into a dead end', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({
        ...readyPayload,
        release: { id: 'stage-1', label: 'Stage 1', state: 'active' },
        ready: false,
        verdict: {
          state: 'work_remaining',
          label: 'Work remaining',
          title: 'Stage 1 has work remaining',
          tone: 'warn',
          detail: 'A review is waiting before work can continue.',
        },
      })
    }))
    window.history.replaceState({}, '', '/projects/looma-knit/release')
    path.value = '/projects/looma-knit/release'

    render(ReleaseTab, {
      props: {
        activeProjectId: 'looma-knit',
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Review a spec',
              taskId: 'task-review-first',
              taskLabel: 'Review the focused desktop spec before implementation continues.',
              detail: 'One spec is ready for your review.',
              buttonLabel: 'Review next spec',
              href: '/work?task=task-review-first',
              tone: 'warn',
            },
          },
        },
      },
    })

    expect(await screen.findByText('What needs your attention')).toBeTruthy()
    expect(screen.getByText('Review a spec')).toBeTruthy()
    expect(screen.getByText('One spec is ready for your review.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review next spec' })).toBeTruthy()
    expect(screen.queryByText('Current counts')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Review next spec' }))
    expect(path.href).toBe('/projects/looma-knit/work?task=task-review-first')
  })

  it('keeps release details focused on the shared owner action instead of listing competing exceptions', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({
        ...readyPayload,
        release: { id: 'stage-1', label: 'Stage 1', state: 'active' },
        unapprovedSpecs: [{ id: 'task-review-first', title: 'Review the first spec' }],
        incompleteBriefs: [{ id: 'task-later', title: 'A later brief' }],
      })
    }))
    window.history.replaceState({}, '', '/projects/looma-knit/release/criteria')
    path.value = '/projects/looma-knit/release/criteria'

    render(ReleaseTab, {
      props: {
        activeProjectId: 'looma-knit',
        subView: 'criteria',
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Review a spec',
              taskId: 'task-review-first',
              taskLabel: 'Review the first spec before work can continue.',
              detail: 'One spec is ready for your review.',
              buttonLabel: 'Review next spec',
              href: '/work?task=task-review-first',
              tone: 'warn',
            },
          },
        },
      },
    })

    expect(await screen.findByText('Release is waiting on this')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Review next spec' })).toBeTruthy()
    expect(screen.queryByText('Release exceptions')).toBeNull()
    expect(screen.queryByText('A later brief')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Review next spec' }))
    expect(path.href).toBe('/projects/looma-knit/work?task=task-review-first')
  })

  it('does not call ready work owner attention on the release route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({
        ...readyPayload,
        release: { id: 'stage-2', label: 'Stage 2', state: 'active' },
      })
    }))

    render(ReleaseTab, {
      props: {
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Work ready to resume',
              taskId: 'task-ready',
              taskLabel: 'Continue the selected task.',
              buttonLabel: 'Open Work',
              href: '/work?task=task-ready',
              tone: 'accent',
              code: 'ready_work',
              ownerHeading: 'Ready to continue',
            },
          },
        },
      },
    })

    expect(await screen.findByText('Ready to continue')).toBeTruthy()
    expect(screen.queryByText('What needs your attention')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeTruthy()
  })

  it('does not call live work owner attention on the release route', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({ ...readyPayload, release: { id: 'stage-2', label: 'Stage 2', state: 'active' } })
    }))

    render(ReleaseTab, {
      props: {
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Build the next primitive',
              taskId: 'task-running',
              taskLabel: 'Build the selected primitive.',
              buttonLabel: 'Open Work',
              href: '/work?task=task-running',
              tone: 'running',
              code: 'running',
              ownerHeading: 'Work is underway',
            },
          },
        },
      },
    })

    expect(await screen.findByText('Work is underway')).toBeTruthy()
    expect(screen.queryByText('What needs your attention')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Work' })).toBeTruthy()
  })

  it('runs a focused spec repair instead of navigating to a duplicate repair command', async () => {
    let completeRun!: () => void
    const onRunTask = vi.fn(() => new Promise<void>(resolve => {
      completeRun = resolve
    }))
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({ ...readyPayload, release: { id: 'stage-2', label: 'Stage 2', state: 'active' } })
    }))

    render(ReleaseTab, {
      props: {
        activeProjectId: 'looma-knit',
        onRunTask,
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Repair this spec',
              taskId: 'task-repair',
              taskLabel: 'Repair the current component roadmap spec.',
              buttonLabel: 'Repair spec',
              href: '/work?task=task-repair',
              tone: 'accent',
              code: 'ready_work',
              operation: 'repair_spec',
            },
          },
        },
      },
    })

    await screen.findByRole('button', { name: 'Repair spec' })
    await userEvent.click(screen.getByRole('button', { name: 'Repair spec' }))
    expect(onRunTask).toHaveBeenCalledWith('task-repair')
    expect(screen.getByRole('button', { name: 'Repair spec' }).hasAttribute('disabled')).toBe(true)
    expect(path.href).not.toBe('/projects/looma-knit/work?task=task-repair')
    completeRun()
  })

  it('resumes focused work directly instead of sending the owner to a second resume button', async () => {
    const onRunTask = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({ ...readyPayload })
    }))

    render(ReleaseTab, {
      props: {
        activeProjectId: 't-minus-t',
        onRunTask,
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Work paused',
              taskId: 'task-004',
              taskLabel: 'Open supported documents as TypeScript',
              detail: 'Saved work is ready to resume.',
              buttonLabel: 'Resume work',
              href: '/work?task=task-004',
              tone: 'accent',
              code: 'paused_live_work',
              operation: 'start_focused',
            },
          },
        },
      },
    })

    await screen.findByRole('button', { name: 'Resume work' })
    await userEvent.click(screen.getByRole('button', { name: 'Resume work' }))
    expect(onRunTask).toHaveBeenCalledWith('task-004')
    expect(path.href).not.toBe('/projects/t-minus-t/work?task=task-004')
  })

  it('pushes a completed branch directly instead of reopening the release route', async () => {
    const onRunRepositoryAction = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({ ...readyPayload })
    }))

    render(ReleaseTab, {
      props: {
        activeProjectId: 't-minus-t',
        onRunRepositoryAction,
        projectDetail: {
          actionModel: {
            primaryAction: {
              label: 'Branch is ready to share',
              taskId: 'task-004',
              taskLabel: 'Open supported documents as TypeScript',
              detail: 'The completed change is local.',
              buttonLabel: 'Push branch',
              href: '/release',
              tone: 'warn',
              code: 'repository_followup_required',
              operation: 'push_branch',
            },
          },
        },
      },
    })

    await screen.findByRole('button', { name: 'Push branch' })
    await userEvent.click(screen.getByRole('button', { name: 'Push branch' }))
    expect(onRunRepositoryAction).toHaveBeenCalledWith('task-004', 'push_branch')
    expect(path.href).not.toBe('/projects/t-minus-t/release')
  })

  it('ignores a stale release response after the active project changes', async () => {
    let resolveOldRelease!: (response: Response) => void
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('projectId=first')) {
        return new Promise<Response>(resolve => { resolveOldRelease = resolve })
      }
      return json({
        ...readyPayload,
        release: { id: 'second', label: 'Second project' },
        verdict: {
          state: 'ready',
          label: 'Ready',
          title: 'Second project is ready',
          tone: 'ok',
          detail: '4/4 tasks done · no open release blockers.',
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = render(ReleaseTab, { props: { activeProjectId: 'first' } })
    await waitFor(() => {
      expect(resolveOldRelease).toBeTypeOf('function')
    })
    await rendered.rerender({ activeProjectId: 'second' })
    expect(await screen.findByText('Second project is ready')).toBeTruthy()

    resolveOldRelease(json({
      ...readyPayload,
      release: { id: 'first', label: 'First project' },
      verdict: {
        state: 'ready',
        label: 'Ready',
        title: 'First project is ready',
        tone: 'ok',
        detail: '4/4 tasks done · no open release blockers.',
      },
    }))
    await waitFor(() => {
      expect(screen.queryByText('First project is ready')).toBeNull()
      expect(screen.getByText('Second project is ready')).toBeTruthy()
    })
  })

  it('presents a shipped release as one terminal state without inventing compact blockers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) return json({ spine: null })
      return json({
        release: { id: '1-0', label: '1.0', state: 'shipped' },
        ready: true,
        checksLoaded: false,
        completion: { state: 'complete', label: 'Complete', tone: 'ok', detail: '15 / 15 done' },
        statusCounts: { done: 15 },
        totals: { blockingCount: 0, unfinishedCount: 0, tasks: 15, done: 15 },
      })
    }))

    render(ReleaseTab, { activeProjectId: 'looma-knit' })

    expect(await screen.findByRole('heading', { name: 'Release shipped' })).toBeTruthy()
    expect(screen.getByText('This release is complete')).toBeTruthy()
    expect(screen.getByText('There is nothing you need to do here.')).toBeTruthy()
    expect(screen.getAllByText('Shipped')).toHaveLength(1)
    expect(screen.queryByText('Current counts')).toBeNull()
    expect(screen.queryByText('Blocked')).toBeNull()
    expect(screen.queryByText('Release readiness')).toBeNull()

    expect(screen.queryByRole('button', { name: 'Inspect release details' })).toBeNull()
  })

  it('keeps orientation-spine narrative out of the default release handoff', async () => {
    let requestedSpine = false
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/project/spine')) {
        requestedSpine = true
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.queryByText('Current MVP is blocked on proof.')).toBeNull()
    expect(screen.queryByText('Build a fiction-first evaluation and reasoning harness.')).toBeNull()
    expect(screen.queryByText('3 included · 2 later')).toBeNull()
    expect(screen.queryByText('Anti-sameness safeguards')).toBeNull()
    expect(requestedSpine).toBe(false)
  })

  it('does not present the global project purpose as named-release scope', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/project/spine')) {
        return json({
          spine: {
            summary: {
              headline: 'Stage 2 is in progress.',
              purpose: 'The first MVP is headless and defers desktop UI.',
              selectedScopeLabel: 'Stage 2',
              includedWorkCount: 9,
              deferredWorkCount: 0,
            },
          },
        })
      }
      return json({
        ...readyPayload,
        release: {
          id: 'stage-2',
          label: 'Stage 2',
          state: 'active',
          description: 'A minimal author-facing desktop flow over the shipped headless harness.',
        },
        ready: false,
        verdict: {
          state: 'work_remaining',
          label: 'Work remaining',
          title: 'Stage 2 has work remaining',
          tone: 'warn',
          detail: '5 tasks still need shaping, worker execution, review, or recovery.',
        },
        statusCounts: { done: 4, in_progress: 1, ready: 4 },
        totals: { blockingCount: 0, unfinishedCount: 5, tasks: 9, done: 4 },
      })
    }))

    render(ReleaseTab)

    expect(await screen.findByText('Stage 2 has work remaining')).toBeTruthy()
    expect(screen.queryByText('A minimal author-facing desktop flow over the shipped headless harness.')).toBeNull()
    expect(screen.queryByText('The first MVP is headless and defers desktop UI.')).toBeNull()
    expect(screen.queryByText('Stage 2 is in progress.')).toBeNull()
  })

  it('renders only open release exceptions with their task routes visible', async () => {
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
    expect(screen.queryByText('draft · rev 2')).toBeNull()
    expect(screen.queryByText('Task-state tally')).toBeNull()
    expect(screen.queryByText('No open escalations.')).toBeNull()

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/project/release-readiness?live=true')
    })
  })

  it('keeps blocker diagnostics out of the default release summary', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          incompleteBriefs: [{
            id: 'task-shape',
            title: 'Shape imported task',
            reason: 'Needs source-backed brief.',
          }],
          openEscalations: [{
            id: 'task-blocked',
            title: 'Choose project scope',
            reason: 'Waiting on user decision',
            summary: 'Build failing until the project scope is chosen.',
          }],
          unapprovedSpecs: [{
            id: 'task-approval',
            title: 'Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lowe',
          }],
          blockedByAgent: [{
            id: 'task-agent-blocked',
            title: 'Fix task-local bootstrap',
            reason: 'human_judgment_required: pnpm lint failed.',
          }],
          dirtyCheckout: { ownedCount: 1, files: ['.guildhall/project-state/TASKS.json'] },
          gitStory: {
            blockers: [{
              id: 'git-1',
              state: 'dirty_uncommitted',
              reason: 'Dirty checkout.',
              nextAction: 'Review the diff, then commit it.',
            }],
          },
          statusCounts: { import_draft: 1, blocked: 2, ready: 1 },
          totals: {
            blockingCount: 5,
            humanBlockingCount: 3,
            dirtyCheckoutBlockingCount: 1,
            gitStoryBlockingCount: 1,
            unfinishedCount: 4,
            tasks: 4,
            done: 0,
          },
        }),
      ),
    )

    render(ReleaseTab)

    expect(await screen.findByText('Release status')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Inspect release details' })).toBeTruthy()
    expect(screen.queryByText('What blocks this')).toBeNull()
    expect(screen.queryByText('Needs shaping')).toBeNull()
    expect(screen.queryByText('Needs source-backed brief.')).toBeNull()
    expect(screen.queryByText('Open escalations')).toBeNull()
    expect(screen.queryByText('Build failing until the project scope is chosen.')).toBeNull()
    expect(screen.queryByText('Keep ui-top-bar, ui-search-shell, and ui-search-result-row as recipe-level primitives rather than forcing them into lowe')).toBeNull()
    expect(screen.queryByText('Agent-blocked tasks')).toBeNull()
    expect(screen.queryByText('pnpm lint failed.')).toBeNull()
    expect(screen.queryByText('Project checkout')).toBeNull()
    expect(screen.queryByText('Repository follow-up')).toBeNull()
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

    await screen.findByRole('heading', { name: 'Current work' })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/project/release-readiness/summary?projectId=t-minus-t')
    })
  })

  it('uses the explicit active project id when embedded in ProjectView', async () => {
    window.history.replaceState({}, '', '/projects')
    path.value = '/projects'
    const fetchMock = vi.fn(async () => json(readyPayload))
    vi.stubGlobal('fetch', fetchMock)

    render(ReleaseTab, { props: { activeProjectId: 'looma-knit' } })

    await screen.findByRole('heading', { name: 'Current work' })
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/project/release-readiness/summary?projectId=looma-knit')
      expect(fetchMock).not.toHaveBeenCalledWith('/api/project/spine?compact=true&projectId=looma-knit', { cache: 'no-store' })
    })
  })

  it('keeps aggregate release blockers out of the detail checklist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          ready: false,
          release: { id: 'primitive-wave', label: 'Primitive wave' },
          releaseBlockers: [
            {
              id: 'task-link',
              title: 'Link editing UI',
              label: 'Link editing UI: needs a clearer brief before unattended work can run.',
            },
            {
              id: 'task-menu',
              title: 'Block menu / block side menu',
              label: 'Block menu / block side menu: needs a clearer brief before unattended work can run.',
            },
          ],
          totals: {
            blockingCount: 2,
            humanBlockingCount: 2,
            unfinishedCount: 2,
            tasks: 2,
            done: 0,
          },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    expect(await screen.findByText('Release checks')).toBeTruthy()
    expect(screen.queryByText('Release blockers')).toBeNull()
    expect(screen.queryByText('Link editing UI')).toBeNull()
    expect(screen.queryByText('Block menu / block side menu')).toBeNull()
  })

  it('keeps repository follow-up separate from the task-check categories', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          ...readyPayload,
          ready: false,
          release: { id: 'primitive-wave', label: 'Primitive wave' },
          releaseBlockers: [
            {
              id: 'task-link',
              title: 'Link editing UI',
              label: 'Link editing UI: needs a clearer brief before unattended work can run.',
            },
            {
              id: 'repository-followup:repo:0',
              title: 'Repository follow-up: main',
              label: 'Branch needs a sharing decision.',
            },
            {
              id: 'dirty-checkout',
              title: 'Project checkout',
              label: '1 Guildhall-managed checkout file needs cleanup or landing.',
            },
          ],
          dirtyCheckout: { ownedCount: 1, files: ['TASKS.json'] },
          gitStory: {
            ready: false,
            blockers: [{ id: 'repo:0', label: 'main', state: 'no_upstream', reason: 'Branch needs a sharing decision.' }],
          },
          totals: {
            blockingCount: 3,
            gitStoryBlockingCount: 1,
            dirtyCheckoutBlockingCount: 1,
            humanBlockingCount: 1,
            unfinishedCount: 1,
            tasks: 1,
            done: 0,
          },
        }),
      ),
    )

    render(ReleaseTab, { props: { subView: 'criteria' } })

    await screen.findByText('Release exceptions')
    expect(screen.queryByText('Release blockers')).toBeNull()
    expect(screen.getByText('1 repository follow-up.')).toBeTruthy()
    expect(screen.getAllByText('Repository follow-up').length).toBeGreaterThanOrEqual(1)
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(1)
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Ready')).toHaveLength(1)
    expect(screen.getByText('3/3 tasks done · no open scope blockers.')).toBeTruthy()
    expect(screen.queryByText('not captured')).toBeNull()
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(1)
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Ready')).toHaveLength(1)
    expect(screen.queryByText('detected in repo')).toBeNull()
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Work remaining')).toHaveLength(1)
    expect(screen.getByText('38 tasks still need shaping, worker execution, review, or recovery.')).toBeTruthy()
    expect(screen.queryByText('38 open scope checks')).toBeNull()
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getAllByText('Blocked')).toHaveLength(1)
    expect(screen.getByText('3 Guildhall-managed checkout files need cleanup or landing.')).toBeTruthy()
    expect(screen.queryByText('3 managed files dirty')).toBeNull()
    expect(screen.queryByText(/3 Guildhall-managed checkout files need cleanup before current work can be ready/)).toBeNull()
    expect(screen.queryByText(/memory\/TASKS.json/)).toBeNull()
  })

  it('keeps checkout inspection errors blocked without exposing raw git output', async () => {
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

    expect(await screen.findByRole('heading', { name: 'Current work' })).toBeTruthy()
    expect(screen.getByText('Blocked')).toBeTruthy()
    expect(screen.getByText('Could not inspect the project checkout.')).toBeTruthy()
    expect(screen.queryByText(/fatal: not a git repository/)).toBeNull()
    expect(screen.queryByText('Project checkout clean.')).toBeNull()
  })

  it('caps the visible repository follow-up list and keeps the full count', async () => {
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
    expect(screen.getByText('9 repository follow-ups.')).toBeTruthy()
    expect(screen.getByText('Showing 5 of 9 repository follow-ups.')).toBeTruthy()
    expect(screen.getByText('Repo 0 needs commit or push.')).toBeTruthy()
    expect(screen.queryByText('Repo 8 needs commit or push.')).toBeNull()
  })

  it('frames repository follow-ups as owner decisions instead of raw branch plumbing', async () => {
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

    expect(path.href).toBe('/projects/looma-knit/task/task-import-1y7kmp6?detail=full&tab=provenance')
  })
})
