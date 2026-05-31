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

  it('prescribes the highest-priority non-current action and keeps project routing', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/project?projectId=looma-knit') return json({ startReadiness: { canStart: true } })
      expect(url).toBe('/api/project/inbox?projectId=looma-knit')
      return json({
        items: [
          {
            kind: 'agent_question_pending',
            severity: 'high',
            title: 'Knit: add link editor controls',
            detail: 'Choose whether drag handles are in scope.',
            taskId: 'task-link-editor',
            actionHref: '/thread',
          },
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

  it('uses project start readiness ahead of stale inbox ordering', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/project?projectId=looma-knit') {
          return json({
            startReadiness: {
              canStart: false,
              code: 'owner_input_required',
              message: 'Choose a recovery path for the blocked task',
              actionHref: '/task/task-current',
            },
          })
        }
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

    await screen.findByText('Choose a recovery path for the blocked task')
    expect(screen.getByRole('button', { name: /review recovery/i })).toBeTruthy()
    expect(screen.queryByText('Review project discovery update')).toBeNull()
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
              kind: 'open_escalation',
              severity: 'medium',
              title: 'Knit: add version diff view',
              detail: 'Worker needs guidance.',
              taskId: 'task-diff',
              actionHref: '/task/task-diff',
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

  it('shows recovery detail directly instead of stacking extra status boilerplate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === '/api/project?projectId=looma-knit') return json({ startReadiness: { canStart: true } })
        return json({
          items: [
            {
              kind: 'open_escalation',
              severity: 'high',
              title: 'AlertDialog',
              detail: 'Spec shaping stopped before Guildhall saved the next draft. Open the task to retry from the transcript or reframe the work.',
              taskId: 'task-alert-dialog',
              actionHref: '/task/task-alert-dialog?tab=action',
            },
          ],
        })
      }),
    )

    render(DoThisNext)

    await screen.findByText('Review the blocked task on AlertDialog')
    expect(screen.getByText('Spec shaping stopped before Guildhall saved the next draft. Open the task to retry from the transcript or reframe the work.')).toBeTruthy()
    expect(screen.queryByText(/Recovery needed\. Detail/i)).toBeNull()
    expect(screen.queryByText(/turn limit|kept researching/i)).toBeNull()
  })
})
