// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { path } from '../../../lib/nav.svelte.js'
import ProjectMapTab from '../ProjectMapTab.svelte'

describe('ProjectMapTab', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/project/source-capabilities')) {
        return new Response(JSON.stringify({ availability: 'empty', capabilities: [] }), { status: 200 })
      }
      return new Response(JSON.stringify({ error: 'not mocked' }), { status: 404 })
    }))
  })

  afterEach(() => {
    cleanup()
    path.value = '/'
    vi.restoreAllMocks()
  })

  it('distinguishes structured capability scope from visible source evidence without a second catalog read', () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'not mocked' }), { status: 404 }))
    vi.stubGlobal('fetch', fetch)
    render(ProjectMapTab, {
      activeProjectId: 'narrative-harness',
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        sourceCapabilityCatalog: { availability: 'ready', total: 2, planned: 2, retired: 0 },
        orientationSpine: {
          summary: { includedWorkCount: 0, deferredWorkCount: 0 },
          roots: [],
          nodes: {},
          sourceTrail: [{ label: 'Source docs', value: '1 source document', detail: 'release-plan.md', tone: 'ok' }],
        },
      },
    })

    expect(screen.getByText('2 structured capabilities')).toBeInTheDocument()
    expect(screen.getByText('Typed source scope can be allocated to planning work without reading document prose as authority.')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
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
          release: {
            id: 'headless-mvp',
            label: 'Headless MVP',
            state: 'blocked',
            blockers: [
              {
                id: 'repository-followup:repo:1',
                label: '3 local commits are not pushed.',
              },
            ],
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
            kind: 'source_conflict',
            label: 'Possible duplicate work is split across scopes: Coherence reviewer MVP overlaps Coherence reviewer CLI proof.',
            severity: 'warn',
            refs: ['import:docs/harness/implementation-roadmap.md', 'task:task-a'],
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
    expect(screen.getByText('1 visible scope row · 1 later scope row')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.queryByText('Now')).not.toBeInTheDocument()
    expect(screen.getByText('Paused · directly assigned · Source: implementation-roadmap.md')).toBeInTheDocument()
    expect(screen.getByText('Deferred · later scope · Source: architecture-notes.md')).toBeInTheDocument()
    const sourceConflictGap = screen.getByRole('button', {
      name: /Possible duplicate work is split across scopes: Coherence reviewer MVP overlaps Coherence reviewer CLI proof/i,
    })
    await fireEvent.click(sourceConflictGap)
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')
    expect(screen.getByRole('heading', { name: 'Proof contract' })).toBeInTheDocument()
    expect(screen.getByText('Script or command proof for Coherence reviewer MVP.')).toBeInTheDocument()
    expect(screen.getByText('2 source documents')).toBeInTheDocument()
    expect(screen.getByText('implementation-roadmap.md, architecture-notes.md')).toBeInTheDocument()
    expect(screen.getByText('Headless MVP contains 2 executable work items and 0 later.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Release blockers' })).toBeInTheDocument()
    expect(screen.getByText('3 local commits are not pushed.')).toBeInTheDocument()
    expect(screen.getByText('Source: implementation-roadmap.md')).toBeInTheDocument()
    expect(screen.getAllByText('Source: architecture-notes.md').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Document-level artifact references are not attached to every lane yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gaps to resolve' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open questions' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.source-fact')).toHaveLength(6)
    expect(container.querySelector('.source-row')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Coherence reviewer MVP Active' }))
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')
  })

  it('offers explicit source-conflict reconciliation choices', async () => {
    const fetchCalls: Array<{ url: string; body: unknown }> = []
    const refresh = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        url: String(input),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }))

    render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [
          {
            id: 'task-rich',
            title: 'Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing.',
          },
          {
            id: 'task-narrow',
            title: 'Select and prove a DeepInfra drafting model for broad-genre chapter writing.',
          },
        ],
        orientationSpine: {
          selectedRelease: {
            id: 'stage-1',
            label: 'Stage 1',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:task-narrow'],
          },
          summary: {
            selectedScopeLabel: 'Stage 1',
            selectedReleaseLabel: 'Stage 1',
            includedWorkCount: 1,
            deferredWorkCount: 1,
            progress: { total: 2 },
          },
          roots: [],
          nodes: {},
          gaps: [{
            kind: 'source_conflict',
            label: 'Possible duplicate work is split across scopes.',
            severity: 'warn',
            refs: ['task:task-rich', 'task:task-narrow'],
          }],
          sourceHealth: { inferred: 0, gaps: 1 },
        },
      },
      activeProjectId: 'narrative-harness',
      onReleaseSelected: refresh,
    })

    expect(screen.getByText('Choose which task is the source of truth for the current scope. Guildhall will archive the duplicate and preserve an audit note.')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', {
      name: 'Keep "Select and prove a DeepInfra drafting model for broad-genre and legal adult fiction chapter writing."',
    }))

    expect(fetchCalls.filter(call => call.url.includes('/api/project/source-conflicts/reconcile'))).toEqual([{
      url: '/api/project/source-conflicts/reconcile?projectId=narrative-harness',
      body: {
        keepTaskId: 'task-rich',
        archiveTaskId: 'task-narrow',
        selectedReleaseId: 'stage-1',
        projectId: 'narrative-harness',
      },
    }])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('renders source trail facts from the shared orientation spine read model', () => {
    render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [],
        orientationSpine: {
          charter: {
            goal: 'Build a fiction-first planning and review harness.',
            targetAudience: null,
            source: 'inferred',
          },
          executionBoundary: {
            label: 'Headless proof',
            mode: 'headless',
            proofStyle: 'script_only',
            detail: 'Script proof.',
            source: { kind: 'inferred', refs: [], confidence: 'medium', inferred: true },
          },
          summary: {
            selectedScopeLabel: 'Stage 1',
            includedWorkCount: 1,
            deferredWorkCount: 2,
            progress: { total: 3 },
          },
          roots: [{
            id: 'work:task-a',
            title: 'Runtime fallback source row',
            source: { kind: 'task', refs: ['import:docs/old-local-source.md'] },
            refs: { taskIds: ['task-a'] },
          }],
          nodes: {},
          proofContracts: [],
          scopeRows: [],
          gaps: [],
          sourceHealth: { inferred: 0, gaps: 0 },
          sourceTrail: [
            {
              label: 'Source docs',
              value: '2 source documents',
              detail: 'implementation-roadmap.md, architecture-notes.md',
              tone: 'ok',
            },
            {
              label: 'Scope',
              value: 'Release Plan',
              detail: 'Stage 1 contains 1 executable work item and 2 later.',
              tone: 'ok',
            },
          ],
        },
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByRole('heading', { name: 'Source trail' })).toBeInTheDocument()
    expect(screen.getByText('2 source documents')).toBeInTheDocument()
    expect(screen.getByText('implementation-roadmap.md, architecture-notes.md')).toBeInTheDocument()
    expect(screen.getByText('Stage 1 contains 1 executable work item and 2 later.')).toBeInTheDocument()
    expect(screen.queryByText('old-local-source.md')).not.toBeInTheDocument()
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
    expect(screen.getByText('Stage 1: V1 Release Hardening contains 2 executable work items and 80 later.')).toBeInTheDocument()
  })

  it('shows every current scope row before summarizing later rows', () => {
    const currentRows = Array.from({ length: 9 }, (_, index) => ({
      taskId: `task-current-${index}`,
      nodeId: `work:task-current-${index}`,
      title: index === 8 ? 'Define spatial/geographic continuity review lane' : `Current proof lane ${index + 1}`,
      scope: 'included',
      eligibilityReason: 'included',
      hierarchyRole: 'root',
      status: 'done',
      handoffState: 'proven',
      blocksStart: false,
      blocksRelease: false,
      humanBlocking: false,
      sourceRefs: ['task record'],
    }))
    const laterRows = Array.from({ length: 21 }, (_, index) => ({
      taskId: `task-later-${index}`,
      nodeId: `work:task-later-${index}`,
      title: `Later lane ${index + 1}`,
      scope: 'deferred',
      eligibilityReason: 'deferred',
      hierarchyRole: 'root',
      status: 'shelved',
      handoffState: 'deferred',
      blocksStart: false,
      blocksRelease: false,
      humanBlocking: false,
      sourceRefs: ['task record'],
    }))

    render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [],
        orientationSpine: {
          charter: { goal: 'Build a fiction-first planning and review harness.', source: 'inferred' },
          selectedRelease: {
            id: 'stage-1',
            label: 'Stage 1 Fixture And Evaluation Harness',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: currentRows.map(row => row.nodeId),
            deferredNodeIds: laterRows.map(row => row.nodeId),
          },
          summary: {
            selectedScopeLabel: 'Stage 1 Fixture And Evaluation Harness',
            selectedReleaseLabel: 'Stage 1 Fixture And Evaluation Harness',
            includedWorkCount: currentRows.length,
            deferredWorkCount: laterRows.length,
            progress: { total: currentRows.length + laterRows.length, proven: currentRows.length, deferred: laterRows.length },
          },
          roots: [],
          nodes: {},
          scopeRows: [...currentRows, ...laterRows],
          gaps: [],
          sourceHealth: { inferred: 0, gaps: 0 },
        },
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getAllByText('9 visible scope rows · 21 later scope rows').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Define spatial/geographic continuity review lane')).toBeInTheDocument()
    expect(screen.getByText('17 additional work items are summarized here; open Work for the full ledger.')).toBeInTheDocument()
  })

  it('scopes proof contracts to the selected release instead of borrowing later work', () => {
    render(ProjectMapTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        tasks: [],
        orientationSpine: {
          charter: {
            goal: 'Keep Looma generic while Knit drives primitive priority.',
            source: 'inferred',
          },
          selectedRelease: {
            id: 'stage-1',
            label: 'Stage 1',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:current-parent'],
            deferredNodeIds: ['work:later-proof'],
          },
          summary: {
            selectedScopeLabel: 'Stage 1',
            selectedReleaseLabel: 'Stage 1',
            includedWorkCount: 1,
            deferredWorkCount: 1,
            progress: { total: 2 },
          },
          roots: [
            {
              id: 'work:current-parent',
              kind: 'work',
              title: 'Current release work',
              summary: 'Selected release work.',
              maturity: 'active',
              progress: { total: 1, active: 1 },
              visibility: { kind: 'primary', countInProjectTotals: true },
              source: { kind: 'task', refs: ['task:current-parent'] },
              refs: { taskIds: ['current-parent'] },
              children: [{
                id: 'work:current-proof',
                kind: 'work',
                title: 'Current descendant proof',
                summary: 'Internal proof for the selected release work.',
                maturity: 'proof_needed',
                progress: { total: 0 },
                visibility: { kind: 'internal_step', countInProjectTotals: false },
                source: { kind: 'task', refs: ['task:current-proof'] },
                refs: { taskIds: ['current-proof'] },
              }],
            },
            {
              id: 'work:later-proof',
              kind: 'work',
              title: 'Later proof should not appear',
              summary: 'Deferred proof from a broader import.',
              maturity: 'proof_needed',
              progress: { total: 1, deferred: 1 },
              visibility: { kind: 'supporting', countInProjectTotals: true },
              source: { kind: 'task', refs: ['task:later-proof'] },
              refs: { taskIds: ['later-proof'] },
            },
          ],
          nodes: {
            'work:current-parent': {
              id: 'work:current-parent',
              title: 'Current release work',
              children: [{
                id: 'work:current-proof',
                title: 'Current descendant proof',
                source: { kind: 'task', refs: ['task:current-proof'] },
                refs: { taskIds: ['current-proof'] },
              }],
            },
            'work:current-proof': {
              id: 'work:current-proof',
              title: 'Current descendant proof',
              source: { kind: 'task', refs: ['task:current-proof'] },
              refs: { taskIds: ['current-proof'] },
            },
            'work:later-proof': {
              id: 'work:later-proof',
              title: 'Later proof should not appear',
              source: { kind: 'task', refs: ['task:later-proof'] },
              refs: { taskIds: ['later-proof'] },
            },
          },
          proofContracts: [
            {
              nodeId: 'work:later-proof',
              title: 'Later proof should not appear',
              state: 'needed',
              required: ['Verification evidence for later work.'],
              missing: ['Verification evidence for later work.'],
              verified: [],
              refs: ['task:later-proof'],
            },
            {
              nodeId: 'work:current-proof',
              title: 'Current descendant proof',
              state: 'needed',
              required: ['Verification evidence for current work.'],
              missing: ['Verification evidence for current work.'],
              verified: [],
              refs: ['task:current-proof'],
            },
          ],
          gaps: [],
          sourceHealth: { inferred: 1, gaps: 0 },
        },
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByRole('heading', { name: 'Proof contract' })).toBeInTheDocument()
    expect(screen.getByText('Current descendant proof')).toBeInTheDocument()
    expect(screen.getByText('Verification evidence for current work.')).toBeInTheDocument()
    expect(screen.queryByText('Verification evidence for later work.')).not.toBeInTheDocument()
  })

  it('shows source refs on proof contract rows', () => {
    render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        tasks: [],
        orientationSpine: {
          charter: {
            goal: 'Build a fiction-first planning and review harness.',
            source: 'inferred',
          },
          selectedRelease: {
            id: 'headless-mvp',
            label: 'Headless MVP',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:world-state-review'],
          },
          summary: {
            selectedScopeLabel: 'Headless MVP',
            selectedReleaseLabel: 'Headless MVP',
            includedWorkCount: 1,
            deferredWorkCount: 0,
            progress: { total: 1, proven: 1 },
          },
          roots: [],
          nodes: {},
          proofContracts: [{
            nodeId: 'work:world-state-review',
            title: 'World-state review proof',
            state: 'proven',
            required: ['Verification evidence for world-state review.'],
            missing: [],
            verified: ['Reviewer proof: wet hair drying proof script passed.'],
            refs: [
              'task:world-state-review',
              'import:/Users/matthew/git/oss/narrative-harness/docs/specs/world-and-object-continuity.md',
            ],
          }],
          gaps: [],
          sourceHealth: { inferred: 1, gaps: 0 },
        },
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByText('World-state review proof')).toBeInTheDocument()
    expect(screen.getByText('Reviewer proof: wet hair drying proof script passed.')).toBeInTheDocument()
    expect(screen.getByText('Source: world-and-object-continuity.md')).toBeInTheDocument()
  })

  it('counts missing proof from scoped proof contracts even when map gaps are clean', () => {
    render(ProjectMapTab, {
      detail: {
        id: 'looma-knit',
        name: 'Looma + Knit',
        tasks: [],
        orientationSpine: {
          charter: {
            goal: 'Keep Looma generic while Knit drives primitive priority.',
            source: 'inferred',
          },
          selectedRelease: {
            id: 'stage-1',
            label: 'Stage 1: V1 Release Hardening',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: ['work:current-proof'],
          },
          summary: {
            selectedScopeLabel: 'Stage 1: V1 Release Hardening',
            selectedReleaseLabel: 'Stage 1: V1 Release Hardening',
            includedWorkCount: 1,
            deferredWorkCount: 0,
            progress: { total: 1 },
          },
          roots: [],
          nodes: {},
          proofContracts: Array.from({ length: 5 }, (_, index) => ({
            nodeId: 'work:current-proof',
            title: `Current proof ${index + 1}`,
            state: 'needed',
            required: [`Proof ${index + 1}`],
            missing: [`Proof ${index + 1}`],
            verified: [],
            refs: ['task:current-proof'],
          })),
          gaps: [],
          sourceHealth: { inferred: 0, gaps: 0 },
        },
      },
      activeProjectId: 'looma-knit',
    })

    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Missing proof')).toBeInTheDocument()
    expect(screen.queryByText('Proof gaps')).not.toBeInTheDocument()
    expect(screen.getByText('No map gaps are currently reported.')).toBeInTheDocument()
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

    expect(fetchCalls.filter(call => call.url.includes('/api/project/release/select'))).toEqual([
      {
        url: '/api/project/release/select?projectId=narrative-harness',
        body: { releaseId: 'release-2', projectId: 'narrative-harness' },
      },
    ])
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('separates current execution from product scope and shipped history', () => {
    const { container } = render(ProjectMapTab, {
      detail: {
        id: 'narrative-harness',
        name: 'Narrative Harness',
        orientationSpine: {
          selectedRelease: {
            id: 'release-2',
            label: 'Headless MVP (reconciled plan)',
            kind: 'release',
            state: 'active',
            source: 'release_plan',
            nodeIds: Array.from({ length: 15 }, (_, index) => `work:feature-${index + 1}`),
          },
          releases: [
            {
              id: 'release-1',
              label: 'Headless MVP',
              kind: 'release',
              state: 'shipped',
              source: 'release_plan',
              nodeIds: Array.from({ length: 15 }, (_, index) => `work:feature-${index + 1}`),
            },
            {
              id: 'release-2',
              label: 'Headless MVP (reconciled plan)',
              kind: 'release',
              state: 'active',
              source: 'release_plan',
              nodeIds: Array.from({ length: 15 }, (_, index) => `work:feature-${index + 1}`),
            },
          ],
          summary: {
            selectedScopeLabel: 'Headless MVP (reconciled plan)',
            selectedReleaseLabel: 'Headless MVP (reconciled plan)',
            includedWorkCount: 4,
            deferredWorkCount: 32,
            progress: { total: 4, done: 3, deferred: 32 },
          },
          roots: [],
          nodes: {},
          gaps: [],
          sourceHealth: { inferred: 0, gaps: 0 },
        },
      },
      activeProjectId: 'narrative-harness',
    })

    expect(screen.getByText('Current release')).toBeInTheDocument()
    expect(container.textContent).toContain('3/4 executable work items complete · 15 product boundaries · 32 later work items')
    expect(container.textContent).toContain('15 delivered product boundaries · historical release')
    expect(screen.queryByRole('button', { name: 'Select' })).not.toBeInTheDocument()
  })
})
