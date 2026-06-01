import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'
import { readCachedJson } from './file-read-cache.js'

const BoundedChatObjectiveKind = z.enum([
  'project_intake',
  'project_check_in',
  'new_request',
  'task_shaping',
  'setting_update',
  'recovery_decision',
  'capability_decision',
])
export type BoundedChatObjectiveKind = z.infer<typeof BoundedChatObjectiveKind>

const BoundedChatStatus = z.enum([
  'active',
  'waiting_for_user',
  'coordinator_review',
  'fulfilled',
  'blocked',
  'cancelled',
])
export type BoundedChatStatus = z.infer<typeof BoundedChatStatus>

const BoundedChatTurn = z.object({
  role: z.enum(['user', 'assistant', 'coordinator']),
  content: z.string(),
  selectedChoiceIds: z.array(z.string()).default([]),
})
type BoundedChatTurn = z.infer<typeof BoundedChatTurn>

const BoundedChatSubObjective = z.object({
  id: z.string(),
  rootQuestionId: z.string().optional(),
  objective: z.string(),
  prompt: z.string(),
  helperText: z.string().optional(),
  choices: z.array(z.string()).optional(),
  followUpDepth: z.number().int().min(0).default(0),
  localTurns: z.array(BoundedChatTurn).default([]),
  status: z.enum(['active', 'answered', 'discarded', 'blocked']),
})
type BoundedChatSubObjective = z.infer<typeof BoundedChatSubObjective>

const AcceptedFact = z.object({
  fact: z.string(),
  sourceSubObjectiveId: z.string(),
})

const AcceptedDecision = z.object({
  decision: z.string(),
  sourceSubObjectiveId: z.string(),
})

const DiscardedResponse = z.object({
  subObjectiveId: z.string(),
  reason: z.enum(['confused', 'non_answer', 'already_known', 'not_actionable']),
  response: z.string(),
})

const BoundedChatAcceptedState = z.object({
  facts: z.array(AcceptedFact).default([]),
  decisions: z.array(AcceptedDecision).default([]),
  leverUpdates: z.array(z.string()).default([]),
  settingUpdates: z.array(z.string()).default([]),
  taskDrafts: z.array(z.string()).default([]),
  unresolvedForks: z.array(z.string()).default([]),
  discardedResponses: z.array(DiscardedResponse).default([]),
})

const BoundedChatClosure = z.object({
  outcome: z.enum(['fulfilled', 'blocked', 'cancelled']),
  summary: z.string(),
  settingUpdates: z.array(z.string()).default([]),
  taskDrafts: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  nextActionLabel: z.string().optional(),
  nextActionHref: z.string().optional(),
  closedAt: z.string(),
})

