import fsp from 'node:fs/promises'
import path from 'node:path'
import { projectRootFromMemoryDir, projectStatePath } from '@guildhall/sessions'
import {
  applyBoundedChatCoordinatorAction,
  createBoundedChatSession,
  loadBoundedChatSession,
  saveBoundedChatSession,
  submitBoundedChatUserResponse,
  type BoundedChatSession,
} from './bounded-chat.js'
import {
  buildProjectQuestionEvidence,
  classifyProjectAnswer,
  inferProjectMemory,
  planFollowUpForAnswer,
  planNextProjectQuestion,
  type ProjectQuestionAnswer,
  type ProjectQuestionEvidenceFile,
} from './project-question-planner.js'

export async function createProjectCheckInBoundedChat(input: {
  memoryDir: string
  projectId: string
  projectName: string
}): Promise<BoundedChatSession> {
  const files = await loadProjectQuestionEvidenceFiles(input.memoryDir)
  const evidence = buildProjectQuestionEvidence({
    projectId: input.projectId,
    projectName: input.projectName,
    files,
    currentAnswers: [],
  })
  const memory = inferProjectMemory(evidence)
  const plan = planNextProjectQuestion({
    evidence,
    answeredQuestions: [],
    askedCandidateIds: [],
  })
  if (plan.kind !== 'ask') {
    throw new Error('Project check-in does not have a pending question to ask.')
  }

  const session = await createBoundedChatSession({
    memoryDir: input.memoryDir,
    projectId: input.projectId,
    source: 'thread:project-check-in',
    objective: {
      kind: 'project_check_in',
      label: 'Project check-in',
      successCriteria: ['Capture enough near-term direction for Guildhall to shape work without guessing.'],
    },
    initialSubObjective: {
      id: plan.question.id,
      objective: 'Capture project direction',
      prompt: plan.question.prompt,
      helperText: plan.question.why,
      choices: plan.question.choices,
    },
  })

  session.plannerState = {
    projectCheckIn: {
      projectName: input.projectName,
      askedCandidateIds: [plan.question.id],
      answeredQuestions: [],
    },
  }

  if (memory.inferredFacts.length > 0) {
    session.acceptedState.facts = memory.inferredFacts.map(fact => ({
      fact: fact.text,
      sourceSubObjectiveId: plan.question.id,
    }))
  }
  session.updatedAt = new Date().toISOString()
  await saveBoundedChatSession(input.memoryDir, session)
  return session
}

