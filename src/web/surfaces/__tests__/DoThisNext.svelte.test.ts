// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import DoThisNext from '../DoThisNext.svelte'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'
import type { ProjectAction } from '../../lib/types.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function detailWithAction(primaryAction: ProjectAction | null, secondaryActions: ProjectAction[] = []) {
  return {
    actionModel: {
      primaryAction,
      secondaryActions,
      runControl: { label: primaryAction ? 'Resume' : 'No runnable tasks', startEnabled: Boolean(primaryAction) },
      ownerInput: { active: primaryAction?.source === 'owner_input' || primaryAction?.source === 'thread' },
      setup: { state: 'ready' as const, freshIntakeNeeded: false },
    },
  }
}

function action(overrides: Partial<ProjectAction> = {}): ProjectAction {
  return {
    source: 'inbox',
    label: 'Review project discovery update',
    detail: 'Review the current project decision.',
    buttonLabel: 'Review update',
    href: '/workspace-import?mode=reconcile',
    tone: 'warn',
    ...overrides,
  }
}

describe('DoThisNext', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/thread')
    path.value = '/projects/looma-knit/thread'
    project.detail = null
  })

  afterEach(() => {
    project.detail = null
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders the loaded project action model without refetching or recomputing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    project.detail = detailWithAction(
      action({
        source: 'task',
        label: 'Clean up the Stripe checkout brief',
        detail: 'Finish the active brief cleanup before reconciling stale discovery.',
        buttonLabel: 'Open Work',
        href: '/work',
      }),
      [action()],
    )

    render(DoThisNext)

    await screen.findByText('Clean up the Stripe checkout brief')
    expect(screen.getByText('Finish the active brief cleanup before reconciling stale discovery.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /open work/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /1 more in inbox/i })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not recommend opening the route that is already open', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/release')
    path.value = '/projects/looma-knit/release'
    project.detail = detailWithAction(action({
      source: 'start_readiness',
      label: 'Repository follow-up required',
      buttonLabel: 'Open release',
      href: '/release',
    }))

    render(DoThisNext)

    await waitFor(() => expect(screen.queryByText('Do this next')).toBeNull())
    expect(screen.queryByRole('button', { name: /open release/i })).toBeNull()
  })

  it('does not resurrect stale actions after the selected scope is complete', async () => {
    const fetchMock = vi.fn(async () => json({
      actionModel: detailWithAction(null).actionModel,
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(DoThisNext)

    await waitFor(() => expect(screen.queryByText('Do this next')).toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders the shared bootstrap action and keeps project routing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    project.detail = detailWithAction(
      action({
        label: 'Verify your bootstrap commands',
        detail: 'Install command needs confirmation.',
        buttonLabel: 'Open readiness checks',
        href: '/settings/ready',
        tone: 'danger',
      }),
      [action({ label: 'Review existing project work', href: '/workspace-import' })],
    )

    render(DoThisNext)

    await screen.findByText('Verify your bootstrap commands')
    expect(screen.getByText('Install command needs confirmation.')).toBeTruthy()
    expect(screen.getByText(/1 more in Inbox/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /open readiness checks/i }))
    expect(path.value).toBe('/projects/looma-knit/settings/ready')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders a shared Thread action without inspecting Thread locally', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/work')
    path.value = '/projects/looma-knit/work'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    project.detail = detailWithAction(action({
      source: 'thread',
      label: 'Answer in Thread',
      detail: 'Which implementation direction should Guildhall use?',
      buttonLabel: 'Open Thread',
      href: '/thread?thread=bc-task-shaping',
    }))

    render(DoThisNext)

    await screen.findByText('Answer in Thread')
    expect(screen.getByText('Which implementation direction should Guildhall use?')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /open thread/i }))
    expect(path.href).toBe('/projects/looma-knit/thread?thread=bc-task-shaping')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders shared draft-shaping copy and inbox overflow navigation', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/settings')
    path.value = '/projects/looma-knit/settings'
    project.detail = detailWithAction(
      action({
        label: 'Shape the imported drafts',
        detail: '3 imported notes still need shaping.',
        buttonLabel: 'Draft task brief',
        href: '/thread',
      }),
      [action({ label: 'Review existing project work', href: '/workspace-import' })],
    )

    render(DoThisNext)

    await screen.findByText('Shape the imported drafts')
    expect(screen.getByRole('button', { name: /draft task brief/i })).toBeTruthy()
    const more = screen.getByRole('button', { name: /1 more in inbox/i })
    await userEvent.click(more)
    expect(path.value).toBe('/projects/looma-knit/overview/inbox')
  })

  it('shows shared action detail without stacking status boilerplate', async () => {
    project.detail = detailWithAction(action({
      detail: 'Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.',
    }))

    render(DoThisNext)

    await screen.findByText('Review project discovery update')
    expect(screen.getByText(/scan more planning docs and migrations/i)).toBeTruthy()
    expect(screen.queryByText(/missing repo evidence/i)).toBeNull()
  })

  it('stays hidden when the shared model has no primary action', async () => {
    project.detail = detailWithAction(null)

    render(DoThisNext)

    await waitFor(() => expect(screen.queryByText('Do this next')).toBeNull())
  })
})
