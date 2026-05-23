// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExpertsTab from '../ExpertsTab.svelte'
import HistoryTab from '../HistoryTab.svelte'
import ProvenanceTab from '../ProvenanceTab.svelte'
import TranscriptTab from '../TranscriptTab.svelte'
import SpecFillChecklist from '../SpecFillChecklist.svelte'
import SuggestionCard from '../SuggestionCard.svelte'
import LogViewer from '../../../lib/LogViewer.svelte'
import Section from '../../../lib/Section.svelte'
import { path } from '../../../lib/nav.svelte.js'
import type { ContextDebugRecord, Task } from '../../../lib/types.js'

const now = '2026-05-19T15:00:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-link-editor',
    title: 'Knit: add link editor controls',
    status: 'pending_pr',
    description: 'Add link controls.',
    origination: 'workspace_import',
    proposedBy: 'coordinator-agent',
    proposalRationale: 'Planning notes identify the editor gap.',
    worktreePath: '/tmp/guildhall/task-link-editor',
    branchName: 'guildhall/task-link-editor',
    baseBranch: 'main',
    createdAt: now,
    updatedAt: now,
    completedAt: now,
    parentGoalId: 'goal-editor',
    permissionMode: 'workspace-write',
    dependsOn: ['task-editor-foundation'],
    revisionCount: 2,
    remediationAttempts: 1,
    terminalSummary: {
      headline: 'Pull request opened',
      detail: 'https://github.test/pr/12',
    },
    mergeRecord: {
      result: 'pending_pr',
      strategy: 'pull_request',
      fromBranch: 'guildhall/task-link-editor',
      toBranch: 'main',
      mergedAt: now,
      commitSha: 'abc123',
      prUrl: 'https://github.test/pr/12',
      detail: 'Awaiting review.',
    },
    shelveReason: {
      code: 'duplicate',
      detail: 'Covered by the editor foundation task.',
      rejectedBy: 'coordinator-agent',
      rejectedAt: now,
    },
    gateResults: [
      {
        gateId: 'unit',
        type: 'command',
        passed: false,
        checkedAt: now,
        output: 'Cannot find module LoomaButton.vue',
      },
    ],
    escalations: [
      {
        id: 'esc-1',
        reason: 'missing_component',
        summary: 'Worker is stuck.',
        details: 'The imported component path does not exist.',
      },
      {
        id: 'esc-2',
        reason: 'resolved_scope',
        summary: 'Scope was clarified.',
        resolvedAt: now,
      },
    ],
    notes: [
      {
        role: 'worker-agent',
        timestamp: now,
        content: 'Read <Editor.vue> and found the toolbar adapter.',
      },
    ],
    ...overrides,
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('drawer task detail tabs', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders provenance, terminal outcome, shelve reason, and context health in one audit trail', () => {
    const contextDebug: ContextDebugRecord[] = [
      {
        agentName: 'worker-agent',
        modelId: 'qwen-test',
        at: now,
        taskStatus: 'in_progress',
        contextChars: 1200,
        promptChars: 800,
        reasons: ['Loaded likely support files from checkpoint memory.'],
        health: [{ severity: 'error', code: 'missing-file', message: 'Expected support file is absent.' }],
        sections: [{ key: 'task', label: 'Task', chars: 400, included: true }],
      },
    ]

    render(ProvenanceTab, { task: task(), contextDebug })

    expect(screen.getByText('Workspace Import')).toBeInTheDocument()
    expect(screen.getByText('Pull request opened')).toBeInTheDocument()
    expect(screen.getByText('Awaiting review.')).toBeInTheDocument()
    expect(screen.getByText('Covered by the editor foundation task.')).toBeInTheDocument()
    expect(screen.getByText('Loaded likely support files from checkpoint memory.')).toBeInTheDocument()
    expect(screen.getByText(/missing-file/)).toBeInTheDocument()
    expect(screen.getByText('Task: 400 chars')).toBeInTheDocument()
  })

  it('renders revision history, gate failures, and open versus resolved escalations', () => {
    render(HistoryTab, { task: task() })

    expect(screen.getByText(/Revision count:/)).toBeInTheDocument()
    expect(screen.getByText('unit')).toBeInTheDocument()
    expect(screen.getByText('Cannot find module LoomaButton.vue')).toBeInTheDocument()
    expect(screen.getByText('missing_component')).toBeInTheDocument()
    expect(screen.getByText('resolved_scope')).toBeInTheDocument()
    expect(screen.getByText('Worker is stuck.')).toBeInTheDocument()
  })

  it('renders exploring transcript entries before task notes', () => {
    render(TranscriptTab, {
      task: task(),
      exploringTranscript: {
        path: '/tmp/project/memory/exploring/task-link-editor.md',
        content: [
          '# Exploring transcript: task-link-editor',
          '',
          '## [2026-05-19T15:01:00.000Z] system',
          '',
          'Draft a complete task brief.',
          '',
          '---',
          '## [2026-05-19T15:02:00.000Z] spec-agent',
          '',
          'Let me inspect `PROJECT_STATE.md` before drafting.',
          '',
          '---',
        ].join('\n'),
      },
    })

    expect(screen.getByText('system')).toBeInTheDocument()
    expect(screen.getByText('spec-agent')).toBeInTheDocument()
    expect(screen.getByText(/Let me inspect/)).toHaveTextContent('Let me inspect PROJECT_STATE.md before drafting.')
    expect(screen.getByText('Task notes')).toBeInTheDocument()
    expect(screen.getByText(/Read/)).toHaveTextContent('Read <Editor.vue> and found the toolbar adapter.')
  })

  it('falls back to task notes when no exploring transcript exists', () => {
    render(TranscriptTab, { task: task() })

    expect(screen.getByText('worker-agent')).toBeInTheDocument()
    expect(screen.getByText(/Read/)).toHaveTextContent('Read <Editor.vue> and found the toolbar adapter.')
  })

  it('renders expert composition warnings, persona verdicts, gates, and unattributed review records', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      primaryEngineer: 'frontend-engineer',
      applicable: [
        {
          slug: 'frontend-engineer',
          name: 'Frontend engineer',
          role: 'engineer',
          blurb: 'Owns component integration and browser behavior.',
        },
        {
          slug: 'visual-designer',
          name: 'Visual designer',
          role: 'designer',
          blurb: 'Checks hierarchy and spacing.',
        },
      ],
      reviewers: [{ slug: 'visual-designer', name: 'Visual designer', role: 'designer' }],
      verdictsBySlug: {
        'visual-designer': [
          {
            verdict: 'revise',
            reviewerPath: 'guilds/visual-designer',
            recordedAt: now,
            reason: 'Spacing needs air.',
            reasoning: 'The card hierarchy is still cramped.',
          },
        ],
        unattributed: [
          {
            verdict: 'approve',
            reviewerPath: 'legacy-review',
            recordedAt: now,
            reason: 'No deterministic issues.',
          },
        ],
      },
      gateResultsBySlug: {
        'frontend-engineer': [
          {
            gateId: 'typecheck',
            passed: true,
            checkedAt: now,
            output: 'pnpm typecheck passed',
          },
        ],
        unattributed: [
          {
            gateId: 'lint',
            passed: false,
            checkedAt: now,
            output: 'Unused import',
          },
        ],
      },
      warnings: ['No security reviewer was applicable.'],
    })))

    render(ExpertsTab, { taskId: 'task-link-editor' })

    await waitFor(() => expect(screen.getByText('At the table (2)')).toBeInTheDocument())
    expect(screen.getByText('No security reviewer was applicable.')).toBeInTheDocument()
    expect(screen.getByText('Frontend engineer')).toBeInTheDocument()
    expect(screen.getByText('primary')).toBeInTheDocument()
    expect(screen.getByText('reviewer')).toBeInTheDocument()
    expect(screen.getByText('Spacing needs air.')).toBeInTheDocument()
    expect(screen.getByText('pnpm typecheck passed')).toBeInTheDocument()
    expect(screen.getByText('Unused import')).toBeInTheDocument()
    expect(screen.getByText('No deterministic issues.')).toBeInTheDocument()
  })

  it('surfaces expert endpoint failures instead of silently emptying the tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'experts unavailable' }, 500)))

    render(ExpertsTab, { taskId: 'task-link-editor' })

    await waitFor(() => expect(screen.getByText('Failed to load: experts unavailable')).toBeInTheDocument())
  })
})

