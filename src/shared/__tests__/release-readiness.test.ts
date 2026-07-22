import { describe, expect, it } from 'vitest'

import {
  buildReleaseCompletionSummary,
  releaseHumanBlockingPhrase,
} from '../release-readiness.js'

describe('release readiness prose independence', () => {
  it('uses blocker codes rather than display wording for shaping summaries', () => {
    const first = releaseHumanBlockingPhrase(2, [{
      code: 'imported_scope_shaping',
      label: 'The imported material needs a little editorial attention.',
    }])
    const second = releaseHumanBlockingPhrase(2, [{
      code: 'imported_scope_shaping',
      label: 'A completely different model wrote a lyrical paragraph here.',
    }])

    expect(first).toBe('2 need shaping')
    expect(second).toBe(first)
  })

  it('does not promote an untyped label into a semantic blocker category', () => {
    expect(releaseHumanBlockingPhrase(1, [{
      label: 'This item needs shaping before the release can move.',
    }])).toBe('1 needs you')
  })

  it('keeps completion state stable when blocker prose changes', () => {
    const input = {
      ready: false,
      totals: {
        tasks: 1,
        done: 0,
        unfinishedCount: 1,
        humanBlockingCount: 1,
      },
    }
    const first = buildReleaseCompletionSummary({
      ...input,
      releaseBlockers: [{
        code: 'brief_cleanup',
        label: 'Review the imported brief.',
      }],
    })
    const second = buildReleaseCompletionSummary({
      ...input,
      releaseBlockers: [{
        code: 'brief_cleanup',
        label: 'A provider used an entirely different sentence here.',
      }],
    })

    expect(second).toEqual(first)
  })
})
