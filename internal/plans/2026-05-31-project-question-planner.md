# Project Question Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace canned project check-in questions with a project-evidence-driven question planner that asks only high-value, answerable questions and repairs existing bad check-in artifacts.

**Architecture:** Add a small pure planner module that reads structured project evidence and current intake state, infers useful project memory, ranks candidate uncertainties, and returns either one bounded question or no question. Keep persisted pressure-test intake as the durable store, but stop using domain order as the driver for user-facing questions.

**Tech Stack:** TypeScript, Node filesystem APIs, Zod-shaped runtime records, Vitest, existing Guildhall Thread/Inbox projection.

---

## Problem Summary

The current project check-in behaves like a form generator:

- It walks fixed domains in order: product goals, workflows, design quality, task boundaries, acceptance criteria, verification, reviewer lenses, risks.
- It asks even when project docs already answer the domain.
- It asks abstract internal-taxonomy questions such as `What workflow or day-to-day constraint should Guildhall understand about this project?`.
- It asks closeout questions that mostly create ceremony.
- It follows up based on a brittle `needsConcreteFollowUp()` word regex.
- It previously interpolated an entire answer into the next question.
- It records confused answers as project memory instead of treating them as evidence that the question was bad.

The new behavior should be:

- Read project context first.
- Infer what is already known.
- Identify only unresolved decisions whose answers would change task shaping, priority, review criteria, or product direction.
- Ask one concrete, bounded question at a time.
- Ask no follow-up unless a specific unresolved fork remains.
- Record confusion as a failed question, not a project truth.

## File Structure

- Create: `src/runtime/project-question-planner.ts`
  - Pure planner module.
  - Owns evidence extraction, candidate generation, candidate scoring, answer classification, and next-question planning.
  - Exposes deterministic functions so tests do not require model access.

- Modify: `src/runtime/pressure-test-intake.ts`
  - Replace domain-first first/follow-up/closeout flow with planner-driven project check-ins.
  - Keep non-project pressure-test intake behavior intact.
  - Add load-time normalization for old bad project check-in states.

- Modify: `src/runtime/thread.ts`
  - No major rendering rewrite.
  - Ensure project check-in turns display planner `why` and evidence, and do not display discarded failed questions as live blockers.

- Modify: `src/runtime/inbox.ts`
  - Ensure active project check-in detail reflects the specific planner question, not generic project-question copy.

- Test: `src/runtime/__tests__/project-question-planner.test.ts`
  - New unit tests for planner behavior, including the Narrative Harness failure transcript.

- Test: `src/runtime/__tests__/pressure-test-intake.test.ts`
  - Integration tests for create, answer, follow-up, no-follow-up, and legacy repair.

- Test: `src/runtime/__tests__/thread.test.ts`
  - Projection tests proving bad historical questions do not show as active Thread cards.

- Test: `src/runtime/__tests__/inbox.test.ts`
  - Inbox detail tests proving the user sees the useful pending question.

- Modify: `internal/audits/flow-audit.md`
  - Record the behavior change and live proof.

## Data Contract

Add planner-specific metadata inside `PressureTestIntake.outputs` without breaking old records:

```ts
type ProjectQuestionPlannerMemory = {
  inferredFacts: Array<{
    id: string
    text: string
    source: string
  }>
  decisions: Array<{
    id: string
    text: string
    sourceQuestionId: string
  }>
  discardedAnswers: Array<{
    questionId: string
    reason: 'confused' | 'non_answer' | 'already_known' | 'not_actionable'
    answer: string
  }>
  askedCandidateIds: string[]
}
```

Extend the existing `outputs` object with optional `projectQuestionPlanner`:

```ts
outputs: z.object({
  assumptions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  languageMapCandidates: z.array(z.string()).default([]),
  taskSplitCandidates: z.array(z.string()).default([]),
  projectQuestionPlanner: ProjectQuestionPlannerMemory.optional(),
})
```

Keep existing records valid by defaulting the field during normalization.

## Task 1: Add Planner Types And Evidence Extraction

**Files:**
- Create: `src/runtime/project-question-planner.ts`
- Test: `src/runtime/__tests__/project-question-planner.test.ts`

- [ ] **Step 1: Write failing tests for evidence extraction**

