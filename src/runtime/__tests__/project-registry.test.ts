import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TMP_HOME = path.join(os.tmpdir(), `guildhall-project-registry-${process.pid}`)

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => TMP_HOME }
})

const { bootstrapWorkspace, listWorkspaces, readWorkspaceConfig } = await import('@guildhall/config')
const { buildServeApp } = await import('../serve.js')
const { getProjectStateDir } = await import('@guildhall/sessions')

let tmpProject: string

beforeEach(async () => {
  mkdirSync(path.join(TMP_HOME, '.guildhall'), { recursive: true })
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-attach-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true, force: true })
  await fs.rm(tmpProject, { recursive: true, force: true })
})

describe('POST /api/service/attach-project', () => {
  it('registers an existing initialized project by path', async () => {
    bootstrapWorkspace(tmpProject, { name: 'Attached Project' })
    const { app } = buildServeApp({ projectPath: tmpProject })

    const res = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; project?: { id?: string; initializationNeeded?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.project?.id).toBe('attached-project')
    expect(body.project?.initializationNeeded).toBe(false)
    expect(listWorkspaces().map(entry => entry.path)).toContain(tmpProject)
  })

  it('registers an uninitialized project so setup can happen inside the shell', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })

    const res = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; project?: { path?: string; initializationNeeded?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.project?.initializationNeeded).toBe(true)

    const service = await app.fetch(new Request('http://localhost/api/service'))
    const serviceBody = (await service.json()) as { projects?: Array<{ path?: string; initializationNeeded?: boolean }> }
    expect(serviceBody.projects).toContainEqual(expect.objectContaining({
      path: tmpProject,
      initializationNeeded: true,
    }))
  })

  it('updates the registry entry after setup identity finishes for an attached uninitialized project', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })

    const attach = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))
    const attachBody = (await attach.json()) as { project?: { id?: string } }
    const projectId = attachBody.project?.id
    expect(projectId).toBeTruthy()

    const save = await app.fetch(new Request(`http://localhost/api/setup/identity?projectId=${encodeURIComponent(projectId ?? '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'T Minus T', id: 't-minus-t', tags: ['extension'] }),
    }))

    expect(save.status).toBe(200)
    const entries = listWorkspaces()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe('t-minus-t')
    expect(entries[0]?.name).toBe('T Minus T')
    expect(entries[0]?.tags).toEqual(['extension'])
  })

  it('proves fresh onboarding recovery through temp-project API checkpoints', async () => {
    await fs.mkdir(path.join(tmpProject, 'packages', 'core'), { recursive: true })
    await fs.mkdir(path.join(tmpProject, 'packages', 'web'), { recursive: true })
    await fs.writeFile(
      path.join(tmpProject, 'package.json'),
      JSON.stringify({
        name: 'fresh-onboarding-fixture',
        private: true,
        workspaces: ['packages/*'],
        scripts: {
          build: 'echo build',
          test: 'echo test',
        },
      }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpProject, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@fixture/core' }, null, 2),
      'utf8',
    )
    await fs.writeFile(
      path.join(tmpProject, 'packages', 'web', 'package.json'),
      JSON.stringify({ name: '@fixture/web' }, null, 2),
      'utf8',
    )

    const { app } = buildServeApp({ projectPath: tmpProject })

    const attach = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))
    expect(attach.status).toBe(200)
    const attachBody = (await attach.json()) as {
      ok?: boolean
      project?: { id?: string; path?: string; initializationNeeded?: boolean }
    }
    expect(attachBody.ok).toBe(true)
    expect(attachBody.project?.path).toBe(tmpProject)
    expect(attachBody.project?.initializationNeeded).toBe(true)
    expect(existsSync(path.join(tmpProject, '.guildhall'))).toBe(false)
    const attachedId = attachBody.project?.id
    expect(attachedId).toBeTruthy()

    const attachedService = await app.fetch(new Request('http://localhost/api/service'))
    expect(attachedService.status).toBe(200)
    const attachedServiceBody = (await attachedService.json()) as {
      selectedProject?: unknown
      foregroundProject?: unknown
      projects?: Array<{ id?: string; path?: string; initializationNeeded?: boolean }>
    }
    expect(attachedServiceBody.selectedProject).toBeUndefined()
    expect(attachedServiceBody.foregroundProject).toBeUndefined()
    expect(attachedServiceBody.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: tmpProject,
        initializationNeeded: true,
      }),
    ]))

    const uninitializedProject = await app.fetch(new Request(`http://localhost/api/project?projectId=${encodeURIComponent(attachedId ?? '')}`))
    expect(uninitializedProject.status).toBe(200)
    const uninitializedBody = (await uninitializedProject.json()) as { initializationNeeded?: boolean }
    expect(uninitializedBody.initializationNeeded).toBe(true)

    const uninitializedDraft = await app.fetch(new Request(`http://localhost/api/project/meta-intake/draft?projectId=${encodeURIComponent(attachedId ?? '')}`))
    expect(uninitializedDraft.status).toBe(200)
    await expect(uninitializedDraft.json()).resolves.toMatchObject({
      status: 'uninitialized',
      taskExists: false,
      specReady: false,
    })

    const setupIdentity = await app.fetch(new Request(`http://localhost/api/setup/identity?projectId=${encodeURIComponent(attachedId ?? '')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Fresh Onboarding Fixture', id: 'fresh-onboarding-fixture', tags: ['fixture'] }),
    }))
    expect(setupIdentity.status).toBe(200)
    expect(existsSync(path.join(tmpProject, '.guildhall'))).toBe(true)

    const providerSave = await app.fetch(new Request('http://localhost/api/setup/providers/config?projectId=fresh-onboarding-fixture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferredProvider: 'anthropic-api', anthropicApiKey: 'sk-ant-fixture' }),
    }))
    expect(providerSave.status).toBe(200)
    const providerRead = await app.fetch(new Request('http://localhost/api/setup/providers?projectId=fresh-onboarding-fixture'))
    expect(providerRead.status).toBe(200)
    const providerBody = (await providerRead.json()) as {
      preferredProvider?: string | null
      providers?: Record<string, { detected?: boolean }>
    }
    expect(providerBody.preferredProvider).toBe('anthropic-api')
    expect(providerBody.providers?.['anthropic-api']?.detected).toBe(true)

    const initializedService = await app.fetch(new Request('http://localhost/api/service'))
    expect(initializedService.status).toBe(200)
    const initializedServiceBody = (await initializedService.json()) as {
      projects?: Array<{ id?: string; path?: string; initializationNeeded?: boolean }>
    }
    expect(initializedServiceBody.projects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'fresh-onboarding-fixture',
        path: tmpProject,
        initializationNeeded: false,
      }),
    ]))

    const initializedProject = await app.fetch(new Request('http://localhost/api/project?projectId=fresh-onboarding-fixture'))
    expect(initializedProject.status).toBe(200)
    const initializedProjectBody = (await initializedProject.json()) as {
      initializationNeeded?: boolean
    }
    expect(initializedProjectBody.initializationNeeded).toBe(false)

    const startMeta = await app.fetch(new Request('http://localhost/api/project/meta-intake?projectId=fresh-onboarding-fixture', {
      method: 'POST',
    }))
    expect(startMeta.status).toBe(200)
    await expect(startMeta.json()).resolves.toMatchObject({
      taskId: 'task-meta-intake',
      alreadyExists: false,
    })

    const emptyDraft = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft?projectId=fresh-onboarding-fixture'))
    expect(emptyDraft.status).toBe(200)
    await expect(emptyDraft.json()).resolves.toMatchObject({
      status: 'in-progress',
      taskExists: true,
      specReady: false,
      taskStatus: 'exploring',
    })

    const synthesize = await app.fetch(new Request('http://localhost/api/project/meta-intake/synthesize?projectId=fresh-onboarding-fixture', {
      method: 'POST',
    }))
    expect(synthesize.status).toBe(200)
    const synthesizeBody = (await synthesize.json()) as { ok?: boolean; drafts?: Array<{ id?: string; path?: string }> }
    expect(synthesizeBody.ok).toBe(true)
    expect(synthesizeBody.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'core', path: 'packages/core' }),
      expect.objectContaining({ id: 'web', path: 'packages/web' }),
    ]))

    const readyDraft = await app.fetch(new Request('http://localhost/api/project/meta-intake/draft?projectId=fresh-onboarding-fixture'))
    expect(readyDraft.status).toBe(200)
    await expect(readyDraft.json()).resolves.toMatchObject({
      status: 'draft-ready',
      taskExists: true,
      specReady: true,
      taskStatus: 'spec_review',
    })

    const approve = await app.fetch(new Request('http://localhost/api/project/meta-intake/approve?projectId=fresh-onboarding-fixture', {
      method: 'POST',
    }))
    expect(approve.status).toBe(200)
    await expect(approve.json()).resolves.toMatchObject({
      ok: true,
      coordinatorsAdded: 2,
    })

    const config = readWorkspaceConfig(tmpProject)
    expect(config.coordinators?.map(coordinator => coordinator.id)).toEqual(['core', 'web'])
    expect(config.bootstrap?.successGates).toEqual(['pnpm run build', 'pnpm run test'])

    const acceptedProject = await app.fetch(new Request('http://localhost/api/project?projectId=fresh-onboarding-fixture'))
    expect(acceptedProject.status).toBe(200)
    const acceptedBody = (await acceptedProject.json()) as {
      initializationNeeded?: boolean
      tasks?: Array<{ id?: string; status?: string }>
      structuralMapReview?: { state?: string; counts?: { packages?: number } }
    }
    expect(acceptedBody.initializationNeeded).toBe(false)
    expect(acceptedBody.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-meta-intake', status: 'done' }),
    ]))
    expect(acceptedBody.structuralMapReview?.state).toBe('accepted')
    expect(acceptedBody.structuralMapReview?.counts?.packages).toBe(2)

    const graph = await app.fetch(new Request('http://localhost/api/project/project-graph?projectId=fresh-onboarding-fixture'))
    expect(graph.status).toBe(200)
    const graphBody = (await graph.json()) as {
      projectGraph?: {
        structuralDomains?: Array<{ id?: string; label?: string; kind?: string }>
        contractSurfaces?: Array<{ id?: string; label?: string }>
      }
    }
    expect(graphBody.projectGraph?.structuralDomains).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'domain:core', kind: 'structural_domain' }),
      expect.objectContaining({ id: 'domain:web', kind: 'structural_domain' }),
    ]))
    expect(graphBody.projectGraph?.contractSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'fresh-onboarding-fixture.fixture-core' }),
      expect.objectContaining({ id: 'fresh-onboarding-fixture.fixture-web' }),
    ]))
  })
})

describe('project-scoped API routing', () => {
  it('does not expose a service-wide selected project in service metadata', async () => {
    const firstProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-service-first-'))
    const secondProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-service-second-'))
    try {
      bootstrapWorkspace(firstProject, { name: 'First Project' })
      bootstrapWorkspace(secondProject, { name: 'Second Project' })

      const { registerWorkspace } = await import('@guildhall/config')
      registerWorkspace({ id: 'first-project', path: firstProject, name: 'First Project', tags: [] })
      registerWorkspace({ id: 'second-project', path: secondProject, name: 'Second Project', tags: [] })

      const { app } = buildServeApp({ projectPath: firstProject })

      const service = await app.fetch(new Request('http://localhost/api/service'))
      expect(service.status).toBe(200)
      const body = (await service.json()) as {
        selectedProject?: unknown
        foregroundProject?: unknown
        projects?: Array<{ id: string; selected?: boolean }>
      }
      expect(body.selectedProject).toBeUndefined()
      expect(body.foregroundProject).toBeUndefined()
      expect(body.projects?.map(project => project.id)).toEqual(expect.arrayContaining(['first-project', 'second-project']))
      expect(body.projects?.some(project => project.selected === true)).toBe(false)
    } finally {
      await fs.rm(firstProject, { recursive: true, force: true })
      await fs.rm(secondProject, { recursive: true, force: true })
    }
  })

  it('rejects unscoped project API reads instead of guessing a foreground project', async () => {
    const firstProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-first-'))
    const secondProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-second-'))
    try {
      bootstrapWorkspace(firstProject, { name: 'First Project' })
      bootstrapWorkspace(secondProject, { name: 'Second Project' })

      const { registerWorkspace } = await import('@guildhall/config')
      registerWorkspace({ id: 'first-project', path: firstProject, name: 'First Project', tags: [] })
      registerWorkspace({ id: 'second-project', path: secondProject, name: 'Second Project', tags: [] })

      const { app } = buildServeApp({ projectPath: firstProject })

      const unscoped = await app.fetch(new Request('http://localhost/api/project'))
      expect(unscoped.status).toBe(400)
      await expect(unscoped.json()).resolves.toMatchObject({
        error: 'projectId is required for project-scoped requests.',
      })

      const scoped = await app.fetch(new Request('http://localhost/api/project?projectId=second-project'))
      expect(scoped.status).toBe(200)
      const scopedBody = (await scoped.json()) as { name?: string; path?: string }
      expect(scopedBody.name).toBe('Second Project')
      expect(scopedBody.path).toBe(secondProject)
    } finally {
      await fs.rm(firstProject, { recursive: true, force: true })
      await fs.rm(secondProject, { recursive: true, force: true })
    }
  })

  it('lets explicit projectId queries target a different project without mutating the selected project', async () => {
    const firstProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-explicit-first-'))
    const secondProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-explicit-second-'))
    try {
      bootstrapWorkspace(firstProject, { name: 'First Project' })
      bootstrapWorkspace(secondProject, { name: 'Second Project' })

      const { registerWorkspace } = await import('@guildhall/config')
      registerWorkspace({ id: 'first-project', path: firstProject, name: 'First Project', tags: [] })
      registerWorkspace({ id: 'second-project', path: secondProject, name: 'Second Project', tags: [] })

      const { app } = buildServeApp({ projectPath: firstProject })

      const saveBrief = await app.fetch(new Request('http://localhost/api/project/brief?projectId=second-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: 'Second brief only, and it is definitely long enough to save.' }),
      }))
      expect(saveBrief.status).toBe(200)

      const secondBrief = await fs.readFile(path.join(getProjectStateDir(secondProject), 'project-brief.md'), 'utf8')
      expect(secondBrief).toBe('Second brief only, and it is definitely long enough to save.\n')

      const firstBriefPath = path.join(getProjectStateDir(firstProject), 'project-brief.md')
      expect(existsSync(firstBriefPath)).toBe(false)

      const unscoped = await app.fetch(new Request('http://localhost/api/project'))
      expect(unscoped.status).toBe(400)

      const first = await app.fetch(new Request('http://localhost/api/project?projectId=first-project'))
      const firstBody = (await first.json()) as { name?: string; path?: string }
      expect(firstBody.name).toBe('First Project')
      expect(firstBody.path).toBe(firstProject)
    } finally {
      await fs.rm(firstProject, { recursive: true, force: true })
      await fs.rm(secondProject, { recursive: true, force: true })
    }
  })
})
