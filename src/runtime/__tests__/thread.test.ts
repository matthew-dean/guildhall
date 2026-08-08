import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { projectStatePath, promoteProjectStateDatabaseAuthority } from '@guildhall/sessions'

import { buildThread as buildCurrentThread, type BuildThreadOptions, type Thread } from '../thread.js'
import { writeProjectSummaryProjection } from '../project-summary-projection.js'
import { emptyWizardsState, type ProjectSnapshot } from '../wizards.js'

function statePath(projectPath: string, ...parts: string[]): string {
  return projectStatePath(projectPath, path.join(...parts))
}

function buildThread(options: BuildThreadOptions): Thread {
  const tasksPath = statePath(options.projectPath, 'TASKS.json')
  if (!options.tasks && existsSync(tasksPath)) {
    writeProjectSummaryProjection(
      tasksPath,
      {
        queue: JSON.parse(readFileSync(tasksPath, 'utf8')),
        projectId: options.snapshot?.config?.id,
        projectRoot: options.projectPath,
      },
    )
    promoteProjectStateDatabaseAuthority(options.projectPath)
  }
  return buildCurrentThread(options)
}

function taskRecord(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task {
  const now = '2026-08-08T18:00:00.000Z'
  return {
    description: overrides.title,
    domain: 'product',
    projectPath: '/tmp/narrative-harness',
    priority: 'normal',
    dependsOn: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    revisionCount: 0,
    remediationAttempts: 0,
    escalations: [],
    agentIssues: [],
    origination: 'human',
    outOfScope: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('buildThread', () => {
  it('projects active pressure-test intake as request and question turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'pressure-test-intake'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'pressure-test-intake', 'pti-guildhall-0-8-0.json'),
        JSON.stringify({
          id: 'pti-guildhall-0-8-0',
          rawRequest: '0.8.0 should prioritize pressure-test intake.',
          target: { type: 'release', id: 'guildhall-0-8-0', title: 'Guildhall 0.8.0' },
          status: 'active',
          activeDomainId: 'product-goals',
          pendingQuestion: {
            id: 'product-goals-q-1',
            domainId: 'product-goals',
            prompt: 'What must Pressure-Test Intake get right first?',
            why: 'This decides the release slice.',
            evidence: [],
            askedAt: '2026-05-23T00:00:00.000Z',
          },
          domains: [{
            id: 'product-goals',
            title: 'Product goals',
            whyItMatters: 'This decides the release slice.',
            status: 'active',
            knownFacts: [],
            openUnknowns: [],
            askedQuestions: [],
            followUpCandidates: [],
            closeoutAsked: false,
          }],
          outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
          createdAt: '2026-05-23T00:00:00.000Z',
          updatedAt: '2026-05-23T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      expect(thread.turns.find(t => t.id === 'request:pti-guildhall-0-8-0')).toMatchObject({
        kind: 'request',
        status: 'done',
      })
      expect(thread.turns.find(t => t.id === 'pressure-test:pti-guildhall-0-8-0:product-goals-q-1')).toMatchObject({
        kind: 'pressure_test_question',
        status: 'active',
      })
      expect(thread.activeTurnId).toBe('pressure-test:pti-guildhall-0-8-0:product-goals-q-1')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects active bounded chat as bounded_chat, not pressure_test_question', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        boundedChatSessions: [{
          id: 'bc-demo-new-request',
          projectId: 'demo',
          source: 'owner-input:task:task-1:q1',
          objective: {
            kind: 'new_request',
            label: 'Clarify task request',
            successCriteria: ['Owner answers the linked bounded chat.'],
            startedAt: '2026-06-01T12:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'q1',
          subObjectives: [{
            id: 'q1',
            objective: 'Clarify task request',
            prompt: 'Which behavior should Guildhall implement?',
            choices: ['A', 'B'],
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          transitionReceipts: [],
          createdAt: '2026-06-01T12:00:00.000Z',
          updatedAt: '2026-06-01T12:00:00.000Z',
        }],
        pressureTestIntakes: [],
      })

      expect(thread.turns).toContainEqual(expect.objectContaining({
        kind: 'bounded_chat',
        sessionId: 'bc-demo-new-request',
        status: 'active',
      }))
      expect(thread.turns).not.toContainEqual(expect.objectContaining({
        id: 'bounded-chat:bc-demo-new-request:q1',
        kind: 'pressure_test_question',
      }))
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects planned project check-in questions as project direction turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'pressure-test-intake'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'pressure-test-intake', 'pti-narrative-harness-project-check-in.json'),
        JSON.stringify({
          id: 'pti-narrative-harness-project-check-in',
          rawRequest: 'Start a project check-in for Narrative Harness.',
          target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
          status: 'active',
          activeDomainId: 'project-planner',
          pendingQuestion: {
            id: 'project-direction-priority',
            domainId: 'project-planner',
            prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
            why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
            choices: [
              'Reviewer-lane MVPs',
              'Author-facing editor UX',
              'Story-memory/schema foundations',
              'Generation/evaluation loops',
            ],
            evidence: ['README.md: fiction-writing software'],
            askedAt: '2026-05-31T00:00:00.000Z',
          },
          domains: [],
          outputs: {
            assumptions: [],
            decisions: [],
            languageMapCandidates: [],
            taskSplitCandidates: [],
            projectQuestionPlanner: {
              inferredFacts: [],
              decisions: [],
              discardedAnswers: [],
              askedCandidateIds: ['project-direction-priority'],
            },
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const question = thread.turns.find(turn => turn.kind === 'pressure_test_question')

      expect(question).toMatchObject({
        kind: 'pressure_test_question',
        domainTitle: 'Project direction',
        question: {
          choices: [
            'Reviewer-lane MVPs',
            'Author-facing editor UX',
            'Story-memory/schema foundations',
            'Generation/evaluation loops',
          ],
        },
      })
      expect(JSON.stringify(thread.turns)).not.toContain('anything else Guildhall should know')
      expect(JSON.stringify(thread.turns)).not.toContain('workflow or day-to-day constraint')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects a project check-in card when the project has not answered Guildhall project questions yet', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [{
            id: 'task-done',
            title: 'Completed setup task',
            description: 'Done.',
            domain: 'frontend',
            projectPath,
            status: 'done',
            createdAt: '2026-05-23T00:00:00.000Z',
            updatedAt: '2026-05-23T00:00:00.000Z',
          }],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const turn = thread.turns.find(t => t.id === 'setup:project-check-in')

      expect(turn).toMatchObject({
        kind: 'setup_step',
        status: 'active',
        title: 'Run project check-in',
        actionLabel: 'Start project check-in',
        submitEndpoint: '/api/project/project-check-in',
      })
      expect(thread.activeTurnId).toBe('setup:project-check-in')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects an active bounded-chat project check-in instead of the old setup card', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-narrative-project-check-in.json'),
        JSON.stringify({
          id: 'bc-narrative-project-check-in',
          projectId: 'narrative-harness',
          source: 'thread:project-check-in',
          objective: {
            kind: 'project_check_in',
            label: 'Project check-in',
            successCriteria: ['Capture the near-term project direction.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'project-direction-priority',
          subObjectives: [{
            id: 'project-direction-priority',
            objective: 'Capture project direction',
            prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
            helperText: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
            choices: [
              'Reviewer-lane MVPs',
              'Author-facing editor UX',
              'Story-memory/schema foundations',
              'Generation/evaluation loops',
            ],
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [
              {
                fact: 'Narrative Harness is fiction-writing software for building and revising a coherent novel.',
                sourceSubObjectiveId: 'project-direction-priority',
              },
            ],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const question = thread.turns.find(turn => turn.id === 'bounded-chat:bc-narrative-project-check-in:project-direction-priority')

      expect(question).toMatchObject({
        kind: 'bounded_chat',
        sessionId: 'bc-narrative-project-check-in',
        subObjectiveId: 'project-direction-priority',
        targetTitle: 'Narrative Harness',
        domainTitle: 'Project check-in',
        answerEndpoint: '/api/project/bounded-chat/bc-narrative-project-check-in/answer',
        question: {
          choices: [
            'Reviewer-lane MVPs',
            'Author-facing editor UX',
            'Story-memory/schema foundations',
            'Generation/evaluation loops',
          ],
          evidence: ['Narrative Harness is fiction-writing software for building and revising a coherent novel.'],
        },
      })
      expect(thread.turns.find(t => t.id === 'setup:project-check-in')).toBeUndefined()
      expect(thread.activeTurnId).toBe('bounded-chat:bc-narrative-project-check-in:project-direction-priority')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects an active bounded-chat New Request clarification as the live intake turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-request-clarify.json'),
        JSON.stringify({
          id: 'bc-request-clarify',
          projectId: 'narrative-harness',
          source: 'thread:new-request',
          objective: {
            kind: 'new_request',
            label: 'Shape a new request',
            successCriteria: ['Classify the request and shape the next action.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'request-scope',
          subObjectives: [{
            id: 'request-scope',
            objective: 'Clarify request scope',
            prompt: 'Should Guildhall draft the FLL overhead policy first, or also turn it into linked implementation work?',
            helperText: 'This changes whether Guildhall should shape one policy task or a broader execution plan.',
            choices: [
              'Draft the policy/spec first',
              'Draft the policy and create linked implementation tasks',
              'Apply the policy now',
            ],
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          plannerState: {
            newRequest: {
              ask: 'Set the FLL overhead charge policy and decide whether we should also apply it across the product.',
              title: 'Set the FLL overhead charge policy and decide whether we...',
              domain: 'frontend',
              projectPath,
              routedRequestKind: 'task_spec',
              routingSummary: 'Routed to Task Intake',
            },
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const question = thread.turns.find(turn => turn.id === 'bounded-chat:bc-request-clarify:request-scope')

      expect(question).toMatchObject({
        kind: 'bounded_chat',
        sessionId: 'bc-request-clarify',
        subObjectiveId: 'request-scope',
        targetTitle: 'Narrative Harness',
        domainTitle: 'New request',
        answerEndpoint: '/api/project/bounded-chat/bc-request-clarify/answer',
        question: {
          prompt: 'Should Guildhall draft the FLL overhead policy first, or also turn it into linked implementation work?',
          choices: [
            'Draft the policy/spec first',
            'Draft the policy and create linked implementation tasks',
            'Apply the policy now',
          ],
        },
      })
      expect(thread.activeTurnId).toBe('bounded-chat:bc-request-clarify:request-scope')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects a pure project-question bounded chat as a conversation thread, not task intake', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-project-question.json'),
        JSON.stringify({
          id: 'bc-project-question',
          projectId: 'fair-labor-license',
          source: 'thread:new-request',
          objective: {
            kind: 'new_request',
            label: 'Answer a project question',
            successCriteria: ['Answer the project question in Thread without creating task work.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'project-question-context',
          subObjectives: [{
            id: 'project-question-context',
            objective: 'Gather project-question context',
            prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
            helperText: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
            choices: ['Use current blocker evidence', 'Use project docs', 'No extra context'],
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          plannerState: {
            newRequest: {
              ask: 'Why is this project still blocked on useAuth.ts?',
              domain: 'frontend',
              projectPath,
              routedRequestKind: 'project_question',
              routingSummary: 'Guildhall saved this as a project question.',
            },
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'fair-labor-license',
          name: 'Fair Labor License',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const turn = thread.turns.find(item => item.id === 'bounded-chat:bc-project-question:project-question-context')

      expect(turn).toMatchObject({
        kind: 'bounded_chat',
        domainTitle: 'Project question',
        question: {
          prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
          why: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
        },
      })
      expect(JSON.stringify(thread.turns)).not.toContain('Task Intake')
      expect(thread.activeTurnId).toBe('bounded-chat:bc-project-question:project-question-context')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it.each([
    ['task_shaping', 'Task shaping'],
    ['structural_review', 'Structural review'],
    ['setting_update', 'Settings update'],
    ['recovery_decision', 'Recovery decision'],
    ['capability_decision', 'Capability decision'],
  ] as const)('projects waiting bounded-chat owner input for %s through Thread', async (kind, label) => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        boundedChatSessions: [{
          id: `bc-${kind}`,
          projectId: 'narrative-harness',
          source: `owner-input:${kind}`,
          objective: {
            kind,
            label,
            successCriteria: ['Owner answers the linked Thread session.'],
            startedAt: '2026-06-01T00:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'owner-choice',
          subObjectives: [{
            id: 'owner-choice',
            rootQuestionId: 'owner-choice',
            objective: label,
            prompt: `How should Guildhall handle ${label}?`,
            helperText: 'This answer unblocks the owner-input session.',
            choices: ['Continue', 'Pause'],
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [{ fact: `${label} has source context.`, sourceSubObjectiveId: 'owner-choice' }],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          transitionReceipts: [],
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:05:00.000Z',
        }],
        pressureTestIntakes: [],
        projectCheckInSummary: {
          needed: false,
          label: 'Project questions',
          title: 'Project questions answered',
          detail: 'Guildhall has already recorded project-level answers for this workspace.',
          actionHref: '/thread',
          totalCount: 1,
          activeCount: 0,
          completedCount: 1,
        },
      })

      const turn = thread.turns.find(item => item.id === `bounded-chat:bc-${kind}:owner-choice`)
      expect(turn).toMatchObject({
        kind: 'bounded_chat',
        sessionId: `bc-${kind}`,
        domainTitle: label,
        actionHref: `/thread?thread=bc-${kind}`,
        question: {
          prompt: `How should Guildhall handle ${label}?`,
          evidence: [`${label} has source context.`],
        },
      })
      expect(thread.activeTurnId).toBe(`bounded-chat:bc-${kind}:owner-choice`)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('prefers preloaded thread state over re-reading current disk projections', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-disk-only.json'),
        JSON.stringify({
          id: 'bc-disk-only',
          projectId: 'narrative-harness',
          source: 'thread:new-request',
          objective: {
            kind: 'new_request',
            label: 'Shape a new request',
            successCriteria: ['Classify the request and shape the next action.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'waiting_for_owner',
          activeSubObjectiveId: 'request-scope',
          subObjectives: [{
            id: 'request-scope',
            objective: 'Clarify request scope',
            prompt: 'Disk question that should be ignored when preloaded state is supplied.',
            followUpDepth: 0,
            localTurns: [],
            status: 'active',
          }],
          acceptedState: {
            facts: [],
            decisions: [],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: [],
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        tasks: [{
          id: 'task-001',
          title: 'Shape thread performance',
          description: 'Use injected state instead of re-reading disk turns.',
          domain: 'product',
          projectPath,
          status: 'exploring',
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:00:00.000Z',
        }] as never,
        boundedChatSessions: [],
        pressureTestIntakes: [],
        projectCheckInSummary: {
          needed: false,
          label: 'Project questions',
          title: 'Project questions answered',
          detail: 'Guildhall has already recorded project-level answers for this workspace.',
          actionHref: '/thread',
          totalCount: 1,
          activeCount: 0,
          completedCount: 1,
        },
      })

      expect(thread.turns.find(turn => turn.id === 'bounded-chat:bc-disk-only:request-scope')).toBeUndefined()
      expect(thread.turns.some(turn => 'taskId' in turn && turn.taskId === 'task-001')).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects a completed bounded-chat project check-in as a done turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-narrative-project-check-in.json'),
        JSON.stringify({
          id: 'bc-narrative-project-check-in',
          projectId: 'narrative-harness',
          source: 'thread:project-check-in',
          objective: {
            kind: 'project_check_in',
            label: 'Project check-in',
            successCriteria: ['Capture the near-term project direction.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'fulfilled',
          activeSubObjectiveId: 'visual-direction-mode',
          subObjectives: [{
            id: 'project-direction-priority',
            objective: 'Capture project direction',
            prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
            helperText: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
            choices: [
              'Reviewer-lane MVPs',
              'Author-facing editor UX',
              'Story-memory/schema foundations',
              'Generation/evaluation loops',
            ],
            followUpDepth: 0,
            localTurns: [{
              role: 'user',
              content: 'Reviewer-lane MVPs first.',
              selectedChoiceIds: [],
            }],
            status: 'answered',
          }, {
            id: 'visual-direction-mode',
            objective: 'Capture project direction',
            prompt: 'Should Narrative Harness feel more like a calm writing desk, a professional editorial tool, or an analytical story-debugging cockpit?',
            helperText: 'This changes UI acceptance criteria and reviewer expectations for author-facing work.',
            choices: [
              'Calm writing desk',
              'Professional editorial tool',
              'Analytical story-debugging cockpit',
            ],
            followUpDepth: 0,
            localTurns: [{
              role: 'user',
              content: 'Professional editorial tool.',
              selectedChoiceIds: [],
            }],
            status: 'answered',
          }],
          acceptedState: {
            facts: [],
            decisions: [{
              decision: 'Reviewer-lane MVPs first.',
              sourceSubObjectiveId: 'project-direction-priority',
            }, {
              decision: 'Professional editorial tool.',
              sourceSubObjectiveId: 'visual-direction-mode',
            }],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: ['close-1'],
          closure: {
            outcome: 'fulfilled',
            summary: 'Guildhall recorded the project check-in direction.',
            settingUpdates: [],
            taskDrafts: [],
            evidence: [],
            closedAt: '2026-05-31T00:10:00.000Z',
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:10:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const turn = thread.turns.find(item => item.id === 'bounded-chat-done:bc-narrative-project-check-in')

      expect(turn).toMatchObject({
        kind: 'request',
        status: 'done',
        phase: 'done',
        title: 'Project check-in complete',
        routingSummary: 'Guildhall recorded the project check-in direction.',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects a completed bounded-chat New Request as a done turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-request-done.json'),
        JSON.stringify({
          id: 'bc-request-done',
          projectId: 'narrative-harness',
          source: 'thread:new-request',
          objective: {
            kind: 'new_request',
            label: 'Shape a new request',
            successCriteria: ['Classify the request and shape the next action.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'fulfilled',
          activeSubObjectiveId: 'request-scope',
          subObjectives: [{
            id: 'request-scope',
            objective: 'Clarify request scope',
            prompt: 'Should Guildhall draft the FLL overhead policy first, or also turn it into linked implementation work?',
            helperText: 'This changes whether Guildhall should shape one policy task or a broader execution plan.',
            choices: [
              'Draft the policy/spec first',
              'Draft the policy and create linked implementation tasks',
              'Apply the policy now',
            ],
            followUpDepth: 0,
            localTurns: [{
              role: 'user',
              content: 'Draft the policy/spec first.',
              selectedChoiceIds: [],
            }],
            status: 'answered',
          }],
          acceptedState: {
            facts: [],
            decisions: [{
              decision: 'Draft the policy/spec first.',
              sourceSubObjectiveId: 'request-scope',
            }],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: ['task-001'],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: ['close-1'],
          closure: {
            outcome: 'fulfilled',
            summary: 'Guildhall shaped the new request into runnable work.',
            settingUpdates: [],
            taskDrafts: ['task-001'],
            evidence: [],
            closedAt: '2026-05-31T00:10:00.000Z',
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:10:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'harness', name: 'Harness' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const turn = thread.turns.find(item => item.id === 'bounded-chat-done:bc-request-done')

      expect(turn).toMatchObject({
        kind: 'request',
        status: 'done',
        phase: 'done',
        title: 'New request complete',
        routingSummary: 'Guildhall shaped the new request into runnable work.',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects a completed bounded-chat project question as a done conversation receipt', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath, 'bounded-chat'), { recursive: true })
      await writeFile(
        statePath(projectPath, 'bounded-chat', 'bc-project-question-done.json'),
        JSON.stringify({
          id: 'bc-project-question-done',
          projectId: 'fair-labor-license',
          source: 'thread:new-request',
          objective: {
            kind: 'new_request',
            label: 'Answer a project question',
            successCriteria: ['Answer the project question in Thread without creating task work.'],
            startedAt: '2026-05-31T00:00:00.000Z',
          },
          status: 'fulfilled',
          activeSubObjectiveId: 'project-question-context',
          subObjectives: [{
            id: 'project-question-context',
            objective: 'Gather project-question context',
            prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
            helperText: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
            followUpDepth: 0,
            localTurns: [{
              role: 'user',
              content: 'Use current blocker evidence.',
              selectedChoiceIds: [],
            }],
            status: 'answered',
          }],
          acceptedState: {
            facts: [],
            decisions: [{
              decision: 'Use current blocker evidence.',
              sourceSubObjectiveId: 'project-question-context',
            }],
            leverUpdates: [],
            settingUpdates: [],
            taskDrafts: [],
            unresolvedForks: [],
            discardedResponses: [],
          },
          pendingActions: [],
          appliedActionIds: ['close-1'],
          plannerState: {
            newRequest: {
              ask: 'Why is this project still blocked on useAuth.ts?',
              domain: 'frontend',
              projectPath,
              routedRequestKind: 'project_question',
              routingSummary: 'Guildhall saved this as a project question.',
            },
          },
          closure: {
            outcome: 'fulfilled',
            summary: 'Guildhall kept this as a project question thread.',
            settingUpdates: [],
            taskDrafts: [],
            evidence: [],
            closedAt: '2026-05-31T00:10:00.000Z',
          },
          createdAt: '2026-05-31T00:00:00.000Z',
          updatedAt: '2026-05-31T00:10:00.000Z',
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'fair-labor-license',
          name: 'Fair Labor License',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const turn = thread.turns.find(item => item.id === 'bounded-chat-done:bc-project-question-done')

      expect(turn).toMatchObject({
        kind: 'request',
        status: 'done',
        title: 'Project question complete',
        routingSummary: 'Guildhall kept this as a project question thread.',
      })
      expect(turn).not.toMatchObject({
        title: 'New request complete',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('records routed task requests as history once the task state owns current work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'What commands should I run before release?',
              description: 'What commands should I run before release?',
              domain: 'frontend',
              projectPath,
              status: 'exploring',
              request: {
                id: 'request-question',
                raw: 'What commands should I run before release?',
                kind: 'project_question',
                title: 'What commands should I run before release?',
                routingSummary: 'Guildhall saved this as a project question.',
                createdAt: '2026-05-23T00:00:00.000Z',
              },
              createdAt: '2026-05-23T00:00:00.000Z',
              updatedAt: '2026-05-23T00:00:00.000Z',
            },
          ],
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })
      expect(thread.turns.find(t => t.id === 'request:request-question')).toMatchObject({
        kind: 'request',
        status: 'done',
        phase: 'done',
        requestStage: 'new_request',
        routingSummary: 'Guildhall saved this as a project question.',
      })
      expect(thread.turns.find(t => t.id === 'inflight:task-1')).toMatchObject({
        kind: 'inflight',
        requestKind: 'project_question',
        checklist: undefined,
        summary: expect.stringContaining('answered from project context'),
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects brief cleanup requests as task-thread cleanup work instead of task-intake routing', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-fll-overhead-policy',
              title: 'Set FLL overhead charge policy',
              description: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
              domain: 'policy',
              projectPath,
              status: 'exploring',
              request: {
                id: 'request-fll-overhead-policy',
                raw: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
                kind: 'task_spec',
                title: 'Set FLL overhead charge policy',
                routingSummary: 'Routed to Task Intake',
                createdAt: '2026-06-02T23:40:00.000Z',
              },
              productBrief: {
                userJob: 'Verify whether the FLL overhead charge policy is already done.',
                whyItMattersNow: 'The remaining work should be narrowed before worker execution.',
                successMetric: 'The remaining work is described clearly enough to approve.',
                authoredBy: 'spec-agent',
              },
              notes: [
                {
                  role: 'reviewer',
                  agentId: 'reviewer-agent',
                  content: 'Let me start by reading the current task state and the changed files to evaluate the work.',
                  timestamp: '2026-05-25T22:03:07.794Z',
                },
                {
                  role: 'human',
                  content: 'Asked Guildhall to enrich this task (checklist).',
                  timestamp: '2026-06-02T23:41:00.000Z',
                },
                {
                  role: 'system',
                  content: 'Enrichment requested from ready. Guildhall will add the missing structure before continuing.',
                  timestamp: '2026-06-02T23:41:00.000Z',
                },
              ],
              createdAt: '2026-06-02T23:40:00.000Z',
              updatedAt: '2026-06-02T23:41:00.000Z',
            },
          ],
        }),
      )

      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'fair-labor-license',
          name: 'Fair Labor License',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'policy', name: 'Policy' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })
      expect(thread.turns.find(t => t.id === 'request:request-fll-overhead-policy')).toMatchObject({
        kind: 'request',
        status: 'done',
        phase: 'done',
        requestStage: 'task_brief_cleanup',
        routingSummary: 'Guildhall saved this cleanup request and queued the task brief in Thread.',
      })
      expect(thread.turns.find(t => t.id === 'request:task-fll-overhead-policy:brief-cleanup')).toMatchObject({
        kind: 'history_note',
        label: 'Brief cleanup requested',
        summary: 'Guildhall was asked to clean up this task brief before worker execution.',
      })
      expect(thread.turns.find(t => t.kind === 'review_feedback')).toMatchObject({
        kind: 'review_feedback',
        phase: 'done',
      })
      expect(thread.turns.find(t => t.id === 'inflight:task-fll-overhead-policy')).toMatchObject({
        kind: 'inflight',
        status: 'active',
        taskStatus: 'exploring',
        requestStage: 'task_brief_cleanup',
        routingSummary: 'Guildhall saved this cleanup request and queued the task brief in Thread.',
        summary: 'Task brief cleanup is queued before worker handoff.',
      })
      expect(thread.activeTurnId).toBe('inflight:task-fll-overhead-policy')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('surfaces active task work once setup is already complete', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Import workspace',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              message: 'Refining the import draft.',
            },
          },
        ],
      })

      expect(thread.activeTurnId).toBe('inflight:task-1')
      expect(thread.turns.some(t => t.kind === 'setup_step' && t.status === 'active')).toBe(false)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects construction mode onto task turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-blueprint',
              title: 'Shape the task',
              status: 'exploring',
              createdAt: now,
              updatedAt: now,
            },
            {
              id: 'task-build',
              title: 'Build the task',
              status: 'in_progress',
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      const blueprint = thread.turns.find(turn => turn.id === 'inflight:task-blueprint')
      const build = thread.turns.find(turn => turn.id === 'inflight:task-build')
      expect((blueprint as { constructionMode?: string } | undefined)?.constructionMode).toBe('blueprint')
      expect((build as { constructionMode?: string } | undefined)?.constructionMode).toBe('build')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('advances past bootstrap setup when runtime bootstrap truth is already green', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: {},
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:direction')
      const bootstrapStep = thread.turns.find(turn => turn.id === 'setup:bootstrap')
      if (!bootstrapStep || bootstrapStep.kind !== 'setup_step') throw new Error('expected bootstrap setup step')
      expect(bootstrapStep.status).toBe('done')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('lets the routing setup step seed meta-intake instead of linking to the project list', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const routingStep = thread.turns.find(turn => turn.id === 'setup:routing')
      if (!routingStep || routingStep.kind !== 'setup_step') throw new Error('expected routing setup step')
      expect(thread.activeTurnId).toBe('setup:routing')
      expect(routingStep.affordance).toBe('inline-button')
      expect(routingStep.actionLabel).toBe('Let Guildhall inspect the repo')
      expect(routingStep.submitEndpoint).toBe('/api/project/meta-intake')
      expect(routingStep.actionHref).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not emit generic project-list links for onboard setup steps', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const snapshots: ProjectSnapshot[] = [
        {
          projectPath,
          bootstrapVerified: false,
          hasProvider: false,
          hasDirection: false,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo' },
          bootstrapVerified: false,
          hasProvider: false,
          hasDirection: false,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo' },
          bootstrapVerified: false,
          hasProvider: true,
          hasDirection: false,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo', bootstrap: { verifiedAt: new Date().toISOString() }, coordinators: [] },
          bootstrapVerified: true,
          hasProvider: true,
          hasDirection: false,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo', bootstrap: { verifiedAt: new Date().toISOString() }, coordinators: [{ id: 'frontend', name: 'Frontend' }] },
          bootstrapVerified: true,
          hasProvider: true,
          hasDirection: false,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo', bootstrap: { verifiedAt: new Date().toISOString() }, coordinators: [{ id: 'frontend', name: 'Frontend' }] },
          bootstrapVerified: true,
          hasProvider: true,
          hasDirection: true,
          workspaceImportReviewed: false,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
        {
          projectPath,
          config: { id: 'demo', name: 'Demo', bootstrap: { verifiedAt: new Date().toISOString() }, coordinators: [{ id: 'frontend', name: 'Frontend' }] },
          bootstrapVerified: true,
          hasProvider: true,
          hasDirection: true,
          workspaceImportReviewed: true,
          taskCount: 0,
          wizardState: emptyWizardsState(),
        },
      ]

      for (const snapshot of snapshots) {
        const thread = buildThread({ projectPath, snapshot })
        const activeSetup = thread.turns.find(turn => turn.kind === 'setup_step' && turn.status === 'active')
        if (!activeSetup || activeSetup.kind !== 'setup_step') throw new Error('expected active setup step')
        expect(activeSetup.actionHref).not.toBe('/')
        expect(Boolean(activeSetup.submitEndpoint || activeSetup.actionHref)).toBe(true)
      }
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps project direction active ahead of a large imported-draft queue and collapses the queue to one turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-import-a',
              title: 'Version diff view (deferred)',
              status: 'import_draft',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
            {
              id: 'task-import-b',
              title: 'Shared component audit',
              status: 'import_draft',
              createdAt: new Date(Date.now() - 590_000).toISOString(),
              updatedAt: new Date(Date.now() - 290_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:direction')
      const draftTurns = thread.turns.filter(
        (turn) => turn.kind === 'inflight' && turn.importedDraft,
      )
      expect(draftTurns).toHaveLength(1)
      const draftTurn = draftTurns[0]
      if (!draftTurn || draftTurn.kind !== 'inflight') throw new Error('expected draft inflight turn')
      expect(draftTurn.taskId).toBe('task-import-a')
      expect(draftTurn.status).toBe('pending')
      expect(draftTurn.summary).toMatch(/1 more drafts are queued behind it/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('frames the empty-project first work item as spec shaping instead of implementation task creation', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({ tasks: [] }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'commerce-project',
          name: 'Commerce Project',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'project-implementation', name: 'Project Implementation' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })
      const activeSetup = thread.turns.find(turn => turn.kind === 'setup_step' && turn.status === 'active')
      if (!activeSetup || activeSetup.kind !== 'setup_step') throw new Error('expected active setup step')

      expect(activeSetup.stepId).toBe('firstTask')
      expect(activeSetup.title).toBe('Shape the first spec')
      expect(activeSetup.why).toMatch(/rough idea into a product brief/i)
      expect(activeSetup.actionLabel).toBe('Start shaping')
      expect(activeSetup.placeholder).toBe('Describe the product idea or first outcome')
      expect(Date.parse(activeSetup.at)).toBeGreaterThan(Date.parse('2026-01-01T00:00:00.000Z'))
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps fresh first-spec setup ahead of stale pressure-test questions', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({ tasks: [] }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'commerce-project',
          name: 'Commerce Project',
          bootstrap: { verifiedAt: '2026-06-03T06:00:00.000Z' },
          coordinators: [{ id: 'project-implementation', name: 'Project Implementation' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        pressureTestIntakes: [{
          id: 'pti-commerce-old-setup',
          rawRequest: 'Pressure-test Commerce Project project setup.',
          target: { type: 'project', id: 'commerce-project', title: 'Commerce Project project setup' },
          status: 'active',
          activeDomainId: 'product-goals',
          pendingQuestion: {
            id: 'old-success-question',
            domainId: 'product-goals',
            prompt: 'What outcome would make this old pressure test successful?',
            why: 'This stale question predates the first-spec setup path.',
            evidence: ['internal/old-audit.md'],
            askedAt: '2026-05-01T00:00:00.000Z',
          },
          domains: [{
            id: 'product-goals',
            title: 'Product goals',
            whyItMatters: 'This stale question predates the first-spec setup path.',
            status: 'active',
            knownFacts: [],
            openUnknowns: [],
            askedQuestions: [],
            followUpCandidates: [],
            closeoutAsked: false,
          }],
          outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
        }],
      })

      expect(thread.activeTurnId).toBe('setup:firstTask')
      expect(thread.turns.find(turn => turn.id === 'setup:firstTask')).toMatchObject({
        kind: 'setup_step',
        status: 'active',
        title: 'Shape the first spec',
      })
      expect(thread.turns.find(turn => turn.id === 'pressure-test:pti-commerce-old-setup:old-success-question')).toMatchObject({
        kind: 'pressure_test_question',
        status: 'pending',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps a workspace-import question active ahead of later queued work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const earlier = new Date(Date.now() - 600_000).toISOString()
      const later = new Date(Date.now() - 60_000).toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-workspace-import',
              title: 'Review existing project work',
              status: 'spec_review',
              domain: '_workspace_import',
              createdAt: earlier,
              updatedAt: earlier,
              openQuestions: [
                {
                  id: 'q-workspace-import',
                  askedBy: 'spec-agent',
                  askedAt: earlier,
                  kind: 'choice',
                  prompt: 'Should auth be treated as partially done or not done?',
                  selectionMode: 'single',
                  choices: ['Partially done', 'Not done'],
                },
              ],
            },
            {
              id: 'task-003',
              title: 'Draft a first starter task',
              status: 'ready',
              createdAt: earlier,
              updatedAt: later,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('q:task-workspace-import:q-workspace-import')
      const workspaceQuestion = thread.turns.find((turn) => turn.id === 'q:task-workspace-import:q-workspace-import')
      if (!workspaceQuestion || workspaceQuestion.kind !== 'agent_question') throw new Error('expected workspace import question')
      expect(workspaceQuestion.status).toBe('active')
      expect(thread.turns.some((turn) => turn.id === 'spec:task-workspace-import')).toBe(false)
      const queuedTask = thread.turns.find((turn) => turn.id === 'inflight:task-003')
      if (!queuedTask || queuedTask.kind !== 'inflight') throw new Error('expected queued task turn')
      expect(queuedTask.status).toBe('pending')
      expect(queuedTask.summary).toContain('brief or acceptance criteria still need cleanup')
      expect(queuedTask.checklist?.totalSteps).toBeGreaterThan(0)
      expect(queuedTask.workerHandoff).toMatchObject({
        ready: false,
        cleanupNeeded: true,
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('summarizes normal spec_review component tasks as owner approval', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-combobox',
              title: 'Combobox',
              status: 'spec_review',
              createdAt: '2026-06-04T00:00:00.000Z',
              updatedAt: '2026-06-04T00:01:00.000Z',
              spec: '## Summary\n\nBuild an accessible combobox.',
              acceptanceCriteria: [{ description: 'The combobox supports keyboard navigation.' }],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.turns.find(turn => turn.id === 'spec:task-combobox')).toMatchObject({
        kind: 'spec_review',
        phase: 'spec',
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps source-recovery tasks in shaping even when a draft spec exists', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-source-recovery',
              title: 'Recover source-backed contract surface',
              status: 'exploring',
              createdAt: '2026-06-04T00:00:00.000Z',
              updatedAt: '2026-06-04T00:01:00.000Z',
              spec: '## Summary\n\nRepair the imported handoff.',
              acceptanceCriteria: [{ description: 'Names the concrete source-backed surface.' }],
              taskReadiness: {
                recommendation: 'needs_research_spike',
                summary: 'Needs concrete contract names before worker handoff.',
              },
              notes: [
                {
                  agentId: 'workspace-importer',
                  role: 'importer',
                  content: 'Imported from docs/specs/source.md',
                  timestamp: '2026-06-04T00:00:00.000Z',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.turns.some(turn => turn.id === 'spec:task-source-recovery')).toBe(false)
      const turn = thread.turns.find(item => item.id === 'inflight:task-source-recovery')
      expect(turn).toMatchObject({
        kind: 'inflight',
        phase: 'intake',
        shapingBlockers: expect.arrayContaining([
          {
            code: 'source_recovery',
            summary: 'Needs concrete contract names before worker handoff.',
          },
        ]),
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not render operational receipts as answerable questions', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-db-bootstrap',
              title: 'Bootstrap database',
              status: 'exploring',
              createdAt: now,
              updatedAt: now,
              openQuestions: [
                {
                  id: 'q-receipt',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  kind: 'choice',
                  prompt: 'Done — I took the durable blueprint steps:',
                  selectionMode: 'single',
                  choices: [
                    'Updated the product brief',
                    'Revised and strengthened the spec',
                    'Set task status to `spec_review`',
                    'Appended this turn to the exploring transcript',
                    'Logged a milestone in `PROGRESS.md`',
                  ],
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'data', name: 'Data' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      expect(thread.turns.some(turn => turn.kind === 'agent_question')).toBe(false)
      expect(thread.turns.some(turn => turn.kind === 'inflight' && turn.id === 'inflight:task-db-bootstrap')).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not render output promises as answerable questions', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-blueprint',
              title: 'Draft the blueprint',
              status: 'exploring',
              createdAt: now,
              updatedAt: now,
              openQuestions: [
                {
                  id: 'q-promise',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  kind: 'choice',
                  prompt: 'Next, pick the output path:',
                  selectionMode: 'single',
                  choices: [
                    'I will draft the blueprint',
                    'I will update the product brief',
                    'I will persist progress with tools',
                  ],
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'product', name: 'Product' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      expect(thread.turns.some(turn => turn.kind === 'agent_question')).toBe(false)
      expect(thread.turns.some(turn => turn.kind === 'inflight' && turn.id === 'inflight:task-blueprint')).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('surfaces immediate all-terminal start-stop activity in Thread', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'done-1',
              title: 'Done one',
              status: 'done',
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'data', name: 'Data' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        runStatus: 'stopped',
        recentEvents: [
          {
            at: now,
            workspaceId: 'test',
            event: { type: 'supervisor_started', message: 'Orchestrator started for test' },
          },
          {
            at: now,
            workspaceId: 'test',
            event: {
              type: 'supervisor_stopped',
              reason: 'all_terminal',
              message: 'No actionable tasks remain: 1 done, 0 blocked, 0 shelved.',
            },
          },
        ],
      })

      expect(JSON.stringify(thread)).toContain('No actionable tasks remain')
      expect(thread.turns.some(turn => turn.id === 'run:recent-activity')).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('prefers an in-progress worker turn over a stale review turn when neither has a live agent', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const earlier = new Date(Date.now() - 600_000).toISOString()
      const later = new Date(Date.now() - 60_000).toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-review',
              title: 'Older review task',
              status: 'review',
              createdAt: earlier,
              updatedAt: later,
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'Please revise the button markup.',
                  timestamp: later,
                },
              ],
            },
            {
              id: 'task-live',
              title: 'Fresh worker task',
              status: 'in_progress',
              createdAt: earlier,
              updatedAt: earlier,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('inflight:task-live')
      const reviewTurn = thread.turns.find((turn) => turn.id === 'inflight:task-review')
      if (!reviewTurn || reviewTurn.kind !== 'inflight') throw new Error('expected review inflight turn')
      expect(reviewTurn.status).toBe('pending')
      const workerTurn = thread.turns.find((turn) => turn.id === 'inflight:task-live')
      if (!workerTurn || workerTurn.kind !== 'inflight') throw new Error('expected worker inflight turn')
      expect(workerTurn.status).toBe('active')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('drafts project direction as editable brief copy instead of inference narration', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for open-source maintainers.',
        ].join('\n'),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe('Modern licensing platform for open-source maintainers.')
      expect(directionStep.currentValue).not.toMatch(/from the readme|guildhall should treat/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows project direction setup as a refreshable snapshot plus durable owner input', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Font Something',
          '',
          'AI-powered font generation desktop application.',
        ].join('\n'),
      )
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Inspect font workflows',
              status: 'ready',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
            {
              id: 'task-2',
              title: 'Draft onboarding checklist',
              status: 'blocked',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'font-something',
          name: 'Font Something',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'design', name: 'Design' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.contextSummary?.intro).toMatch(/current snapshot/i)
      expect(directionStep.contextSummary?.intro).toMatch(/not permanent project truth/i)
      expect(directionStep.contextSummary?.facts).toEqual(expect.arrayContaining([
        `Project: Font Something (${path.basename(projectPath)}).`,
        'Current read: AI-powered font generation desktop application.',
        'Coordinator areas: Design.',
        'Bootstrap has been verified before.',
        '2 tasks on record: 1 open, 1 blocked.',
      ]))
      expect(directionStep.contextSummary?.uncertainty).toMatch(/durable plan input/i)
      expect(directionStep.contextSummary?.uncertainty).toMatch(/revised later as the project changes/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows the same current snapshot before reviewing existing project work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(statePath(projectPath, 'project-brief.md'), 'Desktop font generation tool with model and app surfaces.')
      await writeFile(path.join(projectPath, 'README.md'), '# Font Something\n')
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'font-something',
          name: 'Font Something',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'model', name: 'Model' }, { id: 'app', name: 'App' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: false,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      const reviewStep = thread.turns.find(turn => turn.id === 'setup:workspaceImport')
      if (!reviewStep || reviewStep.kind !== 'setup_step') throw new Error('expected workspace import setup step')
      expect(reviewStep.actionLabel).toBe('Open import review')
      expect(reviewStep.contextSummary?.facts).toEqual(expect.arrayContaining([
        'Current read: Desktop font generation tool with model and app surfaces.',
        'Coordinator areas: Model, App.',
      ]))
      expect(reviewStep.contextSummary?.uncertainty).toMatch(/source notes before approving imported tasks/i)
      expect(reviewStep.contextSummary?.uncertainty).toMatch(/not as permanent project truth/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('replaces legacy generated project-direction boilerplate with the cleaner inferred brief', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for open-source maintainers.',
        ].join('\n'),
      )
      await writeFile(
        statePath(projectPath, 'project-brief.md'),
        'Fair Labor License Platform is this project. From the README, the project appears to be about modern licensing platform for open-source maintainers. Guildhall should treat the main goal as helping maintainers understand, adopt, publish, and operate the Fair Labor License cleanly.',
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe('Modern licensing platform for open-source maintainers.')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('folds a lead-in line plus bullets into one readable inferred brief sentence', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        path.join(projectPath, 'README.md'),
        [
          '# Fair Labor License Platform',
          '',
          'Modern licensing platform for:',
          '- **Primary**: OSS projects using Fair Labor License (FLL) v1.2',
          '- **Also**: Independent developers and small software companies needing basic licensing',
        ].join('\n'),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: false,
        workspaceImportReviewed: true,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const directionStep = thread.turns.find(turn => turn.id === 'setup:direction')
      if (!directionStep || directionStep.kind !== 'setup_step') throw new Error('expected direction setup step')
      expect(directionStep.currentValue).toBe(
        'Modern licensing platform for OSS projects using Fair Labor License (FLL) v1.2; Independent developers and small software companies needing basic licensing.',
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps provider setup active ahead of meta-intake when setup is still blocked', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          coordinators: [],
        },
        hasProvider: false,
        hasDirection: false,
        workspaceImportReviewed: false,
        taskCount: 0,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('setup:provider')
      const metaTurn = thread.turns.find(
        (turn) => turn.kind === 'inflight' && turn.taskId === 'task-meta-intake',
      )
      if (!metaTurn || metaTurn.kind !== 'inflight') throw new Error('expected meta-intake inflight turn')
      expect(metaTurn.status).toBe('pending')
      expect(metaTurn.phase).toBe('setup')
      expect(metaTurn.summary).toMatch(/provider configuration/i)
      expect(metaTurn.checklist).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('collapses duplicate unanswered questions with the same prompt into one visible card', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Starter task',
              status: 'spec_review',
              createdAt: new Date(Date.now() - 60_000).toISOString(),
              updatedAt: new Date(Date.now() - 10_000).toISOString(),
              openQuestions: [
                {
                  kind: 'choice',
                  id: 'q-1',
                  askedBy: 'spec-agent',
                  askedAt: new Date(Date.now() - 20_000).toISOString(),
                  prompt: 'Which option should we pick?',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                },
                {
                  kind: 'choice',
                  id: 'q-2',
                  askedBy: 'spec-agent',
                  askedAt: new Date(Date.now() - 10_000).toISOString(),
                  prompt: 'Which option should we pick?',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      const questionTurns = thread.turns.filter((turn) => turn.kind === 'agent_question')
      expect(questionTurns).toHaveLength(1)
      const questionTurn = questionTurns[0]
      if (!questionTurn || questionTurn.kind !== 'agent_question') throw new Error('expected question turn')
      expect(questionTurn.question.prompt).toBe('Which option should we pick?')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('collapses near-duplicate fallback questions with the same choices into one visible card', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-emoji',
              title: 'Emoji flow',
              status: 'spec_review',
              createdAt: now,
              updatedAt: now,
              openQuestions: [
                {
                  kind: 'choice',
                  id: 'q-1',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Pick the emoji fallback path:',
                  choices: ['Keep current emoji set', 'Use platform emoji', 'Defer emoji work'],
                  selectionMode: 'single',
                },
                {
                  kind: 'choice',
                  id: 'q-2',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Which emoji fallback path should I use?',
                  choices: ['Keep current emoji set', 'Use platform emoji', 'Defer emoji work'],
                  selectionMode: 'single',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      const questionTurns = thread.turns.filter((turn) => turn.kind === 'agent_question')
      expect(questionTurns).toHaveLength(1)
      const questionTurn = questionTurns[0]
      if (!questionTurn || questionTurn.kind !== 'agent_question') throw new Error('expected question turn')
      expect(questionTurn.questions).toBeUndefined()
      expect(questionTurn.question.choices).toEqual([
        'Keep current emoji set',
        'Use platform emoji',
        'Defer emoji work',
      ])
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('groups multiple open questions under one task turn with imported source context', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      const sourcePath = path.join(projectPath, 'knit', 'PROJECT_STATE.md')
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-import-1',
              title: 'Block menu / block side menu',
              description: 'knit/PROJECT_STATE.md: - [ ] Block menu / block side menu',
              status: 'exploring',
              createdAt: now,
              updatedAt: now,
              notes: [
                {
                  agentId: 'workspace-importer',
                  role: 'importer',
                  content: `Imported from: ${sourcePath}`,
                  timestamp: now,
                },
              ],
              openQuestions: [
                {
                  id: 'q-scope',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Should drag-and-drop reordering be in scope?',
                  choices: ['Include drag-handle in scope', 'Drag-handle is out of scope'],
                  selectionMode: 'single',
                },
                {
                  id: 'q-target',
                  kind: 'text',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Which editor package owns the block menu?',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'knit', name: 'Knit' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const questionTurns = thread.turns.filter((turn) => turn.kind === 'agent_question')
      expect(questionTurns).toHaveLength(1)
      const questionTurn = questionTurns[0]
      if (!questionTurn || questionTurn.kind !== 'agent_question') throw new Error('expected question turn')
      expect(thread.activeTurnId).toBe('q:task-import-1:questions')
      expect(questionTurn.taskDescription).toContain('Block menu / block side menu')
      expect(questionTurn.sourceNote?.references).toEqual([sourcePath])
      expect(questionTurn.questions?.map((question) => question.id)).toEqual(['q-scope', 'q-target'])
      expect(thread.turns.some((turn) => turn.id === 'inflight:task-import-1')).toBe(false)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows one task state when a draft brief also has an unanswered question', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-import-mentions',
              title: 'Mentions',
              description: 'looma/docs/editor-roadmap.md: - Mentions',
              status: 'exploring',
              productBrief: {
                userJob: 'Build the Looma editor mentions feature.',
                successMetric: 'Mentions can be inserted and rendered.',
                successCriteria: 'The worker has concrete acceptance criteria.',
                approvedAt: null,
              },
              openQuestions: [
                {
                  id: 'q-chip-style',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Should Looma ship inline mention chip rendering?',
                  choices: ['Looma ships chip CSS', 'Apps style the chip'],
                  selectionMode: 'single',
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'looma', name: 'Looma' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      expect(thread.activeTurnId).toBe('q:task-import-mentions:q-chip-style')
      expect(
        thread.turns.filter((turn) => 'taskId' in turn && turn.taskId === 'task-import-mentions'),
      ).toHaveLength(1)
      expect(thread.turns.find((turn) => turn.id === 'brief:task-import-mentions')).toBeUndefined()
      expect(thread.turns.find((turn) => turn.id === 'q:task-import-mentions:q-chip-style')?.kind).toBe('agent_question')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps dependency-blocked briefs and specs waiting behind the one current review', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const completeBrief = {
        userJob: 'Prove the packaged sidecar before desktop work begins.',
        whyItMattersNow: 'The desktop release depends on this architecture gate.',
        successMetric: 'The packaged app completes one offline fixture run.',
        nonGoals: ['Do not build the full interface yet.'],
      }
      const tasks = [
        taskRecord({
          id: 'task-086',
          title: 'Prove packaged Tauri sidecar',
          status: 'exploring',
          productBrief: completeBrief,
        }),
        taskRecord({
          id: 'task-087',
          title: 'Define typed desktop harness adapter',
          status: 'spec_review',
          dependsOn: ['task-086'],
          productBrief: { ...completeBrief, approvedAt: '2026-08-08T18:10:00.000Z' },
          spec: '## Summary\nDefine the adapter.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'Typed adapter exists.', verifiedBy: 'review', met: false }],
        }),
        taskRecord({
          id: 'task-088',
          title: 'Build quiet desktop shell',
          status: 'exploring',
          dependsOn: ['task-086'],
          productBrief: completeBrief,
        }),
      ]
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: '2026-08-08T18:00:00.000Z' },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: tasks.length,
        wizardState: emptyWizardsState(),
      }

      const thread = buildCurrentThread({ projectPath, snapshot, tasks, recentEvents: [] })

      expect(thread.activeTurnId).toBe('brief:task-086')
      expect(thread.turns.find(turn => turn.id === 'brief:task-086')).toMatchObject({ status: 'active' })
      expect(thread.turns.find(turn => turn.id === 'brief:task-088')).toBeUndefined()
      expect(thread.turns.find(turn => turn.id === 'spec:task-087')).toBeUndefined()
      expect(thread.turns.find(turn => turn.id === 'inflight:task-087')).toMatchObject({
        status: 'pending',
        dependencyBlockers: [{ taskId: 'task-086', title: 'Prove packaged Tauri sidecar' }],
      })
      expect(thread.turns.find(turn => turn.id === 'inflight:task-088')).toMatchObject({
        status: 'pending',
        dependencyBlockers: [{ taskId: 'task-086', title: 'Prove packaged Tauri sidecar' }],
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not ask for recovery brief approval when a concrete spec is already saved', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-block-menu',
              title: 'Block menu / block side menu',
              description: 'looma/docs/editor-roadmap.md: - **Block menu / block side menu**',
              status: 'exploring',
              createdAt: now,
              updatedAt: now,
              productBrief: {
                userJob: 'I want Block menu / block side menu turned into concrete project work using the evidence and owner decisions already recorded.',
                whyItMattersNow: 'Block menu / block side menu has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.',
                successMetric: 'Block menu / block side menu has a reviewable spec, acceptance criteria, and a clear completion boundary before implementation starts.',
                antiPatterns: [
                  'Do not preserve stale recovery-loop wording as the task brief.',
                  'Do not ask the owner to re-answer decisions already recorded on the task.',
                ],
                authoredBy: 'coordinator-recovery',
                authoredAt: now,
              },
              spec: '## Summary\nBuild the block menu from recorded owner decisions.\n\n## Acceptance Criteria\n1. The block menu appears in the editor.\n2. Drag-and-drop remains out of scope.',
              acceptanceCriteria: [
                { id: 'ac-1', description: 'The block menu appears in the editor.', verifiedBy: 'review', met: false },
                { id: 'ac-2', description: 'Drag-and-drop remains out of scope.', verifiedBy: 'review', met: false },
              ],
              notes: [
                {
                  agentId: 'coordinator-recovery',
                  role: 'system',
                  structured: { event: 'recovery_spec_seed', source: 'deterministic' },
                  content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane, so the task has durable progress instead of returning to a read-only shaping loop.',
                  timestamp: now,
                },
              ],
              openQuestions: [],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [{ id: 'looma', name: 'Looma' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      expect(thread.turns.find((turn) => turn.id === 'brief:task-block-menu' && turn.status !== 'done')).toBeUndefined()
      expect(thread.turns.find((turn) => turn.id === 'spec:task-block-menu')).toMatchObject({
        kind: 'spec_review',
        status: 'active',
        phase: 'spec',
      })
      expect(thread.activeTurnId).toBe('spec:task-block-menu')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('surfaces source and request milestones, preserves answered questions, and collapses repetitive recovery churn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const importedAt = '2026-05-10T16:40:53.757Z'
      const askedAt = '2026-05-18T19:49:46.995Z'
      const answeredAt = '2026-05-19T22:26:12.323Z'
      const reframeAt = '2026-05-31T16:52:42.757Z'
      const latestRecoveryAt = '2026-05-31T16:53:00.787Z'
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-import-1',
              title: 'Block menu / block side menu',
              description: 'looma/docs/editor-roadmap.md: - **Block menu / block side menu**',
              status: 'spec_review',
              createdAt: importedAt,
              updatedAt: latestRecoveryAt,
              productBrief: {
                userJob: 'Turn this imported draft into concrete project work.',
                successMetric: 'The task has a reviewable spec and acceptance criteria.',
                authoredBy: 'coordinator-recovery',
              },
              spec: '## Summary\nBuild the block menu.\n\n## Acceptance Criteria\n- The feature is reviewable.',
              acceptanceCriteria: [{ id: 'ac-1', text: 'Reviewable', met: false }],
              notes: [
                {
                  agentId: 'workspace-importer',
                  role: 'importer',
                  content: 'Imported from: /repo/looma/docs/editor-roadmap.md, /repo/looma/apps/docs/docs/component-library-audit.md',
                  timestamp: importedAt,
                },
                {
                  agentId: 'human',
                  role: 'shaping-request',
                  content: 'User asked Guildhall to shape this imported draft into a complete task.',
                  timestamp: '2026-05-18T19:47:52.792Z',
                },
                {
                  agentId: 'human',
                  role: 'human',
                  content: 'Asked Guildhall to reframe this task. Reason: Final release-blocker cleanup: regenerate the recovery spec with cleaned owner decisions and source evidence.',
                  timestamp: reframeAt,
                },
                {
                  agentId: 'system',
                  role: 'system',
                  content: 'Reframe requested for "Block menu / block side menu" from spec_review. Guildhall will rebuild the task in plain language before continuing.',
                  timestamp: reframeAt,
                },
                {
                  agentId: 'coordinator',
                  role: 'recovery',
                  structured: { event: 'stale_spec_claim_cleared', source: 'runtime' },
                  content: 'Runtime cleared a stale spec-agent claim so this draft waits in the shaping queue instead of pretending an agent is actively working on it.',
                  timestamp: '2026-05-31T16:53:00.658Z',
                },
                {
                  agentId: 'coordinator-recovery',
                  role: 'system',
                  structured: { event: 'recovery_spec_seed', source: 'deterministic' },
                  content: 'Guildhall wrote a deterministic recovery spec seed from the current task evidence before redispatching the spec lane, so the task has durable progress instead of returning to a read-only shaping loop.',
                  timestamp: latestRecoveryAt,
                },
              ],
              openQuestions: [
                {
                  id: 'q-scope',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt,
                  answeredAt,
                  answer: 'Drag-handle is out of scope — separate task.',
                  prompt: 'Should drag-and-drop reordering be in scope?',
                  choices: ['Include drag-handle in scope', 'Drag-handle is out of scope'],
                  selectionMode: 'single',
                },
                {
                  id: 'q-options',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: '2026-05-18T19:49:59.577Z',
                  answeredAt,
                  answer: 'Looma should ship defaults, but apps can override or extend.',
                  prompt: 'Should Looma ship defaults or require apps to supply the full list?',
                  choices: ['Apps supply the full list', 'Looma ships defaults', 'Looma ships defaults but apps can override'],
                  selectionMode: 'single',
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: latestRecoveryAt },
          coordinators: [{ id: 'looma', name: 'Looma' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const sourceTurn = thread.turns.find((turn) => turn.kind === 'history_note' && turn.label === 'Imported from source')
      expect(sourceTurn).toBeTruthy()
      if (!sourceTurn || sourceTurn.kind !== 'history_note') throw new Error('expected source history note')
      expect(sourceTurn.references).toEqual([
        '/repo/looma/docs/editor-roadmap.md',
        '/repo/looma/apps/docs/docs/component-library-audit.md',
      ])

      const answeredQuestionTurns = thread.turns.filter((turn) => turn.kind === 'agent_question' && turn.status === 'done')
      expect(answeredQuestionTurns).toHaveLength(2)

      const reframeTurn = thread.turns.find((turn) => turn.kind === 'history_note' && turn.label === 'Asked to reframe this task')
      expect(reframeTurn).toBeTruthy()
      if (!reframeTurn || reframeTurn.kind !== 'history_note') throw new Error('expected reframe history note')
      expect(reframeTurn.summary).toContain('Final release-blocker cleanup')

      const recoveryCluster = thread.turns.find((turn) => turn.kind === 'history_note' && turn.label === 'Recovery history')
      expect(recoveryCluster).toBeTruthy()
      if (!recoveryCluster || recoveryCluster.kind !== 'history_note') throw new Error('expected recovery history note')
      expect(recoveryCluster.count).toBe(2)
      expect(recoveryCluster.entries?.map((entry) => entry.label)).toEqual([
        'Cleared stale spec-agent claim',
        'Saved deterministic recovery spec seed',
      ])
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps an unanswered agent question active and demotes spec review until the question is answered', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'spec_review',
              spec: 'draft spec',
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Guildhall inferred the repo structure. Confirm?',
                  selectionMode: 'multiple',
                  choices: ['Frontend', 'Backend'],
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('q:task-meta-intake:q-1')
      const questionTurn = thread.turns.find(turn => turn.id === 'q:task-meta-intake:q-1')
      const specTurn = thread.turns.find(turn => turn.id === 'spec:task-meta-intake')
      expect(questionTurn?.status).toBe('active')
      expect(specTurn).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats an exploring task with a concrete spec draft and approved brief as queued spec revision work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-003',
              title: 'Draft a first starter task for Fair Labor License onboard...',
              status: 'exploring',
              spec: '## Summary\n\nWire up the existing auth page scaffolding to real Supabase authentication.\n\n## Acceptance Criteria\n\n1. Works.',
              acceptanceCriteria: [
                { id: 'ac-1', description: 'Works.', verifiedBy: 'review', met: false },
              ],
              productBrief: {
                userJob: 'New users can sign up and sign in.',
                successMetric: 'A new user reaches the dashboard.',
                approvedAt: now,
              },
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Pick one',
                  choices: ['A', 'B'],
                  selectionMode: 'single',
                  answeredAt: now,
                  answer: 'A',
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('inflight:task-003')
      const inflight = thread.turns.find((turn) => turn.id === 'inflight:task-003')
      if (!inflight || inflight.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(inflight.phase).toBe('spec')
      expect(inflight.checklist).toBeUndefined()
      expect(inflight.taskTitle).toMatch(/^Starter task spec: Wire up the existing auth page scaffolding/)
      expect(inflight.summary).toMatch(/answers and a spec draft/i)
      expect(inflight.summary).toMatch(/coordinator review/i)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects an approved brief without a spec as spec drafting instead of incomplete brief work', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const now = new Date().toISOString()
      const tasks = [taskRecord({
        id: 'task-086',
        title: 'Prove packaged Tauri sidecar',
        status: 'exploring',
        productBrief: {
          userJob: 'Prove the packaged sidecar.',
          whyItMattersNow: 'The desktop release depends on the architecture gate.',
          successMetric: 'The packaged app completes one offline fixture run.',
          nonGoals: ['Do not build the full interface.'],
          approvedAt: now,
        },
      })]
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'narrative-harness',
          name: 'Narrative Harness',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildCurrentThread({ projectPath, snapshot, tasks, recentEvents: [] })
      expect(thread.turns.find(turn => turn.id === 'inflight:task-086')).toMatchObject({
        phase: 'spec',
        briefApproved: true,
        specDraftPresent: false,
        summary: 'The brief is approved. Guildhall is shaping the spec now.',
        checklist: undefined,
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('ignores obsolete meta-intake routing questions when a valid routing draft already exists', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const now = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-meta-intake',
              title: 'Inspect the repo and draft starter tasks',
              status: 'spec_review',
              spec: `\`\`\`yaml
coordinators:
  - id: frontend
    domain: frontend
    mandate: Draft UI routing
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\``,
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt: now,
                  prompt: 'Pick the project areas (review lanes) you want coordinators for.',
                  selectionMode: 'multiple',
                  choices: ['Frontend'],
                },
              ],
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: now },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.activeTurnId).toBe('spec:task-meta-intake')
      expect(thread.turns.find(turn => turn.id === 'q:task-meta-intake:q-1')).toBeUndefined()
      const specTurn = thread.turns.find(turn => turn.id === 'spec:task-meta-intake')
      expect(specTurn?.status).toBe('active')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps an explicit owner question until an explicit mutation supersedes it', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const askedAt = '2026-05-11T20:24:31.428Z'
      const updatedAt = '2026-05-11T20:24:50.064Z'
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-003',
              title: 'Draft a first starter task',
              status: 'spec_review',
              spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Given...\n\n## Out of Scope\n\n- Nothing\n\n## Open Questions\n\n- None',
              acceptanceCriteria: [
                {
                  id: 'ac-1',
                  description: 'Given a user lands on /register, when they submit, then auth works.',
                  verifiedBy: 'review',
                  met: false,
                },
              ],
              openQuestions: [
                {
                  id: 'q-1',
                  kind: 'choice',
                  askedBy: 'spec-agent',
                  askedAt,
                  prompt: 'What should this first starter task focus on?',
                  selectionMode: 'single',
                  choices: ['Onboarding', 'Bootstrap'],
                },
              ],
              createdAt: askedAt,
              updatedAt,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: updatedAt },
          coordinators: [],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.turns.find(turn => turn.id === 'q:task-003:q-1')).toMatchObject({
        kind: 'agent_question',
        question: { id: 'q-1', prompt: 'What should this first starter task focus on?' },
      })
      expect(thread.turns.find(turn => turn.id === 'spec:task-003')).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects last live-agent activity and stalled state onto in-flight turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Build the thing',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 180_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 240_000).toISOString(),
            event: {
              type: 'agent_started',
              task_id: 'task-1',
              agent_name: 'worker-agent',
            },
          },
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
      expect(turn.liveAgent?.stalled).toBe(true)
      expect(turn.liveAgent?.silentMs).toBeGreaterThanOrEqual(180_000)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('reconstructs a live in-flight agent from activity after the start event ages out', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 1_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.summary).toBe('Worker is working on this now.')
      expect(turn.liveAgent?.name).toBe('worker-agent')
      expect(turn.liveAgent?.lastEventAt).toBe(lastEventAt)
      expect(turn.liveAgent?.lastEventLabel).toBe('Finished file read')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not project stale task activity as live work once the coordinator is stopped', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Shape imported draft',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [{ role: 'shaping-request', content: 'shape this', timestamp: new Date().toISOString() }],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const lastEventAt = new Date(Date.now() - 60_000).toISOString()

      const thread = buildThread({
        projectPath,
        snapshot,
        runStatus: 'stopped',
        recentEvents: [
          {
            at: lastEventAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              tool_name: 'read-file',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent).toBeUndefined()
      expect(turn.summary).toBe('The spec author is shaping this task.')
      expect(turn.activity?.at(-1)?.label).toBe('Finished file read')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('labels failed live tools as failed instead of finished', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventLabel).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps research-budget prose as activity detail instead of suppressing it', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Inspect the repo',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 3_000).toISOString(),
            event: {
              type: 'agent_started',
              task_id: 'task-1',
              agent_name: 'spec-agent',
            },
          },
          {
            at: new Date(Date.now() - 2_000).toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              tool_name: 'glob',
              is_error: true,
              output: 'Research budget exhausted for this intake turn. Do not call more read-only tools now.',
            },
          },
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              message: 'Assistant kept researching after an explicit durable-progress nudge; refusing more read-only tool calls for this turn.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.liveAgent?.lastEventLabel).toContain('Assistant kept researching')
      expect(turn.activity?.some(item => item.label === 'Failed glob')).toBe(true)
      expect(JSON.stringify(turn.activity ?? [])).toContain('Research budget exhausted')
      expect(turn.activity?.some(item => item.kind === 'running')).toBe(true)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not present old exploring transcript questions as a current wait state', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Shape AlertDialog',
              status: 'exploring',
              openQuestions: [
                {
                  id: 'q-1',
                  prompt: 'Stencil or vanilla?',
                  answeredAt: new Date().toISOString(),
                  answer: 'Stencil',
                },
              ],
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 2_000).toISOString(),
            event: {
              type: 'agent_started',
              task_id: 'task-1',
              agent_name: 'spec-agent',
            },
          },
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'spec-agent',
              tool_name: 'read-exploring-transcript',
              is_error: false,
              output:
                '## [2026-05-30T23:24:19.974Z] spec-agent\n\nI already posted two questions via `post-user-question` in my last turn. Let me record the transcript and wait for answers.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      const rendered = JSON.stringify(turn.activity ?? [])
      expect(rendered).not.toContain('Guildhall asked a question and is waiting for the answer.')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('preserves agent activity prose without classifying it in Thread', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Complete auth flow',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 2_000).toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'read-file',
              is_error: true,
              output: 'You have already inspected an authoritative likely target file at /tmp/auth.vue. Do not do more read-only exploration now.',
            },
          },
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Assistant already inspected an authoritative likely target file; refusing further read-only exploration until it makes concrete progress or escalates.',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Assistant kept using non-durable steps without moving the implementation forward; asking it to mutate, verify, checkpoint, or escalate now.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      const rendered = JSON.stringify(turn.activity ?? [])
      expect(rendered).toContain('authoritative likely target')
      expect(rendered).toContain('non-durable steps')
      expect(rendered).not.toContain('make a concrete change')
      expect(rendered).not.toContain('save concrete progress')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('preserves provider review prose without deriving a verification state from it', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Complete auth flow',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Writing complete for all acceptance criteria except AC-8, which cannot be verified due to missing test infrastructure in the project. The self-critique has been documented.',
            },
          },
          {
            at: new Date(Date.now() + 1).toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Writing complete for all acceptance criteria except AC-9, which cannot be verified due to missing test infrastructure in the project. The self-critique has been documented.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      const rendered = JSON.stringify(turn.activity ?? [])
      expect(rendered).toContain('AC-8')
      expect(rendered).toContain('AC-9')
      expect(rendered).toContain('self-critique')
      expect(rendered).not.toContain('one verification check still needs a project test command')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows recent failed activity on blocked escalation turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix conversion',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'human_judgment_required',
                  summary: 'Worker stopped after hitting its turn limit.',
                  details: 'Exceeded maximum turn limit (24)',
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'edit-file',
              is_error: true,
              output: 'Invalid input for edit-file: [{"code":"invalid_type","expected":"string","received":"undefined","path":["oldString"],"message":"Required"}]',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.activity?.at(-1)?.label).toBe('Failed file edit')
      expect(turn.activity?.at(-1)?.tone).toBe('danger')
      expect(turn.activity?.at(-1)?.detail).toContain('missing oldString')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not invent an escalation when only blockReason was persisted', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-blocked-without-escalation',
              title: 'Fix local bootstrap',
              status: 'blocked',
              blockReason: 'worktree bootstrap failed on command `pixi install`.',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
      })

      expect(thread.turns.some(t => t.kind === 'escalation')).toBe(false)
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('includes compact policy classification context on blocked escalation turns', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix invite flow',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'coordinator',
                  role: 'policy-classification',
                  timestamp: new Date().toISOString(),
                  content: JSON.stringify({
                    class: 'self_authored_verification_failure',
                    summary:
                      'Verification failed in files the worker already touched; Guildhall can keep this in focused repair.',
                  }),
                },
                {
                  agentId: 'coordinator',
                  role: 'recovery-playbook',
                  timestamp: new Date().toISOString(),
                  content: JSON.stringify({
                    status: 'started',
                    playbook: 'repair_touched_file_failure',
                    summary:
                      'Trying focused repair in checkpoint-touched files before asking for a human decision.',
                  }),
                },
              ],
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'decision_required',
                  summary: 'Worker raised a blocker for its own failed verification.',
                  details: 'settings.vue cannot find sendInvite.',
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.details).toContain('Policy read:')
      expect(turn.details).toContain('Recovery path:')
      expect(turn.details).toContain('focused repair')
      expect(turn.details).toContain('settings.vue cannot find sendInvite')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('compresses oversized reviewer escalation details into a short task-card digest', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Generate TypeScript types from Supabase schema',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'max_revisions_exceeded',
                  summary: 'Exceeded maxRevisions (3). Reviewer fan-out keeps rejecting.',
                  details: [
                    '**Aggregated revisions from 1 persona:**',
                    '',
                    '### From The Security Engineer',
                    '',
                    'The composable accepts a `slug` from the subdomain and uses it directly in a Supabase query without any boundary validation.',
                    '',
                    'What must change:',
                    '- Add schema validation for the `slug` value before it is used in the Supabase query.',
                    '',
                    '### Reviewer availability notes',
                    '- The Project Manager failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
                    '- The API Designer failed to produce a verdict (persona review timed out after 60000ms). Treating as revise per strict-all policy.',
                  ].join('\n'),
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.details).toBe(
        'Add schema validation for the slug value before it is used in the Supabase query. 2 reviewers timed out.',
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('turns dirty repo setup blockers into an actionable recovery message', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Continue shaped draft',
              status: 'blocked',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              escalations: [
                {
                  id: 'esc-task-1-1',
                  reason: 'human_judgment_required',
                  summary: 'Worktree setup blocked',
                  details:
                    'Guildhall could not start work because the target repo is dirty: base repo has uncommitted changes at /Users/matthew/git/oss/looma-knit/knit. Commit or stash those changes, then resume the task.',
                  raisedAt: new Date().toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'escalation')
      if (!turn || turn.kind !== 'escalation') throw new Error('expected escalation turn')
      expect(turn.details).toBe(
        'Guildhall is blocked because knit has uncommitted changes. Commit or stash that repo, then try again.',
      )
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows a rolling excerpt while an agent is writing', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'I am checking ',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'assistant_delta',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'the failing tests before editing.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.at(-1)?.label).toBe('Writing')
      expect(turn.activity?.at(-1)?.detail).toContain('checking the failing tests')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('treats empty-model reply errors as warnings and retries as running activity', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty reply. Retrying (1/2) without changing task state.',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Model returned an empty assistant message. The turn was ignored to keep the session healthy.',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.[0]?.tone).toBe('running')
      expect(turn.activity?.[1]?.tone).toBe('warn')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('shows provider overload as warning activity instead of raw task failure text', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Keep working',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 1_000).toISOString(),
            event: {
              type: 'line_complete',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Request failed; retrying in 2.0s (attempt 3 of 4): OpenAI-compatible API HTTP 429: {"error":{"message":"Model busy, retry later","code":"engine_overloaded"}}',
            },
          },
          {
            at: new Date().toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Agent worker-agent failed on task-1: API error: OpenAI-compatible API HTTP 429: {"error":{"message":"Model busy, retry later","code":"engine_overloaded"}}',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.[0]?.label).toBe('Provider busy; retrying in 2.0s (attempt 3 of 4).')
      expect(turn.activity?.[0]?.tone).toBe('warn')
      expect(turn.activity?.[1]?.label).toBe('Provider busy; this agent turn stopped.')
      expect(turn.activity?.[1]?.tone).toBe('warn')
      expect(turn.activity?.[1]?.detail).toContain('overloaded capacity')
      expect(JSON.stringify(turn.activity)).not.toContain('engine_overloaded')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('keeps recent failed tool output visible while later writing continues', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix tests',
              status: 'in_progress',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }
      const laterWriting = Array.from({ length: 8 }, (_, index) => ({
        at: new Date(Date.now() + index).toISOString(),
        event: {
          type: index % 2 === 0 ? 'assistant_delta' : 'assistant_complete',
          task_id: 'task-1',
          agent_name: 'worker-agent',
          message: `later note ${index}`,
        },
      }))

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date().toISOString(),
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'run-command',
              is_error: true,
              output: 'vitest failed with 3 tests',
            },
          },
          ...laterWriting,
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity?.map(item => item.label)).toContain('Failed command')
      expect(turn.activity?.find(item => item.label === 'Failed command')?.detail).toContain('vitest failed')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('hides stale live activity older than the task updatedAt when a task has been reset', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      const updatedAt = new Date().toISOString()
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Reset task',
              status: 'review',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt,
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: new Date(Date.now() - 120_000).toISOString(),
            event: {
              type: 'error',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              message: 'Old failure that should not survive reset',
            },
          },
        ],
      })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.activity ?? []).toHaveLength(0)
      expect(turn.liveAgent).toBeUndefined()
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects imported draft tasks as shaping work instead of generic paused intake', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Imported roadmap task',
              status: 'exploring',
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'workspace-importer',
                  role: 'importer',
                  content: 'Imported from: looma/docs/component-roadmap.md',
                  timestamp: new Date(Date.now() - 300_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'looma', name: 'Looma' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'inflight')
      if (!turn || turn.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(turn.importedDraft).toBe(true)
      expect(turn.summary).toBe('Imported draft has a task brief in progress.')
      expect(turn.checklist).toBeUndefined()
      expect(turn.phase).toBe('intake')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('projects reviewer feedback as its own lifecycle turn', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise the thing',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: [
                    '**Aggregated revisions from 3 personas:**',
                    '',
                    'What must change:',
                    '- Fix the failing converter tests.',
                    '- Add a checkpoint before review.',
                  ].join('\n'),
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const turn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!turn || turn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(turn.persona).toBe('reviewer')
      expect(turn.phase).toBe('inflight')
      expect(turn.status).toBe('done')
      expect(turn.revisionCount).toBe(1)
      expect(turn.summary).toBe('Fix the failing converter tests.')
      expect(turn.feedback).toContain('Aggregated revisions')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('numbers reviewer feedback by feedback turn instead of current task revision', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Revise twice',
              status: 'in_progress',
              revisionCount: 2,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: new Date(Date.now() - 300_000).toISOString(),
              notes: [
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- First fix.',
                  timestamp: new Date(Date.now() - 180_000).toISOString(),
                },
                {
                  agentId: 'reviewer-fanout',
                  role: 'reviewer',
                  content: 'What must change:\n- Second fix.',
                  timestamp: new Date(Date.now() - 120_000).toISOString(),
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot })

      const feedbackTurns = thread.turns.filter(t => t.kind === 'review_feedback')
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.revisionCount : null)).toEqual([1, 2])
      expect(feedbackTurns.map(t => t.kind === 'review_feedback' ? t.summary : '')).toEqual([
        'First fix.',
        'Second fix.',
      ])
      expect(feedbackTurns.map(t => t.phase)).toEqual(['done', 'inflight'])
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('lets a newer failed verifier event dominate the active view over stale review feedback', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const reviewAt = new Date(Date.now() - 180_000).toISOString()
      const failAt = new Date(Date.now() - 30_000).toISOString()
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-1',
              title: 'Fix auth callback',
              status: 'in_progress',
              revisionCount: 1,
              createdAt: new Date(Date.now() - 600_000).toISOString(),
              updatedAt: failAt,
              notes: [
                {
                  agentId: 'reviewer-agent',
                  role: 'reviewer',
                  content: 'What must change:\n- Add an explicit return type.',
                  timestamp: reviewAt,
                },
              ],
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [
          {
            at: failAt,
            event: {
              type: 'tool_completed',
              task_id: 'task-1',
              agent_name: 'worker-agent',
              tool_name: 'shell',
              is_error: true,
              output: 'pnpm typecheck\nserver/api/auth/callback.get.ts(30,1): error TS1434',
            },
          },
        ],
      })

      const reviewTurn = thread.turns.find(t => t.kind === 'review_feedback')
      if (!reviewTurn || reviewTurn.kind !== 'review_feedback') throw new Error('expected review feedback turn')
      expect(reviewTurn.phase).toBe('done')

      const inflight = thread.turns.find(t => t.kind === 'inflight')
      if (!inflight || inflight.kind !== 'inflight') throw new Error('expected inflight turn')
      expect(inflight.activity?.[0]?.label).toBe('Failed shell')
      expect(inflight.activity?.[0]?.detail).toContain('error TS1434')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('does not revive a resolved escalation from a stale task blockReason', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      await mkdir(statePath(projectPath), { recursive: true })
      await writeFile(
        statePath(projectPath, 'TASKS.json'),
        JSON.stringify({
          tasks: [
            {
              id: 'task-resolved',
              title: 'Recovered task',
              description: 'The visible recovery has already been handled.',
              domain: 'frontend',
              projectPath,
              status: 'blocked',
              blockReason: 'Spec agent kept researching after Guildhall asked for durable progress.',
              escalations: [
                {
                  id: 'esc-resolved',
                  reason: 'spec_no_progress',
                  summary: 'Spec agent kept researching after Guildhall asked for durable progress.',
                  resolvedAt: '2026-05-31T14:00:00.000Z',
                  resolution: 'User chose retry from transcript.',
                },
              ],
              createdAt: '2026-05-31T13:00:00.000Z',
              updatedAt: '2026-05-31T14:00:00.000Z',
            },
          ],
        }),
      )
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'frontend', name: 'Frontend' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 1,
        wizardState: emptyWizardsState(),
      }

      const thread = buildThread({ projectPath, snapshot, recentEvents: [] })

      expect(thread.turns.find(t => t.kind === 'escalation' && t.taskId === 'task-resolved')).toBeUndefined()
      expect(JSON.stringify(thread.turns)).not.toContain('Spec agent kept researching')
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })

  it('labels downstream shaping as waiting on its dependency', async () => {
    const projectPath = await mkdtemp(path.join(tmpdir(), 'guildhall-thread-'))
    try {
      const now = new Date().toISOString()
      const snapshot: ProjectSnapshot = {
        projectPath,
        config: {
          id: 'demo',
          name: 'Demo',
          bootstrap: { verifiedAt: new Date().toISOString() },
          coordinators: [{ id: 'core', name: 'Core' }],
        },
        bootstrapVerified: true,
        hasProvider: true,
        hasDirection: true,
        workspaceImportReviewed: true,
        taskCount: 2,
        wizardState: emptyWizardsState(),
      }
      const thread = buildThread({
        projectPath,
        snapshot,
        recentEvents: [],
        tasks: [
          {
            id: 'task-gate', title: 'Prove architecture', description: 'Prove it.', domain: 'core', projectPath,
            status: 'ready', priority: 'normal', dependsOn: [], acceptanceCriteria: [], notes: [], gateResults: [],
            reviewVerdicts: [], adjudications: [], escalations: [], agentIssues: [], outOfScope: [], revisionCount: 0,
            remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now,
          },
          {
            id: 'task-ui', title: 'Build desktop UI', description: 'Build it.', domain: 'core', projectPath,
            status: 'exploring', priority: 'normal', dependsOn: ['task-gate'], acceptanceCriteria: [], notes: [], gateResults: [],
            reviewVerdicts: [], adjudications: [], escalations: [], agentIssues: [], outOfScope: [], revisionCount: 0,
            remediationAttempts: 0, origination: 'human', createdAt: now, updatedAt: now,
          },
        ],
      })

      const turn = thread.turns.find(candidate => candidate.kind === 'inflight' && candidate.taskId === 'task-ui')
      expect(turn).toMatchObject({
        summary: 'Waiting for Prove architecture.',
        dependencyBlockers: [{ taskId: 'task-gate', title: 'Prove architecture' }],
      })
    } finally {
      await rm(projectPath, { recursive: true, force: true })
    }
  })
})
