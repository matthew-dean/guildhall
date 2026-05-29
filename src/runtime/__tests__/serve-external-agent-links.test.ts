import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

let tmpDir: string
let dataDir: string
let configDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-agent-links-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  configDir = path.join(os.tmpdir(), `guildhall-config-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  process.env.GUILDHALL_CONFIG_DIR = configDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Agent Link Test' }).id ?? path.basename(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  delete process.env.GUILDHALL_CONFIG_DIR
  await fs.rm(configDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

describe('external agent links API', () => {
  it('records and lists Codex subagent handoffs for a task', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const create = await app.fetch(new Request(projectUrl('/api/project/external-agent-links'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'link-looma-004',
        taskId: 'looma-004',
        provider: 'codex-subagent',
        externalAgentId: '019e7025-5434-7fa2-a400-ebd7894f3a2c',
        label: 'Looma GitHub/MIT setup',
        status: 'running',
        targetProjectPath: '/Users/matthew/git/oss/looma-knit/looma',
        promptSummary: 'Move Looma toward public GitHub/MIT/npm readiness.',
      }),
    }))

    expect(create.status).toBe(200)
    const created = await create.json() as { link?: { id?: string; status?: string } }
    expect(created.link).toMatchObject({
      id: 'link-looma-004',
      status: 'running',
    })

    const list = await app.fetch(new Request(projectUrl('/api/project/external-agent-links?taskId=looma-004')))
    expect(list.status).toBe(200)
    const listed = await list.json() as { links?: Array<{ taskId?: string; externalAgentId?: string }> }
    expect(listed.links).toEqual([
      expect.objectContaining({
        taskId: 'looma-004',
        externalAgentId: '019e7025-5434-7fa2-a400-ebd7894f3a2c',
      }),
    ])
  })
})
