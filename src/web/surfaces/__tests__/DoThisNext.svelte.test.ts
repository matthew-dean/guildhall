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
      expect(String(input)).toBe('/api/project/inbox?projectId=looma-knit')
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

    await userEvent.click(screen.getByRole('button', { name: /open ready/i }))

    expect(path.value).toBe('/projects/looma-knit/settings/ready')
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
    await userEvent.click(screen.getByRole('button', { name: /1 more in inbox/i }))

    expect(path.value).toBe('/projects/looma-knit/inbox')
  })
})
