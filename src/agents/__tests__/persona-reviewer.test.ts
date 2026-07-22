import { describe, expect, it } from 'vitest'
import { BUILTIN_GUILDS } from '@guildhall/guilds'
import { personaReviewerSystemPrompt } from '../persona-reviewer.js'

describe('personaReviewerSystemPrompt', () => {
  it('tells reviewers to block only on task-local regressions or unmet work', () => {
    const guild = BUILTIN_GUILDS.find((candidate) => candidate.slug === 'api-designer')
    expect(guild).toBeTruthy()
    const prompt = personaReviewerSystemPrompt(guild!)

    expect(prompt).toContain('did this diff make the code worse, leave the stated job undone, or introduce a new meaningful risk?')
    expect(prompt).toContain('If the problem was already there and this task did not worsen it, treat it as a follow-up idea')
    expect(prompt).toContain('Internal app routes, implementation-detail handlers, and tightly coupled first-party endpoints are not automatically public API contracts.')
    expect(prompt).toContain('For small local tasks (types, tests, narrow composable edits, small UI tweaks, one-line cleanups), default to approving correct work.')
    expect(prompt).toContain('Expertise includes restraint.')
    expect(prompt).toContain('You are a contributor to the decision, not the sole decision maker.')
    expect(prompt).toContain('Do not write in decree language like "what must change"')
    expect(prompt).toContain('Do not invent proof commands.')
    expect(prompt).toContain('## Output format (REQUIRED — parsed machine-readably)')
    expect(prompt).toContain('acceptedCriteriaIds')
    expect(prompt).toContain('proofEvidenceIds')
    expect(prompt).toContain('revisionItems')
    expect(prompt).toContain('Human-readable prose is retained for people')
    expect(prompt).toContain('must never be required to match a template')
  })
})
