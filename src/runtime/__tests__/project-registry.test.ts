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
  it('registers and selects an existing initialized project by path', async () => {
    bootstrapWorkspace(tmpProject, { name: 'Attached Project' })
    const { app } = buildServeApp({ projectPath: tmpProject })

    const res = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; selectedProject?: { id?: string; initializationNeeded?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.selectedProject?.id).toBe('attached-project')
    expect(body.selectedProject?.initializationNeeded).toBe(false)
    expect(listWorkspaces().map(entry => entry.path)).toContain(tmpProject)
  })

  it('registers and selects an uninitialized project so setup can happen inside the shell', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })

    const res = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok?: boolean; selectedProject?: { initializationNeeded?: boolean } }
    expect(body.ok).toBe(true)
    expect(body.selectedProject?.initializationNeeded).toBe(true)

    const service = await app.fetch(new Request('http://localhost/api/service'))
    const serviceBody = (await service.json()) as { selectedProject?: { path?: string; initializationNeeded?: boolean } | null }
    expect(serviceBody.selectedProject?.path).toBe(tmpProject)
    expect(serviceBody.selectedProject?.initializationNeeded).toBe(true)
  })

  it('updates the registry entry after setup identity finishes for an attached uninitialized project', async () => {
    const { app } = buildServeApp({ projectPath: tmpProject })

    const attach = await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))
    const attachBody = (await attach.json()) as { selectedProject?: { id?: string } }
    const projectId = attachBody.selectedProject?.id
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

describe('POST /api/service/select-project', () => {
  it('switches the active /api/project surface to the selected registered project', async () => {
    const firstProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-first-'))
    const secondProject = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-project-second-'))
    try {
      bootstrapWorkspace(firstProject, { name: 'First Project' })
      bootstrapWorkspace(secondProject, { name: 'Second Project' })

      const { registerWorkspace } = await import('@guildhall/config')
      registerWorkspace({ id: 'first-project', path: firstProject, name: 'First Project', tags: [] })
      registerWorkspace({ id: 'second-project', path: secondProject, name: 'Second Project', tags: [] })

      const { app } = buildServeApp({ projectPath: firstProject })

      const before = await app.fetch(new Request('http://localhost/api/project'))
      const beforeBody = (await before.json()) as { name?: string; path?: string }
      expect(beforeBody.name).toBe('First Project')
      expect(beforeBody.path).toBe(firstProject)

      const select = await app.fetch(new Request('http://localhost/api/service/select-project', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId: 'second-project' }),
      }))
      expect(select.status).toBe(200)

      const after = await app.fetch(new Request('http://localhost/api/project'))
      const afterBody = (await after.json()) as { name?: string; path?: string }
      expect(afterBody.name).toBe('Second Project')
      expect(afterBody.path).toBe(secondProject)
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

      const selected = await app.fetch(new Request('http://localhost/api/project'))
      const selectedBody = (await selected.json()) as { name?: string; path?: string }
      expect(selectedBody.name).toBe('First Project')
      expect(selectedBody.path).toBe(firstProject)
    } finally {
      await fs.rm(firstProject, { recursive: true, force: true })
      await fs.rm(secondProject, { recursive: true, force: true })
    }
  })
})
