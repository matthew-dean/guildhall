import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import yaml from 'js-yaml'
import { bootstrapWorkspace } from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { DESIGN_TASTE_FILE } from '../design-taste.js'

let tmpDir: string
let dataDir: string
let configDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-design-taste-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  configDir = path.join(os.tmpdir(), `guildhall-config-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  process.env.GUILDHALL_CONFIG_DIR = configDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Design Taste Test' }).id ?? path.basename(tmpDir)
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

describe('GET /api/project/design-taste', () => {
  it('returns effective design taste and applied layers', async () => {
    await fs.mkdir(path.join(configDir), { recursive: true })
    await fs.writeFile(path.join(configDir, DESIGN_TASTE_FILE), yaml.dump({
      opinions: {
        visualDirection: {
          default: 'quiet-operational-polish',
        },
      },
    }), 'utf-8')
    await fs.writeFile(path.join(getProjectStateDir(tmpDir), DESIGN_TASTE_FILE), yaml.dump({
      opinions: {
        visualDirection: {
          avoid: ['tiny-unexplained-controls'],
        },
      },
    }), 'utf-8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/design-taste')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      taste?: { opinions?: { visualDirection?: { default?: string; avoid?: string[] } } }
      summary?: string
      layers?: Array<{ id?: string; applied?: boolean }>
    }
    expect(body.taste?.opinions?.visualDirection?.default).toBe('quiet-operational-polish')
    expect(body.taste?.opinions?.visualDirection?.avoid).toContain('tiny-unexplained-controls')
    expect(body.summary).toContain('quiet-operational-polish')
    expect(body.layers?.map(layer => `${layer.id}:${layer.applied}`)).toEqual([
      'builtin:true',
      'user:true',
      'project:true',
    ])
  })
})
