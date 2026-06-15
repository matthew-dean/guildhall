// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import CurrentTab from '../CurrentTab.svelte'
import type { ContextDebugRecord, Task, TaskThreadTurn } from '../../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function baseTask(): Task {
  return {
    id: 'task-link-editor',
    title: 'Knit: add link editor controls',
    status: 'ready',
    description: 'Add link controls.',
  }
}

function readyTaskNeedingBriefCleanup(): Task {
  return {
    ...baseTask(),
    productBrief: {
      userJob: 'Add block menu controls.',
      successMetric: '',
      antiPatterns: [],
    },
    spec: '',
    acceptanceCriteria: [],
  }
}

function readyTaskCompleteForWorker(): Task {
  return {
    ...baseTask(),
    productBrief: {
      userJob: 'Add link controls.',
      whyItMattersNow: 'Editors need to correct links without leaving the writing flow.',
      successMetric: 'Links can be edited inline.',
      antiPatterns: [],
      nonGoals: ['Do not redesign the editor toolbar.'],
      approvedAt: now,
    },
    spec: '## Summary\nAdd link controls.',
    acceptanceCriteria: [{ description: 'Controls render.' }],
  }
}

function handlers() {
  return {
    onApproveBrief: vi.fn(),
    onApproveSpec: vi.fn(),
    onRunTask: vi.fn(),
    onShapeDraft: vi.fn(),
    onOpenSpecTab: vi.fn(),
    onOpenEscalationAction: vi.fn(),
    onRunEscalationAction: vi.fn(),
    onResolveEscalation: vi.fn(async () => {}),
    onOpenThread: vi.fn(),
  }
}

function renderCurrent(turns: TaskThreadTurn[], options: { runError?: string | null; runStatus?: string; availabilityStatus?: string | null; contextDebug?: ContextDebugRecord[] } = {}) {
  const props = {
    task: baseTask(),
    turns,
    busy: false,
    runBusy: false,
    runError: options.runError ?? null,
    runStatus: options.runStatus ?? 'stopped',
    availabilityStatus: options.availabilityStatus ?? 'paused',
    contextDebug: options.contextDebug ?? [],
    ...handlers(),
  }
  render(CurrentTab, props)
  return props
}

function renderCurrentWithTask(
  task: Task,
  turns: TaskThreadTurn[],
  options: { runError?: string | null; runStatus?: string; availabilityStatus?: string | null; contextDebug?: ContextDebugRecord[]; workProgress?: Record<string, unknown> } = {},
) {
  const props = {
    task,
    turns,
    busy: false,
    runBusy: false,
    runError: options.runError ?? null,
    runStatus: options.runStatus ?? 'stopped',
    availabilityStatus: options.availabilityStatus ?? 'paused',
    contextDebug: options.contextDebug ?? [],
    workProgress: options.workProgress,
    ...handlers(),
  }
  render(CurrentTab, props)
  return props
}

