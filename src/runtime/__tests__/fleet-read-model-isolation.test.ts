import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TaskQueue } from '@guildhall/core'
import { bootstrapWorkspace, registerWorkspace, unregisterWorkspace } from '@guildhall/config'
import {
  getProjectSystemStatePath,
  promoteProjectStateDatabaseAuthority,
  projectStateDatabasePath,
  upsertProjectStateDatabaseExecution,
  upsertFleetSummaryProjection,
} from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { fleetSummaryDependsOnDomains } from '../fleet-summary-projection.js'
import { writeProjectTaskQueue } from '../project-state-boundary.js'
import { writeProjectSummaryProjectionFromIndexedState } from '../project-summary-projection.js'

const HEALTHY_ID = 'fleet-read-model-healthy'
const BROKEN_ID = 'fleet-read-model-broken'
const now = '2026-07-17T00:00:00.000Z'
const fleetRoutes = ['/api/service/projects', '/api/service', '/api/service?detail=true', '/api/fleet/attention']

type TestProject = {
  id: string
  root: string
  tasksPath: string
}

function queue(projectRoot: string, taskId: string, title = taskId) {
  return TaskQueue.parse({
    version: 1,
    lastUpdated: now,
    releases: [],
    tasks: [{
      id: taskId,
      title,
      description: 'A focused fleet read-model test task.',
      domain: 'runtime',
      projectPath: projectRoot,
      status: 'ready',
      priority: 'normal',
      references: [],
      sourceClaims: [],
      acceptanceCriteria: [],
      outOfScope: [],
      dependsOn: [],
      notes: [],
      gateResults: [],
      escalations: [],
      createdAt: now,
      updatedAt: now,
    }],
  })
}

function summaryFingerprint(project: Record<string, any>) {
  return {
    summaryFreshness: project.summaryFreshness,
    taskCounts: project.taskCounts,
    workProgress: project.workProgress,
    releaseSummary: project.releaseSummary,
    startReadiness: project.startReadiness,
    actionModel: project.actionModel,
  }
}