describe('shared detail primitives', () => {
  afterEach(() => cleanup())

  it('renders section headings and keeps logs readable while following the tail', async () => {
    render(Section, {
      title: 'Evidence',
    })
    expect(screen.getByRole('heading', { name: 'Evidence' })).toBeInTheDocument()

    cleanup()
    render(LogViewer, {
      lines: ['Started gate check', 'pnpm test passed'],
      maxHeight: '120px',
      followTail: true,
      empty: 'No logs yet',
    })

    expect(screen.getByText('Started gate check')).toBeInTheDocument()
    expect(screen.getByText('pnpm test passed')).toBeInTheDocument()
    expect(screen.queryByText('No logs yet')).not.toBeInTheDocument()
  })

  it('renders the spec-fill checklist, jumps to missing sections, and persists skip state', async () => {
    window.history.replaceState({}, '', '/projects/looma-knit/task/task-link-editor')
    path.value = '/projects/looma-knit/task/task-link-editor'
    const target = document.createElement('div')
    target.dataset.specSection = 'section-acceptance'
    const scrollIntoView = vi.fn()
    target.scrollIntoView = scrollIntoView
    document.body.appendChild(target)
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/skip')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          stepId: 'acceptance',
          projectId: 'looma-knit',
        })
        return json({ ok: true })
      }
      if (url.includes('/unskip')) {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toMatchObject({
          stepId: 'brief',
          projectId: 'looma-knit',
        })
        return json({ ok: true })
      }
      return json({
        wizards: [
          {
            id: 'spec-fill',
            totalSteps: 4,
            doneCount: 2,
            complete: false,
            activeStepId: 'acceptance',
            steps: [
              { id: 'title', title: 'Title', why: 'Make the work scannable.', status: 'done', skippable: false },
              { id: 'description', title: 'Description', why: 'Explain the intent.', status: 'done', skippable: false },
              { id: 'brief', title: 'Brief', why: 'Optional product frame.', status: 'skipped', skippable: true },
              { id: 'acceptance', title: 'Acceptance', why: 'Give the reviewer a finish line.', status: 'pending', skippable: true },
            ],
          },
        ],
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(SpecFillChecklist, { taskId: 'task-link-editor', refreshKey: 1 })

    await screen.findByText(/2 of 4/)
    await userEvent.click(screen.getByRole('button', { name: /acceptance give the reviewer/i }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })

    await userEvent.click(screen.getByRole('button', { name: /^skip$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^resume$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^hide$/i }))

    expect(screen.queryByText('Give the reviewer a finish line.')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/skip'))).toBe(true)
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/unskip'))).toBe(true)
    })
  })

  it('keeps suggested tasks as one clear yes/no/redirect decision', async () => {
    const onYes = vi.fn()
    const onNo = vi.fn()
    const onDifferent = vi.fn(async () => {})

    render(SuggestionCard, {
      task: task({
        title: 'Add block menu',
        description: 'Expose slash-command blocks from the editor.',
        proposedBy: 'project-manager',
        proposalRationale: 'Roadmap calls this out as next user value.',
      }),
      busy: false,
      onYes,
      onNo,
      onDifferent,
    })

    expect(screen.getByText(/Suggested by project-manager/)).toHaveTextContent(
      'Suggested by project-manager — Roadmap calls this out as next user value.',
    )
    await userEvent.click(screen.getByRole('button', { name: /yes, do this/i }))
    await userEvent.click(screen.getByRole('button', { name: /tell me different/i }))
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
    await userEvent.type(screen.getByPlaceholderText(/what should i do instead/i), 'Keep drag handles separate.')
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }))
    await userEvent.click(screen.getByRole('button', { name: /no, drop it/i }))

    expect(onYes).toHaveBeenCalledOnce()
    expect(onDifferent).toHaveBeenCalledWith('Keep drag handles separate.')
    expect(onNo).toHaveBeenCalledOnce()
  })
})