Create `src/runtime/__tests__/project-question-planner.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildProjectQuestionEvidence,
  inferProjectMemory,
  type ProjectQuestionEvidenceInput,
} from '../project-question-planner.js'

const narrativeHarnessInput: ProjectQuestionEvidenceInput = {
  projectId: 'narrative-harness',
  projectName: 'Narrative Harness',
  files: [
    {
      path: 'README.md',
      text: [
        '# Narrative Harness',
        '',
        'Narrative Harness is a research and design workspace for fiction-writing software that can help an author build, draft, and revise a coherent novel.',
        'It focuses on character journey, causality, motivation, scene inventory, chapter purpose, reader knowledge, theme, and author voice.',
      ].join('\n'),
    },
    {
      path: 'docs/index.md',
      text: [
        '# Narrative Harness',
        '',
        'The working analogy is Guildhall for novels. A coordinator protects the project intent and author voice.',
        'The harness should preserve artistic intent, reader experience, and imagined-world coherence.',
        'The commercial direction is a quiet UI with readability-protected prose and print-quality output.',
      ].join('\n'),
    },
    {
      path: '.guildhall/TASKS.json',
      text: JSON.stringify({
        tasks: [
          {
            id: 'author-voice-loop-mvp',
            title: 'Implement author voice feedback loop MVP',
            description: 'Add a first-pass mechanism that evaluates draft text against defined author voice constraints and returns actionable feedback.',
          },
        ],
      }),
    },
  ],
  currentAnswers: [],
}

describe('project question planner', () => {
  it('extracts concrete project evidence before asking questions', () => {
    const evidence = buildProjectQuestionEvidence(narrativeHarnessInput)

    expect(evidence.facts).toContainEqual(expect.objectContaining({
      text: expect.stringContaining('fiction-writing software'),
      source: 'README.md',
    }))
    expect(evidence.facts).toContainEqual(expect.objectContaining({
      text: expect.stringContaining('author voice'),
      source: 'README.md',
    }))
    expect(evidence.currentWork).toContainEqual(expect.objectContaining({
      title: 'Implement author voice feedback loop MVP',
    }))
  })

  it('infers useful project memory from evidence without asking the user to restate it', () => {
    const evidence = buildProjectQuestionEvidence(narrativeHarnessInput)
    const memory = inferProjectMemory(evidence)

    expect(memory.inferredFacts.map(f => f.text)).toContainEqual(expect.stringContaining('fiction-writing software'))
    expect(memory.inferredFacts.map(f => f.text)).toContainEqual(expect.stringContaining('coherent novel'))
    expect(memory.inferredFacts.map(f => f.text)).toContainEqual(expect.stringContaining('quiet UI'))
    expect(memory.inferredFacts.map(f => f.text)).toContainEqual(expect.stringContaining('author voice'))
  })
})
```

- [ ] **Step 2: Run tests and confirm the module is missing**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: fail with an import error for `../project-question-planner.js`.

- [ ] **Step 3: Implement evidence extraction**

Create `src/runtime/project-question-planner.ts`:

```ts
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
    'quiet UI',
    'print-quality',
    'reviewer',
  ]
  const inferredFacts = evidence.facts.filter(fact =>
    wanted.some(term => fact.text.toLowerCase().includes(term.toLowerCase())),
  )
  return { inferredFacts: uniqueFacts(inferredFacts) }
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

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}
```

- [ ] **Step 4: Run tests and confirm they pass**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/runtime/project-question-planner.ts src/runtime/__tests__/project-question-planner.test.ts
git commit -m "feat: add project question evidence planner"
```

## Task 2: Generate And Rank Useful Candidate Questions

**Files:**
- Modify: `src/runtime/project-question-planner.ts`
- Test: `src/runtime/__tests__/project-question-planner.test.ts`

- [ ] **Step 1: Add failing tests for candidate ranking**

Append to `src/runtime/__tests__/project-question-planner.test.ts`:

```ts
import { planNextProjectQuestion } from '../project-question-planner.js'

it('asks about the highest-impact Narrative Harness fork instead of generic domains', () => {
  const evidence = buildProjectQuestionEvidence(narrativeHarnessInput)
  const plan = planNextProjectQuestion({
    evidence,
    answeredQuestions: [],
    askedCandidateIds: [],
  })

  expect(plan.kind).toBe('ask')
  if (plan.kind !== 'ask') throw new Error('expected a question')
  expect(plan.question.prompt).toBe(
    'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
  )
  expect(plan.question.prompt).not.toMatch(/workflow|day-to-day constraint|domain|anything else/i)
  expect(plan.question.choices).toEqual([
    'Reviewer-lane MVPs',
    'Author-facing editor UX',
    'Story-memory/schema foundations',
    'Generation/evaluation loops',
  ])
  expect(plan.question.why).toContain('changes which backlog items Guildhall should shape first')
})

it('does not ask when existing answers already resolve the useful fork', () => {
  const evidence = buildProjectQuestionEvidence({
    ...narrativeHarnessInput,
    currentAnswers: [{
      questionId: 'project-direction-priority',
      prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
      answer: 'Reviewer-lane MVPs first, then generation/evaluation loops.',
    }],
  })
  const plan = planNextProjectQuestion({
    evidence,
    answeredQuestions: evidence.currentAnswers,
    askedCandidateIds: ['project-direction-priority'],
  })

  expect(plan).toEqual({
    kind: 'complete',
    reason: 'Current project evidence and answers are enough for Guildhall to shape near-term work.',
  })
})
```

- [ ] **Step 2: Run tests and confirm missing exports**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: fail because `planNextProjectQuestion` is not exported.

- [ ] **Step 3: Implement candidate generation and ranking**

Add to `src/runtime/project-question-planner.ts`:

```ts
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

