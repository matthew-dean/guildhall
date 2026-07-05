import { describe, expect, it } from 'vitest'

import { friendlyRuntimeMessage } from '../runtime-message.js'

describe('friendlyRuntimeMessage', () => {
  it('does not tell workspace envelopes that the parent folder must be the git repo', () => {
    expect(friendlyRuntimeMessage('fatal: not a git repository')).toBe(
      'Guildhall could not inspect git at that path. If this is a workspace folder, Guildhall should use its child repositories as the git boundaries.',
    )
  })
})