export async function answerProjectCheckInBoundedChat(input: {
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

  const currentAnswer: ProjectQuestionAnswer = {
    questionId: input.subObjectiveId,
    prompt: active.prompt,
    answer: input.response,
  }
  const classification = classifyProjectAnswer(currentAnswer)

  if (classification.kind === 'discard') {
    return applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `discard-${reviewed.id}-${input.subObjectiveId}-${reviewed.subObjectives[0]?.localTurns.length ?? 0}`,
        type: 'discard_response',
        subObjectiveId: input.subObjectiveId,
        reason: classification.reason,
        replacementPrompt: active.prompt,
      },
    })
  }

  const followUp = planFollowUpForAnswer(currentAnswer)
  if (followUp.kind === 'ask') {
    return applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `follow-up-${reviewed.id}-${followUp.question.id}`,
        type: 'ask_follow_up',
        subObjectiveId: input.subObjectiveId,
        prompt: followUp.question.prompt,
        helperText: followUp.question.why,
        choices: followUp.question.choices,
      },
    })
  }

  const plannerState = before.plannerState?.projectCheckIn
  if (!plannerState) {
    throw new Error('Project check-in planner state is missing.')
  }
  const answeredQuestions = [
    ...plannerState.answeredQuestions,
    currentAnswer,
  ]
  const files = await loadProjectQuestionEvidenceFiles(input.memoryDir)
  const evidence = buildProjectQuestionEvidence({
    projectId: before.projectId,
    projectName: plannerState.projectName,
    files,
    currentAnswers: answeredQuestions,
  })
  const next = planNextProjectQuestion({
    evidence,
    answeredQuestions,
    askedCandidateIds: plannerState.askedCandidateIds,
  })
  if (next.kind === 'ask') {
    const reopened = await applyBoundedChatCoordinatorAction({
      memoryDir: input.memoryDir,
      sessionId: reviewed.id,
      expectedUpdatedAt: reviewed.updatedAt,
      action: {
        actionId: `next-root-${reviewed.id}-${next.question.id}`,
        type: 'ask_follow_up',
        subObjectiveId: input.subObjectiveId,
        prompt: next.question.prompt,
        helperText: next.question.why,
        choices: next.question.choices,
      },
    })
    reopened.subObjectives[0]!.status = 'answered'
    reopened.acceptedState.decisions.push({
      decision: classification.text,
      sourceSubObjectiveId: input.subObjectiveId,
    })
    reopened.subObjectives.push({
      id: next.question.id,
      rootQuestionId: next.question.id,
      objective: 'Capture project direction',
      prompt: next.question.prompt,
      helperText: next.question.why,
      choices: next.question.choices,
      followUpDepth: 0,
      localTurns: [],
      status: 'active',
    })
    reopened.activeSubObjectiveId = next.question.id
    reopened.plannerState = {
      projectCheckIn: {
        projectName: plannerState.projectName,
        askedCandidateIds: [...plannerState.askedCandidateIds, next.question.id],
        answeredQuestions,
      },
    }
    reopened.updatedAt = new Date().toISOString()
    await saveBoundedChatSession(input.memoryDir, reopened)
    return reopened
  }

  const closed = await applyBoundedChatCoordinatorAction({
    memoryDir: input.memoryDir,
    sessionId: reviewed.id,
    expectedUpdatedAt: reviewed.updatedAt,
    action: {
      actionId: `close-${reviewed.id}-${input.subObjectiveId}`,
      type: 'close_session',
      outcome: 'fulfilled',
      summary: 'Guildhall recorded the project check-in direction.',
      facts: [],
      decisions: [classification.text],
      settingUpdates: [],
      taskDrafts: [],
      evidence: [],
    },
  })
  closed.plannerState = {
    projectCheckIn: {
      projectName: plannerState.projectName,
      askedCandidateIds: plannerState.askedCandidateIds,
      answeredQuestions,
    },
  }
  await saveBoundedChatSession(input.memoryDir, closed)
  return closed
}

export async function resumeProjectCheckInBoundedChat(input: {
  memoryDir: string
  projectId: string
  projectName: string
}): Promise<BoundedChatSession> {
  const { listBoundedChatSessions } = await import('./bounded-chat.js')
  const active = listBoundedChatSessions(input.memoryDir)
    .find(session =>
      session.projectId === input.projectId &&
      session.objective.kind === 'project_check_in' &&
      (session.status === 'waiting_for_owner' || session.status === 'coordinator_review'),
    )
  if (active) return active
  return createProjectCheckInBoundedChat(input)
}

async function loadProjectQuestionEvidenceFiles(memoryDir: string): Promise<ProjectQuestionEvidenceFile[]> {
  const projectRoot = projectRootFromMemoryDir(memoryDir)
  const candidates = [
    { file: projectStatePath(projectRoot, 'project-brief.md'), source: 'project-brief.md' },
    { file: projectStatePath(projectRoot, 'TASKS.json'), source: 'TASKS.json' },
    { file: path.join(projectRoot, 'README.md'), source: 'README.md' },
    { file: path.join(projectRoot, 'docs', 'index.md'), source: 'docs/index.md' },
  ]
  const files: ProjectQuestionEvidenceFile[] = []
  for (const candidate of candidates) {
    try {
      files.push({
        path: candidate.source,
        text: await fsp.readFile(candidate.file, 'utf-8'),
      })
    } catch {
      // Missing evidence files are normal for new projects.
    }
  }
  return files
}