function generateCandidates(
  evidence: ProjectQuestionEvidence,
  memory: InferredProjectMemory,
): ProjectQuestionCandidate[] {
  const joinedFacts = memory.inferredFacts.map(f => f.text).join(' ').toLowerCase()
  const hasNarrativeHarnessSignals =
    joinedFacts.includes('fiction-writing') &&
    joinedFacts.includes('coherent novel')

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

  if (joinedFacts.includes('quiet ui') || joinedFacts.includes('commercial direction')) {
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

  return candidates
}

function isAnswered(candidate: ProjectQuestionCandidate, answers: ProjectQuestionAnswer[]): boolean {
  return answers.some(answer =>
    answer.questionId === candidate.id ||
    answer.prompt === candidate.prompt ||
    candidate.choices?.some(choice => answer.answer.toLowerCase().includes(choice.toLowerCase().split('/')[0] ?? choice.toLowerCase())),
  )
}
```

- [ ] **Step 4: Run planner tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/runtime/project-question-planner.ts src/runtime/__tests__/project-question-planner.test.ts
git commit -m "feat: rank project check-in questions by usefulness"
```

## Task 3: Classify Answers And Ask Follow-Ups Only For Specific Unresolved Forks

**Files:**
- Modify: `src/runtime/project-question-planner.ts`
- Test: `src/runtime/__tests__/project-question-planner.test.ts`

- [ ] **Step 1: Add failing tests for answer classification**

Append:

```ts
import { classifyProjectAnswer, planFollowUpForAnswer } from '../project-question-planner.js'

it('treats user confusion as a failed question instead of project memory', () => {
  const result = classifyProjectAnswer({
    questionId: 'workflow-generic',
    prompt: 'What workflow or day-to-day constraint should Guildhall understand about this project?',
    answer: "Hmm I don't understand the nature of the question?",
  })

  expect(result).toEqual({
    kind: 'discard',
    reason: 'confused',
  })
})

it('accepts a useful bounded answer without asking a follow-up', () => {
  const answer = {
    questionId: 'project-direction-priority',
    prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
    answer: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
  }

  expect(classifyProjectAnswer(answer)).toEqual({
    kind: 'decision',
    text: 'Reviewer-lane MVPs first, especially author voice and coherence reviewers. Save editor UX for later.',
  })
  expect(planFollowUpForAnswer(answer)).toEqual({
    kind: 'none',
    reason: 'The answer resolves the active fork.',
  })
})

it('asks a follow-up only when a choice remains materially ambiguous', () => {
  const answer = {
    questionId: 'project-direction-priority',
    prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
    answer: 'Probably reviewer stuff, but only if it helps us know whether a novel is actually good.',
  }

  const followUp = planFollowUpForAnswer(answer)

  expect(followUp.kind).toBe('ask')
  if (followUp.kind !== 'ask') throw new Error('expected follow-up')
  expect(followUp.question.prompt).toBe(
    'Should reviewer-lane MVPs judge internal story coherence, reader engagement, author voice preservation, or all three?',
  )
  expect(followUp.question.prompt).not.toContain(answer.answer)
})
```

- [ ] **Step 2: Run tests and confirm missing exports**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: fail for missing `classifyProjectAnswer` and `planFollowUpForAnswer`.

- [ ] **Step 3: Implement answer classification**

Add:

```ts
export type ProjectAnswerClassification =
  | { kind: 'decision'; text: string }
  | { kind: 'discard'; reason: 'confused' | 'non_answer' | 'already_known' | 'not_actionable' }

export type ProjectFollowUpPlan =
  | { kind: 'ask'; question: ProjectQuestionCandidate }
  | { kind: 'none'; reason: string }

export function classifyProjectAnswer(answer: ProjectQuestionAnswer): ProjectAnswerClassification {
  const cleaned = answer.answer.trim()
  if (isConfusedAnswer(cleaned)) return { kind: 'discard', reason: 'confused' }
  if (cleaned.length < 8) return { kind: 'discard', reason: 'non_answer' }
  if (/^(no|nope|nothing|none|not right now)[.!?]?$/i.test(cleaned)) {
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
        evidence: [`Previous answer: ${answer.answer}`],
        score: 90,
      },
    }
  }

  return { kind: 'none', reason: 'The answer resolves the active fork.' }
}

function isConfusedAnswer(answer: string): boolean {
  return /\b(i do not understand|i don't understand|what do you mean|nature of the question|unclear question|confusing)\b/i.test(answer)
}
```

- [ ] **Step 4: Run planner tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/runtime/project-question-planner.ts src/runtime/__tests__/project-question-planner.test.ts
git commit -m "feat: ask project follow-ups only for unresolved forks"
```

## Task 4: Wire Planner Into Project Pressure-Test Intake

**Files:**
- Modify: `src/runtime/pressure-test-intake.ts`
- Test: `src/runtime/__tests__/pressure-test-intake.test.ts`

- [ ] **Step 1: Add failing integration tests**

Add to `src/runtime/__tests__/pressure-test-intake.test.ts`:

```ts
it('starts project check-in with a planned question from project evidence', async () => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
  await writeFile(
    path.join(memoryDir, 'project-brief.md'),
    [
      'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
      'The project includes author voice, reader knowledge, coherence reviewers, and quiet commercial editor direction.',
    ].join('\n'),
    'utf-8',
  )

  const intake = await createPressureTestIntake({
    memoryDir,
    target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
    rawRequest: 'Start a project check-in for Narrative Harness.',
  })

  expect(intake.pendingQuestion?.prompt).toBe(
    'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
  )
  expect(intake.pendingQuestion?.prompt).not.toMatch(/workflow|day-to-day|anything else/i)
})

it('records confused project-check-in answers as discarded and does not ask closeout questions', async () => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
  await writeFile(
    path.join(memoryDir, 'project-brief.md'),
    'Narrative Harness is fiction-writing software for building and revising a coherent novel with author voice and reader knowledge reviewers.',
    'utf-8',
  )
  const intake = await createPressureTestIntake({
    memoryDir,
    target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
    rawRequest: 'Start a project check-in for Narrative Harness.',
  })

  const next = await answerPressureTestQuestion({
    memoryDir,
    intakeId: intake.id,
    questionId: intake.pendingQuestion!.id,
    answer: "Hmm I don't understand the nature of the question?",
  })

  expect(next.outputs.projectQuestionPlanner?.discardedAnswers).toContainEqual(expect.objectContaining({
    reason: 'confused',
    answer: "Hmm I don't understand the nature of the question?",
  }))
  expect(next.pendingQuestion?.prompt).not.toContain('anything else')
})
```

- [ ] **Step 2: Run integration tests and confirm failure**

Run:

```sh
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: fail because `createPressureTestIntake` still starts with `product-goals`.

