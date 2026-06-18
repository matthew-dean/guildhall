// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it } from 'vitest'
import { path } from '../../../lib/nav.svelte.js'
import ProjectMapTab from '../ProjectMapTab.svelte'

describe('ProjectMapTab', () => {
  afterEach(() => {
    cleanup()
    path.value = '/'
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
            detail: 'Selected scope should be proven with scripts or commands before it is treated as ready.',
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
            label: 'Current work',
            source: 'inferred',
          },
          summary: {
            selectedScopeLabel: 'Current work',
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
              ],
            },
          ],
          nodes: {
            'work:task-a': {
              id: 'work:task-a',
              title: 'Coherence reviewer MVP',
              source: { kind: 'task', refs: ['task:task-a'] },
              refs: { taskIds: ['task-a'] },
            },
          },
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
    expect(screen.getByText('Current work')).toBeInTheDocument()
    expect(screen.getByText('Coherence')).toBeInTheDocument()
    expect(screen.getAllByText('Coherence reviewer MVP').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('Internal CLI proof')).not.toBeInTheDocument()
    expect(screen.getByText('1 internal step hidden')).toBeInTheDocument()
    await fireEvent.click(screen.getByRole('button', { name: 'Show internal steps' }))
    expect(screen.getByText('Internal CLI proof')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide internal steps' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Proof mode' })).toBeInTheDocument()
    expect(screen.getAllByText('Headless proof').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('heading', { name: 'Proof contract' })).toBeInTheDocument()
    expect(screen.getByText('Script or command proof for Coherence reviewer MVP.')).toBeInTheDocument()
    expect(screen.getByText('Document-level artifact references are not attached to every lane yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Gaps to resolve' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Open questions' })).not.toBeInTheDocument()
    expect(container.querySelectorAll('.source-fact')).toHaveLength(4)
    expect(container.querySelector('.source-row')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Coherence reviewer MVP Active' }))
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')

    path.value = '/'
    await fireEvent.click(screen.getByRole('button', { name: 'Proof Needed Proof needed: Coherence reviewer MVP. Open the linked work item to resolve this gap.' }))
    expect(path.value).toBe('/projects/narrative-harness/task/task-a')
  })
})
