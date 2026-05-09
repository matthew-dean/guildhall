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

    await app.fetch(new Request('http://localhost/api/service/attach-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: tmpProject }),
    }))

    const save = await app.fetch(new Request('http://localhost/api/setup/identity', {
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
