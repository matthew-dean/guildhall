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

function installProjectGraph(projectGraph: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/project/project-graph') {
      return json({ projectGraph })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
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

  it('uses the user-facing structure chart instead of a missing legacy map card', async () => {
    project.detail = {
      ...project.detail!,
      structuralMapReview: null,
    }
    installProjectGraph({
      currentProject: { id: 'font-something', label: 'Font Something', path: '/workspace/font-something' },
      localProjects: [
        { id: 'font-something', label: 'Font Something', role: 'current', path: '/workspace/font-something' },
      ],
      structuralDomains: [
        {
          id: 'domain:app',
          label: 'App',
          kind: 'coordinator_domain',
          coordinatorName: 'App coordinator',
        },
        {
          id: 'domain:docs',
          label: 'Docs',
          kind: 'coordinator_domain',
          coordinatorName: 'Docs coordinator',
        },
        {
          id: 'domain:model',
          label: 'Model',
          kind: 'coordinator_domain',
          coordinatorName: 'Model coordinator',
        },
      ],
      domainResponsibilities: [],
      dependencyEdges: [],
      contractSurfaces: [],
    })

    render(ProjectStructurePanel)

    expect(await screen.findByLabelText('Project structure chart')).toBeInTheDocument()
    expect(screen.queryByText('Legacy structural map missing')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Threads' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^0 domains$/)).not.toBeInTheDocument()
    expect(await screen.findAllByText('Application experience')).not.toHaveLength(0)
    expect(screen.getAllByText('Documentation and knowledge')).not.toHaveLength(0)
    expect(screen.getAllByText('Model behavior and evaluation')).not.toHaveLength(0)
  })

  it('explains empty contracts and handoffs without exposing the project index as a section', async () => {
    installProjectGraph({
      currentProject: { id: 'fair-labor-license', label: 'Fair Labor License', path: '/workspace/fair-labor-license' },
      localProjects: [
        { id: 'fair-labor-license', label: 'Fair Labor License', role: 'current', path: '/workspace/fair-labor-license' },
      ],
      localProjectIndex: [
        { id: 'fair-labor-license', label: 'Fair Labor License', role: 'current', path: '/workspace/fair-labor-license' },
        { id: 'license-commerce', label: 'License Commerce', role: 'indexed', path: '/workspace/license-commerce' },
      ],
      structuralDomains: [
        {
          id: 'domain:licensing',
          label: 'Licensing',
          kind: 'coordinator_domain',
          coordinatorName: 'Licensing coordinator',
        },
      ],
      domainResponsibilities: [],
      dependencyEdges: [],
      contractSurfaces: [],
    })

    render(ProjectStructurePanel)

    expect(await screen.findByLabelText('Project structure chart')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Searchable project index' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 related local project')).not.toBeInTheDocument()
    expect(await screen.findAllByText('Licensing and policy')).not.toHaveLength(0)
    expect(screen.getByText('No contracts are tracked yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan for contracts' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Declare contract' })).toBeInTheDocument()
    expect(screen.getByText('No active handoffs.')).toBeInTheDocument()
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
            ],
            localProjectIndex: [
              { id: 'looma-knit', label: 'Looma + Knit', role: 'current', path: '/workspace/looma-knit' },
              { id: 'looma', label: 'Looma', role: 'indexed', path: '/workspace/looma-knit/looma' },
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
            contractSurfaces: [{
              id: 'component-api.command-menu',
              nodeId: 'contract-surface:component-api.command-menu',
              label: 'Command menu component API',
              kind: 'component_api',
              authority: 'shared',
              scope: 'project',
              state: 'accepted',
              owningProjectId: 'looma-knit',
              owningProjectLabel: 'Looma + Knit',
              domainId: 'domain:editor',
              domainLabel: 'Editor',
              consumerCount: 3,
              invariantCount: 2,
              decisionCount: 1,
              updatedAt: '2026-06-02T12:00:00.000Z',
              scopedReason: 'owner',
              reviewPackets: [{
                id: 'surface-review:task-123:component-api.command-menu',
                surfaceId: 'component-api.command-menu',
                currentSpecRef: 'task:task-123',
                knownConsumers: ['Thread', 'Work'],
                existingInvariants: [{
                  id: 'command-actions-use-items',
                  label: 'Command actions use items',
                  rule: 'Command actions use the shared item vocabulary instead of local action names.',
                }],
                existingDecisions: [{
                  id: 'decision-command-menu-items',
                  summary: 'Use item-based composition for command menus.',
                  decidedAt: '2026-06-02T10:00:00.000Z',
                }],
                siblingSpecRefs: ['task:task-077'],
                driftFindings: ['Two specs name command actions differently.'],
                currentDeltaSummary: 'Adds an owner-facing surface packet projection.',
                proofObligations: ['Render review packets in Structure.'],
                reviewFocus: ['Does this preserve Thread as the discussion surface?'],
              }],
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

    render(ProjectStructurePanel)

    await screen.findByRole('heading', { name: 'Structure' })
    await screen.findByText('Editor - Editor coordinator')
    expect(screen.getByRole('heading', { name: 'Structural map review' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Work areas' })).toBeInTheDocument()
    expect(screen.getAllByText('Editor workflow and interface')).not.toHaveLength(0)
    expect(screen.getByText('Editor - Editor coordinator')).toBeInTheDocument()
    expect(screen.queryByText('Available to assign')).not.toBeInTheDocument()
    expect(screen.queryByText('2 projects in the local index')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Assign Editor workflow and interface' })).toBeInTheDocument()
    expect(screen.getByText('Knit needs the Looma editor.')).toBeInTheDocument()
    expect(screen.getByText('Waiting on provider')).toBeInTheDocument()
    expect(screen.getByText('This project is provider')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Contracts' })).toBeInTheDocument()
    expect(screen.getByText('Command menu component API')).toBeInTheDocument()
    expect(screen.getByText('component api')).toBeInTheDocument()
    expect(screen.getByText('2 invariants')).toBeInTheDocument()
    expect(screen.getByText('3 consumers')).toBeInTheDocument()
    expect(screen.getAllByText('Owned here')).not.toHaveLength(0)
    expect(screen.getByRole('heading', { name: 'Surface review packet' })).toBeInTheDocument()
    expect(screen.getByText('task:task-123')).toBeInTheDocument()
    expect(screen.getByText('Command actions use items')).toBeInTheDocument()
    expect(screen.getByText('Command actions use the shared item vocabulary instead of local action names.')).toBeInTheDocument()
    expect(screen.getByText('Use item-based composition for command menus.')).toBeInTheDocument()
    expect(screen.getByText('Adds an owner-facing surface packet projection.')).toBeInTheDocument()
    expect(screen.getByText('Render review packets in Structure.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Threads' })).toHaveAttribute('href', '/projects/looma-knit/thread')

    expect(screen.getByText('Token values, product taste, and editor composition stay local.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Assign Editor workflow and interface' }))
    await screen.findByRole('dialog', { name: 'Assign Editor' })
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find provider project' }), 'loo')
    await userEvent.click(screen.getByRole('button', { name: 'Looma' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/domain-responsibility'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Accept request' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/provider-accept'))).toBe(true))
  })
})
