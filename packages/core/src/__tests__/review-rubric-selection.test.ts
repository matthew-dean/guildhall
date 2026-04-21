import { describe, it, expect } from 'vitest'
import {
  selectApplicableReviewRubrics,
  renderRubricSelection,
  STANDARD_CODE_REVIEW_RUBRIC,
  DesignSystem,
  type Task,
} from '../index.js'

const baseTask: Task = {
  id: 'task-1',
  title: 'Internal refactor of the bundler',
  description: 'Split the build step into two passes',
  domain: 'infra',
  projectPath: '/tmp',
  status: 'in_progress',
  priority: 'normal',
  acceptanceCriteria: [],
  outOfScope: [],
  dependsOn: [],
  notes: [],
  gateResults: [],
  escalations: [],
  agentIssues: [],
  revisionCount: 0,
  remediationAttempts: 0,
  origination: 'human',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const minimalDS: DesignSystem = DesignSystem.parse({
  version: 1,
  revision: 1,
  authoredBy: 'human',
})

const richDS: DesignSystem = DesignSystem.parse({
  version: 1,
  revision: 1,
  copyVoice: {
    tone: 'warm',
    bannedTerms: ['simply', 'just'],
    preferredTerms: [],
    examples: [],
  },
  authoredBy: 'human',
})

describe('selectApplicableReviewRubrics', () => {
  it('only attaches code-review for a pure-infra task with no brief', () => {
    const sel = selectApplicableReviewRubrics(baseTask, minimalDS)
    expect(sel.code).toBe(STANDARD_CODE_REVIEW_RUBRIC)
    expect(sel.design).toBeUndefined()
    expect(sel.a11y).toBeUndefined()
    expect(sel.copy).toBeUndefined()
    expect(sel.product).toBeUndefined()
  })

  it('attaches design + a11y when the task touches product surface and a DS exists', () => {
    const uiTask: Task = {
      ...baseTask,
      title: 'Ship the empty-state screen for onboarding',
      description: 'Render an empty dashboard when the user has no projects',
    }
    const sel = selectApplicableReviewRubrics(uiTask, minimalDS)
    expect(sel.design).toBeDefined()
    expect(sel.a11y).toBeDefined()
    expect(sel.copy).toBeUndefined() // tone is plain, no banned terms
  })

  it('attaches copy review when the design system has a non-plain voice', () => {
    const uiTask: Task = {
      ...baseTask,
      title: 'New onboarding dialog',
      description: 'Shows the product brief to a first-time user',
    }
    const sel = selectApplicableReviewRubrics(uiTask, richDS)
    expect(sel.copy).toBeDefined()
    expect(sel.copy!.find(r => r.id === 'banned-terms')).toBeDefined()
  })

  it('attaches product review whenever the task has a product brief', () => {
    const pbTask: Task = {
      ...baseTask,
      productBrief: {
        userJob: 'new user wants to onboard quickly',
        successMetric: '90% finish in <5 min',
        antiPatterns: [],
      },
    }
    const sel = selectApplicableReviewRubrics(pbTask, undefined)
    expect(sel.product).toBeDefined()
    expect(sel.product!.find(r => r.id === 'user-job-served')).toBeDefined()
  })

  it('renders to markdown with one block per attached lens', () => {
    const uiTask: Task = {
      ...baseTask,
      title: 'Ship the onboarding dialog',
      description: 'First-run empty state',
      productBrief: {
        userJob: 'x', successMetric: 'y', antiPatterns: [],
      },
    }
    const sel = selectApplicableReviewRubrics(uiTask, richDS)
    const md = renderRubricSelection(sel)
    expect(md).toMatch(/### Code review/)
    expect(md).toMatch(/### Product review/)
    expect(md).toMatch(/### Design review/)
    expect(md).toMatch(/### Copy review/)
    expect(md).toMatch(/### Accessibility review/)
    // Ensure weight is rendered so reviewers can prioritize.
    expect(md).toMatch(/\(weight /)
  })
})
