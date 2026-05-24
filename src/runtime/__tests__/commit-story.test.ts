import { describe, expect, it } from 'vitest'
import { buildCommitStoryMessage, COMMIT_STORY_PRACTICE_ID } from '../commit-story.js'

describe('commit story practice', () => {
  it('keeps a meaningful task title as the outcome-first subject', () => {
    const message = buildCommitStoryMessage({
      task: { id: 'task-auth-complete', title: 'Implement auth completion flow' },
      status: {
        changedCount: 2,
        untrackedCount: 0,
        samplePaths: ['src/runtime/auth.ts', 'src/runtime/__tests__/auth.test.ts'],
      },
    })

    expect(COMMIT_STORY_PRACTICE_ID).toBe('commit-story')
    expect(message).toContain('Implement auth completion flow')
    expect(message).toContain('Task: task-auth-complete')
    expect(message).toContain('- src/runtime/auth.ts')
  })

  it('rejects placeholder titles and falls back to changed path context', () => {
    const message = buildCommitStoryMessage({
      task: { id: 'task-001', title: 'Do a thing' },
      status: {
        changedCount: 1,
        untrackedCount: 1,
        samplePaths: ['src/runtime/git-story.ts', 'src/runtime/__tests__/git-story.test.ts'],
      },
    })

    expect(message.startsWith('Do a thing')).toBe(false)
    expect(message.startsWith('Update src work')).toBe(true)
    expect(message).toContain('Changes: 1 changed, 1 untracked')
  })

  it('keeps tiny one-file commits short', () => {
    const message = buildCommitStoryMessage({
      task: { id: 'task-docs', title: 'Document Git Story Closure' },
      status: {
        changedCount: 1,
        untrackedCount: 0,
        samplePaths: ['internal/plans/git-story.md'],
      },
    })

    expect(message).toBe('Document Git Story Closure')
  })
})
