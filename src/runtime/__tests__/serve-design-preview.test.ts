import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bootstrapWorkspace } from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'
import { buildServeApp } from '../serve.js'
import { DESIGN_STORIES_FILE } from '../design-preview.js'

let tmpDir: string
let dataDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-preview-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Preview Test' }).id ?? path.basename(tmpDir)
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(dataDir, { recursive: true, force: true })
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function projectUrl(route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

describe('GET /api/project/design-preview', () => {
  it('returns the normalized preview adapter for portable stories', async () => {
    const memoryDir = getProjectStateDir(tmpDir)
    await fs.mkdir(memoryDir, { recursive: true })
    await fs.writeFile(
      path.join(memoryDir, DESIGN_STORIES_FILE),
      [
        'version: 1',
        'stories:',
        '  - id: pantry-filter.default',
        '    componentIntent: segmented-filter',
        '    title: Pantry filter / Default',
        '    states: [default, selected]',
      ].join('\n'),
      'utf-8',
    )
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/design-preview')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      adapter?: string
      manifest?: { stories?: Array<{ id?: string }> }
    }
    expect(body.adapter).toBe('guildhall-portable')
    expect(body.manifest?.stories?.[0]?.id).toBe('pantry-filter.default')
  })
})
