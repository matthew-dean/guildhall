import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { projectSkillProposalsPath } from '@guildhall/skills'
import { projectStatePathFromMemoryDir } from '@guildhall/sessions'

import {
  MemoryRecord,
  listMemoryRecords,
  recordMemoryObservation,
  updateMemoryStatus,
} from '../memory-store.js'

let tmpDir: string
let memoryDir: string
let previousHome: string | undefined

beforeEach(async () => {
  previousHome = process.env.HOME
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-store-'))
  process.env.HOME = tmpDir
  memoryDir = path.join(tmpDir, 'project', '.guildhall')
  await fs.mkdir(memoryDir, { recursive: true })
})

describe('memory store', () => {
  it('defines lifecycle states and memory types', () => {
    const record = MemoryRecord.parse({
      id: 'mem-1',
      scope: 'project',
      type: 'project_fact',
      status: 'observed',
      summary: 'This project uses Svelte drawers for task detail.',
      content: 'Task detail surfaces live under src/web/surfaces/drawer.',
      tags: ['ui', 'drawer'],
      domains: ['frontend'],
      taskKinds: ['ui'],
      fileAreas: ['src/web/surfaces/drawer'],
      confidence: 'high',
      risk: 'low',
      freshness: 'fresh',
      evidenceRefs: [{ kind: 'artifact', ref: 'MEMORY.md', summary: 'Project memory entry.' }],
      createdAt: '2026-05-28T00:00:00.000Z',
      updatedAt: '2026-05-28T00:00:00.000Z',
      source: 'memory-store',
    })

    expect(record.status).toBe('observed')
    expect(record.type).toBe('project_fact')
  })

  it('keeps legacy MEMORY.md outside live typed memory retrieval', async () => {
    const memoryMarkdownPath = projectStatePathFromMemoryDir(memoryDir, 'MEMORY.md')
    await fs.mkdir(path.dirname(memoryMarkdownPath), { recursive: true })
    await fs.writeFile(memoryMarkdownPath, [
      '# Memory',
      '',
      '## Frontend',
      'Use shared Button before adding local button styles.',
    ].join('\n'), 'utf8')
    await fs.writeFile(projectStatePathFromMemoryDir(memoryDir, 'learning.json'), JSON.stringify({
      version: 1,
      suggestedLearnings: [
        {
          id: 'project-active',
          source: 'user_correction',
          summary: 'Prefer task-scoped proof paths for UI work.',
          evidence: [{ kind: 'task', summary: 'Correction during proof-path work.', ref: 'task-1' }],
          scope: 'project',
          destination: 'project_memory',
          confidence: 'high',
          risk: 'low',
          requiresApproval: true,
          status: 'active',
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
        {
          id: 'project-proposed',
          source: 'review',
          summary: 'Maybe use a new framework.',
          evidence: [],
          scope: 'project',
          destination: 'project_memory',
          confidence: 'low',
          risk: 'high',
          requiresApproval: true,
          status: 'suggested',
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
      ],
    }), 'utf8')
    await fs.mkdir(path.dirname(projectSkillProposalsPath(memoryDir)), { recursive: true })
    await fs.writeFile(projectSkillProposalsPath(memoryDir), JSON.stringify({
      version: 1,
      proposals: [{
        id: 'drawer-skill',
        name: 'Drawer proof checks',
        description: 'Check drawer Journey surfaces after runtime evidence changes.',
        routingKeys: ['domain:looma'],
        content: 'Open the drawer and verify Journey proof sections.',
        status: 'active',
        risk: 'low',
        requiresApproval: true,
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        activatedAt: '2026-05-28T00:01:00.000Z',
      }],
    }), 'utf8')
    await fs.mkdir(path.join(tmpDir, '.guildhall'), { recursive: true })
    await fs.writeFile(path.join(tmpDir, '.guildhall', 'learning.json'), JSON.stringify({
      version: 1,
      suggestedLearnings: [{
        id: 'user-active',
        source: 'user_correction',
        summary: 'Do not dual-write legacy formats when a migration exists.',
        evidence: [{ kind: 'task', summary: 'Runtime command evidence correction.' }],
        scope: 'user_global',
        destination: 'user_preference',
        confidence: 'high',
        risk: 'low',
        requiresApproval: true,
        status: 'active',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      }],
    }), 'utf8')

    const records = await listMemoryRecords({ memoryDir })

    expect(records.map((record) => record.id)).not.toContain('memory-md-frontend')
    expect(records.map((record) => record.id)).toEqual(expect.arrayContaining([
      'learning-project-active',
      'learning-project-proposed',
      'skill-drawer-skill',
      'learning-user-active',
    ]))
    expect(records.find((record) => record.id === 'learning-project-active')).toMatchObject({
      status: 'active',
      type: 'project_fact',
      scope: 'project',
    })
    expect(records.find((record) => record.id === 'learning-project-proposed')).toMatchObject({
      status: 'proposed',
      risk: 'high',
    })
  })

  it('retrieves deterministically by status, scope, type, domain, tags, confidence, risk, file area, and freshness', async () => {
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'fresh-ui',
        scope: 'project',
        type: 'codebase_knowledge',
        status: 'active',
        summary: 'Drawer Journey owns visible proof surfaces.',
        content: 'Use JourneyTab for proof handoff rendering.',
        tags: ['ui', 'proof'],
        domains: ['frontend'],
        taskKinds: ['ui'],
        fileAreas: ['src/web/surfaces/drawer'],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      },
    })
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'stale-backend',
        scope: 'project',
        type: 'project_fact',
        status: 'retired',
        summary: 'Old backend note.',
        content: 'Do not use.',
        tags: ['backend'],
        domains: ['backend'],
        taskKinds: ['api'],
        fileAreas: ['src/runtime'],
        confidence: 'medium',
        risk: 'medium',
        freshness: 'stale',
        evidenceRefs: [],
        createdAt: '2026-05-27T00:00:00.000Z',
        updatedAt: '2026-05-27T00:00:00.000Z',
        source: 'test',
      },
    })

    const records = await listMemoryRecords({
      memoryDir,
      query: {
        statuses: ['active'],
        scopes: ['project'],
        types: ['codebase_knowledge'],
        tags: ['proof'],
        domains: ['frontend'],
        taskKinds: ['ui'],
        fileAreas: ['src/web/surfaces/drawer/JourneyTab.svelte'],
        minConfidence: 'high',
        maxRisk: 'low',
        freshness: ['fresh'],
      },
    })

    expect(records.map((record) => record.id)).toEqual(['fresh-ui'])
  })

  it('updates memory lifecycle without changing proposed memory implicitly', async () => {
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'candidate',
        scope: 'project',
        type: 'project_habit',
        status: 'proposed',
        summary: 'Proposed habit.',
        content: 'Stay inert until accepted.',
        tags: [],
        domains: [],
        taskKinds: [],
        fileAreas: [],
        confidence: 'medium',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      },
    })

    expect((await listMemoryRecords({ memoryDir, query: { statuses: ['active'] } }))).toEqual([])

    await updateMemoryStatus({
      memoryDir,
      id: 'candidate',
      status: 'active',
      updatedAt: '2026-05-28T00:10:00.000Z',
    })

    expect(await listMemoryRecords({ memoryDir, query: { statuses: ['active'] } })).toMatchObject([
      { id: 'candidate', status: 'active', updatedAt: '2026-05-28T00:10:00.000Z' },
    ])
  })
})
