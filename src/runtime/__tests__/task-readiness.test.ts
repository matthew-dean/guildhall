import { describe, expect, it } from 'vitest'
import type { Task } from '@guildhall/core'

import {
  assessTaskReadiness,
  contextBudgetEstimate,
  definitionOfDoneForTask,
  ifThenBlockerPlansForTask,
} from '../task-readiness.js'
import { taskKindFor } from '../task-kinds.js'
import { pickNextTask } from '../orchestrator-picker.js'

const now = '2026-05-28T12:00:00.000Z'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Build login buttons',
    description: overrides.description ?? 'Add Google and Apple login buttons.',
    domain: overrides.domain ?? 'frontend',
    projectPath: overrides.projectPath ?? '/repo/app',
    status: overrides.status ?? 'spec_review',
    priority: overrides.priority ?? 'normal',
    spec: overrides.spec,
    acceptanceCriteria: overrides.acceptanceCriteria ?? [],
    outOfScope: overrides.outOfScope ?? [],
    dependsOn: overrides.dependsOn ?? [],
    notes: overrides.notes ?? [],
    gateResults: overrides.gateResults ?? [],
    reviewVerdicts: overrides.reviewVerdicts ?? [],
    adjudications: overrides.adjudications ?? [],
    escalations: overrides.escalations ?? [],
    agentIssues: overrides.agentIssues ?? [],
    revisionCount: overrides.revisionCount ?? 0,
    remediationAttempts: overrides.remediationAttempts ?? 0,
    origination: overrides.origination ?? 'human',
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    ...overrides,
  }
}

describe('taskKindFor', () => {
  it('honors explicit workKind and maps setup work to implementation readiness', () => {
    expect(taskKindFor(task({ workKind: 'verification' }))).toBe('verification')
    expect(taskKindFor(task({ workKind: 'setup' }))).toBe('implementation')
  })

  it('infers research and decision work from task language when no kind is stored', () => {
    expect(taskKindFor(task({ title: 'Research auth provider options' }))).toBe('research')
    expect(taskKindFor(task({ title: 'Decide billing rollout policy' }))).toBe('decision')
  })

  it('keeps concrete app builds as implementation even when the spec mentions design decisions', () => {
    expect(taskKindFor(task({
      title: 'Pantry Pulse app spec',
      description: 'Build a small local web app.',
      spec: '## Design & Copy Decisions\nUse vanilla HTML, CSS, and JS.',
    }))).toBe('implementation')
  })
})

