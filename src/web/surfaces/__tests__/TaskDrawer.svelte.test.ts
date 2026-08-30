// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import TaskDrawer from '../TaskDrawer.svelte'
import { taskDisplayKey } from '../../lib/identifier-labels.js'
import { path } from '../../lib/nav.svelte.js'
import { project } from '../../lib/project.svelte.js'
import type { DrawerPayload, ProjectDetail } from '../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function projectDetail(): ProjectDetail {
  return {
    id: 'looma-knit',
    name: 'Looma + Knit',
    path: '/repo/looma-knit',
    run: { status: 'stopped', mode: 'continuous' },
    tasks: [],
  }
}

function drawerPayload(overrides: Partial<DrawerPayload> = {}): DrawerPayload {
  return {
    task: {
      id: 'task-link-editor',
      title: 'Knit: add link editor controls',
      description: 'Add the link editing controls to the selected text menu.',
      status: 'exploring',
      domain: 'frontend',
      priority: 'high',
      acceptanceCriteria: [{ description: 'URL and display text controls are available.' }],
      spec: '## Summary\nAdd link editor controls inside the existing editor toolbar.\n\n## Acceptance Criteria\n- URL and display text controls are available.',
      productBrief: { approvedAt: now, userJob: 'Edit links inline.' },
      notes: [{ role: 'coordinator', content: 'Confirmed this belongs to Knit.', timestamp: now }],
      openQuestions: [
        {
          kind: 'choice',
          id: 'q-link-scope',
          askedBy: 'coordinator-agent',
          askedAt: now,
          prompt: 'Which controls belong in the link editor?',
          choices: ['URL input + Display text', 'URL input only'],
        },
      ],
    },
    threadTurns: [
      {
        id: 'turn-q',
        kind: 'agent_question',
        at: now,
        persona: 'coord',
        status: 'active',
        phase: 'blocked',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        question: {
          kind: 'choice',
          id: 'q-link-scope',
          askedBy: 'coordinator-agent',
          askedAt: now,
          prompt: 'Which controls belong in the link editor?',
          choices: ['URL input + Display text', 'URL input only'],
        },
      },
    ],
    recentEvents: [],
    contextDebug: [
      {
        id: 'ctx-1',
        at: now,
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        promptChars: 1200,
        sections: [{ key: 'task', label: 'Task', chars: 220, included: true }],
      },
    ],
    ...overrides,
  }
}

function installBrowserFakes() {
  window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor')
  path.value = '/projects/looma-knit/task/task-link-editor'
  path.href = '/projects/looma-knit/task/task-link-editor'
  project.detail = projectDetail()
  project.error = null
  vi.stubGlobal('confirm', vi.fn(() => true))
}

function openDrawerOn(tab: 'overview' | 'current' | 'spec', options: { fullRecord?: boolean } = {}) {
  const detail = options.fullRecord ? '&detail=full' : ''
  const href = `/projects/looma-knit/task/task-link-editor?tab=${tab}${detail}`
  window.history.replaceState({}, '', href)
  path.value = href
  path.href = href
}

