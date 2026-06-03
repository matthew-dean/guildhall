import {
  applyBoundedChatCoordinatorAction,
  createBoundedChatSession,
  loadBoundedChatSession,
  saveBoundedChatSession,
  submitBoundedChatUserResponse,
  type BoundedChatSession,
} from './bounded-chat.js'
import { createExploringTask } from './intake.js'
import { analyzeRequestIntake } from './request-intake.js'

type NewRequestKind = 'task_spec' | 'project_question' | 'settings_proposal' | 'persona_practice_proposal' | 'repair_triage' | 'clarification'

export async function createNewRequestBoundedChat(input: {
  memoryDir: string
  projectId: string
  ask: string
  domain: string
  projectPath: string
  workspacePath?: string
  title?: string
  routedRequestKind: NewRequestKind
  routingSummary: string
}): Promise<BoundedChatSession> {
  const analysis = analyzeRequestIntake({
    ask: input.ask,
    title: input.title,
  })
  const prompt = deriveInitialPrompt(analysis, input.routedRequestKind)
  const objective = objectiveForRequestKind(input.routedRequestKind)

  const session = await createBoundedChatSession({
    memoryDir: input.memoryDir,
    projectId: input.projectId,
    source: 'thread:new-request',
    objective,
    initialSubObjective: {
      id: prompt.id,
      objective: prompt.objective,
      prompt: prompt.prompt,
      helperText: prompt.helperText,
      choices: prompt.choices,
    },
  })

  session.plannerState = {
    ...session.plannerState,
    newRequest: {
      ask: input.ask,
      ...(input.title ? { title: input.title } : {}),
      domain: input.domain,
      projectPath: input.projectPath,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      routedRequestKind: input.routedRequestKind,
      routingSummary: input.routingSummary,
    },
  }
  await saveBoundedChatSession(input.memoryDir, session)
  return session
}

export async function answerNewRequestBoundedChat(input: {
  memoryDir: string
  sessionId: string
  subObjectiveId: string
  response: string
}): Promise<BoundedChatSession> {
  const before = await loadBoundedChatSession({
    memoryDir: input.memoryDir,
    sessionId: input.sessionId,
  })
  const active = before.subObjectives.find(item => item.id === input.subObjectiveId)
  if (!active) throw new Error(`bounded chat sub-objective ${input.subObjectiveId} was not found`)

  const reviewed = await submitBoundedChatUserResponse({
    memoryDir: input.memoryDir,
    sessionId: input.sessionId,
    subObjectiveId: input.subObjectiveId,
    response: input.response,
  })

  const cleaned = input.response.trim()
  if (isConfusedAnswer(cleaned)) {
    return applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `discard-${reviewed.id}-${input.subObjectiveId}-${reviewed.subObjectives[0]?.localTurns.length ?? 0}`,
        type: 'discard_response',
        subObjectiveId: input.subObjectiveId,
        reason: 'confused',
        replacementPrompt: active.prompt,
      },
    })
  }
  if (cleaned.length < 8) {
    return applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `discard-short-${reviewed.id}-${input.subObjectiveId}-${reviewed.subObjectives[0]?.localTurns.length ?? 0}`,
        type: 'discard_response',
        subObjectiveId: input.subObjectiveId,
        reason: 'non_answer',
        replacementPrompt: active.prompt,
      },
    })
  }

  const plannerState = before.plannerState?.newRequest
  if (!plannerState) {
    throw new Error('New request planner state is missing.')
  }

  if (plannerState.routedRequestKind === 'project_question') {
    const closed = await applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `close-${reviewed.id}-${input.subObjectiveId}`,
        type: 'close_session',
        outcome: 'fulfilled',
        summary: 'Guildhall kept this as a project question thread.',
        decisions: [cleaned],
        taskDrafts: [],
        facts: [],
        settingUpdates: [],
        evidence: [],
      },
    })
    closed.plannerState = {
      ...closed.plannerState,
      newRequest: plannerState,
    }
    await saveBoundedChatSession(input.memoryDir, closed)
    return closed
  }

  const analysis = analyzeRequestIntake({
    ask: plannerState.ask,
    title: plannerState.title,
  })
  const resolvedIntake = {
    ...analysis.requestIntake,
    clarifyingQuestions: [],
  }

  const task = await createExploringTask({
    memoryDir: input.memoryDir,
    ask: plannerState.ask,
    domain: plannerState.domain,
    projectPath: plannerState.projectPath,
    ...(plannerState.workspacePath ? { workspacePath: plannerState.workspacePath } : {}),
    ...(plannerState.title ? { title: plannerState.title } : {}),
    request: {
      id: `request-${Date.now().toString(36)}-bounded-chat`,
      raw: plannerState.ask,
      kind: plannerState.routedRequestKind,
      title: plannerState.title ?? plannerState.ask,
      routingSummary: plannerState.routingSummary,
      pressureTestRequired: true,
      createdAt: new Date().toISOString(),
    },
    requestIntakeOverride: resolvedIntake,
    ownerInputOverride: null,
  })

  const closed = await applyBoundedChatCoordinatorAction({
    memoryDir: input.memoryDir,
    sessionId: reviewed.id,
    expectedUpdatedAt: reviewed.updatedAt,
    action: {
      actionId: `close-${reviewed.id}-${input.subObjectiveId}`,
      type: 'close_session',
      outcome: 'fulfilled',
      summary: 'Guildhall shaped the new request into runnable work.',
      decisions: [cleaned],
      taskDrafts: [task.taskId],
      facts: [],
      settingUpdates: [],
      evidence: [],
    },
  })
  closed.plannerState = {
    ...closed.plannerState,
    newRequest: plannerState,
  }
  await saveBoundedChatSession(input.memoryDir, closed)
  return closed
}

function isConfusedAnswer(answer: string): boolean {
  return /\b(i do not understand|i don't understand|what do you mean|nature of the question|unclear question|confusing)\b/i.test(answer)
}

function deriveInitialPrompt(
  analysis: ReturnType<typeof analyzeRequestIntake>,
  routedRequestKind: NewRequestKind,
): {
  id: string
  objective: string
  prompt: string
  helperText?: string
  choices?: string[]
} {
  if (routedRequestKind === 'project_question') {
    return {
      id: 'project-question-context',
      objective: 'Gather project-question context',
      prompt: 'Guildhall can answer this in Thread. Is there a source, task, or recent blocker it should use first?',
      helperText: 'This stays a project conversation unless you ask Guildhall to turn it into work.',
      choices: ['Use current blocker evidence', 'Use project docs', 'No extra context'],
    }
  }

  const question = analysis.ownerInput
  if (question) {
    return {
      id: 'request-scope',
      objective: 'Clarify request scope',
      prompt: question.prompt,
      helperText: question.helperText,
      choices: question.choices,
    }
  }

  return {
    id: 'request-shaping',
    objective: 'Shape task requirements',
    prompt: 'Before Guildhall shapes this into work, what requirements, acceptance criteria, test expectations, or deliverables matter most?',
    helperText: 'This can include scope boundaries, proof expectations, UX constraints, rollout boundaries, or anything else that would change what “done” means.',
  }
}

function objectiveForRequestKind(kind: NewRequestKind): {
  kind: 'new_request'
  label: string
  successCriteria: string[]
} {
  if (kind === 'project_question') {
    return {
      kind: 'new_request',
      label: 'Answer a project question',
      successCriteria: ['Answer the project question in Thread without creating task work.'],
    }
  }
  return {
    kind: 'new_request',
    label: 'Shape a new request',
    successCriteria: ['Classify the request and shape the next action.'],
  }
}
