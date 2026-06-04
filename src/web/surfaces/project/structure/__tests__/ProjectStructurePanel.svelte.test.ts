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
      ignoredGitRoots: [{ id: 'node-modules', path: 'node_modules' }],
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

  it('uses one project map instead of duplicate chart and setup-review cards', async () => {
    project.detail = {
      ...project.detail!,
      structuralMapReview: null,
    }
    const fetchMock = installProjectGraph({
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

    expect(await screen.findByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    const projectMapSection = document.querySelector('.project-map-section')
    expect(projectMapSection?.tagName).toBe('SECTION')
    expect(projectMapSection?.className).not.toContain('gh-frame-card')
    expect(document.querySelector('.project-map-layout')).not.toBeInTheDocument()
    expect(await screen.findByText('3 work areas')).toBeInTheDocument()
    expect(screen.getByLabelText('Project map summary')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Structural map review' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Work areas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contracts' })).not.toBeInTheDocument()
    expect(screen.queryByText('Setup map missing')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open Threads' })).not.toBeInTheDocument()
    expect(screen.queryByText(/^0 domains$/)).not.toBeInTheDocument()
    expect(await screen.findAllByText('App')).not.toHaveLength(0)
    expect(screen.getAllByText('Docs')).not.toHaveLength(0)
    expect(screen.getAllByText('Model')).not.toHaveLength(0)
  })

  it('keeps project map labels exact and exposes their source paths without a selected-row flow', async () => {
    project.detail = {
      ...project.detail!,
      structuralMapReview: {
        id: 'map-css',
        state: 'accepted',
        domains: [{ id: 'domain:css', label: 'Css', path: 'packages/patch-css' }],
      },
    }
    const fetchMock = installProjectGraph({
      currentProject: { id: 'jess', label: 'Jess', path: '/workspace/jess' },
      localProjects: [
        { id: 'jess', label: 'Jess', role: 'current', path: '/workspace/jess' },
      ],
      structuralDomains: [
        {
          id: 'domain:docs-content',
          label: 'Docs Content',
          kind: 'structural_domain',
          path: 'packages/docs-content',
        },
        {
          id: 'domain:docs-less',
          label: 'Docs Less',
          kind: 'structural_domain',
          path: 'packages/docs-less',
        },
        {
          id: 'domain:css',
          label: 'Css',
          kind: 'structural_domain',
          path: 'packages/patch-css',
        },
        {
          id: 'domain:vscode-extension',
          label: 'vscode-extension',
          kind: 'coordinator_domain',
          path: 'packages/vscode',
        },
      ],
      domainResponsibilities: [],
      dependencyEdges: [],
      contractSurfaces: [],
    })

    render(ProjectStructurePanel)

    await screen.findByRole('heading', { name: 'Project map' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.queryByText('Documentation and knowledge')).not.toBeInTheDocument()
    expect(await screen.findAllByText('docs-content')).not.toHaveLength(0)
    expect(screen.getAllByText('docs-less')).not.toHaveLength(0)
    expect(screen.getAllByText('patch-css')).not.toHaveLength(0)
    expect(screen.getAllByText('vscode')).not.toHaveLength(0)
    expect(screen.queryByText('Css')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Work areas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'patch-css work area, packages/patch-css' })).not.toBeInTheDocument()
    expect(screen.queryByText('Selected work area')).not.toBeInTheDocument()
    expect(screen.getAllByText('packages/docs-content')).not.toHaveLength(0)
    expect(screen.getAllByText('packages/patch-css')).not.toHaveLength(0)
    expect(screen.queryByLabelText('Structural domains')).not.toBeInTheDocument()
  })

  it('explains empty contracts and handoffs without exposing the project index as a section', async () => {
    const fetchMock = installProjectGraph({
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

    expect(await screen.findByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Searchable project index' })).not.toBeInTheDocument()
    expect(screen.queryByText('1 related local project')).not.toBeInTheDocument()
    expect(await screen.findAllByText('Licensing')).not.toHaveLength(0)
    expect(screen.getByText('No contracts are recorded yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scan for contracts' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Declare contract' })).not.toBeInTheDocument()
    expect(screen.getByText('No active handoffs.')).toBeInTheDocument()
  })

  it('explains obscure structure terms with clickable help icons', async () => {
    installProjectGraph({
      currentProject: { id: 'jess', label: 'Jess', path: '/workspace/jess' },
      localProjects: [
        { id: 'jess', label: 'Jess', role: 'current', path: '/workspace/jess' },
      ],
      structuralDomains: [
        {
          id: 'domain:patch-css',
          label: 'patch-css',
          kind: 'structural_domain',
          path: 'packages/patch-css',
        },
      ],
      domainResponsibilities: [],
      dependencyEdges: [],
      contractSurfaces: [{
        id: 'jess.patch-css',
        nodeId: 'contract-surface:jess.patch-css',
        label: '@jesscss/patch-css package contract',
        kind: 'domain_capability',
        authority: 'shared',
        scope: 'project',
        state: 'proposed',
        owningProjectId: 'jess',
        owningProjectLabel: 'Jess',
        domainId: 'domain:patch-css',
        domainLabel: 'patch-css',
        consumerCount: 0,
        invariantCount: 1,
        decisionCount: 0,
        updatedAt: '2026-06-04T00:44:08.860Z',
        scopedReason: 'owner',
        reviewPackets: [],
      }],
    })

    render(ProjectStructurePanel)

    expect(await screen.findByText('Ignored dependency folders')).toBeInTheDocument()
    expect(await screen.findByText('@jesscss/patch-css package contract')).toBeInTheDocument()
    expect(screen.queryByText('proposed')).not.toBeInTheDocument()
    expect(screen.getByText('node_modules')).toBeInTheDocument()
    expect(screen.queryByText('Ignored vendored Git roots')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What does Structure mean?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What does Project map mean?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'What does Work areas mean?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What does Project handoffs mean?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What does Setup audit mean?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'What does Structural map review mean?' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'What does Review status mean?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What does Ignored dependency folders mean?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'What does Tracked here mean?' })).not.toBeInTheDocument()
    expect(screen.queryByText(/legacy areas?/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/legacy structural map/i)).not.toBeInTheDocument()

    const ignoredHelp = screen.getByRole('button', { name: 'What does Ignored dependency folders mean?' })
    expect(ignoredHelp).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(ignoredHelp)
    expect(ignoredHelp).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/node_modules is ignored so installed packages do not become fake work areas/i)
    expect(screen.queryByRole('dialog', { name: 'Ignored dependency folders' })).not.toBeInTheDocument()
    await userEvent.click(document.body)
    expect(ignoredHelp).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.click(ignoredHelp)
    expect(ignoredHelp).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(ignoredHelp)
    expect(ignoredHelp).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'What does Contracts mean?' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Tracked here means this project owns the boundary/i)
    expect(screen.queryByRole('dialog', { name: 'Contracts' })).not.toBeInTheDocument()
  })

  it('keeps cross-project capability linking behind one secondary modal', async () => {
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
    await screen.findAllByText('Editor coordinator')
    expect(screen.queryByRole('heading', { name: 'Structural map review' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Setup audit' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Work areas' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Editor')).not.toHaveLength(0)
    expect(screen.getAllByText('Editor coordinator')).not.toHaveLength(0)
    expect(screen.queryByText('Available to assign')).not.toBeInTheDocument()
    expect(screen.queryByText('2 projects in the local index')).not.toBeInTheDocument()
    expect(screen.queryByText('Reusable work')).not.toBeInTheDocument()
    expect(screen.queryByText('Owned here')).not.toBeInTheDocument()
    expect(screen.queryByText('proposed')).not.toBeInTheDocument()
    expect(screen.queryByText('Selected work area')).not.toBeInTheDocument()
    expect(screen.queryByText(/reusable capabilit/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Assign Editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Link capability' })).toBeInTheDocument()
    expect(screen.getByText('Knit needs the Looma editor.')).toBeInTheDocument()
    expect(screen.getByText('Waiting on provider')).toBeInTheDocument()
    expect(screen.getByText('This project is provider')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Contracts' })).not.toBeInTheDocument()
    expect(screen.getByText('Command menu component API')).toBeInTheDocument()
    expect(screen.getByText('component api')).toBeInTheDocument()
    expect(screen.getByText('2 invariants')).toBeInTheDocument()
    expect(screen.getByText('3 consumers')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Surface review packet' })).toBeInTheDocument()
    expect(screen.getByText('task:task-123')).toBeInTheDocument()
    expect(screen.getByText('Command actions use items')).toBeInTheDocument()
    expect(screen.getByText('Command actions use the shared item vocabulary instead of local action names.')).toBeInTheDocument()
    expect(screen.getByText('Use item-based composition for command menus.')).toBeInTheDocument()
    expect(screen.getByText('Adds an owner-facing surface packet projection.')).toBeInTheDocument()
    expect(screen.getByText('Render review packets in Structure.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Threads' })).toHaveAttribute('href', '/projects/looma-knit/thread')

    expect(screen.queryByText('Token values, product taste, and editor composition stay local.')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Link capability' }))
    await screen.findByRole('dialog', { name: 'Link capability to another project' })
    expect(screen.getByText(/rare case where another registered Guildhall project owns/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Find capability')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Area or contract' })).not.toBeInTheDocument()
    const dropdownButton = screen.getByRole('button', { name: 'Show capabilities' })
    expect(dropdownButton).toHaveClass('capability-combobox-toggle')
    expect(dropdownButton).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(dropdownButton)
    expect(screen.getByRole('button', { name: 'Hide capabilities' })).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByLabelText('Matching capabilities')
    expect(panel).toBeInTheDocument()
    expect(panel.parentElement).toBe(document.body)
    expect(screen.getByRole('button', { name: /Editor - Provider capability/ })).toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Capability' }), 'editor')
    expect(screen.getByRole('button', { name: /Editor - Provider capability/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reusable editor components and APIs/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Editor - Provider capability/ }))
    expect(screen.queryByLabelText('Matching capabilities')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show capabilities' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByLabelText('Selected assignment')).toHaveTextContent('Reusable editor components and APIs.')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Provider project' }), 'looma')
    await userEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/domain-responsibility'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Accept request' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/provider-accept'))).toBe(true))
  })

  it('opens a floating capability dropdown before search and narrows results while typing', async () => {
    const responsibilities = Array.from({ length: 32 }, (_, index) => {
      const domainLabel = `area-${index + 1}`
      return {
        id: `domain:${domainLabel}:provider_capability`,
        domainId: `domain:${domainLabel}`,
        domainLabel,
        facet: 'provider_capability',
        facetLabel: 'Provider capability',
        description: 'What another project must make possible, such as reusable components or APIs.',
        authority: 'provider',
        responsibleProjectId: 'jess',
        responsibleProjectLabel: 'Jess',
        responsibleProjectPath: '/workspace/jess',
        assignable: true,
        assigned: false,
      }
    })
    const fetchMock = installProjectGraph({
      currentProject: { id: 'jess', label: 'Jess', path: '/workspace/jess' },
      localProjects: [
        { id: 'jess', label: 'Jess', role: 'current', path: '/workspace/jess' },
      ],
      localProjectIndex: [
        { id: 'jess', label: 'Jess', role: 'current', path: '/workspace/jess' },
        { id: 'stylekit', label: 'Stylekit', role: 'indexed', path: '/workspace/stylekit' },
      ],
      structuralDomains: [
        { id: 'domain:area-1', label: 'area-1', kind: 'structural_domain', path: 'packages/area-1' },
      ],
      domainResponsibilities: responsibilities,
      dependencyEdges: [],
      contractSurfaces: [],
    })

    render(ProjectStructurePanel)

    await screen.findByRole('heading', { name: 'Project map' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('button', { name: 'Link capability' }))
    expect(screen.getByRole('searchbox', { name: 'Capability' })).toBeInTheDocument()
    const dropdownButton = screen.getByRole('button', { name: 'Show capabilities' })
    expect(dropdownButton).toHaveClass('capability-combobox-toggle')
    expect(dropdownButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByLabelText('Find capability')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Area or contract' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Matching capabilities')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /What another project must make possible/ })).not.toBeInTheDocument()

    await userEvent.click(dropdownButton)
    expect(screen.getByRole('button', { name: 'Hide capabilities' })).toHaveAttribute('aria-expanded', 'true')
    const panel = screen.getByLabelText('Matching capabilities')
    expect(panel).toBeInTheDocument()
    expect(panel.parentElement).toBe(document.body)
    expect(screen.getByText('Showing the first 25 matches. Keep typing to narrow the list.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /area-1 - Provider capability/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /What another project must make possible/ })).not.toBeInTheDocument()

    await userEvent.type(screen.getByRole('searchbox', { name: 'Capability' }), 'area-1')
    expect(screen.getByLabelText('Matching capabilities')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /area-1 - Provider capability/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /What another project must make possible/ })).not.toBeInTheDocument()

    await userEvent.click(document.body)
    expect(screen.queryByLabelText('Matching capabilities')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show capabilities' })).toHaveAttribute('aria-expanded', 'false')
  })
})
