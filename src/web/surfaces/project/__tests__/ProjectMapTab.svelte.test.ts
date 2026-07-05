// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { path } from '../../../lib/nav.svelte.js'
import ProjectMapTab from '../ProjectMapTab.svelte'

describe('ProjectMapTab', () => {
  afterEach(() => {
    cleanup()
    path.value = '/'
    vi.restoreAllMocks()
  })

  it('renders the 1,000-foot capability lanes and honest source trail from the orientation spine', async () => {
    const { container } = render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [{ id: 'task-a', title: 'Coherence reviewer MVP' }],
        orientationSpine: {
          charter: {
            goal: 'Build a fiction-first planning and review harness.',
            targetAudience: 'Authors and agent builders.',
            source: 'inferred',
          },
          executionBoundary: {
            label: 'Headless proof',
            mode: 'headless',
            proofStyle: 'script_only',
            detail: 'The current task scope should be proven with scripts or commands before it is treated as ready.',
            source: { kind: 'charter', refs: ['project-brief.md'], confidence: 'high', inferred: false },
          },
          proofContracts: [{
            nodeId: 'work:task-a',
            title: 'Coherence reviewer MVP',
            state: 'needed',
            required: ['Script or command proof for Coherence reviewer MVP.'],
            missing: ['Script or command proof for Coherence reviewer MVP.'],
            verified: [],
            refs: ['task:task-a'],
          }],
          scope: {
            label: 'Current task scope',
            source: 'inferred',
          },
          selectedRelease: {
            id: 'headless-mvp',
            label: 'Headless MVP',
            kind: 'release',
            state: 'active',
            source: { kind: 'release_plan', refs: ['import:docs/harness/implementation-roadmap.md'], confidence: 'high', inferred: false },
          },
          summary: {
            selectedScopeLabel: 'Headless MVP',
            selectedReleaseLabel: 'Headless MVP',
            includedWorkCount: 2,
            deferredWorkCount: 0,
            progress: {
              total: 2,
              specced: 1,
              active: 1,
              blocked: 0,
              proven: 0,
            },
          },
          roots: [
            {
              id: 'area:coherence',
              kind: 'area',
              title: 'Coherence',
              summary: 'Coherence capability lane: 2 work items.',
              maturity: 'active',
              progress: { total: 2, specced: 1, active: 1 },
              source: { kind: 'inferred', inferred: true, refs: ['task:task-a'] },
              refs: { taskIds: ['task-a'], structuralDomainIds: ['domain:coherence'] },
              children: [
                {
                  id: 'work:task-a',
                  title: 'Coherence reviewer MVP',
                  maturity: 'active',
                  progress: { total: 1, active: 1 },
                  visibility: { kind: 'primary', countInProjectTotals: true },
                  refs: { taskIds: ['task-a'] },
                  source: { kind: 'task', refs: ['task:task-a'] },
                },
                {
                  id: 'work:task-a-proof',
                  title: 'Internal CLI proof',
                  maturity: 'ready',
                  progress: { total: 1, ready: 1 },
                  visibility: { kind: 'internal_step', countInProjectTotals: false },
                  refs: { taskIds: ['task-a-proof'] },
                  source: { kind: 'task', refs: ['task:task-a-proof'] },
                },
                {
                  id: 'capability:authoring-loop',
                  title: 'Author drafts or imports chapters.',
                  maturity: 'idea',
                  progress: { total: 0 },
                  visibility: { kind: 'supporting', countInProjectTotals: false },
                  refs: { taskIds: [] },
                  source: { kind: 'inferred', refs: ['import:docs/harness/architecture-notes.md'], inferred: true },
                },
              ],
            },
          ],
          nodes: {
            'work:task-a': {
              id: 'work:task-a',
              title: 'Coherence reviewer MVP',
              source: { kind: 'task', refs: ['task:task-a', 'import:docs/harness/implementation-roadmap.md'] },
              refs: { taskIds: ['task-a'] },
            },
          },
          scopeRows: [
            {
              taskId: 'task-a',
              nodeId: 'work:task-a',
              title: 'Coherence reviewer MVP',
              scope: 'included',
              eligibilityReason: 'included',
              hierarchyRole: 'root',
              status: 'in_progress',
              handoffState: 'paused',
              blocksStart: false,
              blocksRelease: false,
              humanBlocking: false,
              sourceRefs: ['/Users/matthew/git/oss/narrative-harness/docs/harness/implementation-roadmap.md'],
            },
            {
              taskId: 'task-later',
              nodeId: 'work:task-later',
              title: 'Production story UI',
              scope: 'deferred',
              eligibilityReason: 'deferred',
              hierarchyRole: 'root',
              status: 'ready',
              handoffState: 'deferred',
              blocksStart: false,
              blocksRelease: false,
              humanBlocking: false,
              sourceRefs: ['import:docs/harness/architecture-notes.md'],
            },
          ],
          gaps: [{
            kind: 'proof_needed',
            label: 'Proof needed: Coherence reviewer MVP.',
            severity: 'warn',
            refs: ['task:task-a'],
          }],
          sourceHealth: { inferred: 1, gaps: 1 },
        },
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByRole('heading', { name: 'Project map' })).toBeInTheDocument()
    expect(screen.getByText('Build a fiction-first planning and review harness.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeInTheDocument()
    expect(screen.getAllByText('Headless MVP').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Coherence').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Coherence reviewer MVP').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Internal CLI proof')).not.toBeInTheDocument()
    expect(container.textContent).toMatch(/internal step[s]? hidden/i)
    await fireEvent.click(screen.getByRole('button', { name: 'Show internal steps' }))
    expect(screen.getByText('Internal CLI proof')).toBeInTheDocument()
    expect(screen.getAllByText('Author drafts or imports chapters.').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: 'Hide internal steps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proof mode' })).toBeInTheDocument()
    expect(screen.getAllByText('Headless proof').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Scope ledger' })).toBeInTheDocument()
    expect(screen.getByText('1 current work item · 1 later work item')).toBeInTheDocument()
    expect(screen.getByText('Paused · directly assigned · Source: implementation-roadmap.md')).toBeInTheDocument()
    expect(screen.getByText('Deferred · later scope · Source: architecture-notes.md')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proof contract' })).toBeInTheDocument()
    expect(screen.getByText('Script or command proof for Coherence reviewer MVP.')).toBeInTheDocument()
    expect(screen.getByText('2 source documents')).toBeInTheDocument()
    expect(screen.getByText('implementation-roadmap.md, architecture-notes.md')).toBeInTheDocument()
    expect(screen.getByText('Headless MVP contains 2 assigned work items and 0 later.')).toBeInTheDocument()
    expect(screen.getByText('Source: implementation-roadmap.md')).toBeInTheDocument()
    expect(screen.getAllByText('Source: architecture-notes.md').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Document-level artifact references are not attached to every lane yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gaps to resolve' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open questions' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.source-fact')).toHaveLength(5)
    expect(container.querySelector('.source-row')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Coherence reviewer MVP Active' }))
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')

    path.value = '/'
    await fireEvent.click(screen.getByRole('button', { name: 'Proof Needed Proof needed: Coherence reviewer MVP. Open the linked work item to resolve this gap.' }))
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')
  })

  it('bounds the default map to the selected release instead of rendering every imported root', () => {
    const noisyRoots = Array.from({ length: 80 }, (_, index) => ({
      id: `work:later-${index}`,
      kind: 'work',
      title: `Later imported work ${index}`,
      summary: 'Deferred work from a broader import.',
      maturity: 'deferred',
      progress: { total: 1, deferred: 1 },
      visibility: { kind: 'supporting', countInProjectTotals: true },
      source: { kind: 'inferred', refs: ['import:docs/later.md'], inferred: true },
    }))

    render(ProjectMapTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        tasks: [],
        orientationSpine: {
          charter: {
            goal: 'Keep Looma generic while letting Knit product needs drive Looma primitive priority.',
            source: 'inferred',
          },
          selectedRelease: {
            id: 'stage-1-v1-release-hardening',
            label: 'Stage 1: V1 Release Hardening',
            kind: 'release',
            state: 'active',
            source: { kind: 'release_plan', refs: ['import:knit/docs/release-plan.md'], confidence: 'medium', inferred: false },
            nodeIds: ['work:current-a', 'work:current-b'],
            deferredNodeIds: noisyRoots.map(root => root.id),
          },
          summary: {
            selectedScopeLabel: 'Stage 1: V1 Release Hardening',
            selectedReleaseLabel: 'Stage 1: V1 Release Hardening',
            includedWorkCount: 2,
            deferredWorkCount: 80,
            progress: { total: 82, deferred: 80 },
          },
          roots: [
            {
              id: 'work:current-a',
              kind: 'work',
              title: 'Unit tests: use-collections',
              summary: 'Current release work.',
              maturity: 'idea',
              progress: { total: 1 },
              visibility: { kind: 'primary', countInProjectTotals: true },
              source: { kind: 'task', refs: ['import:knit/docs/release-plan.md'] },
            },
            {
              id: 'work:current-b',
              kind: 'work',
              title: 'E2E tests: login flow',
              summary: 'Current release work.',
              maturity: 'idea',
              progress: { total: 1 },
              visibility: { kind: 'primary', countInProjectTotals: true },
              source: { kind: 'task', refs: ['import:knit/docs/release-plan.md'] },
            },
            ...noisyRoots,
          ],
          nodes: {},
          gaps: [],
          sourceHealth: { inferred: 80, gaps: 0 },
        },
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Release scope' })).toBeInTheDocument()
    expect(screen.getAllByText('Stage 1: V1 Release Hardening').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Unit tests: use-collections')).toBeInTheDocument()
    expect(screen.getByText('E2E tests: login flow')).toBeInTheDocument()
    expect(screen.queryByText('Later imported work 0')).not.toBeInTheDocument()
    expect(screen.queryByText('Later imported work 79')).not.toBeInTheDocument()
    expect(screen.getByText('Stage 1: V1 Release Hardening contains 2 assigned work items and 80 later.')).toBeInTheDocument()
  })

  it('lets the user select a different release boundary from the map', async () => {
    const refresh = vi.fn()
    const fetchCalls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      return new Response(JSON.stringify({ selectedReleaseId: 'release-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [],
        orientationSpine: {
          charter: { goal: 'Build a fiction-first planning and review harness.', source: 'inferred' },
          selectedRelease: {
            id: 'release-1',
            label: 'Headless MVP',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:task-a'],
          },
          releases: [
            {
              id: 'release-1',
              label: 'Headless MVP',
              kind: 'release',
              state: 'active',
              source: 'release_plan',
              nodeIds: ['work:task-a'],
            },
            {
              id: 'release-2',
              label: 'Agent review proof',
              kind: 'release',
              state: 'planned',
              source: 'release_plan',
              nodeIds: ['work:task-b'],
            },
          ],
          summary: {
            selectedScopeLabel: 'Headless MVP',
            selectedReleaseLabel: 'Headless MVP',
            includedWorkCount: 1,
            deferredWorkCount: 1,
            progress: { total: 2 },
          },
          roots: [],
          nodes: {},
          gaps: [],
          sourceHealth: { inferred: 0, gaps: 0 },
        },
      },
      activeProjectId: 'narrative-harness',
      onReleaseSelected: refresh,
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Select' }))

    expect(fetchCalls).toEqual([
      {
        url: '/api/project/release/select?projectId=narrative-harness',
        body: { releaseId: 'release-2', projectId: 'narrative-harness' },
      },
    ])
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
