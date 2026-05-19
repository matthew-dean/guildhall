// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import CurrentTab from '../CurrentTab.svelte'
import type { Task, TaskThreadTurn } from '../../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function baseTask(): Task {
  return {
    id: 'task-link-editor',
    title: 'Knit: add link editor controls',
    status: 'ready',
    description: 'Add link controls.',
  }
}

function handlers() {
  return {
    onApproveBrief: vi.fn(),
    onApproveSpec: vi.fn(),
    onRunTask: vi.fn(),
    onShapeDraft: vi.fn(),
    onOpenSpecTab: vi.fn(),
    onAnswerQuestion: vi.fn(async () => {}),
  }
}

function renderCurrent(turns: TaskThreadTurn[], options: { runError?: string | null } = {}) {
  const props = {
    task: baseTask(),
    turns,
    busy: false,
    runBusy: false,
    runError: options.runError ?? null,
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
    renderCurrent([])

    expect(screen.getByText('Nothing is waiting')).toBeTruthy()
    expect(screen.getByText('This task does not currently need a decision from you.')).toBeTruthy()
  })

  it('answers task-scoped questions inline', async () => {
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

    await userEvent.click(screen.getByText('URL input only'))

    expect(props.onAnswerQuestion).toHaveBeenCalledWith('q-link-scope', 'URL input only')
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

    expect(screen.getByText('Needs shaping')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /review draft/i }))
    await userEvent.click(screen.getByRole('button', { name: /let guildhall shape this/i }))

    expect(props.onOpenSpecTab).toHaveBeenCalledOnce()
    expect(props.onShapeDraft).toHaveBeenCalledOnce()
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
            doneCount: 1,
            totalSteps: 2,
            activeStepId: 'write',
            steps: [
              { id: 'read', title: 'Read files', why: 'Find existing patterns.', status: 'done' },
              { id: 'write', title: 'Write controls', why: 'Add the requested UI.', status: 'active' },
            ],
          },
        },
      ],
      { runError: 'Repo is dirty.' },
    )

    expect(screen.getByText('Ready')).toBeTruthy()
    expect(screen.getByText('Implementation path')).toBeTruthy()
    expect(screen.getByText('Repo is dirty.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /start work/i }))

    expect(props.onRunTask).toHaveBeenCalledOnce()
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

    expect(screen.getByText('In flight')).toBeTruthy()
    expect(screen.getByText('Started write checkpoint')).toBeTruthy()
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

    expect(screen.getByText('In flight')).toBeTruthy()
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

    expect(screen.getByText('Spec revision queued')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /revise spec/i }))

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
