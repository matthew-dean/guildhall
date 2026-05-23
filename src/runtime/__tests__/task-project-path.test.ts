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

  it('prefers first-class workspace project paths over coordinator paths', () => {
    expect(
      resolveTaskProjectPath({
        workspaceProjectPath: '/workspace',
        domain: 'looma',
        coordinators: [{ domain: 'looma', path: 'old-looma' }],
        projects: [{ id: 'looma', path: 'looma', coordinator: 'looma' }],
      }),
    ).toBe('/workspace/looma')
  })

  it('matches workspace projects by coordinator id', () => {
    expect(
      resolveTaskProjectPath({
        workspaceProjectPath: '/workspace',
        domain: 'design-system',
        projects: [{ id: 'looma', path: '/repos/looma', coordinator: 'design-system' }],
      }),
    ).toBe('/repos/looma')
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

  it('maps first-class workspace projects and coordinator aliases', () => {
    expect(
      buildCoordinatorProjectPathMap(
        '/workspace',
        [{ domain: 'legacy', path: 'legacy' }],
        [{ id: 'looma', path: 'looma', coordinator: 'design-system' }],
      ),
    ).toEqual({
      looma: '/workspace/looma',
      'design-system': '/workspace/looma',
      legacy: '/workspace/legacy',
    })
  })
})
