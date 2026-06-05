// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExpertsTab from '../ExpertsTab.svelte'
import HistoryTab from '../HistoryTab.svelte'
import JourneyTab from '../JourneyTab.svelte'
import ProvenanceTab from '../ProvenanceTab.svelte'
import TranscriptTab from '../TranscriptTab.svelte'
import SpecFillChecklist from '../SpecFillChecklist.svelte'
import SpecTab from '../SpecTab.svelte'
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
    businessEnvelope: { goalId: 'goal-editor' },
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

  it('shows changed files in a wide inspect modal and skips directory paths', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      expect(url).toContain('/api/project/task/task-link-editor/file')
      expect(url).toContain('projectId=looma-knit')
      expect(url).toContain('path=frontend%2Fapp%2Fpages%2Fdashboard.vue')
      return json({
        taskId: 'task-link-editor',
        path: 'frontend/app/pages/dashboard.vue',
        content: '<template>Dashboard</template>\n',
        language: 'vue',
        truncated: false,
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(JourneyTab, {
      task: task({
        latestCheckpoint: {
          filesTouched: [
            'frontend/app/pages/dashboard.vue',
            'frontend/package.json',
            'frontend/app/lib/',
          ],
        },
        gitStory: {
          samplePaths: ['pnpm-lock.yaml', 'frontend/app/lib/'],
        },
      }),
      projectId: 'looma-knit',
    })

    expect(screen.getByText('3 files changed.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Inspect files' }))

    expect(screen.getByRole('dialog', { name: 'Files changed' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect frontend/app/pages/dashboard.vue' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect frontend/package.json' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect pnpm-lock.yaml' })).toBeInTheDocument()
    expect(screen.queryByText('frontend/app/lib/')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Inspect frontend/app/pages/dashboard.vue' }))

    expect(await screen.findByText('<template>Dashboard</template>')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shows the request shape and component stack behind ambiguous intake', () => {
    render(JourneyTab, {
      task: task({
        requestIntake: {
          intent: 'ambiguous_spec_or_implementation',
          recommendedNextAction: 'ask_clarifying_question',
          ambiguity: 'The request could mean a policy/spec, implementation, or a parent feature plan.',
          componentStack: [
            { kind: 'policy_decision', title: 'Decide the overhead charge policy', role: 'Name the business rule.' },
            { kind: 'documented_spec', title: 'Write the policy/spec', role: 'Capture examples and scope.' },
            { kind: 'implementation', title: 'Apply the policy in product surfaces', role: 'Split after approval.' },
          ],
        },
      }),
    })

    expect(screen.getByText('Request shape')).toBeInTheDocument()
    expect(screen.getByText('Ambiguous Spec Or Implementation')).toBeInTheDocument()
    expect(screen.getByText('Ask Clarifying Question')).toBeInTheDocument()
    expect(screen.getByText(/Decide the overhead charge policy/)).toBeInTheDocument()
    expect(screen.getByText(/Apply the policy in product surfaces/)).toBeInTheDocument()
  })

  it('renders proof paths and completion handoff without executable launch controls', () => {
    render(JourneyTab, {
      task: task({
        proofPaths: [
          {
            id: 'task-link-editor-proof-path',
            scope: { type: 'task', id: 'task-link-editor' },
            title: 'Verify link editor controls',
            summary: 'Run focused tests and inspect the editor route.',
            status: 'verified',
            launchSteps: [
              {
                id: 'test',
                kind: 'copy_command',
                title: 'Run focused tests',
                command: 'pnpm vitest run src/editor/link-editor.test.ts',
              },
              {
                id: 'route',
                kind: 'open_url',
                title: 'Open editor',
                url: 'http://localhost:5173/editor',
              },
            ],
            expectedEvidence: [
              { id: 'unit', kind: 'automated', description: 'Focused editor tests pass.', required: true },
              { id: 'browser', kind: 'manual', description: 'Editor route was inspected.', required: true },
              { id: 'preview', kind: 'provider', description: 'Preview deployment is green.', required: false },
            ],
            verificationRecords: [
              {
                id: 'unit-run',
                evidenceId: 'unit',
                kind: 'automated',
                status: 'passed',
                summary: 'Focused editor tests passed.',
                command: 'pnpm vitest run src/editor/link-editor.test.ts',
                recordedAt: now,
                recordedBy: 'worker-agent',
              },
            ],
            createdAt: now,
            updatedAt: now,
            createdBy: 'spec-agent',
          },
        ],
        completionHandoff: {
          id: 'task-link-editor-completion-handoff',
          taskId: 'task-link-editor',
          completedAt: now,
          completedBy: 'gate-checker-agent',
          summary: 'The link editor controls are ready to inspect.',
          proofPathIds: ['task-link-editor-proof-path'],
          verificationSummary: '1 automated proof, 0 manual proof, 0 provider proof.',
          automatedProof: [
            {
              id: 'unit-run',
              evidenceId: 'unit',
              kind: 'automated',
              status: 'passed',
              summary: 'Focused editor tests passed.',
              command: 'pnpm vitest run src/editor/link-editor.test.ts',
              recordedAt: now,
              recordedBy: 'worker-agent',
            },
          ],
          manualProof: [],
          providerProof: [],
          residualRisk: 'Browser inspection is still required before release.',
        },
      }),
    })

    expect(screen.getByText('Proof path')).toBeInTheDocument()
    expect(screen.getByText('Verify link editor controls')).toBeInTheDocument()
    expect(screen.getByText('Run focused tests')).toBeInTheDocument()
    expect(screen.getByText('pnpm vitest run src/editor/link-editor.test.ts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open editor' })).toHaveAttribute('href', 'http://localhost:5173/editor')
    expect(screen.getByText('Automated Required')).toBeInTheDocument()
    expect(screen.getByText('Manual Required')).toBeInTheDocument()
    expect(screen.getByText('Provider Optional')).toBeInTheDocument()
    expect(screen.getByText('Completion handoff')).toBeInTheDocument()
    expect(screen.getByText('Runtime evidence')).toBeInTheDocument()
    expect(screen.getByText('Remaining uncertainty')).toBeInTheDocument()
    expect(screen.getByText('Browser inspection is still required before release.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument()
  })

  it('hides stale handoff packets after a recovery spec seed moves a task back to spec review', () => {
    render(SpecTab, {
      task: task({
        status: 'spec_review',
        title: 'Block menu / block side menu',
        description: 'looma/docs/editor-roadmap.md: - **Block menu / block side menu**',
        spec: '## Summary\nBuild the block menu.\n\n## Completion Boundary\n- Product outcome: The block menu works.',
        acceptanceCriteria: [
          {
            id: 'ac-1',
            description: 'Given the editor, when the block handle opens, then block actions are available.',
            verifiedBy: 'review',
            met: false,
          },
        ],
        productBrief: {
          userJob: 'I want block menu work shaped from current evidence.',
          successMetric: 'A reviewable spec exists.',
          antiPatterns: [],
          authoredBy: 'coordinator-recovery',
          authoredAt: now,
        },
        latestSelfCritique: 'Self-critique: stale worker handoff said the build was failing.',
        latestCheckpoint: {
          step: 4,
          agentId: 'worker-agent',
          writtenAt: now,
          intent: 'Old implementation attempt.',
        },
        notes: [
          {
            agentId: 'coordinator-recovery',
            role: 'system',
            content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane.',
            timestamp: now,
          },
        ],
      }),
      busy: false,
      onApproveBrief: vi.fn(),
      onApproveSpec: vi.fn(),
      onPause: vi.fn(),
      onShelve: vi.fn(),
      onUnshelve: vi.fn(),
      onResolveEscalation: vi.fn(),
      onRunEscalationAction: vi.fn(),
      onSendFollowUp: vi.fn(),
      onAddAcceptance: vi.fn(),
    })

    expect(screen.queryByText('Latest handoff packet')).not.toBeInTheDocument()
    expect(screen.queryByText(/stale worker handoff/i)).not.toBeInTheDocument()
    expect(screen.getByText('From looma/docs/editor-roadmap.md')).toBeInTheDocument()
    expect(screen.queryByText(/looma\/docs\/editor-roadmap\.md: -/)).not.toBeInTheDocument()
    expect(screen.getByText('Task brief')).toBeInTheDocument()
    expect(screen.getByText(/Build the block menu/)).toBeInTheDocument()
  })

  it('does not show stale handoff packets on tasks with no current task-local spec context', () => {
    render(SpecTab, {
      task: task({
        id: 'task-import-1l0mr2r',
        title: 'ContextMenu',
        status: 'in_progress',
        description: 'Shape the ContextMenu API.',
        productBrief: undefined,
        spec: undefined,
        acceptanceCriteria: [],
        latestSelfCritique: 'Self-critique: changed /Users/matthew/.guildhall/worktrees/looma-knit/task-import-gs82f5/packages/editor/src/link-editor.ts.',
        latestCheckpoint: {
          step: 5,
          agentId: 'worker-agent',
          writtenAt: now,
          filesTouched: [
            '/Users/matthew/.guildhall/worktrees/looma-knit/task-import-gs82f5/packages/editor/src/link-editor.ts',
          ],
        },
      }),
      busy: false,
      onApproveBrief: vi.fn(),
      onApproveSpec: vi.fn(),
      onPause: vi.fn(),
      onShelve: vi.fn(),
      onUnshelve: vi.fn(),
      onResolveEscalation: vi.fn(),
      onRunEscalationAction: vi.fn(),
      onSendFollowUp: vi.fn(),
      onAddAcceptance: vi.fn(),
    })

    expect(screen.queryByText('Latest handoff packet')).not.toBeInTheDocument()
    expect(screen.queryByText(/task-import-gs82f5/)).not.toBeInTheDocument()
    expect(screen.queryByText(/link-editor\.ts/)).not.toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
    expect(screen.getByText('Shape the ContextMenu API.')).toBeInTheDocument()
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

    await userEvent.click(screen.getByRole('button', { name: /^skip acceptance$/i }))
    await userEvent.click(screen.getByRole('button', { name: /^resume brief$/i }))
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
