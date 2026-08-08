import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
  atomicWriteText,
  emitProjectSummaryInvalidation,
  listProjectStateDirFromMemoryDir,
  listProjectStateDirFromMemoryDirAsync,
  projectRootFromMemoryDir,
  projectStatePath,
  projectStatePathFromMemoryDir,
} from '@guildhall/sessions'
import { readCachedJson } from './file-read-cache.js'
import { listBoundedChatSessions } from './bounded-chat.js'
import {
  buildProjectQuestionEvidence,
  classifyProjectAnswer,
  inferProjectMemory,
  planFollowUpForAnswer,
  planNextProjectQuestion,
  type ProjectQuestionAnswer,
  type ProjectQuestionEvidenceFile,
} from './project-question-planner.js'

const DomainStatus = z.enum([
  'seeded',
  'inspected',
  'active',
  'follow-up',
  'closeout',
  'closed',
  'deferred',
  'dropped',
  'reopened',
])

export const PressureTestQuestion = z.object({
  id: z.string(),
  domainId: z.string(),
  prompt: z.string(),
  why: z.string(),
  choices: z.array(z.string()).optional(),
  evidence: z.array(z.string()).default([]),
  askedAt: z.string(),
})
export type PressureTestQuestion = z.infer<typeof PressureTestQuestion>

const PressureTestDomain = z.object({
  id: z.string(),
  title: z.string(),
  whyItMatters: z.string(),
  status: DomainStatus,
  knownFacts: z.array(z.object({ fact: z.string(), source: z.string() })).default([]),
  openUnknowns: z.array(z.string()).default([]),
  askedQuestions: z.array(z.object({
    questionId: z.string(),
    prompt: z.string(),
    answered: z.boolean(),
    answer: z.string().optional(),
  })).default([]),
  followUpCandidates: z.array(z.string()).default([]),
  closeoutAsked: z.boolean().default(false),
  summary: z.string().optional(),
})

const ProjectQuestionPlannerMemory = z.object({
  inferredFacts: z.array(z.object({
    id: z.string(),
    text: z.string(),
    source: z.string(),
  })).default([]),
  decisions: z.array(z.object({
    id: z.string(),
    text: z.string(),
    sourceQuestionId: z.string(),
  })).default([]),
  discardedAnswers: z.array(z.object({
    questionId: z.string(),
    reason: z.enum(['confused', 'non_answer', 'already_known', 'not_actionable']),
    answer: z.string(),
  })).default([]),
  askedCandidateIds: z.array(z.string()).default([]),
})