describe('CurrentTab', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders a neutral state when nothing is waiting', () => {
    renderCurrentWithTask(readyTaskCompleteForWorker(), [])

    expect(screen.getByText('Nothing is waiting')).toBeTruthy()
    expect(screen.getByText('This task does not currently need a decision from you.')).toBeTruthy()
  })

  it('shows a blocked delivery step as current task detail without a thread turn', () => {
    renderCurrentWithTask(readyTaskCompleteForWorker(), [], {
      workProgress: {
        deliverySteps: [{
          id: 'runtime-proof',
          title: 'Runtime proof for link editor controls',
          kind: 'verify',
          status: 'blocked',
          required: true,
          blocksCompletion: true,
        }],
        rollup: {
          requiredStepCount: 1,
          doneStepCount: 0,
          blockedStepCount: 1,
          internalStepCount: 1,
        },
      },
    })

    expect(screen.getAllByText('Delivery step blocked').length).toBeGreaterThan(0)
    expect(screen.getByText('Runtime proof for link editor controls')).toBeTruthy()
    expect(screen.queryByText('Nothing is waiting')).toBeNull()
  })

  it('shows memory-core candidate source refs in the current task panel', () => {
    renderCurrentWithTask(readyTaskCompleteForWorker(), [], {
      contextDebug: [{
        memoryPacket: {
          memoryCore: {
            adapter: 'mastra',
            fallbackUsed: false,
            warnings: [],
            candidates: [{
              id: 'candidate-1',
              kind: 'observation',
              summary: 'Memory-core candidate source refs should appear in task context debug.',
              sourceRefs: [{ uri: 'PROGRESS.md#debug-memory-core', path: '.guildhall/PROGRESS.md', sourceKind: 'progress' }],
            }],
          },
        },
      }],
    })

    expect(screen.getByText('Memory packet')).toBeTruthy()
    expect(screen.getByText('Memory-core candidate source refs should appear in task context debug.')).toBeTruthy()
    expect(screen.getByText('PROGRESS.md#debug-memory-core (.guildhall/PROGRESS.md)')).toBeTruthy()
  })

  it('keeps task-level brief cleanup visible even when there is no active thread turn', async () => {
    const props = renderCurrentWithTask(readyTaskNeedingBriefCleanup(), [])

    expect(screen.getAllByText('Needs brief').length).toBeGreaterThanOrEqual(1)
    const briefCleanupChip = screen.getAllByText('Needs brief').find(node => node.classList.contains('tone-warn'))
    expect(briefCleanupChip).toBeTruthy()
    expect(screen.getByText(/marked ready, but its brief\/spec is not complete enough/i)).toBeTruthy()
    const viewButton = screen.getByRole('button', { name: /view brief/i })
    const startButton = screen.getByRole('button', { name: 'Clean up brief' })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    expect(viewButton.compareDocumentPosition(startButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.click(startButton)

    expect(props.onRunTask).toHaveBeenCalledOnce()
    expect(props.onOpenSpecTab).not.toHaveBeenCalled()
    expect(screen.queryByText('Nothing is waiting')).toBeNull()
  })

  it('routes task-scoped questions to Thread instead of answering inline', async () => {
    const props = renderCurrent([
      {
        id: 'turn-question',
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
    ])

    expect(screen.getByText('Question waiting in Thread')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /url input only/i })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /open thread/i }))

    expect(props.onOpenThread).toHaveBeenCalledOnce()
  })

  it('keeps brief approval actions available in the current task card', async () => {
    const props = renderCurrent([
      {
        id: 'turn-brief',
        kind: 'brief_approval',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        brief: { userJob: 'Edit links inline.' },
      },
    ])

    await userEvent.click(screen.getByRole('button', { name: /review draft/i }))
    await userEvent.click(screen.getByRole('button', { name: /approve brief/i }))

    expect(props.onOpenSpecTab).toHaveBeenCalledOnce()
    expect(props.onApproveBrief).toHaveBeenCalledOnce()
  })

  it('renders spec review preview and approval actions', async () => {
    const props = renderCurrent([
      {
        id: 'turn-spec',
        kind: 'spec_review',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        spec: '## Summary\nAdd the link editor controls.\n\n## Acceptance Criteria\n- Controls render.',
      },
    ])

    expect(screen.getByRole('button', { name: /^approve spec$/i })).toBeTruthy()
    expect(screen.getByText('Add the link editor controls.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^approve spec$/i }))

    expect(props.onApproveSpec).toHaveBeenCalledOnce()
  })

  it('surfaces live escalation activity without making a separate task state', () => {
    renderCurrent([
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
        summary: 'Worker is stuck',
        details: 'Component import could not be resolved.',
        activity: [
          { at: now, label: 'Finished write checkpoint', tone: 'ok', detail: 'Recorded failed import.' },
        ],
      },
    ])

    expect(screen.getByText('Worker is stuck')).toBeTruthy()
    expect(screen.getByText('Component import could not be resolved.')).toBeTruthy()
    expect(screen.getByText('Finished write checkpoint')).toBeTruthy()
  })

  it('lets imported drafts be shaped directly from the current task card', async () => {
    const props = renderCurrent([
      {
        id: 'turn-import',
        kind: 'inflight',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-import-1',
        taskTitle: 'Knit: add version diff view',
        taskStatus: 'import_draft',
        importedDraft: true,
        summary: 'Imported from planning notes.',
      },
    ])

    expect(screen.getByText('Needs brief')).toBeTruthy()
    expect(screen.getByText(/Next step: turn this note into a task brief with scope, evidence, and acceptance criteria/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /draft task brief/i }))

    expect(screen.queryByRole('button', { name: /review draft/i })).toBeNull()
    expect(props.onOpenSpecTab).not.toHaveBeenCalled()
    expect(props.onShapeDraft).toHaveBeenCalledOnce()
  })

  it('shows imported draft shaping as Guildhall-owned progress, not user babysitting', () => {
    renderCurrent([
      {
        id: 'turn-import-shaping',
        kind: 'inflight',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-import-2',
        taskTitle: 'Knit: add revision summary',
        taskStatus: 'exploring',
        importedDraft: true,
        summary: 'Guildhall is shaping the imported note.',
      },
    ])

    expect(screen.getByText('Paused')).toBeTruthy()
    expect(screen.getByText(/Resume when you want this task to keep moving/i)).toBeTruthy()
    expect(screen.queryByText('Task brief in progress')).toBeNull()
    expect(screen.queryByText(/Continue drafting the brief here when you are ready/i)).toBeNull()
    expect(screen.getByRole('button', { name: /continue shaping brief/i })).toBeTruthy()
  })

  it('surfaces partial durable progress as recovery instead of queued work', () => {
    renderCurrent([
      {
        id: 'turn-recovery',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'in_progress',
        summary: 'Worker started implementation.',
        activity: [
          { at: now, label: 'Write file src/components/LinkEditor.svelte', tone: 'ok', detail: 'Updated link editor controls.' },
          { at: now, label: 'Worker timed out after 120 seconds', tone: 'danger', detail: 'No new assistant message arrived.' },
        ],
      },
    ])

    expect(screen.getByText('Needs recovery')).toBeTruthy()
    expect(screen.getByText(/Partial progress was saved, then the agent failed/i)).toBeTruthy()
    expect(screen.getByText('Write file src/components/LinkEditor.svelte')).toBeTruthy()
    expect(screen.queryByText('Queued')).toBeNull()
  })

  it('turns escalation blockers into a decision card with a recommended action', async () => {
    const props = renderCurrent([
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
    ])

    expect(screen.getByText('Recovery needed')).toBeTruthy()
    expect(screen.getByText('Spec unclear')).toBeTruthy()
    expect(screen.getByText(/The worker found src\/components\/Card.svelte/i)).toBeTruthy()
    expect(screen.getByText(/Most likely next step/i)).toBeTruthy()
    expect(screen.queryByText(/Open the task/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Review task details/i })).toBeNull()

    const reworkButton = screen.getByRole('button', { name: /^Rework spec$/i })
    expect(reworkButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(reworkButton)
    await userEvent.click(screen.getByRole('button', { name: /View spec and evidence/i }))

    expect(props.onOpenEscalationAction).toHaveBeenCalledWith('esc-1', 'retry')
    expect(props.onOpenSpecTab).toHaveBeenCalledOnce()
  })

  it('turns acceptance-criteria evidence blockers into a concrete recovery action', async () => {
    const props = renderCurrent([
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
        summary: 'Cannot satisfy required AC-8 evidence command under current authoritative verification gate.',
        details: 'Coordinator scoped instructions require an AC-8 evidence block with the exact pnpm --dir frontend test result (timestamp + exit code) and concrete auth test specs.',
      },
    ])

    expect(screen.getByText('Queued')).toBeTruthy()
    expect(screen.getByText('One missing check needs to run.')).toBeTruthy()
    expect(screen.getByText(/not asking you to prove anything/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Run the missing check/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /View spec and evidence/i })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Run the missing check/i }))
    expect(props.onRunEscalationAction).toHaveBeenCalledWith('esc-1')
    expect(document.body.textContent).not.toMatch(/\bAC-8\b/)
  })

  it('shows queued work, run errors, and checklist progress in one card', async () => {
    const props = renderCurrent(
      [
        {
          id: 'turn-inflight',
          kind: 'inflight',
          at: now,
          persona: 'worker',
          status: 'active',
          phase: 'inflight',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'ready',
          summary: 'Ready for work.',
          checklist: {
            title: 'Implementation path',
            doneCount: 2,
            totalSteps: 2,
            steps: [
              { id: 'read', title: 'Read files', why: 'Find existing patterns.', status: 'done' },
              { id: 'write', title: 'Write controls', why: 'Add the requested UI.', status: 'done' },
            ],
          },
        },
      ],
      { runError: 'Repo is dirty.' },
    )

    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Implementation path')).toBeTruthy()
    expect(screen.getByText('Repo is dirty.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /resume only this work item/i }))

    expect(props.onRunTask).toHaveBeenCalledOnce()
  })

  it('does not offer a run action for terminal task states', () => {
    const props = renderCurrent([
      {
        id: 'turn-done',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'done',
        summary: 'Task completed.',
      },
    ])

    expect(screen.getByText('Task completed.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /run this task/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resume work/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /resume only this work item/i })).toBeNull()
    expect(props.onRunTask).not.toHaveBeenCalled()
  })

  it('does not offer Resume work for a ready task with an incomplete checklist', async () => {
    const props = renderCurrent([
      {
        id: 'turn-incomplete-ready',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'ready',
        summary: 'Ready for work.',
        checklist: {
          title: 'Task brief checklist',
          doneCount: 2,
          totalSteps: 4,
          activeStepId: 'success',
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'active' },
            { id: 'criteria', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      },
    ])

    expect(screen.getAllByText('Needs brief').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('The source notes need an outcome and acceptance checks before implementation.')).toBeTruthy()
    expect(screen.getAllByText('Missing').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByRole('button', { name: /resume work/i })).toBeNull()
    const startButton = screen.getByRole('button', { name: 'Clean up brief' })
    expect(startButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(startButton)

    expect(props.onRunTask).toHaveBeenCalledOnce()
    expect(props.onOpenSpecTab).not.toHaveBeenCalled()
  })

  it('names the exact missing brief field in task details', async () => {
    const props = renderCurrent([
      {
        id: 'turn-incomplete-ready',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Block menu / block side menu',
        taskStatus: 'ready',
        summary: 'Ready for work.',
        checklist: {
          title: 'Task brief checklist',
          doneCount: 3,
          totalSteps: 4,
          activeStepId: 'acceptance',
          steps: [
            { id: 'title', title: 'Readable title', why: 'Give this work a name someone can recognize later.', status: 'done' },
            { id: 'description', title: 'Starting point', why: 'Say what Guildhall should inspect or use as the starting evidence.', status: 'done' },
            { id: 'success', title: 'Success target', why: 'State what should be true when this work is finished.', status: 'done' },
            { id: 'acceptance', title: 'Acceptance criteria', why: 'Add the concrete checks Guildhall should use before calling the work done.', status: 'pending' },
          ],
        },
      },
    ])

    expect(screen.getAllByText('Needs brief').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('The source notes need concrete acceptance checks before implementation.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Clean up brief' }))

    expect(props.onRunTask).toHaveBeenCalledOnce()
  })

  it('shows already-running ready work as queued instead of starting silently', () => {
    renderCurrent(
      [
        {
          id: 'turn-ready-running',
          kind: 'inflight',
          at: now,
          persona: 'worker',
          status: 'active',
          phase: 'inflight',
          taskId: 'task-link-editor',
          taskTitle: 'Knit: add link editor controls',
          taskStatus: 'ready',
          summary: 'Ready for work.',
        },
      ],
      { runStatus: 'running' },
    )

    const queuedChip = screen.getByText('Queued')
    expect(queuedChip).toBeTruthy()
    expect(queuedChip.classList.contains('tone-running')).toBe(true)
    expect(screen.getByRole('button', { name: /already queued/i })).toHaveProperty('disabled', true)
    expect(screen.queryByRole('button', { name: /resume work/i })).toBeNull()
  })

  it('identifies a live worker as in flight with recent activity', () => {
    renderCurrent([
      {
        id: 'turn-live',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'in_progress',
        summary: 'Worker is editing files.',
        liveAgent: {
          name: 'worker-agent',
          startedAt: now,
          lastEventLabel: 'Started write checkpoint',
          lastEventAt: now,
        },
        activity: [
          { at: now, label: 'Started write checkpoint', tone: 'running', detail: 'Writing files.' },
        ],
      },
    ])

    expect(screen.getByText('Live progress')).toBeTruthy()
    expect(screen.getByText('Working')).toBeTruthy()
    expect(screen.getByText('Activity log')).toBeTruthy()
    expect(screen.getByText('Started write checkpoint')).toBeTruthy()
  })

  it('keeps start and finish events visible inside an explicit activity log', () => {
    renderCurrent([
      {
        id: 'turn-live',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'in_progress',
        summary: 'Worker is editing files.',
        liveAgent: {
          name: 'worker-agent',
          startedAt: now,
          lastEventLabel: 'Finished log progress',
          lastEventAt: '2026-05-19T15:01:00.000Z',
        },
        activity: [
          { at: now, label: 'Started log progress', tone: 'running' },
          { at: '2026-05-19T15:01:00.000Z', label: 'Finished log progress', tone: 'ok' },
        ],
      },
    ])

    expect(screen.getByText('Current status')).toBeTruthy()
    expect(screen.getByText('Activity log')).toBeTruthy()
    expect(screen.getByText('Started log progress')).toBeTruthy()
    expect(screen.getByText('Finished log progress')).toBeTruthy()
  })

  it('shows local model startup waits as still active instead of silently stuck', () => {
    vi.setSystemTime(new Date('2026-05-19T15:02:00.000Z'))

    renderCurrent([
      {
        id: 'turn-local-model',
        kind: 'inflight',
        at: now,
        persona: 'worker',
        status: 'active',
        phase: 'inflight',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'in_progress',
        summary: 'Local provider is preparing.',
        liveAgent: {
          name: 'worker-agent',
          startedAt: now,
          lastEventLabel: 'Waiting for the local model to respond.',
          providerKind: 'local',
          lastEventAt: now,
          silentMs: 120_000,
        },
      },
    ])

    expect(screen.getByText('Working')).toBeTruthy()
    expect(screen.getByText(/Local model is still loading or generating/i)).toBeTruthy()
  })

  it('labels queued spec revisions, reviews, and gate checks with the right resume action', async () => {
    const props = renderCurrent([
      {
        id: 'turn-spec-revision',
        kind: 'inflight',
        at: now,
        persona: 'spec',
        status: 'active',
        phase: 'spec',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'exploring',
        summary: 'Spec needs one more pass.',
      },
    ])

    expect(screen.getByText('Paused')).toBeTruthy()
    const reviseButton = screen.getByRole('button', { name: /revise spec/i })
    expect(reviseButton.classList.contains('v-agent')).toBe(true)
    await userEvent.click(reviseButton)

    expect(props.onRunTask).toHaveBeenCalledOnce()
  })

  it('distinguishes reviewer and gate checker live agents in the current card', () => {
    renderCurrent([
      {
        id: 'turn-reviewer',
        kind: 'inflight',
        at: now,
        persona: 'reviewer',
        status: 'active',
        phase: 'review',
        taskId: 'task-link-editor',
        taskTitle: 'Knit: add link editor controls',
        taskStatus: 'review',
        summary: 'Reviewer is checking the diff.',
        liveAgent: {
          name: 'reviewer-agent',
          startedAt: now,
          lastEventLabel: 'Reviewing diff',
          lastEventAt: now,
        },
        activity: [
          { at: now, label: 'Reviewing diff', tone: 'running', detail: 'Checking implementation changes.' },
        ],
      },
    ])

    expect(screen.getByText('Review')).toBeTruthy()
    expect(screen.getByText('Reviewing diff')).toBeTruthy()
  })
})
