// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import FleetNeedsYou from '../FleetNeedsYou.svelte'
import { path } from '../../lib/nav.svelte.js'
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('FleetNeedsYou', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/needs-you')
    path.value = '/needs-you'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('groups alert-owned needs-you items by project and routes item actions with the project id', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      expect(url.pathname).toBe('/api/fleet/attention')
      return json({
        groups: [
          {
            project: { id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' },
            items: [{
              kind: 'workspace_import_pending',
              severity: 'medium',
              title: 'Review imported notes',
              detail: 'Guildhall found planning notes to reconcile.',
              actionHref: '/workspace-import',
            }],
            error: null,
          },
          {
            project: { id: 'fair-labor-license', path: '/repo/fair-labor-license', name: 'Fair Labor License' },
            items: [{
              kind: 'bootstrap_missing',
              severity: 'high',
              title: 'Provider warning',
              detail: 'Provider setup needs attention.',
              actionHref: '/providers',
            }],
            error: null,
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await screen.findByText('Looma + Knit')
    await screen.findByText('Fair Labor License')
    expect(screen.getByText('Review imported notes')).toBeTruthy()
    expect(screen.getByText('Provider warning')).toBeTruthy()
    const summary = screen.getByLabelText('Needs-you summary')
    expect(summary.textContent).toContain('2 projects need a decision.')
    expect(summary.textContent).not.toContain('total item')
    expect(screen.queryByRole('button', { name: /^queue$/i })).toBeNull()
    expect(screen.queryByText('/repo/looma-knit')).toBeNull()

    await userEvent.click(screen.getAllByRole('button', { name: 'Review import' })[0])

    expect(path.value).toBe('/projects/looma-knit/workspace-import')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('loads from the canonical fleet attention endpoint without per-project inbox fetches', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      expect(url.pathname).toBe('/api/fleet/attention')
      return json({
        groups: [{
          project: { id: 'one', path: '/repo/one', name: 'One' },
          items: [{
            kind: 'workspace_import_pending',
            severity: 'medium',
            title: 'First import review',
            detail: 'Review this.',
            actionHref: '/workspace-import',
          }],
          error: null,
        }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await screen.findByText('First import review')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/inbox'))).toBe(false)
  })

  it('shows only the current API-ranked decision and defers the rest to the project queue', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      expect(url.pathname).toBe('/api/fleet/attention')
      return json({
        groups: [{
          project: { id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' },
          items: [
            {
              kind: 'spec_fill_pending',
              severity: 'medium',
              title: 'Block menu',
              detail: 'Optional cleanup.',
              taskId: 'task-block-menu',
              actionHref: '/task/task-block-menu?tab=spec',
            },
            {
              kind: 'spec_fill_pending',
              severity: 'medium',
              title: 'Block menu',
              detail: 'Optional cleanup.',
              taskId: 'task-block-menu',
              actionHref: '/task/task-block-menu?tab=spec',
            },
          ],
          error: null,
        }],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(FleetNeedsYou)

    await screen.findByText('Looma + Knit')
    expect(screen.getByText('Block menu')).toBeTruthy()
    expect(screen.getByText('1 more decision')).toBeTruthy()
  })

  it('uses the shared action button label for a projected owner decision', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      groups: [{
        project: { id: 'looma-knit', path: '/repo/looma-knit', name: 'Looma + Knit' },
        items: [{
          kind: 'project_action',
          severity: 'medium',
          title: 'Review the release spec',
          detail: 'Approve the spec before work can continue.',
          taskId: 'task-014',
          actionHref: '/work?task=task-014',
          buttonLabel: 'Review spec',
        }],
        error: null,
      }],
    })))

    render(FleetNeedsYou)

    await userEvent.click(await screen.findByRole('button', { name: 'Review spec' }))
    expect(path.href).toBe('/projects/looma-knit/work?task=task-014')
  })

  it('names the setup action instead of presenting a vague open control', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      groups: [{
        project: { id: 'commerce-project', path: '/repo/commerce-project', name: 'Commerce project' },
        items: [{
          kind: 'setup_pending',
          severity: 'medium',
          title: 'Give the project direction',
          detail: 'Start with a short brief.',
          actionHref: '/thread',
        }],
        error: null,
      }],
    })))

    render(FleetNeedsYou)

    expect(await screen.findByRole('button', { name: 'Start setup' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  })
})
