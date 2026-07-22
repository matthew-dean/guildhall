import { describe, expect, it } from 'vitest'
import {
  buildProjectQuestionEvidence,
  classifyProjectAnswer,
  inferProjectMemory,
  planFollowUpForAnswer,
  planNextProjectQuestion,
  type ProjectQuestionEvidenceInput,
} from '../project-question-planner.js'
import {
  narrativeHarnessBadCheckInAnswers,
  narrativeHarnessProjectFiles,
} from '../__fixtures__/narrative-harness-project-check-in.js'

const narrativeHarnessInput: ProjectQuestionEvidenceInput = {
  projectId: 'narrative-harness',
  projectName: 'Narrative Harness',
  files: narrativeHarnessProjectFiles,
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

  it('asks one generic typed direction question instead of classifying project prose', () => {
    const evidence = buildProjectQuestionEvidence(narrativeHarnessInput)
    const plan = planNextProjectQuestion({
      evidence,
      answeredQuestions: [],
      askedCandidateIds: [],
    })

    expect(plan.kind).toBe('ask')
    if (plan.kind !== 'ask') throw new Error('expected a question')
    expect(plan.question.id).toBe('project-direction-open')
    expect(plan.question.prompt).toBe(
      'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
    )
    expect(plan.question.choices).toBeUndefined()
    expect(plan.question.evidence).toEqual([])
  })

  it('keeps asking the next planned root question when one fork is resolved but other intake questions remain', () => {
    const evidence = buildProjectQuestionEvidence({
      ...narrativeHarnessInput,
      currentAnswers: [{
        questionId: 'project-direction-open',
        prompt: 'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
        answer: 'Reviewer-lane MVPs first, then generation/evaluation loops.',
      }],
    })
    const plan = planNextProjectQuestion({
      evidence,
      answeredQuestions: evidence.currentAnswers,
      askedCandidateIds: ['project-direction-open'],
    })

    expect(plan.kind).toBe('complete')
  })

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
      questionId: 'project-direction-open',
      prompt: 'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
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

  it('does not classify free-form answer vocabulary into a project-specific follow-up', () => {
    const answer = {
      questionId: 'project-direction-open',
      prompt: 'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
      answer: 'Probably reviewer stuff, but only if it helps us know whether a novel is actually good.',
    }

    expect(planFollowUpForAnswer(answer)).toEqual({
      kind: 'none',
      reason: 'The answer resolves the active fork.',
    })
  })

  it('does not recreate the bad Narrative Harness check-in sequence', () => {
    const evidence = buildProjectQuestionEvidence({
      ...narrativeHarnessInput,
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

  it('never places the full previous answer inside the next prompt', () => {
    const previousAnswer = 'A quiet but powerful editor with clean lines, muted colors, lots of whitespace, and reader feedback loops.'
    const followUp = planFollowUpForAnswer({
      questionId: 'project-direction-open',
      prompt: 'What should Guildhall use as the main direction for Narrative Harness when shaping work?',
      answer: previousAnswer,
    })

    if (followUp.kind === 'ask') {
      expect(followUp.question.prompt).not.toContain(previousAnswer)
      expect(followUp.question.prompt.length).toBeLessThan(220)
    }
  })

  it('does not ask UI or browser-oriented project questions for API, CLI, or docs evidence', () => {
    const evidence = buildProjectQuestionEvidence({
      projectId: 'release-matrix-service',
      projectName: 'Release Matrix Service',
      files: [
        {
          path: 'README.md',
          text: [
            'Release Matrix Service exposes backend API endpoints for project comments and membership checks.',
            'The command-line inspect tool supports machine-readable output for automation.',
            'The docs quick start explains install warnings for operators.',
          ].join(' '),
        },
        {
          path: '.guildhall/TASKS.json',
          text: JSON.stringify({
            tasks: [
              { id: 'api', title: 'Add comment endpoint with membership checks' },
              { id: 'cli', title: 'Add --json output to inspect command' },
              { id: 'docs', title: 'Clarify quick start install warning' },
            ],
          }),
        },
      ],
      currentAnswers: [],
    })

    const plan = planNextProjectQuestion({
      evidence,
      answeredQuestions: [],
      askedCandidateIds: [],
    })

    const text = plan.kind === 'ask' ? `${plan.question.prompt} ${plan.question.why} ${(plan.question.choices ?? []).join(' ')}` : plan.reason
    expect(text).not.toMatch(/\b(UI|visual|palette|browser|component|drawer|card)\b/i)
  })
})