describe('assessTaskReadiness', () => {
  it('marks a proofable implementation task ready and persists finishability artifacts', () => {
    const readyTask = task({
      workKind: 'implementation',
      spec: [
        '## Summary',
        'Add Google and Apple buttons.',
        '',
        '## Completion Boundary',
        '- Product outcome: Users can choose Google or Apple sign-in.',
        '- What Guildhall can complete in code: Add buttons and callbacks.',
        '- External dependencies: OAuth apps already exist.',
        '- Owner-only setup: None.',
        '- Verification environment: local browser.',
        '- What counts as done: Browser proof and tests pass.',
        '- What must be split or blocked: None.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'AC-1', description: 'Google and Apple buttons are visible.', verifiedBy: 'review', met: false },
      ],
      proofPaths: [
        {
          id: 'proof-login',
          label: 'Open login page',
          kind: 'browser',
          status: 'agent-proposed',
          steps: [{ type: 'open_url', url: 'http://localhost:5173/login' }],
          expectedEvidence: ['Screenshot shows both buttons.'],
        },
      ],
      dependsOn: ['task-oauth-setup'],
    })

    const assessment = assessTaskReadiness(readyTask)

    expect(assessment.taskKind).toBe('implementation')
    expect(assessment.recommendation).toBe('ready')
    expect(assessment.definitionOfDone.items).toContain('Browser proof and tests pass.')
    expect(assessment.blockerPlans.map(plan => plan.if)).toContain('Dependency task-oauth-setup is not done')
    expect(assessment.contextBudget.fitsInOneWorkerBrief).toBe(true)
    expect(assessment.dimensions.every(dimension => dimension.status !== 'blocked')).toBe(true)
  })

  it('asks one question when outcome clarity needs user judgment', () => {
    const assessment = assessTaskReadiness(task({
      description: 'Make auth better.',
      spec: 'Improve auth.',
      acceptanceCriteria: [],
    }))

    expect(assessment.recommendation).toBe('needs_one_question')
    expect(assessment.openQuestion?.prompt).toMatch(/what should be true/i)
    expect(assessment.dimensions.find(dimension => dimension.id === 'outcome_clarity')?.status).toBe('blocked')
    expect(assessment.dimensions.find(dimension => dimension.id === 'user_judgment_exposure')?.status).toBe('warn')
  })

  it('routes mixed research and implementation to a research or spike precursor', () => {
    const assessment = assessTaskReadiness(task({
      title: 'Research and implement the best editor library',
      description: 'Compare editor libraries and wire the best one into the app.',
      spec: 'Research options, choose a library, implement it, and update UI.',
      acceptanceCriteria: [
        { id: 'AC-1', description: 'The chosen editor works in the app.', verifiedBy: 'review', met: false },
      ],
    }))

    expect(assessment.recommendation).toBe('needs_research_spike')
    expect(assessment.dimensions.find(dimension => dimension.id === 'uncertainty')?.status).toBe('blocked')
  })

  it('keeps approved fixed-spec work ready even when review prompts look like research', () => {
    const assessment = assessTaskReadiness(task({
      title: 'Implement dialogue-and-character-voice reviewer lane',
      status: 'ready',
      description: 'Evaluate documented review questions and add bounded local workspace proof.',
      spec: [
        '## Acceptance Criteria',
        '1. Implement dialogue-and-character-voice reviewer lane can ask and answer documented review prompts.',
        '',
        '## Completion Boundary',
        '- Product outcome: The reviewer lane records documented fiction-specific findings for a bounded proof fixture.',
        '- What counts as done: The lane emits actionable findings and proof is recorded.',
        '- What must be split or blocked: Nothing to split before this source-backed task runs.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'ac-1',
          description: 'The lane can ask and answer documented review prompts.',
          verifiedBy: 'review',
          met: false,
        },
      ],
      sizePlan: {
        taskId: 'dialogue',
        score: 5,
        band: 'large',
        action: 'proceed_with_warning',
        factors: [],
        recommendedChildren: [],
        reviewBudgetHint: 'thorough',
        reasons: [
          'Task size score: 5.',
          'Kept as runnable fixed-spec work because the accepted completion boundary says nothing must be split or blocked.',
        ],
        createdAt: '2026-07-05T13:48:19.876Z',
        createdBy: 'task-shaping',
      },
    }))

    expect(assessment.recommendation).toBe('ready')
    expect(assessment.dimensions.find(dimension => dimension.id === 'uncertainty')?.status).toBe('ok')
  })

  it('marks work as requiring child work when the context budget exceeds one worker brief', () => {
    const hugeSpec = Array.from({ length: 120 }, (_, index) => `Step ${index}: update a distinct screen, API, migration, and docs.`).join('\n')
    const assessment = assessTaskReadiness(task({
      title: 'Rebuild dashboard, API, migration, docs, release, onboarding, settings, and verification',
      description: hugeSpec,
      spec: hugeSpec,
      acceptanceCriteria: [
        { id: 'AC-1', description: 'All affected flows work.', verifiedBy: 'automated', command: 'pnpm test', met: false },
      ],
    }))

    expect(assessment.recommendation).toBe('requires_child_work')
    expect(assessment.contextBudget.fitsInOneWorkerBrief).toBe(false)
    expect(assessment.dimensions.find(dimension => dimension.id === 'context_load')?.status).toBe('blocked')
  })

  it('does not treat inferred workspace-import proof as execution-ready evidence', () => {
    const assessment = assessTaskReadiness(task({
      title: 'Define fixture, expected-record, prototype-run, and evaluation schemas',
      description: 'Imported task for the first headless harness slice.',
      status: 'spec_review',
      requestIntake: {
        intent: 'implementation',
        recommendedNextAction: 'proceed_to_implementation_spec',
        assumptions: [],
        missingInformation: [],
        evidenceRefs: ['import:docs/harness/implementation-roadmap.md'],
        componentStack: [],
        pressureTestSummary: {
          systemOwned: true,
          degree: 'guided',
          qualityBar: 'Imported work should be reshaped before execution.',
          ownerQuestionPolicy: 'Ask only when the sources conflict.',
          checks: [],
        },
        clarifyingQuestions: [],
        createdAt: now,
        createdBy: 'workspace-importer',
      },
      acceptanceCriteria: [
        {
          id: 'contracts-defined',
          description: 'The cited contracts are defined for the first fixture loop.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'deterministic-proof',
          description: 'Add a deterministic local proof path for the fixture loop.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
      ],
      proofPaths: [
        {
          id: 'imported-proof-plan',
          scope: { type: 'task', id: 'task-1' },
          title: 'Planned proof path',
          summary: 'Add a bounded local proof path once the harness contracts exist.',
          status: 'planned',
          source: 'inferred',
          launchSteps: [],
          expectedEvidence: [
            { id: 'planned-proof', kind: 'manual', description: 'The bounded fixture loop has a real local proof path.', required: true },
          ],
          verificationRecords: [],
          createdAt: now,
          updatedAt: now,
          createdBy: 'workspace-importer',
        },
      ],
    }))

    expect(assessment.recommendation).toBe('needs_one_question')
    expect(assessment.dimensions.find(dimension => dimension.id === 'proofability')?.status).toBe('blocked')
  })

  it('treats an imported execution blueprint with verification and a completion boundary as proofable', () => {
    const assessment = assessTaskReadiness(task({
      title: 'Add the first tiny fiction fixture and human-authored expected records',
      description: 'Imported task for the first headless harness slice.',
      status: 'ready',
      requestIntake: {
        intent: 'implementation',
        recommendedNextAction: 'proceed_to_implementation_spec',
        assumptions: [],
        missingInformation: [],
        evidenceRefs: ['import:docs/harness/implementation-roadmap.md'],
        componentStack: [],
        pressureTestSummary: {
          systemOwned: true,
          degree: 'guided',
          qualityBar: 'Imported work should carry evidence into an execution blueprint.',
          ownerQuestionPolicy: 'Ask only when the cited evidence conflicts.',
          checks: [],
        },
        clarifyingQuestions: [],
        createdAt: now,
        createdBy: 'workspace-importer',
      },
      spec: [
        '## What this is',
        'Add the first tiny fiction fixture and human-authored expected records.',
        '',
        '## Verification',
        '- Review recorded evidence: The fixture covers manuscript text, brief/profile context, notes, expected records, and author decisions.',
        '',
        '## Completion Boundary',
        '- Product outcome: The fixture can represent manuscript text, book brief, author profile, project notes, expected records, and author decisions.',
        '- What Guildhall can complete in code: Implement the bounded local fixture work.',
        '- External dependencies: None beyond repo-local evidence and local tooling.',
        '- Owner-only setup: None expected.',
        '- Verification environment: Local filesystem and repo-local tooling already available in the execution environment.',
        '- What counts as done: Expected records are human-authored, stable, and reusable across repeated fixture runs.',
        '- What must be split or blocked: Split only if the cited work turns out to contain more than one independently verifiable deliverable.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'fixture-shape',
          description: 'The fixture can represent manuscript text, book brief, author profile, project notes, expected records, and author decisions.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
        {
          id: 'deterministic-proof',
          description: 'Add bounded local workspace proof for the fixture.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
      ],
      proofPaths: [
        {
          id: 'imported-proof-plan',
          scope: { type: 'task', id: 'task-1' },
          title: 'Planned proof path',
          summary: 'Review the fixture evidence and local proof output.',
          kind: 'review',
          status: 'planned',
          source: 'inferred',
          launchSteps: [],
          expectedEvidence: [
            { id: 'fixture-evidence', kind: 'manual', description: 'Fixture covers manuscript text and expected records.', required: true },
          ],
          verificationRecords: [],
          createdAt: now,
          updatedAt: now,
          createdBy: 'workspace-importer',
        },
      ],
    }))

    expect(assessment.recommendation).toBe('ready')
    expect(assessment.dimensions.find(dimension => dimension.id === 'proofability')?.status).toBe('ok')
  })

  it('keeps an exact single-file release-notes patch ready instead of splitting it', () => {
    const assessment = assessTaskReadiness(task({
      title: 'release-note-patch',
      description: 'Append the exact bullet to RELEASE_NOTES.md and do not edit any other file.',
      status: 'ready',
      spec: [
        '## Summary',
        'Append a single release-note bullet.',
        '',
        '## Acceptance Criteria',
        '1. RELEASE_NOTES.md ends with the exact requested bullet.',
        '2. No other files change.',
        '',
        '## Completion Boundary',
        '- **Product outcome:** `RELEASE_NOTES.md` contains the requested bullet at the end of the file.',
        '- **What Guildhall can complete in code:** Append the exact line to `RELEASE_NOTES.md` and leave every other file untouched.',
        '- **External dependencies:** None. This is a local-only file patch.',
        '- **Owner-only setup:** None.',
        '- **Verification environment:** Local filesystem on the current machine.',
        '- **What counts as done:** `grep -q \"benchmark artifact evidence\" RELEASE_NOTES.md` exits 0 and `git diff --stat` shows only `RELEASE_NOTES.md`.',
        '- **What must be split or blocked:** Nothing.',
      ].join('\n'),
      acceptanceCriteria: [
        { id: 'AC-1', description: 'RELEASE_NOTES.md ends with the exact requested bullet.', verifiedBy: 'automated', command: 'grep -q "benchmark artifact evidence" RELEASE_NOTES.md', met: false },
        { id: 'AC-2', description: 'No other files change.', verifiedBy: 'automated', command: 'git diff --stat', met: false },
      ],
      sizePlan: {
        taskId: 'task-1',
        score: 1,
        band: 'tiny',
        action: 'proceed',
        factors: [],
        recommendedChildren: [],
        reviewBudgetHint: 'lean',
        reasons: ['Task size score: 1.'],
        createdAt: now,
        createdBy: 'test',
      },
    }))

    expect(assessment.recommendation).toBe('ready')
    expect(assessment.dimensions.find(dimension => dimension.id === 'size')?.status).toBe('ok')
    expect(assessment.dimensions.find(dimension => dimension.id === 'context_load')?.status).toBe('ok')
  })
})

describe('finishability helpers', () => {
  it('builds kind-specific definition of done, blocker plans, and context budget', () => {
    const researchTask = task({
      workKind: 'research',
      title: 'Research payment provider tradeoffs',
      description: 'Compare Stripe and Paddle for a small SaaS.',
    })

    expect(definitionOfDoneForTask(researchTask).items).toContain('Research output names the recommended option, alternatives considered, evidence, and unresolved questions.')
    expect(ifThenBlockerPlansForTask(researchTask).map(plan => plan.then)).toContain('Produce a decision-ready comparison instead of continuing into implementation.')
    expect(contextBudgetEstimate(researchTask).risk).toBe('low')
  })
})

describe('dispatch readiness guard', () => {
  it('walks from a requested blocked task to the first runnable blocker', () => {
    const component = task({
      id: 'component',
      title: 'Component implementation',
      status: 'ready',
      priority: 'low',
    })
    const story = task({
      id: 'story',
      title: 'Storybook story',
      status: 'ready',
      priority: 'critical',
      dependsOn: ['component'],
    })

    expect(pickNextTask({ version: 1, lastUpdated: now, tasks: [story, component] }, undefined, undefined, undefined, 'story')?.id).toBe('component')
  })

  it('repeats blocker traversal until it reaches runnable prerequisite work', () => {
    const primitive = task({
      id: 'primitive',
      title: 'Menu primitive',
      status: 'ready',
      priority: 'low',
    })
    const component = task({
      id: 'component',
      title: 'Component implementation',
      status: 'ready',
      priority: 'normal',
      dependsOn: ['primitive'],
    })
    const story = task({
      id: 'story',
      title: 'Storybook story',
      status: 'ready',
      priority: 'critical',
      dependsOn: ['component'],
    })

    expect(pickNextTask({ version: 1, lastUpdated: now, tasks: [story, component, primitive] }, undefined, undefined, undefined, 'story')?.id).toBe('primitive')
  })

  it('does not dispatch ready tasks whose readiness recommendation is not ready', () => {
    const unready = task({
      id: 'unready',
      status: 'ready',
      taskReadiness: {
        taskKind: 'implementation',
        recommendation: 'needs_one_question',
        summary: 'Needs one owner answer.',
        dimensions: [],
        definitionOfDone: { items: [], evidenceRequired: [], createdBy: 'test' },
        blockerPlans: [],
        contextBudget: { estimatedTokens: 20, risk: 'low', fitsInOneWorkerBrief: true, reasons: [] },
        assessedAt: now,
        assessedBy: 'test',
      },
    })
    const ready = task({
      id: 'ready',
      status: 'ready',
      priority: 'low',
      taskReadiness: {
        taskKind: 'implementation',
        recommendation: 'ready',
        summary: 'Ready.',
        dimensions: [],
        definitionOfDone: { items: ['Done'], evidenceRequired: [], createdBy: 'test' },
        blockerPlans: [],
        contextBudget: { estimatedTokens: 20, risk: 'low', fitsInOneWorkerBrief: true, reasons: [] },
        assessedAt: now,
        assessedBy: 'test',
      },
    })

    expect(pickNextTask({ version: 1, lastUpdated: now, tasks: [unready, ready] })?.id).toBe('ready')
  })

  it('dispatches a ready imported execution blueprint even when stored readiness is stale', () => {
    const staleButShaped = task({
      id: 'stale-shaped-import',
      status: 'ready',
      taskReadiness: {
        taskKind: 'implementation',
        recommendation: 'needs_one_question',
        summary: 'Stale readiness stamp from before import proofability was recognized.',
        dimensions: [],
        definitionOfDone: { items: [], evidenceRequired: [], createdBy: 'test' },
        blockerPlans: [],
        contextBudget: { estimatedTokens: 20, risk: 'low', fitsInOneWorkerBrief: true, reasons: [] },
        assessedAt: now,
        assessedBy: 'test',
      },
      requestIntake: {
        intent: 'implementation',
        recommendedNextAction: 'proceed_to_implementation_spec',
        assumptions: [],
        missingInformation: [],
        evidenceRefs: ['import:docs/harness/implementation-roadmap.md'],
        componentStack: [],
        pressureTestSummary: {
          systemOwned: true,
          degree: 'guided',
          qualityBar: 'Imported work should carry evidence into an execution blueprint.',
          ownerQuestionPolicy: 'Ask only when the cited evidence conflicts.',
          checks: [],
        },
        clarifyingQuestions: [],
        createdAt: now,
        createdBy: 'workspace-importer',
      },
      spec: [
        '## Verification',
        '- Review recorded evidence.',
        '',
        '## Completion Boundary',
        '- Owner-only setup: None expected.',
        '- What counts as done: Proof is recorded against the imported acceptance criteria.',
      ].join('\n'),
      acceptanceCriteria: [
        {
          id: 'deterministic-proof',
          description: 'Add bounded local workspace proof for the fixture.',
          verifiedBy: 'review',
          source: 'inferred',
          met: false,
        },
      ],
      proofPaths: [
        {
          id: 'imported-proof-plan',
          scope: { type: 'task', id: 'stale-shaped-import' },
          title: 'Planned proof path',
          summary: 'Review local proof output.',
          kind: 'review',
          status: 'planned',
          source: 'inferred',
          launchSteps: [],
          expectedEvidence: [
            { id: 'fixture-evidence', kind: 'manual', description: 'Fixture proof is recorded.', required: true },
          ],
          verificationRecords: [],
          createdAt: now,
          updatedAt: now,
          createdBy: 'workspace-importer',
        },
      ],
    })

    expect(pickNextTask({ version: 1, lastUpdated: now, tasks: [staleButShaped] })?.id).toBe('stale-shaped-import')
  })
})
