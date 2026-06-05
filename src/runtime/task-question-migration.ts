import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteText, getProjectStateDir } from '@guildhall/sessions'
import { createOwnerInputRequest } from './owner-input-store.js'
import { normalizeLegacyOwnerQuestion } from './owner-question-normalizer.js'

export interface TaskQuestionMigrationInput {
  projectRoot: string
  projectId: string
  apply: boolean
  now?: string
}

export interface TaskQuestionMigrationResult {
  changedTasks: string[]
  createdOwnerInputRequests: string[]
  createdSessions: string[]
  affectedPaths: string[]
}

interface RawQuestion {
  id?: unknown
  kind?: unknown
  prompt?: unknown
  choices?: unknown
  answer?: unknown
  draftAnswer?: unknown
  answeredAt?: unknown
  askedBy?: unknown
  askedAt?: unknown
  [key: string]: unknown
}

interface RawTask {
  id?: unknown
  title?: unknown
  notes?: unknown
  openQuestions?: unknown
  [key: string]: unknown
}

interface QueueShape {
  lastUpdated?: unknown
  tasks: RawTask[]
  [key: string]: unknown
}

const MIGRATION_ID = '0.10.0/task-open-questions-to-bounded-chat'
const TASKS_RELATIVE_PATH = '.guildhall/TASKS.json'
const MIGRATION_AGENT_ID = `migration:${MIGRATION_ID}`

export async function migrateTaskQuestionsToBoundedChat(
  input: TaskQuestionMigrationInput,
): Promise<TaskQuestionMigrationResult> {
  const now = input.now ?? new Date().toISOString()
  const file = path.join(getProjectStateDir(input.projectRoot), 'TASKS.json')
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { changedTasks: [], createdOwnerInputRequests: [], createdSessions: [], affectedPaths: [] }
    }
    throw err
  }

  const parsed = JSON.parse(raw) as unknown
  const queue = parseQueue(parsed)
  const tasks = queue.tasks.map(task => ({ ...task }))
  const changedTasks: string[] = []
  const createdOwnerInputRequests: string[] = []
  const createdSessions: string[] = []

  for (const task of tasks) {
    const id = typeof task.id === 'string' && task.id.trim() ? task.id : null
    if (!id) continue
    const questions = Array.isArray(task.openQuestions)
      ? task.openQuestions.filter(isQuestion)
      : []
    if (questions.length === 0) continue

    if (input.apply) {
      for (const question of questions) {
        if (isAnswered(question)) {
          preserveAnsweredQuestion(task, question, now)
          continue
        }
        const questionId = questionIdFor(question, id)
        const prompt = typeof question.prompt === 'string' && question.prompt.trim()
          ? question.prompt.trim()
          : `Owner input needed for ${taskTitle(task, id)}.`
        const choices = stringArray(question.choices) ?? []
        const normalizedQuestion = normalizeLegacyOwnerQuestion({
          kind: typeof question.kind === 'string' ? question.kind : undefined,
          prompt,
          choices,
          selectionMode: selectionModeForLegacyTaskQuestion(id, prompt, choices, question),
        })
        if (!normalizedQuestion) {
          preserveInvalidQuestion(task, now, prompt)
          continue
        }
        const result = await createOwnerInputRequest({
          projectRoot: input.projectRoot,
          projectId: input.projectId,
          commandId: `${MIGRATION_ID}:${id}:${questionId}`,
          now,
          actor: MIGRATION_AGENT_ID,
          source: { kind: 'task', taskId: id, questionId },
          target: { kind: 'thread' },
          question: normalizedQuestion,
          objective: {
            kind: 'task_shaping',
            label: `Clarify ${taskTitle(task, id)}`,
            successCriteria: ['Owner answers the linked bounded-chat session.'],
          },
          sessionSource: `migration:${MIGRATION_ID}:${id}:${questionId}`,
        })
        if (!createdOwnerInputRequests.includes(result.request.id)) {
          createdOwnerInputRequests.push(result.request.id)
        }
        if (!createdSessions.includes(result.session.id)) {
          createdSessions.push(result.session.id)
        }
      }
      delete task.openQuestions
    }
    changedTasks.push(id)
  }

  if (changedTasks.length === 0) {
    return { changedTasks: [], createdOwnerInputRequests: [], createdSessions: [], affectedPaths: [] }
  }

  const affectedPaths = [TASKS_RELATIVE_PATH]
  if (createdOwnerInputRequests.length > 0) affectedPaths.push('.guildhall/owner-input')
  if (createdSessions.length > 0) affectedPaths.push('.guildhall/bounded-chat')

  if (input.apply) {
    const rewritten = Array.isArray(parsed)
      ? tasks
      : { ...queue, lastUpdated: now, tasks }
    atomicWriteText(file, `${JSON.stringify(rewritten, null, 2)}\n`)
  }

  return {
    changedTasks,
    createdOwnerInputRequests,
    createdSessions,
    affectedPaths,
  }
}

