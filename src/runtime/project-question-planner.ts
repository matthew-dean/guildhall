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
  // Keep source facts as evidence, but do not classify them by vocabulary.
  // Provider-authored or differently worded prose must not change which
  // project questions Guildhall asks.
  return { inferredFacts: uniqueFacts(evidence.facts) }
}

export function planNextProjectQuestion(input: {
  evidence: ProjectQuestionEvidence
  answeredQuestions: ProjectQuestionAnswer[]
  askedCandidateIds: string[]
}): ProjectQuestionPlan {
  const candidates = generateCandidates(input.evidence)
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
  return { kind: 'none', reason: 'The answer resolves the active fork.' }
}

function generateCandidates(evidence: ProjectQuestionEvidence): ProjectQuestionCandidate[] {
  const candidates: ProjectQuestionCandidate[] = []
  if (candidates.length === 0) {
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
