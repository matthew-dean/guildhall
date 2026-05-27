// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InboxTab from '../InboxTab.svelte'
import { path } from '../../../lib/nav.svelte.js'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('InboxTab', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/projects/looma-knit/notifications')
    path.value = '/projects/looma-knit/notifications'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('loads its own inbox data, navigates scoped actions, and shows low-priority items in the ledger', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/inbox') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        return json({
          items: [
            {
              id: 'q1',
              kind: 'agent_question_pending',
              severity: 'high',
              title: 'Choose link editor scope',
              detail: 'Coordinator needs a scope decision.',
              actionHref: '/task/task-migration?tab=current',
            },
            {
              id: 'cleanup',
              kind: 'workspace_import_pending',
              severity: 'low',
              title: 'Review imported notes',
              detail: 'Optional project note cleanup.',
              actionHref: '/workspace-import',
            },
            {
              id: 'levers',
              kind: 'lever_questions',
              severity: 'low',
              title: '18 levers at system defaults',
              detail: 'Defaults are still in effect for some project policies.',
              defaultCount: 18,
              actionHref: '/settings/advanced',
            },
          ],
        })
      }
      return json({})
    }))

    render(InboxTab)

    await screen.findByText('Choose link editor scope')
    expect(screen.queryByText('Optional cleanup')).not.toBeInTheDocument()
    expect(screen.getByText('Review imported notes')).toBeInTheDocument()
    expect(screen.getByText(/Safe defaults are active/)).toBeInTheDocument()
    expect(screen.getByText(/Review them only if you want to tune autonomy, recovery, or review strictness/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Choose link editor scope' }))
    expect(window.location.pathname + window.location.search).toBe('/projects/looma-knit/task/task-migration?tab=current')

    path.value = '/projects/looma-knit/notifications'
    await userEvent.click(screen.getByRole('button', { name: 'Review imported notes' }))
    expect(path.value).toBe('/projects/looma-knit/workspace-import')
  })

  it('lets safe agent-handled inbox items run autonomously and refreshes afterward', async () => {
    const refresh = vi.fn()
    const items = [
      {
        id: 'bootstrap',
        kind: 'bootstrap_missing',
        severity: 'high',
        title: 'Let Guildhall inspect the repo',
        detail: 'Bootstrap has not been verified yet.',
        actionHref: '/settings/ready',
      },
      {
        id: 'dismissable',
        kind: 'spec_fill_pending',
        severity: 'medium',
        title: 'Fill in acceptance criteria',
        detail: 'Task needs a verifier-visible finish line.',
        actionHref: '/task/task-link-editor',
        dismissEndpoint: '/api/project/inbox/dismiss/spec-fill/task-link-editor',
      },
    ] as any
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/bootstrap/run') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.pathname === '/api/project/inbox/dismiss/spec-fill/task-link-editor') {
        expect(url.searchParams.get('projectId')).toBe('looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(InboxTab, {
      items,
      loaded: true,
      refresh,
    })
    refresh.mockClear()

    await userEvent.click(screen.getByRole('button', { name: /let agent verify/i }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
  })

  it('shows blocking required migrations without offering dismissal', async () => {
    render(InboxTab, {
      items: [
        {
          id: 'migration:0.8.0/project-state-layout',
          kind: 'required_migration',
          severity: 'high',
          title: 'Required migration: Move legacy project memory into split project state',
          detail: 'Run this migration before Guildhall can update the project.',
          actionHref: '/migrations',
          status: 'open',
          resolution: undefined,
          blocking: true,
          dismissible: false,
        },
      ] as any,
      loaded: true,
    })

    expect(screen.getByText('Required migration: Move legacy project memory into split project state')).toBeInTheDocument()
    expect(screen.getByText('Open')).toBeInTheDocument()
    expect(screen.getByText(/Migrate/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument()
  })

  it('counts the visible ledger rows instead of only actionable rows', async () => {
    render(InboxTab, {
      items: [
        {
          id: 'open-high',
          kind: 'agent_question_pending',
          severity: 'high',
          title: 'Choose scope',
          detail: 'A decision is needed.',
          actionHref: '/thread',
          status: 'open',
        },
      ] as any,
      history: [
        {
          id: 'open-high',
          kind: 'agent_question_pending',
          severity: 'high',
          title: 'Choose scope',
          detail: 'A decision is needed.',
          actionHref: '/thread',
          status: 'open',
        },
        {
          id: 'resolved',
          kind: 'required_migration',
          severity: 'high',
          migrationId: '0.8.0/project-state-layout',
          title: 'Required migration',
          detail: 'Done.',
          actionHref: '/migrations',
          status: 'resolved',
          resolution: 'migrated',
        },
        {
          id: 'low',
          kind: 'lever_questions',
          severity: 'low',
          title: 'Levers',
          detail: 'Optional.',
          actionHref: '/settings/advanced',
          status: 'open',
        },
      ] as any,
      loaded: true,
    })

    expect(screen.getByText('(3 items)')).toBeInTheDocument()
    expect(screen.getByText('Migrated')).toBeInTheDocument()
  })

  it('surfaces inbox load and handler failures without hiding the row', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/inbox') return json({}, 500)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(InboxTab)

    await screen.findByText("Couldn't load inbox: HTTP 500")
    cleanup()

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/bootstrap/run') return json({ error: 'Bootstrap command failed' }, 500)
      return json({})
    }))

    render(InboxTab, {
      items: [
        {
          id: 'bootstrap',
          kind: 'bootstrap_missing',
          severity: 'high',
          title: 'Let Guildhall inspect the repo',
          detail: 'Bootstrap has not been verified yet.',
          actionHref: '/settings/ready',
        },
      ] as any,
      loaded: true,
    })

    await userEvent.click(screen.getByRole('button', { name: /let agent verify/i }))
    await screen.findByText('Failed: Bootstrap command failed')
    expect(screen.getByText('Let Guildhall inspect the repo')).toBeInTheDocument()
  })

  it('shows an empty caught-up state when no inbox items remain', async () => {
    render(InboxTab, {
      items: [],
      loaded: true,
    })

    expect(screen.getByText('All caught up — nothing is waiting on you right now.')).toBeInTheDocument()
  })
})
