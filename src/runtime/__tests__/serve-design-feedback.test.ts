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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-serve-design-feedback-'))
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  configDir = path.join(os.tmpdir(), `guildhall-config-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  process.env.GUILDHALL_CONFIG_DIR = configDir
  projectId = bootstrapWorkspace(tmpDir, { name: 'Design Feedback Test' }).id ?? path.basename(tmpDir)
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

describe('design feedback API', () => {
  it('reports design feedback without machine-local development target status', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/design-feedback')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      feedback?: { findings?: unknown[] }
      designSystemDevelopmentTargets?: unknown
    }
    expect(body.feedback?.findings).toEqual([])
    expect(body.designSystemDevelopmentTargets).toBeUndefined()
  })

  it('records and routes reusable design-system findings without requiring a local target', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl('/api/project/design-feedback/findings'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'finding-filter-state',
        summary: 'Segmented filter selected state is unclear in compact mobile layouts.',
        source: { kind: 'reviewer', artifactId: 'pantry-filter.default' },
        severity: 'high',
        dimension: 'interaction-semantics',
        designSystem: 'foundation',
        suggestedClassification: 'reusable-pattern',
      }),
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      routed?: {
        candidate?: { targetDesignSystem?: string }
        designSystemImprovement?: { targetPackage?: string }
      }
      designSystemDevelopmentTargets?: unknown
    }
    expect(body.routed?.candidate?.targetDesignSystem).toBe('foundation')
    expect(body.routed?.designSystemImprovement?.targetPackage).toBe('core')
    expect(body.designSystemDevelopmentTargets).toBeUndefined()
  })

  it('captures owner feedback and builds a design decision packet', async () => {
    const { app } = buildServeApp({ projectPath: tmpDir })

    const feedbackRes = await app.fetch(new Request(projectUrl('/api/project/design-feedback/owner-feedback'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'owner-show-all',
        summary: 'Show all should be a segmented filter choice, not a command-looking button.',
        sentiment: 'revise',
        status: 'accepted',
        target: {
          artifactId: 'design-proof-pantry',
          screenshotRef: 'proof/show-all.png',
          selector: '[data-testid="show-all"]',
          componentName: 'PantryFilter',
          viewport: 'desktop-1280',
        },
        rationaleTags: ['better-controls'],
      }),
    }))

    expect(feedbackRes.status).toBe(200)
    const feedbackBody = await feedbackRes.json() as {
      feedback?: { ownerFeedback?: unknown[]; decisions?: unknown[] }
      ownerFeedback?: { id?: string }
    }
    expect(feedbackBody.ownerFeedback?.id).toBe('owner-show-all')
    expect(feedbackBody.feedback?.ownerFeedback).toHaveLength(1)
    expect(feedbackBody.feedback?.decisions).toHaveLength(1)

    const packetRes = await app.fetch(new Request(projectUrl('/api/project/design-feedback/decision-packet'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedbackIds: ['owner-show-all'] }),
    }))

    expect(packetRes.status).toBe(200)
    const packetBody = await packetRes.json() as {
      packet?: { feedbackIds?: string[]; workerContext?: string }
      feedback?: { decisionPackets?: unknown[] }
    }
    expect(packetBody.packet?.feedbackIds).toEqual(['owner-show-all'])
    expect(packetBody.packet?.workerContext).toContain('Show all')
    expect(packetBody.feedback?.decisionPackets).toHaveLength(1)
  })

})
