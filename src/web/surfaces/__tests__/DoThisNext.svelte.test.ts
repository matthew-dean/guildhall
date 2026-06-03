// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import DoThisNext from '../DoThisNext.svelte'
import { path } from '../../lib/nav.svelte.js'

function json(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/thread')
  path.value = '/projects/looma-knit/thread'
}

describe('DoThisNext', () => {
  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders the shared project action model instead of recomputing from inbox', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('/api/project?projectId=looma-knit')
        return json({
          actionModel: {
            primaryAction: {
              source: 'task',
              label: 'Clean up the Stripe checkout brief',
              detail: 'Finish the active brief cleanup before reconciling stale discovery.',
              buttonLabel: 'Open Work',
              href: '/work',
              tone: 'warn',
            },
            secondaryActions: [{
              source: 'inbox',
              label: 'Review project discovery update',
              detail: 'Review the reconciliation later.',
              buttonLabel: 'Review update',
              href: '/workspace-import?mode=reconcile',
              tone: 'warn',
            }],
          },
        })
      }),
    )

    render(DoThisNext)

    await screen.findByText('Clean up the Stripe checkout brief')
    expect(screen.getByText('Finish the active brief cleanup before reconciling stale discovery.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /open work/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /1 more in inbox/i })).toBeTruthy()
    expect(screen.queryByText('Review project discovery update')).toBeNull()
  })

  it('prescribes the highest-priority non-current action and keeps project routing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/project?projectId=looma-knit') return json({ startReadiness: { canStart: true } })
      expect(url).toBe('/api/project/inbox?projectId=looma-knit')
      return json({
        items: [
          {
            kind: 'bootstrap_missing',
            severity: 'high',
            title: 'Ready check',
            detail: 'Install command needs confirmation.',
            actionHref: '/settings/ready',
          },
          {
            kind: 'workspace_import_pending',
            severity: 'medium',
            title: 'Review existing project work',
            actionHref: '/workspace-import',
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(DoThisNext)

    await screen.findByText('Verify your bootstrap commands')
    expect(screen.getByText('Agents won’t dispatch until install + gate commands are verified.')).toBeTruthy()
    expect(screen.getByText('1 more in Inbox ›')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /open readiness checks/i }))

    expect(path.value).toBe('/projects/looma-knit/settings/ready')
  })

  it('stays focused on inbox work even when project start readiness exists elsewhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        return json({
          items: [
            {
              kind: 'project_understanding',
              severity: 'high',
              title: 'Review project discovery update',
              detail: 'Review the reconciliation.',
              actionHref: '/workspace-import?mode=reconcile',
            },
          ],
        })
      }),
    )

    render(DoThisNext)

    await screen.findByText('Review project discovery update')
    expect(screen.getByRole('button', { name: /review update/i })).toBeTruthy()
  })

  it('hides low-severity inbox noise when nothing actionable is waiting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            {
              kind: 'lever_questions',
              severity: 'low',
              title: 'Review project policies',
              detail: 'Optional defaults are still in effect.',
              actionHref: '/settings/advanced',
            },
          ],
        }),
      ),
    )

    render(DoThisNext)

    await waitFor(() => {
      expect(screen.queryByText('Do this next')).toBeNull()
    })
  })

  it('chooses a waiting Thread turn when Needs You only has optional cleanup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/project/inbox?projectId=looma-knit') {
          return json({
            items: [{
              kind: 'lever_questions',
              severity: 'low',
              title: 'Review project policies',
              detail: 'Optional defaults are still in effect.',
              actionHref: '/settings/advanced',
            }],
          })
        }
        if (url === '/api/project/thread?projectId=looma-knit') {
          return json({
            activeTurnId: 'bounded-chat:bc-task-shaping:q-1',
            turns: [{
              id: 'bounded-chat:bc-task-shaping:q-1',
              kind: 'bounded_chat',
              status: 'active',
              sessionId: 'bc-task-shaping',
              domainTitle: 'Task shaping',
              targetTitle: 'Narrative Harness',
              actionHref: '/thread?thread=bc-task-shaping',
              question: {
                prompt: 'Which implementation direction should Guildhall use?',
                why: 'This answer unblocks task shaping.',
              },
            }],
          })
        }
        return json({})
      }),
    )

    render(DoThisNext)

    await screen.findByText('Answer in Thread')
    expect(screen.getByText('Which implementation direction should Guildhall use?')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /open thread/i }))

    expect(path.href).toBe('/projects/looma-knit/thread?thread=bc-task-shaping')
  })

  it('frames project understanding advisories as a discovery update', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            {
              kind: 'project_understanding',
              severity: 'high',
              title: 'Review project discovery update',
              detail: 'Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.',
              actionHref: '/workspace-import?mode=reconcile',
            },
          ],
        }),
      ),
    )

    render(DoThisNext)

    await screen.findByText('Review project discovery update')
    expect(screen.getByText(/scan more planning docs and migrations/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /review update/i })).toBeTruthy()
    expect(screen.queryByText(/missing repo evidence/i)).toBeNull()
  })

  it('uses kind-specific copy for draft shaping and inbox overflow navigation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          items: [
            {
              kind: 'import_draft_queue',
              severity: 'medium',
              title: 'Imported drafts',
              detail: '3 imported notes still need shaping.',
              actionHref: '/thread',
            },
            {
              kind: 'workspace_import_pending',
              severity: 'medium',
              title: 'Review existing project work',
              detail: 'Review imported planning notes.',
              actionHref: '/workspace-import',
            },
          ],
        }),
      ),
    )

    window.history.replaceState({}, '', '/projects/looma-knit/settings')
    path.value = '/projects/looma-knit/settings'

    render(DoThisNext)

    await screen.findByText('Shape the imported drafts')
    expect(screen.getByRole('button', { name: /draft task brief/i })).toBeTruthy()
    const more = screen.getByRole('button', { name: /1 more in inbox/i })
    expect(more.className).not.toContain('more')
    await userEvent.click(more)

    expect(path.value).toBe('/projects/looma-knit/overview/inbox')
  })

  it('shows project-understanding detail directly instead of stacking extra status boilerplate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/project?projectId=looma-knit') return json({ startReadiness: { canStart: true } })
        return json({
          items: [
            {
              kind: 'project_understanding',
              severity: 'high',
              title: 'Review project discovery update',
              detail: 'Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.',
              actionHref: '/workspace-import?mode=reconcile',
            },
          ],
        })
      }),
    )

    render(DoThisNext)

    await screen.findByText('Review project discovery update')
    expect(screen.getByText('Guildhall can now scan more planning docs and migrations. Review the reconciliation so it can update or dismiss stale imported work.')).toBeTruthy()
    expect(screen.queryByText(/missing repo evidence/i)).toBeNull()
  })
})