const BoundedChatSession = z.object({
  id: z.string(),
  projectId: z.string(),
  source: z.string(),
  objective: z.object({
    kind: BoundedChatObjectiveKind,
    label: z.string(),
    successCriteria: z.array(z.string()).default([]),
    startedAt: z.string(),
  }),
  status: BoundedChatStatus,
  activeSubObjectiveId: z.string().nullable(),
  subObjectives: z.array(BoundedChatSubObjective),
  acceptedState: BoundedChatAcceptedState.default({
    facts: [],
    decisions: [],
    leverUpdates: [],
    settingUpdates: [],
    taskDrafts: [],
    unresolvedForks: [],
    discardedResponses: [],
  }),
  pendingActions: z.array(z.string()).default([]),
  appliedActionIds: z.array(z.string()).default([]),
  plannerState: z.object({
    projectCheckIn: z.object({
      projectName: z.string(),
      askedCandidateIds: z.array(z.string()).default([]),
      answeredQuestions: z.array(z.object({
        questionId: z.string(),
        prompt: z.string(),
        answer: z.string(),
      })).default([]),
    }).optional(),
    newRequest: z.object({
      ask: z.string(),
      title: z.string().optional(),
      domain: z.string(),
      projectPath: z.string(),
      workspacePath: z.string().optional(),
      routedRequestKind: z.enum([
        'task_spec',
        'project_question',
        'settings_proposal',
        'persona_practice_proposal',
        'repair_triage',
        'clarification',
      ]),
      routingSummary: z.string(),
    }).optional(),
  }).optional(),
  closure: BoundedChatClosure.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type BoundedChatSession = z.infer<typeof BoundedChatSession>

const AskFollowUpAction = z.object({
  actionId: z.string(),
  type: z.literal('ask_follow_up'),
  subObjectiveId: z.string(),
  prompt: z.string(),
  helperText: z.string().optional(),
  choices: z.array(z.string()).optional(),
})

const CloseSessionAction = z.object({
  actionId: z.string(),
  type: z.literal('close_session'),
  outcome: z.enum(['fulfilled', 'cancelled']),
  summary: z.string(),
  facts: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  settingUpdates: z.array(z.string()).default([]),
  taskDrafts: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
})

const BlockSessionAction = z.object({
  actionId: z.string(),
  type: z.literal('block_session'),
  reason: z.string(),
  nextActionLabel: z.string(),
  nextActionHref: z.string().optional(),
})

const DiscardResponseAction = z.object({
  actionId: z.string(),
  type: z.literal('discard_response'),
  subObjectiveId: z.string(),
  reason: z.enum(['confused', 'non_answer', 'already_known', 'not_actionable']),
  replacementPrompt: z.string(),
})

const BoundedChatCoordinatorAction = z.discriminatedUnion('type', [
  AskFollowUpAction,
  CloseSessionAction,
  BlockSessionAction,
  DiscardResponseAction,
])
export type BoundedChatCoordinatorAction = z.infer<typeof BoundedChatCoordinatorAction>

const CreateBoundedChatSessionInput = z.object({
  memoryDir: z.string(),
  projectId: z.string(),
  source: z.string(),
  objective: z.object({
    kind: BoundedChatObjectiveKind,
    label: z.string(),
    successCriteria: z.array(z.string()).default([]),
  }),
  initialSubObjective: z.object({
    id: z.string(),
    objective: z.string(),
    prompt: z.string(),
    helperText: z.string().optional(),
    choices: z.array(z.string()).optional(),
  }),
})

const SubmitUserResponseInput = z.object({
  memoryDir: z.string(),
  sessionId: z.string(),
  subObjectiveId: z.string(),
  response: z.string(),
  selectedChoiceIds: z.array(z.string()).default([]),
})

const ApplyCoordinatorActionInput = z.object({
  memoryDir: z.string(),
  sessionId: z.string(),
  expectedUpdatedAt: z.string().optional(),
  action: BoundedChatCoordinatorAction,
})

const GetNextPromptInput = z.object({
  memoryDir: z.string(),
  sessionId: z.string(),
})

export type BoundedChatPromptResult =
  | {
    kind: 'ask_user'
    sessionId: string
    subObjectiveId: string
    prompt: string
    choices?: string[]
    helperText?: string
  }
  | {
    kind: 'coordinator_review'
    sessionId: string
    message: string
  }
  | {
    kind: 'done'
    sessionId: string
    receipt: NonNullable<BoundedChatSession['closure']>
  }
  | {
    kind: 'blocked'
    sessionId: string
    receipt: NonNullable<BoundedChatSession['closure']>
  }

export async function createBoundedChatSession(rawInput: z.input<typeof CreateBoundedChatSessionInput>): Promise<BoundedChatSession> {
  const input = CreateBoundedChatSessionInput.parse(rawInput)
  const now = new Date().toISOString()
  const session: BoundedChatSession = BoundedChatSession.parse({
    id: buildSessionId(input.projectId, input.objective.kind, now),
    projectId: input.projectId,
    source: input.source,
    objective: {
      ...input.objective,
      startedAt: now,
    },
    status: 'waiting_for_user',
    activeSubObjectiveId: input.initialSubObjective.id,
    subObjectives: [{
      ...input.initialSubObjective,
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
    createdAt: now,
    updatedAt: now,
  })
  await saveBoundedChatSession(input.memoryDir, session)
  return session
}

export async function loadBoundedChatSession(input: {
  memoryDir: string
  sessionId: string
}): Promise<BoundedChatSession> {
  const raw = await fsp.readFile(boundedChatPath(input.memoryDir, input.sessionId), 'utf-8')
  return BoundedChatSession.parse(JSON.parse(raw))
}

export async function saveBoundedChatSession(memoryDir: string, session: BoundedChatSession): Promise<void> {
  const parsed = BoundedChatSession.parse(session)
  const filePath = boundedChatPath(memoryDir, parsed.id)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(parsed, null, 2) + '\n')
}

export async function getNextBoundedChatPrompt(rawInput: z.input<typeof GetNextPromptInput>): Promise<BoundedChatPromptResult> {
  const input = GetNextPromptInput.parse(rawInput)
  const session = await loadBoundedChatSession(input)
  const active = getActiveSubObjective(session)
  if ((session.status === 'fulfilled' || session.status === 'cancelled') && session.closure) {
    return { kind: 'done', sessionId: session.id, receipt: session.closure }
  }
  if (session.status === 'blocked' && session.closure) {
    return { kind: 'blocked', sessionId: session.id, receipt: session.closure }
  }
  if (session.status === 'coordinator_review') {
    return {
      kind: 'coordinator_review',
      sessionId: session.id,
      message: 'Guildhall is reviewing the latest reply before it asks anything else.',
    }
  }
  if (session.status === 'waiting_for_user' && active) {
    return {
      kind: 'ask_user',
      sessionId: session.id,
      subObjectiveId: active.id,
      prompt: active.prompt,
      choices: active.choices,
      helperText: active.helperText,
    }
  }
  throw new Error(`bounded chat session ${session.id} has no visible prompt`)
}

export async function submitBoundedChatUserResponse(
  rawInput: z.input<typeof SubmitUserResponseInput>,
): Promise<BoundedChatSession> {
  const input = SubmitUserResponseInput.parse(rawInput)
  const session = await loadBoundedChatSession({ memoryDir: input.memoryDir, sessionId: input.sessionId })
  const active = getActiveSubObjective(session)
  if (session.status !== 'waiting_for_user' || !active || active.id !== input.subObjectiveId) {
    throw new Error(`sub-objective ${input.subObjectiveId} is not waiting for a user response`)
  }
  active.localTurns.push(BoundedChatTurn.parse({
    role: 'user',
    content: input.response,
    selectedChoiceIds: input.selectedChoiceIds,
  }))
  active.status = 'answered'
  session.status = 'coordinator_review'
  session.updatedAt = new Date().toISOString()
  await saveBoundedChatSession(input.memoryDir, session)
  return session
}

export async function applyBoundedChatCoordinatorAction(
  rawInput: z.input<typeof ApplyCoordinatorActionInput>,
): Promise<BoundedChatSession> {
  const input = ApplyCoordinatorActionInput.parse(rawInput)
  const session = await loadBoundedChatSession({ memoryDir: input.memoryDir, sessionId: input.sessionId })
  if (input.expectedUpdatedAt && input.expectedUpdatedAt !== session.updatedAt) {
    throw new Error(`stale bounded chat session ${session.id}`)
  }
  if (session.appliedActionIds.includes(input.action.actionId)) return session

  switch (input.action.type) {
    case 'ask_follow_up': {
      assertCoordinatorReview(session, input.action.subObjectiveId)
      const subObjective = requireSubObjective(session, input.action.subObjectiveId)
      subObjective.prompt = input.action.prompt
      subObjective.helperText = input.action.helperText
      subObjective.choices = input.action.choices
      subObjective.followUpDepth += 1
      subObjective.status = 'active'
      session.status = 'waiting_for_user'
      break
    }
    case 'discard_response': {
      assertCoordinatorReview(session, input.action.subObjectiveId)
      const subObjective = requireSubObjective(session, input.action.subObjectiveId)
      const latestTurn = latestUserTurn(subObjective)
      if (!latestTurn) throw new Error(`sub-objective ${subObjective.id} has no user response to discard`)
      session.acceptedState.discardedResponses.push({
        subObjectiveId: subObjective.id,
        reason: input.action.reason,
        response: latestTurn.content,
      })
      subObjective.prompt = input.action.replacementPrompt
      subObjective.status = 'active'
      session.status = 'waiting_for_user'
      break
    }
    case 'close_session': {
      const active = getActiveSubObjective(session)
      if (!active) throw new Error(`bounded chat session ${session.id} has no active sub-objective`)
      for (const fact of input.action.facts) {
        session.acceptedState.facts.push({
          fact,
          sourceSubObjectiveId: active.id,
        })
      }
      for (const decision of input.action.decisions) {
        session.acceptedState.decisions.push({
          decision,
          sourceSubObjectiveId: active.id,
        })
      }
      for (const update of input.action.settingUpdates) {
        if (!session.acceptedState.settingUpdates.includes(update)) {
          session.acceptedState.settingUpdates.push(update)
        }
      }
      for (const draft of input.action.taskDrafts) {
        if (!session.acceptedState.taskDrafts.includes(draft)) {
          session.acceptedState.taskDrafts.push(draft)
        }
      }
      active.status = 'answered'
      session.status = input.action.outcome
      session.activeSubObjectiveId = active.id
      session.closure = {
        outcome: input.action.outcome,
        summary: input.action.summary,
        settingUpdates: input.action.settingUpdates,
        taskDrafts: input.action.taskDrafts,
        evidence: input.action.evidence,
        closedAt: new Date().toISOString(),
      }
      break
    }
    case 'block_session': {
      const active = getActiveSubObjective(session)
      if (!active) throw new Error(`bounded chat session ${session.id} has no active sub-objective`)
      active.status = 'blocked'
      session.status = 'blocked'
      session.closure = {
        outcome: 'blocked',
        summary: input.action.reason,
        settingUpdates: [],
        taskDrafts: [],
        evidence: [],
        nextActionLabel: input.action.nextActionLabel,
        nextActionHref: input.action.nextActionHref,
        closedAt: new Date().toISOString(),
      }
      break
    }
  }

  session.appliedActionIds.push(input.action.actionId)
  session.updatedAt = new Date().toISOString()
  await saveBoundedChatSession(input.memoryDir, session)
  return session
}

export function listBoundedChatSessions(memoryDir: string): BoundedChatSession[] {
  const dir = boundedChatDir(memoryDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(file => file.endsWith('.json'))
    .map(file => {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      return BoundedChatSession.parse(JSON.parse(raw))
    })
}

export async function listBoundedChatSessionsAsync(memoryDir: string): Promise<BoundedChatSession[]> {
  const dir = boundedChatDir(memoryDir)
  const names = await fsp.readdir(dir).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  })
  const sessions = await Promise.all(
    names
      .filter(file => file.endsWith('.json'))
      .map(async (file) => {
        const raw = await readCachedJson<unknown>(path.join(dir, file)).catch(() => null)
        return raw ? BoundedChatSession.parse(raw) : null
      }),
  )
  return sessions.filter((session): session is BoundedChatSession => !!session)
}

export function boundedChatPath(memoryDir: string, sessionId: string): string {
  return path.join(boundedChatDir(memoryDir), `${sessionId}.json`)
}

function boundedChatDir(memoryDir: string): string {
  return path.join(memoryDir, 'bounded-chat')
}

function buildSessionId(projectId: string, objectiveKind: BoundedChatObjectiveKind, now: string): string {
  const slug = projectId.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()
  const stamp = now.replace(/[:.]/g, '-')
  return `bc-${slug}-${objectiveKind}-${stamp}`
}

function getActiveSubObjective(session: BoundedChatSession): BoundedChatSubObjective | undefined {
  if (!session.activeSubObjectiveId) return undefined
  return session.subObjectives.find(subObjective => subObjective.id === session.activeSubObjectiveId)
}

function requireSubObjective(session: BoundedChatSession, subObjectiveId: string): BoundedChatSubObjective {
  const subObjective = session.subObjectives.find(item => item.id === subObjectiveId)
  if (!subObjective) throw new Error(`bounded chat sub-objective ${subObjectiveId} was not found`)
  return subObjective
}

function assertCoordinatorReview(session: BoundedChatSession, subObjectiveId: string): void {
  if (session.status !== 'coordinator_review') {
    throw new Error(`bounded chat session ${session.id} is not awaiting coordinator review`)
  }
  if (session.activeSubObjectiveId !== subObjectiveId) {
    throw new Error(`bounded chat sub-objective ${subObjectiveId} is not active`)
  }
}

function latestUserTurn(subObjective: BoundedChatSubObjective): BoundedChatTurn | undefined {
  for (let index = subObjective.localTurns.length - 1; index >= 0; index -= 1) {
    const turn = subObjective.localTurns[index]
    if (turn?.role === 'user') return turn
  }
  return undefined
}