function selectionModeForLegacyTaskQuestion(
  taskId: string,
  prompt: string,
  choices: string[],
  question: Record<string, unknown>,
): 'single' | 'multiple' | undefined {
  if (question.selectionMode === 'single' || question.selectionMode === 'multiple') return question.selectionMode
  if (
    taskId === 'task-meta-intake' &&
    /meta-intake task\s+—\s+i need to:?/i.test(prompt) &&
    choices.length > 1 &&
    choices.every(choice => /\b(infer|bootstrap|draft|verify|verification|task|tasks|routing|lever)\b/i.test(choice))
  ) {
    return 'multiple'
  }
  return undefined
}

function preserveInvalidQuestion(task: RawTask, now: string, prompt: string): void {
  const content = `Skipped malformed owner question during ${MIGRATION_ID} migration because the prompt was agent narration, not an answerable question.\n\nPrompt: ${prompt}`
  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  const alreadyPreserved = notes.some(note =>
    note && typeof note === 'object' &&
    (note as { agentId?: unknown }).agentId === MIGRATION_AGENT_ID &&
    typeof (note as { content?: unknown }).content === 'string' &&
    (note as { content: string }).content.includes(prompt))
  if (!alreadyPreserved) {
    notes.push({
      agentId: MIGRATION_AGENT_ID,
      role: 'coordinator',
      content,
      timestamp: now,
    })
  }
  task.notes = notes
}

function parseQueue(parsed: unknown): QueueShape {
  if (Array.isArray(parsed)) return { tasks: parsed as RawTask[] }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { tasks?: unknown }).tasks)) {
    return parsed as QueueShape
  }
  return { tasks: [] }
}

function isQuestion(value: unknown): value is RawQuestion {
  return Boolean(value && typeof value === 'object')
}

function isAnswered(question: RawQuestion): boolean {
  return Boolean(
    typeof question.answer === 'string' && question.answer.trim() ||
    typeof question.answeredAt === 'string' && question.answeredAt.trim(),
  )
}

function preserveAnsweredQuestion(task: RawTask, question: RawQuestion, now: string): void {
  const answer = typeof question.answer === 'string' && question.answer.trim()
    ? question.answer.trim()
    : '(answer recorded without text)'
  const prompt = typeof question.prompt === 'string' && question.prompt.trim()
    ? question.prompt.trim()
    : questionIdFor(question, typeof task.id === 'string' ? task.id : 'task')
  const content = `Preserved answered owner question during ${MIGRATION_ID} migration.\n\nQuestion: ${prompt}\nAnswer: ${answer}`
  const notes = Array.isArray(task.notes) ? [...task.notes] : []
  const alreadyPreserved = notes.some(note =>
    note && typeof note === 'object' &&
    (note as { agentId?: unknown }).agentId === MIGRATION_AGENT_ID &&
    typeof (note as { content?: unknown }).content === 'string' &&
    ((note as { content: string }).content.includes(prompt) || (note as { content: string }).content.includes(answer)))
  if (!alreadyPreserved) {
    notes.push({
      agentId: MIGRATION_AGENT_ID,
      role: 'coordinator',
      content,
      timestamp: now,
    })
  }
  task.notes = notes
}

function questionIdFor(question: RawQuestion, taskId: string): string {
  if (typeof question.id === 'string' && question.id.trim()) return question.id.trim()
  const prompt = typeof question.prompt === 'string' ? question.prompt.trim() : ''
  return `question-${taskId}-${shortSlug(prompt) || 'owner-input'}`
}

function taskTitle(task: RawTask, fallback: string): string {
  return typeof task.title === 'string' && task.title.trim() ? task.title.trim() : fallback
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return values.length > 0 ? values : undefined
}

function shortSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export { MIGRATION_ID as TASK_QUESTION_MIGRATION_ID }
