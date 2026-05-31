import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bootstrapWorkspace } from '@guildhall/config'
import { buildServeApp } from '../serve.js'

let tmpDir: string
let dataDir: string
let projectId: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-design-surrogate-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Native Preview Test' }).id ?? path.basename(tmpDir)
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

describe('GET /api/project/design-intent-surrogate', () => {
  it('returns an explicit approximate surrogate readout for native projects', async () => {
    await fs.mkdir(path.join(tmpDir, 'App.xcodeproj'), { recursive: true })
    await fs.mkdir(path.join(tmpDir, 'App'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, 'App', 'ContentView.swift'), 'import SwiftUI\n', 'utf-8')
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/design-intent-surrogate')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      platform?: string
      previewMode?: string
      approximate?: boolean
      nativeProofRequired?: boolean
      warning?: string
    }
    expect(body).toMatchObject({
      platform: 'ios',
      previewMode: 'browser-surrogate',
      approximate: true,
      nativeProofRequired: true,
    })
    expect(body.warning).toContain('Native platform proof')
  })
})