describe('fleet read-model isolation', () => {
  let tempRoot: string
  let healthy: TestProject
  let broken: TestProject
  let service: ReturnType<typeof buildServeApp>

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'guildhall-fleet-read-model-'))
    const healthyRoot = path.join(tempRoot, 'healthy')
    const brokenRoot = path.join(tempRoot, 'broken')
    bootstrapWorkspace(healthyRoot, { name: HEALTHY_ID })
    bootstrapWorkspace(brokenRoot, { name: BROKEN_ID })
    registerWorkspace({ id: HEALTHY_ID, name: HEALTHY_ID, path: healthyRoot, tags: [] })
    registerWorkspace({ id: BROKEN_ID, name: BROKEN_ID, path: brokenRoot, tags: [] })

    healthy = {
      id: HEALTHY_ID,
      root: healthyRoot,
      tasksPath: getProjectSystemStatePath(healthyRoot, 'TASKS.json'),
    }
    broken = {
      id: BROKEN_ID,
      root: brokenRoot,
      tasksPath: getProjectSystemStatePath(brokenRoot, 'TASKS.json'),
    }
    writeProjectTaskQueue(healthy.tasksPath, queue(healthy.root, 'healthy-task'), {
      projectId: healthy.id,
      projectRoot: healthy.root,
    })
    promoteProjectStateDatabaseAuthority(healthy.root)
    writeProjectSummaryProjectionFromIndexedState(healthy.tasksPath, {
      projectId: healthy.id,
      sourceQueueLastUpdated: now,
    })
    writeProjectTaskQueue(broken.tasksPath, queue(broken.root, 'broken-task'), {
      projectId: broken.id,
      projectRoot: broken.root,
    })
    promoteProjectStateDatabaseAuthority(broken.root)
    service = buildServeApp({ projectPath: healthy.root })
    await service.refreshProjectProjections(healthy.root)
  })

  afterEach(async () => {
    unregisterWorkspace(HEALTHY_ID)
    unregisterWorkspace(BROKEN_ID)
    await rm(tempRoot, { recursive: true, force: true })
  })

  async function readRoute(route: string): Promise<{ status: number; body: Record<string, any> }> {
    const response = await service.app.fetch(new Request(`http://localhost${route}`))
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  function routeProjects(route: string, body: Record<string, any>): Array<Record<string, any>> {
    if (route === '/api/fleet/attention') {
      return (body.groups ?? []).map((group: Record<string, any>) => group.project).filter(Boolean)
    }
    return body.projects ?? []
  }

  it('keeps a healthy project visible when another project database is unreadable', async () => {
    await writeFile(projectStateDatabasePath(broken.root), 'not a sqlite database', 'utf8')

    for (const route of fleetRoutes) {
      const result = await readRoute(route)
      expect(result.status, route).toBe(200)
      const projects = routeProjects(route, result.body)
      expect(projects.find(project => project.id === HEALTHY_ID), route).toMatchObject({
        id: HEALTHY_ID,
        projectStatusLoading: false,
        summaryFreshness: 'current',
      })
      const brokenProject = projects.find(project => project.id === BROKEN_ID)
      expect(brokenProject, route).toMatchObject({
        id: BROKEN_ID,
        projectStatusLoading: false,
      })
      expect(['error', 'missing']).toContain(brokenProject?.summaryFreshness)
    }
  })

  it('keeps fleet routes on the promoted summary when the legacy queue diverges', async () => {
    await writeFile(healthy.tasksPath, JSON.stringify({
      version: 1,
      lastUpdated: '2099-01-01T00:00:00.000Z',
      releases: [],
      tasks: [{ id: 'legacy-only-task', title: 'Legacy only task', status: 'done' }],
    }), 'utf8')

    const fingerprints = []
    for (const route of fleetRoutes) {
      const result = await readRoute(route)
      expect(result.status, route).toBe(200)
      const project = routeProjects(route, result.body).find(candidate => candidate.id === HEALTHY_ID)
      expect(project, route).toBeTruthy()
      fingerprints.push(summaryFingerprint(project!))
    }

    expect(fingerprints[1]).toEqual(fingerprints[0])
    expect(fingerprints[2]).toEqual(fingerprints[0])
    expect(fingerprints[3]).toEqual(fingerprints[0])
    expect(fingerprints[0]).toMatchObject({
      summaryFreshness: 'current',
      taskCounts: { total: 1, done: 0 },
      startReadiness: { focusTaskId: 'healthy-task' },
    })
  })

  it('serves the bounded fleet read model without reopening the project database', async () => {
    upsertFleetSummaryProjection({
      projectId: HEALTHY_ID,
      projectPath: healthy.root,
      sourceProjectRevision: 999,
      sourceQueueRevision: 999,
      refreshedAt: '2099-01-01T00:00:00.000Z',
      state: 'current',
      payload: {
        id: HEALTHY_ID,
        path: healthy.root,
        name: HEALTHY_ID,
        initializationNeeded: false,
        summaryFreshness: 'current',
        taskCounts: { total: 999, active: 999, done: 999 },
        startReadiness: { focusTaskId: 'cache-only-task' },
      },
    })

    const result = await readRoute('/api/service/projects')
    const project = routeProjects('/api/service/projects', result.body).find(candidate => candidate.id === HEALTHY_ID)
    expect(project).toMatchObject({
      summaryFreshness: 'current',
      taskCounts: { total: 999, active: 999, done: 999 },
      startReadiness: { focusTaskId: 'cache-only-task' },
    })
  })

  it('stores a bounded fleet card when a task title is an oversized prompt', async () => {
    writeProjectTaskQueue(healthy.tasksPath, queue(healthy.root, 'healthy-task', 'Prompt '.repeat(2_000)), {
      projectId: healthy.id,
      projectRoot: healthy.root,
    })
    await service.refreshProjectProjections(healthy.root)

    const result = await readRoute('/api/service/projects')
    const project = routeProjects('/api/service/projects', result.body).find(candidate => candidate.id === HEALTHY_ID)
    expect(result.status).toBe(200)
    expect(project).toMatchObject({
      id: HEALTHY_ID,
      summaryFreshness: 'current',
      startReadiness: { focusTaskId: 'healthy-task' },
    })
    expect(project?.startReadiness?.focusTaskTitle).toBeUndefined()
    expect(JSON.stringify(project).length).toBeLessThan(16_384)
  })

  it('keeps a current fleet card available when the project database is unavailable', async () => {
    await writeFile(projectStateDatabasePath(healthy.root), 'not a sqlite database', 'utf8')

    const result = await readRoute('/api/service/projects')
    const project = routeProjects('/api/service/projects', result.body).find(candidate => candidate.id === HEALTHY_ID)
    expect(project).toMatchObject({
      summaryFreshness: 'current',
      taskCounts: { total: 1, active: 1, done: 0 },
      startReadiness: { focusTaskId: 'healthy-task' },
    })
  })

  it('refreshes the saved fleet row after an execution transition', async () => {
    upsertProjectStateDatabaseExecution(healthy.root, {
      status: 'running',
      mode: 'continuous',
      startedAt: '2026-07-17T00:01:00.000Z',
      updatedAt: '2026-07-17T00:01:00.000Z',
    })
    await service.refreshProjectProjections(healthy.root)
    const runningRoutes = await Promise.all(fleetRoutes.map(async route => ({
      route,
      result: await readRoute(route),
    })))
    for (const { route, result } of runningRoutes) {
      expect(result.status, route).toBe(200)
      const project = routeProjects(route, result.body).find(candidate => candidate.id === HEALTHY_ID)
      expect(project, route).toMatchObject({
        summaryFreshness: 'current',
        projectStatusLoading: false,
        execution: { status: 'running' },
        actionModel: { runControl: { label: 'Pause' } },
      })
    }
  })

  it('does not invalidate fleet summaries for detail-only projection writes', () => {
    expect(fleetSummaryDependsOnDomains(['thread'])).toBe(false)
    expect(fleetSummaryDependsOnDomains(['attention'])).toBe(false)
    expect(fleetSummaryDependsOnDomains(['memory', 'diagnostics', 'delivery', 'repository'])).toBe(false)
    expect(fleetSummaryDependsOnDomains(['queue'])).toBe(true)
    expect(fleetSummaryDependsOnDomains(['owner-input'])).toBe(true)
    expect(fleetSummaryDependsOnDomains(['future-current-state-domain'])).toBe(true)
    expect(fleetSummaryDependsOnDomains(['thread', 'release'])).toBe(true)
  })
})
