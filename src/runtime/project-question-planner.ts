export interface ProjectQuestionEvidenceFile {
  path: string
  text: string
}

export interface ProjectQuestionAnswer {
  questionId: string
  prompt: string
  answer: string
}

export interface ProjectQuestionEvidenceInput {
  projectId: string
  projectName: string
  files: ProjectQuestionEvidenceFile[]
  currentAnswers: ProjectQuestionAnswer[]
}

export interface ProjectFact {
  id: string
  text: string
  source: string
}

export interface ProjectCurrentWork {
  id: string
  title: string
  description?: string | undefined
}

export interface ProjectQuestionEvidence {
  projectId: string
  projectName: string
  facts: ProjectFact[]
  currentWork: ProjectCurrentWork[]
  currentAnswers: ProjectQuestionAnswer[]
}

export interface InferredProjectMemory {
  inferredFacts: ProjectFact[]
}

export interface ProjectQuestionCandidate {
  id: string
  prompt: string
  why: string
  choices?: string[] | undefined
  changes: Array<'priority' | 'scope' | 'review' | 'product_direction'>
  evidence: string[]
  score: number
}

export type ProjectQuestionPlan =
  | { kind: 'ask'; question: ProjectQuestionCandidate }
  | { kind: 'complete'; reason: string }

export type ProjectAnswerClassification =
  | { kind: 'decision'; text: string }
  | { kind: 'discard'; reason: 'confused' | 'non_answer' | 'already_known' | 'not_actionable' }

export type ProjectFollowUpPlan =
  | { kind: 'ask'; question: ProjectQuestionCandidate }
  | { kind: 'none'; reason: string }

export function buildProjectQuestionEvidence(input: ProjectQuestionEvidenceInput): ProjectQuestionEvidence {
  return {
    projectId: input.projectId,
    projectName: input.projectName,
    facts: input.files.flatMap(extractFactsFromFile),
    currentWork: input.files.flatMap(extractCurrentWorkFromFile),
    currentAnswers: input.currentAnswers,
  }
}

export function inferProjectMemory(evidence: ProjectQuestionEvidence): InferredProjectMemory {
  const wanted = [
    'fiction-writing software',
    'coherent novel',
    'author voice',
    'reader experience',
    'quiet',
    'quiet UI',
    'commercial editor direction',
    'commercial direction',
    'print-quality',
    'reviewer',
    'reader knowledge',
    'imagined-world coherence',
  ]
  const inferredFacts = evidence.facts.filter(fact =>
    wanted.some(term => fact.text.toLowerCase().includes(term.toLowerCase())),
  )
  return { inferredFacts: uniqueFacts(inferredFacts) }
}

export function planNextProjectQuestion(input: {
  evidence: ProjectQuestionEvidence
  answeredQuestions: ProjectQuestionAnswer[]
  askedCandidateIds: string[]
}): ProjectQuestionPlan {
  const memory = inferProjectMemory(input.evidence)
  const candidates = generateCandidates(input.evidence, memory)
    .filter(candidate => !input.askedCandidateIds.includes(candidate.id))
    .filter(candidate => !isAnswered(candidate, input.answeredQuestions))
    .filter(candidate => candidate.changes.length > 0)
    .sort((left, right) => right.score - left.score)

  const best = candidates[0]
  if (!best) {
    return {
      kind: 'complete',
      reason: 'Current project evidence and answers are enough for Guildhall to shape near-term work.',
    }
  }
  return { kind: 'ask', question: best }
}

export function classifyProjectAnswer(answer: ProjectQuestionAnswer): ProjectAnswerClassification {
  const cleaned = answer.answer.trim()
  if (isConfusedAnswer(cleaned)) return { kind: 'discard', reason: 'confused' }
  if (cleaned.length < 8) return { kind: 'discard', reason: 'non_answer' }
  if (/^(no|nope|nothing|none|not right now|err+\.?\s*no\??)[.!?]?$/i.test(cleaned)) {
    return { kind: 'discard', reason: 'non_answer' }
  }
  return { kind: 'decision', text: cleaned }
}

export function planFollowUpForAnswer(answer: ProjectQuestionAnswer): ProjectFollowUpPlan {
  const classification = classifyProjectAnswer(answer)
  if (classification.kind === 'discard') {
    return { kind: 'none', reason: 'The answer did not add durable project guidance.' }
  }

  const lower = answer.answer.toLowerCase()
  if (
    answer.questionId === 'project-direction-priority' &&
    lower.includes('reviewer') &&
    /\bgood\b|reader|engagement|quality/.test(lower) &&
    !/(coherence|voice|all three|reader engagement)/.test(lower)
  ) {
    return {
      kind: 'ask',
      question: {
        id: 'reviewer-success-lens',
        prompt: 'Should reviewer-lane MVPs judge internal story coherence, reader engagement, author voice preservation, or all three?',
        why: 'This changes which reviewer contracts and fixtures workers should build first.',
        choices: [
          'Internal story coherence',
          'Reader engagement',
          'Author voice preservation',
          'All three',
        ],
        changes: ['priority', 'review', 'scope'],
        evidence: ['Previous answer points to reviewer work and novel-quality evaluation.'],
        score: 90,
      },
    }
  }

  return { kind: 'none', reason: 'The answer resolves the active fork.' }
}

