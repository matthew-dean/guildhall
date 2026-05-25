import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { atomicWriteText } from '@guildhall/sessions'

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
  }),
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
  const domains = seedDomains()
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
  const raw = await fsp.readFile(pressureTestPath(input.memoryDir, input.intakeId), 'utf-8')
  return normalizePressureTestIntake(PressureTestIntake.parse(JSON.parse(raw)))
}

export async function savePressureTestIntake(
  memoryDir: string,
  intake: PressureTestIntake,
): Promise<void> {
  const filePath = pressureTestPath(memoryDir, intake.id)
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  atomicWriteText(filePath, JSON.stringify(intake, null, 2) + '\n')
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
    intake.pendingQuestion = {
      id: `${domain.id}-q-${domain.askedQuestions.length + 1}`,
      domainId: domain.id,
      prompt: `What is one concrete example or threshold that would make "${input.answer}" true for ${intake.target.title}?`,
      why: 'The answer names a quality bar, but workers need an observable example or threshold.',
      evidence: domain.knownFacts.map(f => `${f.source}: ${f.fact}`),
      askedAt: now,
    }
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
  const dir = pressureTestDir(memoryDir)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.json'))
    .flatMap((name) => {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'))
        return [normalizePressureTestIntake(PressureTestIntake.parse(raw))]
      } catch {
        return []
      }
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
}

export function summarizeProjectCheckIn(memoryDir: string): ProjectCheckInSummary {
  const intakes = listPressureTestIntakes(memoryDir)
  const activeCount = intakes.filter(intake => intake.status === 'active').length
  const completedCount = intakes.filter(intake => intake.status === 'complete').length
  const needed = intakes.length === 0
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
    '## Acceptance Criteria',
    '- Given the accepted intake, when a worker starts implementation, then it can identify the user workflow, non-goals, risks, and verification path without guessing.',
    '- Given a reviewer inspects this work, when it checks the spec, then every pressure-tested domain is summarized or explicitly deferred.',
  ].join('\n')
}

export function pressureTestPath(memoryDir: string, intakeId: string): string {
  return path.join(pressureTestDir(memoryDir), `${intakeId}.json`)
}

function pressureTestDir(memoryDir: string): string {
  return path.join(memoryDir, 'pressure-test-intake')
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
    case 'risks and non-goals':
      return `For ${targetLabel}, what risk, boundary, or non-goal should Guildhall keep in mind?`
    default:
      return `What should Guildhall understand first about ${targetLabel}?`
  }
}

function projectCheckInQuestionPrompt(domainTitle: string): string {
  switch (domainTitle.toLowerCase()) {
    case 'product goals':
      return 'What outcome would make this project successful?'
    case 'workflows':
      return 'What workflow or day-to-day constraint should Guildhall understand about this project?'
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

  const normalizedPendingQuestion = intake.pendingQuestion
    ? normalizeCloseoutQuestionCopy(intake.pendingQuestion)
    : intake.pendingQuestion
  const normalizedDomains = intake.domains.map(domain => ({
    ...domain,
    askedQuestions: domain.askedQuestions.map(normalizeCloseoutQuestionCopy),
  }))
  if (normalizedPendingQuestion !== intake.pendingQuestion || normalizedDomains.some((domain, index) => domain !== intake.domains[index])) {
    intake = {
      ...intake,
      pendingQuestion: normalizedPendingQuestion,
      domains: normalizedDomains,
    }
  }

  return intake
}

function normalizeCloseoutQuestionCopy<T extends { prompt: string; why?: string }>(question: T): T {
  const prompt = question.prompt
    .replace(/before this domain closes\?/g, 'before we move to the next topic?')
    .replace(/before the domain closes\?/g, 'before we move to the next topic?')
  const why = question.why?.replace(
    /Pressure-test intake closes each domain deliberately so hidden constraints do not vanish\./g,
    'Guildhall asks this before leaving a topic so hidden constraints do not vanish.',
  )
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
    { file: path.join(memoryDir, 'project-brief.md'), source: 'memory/project-brief.md' },
    { file: path.join(projectPath, 'README.md'), source: 'README.md' },
    { file: path.join(projectPath, 'docs', 'README.md'), source: 'docs/README.md' },
  ]
  const facts: Array<{ fact: string; source: string }> = []
  for (const candidate of candidates) {
    try {
      const raw = await fsp.readFile(candidate.file, 'utf-8')
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
  fact: string,
): z.infer<typeof PressureTestDomain> | undefined {
  const lower = fact.toLowerCase()
  return intake.domains.find(domain => domain.id === intake.activeDomainId) ??
    intake.domains.find(domain => lower.includes(domain.title.toLowerCase().split(' ')[0] ?? '')) ??
    intake.domains[0]
}
