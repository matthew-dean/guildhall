import { describe, expect, it } from 'vitest'

import { parseRoute } from '../router.js'

describe('parseRoute', () => {
  it('routes top-level surfaces', () => {
    expect(parseRoute('/')).toEqual({ kind: 'projects' })
    expect(parseRoute('/projects')).toEqual({ kind: 'projects' })
    expect(parseRoute('/needs-you')).toEqual({ kind: 'fleet-inbox' })
    expect(parseRoute('/notifications')).toEqual({ kind: 'fleet-inbox' })
    expect(parseRoute('/setup')).toEqual({ kind: 'setup', projectId: null })
    expect(parseRoute('/projects/fair-labor-license/setup')).toEqual({
      kind: 'setup',
      projectId: 'fair-labor-license',
    })
    expect(parseRoute('/providers')).toEqual({ kind: 'providers' })
  })

  it('routes project-scoped tab URLs without losing the project id', () => {
    expect(parseRoute('/projects/looma-knit')).toMatchObject({
      kind: 'project',
      projectId: 'looma-knit',
      view: 'thread',
    })
    expect(parseRoute('/projects/looma-knit/notifications')).toMatchObject({
      kind: 'project',
      projectId: 'looma-knit',
      view: 'inbox',
    })
    expect(parseRoute('/projects/looma-knit/work')).toMatchObject({ view: 'work' })
    expect(parseRoute('/projects/looma-knit/workspace-import')).toMatchObject({ view: 'workspace-import' })
    expect(parseRoute('/projects/looma-knit/settings/providers')).toMatchObject({
      view: 'settings',
      sub: 'providers',
    })
    expect(parseRoute('/projects/looma-knit/release/readiness')).toMatchObject({
      view: 'release',
      sub: 'readiness',
    })
    expect(parseRoute('/projects/looma-knit/routing/agents')).toMatchObject({
      view: 'settings',
      sub: 'coordinators',
    })
    expect(parseRoute('/projects/looma-knit/coordinators/knit')).toMatchObject({
      view: 'settings',
      sub: 'coordinators',
    })
    expect(parseRoute('/projects/looma-knit/planner')).toMatchObject({ view: 'planner' })
    expect(parseRoute('/projects/looma-knit/facts')).toMatchObject({ view: 'facts' })
    expect(parseRoute('/projects/looma-knit/timeline')).toMatchObject({ view: 'timeline' })
    expect(parseRoute('/projects/looma-knit/not-real')).toMatchObject({ view: 'thread' })
  })

  it('preserves the background tab for project-scoped task drawers', () => {
    expect(
      parseRoute('/projects/looma-knit/task/task-import-1', {
        backgroundPath: '/projects/looma-knit/settings/providers',
      }),
    ).toEqual({
      kind: 'project',
      projectId: 'looma-knit',
      view: 'settings',
      sub: 'providers',
      drawerTaskId: 'task-import-1',
      backgroundPath: '/projects/looma-knit/settings/providers',
    })

    expect(parseRoute('/projects/looma-knit/task/task-import-2')).toEqual({
      kind: 'project',
      projectId: 'looma-knit',
      view: 'thread',
      sub: null,
      drawerTaskId: 'task-import-2',
      backgroundPath: '/projects/looma-knit/thread',
    })
  })

  it('ignores query strings and hashes when matching task drawer routes', () => {
    expect(parseRoute('/projects/looma-knit/task/task-import-2?sourceNoteCheck=1#now')).toEqual({
      kind: 'project',
      projectId: 'looma-knit',
      view: 'thread',
      sub: null,
      drawerTaskId: 'task-import-2',
      backgroundPath: '/projects/looma-knit/thread',
    })
  })

  it('keeps legacy single-project URLs working while preserving drawer context', () => {
    expect(parseRoute('/project')).toMatchObject({
      kind: 'project',
      projectId: null,
      view: 'thread',
    })
    expect(parseRoute('/project/inbox')).toMatchObject({ view: 'inbox' })
    expect(parseRoute('/project/settings/routing')).toMatchObject({
      view: 'settings',
      sub: 'routing',
    })
    expect(parseRoute('/project/release/notes')).toMatchObject({
      view: 'release',
      sub: 'notes',
    })
    expect(parseRoute('/project/coordinators')).toMatchObject({
      view: 'settings',
      sub: 'coordinators',
    })
    expect(parseRoute('/project/planner')).toMatchObject({ view: 'planner' })
    expect(parseRoute('/project/facts')).toMatchObject({ view: 'facts' })
    expect(parseRoute('/project/timeline')).toMatchObject({ view: 'timeline' })
    expect(parseRoute('/project/nope')).toMatchObject({ view: 'thread' })
    expect(
      parseRoute('/task/task-1', {
        backgroundPath: '/project/release',
      }),
    ).toEqual({
      kind: 'project',
      projectId: null,
      view: 'release',
      sub: null,
      drawerTaskId: 'task-1',
      backgroundPath: '/project/release',
    })
  })
})