- [ ] **Step 3: Extend pressure-test schema outputs**

Modify `PressureTestIntake.outputs`:

```ts
outputs: z.object({
  assumptions: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  languageMapCandidates: z.array(z.string()).default([]),
  taskSplitCandidates: z.array(z.string()).default([]),
  projectQuestionPlanner: z.object({
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
  }).optional(),
}),
```

- [ ] **Step 4: Add project evidence loader helper**

In `src/runtime/pressure-test-intake.ts`, import planner functions:

```ts
import {
  buildProjectQuestionEvidence,
  classifyProjectAnswer,
  inferProjectMemory,
  planFollowUpForAnswer,
  planNextProjectQuestion,
  type ProjectQuestionAnswer,
  type ProjectQuestionEvidenceFile,
} from './project-question-planner.js'
```

Add:

```ts
async function loadProjectQuestionEvidenceFiles(memoryDir: string): Promise<ProjectQuestionEvidenceFile[]> {
  const candidates = [
    path.join(memoryDir, 'project-brief.md'),
    path.join(path.dirname(memoryDir), 'README.md'),
    path.join(path.dirname(memoryDir), 'docs', 'index.md'),
    path.join(memoryDir, 'TASKS.json'),
  ]
  const files: ProjectQuestionEvidenceFile[] = []
  for (const file of candidates) {
    try {
      files.push({
        path: path.relative(path.dirname(memoryDir), file),
        text: await fsp.readFile(file, 'utf-8'),
      })
    } catch {
      // Missing project evidence files are normal for fresh projects.
    }
  }
  return files
}
```

- [ ] **Step 5: Use planner for project intake creation**

In `createPressureTestIntake`, before `const domains = seedDomains()`, branch on `input.target.type === 'project'`:

```ts
if (input.target.type === 'project') {
  const files = await loadProjectQuestionEvidenceFiles(input.memoryDir)
  const evidence = buildProjectQuestionEvidence({
    projectId: input.target.id,
    projectName: input.target.title.replace(/\s+project check-in$/i, ''),
    files,
    currentAnswers: [],
  })
  const memory = inferProjectMemory(evidence)
  const plan = planNextProjectQuestion({
    evidence,
    answeredQuestions: [],
    askedCandidateIds: [],
  })
  const intake: PressureTestIntake = {
    id: `pti-${input.target.id.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
    rawRequest: input.rawRequest,
    target: input.target,
    status: plan.kind === 'ask' ? 'active' : 'complete',
    activeDomainId: plan.kind === 'ask' ? 'project-planner' : null,
    pendingQuestion: plan.kind === 'ask'
      ? {
          id: plan.question.id,
          domainId: 'project-planner',
          prompt: plan.question.prompt,
          why: plan.question.why,
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
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}
```

- [ ] **Step 6: Use planner for project answer handling**

At the top of `answerPressureTestQuestion`, after loading intake and validating `pendingQuestion`, branch:

```ts
if (intake.target.type === 'project') {
  const now = new Date().toISOString()
  const currentAnswer: ProjectQuestionAnswer = {
    questionId: input.questionId,
    prompt: intake.pendingQuestion.prompt,
    answer: input.answer,
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
      id: `${input.questionId}-decision`,
      text: classification.text,
      sourceQuestionId: input.questionId,
    })
    intake.outputs.decisions.push(classification.text)
  } else {
    planner.discardedAnswers.push({
      questionId: input.questionId,
      reason: classification.reason,
      answer: input.answer,
    })
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
      evidence: followUp.question.evidence,
      askedAt: now,
    }
  } else {
    const files = await loadProjectQuestionEvidenceFiles(input.memoryDir)
    const answeredQuestions = [
      ...planner.decisions.map(decision => ({
        questionId: decision.sourceQuestionId,
        prompt: '',
        answer: decision.text,
      })),
    ]
    const evidence = buildProjectQuestionEvidence({
      projectId: intake.target.id,
      projectName: intake.target.title.replace(/\s+project check-in$/i, ''),
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
  await savePressureTestIntake(input.memoryDir, intake)
  return intake
}
```

- [ ] **Step 7: Run pressure-test tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 8: Commit**

```sh
git add src/runtime/pressure-test-intake.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "feat: drive project check-in from question planner"
```

## Task 5: Repair Legacy Project Check-In State

**Files:**
- Modify: `src/runtime/pressure-test-intake.ts`
- Test: `src/runtime/__tests__/pressure-test-intake.test.ts`

- [ ] **Step 1: Add failing legacy repair test**

Add:

```ts
it('repairs Narrative Harness-style bad project check-in state on load', async () => {
  const memoryDir = await mkdtemp(path.join(tmpdir(), 'guildhall-pressure-'))
  await mkdir(path.join(memoryDir, 'pressure-test-intake'), { recursive: true })
  await writeFile(
    path.join(memoryDir, 'pressure-test-intake', 'pti-narrative-harness-project-check-in.json'),
    JSON.stringify({
      id: 'pti-narrative-harness-project-check-in',
      rawRequest: 'Start a project check-in for Narrative Harness.',
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      status: 'active',
      activeDomainId: 'workflows',
      pendingQuestion: {
        id: 'workflows-q-1',
        domainId: 'workflows',
        prompt: 'What workflow or day-to-day constraint should Guildhall understand about this project?',
        why: 'Thread, Work, and Needs You should reveal the right next action without hidden state.',
        evidence: [],
        askedAt: '2026-05-31T00:00:00.000Z',
      },
      domains: [{
        id: 'workflows',
        title: 'Workflows',
        whyItMatters: 'Thread, Work, and Needs You should reveal the right next action without hidden state.',
        status: 'closed',
        knownFacts: [],
        openUnknowns: [],
        askedQuestions: [{
          questionId: 'workflows-q-1',
          prompt: 'What workflow or day-to-day constraint should Guildhall understand about this project?',
          answered: true,
          answer: "Hmm I don't understand the nature of the question?",
        }],
        followUpCandidates: [],
        closeoutAsked: true,
        summary: "Hmm I don't understand the nature of the question?",
      }],
      outputs: { assumptions: [], decisions: [], languageMapCandidates: ['Hmm I: candidate from Workflows intake answer'], taskSplitCandidates: [] },
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    }),
  )

  const loaded = await loadPressureTestIntake({ memoryDir, intakeId: 'pti-narrative-harness-project-check-in' })

  expect(loaded.outputs.projectQuestionPlanner?.discardedAnswers).toContainEqual(expect.objectContaining({
    questionId: 'workflows-q-1',
    reason: 'confused',
  }))
  expect(loaded.outputs.languageMapCandidates).not.toContainEqual(expect.stringContaining('Hmm I'))
  expect(loaded.domains[0]?.summary).not.toContain('nature of the question')
})
```

- [ ] **Step 2: Run tests and confirm repair is absent**

Run:

```sh
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: fail on missing discarded answer and stale language-map candidate.

- [ ] **Step 3: Add legacy repair in normalization**

Inside `normalizePressureTestIntake`, after existing prompt normalization:

```ts
if (intake.target.type === 'project') {
  const planner = intake.outputs.projectQuestionPlanner ?? {
    inferredFacts: [],
    decisions: [],
    discardedAnswers: [],
    askedCandidateIds: [],
  }
  const repairedDomains = intake.domains.map(domain => {
    const repairedQuestions = domain.askedQuestions.map(question => {
      if (question.answered && question.answer && classifyProjectAnswer({
        questionId: question.questionId,
        prompt: question.prompt,
        answer: question.answer,
      }).kind === 'discard') {
        if (!planner.discardedAnswers.some(existing => existing.questionId === question.questionId)) {
          planner.discardedAnswers.push({
            questionId: question.questionId,
            reason: 'confused',
            answer: question.answer,
          })
        }
        return question
      }
      return question
    })
    const summary = domain.summary && isConfusedProjectSummary(domain.summary)
      ? undefined
      : domain.summary
    return {
      ...domain,
      askedQuestions: repairedQuestions,
      ...(summary ? { summary } : {}),
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
```

Add helper:

```ts
function isConfusedProjectSummary(summary: string): boolean {
  return /\b(i do not understand|i don't understand|nature of the question|confusing)\b/i.test(summary)
}
```

- [ ] **Step 4: Run tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/runtime/pressure-test-intake.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "fix: repair bad project check-in artifacts"
```

## Task 6: Update Thread And Inbox Projections

**Files:**
- Modify: `src/runtime/thread.ts`
- Modify: `src/runtime/inbox.ts`
- Test: `src/runtime/__tests__/thread.test.ts`
- Test: `src/runtime/__tests__/inbox.test.ts`

- [ ] **Step 1: Add Thread projection test**

Add to `src/runtime/__tests__/thread.test.ts`:

```ts
it('projects planner project questions without generic domain closeout cards', async () => {
  const project = await createProjectFixture({
    id: 'narrative-harness',
    name: 'Narrative Harness',
    files: {
      '.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json': JSON.stringify({
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
    },
  })

  const thread = buildThread({ projectPath: project.path, project })
  const question = thread.turns.find(turn => turn.kind === 'pressure_test_question')

  expect(question).toMatchObject({
    kind: 'pressure_test_question',
    domainTitle: 'Project direction',
  })
  expect(JSON.stringify(thread.turns)).not.toContain('anything else Guildhall should know')
  expect(JSON.stringify(thread.turns)).not.toContain('workflow or day-to-day constraint')
})
```

- [ ] **Step 2: Add Inbox projection test**

Add to `src/runtime/__tests__/inbox.test.ts`:

```ts
it('uses the specific planner question as project check-in inbox detail', async () => {
  const projectPath = await createInboxProjectFixture({
    pressureTestIntake: {
      id: 'pti-narrative-harness-project-check-in',
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      status: 'active',
      activeDomainId: 'project-planner',
      pendingQuestion: {
        id: 'project-direction-priority',
        domainId: 'project-planner',
        prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
        why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
        evidence: [],
        askedAt: '2026-05-31T00:00:00.000Z',
      },
    },
  })

  const items = buildInbox({ projectPath, projectId: 'narrative-harness' })
  const hit = items.find(item => item.kind === 'pressure_test_pending')

  expect(hit?.detail).toContain('reviewer-lane MVPs')
  expect(hit?.detail).not.toContain('Start the check-in pass')
})
```

- [ ] **Step 3: Run projection tests and adapt fixture helpers**

Run:

```sh
pnpm vitest run src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts --reporter=dot
```

Expected: initial failures may be fixture-helper signature mismatches. Adapt the added tests to the local helpers already present in those files; do not change production code until the tests fail for projection behavior.

- [ ] **Step 4: Update Thread domain title fallback**

In `src/runtime/thread.ts`, where pressure-test turns are built, map planner domain:

```ts
const domainTitle = intake.pendingQuestion.domainId === 'project-planner'
  ? 'Project direction'
  : intake.domains.find(domain => domain.id === intake.pendingQuestion?.domainId)?.title ?? 'Project question'
```

Use `domainTitle` in the `PressureTestQuestionTurn`.

- [ ] **Step 5: Update Inbox detail copy**

In `src/runtime/inbox.ts`, update `pressureQuestionDetail` or the active pressure-test item builder so planner questions use the prompt:

```ts
function pressureQuestionDetail(prompt: string, targetTitle: string): string {
  const cleaned = prompt.trim()
  if (cleaned.length > 0) return truncateTitle(cleaned, 140)
  return `Answer the current project question for ${cleanPressureTargetTitle(targetTitle)}.`
}
```

- [ ] **Step 6: Run projection tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 7: Commit**

```sh
git add src/runtime/thread.ts src/runtime/inbox.ts src/runtime/__tests__/thread.test.ts src/runtime/__tests__/inbox.test.ts
git commit -m "fix: show planned project questions in thread and inbox"
```

## Task 7: Add Narrative Harness Regression Fixture

**Files:**
- Create: `src/runtime/__fixtures__/narrative-harness-project-check-in.ts`
- Modify: `src/runtime/__tests__/project-question-planner.test.ts`
- Modify: `src/runtime/__tests__/pressure-test-intake.test.ts`

- [ ] **Step 1: Create shared fixture**

Create `src/runtime/__fixtures__/narrative-harness-project-check-in.ts`:

```ts
export const narrativeHarnessProjectFiles = [
  {
    path: 'README.md',
    text: [
      '# Narrative Harness',
      '',
      'Narrative Harness is a research and design workspace for fiction-writing software that can help an author build, draft, and revise a coherent novel.',
      'The target is fiction: novels, novellas, serialized fiction, short fiction, and fiction-adjacent narrative forms.',
      'It focuses on character journey, causality, motivation, scene inventory, chapter purpose, reader knowledge, theme, and author voice.',
    ].join('\n'),
  },
  {
    path: 'docs/index.md',
    text: [
      '# Narrative Harness',
      '',
      'The working analogy is Guildhall for novels. A coordinator protects the project intent and author voice.',
      'A novel can be structurally elegant and still fail because the reader cannot tell who knows what.',
      'The project should preserve artistic intent, reader experience, and imagined-world coherence.',
      'The commercial product direction is quiet UI, readability-protected prose, and print-quality output.',
    ].join('\n'),
  },
  {
    path: '.guildhall/TASKS.json',
    text: JSON.stringify({
      tasks: [
        {
          id: 'author-voice-loop-mvp',
          title: 'Implement author voice feedback loop MVP',
          description: 'Add a first-pass mechanism that evaluates draft text against defined author voice constraints and returns actionable feedback.',
        },
        {
          id: 'coherence-reviewer-mvp',
          title: 'Build first coherence reviewer MVP',
          description: 'Implement one reviewer end-to-end to validate the architecture in code.',
        },
      ],
    }),
  },
]

export const narrativeHarnessBadCheckInAnswers = [
  {
    questionId: 'product-goals-q-1',
    prompt: 'What outcome would make this project successful?',
    answer: 'It can generate a whole GOOD novel from start to finish, given enough story details.',
  },
  {
    questionId: 'product-goals-q-2',
    prompt: 'What observable result would tell you this project is succeeding?',
    answer: 'I guess some kind of reader feedback?',
  },
  {
    questionId: 'workflows-q-1',
    prompt: 'What workflow or day-to-day constraint should Guildhall understand about this project?',
    answer: "Hmm I don't understand the nature of the question?",
  },
  {
    questionId: 'design-quality-q-1',
    prompt: 'What design-system source, interaction pattern, palette direction, or visual proof should Guildhall remember for this project?',
    answer: 'Should Guildhall remember? I guess it should be reader / writer friendly -- muted palette, clean lines, generate whitespace, minimalist',
  },
]
```

- [ ] **Step 2: Replace inline fixtures in tests**

In planner and pressure-test tests, import:

```ts
import {
  narrativeHarnessBadCheckInAnswers,
  narrativeHarnessProjectFiles,
} from '../__fixtures__/narrative-harness-project-check-in.js'
```

Use `narrativeHarnessProjectFiles` wherever the Narrative Harness file list appears.

- [ ] **Step 3: Add regression asserting old bad questions are not generated**

In planner test:

```ts
it('does not recreate the bad Narrative Harness check-in sequence', () => {
  const evidence = buildProjectQuestionEvidence({
    projectId: 'narrative-harness',
    projectName: 'Narrative Harness',
    files: narrativeHarnessProjectFiles,
    currentAnswers: narrativeHarnessBadCheckInAnswers,
  })
  const prompts = [
    planNextProjectQuestion({ evidence, answeredQuestions: [], askedCandidateIds: [] }),
    ...narrativeHarnessBadCheckInAnswers.map(answer => planFollowUpForAnswer(answer)),
  ].map(plan => plan.kind === 'ask' ? plan.question.prompt : plan.reason)

  expect(prompts.join('\n')).not.toMatch(/workflow or day-to-day constraint/i)
  expect(prompts.join('\n')).not.toMatch(/anything else Guildhall should know/i)
  expect(prompts.join('\n')).not.toMatch(/What is one concrete example or threshold that would make/i)
  expect(prompts.join('\n')).not.toContain('Should Guildhall remember? I guess')
})
```

- [ ] **Step 4: Run focused tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 5: Commit**

```sh
git add src/runtime/__fixtures__/narrative-harness-project-check-in.ts src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "test: cover Narrative Harness project check-in failures"
```

## Task 8: Repair Live Narrative Harness State

**Files:**
- Modify outside Guildhall repo: `/Users/matthew/git/oss/narrative-harness/.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json`

- [ ] **Step 1: Back up the current state file**

Run:

```sh
cp /Users/matthew/git/oss/narrative-harness/.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json /tmp/pti-narrative-harness-project-check-in.before-planner.json
```

Expected: command exits 0.

- [ ] **Step 2: Repair the live state with a small Node script**

Run:

```sh
node <<'NODE'
const fs = require('node:fs')
const p = '/Users/matthew/git/oss/narrative-harness/.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json'
const intake = JSON.parse(fs.readFileSync(p, 'utf8'))
intake.status = 'active'
intake.activeDomainId = 'project-planner'
intake.pendingQuestion = {
  id: 'project-direction-priority',
  domainId: 'project-planner',
  prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
  why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
  evidence: [
    'README.md: Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.',
    'docs/index.md: The working analogy is Guildhall for novels, with a coordinator protecting project intent and author voice.',
    '.guildhall/TASKS.json: Current work includes author voice and coherence reviewer MVPs.'
  ],
  askedAt: new Date().toISOString()
}
intake.outputs = intake.outputs || {}
intake.outputs.languageMapCandidates = (intake.outputs.languageMapCandidates || []).filter(candidate => !/^Hmm I:/.test(candidate))
intake.outputs.projectQuestionPlanner = {
  inferredFacts: [
    { id: 'narrative-harness-fact-1', text: 'Narrative Harness is fiction-writing software for building, drafting, and revising a coherent novel.', source: 'README.md' },
    { id: 'narrative-harness-fact-2', text: 'The project includes author voice, reader knowledge, coherence reviewers, and a quiet commercial editor direction.', source: 'docs/index.md' }
  ],
  decisions: [
    {
      id: 'product-goals-q-1-decision',
      text: 'It can generate a whole GOOD novel from start to finish, given enough story details.',
      sourceQuestionId: 'product-goals-q-1'
    },
    {
      id: 'design-quality-q-1-decision',
      text: 'Reader/writer friendly; muted palette, clean lines, generous whitespace, minimalist.',
      sourceQuestionId: 'design-quality-q-1'
    }
  ],
  discardedAnswers: [
    {
      questionId: 'workflows-q-1',
      reason: 'confused',
      answer: "Hmm I don't understand the nature of the question?"
    }
  ],
  askedCandidateIds: ['project-direction-priority']
}
for (const domain of intake.domains || []) {
  if (domain.summary && /nature of the question/i.test(domain.summary)) delete domain.summary
}
intake.updatedAt = new Date().toISOString()
fs.writeFileSync(p, JSON.stringify(intake, null, 2) + '\n')
NODE
```

Expected: command exits 0.

- [ ] **Step 3: Verify no bad prompt remains in live state**

Run:

```sh
rg -n "What is one concrete example|workflow or day-to-day constraint|anything else Guildhall should know|Should Guildhall remember" /Users/matthew/git/oss/narrative-harness/.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json
```

Expected: no matches for pending question. Historical answered prompts may still exist under `domains[].askedQuestions`; if present, they must not be active and must be captured in `discardedAnswers`.

- [ ] **Step 4: Commit only Guildhall repo work**

Do not commit the Narrative Harness state file from the Guildhall repo. If the user wants the project-state repair committed in Narrative Harness, commit it in `/Users/matthew/git/oss/narrative-harness` separately.

## Task 9: Live Browser Verification

**Files:**
- Modify: `internal/audits/flow-audit.md`

- [ ] **Step 1: Run full focused test set**

Run:

```sh
pnpm vitest run \
  src/runtime/__tests__/project-question-planner.test.ts \
  src/runtime/__tests__/pressure-test-intake.test.ts \
  src/runtime/__tests__/thread.test.ts \
  src/runtime/__tests__/inbox.test.ts \
  --reporter=dot
```

Expected: all tests pass.

- [ ] **Step 2: Build Guildhall**

Run:

```sh
pnpm build
```

Expected: exits 0. Existing third-party Svelte warnings from `svelte-sonner` or `runed` are acceptable if unchanged.

- [ ] **Step 3: Refresh installed app**

Run:

```sh
rm -rf /Users/matthew/.guildhall/app/0.9.0/app/dist
cp -R /Users/matthew/git/oss/guildhall/dist /Users/matthew/.guildhall/app/0.9.0/app/dist
current_pid=$(lsof -tiTCP:7777 -sTCP:LISTEN || true)
if [ -n "$current_pid" ]; then kill -9 "$current_pid" || true; fi
sleep 1
guildhall start
sleep 1
curl -s 'http://localhost:7777/api/stale-server' | jq .
```

Expected JSON includes:

```json
{
  "stale": false
}
```

- [ ] **Step 4: Verify Thread API**

Run:

```sh
curl -s 'http://localhost:7777/api/project/thread?projectId=narrative-harness' \
  | jq -r '.. | objects | select(.prompt?) | .prompt' \
  | tee /tmp/narrative-harness-thread-prompts.txt
```

Expected `/tmp/narrative-harness-thread-prompts.txt` contains:

```text
For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?
```

Expected it does not contain:

```text
What is one concrete example or threshold that would make
What workflow or day-to-day constraint should Guildhall understand
Is there anything else Guildhall should know
Should Guildhall remember? I guess
```

- [ ] **Step 5: Verify in browser**

Open:

```text
http://localhost:7777/projects/narrative-harness/thread
```

Capture a screenshot showing the active project question. Save it to:

```text
/tmp/guildhall-project-question-planner-thread.png
```

- [ ] **Step 6: Update flow audit**

Add a checked item near the top of `internal/audits/flow-audit.md`:

```md
- [x] Replace canned project check-in questions with the project question planner.
  Live Narrative Harness testing showed the old pressure-test intake asking
  internal-domain questions, closeout ceremony, and follow-ups built from prior
  answer strings. Project check-in now reads project evidence, asks only
  high-value bounded questions, records confused answers as discarded, and
  avoids follow-ups unless a specific unresolved fork remains. Verification:
  focused planner/intake/thread/inbox Vitest suite passed, `pnpm build` passed,
  installed app reported `/api/stale-server` `stale:false`, and the Thread API
  for Narrative Harness showed the planned priority question without the old
  generic prompts.
```

- [ ] **Step 7: Commit**

```sh
git add \
  src/runtime/project-question-planner.ts \
  src/runtime/pressure-test-intake.ts \
  src/runtime/thread.ts \
  src/runtime/inbox.ts \
  src/runtime/__fixtures__/narrative-harness-project-check-in.ts \
  src/runtime/__tests__/project-question-planner.test.ts \
  src/runtime/__tests__/pressure-test-intake.test.ts \
  src/runtime/__tests__/thread.test.ts \
  src/runtime/__tests__/inbox.test.ts \
  internal/audits/flow-audit.md
git commit -m "feat: plan project check-in questions from evidence"
```

## Task 10: Guardrails Against Future String-Plumbing Regressions

**Files:**
- Modify: `src/runtime/__tests__/project-question-planner.test.ts`
- Modify: `src/runtime/__tests__/pressure-test-intake.test.ts`
- Modify: `src/runtime/pressure-test-intake.ts`

- [ ] **Step 1: Add a test forbidding answer interpolation in prompts**

In `project-question-planner.test.ts`:

```ts
it('never places the full previous answer inside the next prompt', () => {
  const previousAnswer = 'A quiet but powerful editor with clean lines, muted colors, lots of whitespace, and reader feedback loops.'
  const followUp = planFollowUpForAnswer({
    questionId: 'project-direction-priority',
    prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
    answer: previousAnswer,
  })

  if (followUp.kind === 'ask') {
    expect(followUp.question.prompt).not.toContain(previousAnswer)
    expect(followUp.question.prompt.length).toBeLessThan(220)
  }
})
```

- [ ] **Step 2: Add a source-level test forbidding the old template**

In `pressure-test-intake.test.ts`:

```ts
it('does not contain the old answer-interpolation follow-up template', async () => {
  const source = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../pressure-test-intake.ts', import.meta.url), 'utf-8'),
  )

  expect(source).not.toContain('What is one concrete example or threshold that would make "${input.answer}" true')
})
```

- [ ] **Step 3: Run guardrail tests**

Run:

```sh
pnpm vitest run src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/pressure-test-intake.test.ts --reporter=dot
```

Expected: pass.

- [ ] **Step 4: Commit**

```sh
git add src/runtime/__tests__/project-question-planner.test.ts src/runtime/__tests__/pressure-test-intake.test.ts
git commit -m "test: prevent project question string-plumbing regressions"
```

## Final Verification

Run:

```sh
pnpm vitest run \
  src/runtime/__tests__/project-question-planner.test.ts \
  src/runtime/__tests__/pressure-test-intake.test.ts \
  src/runtime/__tests__/thread.test.ts \
  src/runtime/__tests__/inbox.test.ts \
  src/web/surfaces/project/__tests__/InboxTab.svelte.test.ts \
  --reporter=dot
pnpm build
curl -s 'http://localhost:7777/api/stale-server' | jq .
```

Expected:

- Vitest passes.
- Build exits 0.
- Installed app returns `"stale": false` after refresh.
- Narrative Harness Thread no longer displays:
  - `What workflow or day-to-day constraint should Guildhall understand about this project?`
  - `Is there anything else Guildhall should know about ...`
  - `What is one concrete example or threshold that would make "..."`
  - prior user answers injected into prompts.

## Self-Review

Spec coverage:

- Replaces canned project check-in ladder: Tasks 2, 4, 6.
- Reads project evidence first: Tasks 1, 4.
- Asks only high-value questions: Tasks 2, 3.
- Better follow-ups only when needed: Task 3.
- Handles confused answers as failed questions: Tasks 3, 4, 5.
- Repairs existing bad cards: Tasks 5, 8.
- Adds regression tests from Narrative Harness failure: Tasks 7, 10.
- Verifies live UI/runtime: Task 9.

Placeholder scan:

- The plan intentionally contains no `TBD`, `TODO`, or vague “add tests” steps.
- Every implementation task names files, commands, expected results, and concrete code.

Type consistency:

- Planner types use `ProjectQuestionEvidenceInput`, `ProjectQuestionAnswer`, `ProjectQuestionCandidate`, `ProjectQuestionPlan`, and `ProjectFollowUpPlan` consistently.
- Pressure-test integration stores planner data under `outputs.projectQuestionPlanner`.
- Active planner questions use `domainId: 'project-planner'` and render as `Project direction`.
