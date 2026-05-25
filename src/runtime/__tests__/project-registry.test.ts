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

const { bootstrapWorkspace, listWorkspaces } = await import('@guildhall/config')
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
