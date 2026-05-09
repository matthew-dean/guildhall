import { describe, it, expect } from 'vitest'
import {
  buildCoordinatorProjectPathMap,
  resolveTaskProjectPath,
} from '../task-project-path.js'

describe('resolveTaskProjectPath', () => {
  it('returns the coordinator subpath for matching domains', () => {
    expect(
      resolveTaskProjectPath({
        workspaceProjectPath: '/workspace',
        domain: 'knit',
        coordinators: [{ domain: 'knit', path: 'knit' }],
      }),
    ).toBe('/workspace/knit')
  })

  it('falls back to the workspace project path when no coordinator path exists', () => {
    expect(
      resolveTaskProjectPath({
        workspaceProjectPath: '/workspace',
        domain: 'qa',
        coordinators: [{ domain: 'knit', path: 'knit' }],
      }),
    ).toBe('/workspace')
  })
})

describe('buildCoordinatorProjectPathMap', () => {
  it('maps each domain to an absolute project path', () => {
    expect(
      buildCoordinatorProjectPathMap('/workspace', [
        { domain: 'knit', path: 'knit' },
        { domain: 'looma', path: '/repos/looma' },
      ]),
    ).toEqual({
      knit: '/workspace/knit',
      looma: '/repos/looma',
    })
  })
})
