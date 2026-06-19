import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

import { bootstrapWorkspace, writeWorkspaceConfig } from '@guildhall/config'
import type { Task, TaskQueue } from '@guildhall/core'
import { writeProjectStateJsonAsync } from '@guildhall/sessions'
import { buildServeApp, dashboardHtml } from '../serve.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })))
})

function makeTask(projectPath: string, overrides: Partial<Task>): Task {
  const now = new Date().toISOString()
  return {
    id: 'task-1',
    title: 'A task',
    description: 'Task description.',
    domain: 'core',
    projectPath,
    status: 'ready',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    adjudications: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

async function seedTasks(projectPath: string, tasks: Task[]): Promise<void> {
  const queue: TaskQueue = { version: 1, lastUpdated: new Date().toISOString(), tasks }
  await writeProjectStateJsonAsync(projectPath, 'TASKS.json', queue)
}

function projectUrl(projectId: string, route: string): string {
  const url = new URL(`http://localhost${route}`)
  url.searchParams.set('projectId', projectId)
  return url.toString()
}

describe('dashboardHtml', () => {
  it('renders the SvelteKit app shell or a clear build fallback', () => {
    const html = dashboardHtml()

    expect(html).toContain('<title>Guildhall</title>')
    if (existsSync('dist/web/index.html')) {
      expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />')
      expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/icons/genfavicon-32.png" />')
      expect(html).toContain('<link rel="icon" type="image/png" sizes="16x16" href="/icons/genfavicon-16.png" />')
      expect(html).toContain('<link rel="apple-touch-icon" href="/apple-touch-icon.png" />')
      expect(html).toContain('<link rel="manifest" href="/site.webmanifest" />')
      expect(html).toContain('/_app/')
      expect(html).toContain('Guildhall requires JavaScript.')
    } else {
      expect(html).toContain('web app not built: index.html')
    }
  })
})

describe('dashboard static assets', () => {
  it('serves PNG icons without text encoding corruption', async () => {
    const { app } = buildServeApp({})

    const res = await app.fetch(new Request('http://localhost/icons/genfavicon-64.png'))

    if (existsSync('dist/web/icons/genfavicon-64.png')) {
      const bytes = new Uint8Array(await res.arrayBuffer())
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('image/png')
      expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    } else {
      expect(res.status).toBe(404)
      expect(await res.text()).toContain('web asset not built: icons/genfavicon-64.png')
    }
  })

  it('serves SvelteKit chunk assets from the static web output', async () => {
    const { app } = buildServeApp({})

    const missing = await app.fetch(new Request('http://localhost/_app/immutable/missing.js'))

    expect(missing.status).toBe(404)
    expect(await missing.text()).toContain('web asset not built: _app/immutable/missing.js')
  })
})

describe('GET /api/project/spine', () => {
  it('returns the scoped project orientation spine for the selected project', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-spine-'))
    tempDirs.push(tmpDir)
    const projectId = bootstrapWorkspace(tmpDir, { name: `Spine API ${path.basename(tmpDir)}` }).id ?? path.basename(tmpDir)
    await seedTasks(tmpDir, [
      makeTask(tmpDir, {
        id: 'task-anti-sameness',
        title: 'Anti-sameness safeguards',
        description: 'Prevent repeated scene shapes and voice flattening.',
        status: 'ready',
        workKind: 'feature_spec',
        spec: 'Define repeated-scene and voice-flattening safeguards.',
        productBrief: { approvedAt: '2026-06-10T00:00:00.000Z' } as Task['productBrief'],
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl(projectId, '/api/project/spine')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      spine?: {
        projectId?: string
        scope?: { label?: string }
        summary?: { headline?: string; selectedScopeLabel?: string | null }
        roots?: Array<{ id?: string; title?: string; maturity?: string }>
        gaps?: Array<{ kind?: string }>
      }
    }
    expect(body.spine?.projectId).toBe(projectId)
    expect(body.spine?.scope?.label).toBe('Current task scope')
    expect(body.spine?.summary?.selectedScopeLabel).toBe('Current task scope')
    expect(body.spine?.roots?.find(node => node.id === 'work:task-anti-sameness')).toMatchObject({
      id: 'work:task-anti-sameness',
      title: 'Anti-sameness safeguards',
      maturity: 'needs_breakdown',
    })
    expect(body.spine?.gaps?.map(gap => gap.kind)).toContain('missing_charter')
  })

  it('includes the orientation spine in the main project detail payload', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-spine-main-'))
    tempDirs.push(tmpDir)
    const projectId = bootstrapWorkspace(tmpDir, { name: `Spine Main ${path.basename(tmpDir)}` }).id ?? path.basename(tmpDir)
    await seedTasks(tmpDir, [
      makeTask(tmpDir, {
        id: 'task-release-map',
        title: 'Map the first bounded release',
        status: 'ready',
        workKind: 'feature_spec',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl(projectId, '/api/project')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      orientationSpine?: {
        scope?: { label?: string }
        summary?: { selectedScopeLabel?: string | null; includedWorkCount?: number }
      }
    }
    expect(body.orientationSpine?.scope?.label).toBe('Current task scope')
    expect(body.orientationSpine?.summary?.selectedScopeLabel).toBe('Current task scope')
    expect(body.orientationSpine?.summary?.includedWorkCount).toBe(1)
  })

  it('keeps release blockers consistent across project, spine, and thread payloads', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-spine-release-blockers-'))
    tempDirs.push(tmpDir)
    const projectId = bootstrapWorkspace(tmpDir, { name: `Spine Blockers ${path.basename(tmpDir)}` }).id ?? path.basename(tmpDir)
    await seedTasks(tmpDir, [
      makeTask(tmpDir, {
        id: 'task-spec-review',
        title: 'Define the packet proof contract',
        status: 'spec_review',
        workKind: 'feature_spec',
        spec: 'Draft packet proof contract.',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const [projectRes, spineRes, threadRes] = await Promise.all([
      app.fetch(new Request(projectUrl(projectId, '/api/project'))),
      app.fetch(new Request(projectUrl(projectId, '/api/project/spine'))),
      app.fetch(new Request(projectUrl(projectId, '/api/project/thread'))),
    ])

    expect(projectRes.status).toBe(200)
    expect(spineRes.status).toBe(200)
    expect(threadRes.status).toBe(200)

    const projectBody = await projectRes.json() as {
      orientationSpine?: { release?: { state?: string; blockers?: Array<{ id?: string; label?: string }> } }
    }
    const spineBody = await spineRes.json() as {
      spine?: { release?: { state?: string; blockers?: Array<{ id?: string; label?: string }> } }
    }
    const threadBody = await threadRes.json() as {
      orientationSpine?: { release?: { state?: string; blockers?: Array<{ id?: string; label?: string }> } }
    }

    for (const payload of [
      projectBody.orientationSpine,
      spineBody.spine,
      threadBody.orientationSpine,
    ]) {
      expect(payload?.release?.state).toBe('blocked')
      expect(payload?.release?.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'task-spec-review',
          label: 'Define the packet proof contract is waiting for spec review.',
        }),
      ]))
    }
  })

  it('infers a charter from existing project docs without requiring new intake', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-spine-charter-'))
    tempDirs.push(tmpDir)
    const projectId = bootstrapWorkspace(tmpDir, { name: `Spine Charter ${path.basename(tmpDir)}` }).id ?? path.basename(tmpDir)
    await fs.writeFile(
      path.join(tmpDir, 'README.md'),
      [
        '# Story Harness',
        '',
        'Story Harness is a workspace for fiction-writing software that helps authors revise coherent novels.',
        '',
        'The target is authors and editors working on long-form fiction.',
        '',
        'The system should preserve voice while making story continuity visible.',
      ].join('\n'),
    )
    await seedTasks(tmpDir, [
      makeTask(tmpDir, {
        id: 'task-coherence-reviewer',
        title: 'Build coherence reviewer',
        status: 'ready',
        workKind: 'feature_spec',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl(projectId, '/api/project/spine')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      spine?: {
        charter?: { goal?: string | null; targetAudience?: string | null; source?: string }
        summary?: { purpose?: string }
        gaps?: Array<{ kind?: string }>
      }
    }
    expect(body.spine?.charter?.source).toBe('inferred')
    expect(body.spine?.charter?.goal).toContain('fiction-writing software')
    expect(body.spine?.charter?.targetAudience).toContain('authors and editors')
    expect(body.spine?.summary?.purpose).toContain('fiction-writing software')
    expect(body.spine?.gaps?.map(gap => gap.kind)).not.toContain('missing_charter')
  })

  it('infers a charter from workspace council and coordinator mandates', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-spine-workspace-charter-'))
    tempDirs.push(tmpDir)
    const projectId = 'looma-knit-test'
    writeWorkspaceConfig(tmpDir, {
      name: `Looma Knit ${path.basename(tmpDir)}`,
      id: projectId,
      kind: 'workspace',
      projects: [
        { id: 'looma', label: 'Looma', type: 'library', path: 'looma' },
        { id: 'knit', label: 'Knit', type: 'app', path: 'knit' },
      ],
      council: {
        mandate: 'Keep Looma generic while letting Knit product needs drive primitive priority.',
        coordinationRules: [],
      },
      coordinators: [
        {
          id: 'looma',
          domain: 'looma',
          path: 'looma',
          mandate: 'Looma is a stack-agnostic UI library built on web standards.',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
        {
          id: 'knit',
          domain: 'knit',
          path: 'knit',
          mandate: 'Knit is a wiki app for small teams.',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
    } as never)
    await seedTasks(tmpDir, [
      makeTask(tmpDir, {
        id: 'task-floating-toolbar',
        title: 'Floating toolbar',
        status: 'review',
        domain: 'looma',
        workKind: 'feature_spec',
        spec: 'Promote the toolbar primitive.',
      }),
    ])
    const { app } = buildServeApp({ projectPath: tmpDir })

    const res = await app.fetch(new Request(projectUrl(projectId, '/api/project/spine')))

    expect(res.status).toBe(200)
    const body = await res.json() as {
      spine?: {
        charter?: { goal?: string | null; targetAudience?: string | null; source?: string }
        summary?: { purpose?: string; includedWorkCount?: number }
        gaps?: Array<{ kind?: string }>
      }
    }
    expect(body.spine?.charter?.source).toBe('inferred')
    expect(body.spine?.charter?.goal).toContain('Keep Looma generic')
    expect(body.spine?.charter?.targetAudience).toContain('Looma library')
    expect(body.spine?.charter?.targetAudience).toContain('Knit app')
    expect(body.spine?.summary?.purpose).toContain('Keep Looma generic')
    expect(body.spine?.summary?.includedWorkCount).toBe(1)
    expect(body.spine?.gaps?.map(gap => gap.kind)).not.toContain('missing_charter')
  })
})