export const PressureTestIntake = z.object({
  id: z.string(),
  rawRequest: z.string(),
  target: z.object({
    type: z.enum(['project', 'release', 'feature', 'task']),
    id: z.string(),
    title: z.string(),
  }),
  status: z.enum(['active', 'paused', 'complete']),
  activeDomainId: z.string().nullable(),
  pendingQuestion: PressureTestQuestion.nullable(),
  domains: z.array(PressureTestDomain),
  outputs: z.object({
    assumptions: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    languageMapCandidates: z.array(z.string()).default([]),
    taskSplitCandidates: z.array(z.string()).default([]),
    projectQuestionPlanner: ProjectQuestionPlannerMemory.optional(),
  }),
  handoff: z.object({
    status: z.literal('materialized'),
    taskId: z.string(),
    materializedAt: z.string(),
  }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type PressureTestIntake = z.infer<typeof PressureTestIntake>

export interface ProjectCheckInSummary {
  needed: boolean
  label: string
  title: string
  detail: string
  actionHref: string
  totalCount: number
  activeCount: number
  completedCount: number
}

export async function createPressureTestIntake(input: {
  memoryDir: string
  target: PressureTestIntake['target']
  rawRequest: string
}): Promise<PressureTestIntake> {
  const now = new Date().toISOString()
  if (input.target.type === 'project') {
    const intake = await createProjectQuestionIntake(input.memoryDir, input.target, input.rawRequest, now)
    await savePressureTestIntake(input.memoryDir, intake)
    return intake
  }
  const domains = seedDomainsForRequest(input.rawRequest)
  domains[0]!.status = 'active'
  const intake: PressureTestIntake = {
    id: `pti-${input.target.id.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
    rawRequest: input.rawRequest,
    target: input.target,
    status: 'active',
    activeDomainId: domains[0]!.id,
    pendingQuestion: firstQuestion(domains[0]!, input.target, now),
    domains,
    outputs: {
      assumptions: [],
      decisions: [],
      languageMapCandidates: [],
      taskSplitCandidates: [],
    },
    createdAt: now,
    updatedAt: now,
  }
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}

export async function loadPressureTestIntake(input: {
  memoryDir: string
  intakeId: string
}): Promise<PressureTestIntake> {
  const raw = await readManagedTextFile(pressureTestPath(input.memoryDir, input.intakeId), 'utf-8')
  return normalizePressureTestIntake(PressureTestIntake.parse(JSON.parse(raw)))
}

export async function savePressureTestIntake(
  memoryDir: string,
  intake: PressureTestIntake,
): Promise<void> {
  const filePath = pressureTestPath(memoryDir, intake.id)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(intake, null, 2) + '\n')
  emitProjectSummaryInvalidation(projectRootFromMemoryDir(memoryDir), 'pressure-test-write', { domains: ['thread'] })
}

export async function answerPressureTestQuestion(input: {
  memoryDir: string
  intakeId: string
  questionId: string
  answer: string
}): Promise<PressureTestIntake> {
  const intake = await loadPressureTestIntake({
    memoryDir: input.memoryDir,
    intakeId: input.intakeId,
  })
  if (intake.target.type === 'project') {
    return answerProjectQuestion(input.memoryDir, intake, input.questionId, input.answer)
  }
  const domain = intake.domains.find(d => d.id === intake.activeDomainId)
  if (!domain || !intake.pendingQuestion || intake.pendingQuestion.id !== input.questionId) {
    throw new Error(`Question ${input.questionId} is not pending`)
  }

  domain.askedQuestions.push({
    questionId: input.questionId,
    prompt: intake.pendingQuestion.prompt,
    answered: true,
    answer: input.answer,
  })

  const now = new Date().toISOString()
  if (domain.status === 'closeout' && isCloseoutComplete(input.answer)) {
    domain.status = 'closed'
    domain.summary = summarizeDomain(domain)
    for (const candidate of extractLanguageMapCandidates(domain)) {
      if (!intake.outputs.languageMapCandidates.includes(candidate)) {
        intake.outputs.languageMapCandidates.push(candidate)
      }
    }
    const nextDomain = intake.domains.find(d => d.status === 'seeded' || d.status === 'inspected')
    if (nextDomain) {
      nextDomain.status = 'active'
      intake.activeDomainId = nextDomain.id
      intake.pendingQuestion = firstQuestion(nextDomain, intake.target, now)
    } else {
      intake.status = 'complete'
      intake.activeDomainId = null
      intake.pendingQuestion = null
    }
  } else if (needsConcreteFollowUp(input.answer)) {
    domain.status = 'follow-up'
    intake.pendingQuestion = followUpQuestion(domain, intake.target, now, domain.askedQuestions.length + 1)
  } else {
    domain.status = 'closeout'
    domain.closeoutAsked = true
    intake.pendingQuestion = {
      id: `${domain.id}-closeout`,
      domainId: domain.id,
      prompt: `Is there anything else Guildhall should know about ${domain.title.toLowerCase()} before we move to the next topic?`,
      why: 'Guildhall asks this before leaving a topic so hidden constraints do not vanish.',
      evidence: domain.knownFacts.map(f => `${f.source}: ${f.fact}`),
      askedAt: now,
    }
  }

  intake.updatedAt = now
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}

export async function inspectPressureTestEvidence(input: {
  memoryDir: string
  intakeId: string
  projectPath: string
}): Promise<PressureTestIntake> {
  const intake = await loadPressureTestIntake({
    memoryDir: input.memoryDir,
    intakeId: input.intakeId,
  })
  const facts = await inspectEvidenceFiles(input.memoryDir, input.projectPath)
  for (const fact of facts) {
    const domain = chooseDomainForFact(intake, fact.fact)
    if (!domain) continue
    if (!domain.knownFacts.some(existing => existing.fact === fact.fact && existing.source === fact.source)) {
      domain.knownFacts.push(fact)
    }
    if (domain.status === 'seeded') domain.status = 'inspected'
  }
  const active = intake.domains.find(domain => domain.id === intake.activeDomainId)
  if (active && intake.pendingQuestion) {
    intake.pendingQuestion = {
      ...intake.pendingQuestion,
      evidence: active.knownFacts.map(fact => `${fact.source}: ${fact.fact}`),
    }
  }
  intake.updatedAt = new Date().toISOString()
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}

export function listPressureTestIntakes(memoryDir: string): PressureTestIntake[] {
  return listProjectStateDirFromMemoryDir(memoryDir, 'pressure-test-intake')
    .filter(name => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const raw = JSON.parse(readManagedTextFileSync(projectStatePathFromMemoryDir(memoryDir, path.join('pressure-test-intake', name)), 'utf-8'))
        return [normalizePressureTestIntake(PressureTestIntake.parse(raw))]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export async function listPressureTestIntakesAsync(memoryDir: string): Promise<PressureTestIntake[]> {
  const names = await listProjectStateDirFromMemoryDirAsync(memoryDir, 'pressure-test-intake')
  const intakes = await Promise.all(
    names
      .filter(name => name.endsWith('.json'))
      .map(async (name) => {
        const raw = await readCachedJson<unknown>(projectStatePathFromMemoryDir(memoryDir, path.join('pressure-test-intake', name))).catch(() => null)
        if (!raw) return null
        try {
          return normalizePressureTestIntake(PressureTestIntake.parse(raw))
        } catch {
          return null
        }
      }),
  )
  return intakes
    .filter((intake): intake is PressureTestIntake => !!intake)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function summarizeProjectCheckIn(memoryDir: string): ProjectCheckInSummary {
  const intakes = listPressureTestIntakes(memoryDir)
  const chats = listBoundedChatSessions(memoryDir)
    .filter(session => session.objective.kind === 'project_check_in' || session.objective.kind === 'project_intake')
  const activeCount =
    intakes.filter(intake => intake.status === 'active').length +
    chats.filter(chat => chat.status === 'waiting_for_owner' || chat.status === 'coordinator_review').length
  const completedCount =
    intakes.filter(intake => intake.status === 'complete').length +
    chats.filter(chat => chat.status === 'fulfilled').length
  const needed = intakes.length === 0 && chats.length === 0
  return {
    needed,
    label: 'Project questions',
    title: needed
      ? 'Run project check-in'
      : activeCount > 0
        ? 'Project questions in progress'
        : 'Project questions answered',
    detail: needed
      ? 'Guildhall has not generated the first project questions yet. Start the check-in pass so it can ask one clear question at a time.'
      : activeCount > 0
        ? 'Keep answering the current project questions in Thread.'
        : 'Guildhall has already recorded project-level answers for this workspace.',
    actionHref: '/thread',
    totalCount: intakes.length,
    activeCount,
    completedCount,
  }
}

export function renderPressureTestSpec(intake: PressureTestIntake): string {
  const covered = intake.domains.filter(d => d.status === 'closed' || d.summary)
  const deferrals = intake.domains.filter(d => d.status === 'deferred')
  const domainSummary = (id: string, fallback: string) =>
    intake.domains.find(domain => domain.id === id)?.summary ?? fallback
  return [
    `# ${intake.target.title}`,
    '',
    '## Domain Coverage',
    ...(covered.length
      ? covered.map(d => `- **${d.title}:** ${d.summary ?? 'Covered by intake.'}`)
      : ['- No domains have been closed yet.']),
    '',
    '## Assumptions And Deferrals',
    ...intake.outputs.assumptions.map(a => `- ${a}`),
    ...(deferrals.length ? deferrals.map(d => `- **${d.title}:** deferred`) : ['- No deferred domains.']),
    '',
    '## Task Boundaries',
    domainSummary('task-boundaries', 'Task boundaries must be small enough to build, verify, and review without losing the approved owner intent.'),
    '',
    '## Verification And TDD',
    domainSummary('verification-tdd', 'The implementation plan must name the tests, commands, manual checks, or review proof needed before work starts.'),
    '',
    '## Design Quality',
    domainSummary('design-quality', 'For UI work, the spec must name the design-system source or compact foundation, interaction patterns, palette direction, visual hierarchy, state coverage, and rendered proof needed before implementation can be trusted.'),
    '',
    '## Reviewer Lenses',
    domainSummary('review-lenses', 'The review plan must name the expert lenses or rubrics needed to catch gaps before closure.'),
    '',
    '## Acceptance Criteria',
    '- Given the accepted intake, when a worker starts implementation, then it can identify the user workflow, non-goals, risks, and verification path without guessing.',
    '- Given a reviewer inspects this work, when it checks the spec, then every pressure-tested domain is summarized or explicitly deferred.',
  ].join('\n')
}

export function pressureTestPath(memoryDir: string, intakeId: string): string {
  return projectStatePathFromMemoryDir(memoryDir, path.join('pressure-test-intake', `${intakeId}.json`))
}

function pressureTestDir(memoryDir: string): string {
  return projectStatePathFromMemoryDir(memoryDir, 'pressure-test-intake')
}

async function createProjectQuestionIntake(
  memoryDir: string,
  target: PressureTestIntake['target'],
  rawRequest: string,
  now: string,
): Promise<PressureTestIntake> {
  const files = await loadProjectQuestionEvidenceFiles(memoryDir)
  const projectName = cleanProjectCheckInTitle(target.title)
  const evidence = buildProjectQuestionEvidence({
    projectId: target.id,
    projectName,
    files,
    currentAnswers: [],
  })
  const memory = inferProjectMemory(evidence)
  const plan = planNextProjectQuestion({
    evidence,
    answeredQuestions: [],
    askedCandidateIds: [],
  })
  return {
    id: `pti-${target.id.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
    rawRequest,
    target,
    status: plan.kind === 'ask' ? 'active' : 'complete',
    activeDomainId: plan.kind === 'ask' ? 'project-planner' : null,
    pendingQuestion: plan.kind === 'ask'
      ? {
          id: plan.question.id,
          domainId: 'project-planner',
          prompt: plan.question.prompt,
          why: plan.question.why,
          choices: plan.question.choices,
          evidence: plan.question.evidence,
          askedAt: now,
        }
      : null,
    domains: seedDomains(),
    outputs: {
      assumptions: [],
      decisions: [],
      languageMapCandidates: [],
      taskSplitCandidates: [],
      projectQuestionPlanner: {
        inferredFacts: memory.inferredFacts,
        decisions: [],
        discardedAnswers: [],
        askedCandidateIds: plan.kind === 'ask' ? [plan.question.id] : [],
      },
    },
    createdAt: now,
    updatedAt: now,
  }
}

async function answerProjectQuestion(
  memoryDir: string,
  intake: PressureTestIntake,
  questionId: string,
  answer: string,
): Promise<PressureTestIntake> {
  if (!intake.pendingQuestion || intake.pendingQuestion.id !== questionId) {
    throw new Error(`Question ${questionId} is not pending`)
  }

  const now = new Date().toISOString()
  const currentAnswer: ProjectQuestionAnswer = {
    questionId,
    prompt: intake.pendingQuestion.prompt,
    answer,
  }
  const planner = intake.outputs.projectQuestionPlanner ?? {
    inferredFacts: [],
    decisions: [],
    discardedAnswers: [],
    askedCandidateIds: [],
  }
  const classification = classifyProjectAnswer(currentAnswer)
  if (classification.kind === 'decision') {
    planner.decisions.push({
      id: `${questionId}-decision`,
      text: classification.text,
      sourceQuestionId: questionId,
    })
    if (!intake.outputs.decisions.includes(classification.text)) {
      intake.outputs.decisions.push(classification.text)
    }
  } else {
    planner.discardedAnswers.push({
      questionId,
      reason: classification.reason,
      answer,
    })
    intake.status = 'active'
    intake.activeDomainId = 'project-planner'
    intake.outputs.projectQuestionPlanner = planner
    intake.updatedAt = now
    await savePressureTestIntake(memoryDir, intake)
    return intake
  }

  const followUp = planFollowUpForAnswer(currentAnswer)
  if (followUp.kind === 'ask' && !planner.askedCandidateIds.includes(followUp.question.id)) {
    planner.askedCandidateIds.push(followUp.question.id)
    intake.status = 'active'
    intake.activeDomainId = 'project-planner'
    intake.pendingQuestion = {
      id: followUp.question.id,
      domainId: 'project-planner',
      prompt: followUp.question.prompt,
      why: followUp.question.why,
      choices: followUp.question.choices,
      evidence: followUp.question.evidence,
      askedAt: now,
    }
  } else {
    const files = await loadProjectQuestionEvidenceFiles(memoryDir)
    const answeredQuestions = planner.decisions.map(decision => ({
      questionId: decision.sourceQuestionId,
      prompt: '',
      answer: decision.text,
    }))
    const evidence = buildProjectQuestionEvidence({
      projectId: intake.target.id,
      projectName: cleanProjectCheckInTitle(intake.target.title),
      files,
      currentAnswers: answeredQuestions,
    })
    const next = planNextProjectQuestion({
      evidence,
      answeredQuestions,
      askedCandidateIds: planner.askedCandidateIds,
    })
    if (next.kind === 'ask') {
      planner.askedCandidateIds.push(next.question.id)
      intake.status = 'active'
      intake.activeDomainId = 'project-planner'
      intake.pendingQuestion = {
        id: next.question.id,
        domainId: 'project-planner',
        prompt: next.question.prompt,
        why: next.question.why,
        choices: next.question.choices,
        evidence: next.question.evidence,
        askedAt: now,
      }
    } else {
      intake.status = 'complete'
      intake.activeDomainId = null
      intake.pendingQuestion = null
    }
  }

  intake.outputs.projectQuestionPlanner = planner
  intake.updatedAt = now
  await savePressureTestIntake(memoryDir, intake)
  return intake
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
        text: await readManagedTextFile(candidate.file, 'utf-8'),
      })
    } catch {
      // Missing project evidence files are normal for fresh projects.
    }
  }
  return files
}

function cleanProjectCheckInTitle(title: string): string {
  return title.replace(/\s+project check-in$/i, '')
}

function seedDomains(): Array<z.infer<typeof PressureTestDomain>> {
  return [
    {
      id: 'product-goals',
      title: 'Product goals',
      whyItMatters: 'A clear goal helps Guildhall shape work around the result you actually want.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['What must this intake make clearer than the current flow?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'workflows',
      title: 'Workflows',
      whyItMatters: 'Thread, Work, and Needs You should reveal the right next action without hidden state.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['Where should the user see, answer, and resume the intake?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'design-quality',
      title: 'Design quality',
      whyItMatters: 'UI work should reach an app-store-caliber result, not merely a functional one.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: [
        'Which design system, component catalog, or compact foundation should the worker use?',
        'Which interaction patterns match the user jobs, especially filters, toggles, navigation, and destructive actions?',
        'What palette mood, semantic color roles, saturation budget, and visual proof should reviewers inspect?',
      ],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'task-boundaries',
      title: 'Task boundaries',
      whyItMatters: 'Guildhall needs work slices small enough to build, verify, and review without losing the bigger goal.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['What should be split, deferred, or kept together so quality does not depend on one oversized task?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'acceptance-criteria',
      title: 'Acceptance criteria',
      whyItMatters: 'Workers and reviewers need concrete proof points before implementation starts.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['What observable outcomes prove this work is complete?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'verification-tdd',
      title: 'Verification and TDD',
      whyItMatters: 'Guildhall should know how to prove the work and where tests should lead the implementation.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['Which test, command, manual check, or proof packet should fail before the fix and pass after it?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'review-lenses',
      title: 'Reviewer lenses',
      whyItMatters: 'Different expert reviews catch different misses, so Guildhall should choose review pressure before closure.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['Which expert lenses should inspect this work before it is trusted?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
    {
      id: 'risks',
      title: 'Risks and non-goals',
      whyItMatters: 'The spec needs clear boundaries so Guildhall does not turn every request into ceremony.',
      status: 'seeded',
      knownFacts: [],
      openUnknowns: ['Which failure modes would make this feel worse than current task intake?'],
      askedQuestions: [],
      followUpCandidates: [],
      closeoutAsked: false,
    },
  ]
}

function seedDomainsForRequest(rawRequest: string): Array<z.infer<typeof PressureTestDomain>> {
  const domains = seedDomains()
  if (!isNonUiRuntimeRequest(rawRequest) || requestsUiGuidance(rawRequest)) {
    return domains
  }
  return domains.filter(domain => domain.id !== 'design-quality')
}

function isNonUiRuntimeRequest(rawRequest: string): boolean {
  return /\b(api|endpoint|membership|cli|command|--json|inspect|docs?|quick start|install warning|migration|schema|rollback|bugfix|duplicate rows?)\b/i.test(rawRequest)
}

function requestsUiGuidance(rawRequest: string): boolean {
  return /\b(ui|web app|browser|component|drawer|palette|visual|screen|modal|card|layout|frontend|settings footer)\b/i.test(rawRequest)
}

function firstQuestion(
  domain: z.infer<typeof PressureTestDomain>,
  target: PressureTestIntake['target'],
  askedAt: string,
): PressureTestQuestion {
  return {
    id: `${domain.id}-q-1`,
    domainId: domain.id,
    prompt: firstQuestionPrompt(domain.title, target),
    why: domain.whyItMatters,
    evidence: domain.knownFacts.map(f => `${f.source}: ${f.fact}`),
    askedAt,
  }
}

function firstQuestionPrompt(domainTitle: string, target: PressureTestIntake['target']): string {
  if (target.type === 'project') {
    return projectCheckInQuestionPrompt(domainTitle)
  }

  const targetLabel = `"${target.title}"`
  switch (domainTitle.toLowerCase()) {
    case 'product goals':
      return `For ${targetLabel}, what outcome should this request achieve?`
    case 'workflows':
      return `For ${targetLabel}, what workflow or user path should Guildhall understand before splitting the work?`
    case 'design quality':
      return `For ${targetLabel}, what design-system source, interaction pattern, palette direction, or visual proof would make the result feel shippable?`
    case 'task boundaries':
      return `For ${targetLabel}, what should stay in this work, and what should split into a separate task or deferral?`
    case 'acceptance criteria':
      return `For ${targetLabel}, what observable result would prove the work is complete?`
    case 'verification and tdd':
      return `For ${targetLabel}, what test, command, or review proof should verify the work?`
    case 'reviewer lenses':
      return `For ${targetLabel}, which expert concerns should reviewers inspect before Guildhall calls it done?`
    case 'risks and non-goals':
      return `For ${targetLabel}, what risk, boundary, or non-goal should Guildhall keep in mind?`
    default:
      return `What should Guildhall understand first about ${targetLabel}?`
  }
}

function followUpQuestion(
  domain: z.infer<typeof PressureTestDomain>,
  target: PressureTestIntake['target'],
  askedAt: string,
  index: number,
): PressureTestQuestion {
  return {
    id: `${domain.id}-q-${index}`,
    domainId: domain.id,
    prompt: followUpQuestionPrompt(domain.id, target),
    why: followUpQuestionWhy(domain.id),
    evidence: domain.knownFacts.map(f => `${f.source}: ${f.fact}`),
    askedAt,
  }
}

function followUpQuestionPrompt(domainId: string, target: PressureTestIntake['target']): string {
  if (target.type === 'project') {
    switch (domainId) {
      case 'product-goals':
        return 'What observable result would tell you this project is succeeding?'
      case 'workflows':
        return 'What concrete user path or routine should Guildhall preserve while planning this project?'
      case 'design-quality':
        return "What should a worker or reviewer be able to see before Guildhall treats this project's visual direction as met?"
      case 'task-boundaries':
        return 'What is one concrete example of work that belongs here, and one example that should split out?'
      case 'acceptance-criteria':
        return 'What specific evidence would prove a task in this project is finished?'
      case 'verification-tdd':
        return 'What command, test, or manual check should Guildhall expect before trusting project work?'
      case 'review-lenses':
        return 'What kind of expert review would catch the misses you care about most?'
      case 'risks':
        return 'What concrete failure should Guildhall avoid while shaping work for this project?'
      default:
        return 'What concrete example should Guildhall remember for this project?'
    }
  }

  const targetLabel = `"${target.title}"`
  switch (domainId) {
    case 'product-goals':
      return `For ${targetLabel}, what observable result would show the work succeeded?`
    case 'workflows':
      return `For ${targetLabel}, what concrete user path or workflow should the worker preserve?`
    case 'design-quality':
      return `For ${targetLabel}, what should a reviewer be able to see before calling the visual direction met?`
    case 'task-boundaries':
      return `For ${targetLabel}, what is one concrete example of work that belongs here, and one that should split out?`
    case 'acceptance-criteria':
      return `For ${targetLabel}, what specific evidence would prove the work is finished?`
    case 'verification-tdd':
      return `For ${targetLabel}, what command, test, or manual check should verify the result?`
    case 'review-lenses':
      return `For ${targetLabel}, what expert review would catch the misses that matter most?`
    case 'risks':
      return `For ${targetLabel}, what concrete failure should Guildhall avoid?`
    default:
      return `For ${targetLabel}, what concrete example should Guildhall remember?`
  }
}

function followUpQuestionWhy(domainId: string): string {
  switch (domainId) {
    case 'design-quality':
      return 'Workers and reviewers need visible proof, not just a taste adjective.'
    case 'verification-tdd':
      return 'Guildhall needs a proof path it can hand to workers and reviewers.'
    case 'task-boundaries':
      return 'Concrete examples help Guildhall split work without inventing scope.'
    default:
      return 'Guildhall needs one observable example so future work can use this answer.'
  }
}

function projectCheckInQuestionPrompt(domainTitle: string): string {
  switch (domainTitle.toLowerCase()) {
    case 'product goals':
      return 'What outcome would make this project successful?'
    case 'workflows':
      return 'What workflow or day-to-day constraint should Guildhall understand about this project?'
    case 'design quality':
      return 'What design-system source, interaction pattern, palette direction, or visual proof should Guildhall remember for this project?'
    case 'task boundaries':
      return 'What work should Guildhall keep together here, and what should become a separate task or deferral?'
    case 'acceptance criteria':
      return 'What observable result would prove this project work is complete?'
    case 'verification and tdd':
      return 'What test, command, or review proof should Guildhall use to verify this project work?'
    case 'reviewer lenses':
      return 'Which expert concerns should Guildhall review before trusting this project work?'
    case 'risks and non-goals':
      return 'What risk, boundary, or non-goal should Guildhall remember for this project?'
    default:
      return 'What should Guildhall understand first about this project?'
  }
}

function normalizePressureTestIntake(intake: PressureTestIntake): PressureTestIntake {
  const active = intake.domains.find(domain => domain.id === intake.activeDomainId)
  if (active && intake.pendingQuestion?.id === `${active.id}-q-1`) {
    const replacement = firstQuestion(active, intake.target, intake.pendingQuestion.askedAt)
    if (intake.pendingQuestion.prompt !== replacement.prompt) {
      intake = {
        ...intake,
        pendingQuestion: {
          ...intake.pendingQuestion,
          prompt: replacement.prompt,
        },
      }
    }
  }

  const pendingDomain = intake.domains.find(domain => domain.id === intake.pendingQuestion?.domainId)
  const normalizedPendingQuestion = intake.pendingQuestion
    ? normalizeQuestionCopy(intake.pendingQuestion, pendingDomain, intake.target)
    : intake.pendingQuestion
  const normalizedDomains = intake.domains.map(domain => ({
    ...domain,
    askedQuestions: domain.askedQuestions.map(question => normalizeQuestionCopy(question, domain, intake.target)),
  }))
  if (normalizedPendingQuestion !== intake.pendingQuestion || normalizedDomains.some((domain, index) => domain !== intake.domains[index])) {
    intake = {
      ...intake,
      pendingQuestion: normalizedPendingQuestion,
      domains: normalizedDomains,
    }
  }

  if (intake.target.type === 'project') {
    const planner = intake.outputs.projectQuestionPlanner ?? {
      inferredFacts: [],
      decisions: [],
      discardedAnswers: [],
      askedCandidateIds: [],
    }
    const repairedDomains = intake.domains.map(domain => {
      const repairedQuestions = domain.askedQuestions.map(question => {
        if (question.answered && question.answer) {
          const classification = classifyProjectAnswer({
            questionId: question.questionId,
            prompt: question.prompt,
            answer: question.answer,
          })
          if (classification.kind === 'discard' && !planner.discardedAnswers.some(existing => existing.questionId === question.questionId)) {
            planner.discardedAnswers.push({
              questionId: question.questionId,
              reason: classification.reason,
              answer: question.answer,
            })
          }
        }
        return question
      })
      return {
        ...domain,
        askedQuestions: repairedQuestions,
        ...(domain.summary && isConfusedProjectSummary(domain.summary) ? { summary: undefined } : {}),
      }
    })
    intake = {
      ...intake,
      domains: repairedDomains,
      outputs: {
        ...intake.outputs,
        languageMapCandidates: intake.outputs.languageMapCandidates.filter(candidate => !/^Hmm I:/.test(candidate)),
        projectQuestionPlanner: planner,
      },
    }
  }

  return intake
}

function normalizeQuestionCopy<T extends { prompt: string; why?: string }>(
  question: T,
  domain: z.infer<typeof PressureTestDomain> | undefined,
  target: PressureTestIntake['target'],
): T {
  let prompt = question.prompt
    .replace(/before this domain closes\?/g, 'before we move to the next topic?')
    .replace(/before the domain closes\?/g, 'before we move to the next topic?')
  let why = question.why?.replace(
    /Pressure-test intake closes each domain deliberately so hidden constraints do not vanish\./g,
    'Guildhall asks this before leaving a topic so hidden constraints do not vanish.',
  )
  if (domain && /^What is one concrete example or threshold that would make "[\s\S]+" true for [\s\S]+\?$/.test(prompt)) {
    prompt = followUpQuestionPrompt(domain.id, target)
    why = followUpQuestionWhy(domain.id)
  }
  if (prompt === question.prompt && why === question.why) return question
  return {
    ...question,
    prompt,
    ...(why === undefined ? {} : { why }),
  }
}

function needsConcreteFollowUp(answer: string): boolean {
  return /\b(rigorous|annoying|fast|safe|simple|good|strict|polished|clear|friendly|better|worse)\b/i.test(answer)
}

function isConfusedProjectSummary(summary: string): boolean {
  return /\b(i do not understand|i don't understand|nature of the question|confusing)\b/i.test(summary)
}

function isCloseoutComplete(answer: string): boolean {
  return /^(no|nope|nothing|none|not right now)\.?$/i.test(answer.trim()) || answer.trim().length > 0
}

function summarizeDomain(domain: z.infer<typeof PressureTestDomain>): string {
  const substantive = domain.askedQuestions
    .filter(question => question.answered && question.answer && !question.questionId.endsWith('closeout'))
    .map(question => question.answer!.trim())
  return substantive[0] ?? 'Closed with no additional domain notes.'
}

function extractLanguageMapCandidates(domain: z.infer<typeof PressureTestDomain>): string[] {
  const text = domain.askedQuestions.map(question => question.answer ?? '').join(' ')
  const terms = Array.from(text.matchAll(/\b([A-Z][A-Za-z0-9-]*(?:\s+[A-Z][A-Za-z0-9-]*)*)\b/g))
    .map(match => match[1]?.trim())
    .filter((term): term is string => Boolean(term && term.length >= 4))
    .filter(term => !['Guildhall'].includes(term))
  return [...new Set(terms)].map(term => `${term}: candidate from ${domain.title} intake answer`)
}

async function inspectEvidenceFiles(memoryDir: string, projectPath: string): Promise<Array<{ fact: string; source: string }>> {
  const candidates = [
    { file: projectStatePathFromMemoryDir(memoryDir, 'project-brief.md'), source: 'memory/project-brief.md' },
    { file: path.join(projectPath, 'README.md'), source: 'README.md' },
    { file: path.join(projectPath, 'docs', 'README.md'), source: 'docs/README.md' },
  ]
  const facts: Array<{ fact: string; source: string }> = []
  for (const candidate of candidates) {
    try {
      const raw = await readManagedTextFile(candidate.file, 'utf-8')
      const sentence = raw
        .split(/(?<=[.!?])\s+/)
        .map(line => line.trim().replace(/\s+/g, ' '))
        .find(line => line.length >= 20 && line.length <= 220)
      if (sentence) facts.push({ fact: sentence, source: candidate.source })
    } catch {
      // Missing evidence files are normal for fresh projects.
    }
  }
  return facts
}

function chooseDomainForFact(
  intake: PressureTestIntake,
  _fact: string,
): z.infer<typeof PressureTestDomain> | undefined {
  // Domain routing is durable intake state. Do not guess it from a model's
  // wording or from a domain title; the active domain is the explicit owner
  // of the fact, and the first domain is the deterministic seed fallback.
  return intake.domains.find(domain => domain.id === intake.activeDomainId) ??
    intake.domains[0]
}