function generateCandidates(
  evidence: ProjectQuestionEvidence,
  memory: InferredProjectMemory,
): ProjectQuestionCandidate[] {
  const joinedFacts = memory.inferredFacts.map(f => f.text).join(' ').toLowerCase()
  const joinedWork = evidence.currentWork.map(work => `${work.title} ${work.description ?? ''}`).join(' ').toLowerCase()
  const hasNarrativeHarnessSignals =
    (joinedFacts.includes('fiction-writing') && joinedFacts.includes('coherent novel')) ||
    (joinedFacts.includes('author voice') && joinedWork.includes('reviewer'))

  const candidates: ProjectQuestionCandidate[] = []
  if (hasNarrativeHarnessSignals) {
    candidates.push({
      id: 'project-direction-priority',
      prompt: `For the next few ${evidence.projectName} tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?`,
      why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
      choices: [
        'Reviewer-lane MVPs',
        'Author-facing editor UX',
        'Story-memory/schema foundations',
        'Generation/evaluation loops',
      ],
      changes: ['priority', 'scope', 'review'],
      evidence: memory.inferredFacts.slice(0, 4).map(f => `${f.source}: ${f.text}`),
      score: 100,
    })
  }

  if (
    joinedFacts.includes('quiet ui') ||
    joinedFacts.includes('quiet ') ||
    joinedFacts.includes('commercial editor direction') ||
    joinedFacts.includes('commercial direction')
  ) {
    candidates.push({
      id: 'visual-direction-mode',
      prompt: `Should ${evidence.projectName} feel more like a calm writing desk, a professional editorial tool, or an analytical story-debugging cockpit?`,
      why: 'This changes UI acceptance criteria and reviewer expectations for author-facing work.',
      choices: [
        'Calm writing desk',
        'Professional editorial tool',
        'Analytical story-debugging cockpit',
      ],
      changes: ['product_direction', 'review'],
      evidence: memory.inferredFacts.filter(f => /quiet ui|commercial|reader/i.test(f.text)).map(f => `${f.source}: ${f.text}`),
      score: 70,
    })
  }

  if (candidates.length === 0 && memory.inferredFacts.length === 0) {
    candidates.push({
      id: 'project-direction-open',
      prompt: `What should Guildhall use as the main direction for ${evidence.projectName} when shaping work?`,
      why: 'Guildhall does not have enough project evidence yet, so one project direction answer prevents it from inventing priorities.',
      changes: ['priority', 'scope'],
      evidence: [],
      score: 40,
    })
  }

  return candidates
}

function extractFactsFromFile(file: ProjectQuestionEvidenceFile): ProjectFact[] {
  const sentences = file.text
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length >= 28 && text.length <= 260)

  return sentences.map((text, index) => ({
    id: `${slug(file.path)}-fact-${index + 1}`,
    text,
    source: file.path,
  }))
}

function extractCurrentWorkFromFile(file: ProjectQuestionEvidenceFile): ProjectCurrentWork[] {
  if (!file.path.endsWith('TASKS.json')) return []
  try {
    const parsed = JSON.parse(file.text) as { tasks?: Array<{ id?: string; title?: string; description?: string }> }
    return (parsed.tasks ?? [])
      .filter(task => task.id && task.title)
      .map(task => ({
        id: task.id!,
        title: task.title!,
        ...(task.description ? { description: task.description } : {}),
      }))
  } catch {
    return []
  }
}

function isAnswered(candidate: ProjectQuestionCandidate, answers: ProjectQuestionAnswer[]): boolean {
  return answers.some(answer =>
    answer.questionId === candidate.id ||
    answer.prompt === candidate.prompt ||
    candidate.choices?.some(choice => answer.answer.toLowerCase().includes(choice.toLowerCase().split('/')[0] ?? choice.toLowerCase())),
  )
}

function uniqueFacts(facts: ProjectFact[]): ProjectFact[] {
  const seen = new Set<string>()
  const result: ProjectFact[] = []
  for (const fact of facts) {
    const key = fact.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(fact)
  }
  return result
}

function isConfusedAnswer(answer: string): boolean {
  return /\b(i do not understand|i don't understand|what do you mean|nature of the question|unclear question|confusing)\b/i.test(answer)
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}