describe('TaskDrawer', () => {
  it('keeps the more task actions menu on one quiet menu-row presentation', () => {
    const source = readFileSync('src/web/surfaces/TaskDrawer.svelte', 'utf-8')
    const menuMarkup = source.match(/<div class="more-action-menu">[\s\S]*?<\/div>\n\s*{\/if}/)?.[0] ?? ''

    expect(menuMarkup).toContain('class="more-action-button"')
    expect(menuMarkup).not.toContain('variant="agent"')
    expect(menuMarkup).not.toContain('variant="secondary"')
    expect(menuMarkup).not.toContain('variant="danger"')
    expect(menuMarkup).not.toContain('light-emitted')
  })

  it('keeps footer utility actions on one shared text-button presentation', () => {
    const source = readFileSync('src/web/surfaces/TaskDrawer.svelte', 'utf-8')

    expect(source).toContain('class="footer-utility-action more-actions-trigger"')
    expect(source).toContain('class="footer-utility-action"')
    expect(source).toContain('margin-right: var(--s-4)')
    expect(source).not.toContain('<Button variant="ghost" size="sm" onclick={() => copyTaskLink(task.id)}>')
  })

  beforeEach(() => {
    installBrowserFakes()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('routes current task questions to Thread without posting drawer-local answers', async () => {
    openDrawerOn('current')
    const payload = drawerPayload()
    payload.task.status = 'ready'
    payload.task.spec = ''
    payload.task.acceptanceCriteria = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/answer-questions')) {
        throw new Error('TaskDrawer must not answer owner-input questions locally')
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Which controls belong in the link editor?')
    expect(screen.queryByRole('button', { name: /url input only/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /open thread/i }))

    await waitFor(() => {
      expect(path.value).toBe('/projects/looma-knit/thread')
    })
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/answer-questions'))).toBe(false)
  })

  it('loads a project task with the explicit project id even from a legacy global task route', async () => {
    window.history.replaceState({}, '', '/task/task-link-editor?tab=spec')
    path.value = '/task/task-link-editor?tab=spec'
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) {
        expect(url).toContain('projectId=looma-knit')
        return json(payload)
      }
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('projectId=looma-knit'))).toBe(true)
    })
  })

  it('does not render an inert Action tab when the task has no current action content', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Overview' })
    expect(screen.queryByRole('tab', { name: 'Action' })).not.toBeInTheDocument()
  })

  it('keeps normal task detail navigation to owner jobs instead of diagnostic tabs', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Overview' })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Overview', 'Spec'])
    for (const label of ['Journey', 'Transcript', 'Experts', 'History', 'Origin']) {
      expect(screen.queryByRole('tab', { name: label })).not.toBeInTheDocument()
    }
  })

  it('leads with one resume command when this runnable task is the project action', async () => {
    const user = userEvent.setup()
    project.detail = {
      ...projectDetail(),
      actionModel: {
        primaryAction: {
          source: 'task',
          label: 'Resume the link editor work',
          detail: 'This is the next runnable work item.',
          buttonLabel: 'Resume work',
          href: '/work?task=task-link-editor',
          tone: 'accent',
          taskId: 'task-link-editor',
        },
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
    } as ProjectDetail
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'review',
        openQuestions: [],
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: 'Resume only this work item' })
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Task size')).not.toBeInTheDocument()
    expect(screen.queryByText('Add the link editing controls to the selected text menu.')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View task details' }))
    await waitFor(() => {
      expect(path.href).toBe('/projects/looma-knit/task/task-link-editor?detail=full&tab=overview')
    })
  })

  it('confirms focused work is underway without dumping the task record', async () => {
    project.detail = {
      ...projectDetail(),
      run: { status: 'running', mode: 'one_task' },
      actionModel: {
        primaryAction: {
          source: 'task',
          label: 'Resume the link editor work',
          detail: 'This is the next runnable work item.',
          buttonLabel: 'Resume work',
          href: '/work?task=task-link-editor',
          tone: 'accent',
          taskId: 'task-link-editor',
        },
        secondaryActions: [],
        runControl: { label: 'Pause', startEnabled: false },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
    } as ProjectDetail
    const payload = drawerPayload({
      runStatus: 'running',
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'in_progress',
        openQuestions: [],
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(project.detail)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Guildhall is working on Knit: add link editor controls.')
    expect(screen.getByText('Nothing is waiting on you right now. Guildhall will return when it needs a decision or reaches a result.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View task details' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Task links')).not.toBeInTheDocument()
    expect(screen.queryByText('Delivery steps')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resume only this work item' })).not.toBeInTheDocument()
  })

  it('routes an unrelated task to the project decision instead of dumping its full record', async () => {
    const user = userEvent.setup()
    project.detail = {
      ...projectDetail(),
      actionModel: {
        primaryAction: {
          source: 'task',
          label: 'Review the release spec',
          detail: 'A spec needs approval before work can continue.',
          buttonLabel: 'Review next spec',
          href: '/work?task=task-review',
          tone: 'warn',
          taskId: 'task-review',
        },
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: false },
        ownerInput: { active: true },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
    } as ProjectDetail
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Project needs your decision first')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('Task size')).not.toBeInTheDocument()
    expect(screen.queryByText('Checkpoint saved')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Review next spec' }))
    expect(path.value).toBe('/projects/looma-knit/task/task-review')
  })

  it('lets a task with an open escalation own the compact drawer over another project decision', async () => {
    project.detail = {
      ...projectDetail(),
      actionModel: {
        primaryAction: {
          source: 'start_readiness',
          label: 'Work ready to resume',
          buttonLabel: 'Open Work',
          href: '/work?task=task-review',
          tone: 'accent',
          taskId: 'task-review',
        },
        secondaryActions: [],
        runControl: { label: 'Resume', startEnabled: true },
        ownerInput: { active: false },
        setup: { state: 'ready', freshIntakeNeeded: false },
      },
    } as ProjectDetail
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'blocked',
        blockReason: 'human_judgment_required: Worker made no visible progress after 5 passes.',
        escalations: [{
          id: 'esc-worker-stalled',
          raisedAt: now,
          agentId: 'worker-agent',
          reason: 'human_judgment_required',
          recoveryCode: 'worker_no_progress',
          summary: 'Worker made no visible progress after 5 passes.',
          status: 'open',
        }],
      },
      threadTurns: [{
        id: 'turn-worker-stalled',
        kind: 'escalation',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'blocked',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        escalationId: 'esc-worker-stalled',
        escalationAgentId: 'worker-agent',
        escalationReason: 'human_judgment_required',
        escalationRecoveryCode: 'worker_no_progress',
        summary: 'Worker made no visible progress after 5 passes.',
      }],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(project.detail)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Queued')
    expect(screen.getByRole('button', { name: 'Retry worker' })).toBeInTheDocument()
    expect(screen.queryByText('Project needs your decision first')).toBeNull()
  })

  it('keeps reviewer planning metadata out of the normal task overview', async () => {
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'review',
        reviewPlan: {
          taskId: 'task-link-editor',
          effort: 'balanced',
          depth: 'standard',
          selectedLanes: ['ux_comprehension', 'copy_clarity', 'test_adequacy', 'plan_completeness', 'accessibility'],
          requiredRecipes: [{
            recipeId: 'product-ux-zero-context',
            version: 'v1',
            lanes: ['ux_comprehension', 'copy_clarity', 'accessibility'],
            blocking: 'high',
          }],
          deterministicChecks: ['browser-or-screenshot-evidence'],
          requiredArtifacts: ['visual-evidence'],
          skippedLanes: [{ lane: 'security', reason: 'No matching signal.' }],
          budget: { maxReviewerAgents: 4, maxWallClockMinutes: 18, maxEstimatedTokens: 45000 },
        },
        reviewAuditSummary: {
          reviewerRunCount: 2,
          reviseCount: 1,
          escapedMissCount: 0,
          latestReviewerRunAt: '2026-05-25T12:02:00.000Z',
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Overview', selected: true })
    expect(screen.getByRole('link', { name: 'Looma + Knit' })).toHaveAttribute(
      'href',
      '/projects/looma-knit/overview',
    )
    expect(screen.getByText(taskDisplayKey('task-link-editor', [], 'looma-knit'))).toBeInTheDocument()
    expect(screen.queryByText('Review plan')).not.toBeInTheDocument()
    expect(screen.queryByText('Balanced review')).not.toBeInTheDocument()
    expect(screen.queryByText('UX Comprehension')).not.toBeInTheDocument()
  })

  it('shows delivery-step progress in the drawer header from shared work progress', async () => {
    const payload = drawerPayload({
      threadTurns: [],
      workProgress: {
        counts: {
          visibleTotal: 1,
          visibleActive: 1,
          visibleBlocked: 0,
          visibleDone: 0,
          visibleShelved: 0,
          deliveryTotal: 1,
          deliveryRequired: 1,
          deliveryDone: 0,
          deliveryBlocked: 1,
        },
        byTaskId: {
          'task-link-editor': {
            id: 'task-link-editor',
            title: 'Knit: add link editor controls',
            status: 'in_progress',
            visibility: { kind: 'primary', countInProjectTotals: true },
            deliverySteps: [{
              id: 'runtime-proof',
              title: 'Runtime proof for link editor controls',
              kind: 'verify',
              status: 'blocked',
              required: true,
              blocksCompletion: true,
            }],
            rollup: {
              primaryState: 'blocked',
              visibleChildCount: 0,
              visibleChildDoneCount: 0,
              internalStepCount: 1,
              requiredStepCount: 1,
              doneStepCount: 0,
              blockedStepCount: 1,
            },
          },
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    expect(container.querySelector('.gh-drawer-head')?.textContent).toContain('1 delivery step blocked')
  })

  it('makes decomposition sizing visible as work to create, not owner recommendations', async () => {
    openDrawerOn('overview', { fullRecord: true })
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'spec_review',
        businessEnvelope: { goalId: 'goal-task-fll-overhead-policy' },
        dependsOn: ['task-fll-policy-decision'],
        sizePlan: {
          taskId: 'task-link-editor',
          score: 8,
          band: 'epic',
          action: 'split_required',
          reviewBudgetHint: 'release_critical',
          reasons: ['Task size score: 8.'],
          factors: [
            { id: 'multiple_outcomes', label: 'Multiple outcomes', weight: 2, reason: 'Several outcomes.' },
            { id: 'migration_or_release', label: 'Migration or release risk', weight: 2, reason: 'Release behavior.' },
          ],
          recommendedChildren: [
            {
              title: 'Draft the FLL overhead charge policy',
              reason: 'Separate policy decision from implementation.',
              suggestedDomain: 'product',
              dependsOn: [],
            },
            {
              title: 'Apply the overhead charge policy',
              reason: 'Keep implementation review focused.',
              suggestedDomain: 'frontend',
              dependsOn: ['Draft the FLL overhead charge policy'],
            },
          ],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task links')
    expect(screen.getAllByText('Split into smaller work').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/this stays as containing work and the nested work below is created/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split into smaller work' })).toBeInTheDocument()
    expect(screen.getByText('Work to create')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('recommendations, not created child tasks yet')
    expect(document.body.textContent).not.toMatch(/split recommended|split required/i)
    expect(document.body.textContent).not.toMatch(/parent task/i)
    expect(screen.getByText('Goal envelope')).toBeInTheDocument()
    expect(screen.getByText('fll overhead policy')).toBeInTheDocument()
    expect(screen.getByText('Draft the FLL overhead charge policy')).toBeInTheDocument()
    expect(screen.getByText('Apply the overhead charge policy')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: taskDisplayKey('task-fll-policy-decision', [], 'looma-knit') })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-fll-policy-decision',
    )
  })

  it('offers a split action for decomposition child work scoped to the current task', async () => {
    openDrawerOn('overview', { fullRecord: true })
    const user = userEvent.setup()
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        id: 'context-menu',
        title: 'ContextMenu',
        description: 'Implement the ContextMenu primitive and its documentation proof.',
        status: 'spec_review',
        domain: 'frontend',
        spec: '## Summary\nImplement ContextMenu with component implementation, Storybook proof, and API docs sync.',
        sizePlan: {
          taskId: 'context-menu',
          score: 5,
          band: 'large',
          action: 'split_recommended',
          recommendedChildren: [
            {
              title: 'ContextMenu component implementation',
              reason: 'Ship the ContextMenu primitive implementation.',
              suggestedDomain: 'frontend',
            },
            {
              title: 'ContextMenu Storybook proof',
              reason: 'Add visual proof for ContextMenu.',
              suggestedDomain: 'frontend',
            },
          ],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/context-menu/create-split-children')) {
        expect(init?.method).toBe('POST')
        return json({
          ok: true,
          createdTaskIds: [
            'context-menu-split-context-menu-component-implementation',
            'context-menu-split-context-menu-storybook-proof',
          ],
        })
      }
      if (url.startsWith('/api/project/task/context-menu')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'context-menu',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task links')
    expect(screen.getByText('ContextMenu')).toBeInTheDocument()
    expect(screen.getByText('ContextMenu component implementation')).toBeInTheDocument()
    expect(screen.getByText('ContextMenu Storybook proof')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split into smaller work' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Split into smaller work' }))

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/project/task/context-menu/create-split-children?projectId=looma-knit'),
    )).toBe(true)
  })

  it('offers a clear action when split-required child tasks have not been created yet', async () => {
    openDrawerOn('overview', { fullRecord: true })
    const user = userEvent.setup()
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'spec_review',
        businessEnvelope: { goalId: 'goal-task-fll-overhead-policy' },
        sizePlan: {
          taskId: 'task-link-editor',
          score: 8,
          band: 'epic',
          action: 'split_required',
          reviewBudgetHint: 'release_critical',
          reasons: ['Task size score: 8.'],
          factors: [],
          recommendedChildren: [
            {
              title: 'Draft the FLL overhead charge policy',
              reason: 'Separate policy decision from implementation.',
              suggestedDomain: 'product',
              dependsOn: [],
            },
          ],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/create-split-children')) {
        expect(init?.method).toBe('POST')
        return json({ ok: true, createdTaskIds: ['task-fll-overhead-policy-spec'] })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: 'Split into smaller work' })
    await user.click(screen.getByRole('button', { name: 'Split into smaller work' }))

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/project/task/task-link-editor/create-split-children?projectId=looma-knit'),
    )).toBe(true)
  })

  it('starts only the scoped work item from the drawer action', async () => {
    openDrawerOn('overview')
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'ready',
        openQuestions: [],
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        expect(init?.method).toBe('POST')
        return json({ status: 'running', mode: 'one_task', scope: { type: 'work_item', taskId: 'task-link-editor' } })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: /resume only this work item/i })
    await userEvent.click(screen.getByRole('button', { name: /resume only this work item/i }))

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/project/task/task-link-editor/start?projectId=looma-knit'),
    )).toBe(true)
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/project/start?projectId=looma-knit'),
    )).toBe(false)
  })

  it('keeps the scoped work-item action in the footer for ready tasks with harmless history', async () => {
    openDrawerOn('overview')
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'ready',
        openQuestions: [],
      },
      threadTurns: [
        {
          id: 'request:task-link-editor:reframe',
          kind: 'history_note',
          at: now,
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          summary: 'Owner recovery pass reframed this task from current repo state.',
        },
        {
          id: 'inflight:task-link-editor',
          kind: 'inflight',
          at: now,
          persona: 'worker',
          status: 'active',
          phase: 'implementation',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'ready',
          importedDraft: false,
          liveAgent: false,
          summary: 'Approved and queued for work.',
        },
      ],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init.body))).toMatchObject({
          mode: 'one_task',
          scope: 'work_item',
        })
        return json({ status: 'running', mode: 'one_task', scope: { type: 'work_item', taskId: 'task-link-editor' } })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /resume only this work item/i }))

    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/api/project/task/task-link-editor/start?projectId=looma-knit'),
    )).toBe(true)
  })

  it('uses the drawer run snapshot so stale project state does not show already queued', async () => {
    openDrawerOn('current')
    project.detail = {
      ...projectDetail(),
      run: { status: 'running', mode: 'one_task' },
    }
    const payload = drawerPayload({
      runStatus: 'stopped',
      task: {
        ...drawerPayload().task,
        status: 'exploring',
        openQuestions: [],
        acceptanceCriteria: [],
      },
      threadTurns: [
        {
          id: 'turn-intake',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'exploring',
          summary: 'Guildhall is shaping the task brief.',
          checklist: {
            title: 'Task brief checklist',
            doneCount: 3,
            totalSteps: 4,
            steps: [
              { id: 'title', title: 'Readable title', why: 'Give this work a name.', status: 'done' },
              { id: 'start', title: 'Starting point', why: 'Name the starting evidence.', status: 'done' },
              { id: 'success', title: 'Success target', why: 'State the target.', status: 'done' },
              { id: 'acceptance', title: 'Acceptance criteria', why: 'Add checks.', status: 'active' },
            ],
          },
        },
      ],
    } as Partial<DrawerPayload> & { runStatus: string })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(project.detail)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: /continue shaping brief/i })
    expect(screen.queryByRole('button', { name: /already queued/i })).not.toBeInTheDocument()
  })

  it('retries a scoped task start when run_already_active was only stale state', async () => {
    openDrawerOn('current')
    const payload = drawerPayload({
      runStatus: 'stopped',
      task: {
        ...drawerPayload().task,
        status: 'exploring',
        openQuestions: [],
        acceptanceCriteria: [],
      },
      threadTurns: [
        {
          id: 'turn-intake',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'exploring',
          summary: 'Guildhall is shaping the task brief.',
        },
      ],
    } as Partial<DrawerPayload> & { runStatus: string })
    let startCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        startCalls += 1
        return startCalls === 1
          ? json({ code: 'run_already_active', error: 'Guildhall is already running.', status: 'running' }, { status: 409 })
          : json({ status: 'running', mode: 'one_task', scope: { type: 'work_item', taskId: 'task-link-editor' } })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json({ ...projectDetail(), run: { status: 'stopped', mode: 'continuous' } })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: /revise spec/i })
    await userEvent.click(screen.getByRole('button', { name: /revise spec/i }))

    await waitFor(() => expect(startCalls).toBe(2))
  })

  it('turns a spec-agent shaping timeout into an explicit retry state', async () => {
    openDrawerOn('current')
    const payload = drawerPayload({
      runStatus: 'stopped',
      task: {
        ...drawerPayload().task,
        status: 'exploring',
        openQuestions: [],
        acceptanceCriteria: [],
      },
      threadTurns: [
        {
          id: 'turn-intake-timeout',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'exploring',
          summary: 'Guildhall is shaping the task brief.',
          activity: [
            {
              at: now,
              label: 'Agent spec-agent failed on task-link-editor: spec-agent timed out after 120000ms of inactivity',
              tone: 'danger',
            },
          ],
          checklist: {
            title: 'Task brief checklist',
            doneCount: 3,
            totalSteps: 4,
            steps: [
              { id: 'title', title: 'Readable title', why: 'Give this work a name.', status: 'done' },
              { id: 'start', title: 'Starting point', why: 'Name the starting evidence.', status: 'done' },
              { id: 'success', title: 'Success target', why: 'State the target.', status: 'done' },
              { id: 'acceptance', title: 'Acceptance criteria', why: 'Add checks.', status: 'active' },
            ],
          },
        },
      ],
    } as Partial<DrawerPayload> & { runStatus: string })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('heading', { name: 'Shaping timed out' })
    expect(screen.getByText(/Shaping stopped before the missing acceptance criteria were written/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try shaping brief again/i })).toBeInTheDocument()
  })

  it('turns a read-budget shaping pause into an explicit retry state', async () => {
    openDrawerOn('current')
    const payload = drawerPayload({
      runStatus: 'stopped',
      task: {
        ...drawerPayload().task,
        status: 'exploring',
        openQuestions: [],
        acceptanceCriteria: [],
      },
      threadTurns: [
        {
          id: 'turn-intake-paused',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'exploring',
          summary: 'Guildhall is shaping the task brief.',
          activity: [
            {
              at: now,
              label: 'Guildhall paused after gathering enough context. Open the task to choose the next step.',
              tone: 'warn',
            },
          ],
          checklist: {
            title: 'Task brief checklist',
            doneCount: 3,
            totalSteps: 4,
            steps: [
              { id: 'title', title: 'Readable title', why: 'Give this work a name.', status: 'done' },
              { id: 'start', title: 'Starting point', why: 'Name the starting evidence.', status: 'done' },
              { id: 'success', title: 'Success target', why: 'State the target.', status: 'done' },
              { id: 'acceptance', title: 'Acceptance criteria', why: 'Add checks.', status: 'active' },
            ],
          },
        },
      ],
    } as Partial<DrawerPayload> & { runStatus: string })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('heading', { name: 'Paused' })
    expect(screen.getByText(/The missing acceptance criteria were not written before the pause/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try shaping brief again/i })).toBeInTheDocument()
  })

  it('links materialized split child tasks from the overview', async () => {
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'ready',
        businessEnvelope: { goalId: 'goal-task-fll-overhead-policy' },
        hierarchy: {
          childIds: [
            'task-fll-overhead-policy-spec',
            'task-fll-overhead-policy-implementation',
          ],
          order: 0,
        },
        taskReadiness: { recommendation: 'requires_child_work' },
        sizePlan: {
          taskId: 'task-link-editor',
          score: 8,
          band: 'epic',
          action: 'split_required',
          reviewBudgetHint: 'release_critical',
          reasons: ['Task size score: 8.'],
          factors: [],
          recommendedChildren: [
            {
              title: 'Draft the FLL overhead charge policy',
              reason: 'Separate policy decision from implementation.',
              suggestedDomain: 'product',
              dependsOn: [],
              createdTaskId: 'task-fll-overhead-policy-spec',
            },
            {
              title: 'Apply the overhead charge policy',
              reason: 'Keep implementation review focused.',
              suggestedDomain: 'frontend',
              dependsOn: ['Draft the FLL overhead charge policy'],
              createdTaskId: 'task-fll-overhead-policy-implementation',
            },
          ],
        },
      },
      relatedTasks: [
        {
          id: 'task-fll-overhead-policy-spec',
          title: 'Draft the FLL overhead charge policy',
          description: 'Draft the policy.',
          status: 'exploring',
          domain: 'product',
          dependsOn: [],
        },
        {
          id: 'task-fll-overhead-policy-implementation',
          title: 'Apply the overhead charge policy',
          description: 'Apply the policy.',
          status: 'exploring',
          domain: 'frontend',
          dependsOn: ['task-fll-overhead-policy-spec'],
        },
        {
          id: 'task-fll-release-check',
          title: 'Release the FLL overhead workflow',
          description: 'Release after implementation.',
          status: 'ready',
          domain: 'release',
          dependsOn: ['task-link-editor'],
        },
      ],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json({ ...projectDetail(), tasks: [payload.task, ...(payload.relatedTasks ?? [])] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task links')
    expect(screen.queryByText('Linked nested work')).not.toBeInTheDocument()
    expect(screen.queryByText('Split required')).not.toBeInTheDocument()
    expect(screen.queryByText('Split recommended')).not.toBeInTheDocument()
    expect(screen.queryByText('Work happens in the nested work below.')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/parent task/i)
    expect(screen.queryByRole('button', { name: 'Resume only this work item' })).not.toBeInTheDocument()
    expect(screen.queryByText(/This task is the parent/i)).not.toBeInTheDocument()
    expect(screen.getByText('Child tasks')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Draft the FLL overhead charge policy' })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-fll-overhead-policy-spec',
    )
    expect(screen.getByRole('link', { name: 'Apply the overhead charge policy' })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-fll-overhead-policy-implementation',
    )
    await waitFor(() => expect(screen.getByText('Blocks')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Release the FLL overhead workflow' })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-fll-release-check',
    )
  })

  it('does not offer task-only start when the project has an unresolved start blocker', async () => {
    openDrawerOn('current')
    const blockedProject = {
      ...projectDetail(),
      startReadiness: {
        canStart: false,
        code: 'owner_input_required',
        message: 'Choose a recovery path for the blocked task',
        actionHref: '/task/task-blocked?tab=current',
      },
    }
    project.detail = blockedProject
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'ready',
        openQuestions: [],
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(blockedProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    expect(screen.queryByRole('button', { name: 'Resume only this work item' })).not.toBeInTheDocument()
    expect(screen.getByText('Choose a recovery path for the blocked task')).toBeInTheDocument()
  })

  it('replaces the drawer task when hierarchy links are clicked and preserves the background page', async () => {
    window.history.replaceState(
      { backgroundPath: '/projects/looma-knit/overview' },
      '',
      '/projects/looma-knit/task/task-link-editor',
    )
    path.value = '/projects/looma-knit/task/task-link-editor'
    path.state = { backgroundPath: '/projects/looma-knit/overview' }
    const user = userEvent.setup()
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        businessEnvelope: { goalId: 'goal-task-fll-overhead-policy' },
        dependsOn: ['task-fll-policy-decision'],
        sizePlan: {
          taskId: 'task-link-editor',
          score: 8,
          band: 'epic',
          action: 'split_required',
          recommendedChildren: [
            {
              title: 'Apply the overhead charge policy',
              reason: 'Keep implementation review focused.',
              createdTaskId: 'task-fll-overhead-policy-implementation',
            },
          ],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await user.click(await screen.findByRole('link', { name: 'Apply the overhead charge policy' }))

    expect(path.value).toBe('/projects/looma-knit/task/task-fll-overhead-policy-implementation')
    expect(history.state).toEqual({ backgroundPath: '/projects/looma-knit/overview' })
  })

  it('shows hierarchy-native containing work in the drawer breadcrumb without duplicating parent path', async () => {
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        hierarchy: {
          parentId: 'task-feature-spec',
          childIds: [],
          order: 0,
        },
        workKind: 'implementation',
      },
      relatedTasks: [
        {
          ...drawerPayload().task,
          id: 'task-feature-spec',
          title: 'ContextMenu',
          status: 'ready',
          hierarchy: { childIds: ['task-link-editor'], order: 0 },
        },
      ],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json({ ...projectDetail(), tasks: [payload.relatedTasks![0], payload.task] })
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task links')
    expect(screen.queryByText('Parent path')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Looma + Knit' })).toHaveAttribute(
      'href',
      '/projects/looma-knit/overview',
    )
    expect(screen.getByRole('link', { name: taskDisplayKey('task-feature-spec', [], 'looma-knit') })).toHaveAttribute(
      'href',
      '/projects/looma-knit/task/task-feature-spec',
    )
    expect(screen.getByText(taskDisplayKey('task-link-editor', [], 'looma-knit'))).toBeInTheDocument()
    expect(screen.queryByText('No parent goal recorded.')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/parent task/i)
  })

  it('shows a readable task journey for completed work', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=journey')
    path.value = '/projects/looma-knit/task/task-link-editor'
    path.href = '/projects/looma-knit/task/task-link-editor?tab=journey'
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'done',
        assignedTo: 'worker-agent',
        completedAt: '2026-05-25T12:40:00.000Z',
        latestCheckpoint: {
          step: 4,
          agentId: 'worker-agent',
          intent: 'Implement the link editor controls and verify the toolbar path.',
          nextPlannedAction: 'Hand off to review.',
          filesTouched: [
            'src/web/surfaces/editor/Toolbar.svelte',
            'src/web/surfaces/editor/toolbar.css',
          ],
          writtenAt: '2026-05-25T12:20:00.000Z',
        },
        reviewPlan: {
          taskId: 'task-link-editor',
          effort: 'balanced',
          depth: 'standard',
          selectedLanes: ['ux_comprehension', 'visual_design', 'test_adequacy'],
          requiredRecipes: [{
            recipeId: 'product-ux-zero-context',
            version: 'v1',
            lanes: ['ux_comprehension', 'visual_design'],
            blocking: 'high',
          }],
          deterministicChecks: ['browser-or-screenshot-evidence'],
          requiredArtifacts: ['visual-evidence'],
          budget: { maxReviewerAgents: 4 },
        },
        reviewAuditSummary: {
          reviewerRunCount: 2,
          reviseCount: 0,
          escapedMissCount: 0,
        },
        reviewVerdicts: [{
          verdict: 'approve',
          reviewerPath: 'llm',
          reason: 'The Product UX reviewer approved.',
          recordedAt: '2026-05-25T12:30:00.000Z',
        }],
        gateResults: [{
          gateId: 'typecheck',
          type: 'verification',
          passed: true,
          checkedAt: '2026-05-25T12:35:00.000Z',
        }],
        mergeRecord: {
          result: 'pushed',
          commitSha: 'abc1234',
          mergedAt: '2026-05-25T12:39:00.000Z',
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Journey', selected: true })

    expect(screen.getByText('Task journey')).toBeInTheDocument()
    expect(screen.queryByText('Checkpoint saved')).not.toBeInTheDocument()
    expect(screen.getByText(/Worker pass/)).toBeInTheDocument()
    expect(screen.getByText('2 files changed.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect files' })).toBeInTheDocument()
    expect(screen.getByText(/Balanced review/)).toBeInTheDocument()
    expect(screen.getByText(/2 reviewer runs/)).toBeInTheDocument()
    expect(screen.getAllByText(/typecheck/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Pushed/)).toBeInTheDocument()
  })

  it('shows task sizing and done summary without making transcript the primary completed-task artifact', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=journey')
    path.value = '/projects/looma-knit/task/task-link-editor'
    path.href = '/projects/looma-knit/task/task-link-editor?tab=journey'
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        status: 'done',
        completedAt: '2026-05-25T12:40:00.000Z',
        sizePlan: {
          taskId: 'task-link-editor',
          score: 5,
          band: 'large',
          action: 'split_recommended',
          factors: [
            { id: 'multiple_outcomes', label: 'Multiple outcomes', weight: 2, reason: 'Task spans toolbar controls and docs.' },
          ],
          recommendedChildren: [
            { title: 'Implement toolbar controls', reason: 'Keep UI work reviewable.' },
            { title: 'Update editor docs', reason: 'Keep docs validation separate.' },
          ],
          createdAt: '2026-05-25T12:00:00.000Z',
          createdBy: 'task-sizing',
        },
        doneSummaryBundle: {
          taskId: 'task-link-editor',
          status: 'done',
          completedAt: '2026-05-25T12:40:00.000Z',
          summary: {
            journey: 'Worker implemented toolbar controls, then UX and typecheck reviewed it.',
            decision: 'Task finished as done after review and gate checks.',
            evidence: 'Changed Toolbar.svelte; typecheck passed.',
            learningCandidates: ['Keep toolbar and docs as separate child tasks next time.'],
            openResidue: 'No open residue recorded.',
          },
          retention: {
            transcriptPrimaryArtifact: false,
            compactedFullTranscript: true,
            fullEvidenceAvailable: true,
          },
          evidenceRefs: [
            {
              scope: 'local_history',
              collection: 'transcripts',
              id: 'task-link-editor',
              path: '/history/transcripts/exploring/task-link-editor.md',
            },
          ],
          createdAt: '2026-05-25T12:41:00.000Z',
          createdBy: 'coordinator-agent',
        },
      },
      exploringTranscript: {
        content: '# Exploring Transcript\n\n## [2026-05-25T12:01:00.000Z] user\n\nPlease build it.\n',
        path: '/history/transcripts/exploring/task-link-editor.md',
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Journey', selected: true })

    expect(screen.getByText('Large task')).toBeInTheDocument()
    expect(screen.getByText('Decompose before execution')).toBeInTheDocument()
    expect(screen.queryByText('Split recommended')).not.toBeInTheDocument()
    expect(screen.getByText('Implement toolbar controls')).toBeInTheDocument()
    expect(screen.getByText('Worker implemented toolbar controls, then UX and typecheck reviewed it.')).toBeInTheDocument()
    expect(screen.getByText('Transcript compacted')).toBeInTheDocument()
    expect(screen.queryByText('Please build it.')).not.toBeInTheDocument()

    window.history.pushState({}, '', '/projects/looma-knit/task/task-link-editor?tab=transcript')
    path.value = '/projects/looma-knit/task/task-link-editor'
    path.href = '/projects/looma-knit/task/task-link-editor?tab=transcript'
    await screen.findByRole('tab', { name: 'Transcript', selected: true })
    expect(await screen.findByText('Source conversation')).toBeInTheDocument()
    expect(screen.getByText(/This task is done, so Journey is the friendly summary/)).toBeInTheDocument()
    expect(screen.getByText('Please build it.')).toBeInTheDocument()
  })

  it('loads the transcript only after its tab is opened', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=transcript')
    path.value = '/projects/looma-knit/task/task-link-editor'
    path.href = '/projects/looma-knit/task/task-link-editor?tab=transcript'
    const { exploringTranscript: _transcript, contextDebug: _context, recentEvents: _events, ...detail } = drawerPayload()
    const transcript = {
      content: '# Exploring Transcript\n\n## user\n\nPlease build it.\n',
      path: '/history/transcripts/exploring/task-link-editor.md',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/project/task/task-link-editor/extras?include=transcript')) return json({ exploringTranscript: transcript })
      if (url.includes('/api/project/task/task-link-editor/extras?include=context')) return json({ contextDebug: [] })
      if (url.startsWith('/api/project/task/task-link-editor')) return json(detail)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).includes('extras?include=transcript'))).toBe(true))
  })

  it('opens the Action tab when a question notification deep-links to the current surface', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=current')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Which controls belong in the link editor?')
    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('true')
  })

  it('opens the Journey tab when a proof link deep-links to the task journey', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=journey')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'done',
        doneSummaryBundle: {
          completedAt: '2026-06-16T12:30:00.000Z',
          summary: 'Worker implemented toolbar controls, then UX and typecheck reviewed it.',
          highlights: ['Implemented toolbar controls'],
          proof: ['tests/link-editor.test.ts passed'],
          nextSteps: [],
          risks: [],
        },
        completionProof: {
          state: 'verified',
          expectedCount: 1,
          verifiedCount: 1,
          verified: ['Reviewer proof: tests/link-editor.test.ts passed.'],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Completion proof')
    expect(screen.getByRole('tab', { name: 'Journey' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Reviewer proof: tests/link-editor.test.ts passed.')).toBeInTheDocument()
  })

  it('reuses the open drawer but still honors a later Journey tab deep link', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'done',
        doneSummaryBundle: {
          completedAt: '2026-06-16T12:30:00.000Z',
          summary: 'Worker implemented toolbar controls, then UX and typecheck reviewed it.',
          highlights: ['Implemented toolbar controls'],
          proof: ['tests/link-editor.test.ts passed'],
          nextSteps: [],
          risks: [],
        },
        completionProof: {
          state: 'verified',
          expectedCount: 1,
          verifiedCount: 1,
          verified: ['Reviewer proof: tests/link-editor.test.ts passed.'],
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Overview', selected: true })
    window.history.pushState({}, '', '/projects/looma-knit/task/task-link-editor?tab=journey')
    path.value = '/projects/looma-knit/task/task-link-editor?tab=journey'
    path.href = '/projects/looma-knit/task/task-link-editor?tab=journey'

    await screen.findByText('Completion proof')
    expect(screen.getByRole('tab', { name: 'Journey' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('Reviewer proof: tests/link-editor.test.ts passed.')).toBeInTheDocument()
  })

  it('treats tab=action as the Action tab deep link', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=action')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Which controls belong in the link editor?')
    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('true')
  })

  it('does not repeat the recovery banner above the tab that owns the recovery decision', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor?tab=current')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'blocked',
        escalations: [
          {
            id: 'esc-1',
            raisedAt: now,
            agentId: 'worker-agent',
            reason: 'spec_ambiguous',
            summary: 'Card component exists but template syntax mismatch prevents edit',
            details: 'The worker found src/components/Card.svelte, but the requested dashboard edit does not match the current file shape.',
            status: 'open',
          },
        ],
      },
      threadTurns: [
        {
          id: 'turn-escalation',
          kind: 'escalation',
          at: now,
          persona: 'worker',
          status: 'active',
          phase: 'blocked',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          escalationId: 'esc-1',
          escalationAgentId: 'worker-agent',
          escalationReason: 'spec_ambiguous',
          summary: 'Card component exists but template syntax mismatch prevents edit',
          details: 'The worker found src/components/Card.svelte, but the requested dashboard edit does not match the current file shape.',
        },
      ],
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Recovery needed')
    expect(screen.getAllByText(/The worker found src\/components\/Card\.svelte, but the requested dashboard edit does not match the current file shape\./i)).toHaveLength(1)
    expect(screen.queryByLabelText('Needs recovery')).toBeNull()
    expect(screen.queryByText(/Open the task/i)).toBeNull()
  })

  it('runs and manages the task from drawer controls without losing project scope', async () => {
    openDrawerOn('overview', { fullRecord: true })
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    payload.task.openQuestions = []
    payload.task.latestCheckpoint = {
      step: 1,
      agentId: 'worker-agent',
      intent: 'Reconcile the spec with the recorded requirements.',
      nextPlannedAction: 'Resume from the recorded verification evidence.',
      filesTouched: [],
      writtenAt: '2026-08-29T00:00:00.000Z',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/hold')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          reason: 'Waiting on a product call.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/shelve')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/reframe-task')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        if (init?.body) {
          expect(JSON.parse(String(init.body))).toMatchObject({
            reason: 'This task is describing machinery instead of the user-facing work.',
          })
        }
        return json({ ok: true, status: 'exploring' })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          mode: 'one_task',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /resume only this work item/i }))
    await userEvent.click(screen.getByText('More task actions'))
    expect(screen.getByRole('button', { name: /reframe task/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /pause and keep in queue/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /shelve task/i })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /pause and keep in queue/i }))
    expect(screen.getByText(/Use this when the task is still valid but should wait/i)).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: /why is this on hold/i }), 'Waiting on a product call.')
    await userEvent.click(screen.getByRole('button', { name: /^pause task$/i }))
    await userEvent.click(screen.getByText('More task actions'))
    await userEvent.click(screen.getByRole('button', { name: /shelve task/i }))
    expect(screen.getByText(/Shelving removes this task from the active plan/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^shelve task$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/task/task-link-editor/start'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/hold'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/shelve'))).toBe(true)
    })
  })

  it('can reframe a task from the more-actions menu and closes the menu on outside click', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/reframe-task')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true, status: 'exploring' })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) return json({ ok: true })
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByText('More task actions'))
    expect(screen.getByRole('button', { name: /reframe task\.\.\./i })).toBeTruthy()
    await userEvent.click(document.body)
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /reframe task\.\.\./i })).toBeNull()
    })

    await userEvent.click(screen.getByText('More task actions'))
    await userEvent.click(screen.getByRole('button', { name: /reframe task\.\.\./i }))
    expect(screen.getByRole('dialog', { name: /reframe task/i })).toBeTruthy()
    const note = screen.getByPlaceholderText(/explain what is confusing/i)
    await userEvent.type(note, 'This task is describing machinery instead of the user-facing work.')
    await userEvent.click(screen.getByRole('button', { name: /^reframe task$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/reframe-task'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/task/task-link-editor/start'))).toBe(true)
    })
  })

  it('does not offer reframe once a worker has started implementation', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'in_progress'
    payload.task.assignedTo = 'worker-agent'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByText('More task actions'))

    expect(screen.queryByRole('button', { name: /reframe task/i })).toBeNull()
  })

  it('shows held tasks as resumable instead of a vague pause state', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'On hold: Waiting on the design call.'
    payload.task.hold = {
      previousStatus: 'ready',
      reason: 'Waiting on the design call.',
      heldAt: '2026-05-24T20:00:00.000Z',
      heldBy: 'human',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resume-hold')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true, status: 'ready' })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('This task is out of the active queue for now.')
    expect(screen.getByText('Reason: Waiting on the design call.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /resume task/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resume-hold'))).toBe(true)
    })
  })

  it('does not offer a generic resume button while a held task still has an open human-owned escalation', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'human_judgment_required: Stripe dashboard setup is required.'
    payload.task.hold = {
      previousStatus: 'ready',
      reason: 'Waiting on Stripe dashboard credentials.',
      heldAt: '2026-05-24T20:00:00.000Z',
      heldBy: 'human',
    }
    payload.task.escalations = [
      {
        id: 'esc-stripe',
        reason: 'human_judgment_required',
        summary: 'Stripe dashboard setup is required.',
        details: 'Waiting on Stripe dashboard access, API keys, and webhook endpoint configuration.',
        agentId: 'worker-agent',
        externalChecklist: [
          {
            id: 'stripe-dashboard',
            title: 'Configure Stripe dashboard credentials',
            owner: 'user',
            status: 'todo',
          },
        ],
      },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('This task is out of the active queue for now.')
    expect(screen.getByRole('button', { name: /^i handled this\.\.\.$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run this task/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resume task/i })).toBeNull()
  })

  it('does not expose run controls for a completed task but keeps copy link available', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'done'
    payload.task.terminalSummary = {
      headline: 'Task completed.',
      detail: 'DONE',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task completed.')

    expect(screen.queryByRole('button', { name: /run this task/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /put on hold/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /put aside/i })).toBeNull()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy()
  })

  it('warns when a completed task still carries unresolved escalations', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'done'
    payload.task.completedAt = '2026-06-03T12:00:00.000Z'
    payload.task.terminalSummary = {
      headline: 'Stripe implementation completed.',
      detail: 'Implementation landed.',
    }
    payload.task.escalations = [
      {
        id: 'esc-stripe-live',
        reason: 'human_judgment_required',
        summary: 'Stripe live verification still needs dashboard setup.',
        details: 'Waiting on live Stripe dashboard credentials and webhook verification.',
        agentId: 'worker-agent',
        raisedAt: '2026-06-03T11:00:00.000Z',
      },
    ]
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Completion hygiene')
    expect(screen.getByText('This task is marked done but still has unresolved escalation history.')).toBeInTheDocument()
    expect(screen.getByText(/Stripe live verification still needs dashboard setup/)).toBeInTheDocument()
    expect(screen.queryByText('Stripe implementation completed.')).toBeNull()
    expect(screen.queryByRole('button', { name: /^i handled this\.\.\.$/i })).toBeNull()
  })

  it('approves a task spec with an optional note from the drawer footer flow', async () => {
    openDrawerOn('spec', { fullRecord: true })
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-spec',
          kind: 'spec_review',
          at: now,
          persona: 'coord',
          status: 'active',
          phase: 'blocked',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          spec: '## Summary\nAdd link editor controls inside the existing editor toolbar.',
        } as any,
      ],
    })
    payload.task.status = 'spec_review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          approvalNote: 'Ship the focused link editor controls first.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add link editor controls inside the existing editor toolbar.')
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /note/i }), 'Ship the focused link editor controls first.')
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/approve-spec'))).toBe(true)
    })
  })

  it('switches from an approved spec to the shared next action', async () => {
    openDrawerOn('overview')
    const reviewPayload = drawerPayload({ threadTurns: [] })
    reviewPayload.task.status = 'spec_review'
    const readyPayload = drawerPayload({ threadTurns: [] })
    readyPayload.task.status = 'ready'
    readyPayload.task.openQuestions = []
    const afterApprovalProject = {
      ...projectDetail(),
      actionModel: {
        primaryAction: {
          label: 'Continue ContextMenu work',
          buttonLabel: 'Resume',
          href: '/projects/looma-knit/work?task=task-link-editor',
          tone: 'accent',
          taskId: 'task-link-editor',
        },
      },
    }
    let taskReads = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) return json({ ok: true })
      if (url.startsWith('/api/project/task/task-link-editor')) {
        taskReads += 1
        return json(taskReads === 1 ? reviewPayload : readyPayload)
      }
      if (url.startsWith('/api/project')) return json(afterApprovalProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Approve this spec?')
    await userEvent.click(screen.getByRole('button', { name: 'Approve spec' }))
    await userEvent.click(screen.getByRole('button', { name: 'Approve', exact: true }))

    expect(await screen.findByText('Ready to continue')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume only this work item' })).toBeInTheDocument()
    expect(screen.queryByText('Approve this spec?')).toBeNull()
  })

  it('keeps the approval modal open when spec approval fails', async () => {
    openDrawerOn('spec', { fullRecord: true })
    const payload = drawerPayload()
    payload.task.status = 'spec_review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        return json({ error: 'Project update required before approval.' }, { status: 409 })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, { taskId: 'task-link-editor', projectId: 'looma-knit', onClose: vi.fn() })

    await screen.findByRole('button', { name: /approve spec/i })
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    expect(await screen.findByRole('dialog', { name: /approve spec/i })).toBeInTheDocument()
    expect(await screen.findByText('Project update required before approval.')).toBeInTheDocument()
  })

  it('surfaces spec approval on the Spec tab beside the draft', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload()
    payload.task.status = 'spec_review'
    payload.task.spec = '## Summary\nAdd Stripe Connect payments for licensed projects.'
    payload.threadTurns = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Approve this spec?')
    expect(screen.queryByText(/waiting in Thread/i)).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('Acceptance criteria')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/approve-spec'))).toBe(true)
    })
  })

  it('keeps a pending spec to one executable review decision and sends requested changes to the spec', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resume')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          message: 'Keep the scope focused on the selected-text menu.',
          revisionTarget: 'spec',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Approve this spec?')
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByText('Latest handoff packet')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'What will change' })).toBeNull()
    expect(screen.queryByText(/finish conditions are recorded/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Read full task record' })).toBeInTheDocument()
    expect(screen.queryByText('Checkpoint saved')).toBeNull()
    expect(screen.queryByText('Resume point saved.')).toBeNull()
    expect(screen.queryByText('0/1 delivery steps')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    await userEvent.type(
      screen.getByPlaceholderText('Describe the correction Guildhall should make.'),
      'Keep the scope focused on the selected-text menu.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send changes' }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resume'))).toBe(true)
    })

    await userEvent.click(screen.getByRole('button', { name: 'Read full task record' }))
    await waitFor(() => expect(path.href).toContain('?detail=full&tab=overview'))
  })

  it('does not present a coordinator-owned review as an owner approval', async () => {
    openDrawerOn('overview')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    payload.task.specReviewGate = {
      authority: 'coordinator',
      requestedAt: now,
      requestedBy: 'coordinator-recovery',
      reason: 'recovery',
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('tab', { name: 'Spec' })
    expect(screen.queryByText('Approve this spec?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve spec' })).toBeNull()
  })

  it('keeps a shared spec-repair task out of approval in focused and full detail', async () => {
    const repairedProject = {
      ...projectDetail(),
      orientationSpine: {
        scopeRows: [{ taskId: 'task-link-editor', scope: 'included', handoffState: 'spec_shaping' }],
      },
    }
    project.detail = repairedProject
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    payload.task.openQuestions = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(repairedProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    expect(await screen.findByText('Guildhall is repairing this spec')).toBeInTheDocument()
    expect(screen.getByText('Run one repair pass.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair spec' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Read full task record' })).toBeInTheDocument()
    expect(screen.queryByText('Approve this spec?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve spec' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Request changes' })).toBeNull()

    openDrawerOn('spec', { fullRecord: true })
    await rendered.rerender({
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      routeHref: path.href,
      onClose: vi.fn(),
    })

    expect(await screen.findByText('Guildhall is repairing this spec')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repair spec' })).toBeInTheDocument()
    expect(screen.queryByText('Approve this spec?')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve spec' })).toBeNull()
  })

  it('shows a spec-repair start failure beside the action instead of failing silently', async () => {
    const repairedProject = {
      ...projectDetail(),
      orientationSpine: {
        scopeRows: [{ taskId: 'task-link-editor', scope: 'included', handoffState: 'spec_shaping' }],
      },
    }
    project.detail = repairedProject
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        return json({ error: 'The configured provider is unavailable. Open Providers to fix it.' }, { status: 400 })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(repairedProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByRole('button', { name: 'Repair spec' })
    await userEvent.click(screen.getByRole('button', { name: 'Repair spec' }))

    expect(await screen.findByText('The configured provider is unavailable. Open Providers to fix it.')).toBeInTheDocument()
  })

  it('preempts focused spec approval when a required project update is already known', async () => {
    openDrawerOn('spec')
    const onMigrationRequired = vi.fn()
    const blockedProject = {
      ...projectDetail(),
      startReadiness: {
        canStart: false,
        code: 'required_migration_pending',
        message: 'Guildhall needs to update this project before work can continue.',
      },
    }
    project.detail = blockedProject
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'spec_review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(blockedProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
      onMigrationRequired,
    })

    await waitFor(() => expect(onMigrationRequired).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: 'Approve spec' })).toBeNull()
    expect(screen.getByText('Opening project update...')).toBeTruthy()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/approve-spec'))).toBe(false)
  })

  it('hands a required migration to the shared project repair flow instead of rendering the raw error', async () => {
    openDrawerOn('spec')
    const onMigrationRequired = vi.fn()
    const payload = drawerPayload()
    payload.task.status = 'spec_review'
    payload.threadTurns = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        return json(
          { error: 'Run required Guildhall migration 0.13.27/acceptance-command-proof-path-reconciliation before starting this project.' },
          { status: 409 },
        )
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
      onMigrationRequired,
    })

    await screen.findByText('Approve this spec?')
    await userEvent.click(screen.getByRole('button', { name: /approve spec/i }))
    await userEvent.click(screen.getByRole('button', { name: /^approve$/i }))

    await waitFor(() => expect(onMigrationRequired).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/Run required Guildhall migration/i)).toBeNull()
  })

  it('shows stale acceptance proof state on the Spec tab', async () => {
    openDrawerOn('spec', { fullRecord: true })
    const payload = drawerPayload({
      threadTurns: [],
      task: {
        ...drawerPayload().task,
        acceptanceCriteria: [
          {
            id: 'provider-proof',
            description: 'Live provider proof records drafting telemetry.',
            met: false,
            persistedMet: true,
            verificationState: 'stale',
            staleReason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
            staleGateId: 'prove-deepinfra-drafting-model.live-provider',
          },
        ],
        acceptanceCriteriaProofState: {
          state: 'blocked',
          reason: 'provider_missing: DEEPINFRA_API_TOKEN is required.',
          staleMetCount: 1,
          gateId: 'prove-deepinfra-drafting-model.live-provider',
        },
      },
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Acceptance criteria')
    expect(screen.getByText('Live provider proof records drafting telemetry.')).toBeInTheDocument()
    expect(screen.getByText('provider_missing: DEEPINFRA_API_TOKEN is required.')).toBeInTheDocument()
    expect(screen.getByText('Needs proof')).toBeInTheDocument()
  })

  it('does not offer unqualified spec approval when the structured brief is incomplete', async () => {
    openDrawerOn('spec', { fullRecord: true })
    const payload = drawerPayload()
    payload.task.status = 'spec_review'
    payload.task.spec = '## Summary\nReview the Font Something variable-font specimen flow.'
    payload.task.acceptanceCriteria = []
    payload.task.productBrief = {
      approvedAt: now,
      userJob: 'Review the specimen flow.',
    }
    payload.threadTurns = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/wizards')) {
        return json({
          wizards: [
            {
              id: 'spec-fill',
              totalSteps: 4,
              doneCount: 2,
              complete: false,
              activeStepId: 'success',
              steps: [
                { id: 'title', title: 'Readable title', why: 'Give this work a name.', status: 'done', skippable: false },
                { id: 'description', title: 'Starting point', why: 'Name the starting evidence.', status: 'done', skippable: false },
                { id: 'success', title: 'Success target', why: 'State the target.', status: 'pending', skippable: false },
                { id: 'acceptance', title: 'Acceptance criteria', why: 'Add checks.', status: 'pending', skippable: false },
              ],
            },
          ],
        })
      }
      if (url.startsWith('/api/project/task/task-link-editor/approve-spec')) {
        throw new Error('Incomplete spec-review tasks must not expose unqualified approval')
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Task brief checklist')
    expect(screen.getByText('Success target')).toBeInTheDocument()
    expect(screen.getByText('Acceptance criteria')).toBeInTheDocument()
    expect(screen.getByText('Spec needs brief details first')).toBeInTheDocument()
    expect(screen.getByText(/Add the missing success target and structured acceptance criteria before approval/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^approve spec$/i })).toBeNull()
  })

  it('routes workspace-import approval to the import review surface', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-spec',
          kind: 'spec_review',
          at: now,
          persona: 'coord',
          status: 'active',
          phase: 'blocked',
          taskId: 'task-workspace-import',
          taskTitle: 'Review existing project work',
          spec: '## Summary\nReview imported workspace notes.',
        } as any,
      ],
    })
    payload.task.id = 'task-workspace-import'
    payload.task.title = 'Review existing project work'
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-workspace-import')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-workspace-import',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Review existing project work')
    await userEvent.click(screen.getByRole('button', { name: /open import review/i }))

    expect(path.value).toBe('/projects/looma-knit/workspace-import')
  })

  it('re-runs the matching stage from review tasks without losing project scope', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'review'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/rerun-stage')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({ stage: 'review' })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByText('More task actions'))
    await userEvent.click(screen.getByRole('button', { name: /re-run review/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/rerun-stage'))).toBe(true)
    })
  })

  it('shows load failures and retries without dropping the project scope', async () => {
    let taskLoads = 0
    const payload = drawerPayload({ threadTurns: [] })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) {
        taskLoads += 1
        expect(url).toContain('projectId=looma-knit')
        if (taskLoads === 1) {
          return json({ error: 'Task not found in selected project.' }, { status: 404 })
        }
        return json(payload)
      }
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Error: Task not found in selected project.')
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))

    await screen.findByText('Knit: add link editor controls')
    expect(taskLoads).toBeGreaterThanOrEqual(2)
  })

  it('shapes an imported draft and starts the same task continuously from the current card', async () => {
    openDrawerOn('current')
    const payload = drawerPayload({
      threadTurns: [
        {
          id: 'turn-import',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'import_draft',
          summary: 'Imported from project notes.',
          importedDraft: true,
        },
      ],
    })
    payload.task.status = 'import_draft'

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/shape-draft')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({ projectId: 'looma-knit' })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          mode: 'one_task',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText(/Next step: turn this note into a task brief with scope, evidence, and acceptance criteria/)
    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/shape-draft'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/task/task-link-editor/start'))).toBe(true)
    })
  })

  it('continues source-recovery shaping from the current card when project start is blocked by that task', async () => {
    openDrawerOn('current')
    const blockedProject = {
      ...projectDetail(),
      startReadiness: {
        canStart: false,
        code: 'imported_scope_shaping',
        message: 'Current scoped work still needs source-backed shaping before Guildhall can build unattended. Start with "Recover source-backed contract surface".',
        actionHref: '/task/task-link-editor',
      },
    }
    project.detail = blockedProject
    const payload = drawerPayload({
      task: {
        ...drawerPayload().task,
        status: 'exploring',
        taskReadiness: {
          recommendation: 'needs_research_spike',
          summary: 'Needs concrete source-backed contract names before worker handoff.',
        },
        notes: [
          {
            agentId: 'workspace-importer',
            role: 'importer',
            content: 'Imported from docs/specs/author-involvement-modes.md',
            timestamp: now,
          },
        ],
      },
      threadTurns: [
        {
          id: 'turn-source-recovery',
          kind: 'inflight',
          at: now,
          persona: 'spec',
          status: 'active',
          phase: 'spec',
          taskId: 'task-link-editor',
          taskTitle: 'Recover source-backed contract surface',
          taskStatus: 'exploring',
          summary: 'Source recovery is queued.',
          shapingBlockers: [
            {
              code: 'source_recovery',
              summary: 'Needs concrete source-backed contract names before worker handoff.',
            },
          ],
        },
      ],
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/shape-draft')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true, status: 'exploring' })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          mode: 'one_task',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(blockedProject)
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText(/recover the source-backed task brief/i)
    const button = screen.getByRole('button', { name: /continue shaping brief/i })
    expect(button).toBeEnabled()
    await userEvent.click(button)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/shape-draft'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith('/api/project/task/task-link-editor/start'))).toBe(true)
    })
  })

  it('adds acceptance criteria and follow-up notes from the optional drawer details path', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'exploring'
    payload.task.acceptanceCriteria = []
    payload.task.productBrief = {
      approvedAt: now,
      userJob: 'Edit links inline.',
      successMetric: 'The selected link can be changed without leaving the editor.',
    }

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/add-acceptance')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          description: 'Reviewer verifies URL and display text editing from the toolbar.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/resume')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          message: 'Keep drag handles out of scope for this task.',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Add one concrete finish line the reviewer can verify.')
    await userEvent.type(
      screen.getByPlaceholderText(/round-trip tests cover variable declarations/i),
      'Reviewer verifies URL and display text editing from the toolbar.',
    )
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await userEvent.type(
      screen.getByPlaceholderText(/answer a question, add a requirement/i),
      'Keep drag handles out of scope for this task.',
    )
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/add-acceptance'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resume'))).toBe(true)
    })
  })

  it('separates retry and manual blocker resolution actions on the recovery surface', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'verification_failed: Build failed after implementation.'
    payload.task.escalations = [
      {
        id: 'esc-build',
        reason: 'verification_failed',
        summary: 'Build failed after implementation.',
        details: 'pnpm check reported a missing imported component.',
        agentId: 'worker-agent',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resolve-escalation')) {
        expect(url).toContain('projectId=looma-knit')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          escalationId: 'esc-build',
          resolution: 'Use the existing shared button component and rerun checks.',
          nextStatus: 'review',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Build failed after implementation.')
    expect(screen.queryByRole('button', { name: /retry blocker/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resolve blocker/i })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^i handled this\.\.\.$/i }))
    await screen.findByText('Use this when you handled the blocker yourself or want to say exactly where to continue.')
    await userEvent.type(
      screen.getByLabelText(/resolution note/i),
      'Use the existing shared button component and rerun checks.',
    )
    await userEvent.selectOptions(screen.getByLabelText(/resume at/i), 'review')
    await userEvent.click(screen.getByRole('button', { name: /^mark resolved$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resolve-escalation'))).toBe(true)
    })
  })

  it('shows external setup checklist steps on recovery cards', async () => {
    openDrawerOn('current')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'human_judgment_required: OAuth providers need external setup.'
    payload.task.escalations = [
      {
        id: 'esc-oauth',
        reason: 'human_judgment_required',
        summary: 'OAuth providers need external setup.',
        details: 'Guildhall can verify the code after Supabase providers exist.',
        agentId: 'worker-agent',
        externalChecklist: [
          {
            id: 'google-oauth',
            title: 'Create Google OAuth credentials',
            detail: 'Add the client ID and secret to Supabase.',
            owner: 'user',
            status: 'todo',
          },
          {
            id: 'apple-oauth',
            title: 'Create Apple OAuth credentials',
            owner: 'user',
            status: 'todo',
          },
        ],
      },
    ]
    payload.threadTurns = [
      {
        id: 'esc:task-link-editor:esc-oauth',
        kind: 'escalation',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'blocked',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        escalationId: 'esc-oauth',
        escalationReason: 'human_judgment_required',
        escalationAgentId: 'worker-agent',
        summary: 'OAuth providers need external setup.',
        details: 'Guildhall can verify the code after Supabase providers exist.',
        externalChecklist: payload.task.escalations[0].externalChecklist,
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('External setup checklist')
    expect(screen.getByText('Create Google OAuth credentials')).toBeTruthy()
    expect(screen.getByText('Add the client ID and secret to Supabase.')).toBeTruthy()
    expect(screen.getByText('Create Apple OAuth credentials')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^retry worker$/i })).toBeNull()
    expect(screen.getByRole('button', { name: /^i handled this\.\.\.$/i })).toBeTruthy()
  })

  it('lets the user ask Guildhall to split an active task from the actions menu', async () => {
    const user = userEvent.setup()
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.escalations = [
      {
        id: 'esc-oauth',
        reason: 'human_judgment_required',
        summary: 'OAuth providers need external setup.',
        agentId: 'worker-agent',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/enrich-task')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          mode: 'split',
          instruction: expect.stringContaining('Google OAuth setup'),
        })
        return json({ ok: true, status: 'exploring' })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) return json({ ok: true })
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('More task actions')
    await user.click(screen.getByText('More task actions'))
    await user.click(screen.getByRole('button', { name: /^split task\.\.\.$/i }))
    await screen.findByRole('dialog', { name: /^split task$/i })
    await user.type(screen.getByLabelText(/what should be separated/i), 'Google OAuth setup and Apple OAuth setup.')
    await user.click(screen.getByRole('button', { name: /^split task$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/enrich-task'))).toBe(true)
    })
  })

  it('lets the user describe a generic task rework from the actions menu', async () => {
    const user = userEvent.setup()
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.escalations = [
      {
        id: 'esc-setup',
        reason: 'human_judgment_required',
        summary: 'External setup is missing.',
        agentId: 'worker-agent',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/enrich-task')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          mode: 'general',
          instruction: expect.stringContaining('external setup checklist'),
        })
        return json({ ok: true, status: 'exploring' })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) return json({ ok: true })
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('More task actions')
    await user.click(screen.getByText('More task actions'))
    await user.click(screen.getByRole('button', { name: /^rework task\.\.\.$/i }))
    await screen.findByRole('dialog', { name: /^rework task$/i })
    await user.type(
      screen.getByLabelText(/how should this be reworked/i),
      'Add an external setup checklist but preserve the current implementation spec.',
    )
    await user.click(screen.getByRole('button', { name: /^rework task$/i }))

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/enrich-task'))).toBe(true)
    })
  })

  it('renders the full task description in the drawer header when the title is a compact label', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.title = 'We should have a system-wide policy of how much FLL charges on overhe...'
    payload.task.description = 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.'

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await waitFor(() => {
      expect(screen.getAllByText('We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.')).toHaveLength(1)
    })
  })

  it('replaces raw task identifiers in the overview description with stable display keys', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    const relatedTaskId = 'task-deterministic-evaluation-and-essential-history-report'
    payload.task.description = `This verification work supports containing task ${relatedTaskId}.`

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    expect(await screen.findByText(new RegExp(taskDisplayKey(relatedTaskId, [], 'looma-knit')))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(relatedTaskId))).not.toBeInTheDocument()
  })

  it('uses a reason-aware primary recovery action for open escalations', async () => {
    openDrawerOn('spec')
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'blocked'
    payload.task.blockReason = 'gate_hard_failure: Tests failed.'
    payload.task.escalations = [
      {
        id: 'esc-gates',
        reason: 'gate_hard_failure',
        summary: 'Tests failed.',
        details: 'pnpm test failed after implementation.',
        agentId: 'gate-checker',
      },
    ]

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/resolve-escalation')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          projectId: 'looma-knit',
          escalationId: 'esc-gates',
          resolution: 'Retrying gates after addressing the failure.',
          nextStatus: 'gate_check',
        })
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor/start')) return json({ ok: true })
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Tests failed.')
    const footerRetry = screen.getAllByRole('button', { name: /^retry gates$/i }).at(-1)
    expect(footerRetry).toBeDefined()
    expect(footerRetry!.classList.contains('v-agent')).toBe(true)
    await userEvent.click(footerRetry!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/resolve-escalation'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/api/project/task/task-link-editor/start'))).toBe(true)
    })
  })

  it('closes from the backdrop without requiring the details path', async () => {
    const onClose = vi.fn()
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'ready'
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose,
    })

    await screen.findByText('Knit: add link editor controls')
    await userEvent.click(screen.getByRole('button', { name: /close drawer/i }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('unshelves a task and presents starter specs with the generated summary title', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'shelved'
    payload.task.title = 'Draft a first starter task for Looma + Knit onboarding'
    payload.task.spec = '## Summary\nAdd a focused setup checklist for the editor shell.\n\n## Acceptance Criteria\n- The checklist renders.'
    payload.task.acceptanceCriteria = [{ description: 'The checklist renders.' }]
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor/unshelve')) {
        expect(url).toContain('projectId=looma-knit')
        expect(init?.method).toBe('POST')
        return json({ ok: true })
      }
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Draft a first starter task for Looma + Knit onboarding')
    await userEvent.click(screen.getAllByRole('button', { name: /^unshelve$/i })[0]!)

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/unshelve'))).toBe(true)
    })
  })

  it('explains shelved and checkpointed outcomes without crowding the footer', async () => {
    const payload = drawerPayload({ threadTurns: [] })
    payload.task.status = 'shelved'
    payload.task.shelveReason = {
      code: 'duplicate',
      detail: 'Duplicate of the existing link editor task.',
      rejectedAt: now,
      rejectedBy: 'coordinator-agent',
    }
    payload.task.latestCheckpoint = {
      step: 3,
      agentId: 'worker-agent',
      intent: 'Verify focused toolbar tests',
      nextPlannedAction: 'Rerun the focused toolbar test and hand off to review.',
      filesTouched: ['web/app/components/editor/toolbar.ts'],
      writtenAt: now,
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/project/task/task-link-editor')) return json(payload)
      if (url.startsWith('/api/project')) return json(projectDetail())
      return json({})
    })
    vi.stubGlobal('fetch', fetchMock)

    render(TaskDrawer, {
      taskId: 'task-link-editor',
      projectId: 'looma-knit',
      onClose: vi.fn(),
    })

    await screen.findByText('Knit: add link editor controls')
    expect(screen.getByText('This task is out of the active queue.')).toBeTruthy()
    expect(screen.getAllByText('Duplicate of the existing link editor task.').length).toBeGreaterThan(0)
    expect(screen.queryByText('Latest checkpoint')).toBeNull()
    expect(screen.queryByText(/Rerun the focused toolbar test/)).toBeNull()
    expect(screen.queryByRole('button', { name: /put on hold/i })).toBeNull()
    expect(screen.getAllByRole('button', { name: /^unshelve$/i }).length).toBeGreaterThan(0)
  })
})
