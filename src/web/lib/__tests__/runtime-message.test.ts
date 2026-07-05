import { describe, expect, it } from 'vitest'

import { friendlyRuntimeMessage } from '../runtime-message.js'

describe('friendlyRuntimeMessage', () => {
  it('does not tell workspace envelopes that the parent folder must be the git repo', () => {
    expect(friendlyRuntimeMessage('fatal: not a git repository')).toBe(
      'Guildhall could not inspect git for the configured repository boundary. If this workspace contains child repos, Guildhall should show those repo boundaries instead.',
    )
  })
})
