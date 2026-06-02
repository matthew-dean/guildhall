// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { readFileSync } from 'node:fs'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ProjectStructurePanel from '../ProjectStructurePanel.svelte'
import { path } from '../../../../lib/nav.svelte.js'
import { project } from '../../../../lib/project.svelte.js'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function installProjectState() {
  window.history.replaceState({}, '', '/projects/looma-knit/structure')
  path.value = '/projects/looma-knit/structure'
  project.error = null
  project.detail = {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/workspace/looma-knit',
    tasks: [],
    structuralMapReview: {
      id: 'map-1',
      state: 'accepted',
      domains: [{ id: 'domain:editor', label: 'Editor' }],
    },
    config: {
      coordinators: [
        {
          id: 'editor-coordinator',
          name: 'Editor coordinator',
          domain: 'Editor',
          mandate: 'Keep editor work scoped.',
        },
      ],
    },
  }
}

describe('ProjectStructurePanel', () => {
  beforeEach(() => {
    installProjectState()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    project.detail = null
    project.error = null
  })

  it('keeps project graph ownership out of SettingsTab', () => {
    const settingsSource = readFileSync('src/web/surfaces/project/SettingsTab.svelte', 'utf8')

    expect(settingsSource).not.toMatch(/ProjectGraphView/)
    expect(settingsSource).not.toContain('/api/project/project-graph')
    expect(settingsSource).not.toMatch(/assignmentPicker/)
  })

  it('surfaces project graph domain assignment and inbound request actions', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/project/project-graph' && init?.method !== 'POST') {
        return json({
          projectGraph: {
            currentProject: { id: 'looma-knit', label: 'Looma + Knit', path: '/workspace/looma-knit' },
            localProjects: [
              { id: 'looma-knit', label: 'Looma + Knit', role: 'current', path: '/workspace/looma-knit' },
              { id: 'looma', label: 'Looma', role: 'related', path: '/workspace/looma-knit/looma' },
            ],
            structuralDomains: [
              {
                id: 'domain:editor',
                label: 'Editor',
                kind: 'structural_domain',
                coordinatorId: 'editor-coordinator',
                coordinatorName: 'Editor coordinator',
              },
            ],
            domainResponsibilities: [
              {
                id: 'domain:editor:provider_capability',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'provider_capability',
                facetLabel: 'Provider capability',
                description: 'Reusable editor components and APIs.',
                authority: 'provider',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: true,
                assigned: false,
              },
              {
                id: 'domain:editor:consumer_configuration',
                domainId: 'domain:editor',
                domainLabel: 'Editor',
                facet: 'consumer_configuration',
                facetLabel: 'Consumer configuration',
                description: 'Token values, product taste, and editor composition stay local.',
                authority: 'consumer',
                responsibleProjectId: 'looma-knit',
                responsibleProjectLabel: 'Looma + Knit',
                responsibleProjectPath: '/workspace/looma-knit',
                assignable: false,
                assigned: false,
              },
            ],
            dependencyEdges: [{
              id: 'edge-knit-looma',
              state: 'submitted',
              consumerProjectId: 'knit',
              consumerProjectLabel: 'Knit',
              providerProjectId: 'looma-knit',
              providerProjectLabel: 'Looma + Knit',
              domainId: 'domain:editor',
              domainLabel: 'Editor',
              consumerNeed: 'Knit needs the Looma editor.',
              unresolved: true,
            }],
          },
        })
      }
      if (url.pathname === '/api/project/project-graph/domain-responsibility') {
        expect(init?.method).toBe('POST')
        const body = JSON.parse(String(init?.body ?? '{}'))
        expect(body).toEqual(expect.objectContaining({
          domainId: 'domain:editor',
          facet: 'provider_capability',
          responsibleProjectId: 'looma',
        }))
        return json({ projectGraph: { localProjects: [], domainResponsibilities: [] } })
      }
      if (url.pathname === '/api/project/project-graph/requests/edge-knit-looma/provider-accept') {
        expect(init?.method).toBe('POST')
        return json({ projectGraph: { localProjects: [], dependencyEdges: [] } })
      }
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(ProjectStructurePanel)

    await screen.findByRole('heading', { name: 'Project graph' })
    await screen.findByText('Detected here - routed by Editor coordinator')
    expect(screen.getByRole('heading', { name: 'Structural map' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Domains' })).toBeInTheDocument()
    expect(screen.getByText('Detected here - routed by Editor coordinator')).toBeInTheDocument()
    expect(screen.getByText('Available to assign')).toBeInTheDocument()
    expect(screen.getByText('2 projects in the local index')).toBeInTheDocument()
    expect(screen.getByText('Knit needs the Looma editor.')).toBeInTheDocument()
    expect(screen.getByText('Waiting on provider')).toBeInTheDocument()
    expect(screen.getByText('This project is provider')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /open editor domain/i }))
    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument()
    expect(screen.getByText('Reusable editor components and APIs.')).toBeInTheDocument()
    expect(screen.getByText('Token values, product taste, and editor composition stay local.')).toBeInTheDocument()
    expect(container.querySelector('.graph-card .utility-panel')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Assign to project' }))
    await screen.findByRole('dialog', { name: 'Assign Editor' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find project' }), 'loo')
    await userEvent.click(screen.getByRole('button', { name: 'Looma' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/domain-responsibility'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Accept request' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/provider-accept'))).toBe(true))
  })
})
