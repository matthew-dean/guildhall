import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildContext } from '../context-builder.js'
import { buildEffectiveMemoryPacket } from '../effective-memory-packet.js'
import { recordMemoryObservation } from '../memory-store.js'
import { writeContextDebugRecord } from '../context-observability.js'
import { updateProjectConfig } from '@guildhall/config'
import {
  acceptStructuralMap,
  draftStructuralMap,
  submitStructuralMapForReview,
} from '../structural-map.js'
import type { Task } from '@guildhall/core'
import { recordMemoryEvent } from '@guildhall/memory-core'

let tmpDir: string
let memoryDir: string
let previousHome: string | undefined
let previousDataDir: string | undefined

beforeEach(async () => {
  previousHome = process.env.HOME
  previousDataDir = process.env.GUILDHALL_DATA_DIR
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-effective-memory-'))
  process.env.HOME = tmpDir
  process.env.GUILDHALL_DATA_DIR = path.join(tmpDir, 'data')
  memoryDir = path.join(tmpDir, 'project', '.guildhall')
  await fs.mkdir(memoryDir, { recursive: true })
})

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-memory',
    title: 'Render proof path in Journey drawer',
    description: 'Update src/web/surfaces/drawer/JourneyTab.svelte so proof paths are easy to inspect.',
    domain: 'frontend',
    projectPath: path.dirname(memoryDir),
    status: 'in_progress',
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
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
    spec: '## Summary\nRender proof path details in Journey.',
    ...overrides,
  }
}

afterEach(async () => {
  if (previousHome === undefined) delete process.env.HOME
  else process.env.HOME = previousHome
  if (previousDataDir === undefined) delete process.env.GUILDHALL_DATA_DIR
  else process.env.GUILDHALL_DATA_DIR = previousDataDir
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('effective memory packet', () => {
  it('selects memory by accepted structural scope ids before flat project memory', async () => {
    const projectRoot = path.dirname(memoryDir)
    await fs.writeFile(path.join(projectRoot, 'package.json'), `${JSON.stringify({
      name: '@fixture/root',
      private: true,
      packageManager: 'pnpm@10.0.0',
    }, null, 2)}\n`)
    await fs.writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    await fs.mkdir(path.join(projectRoot, 'packages', 'core'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'packages', 'core', 'package.json'), `${JSON.stringify({
      name: '@fixture/core',
      scripts: { test: 'vitest run packages/core' },
    }, null, 2)}\n`)
    await fs.mkdir(path.join(projectRoot, 'packages', 'docs'), { recursive: true })
    await fs.writeFile(path.join(projectRoot, 'packages', 'docs', 'package.json'), `${JSON.stringify({
      name: '@fixture/docs',
      scripts: { build: 'vitepress build docs' },
    }, null, 2)}\n`)
    const draft = await draftStructuralMap({
      projectId: 'fixture',
      projectRoot,
      now: '2026-06-01T12:00:00.000Z',
    })
    await submitStructuralMapForReview({
      projectRoot,
      mapId: draft.id,
      actor: 'coordinator:fixture',
      now: '2026-06-01T12:01:00.000Z',
    })
    await acceptStructuralMap({
      projectRoot,
      mapId: draft.id,
      actor: 'owner',
      now: '2026-06-01T12:02:00.000Z',
    })
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'core-domain-rule',
        scope: 'project',
        type: 'codebase_knowledge',
        status: 'active',
        summary: 'Core runtime tests are the right proof path.',
        content: 'Use focused core runtime tests before wider checks.',
        tags: ['runtime'],
        domains: [],
        structuralScopes: ['domain:core', 'package:fixture-core'],
        taskKinds: [],
        fileAreas: [],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        source: 'test',
      },
    })
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'docs-domain-rule',
        scope: 'project',
        type: 'codebase_knowledge',
        status: 'active',
        summary: 'Docs builds prove content package changes.',
        content: 'Use docs build for docs package work.',
        tags: ['runtime'],
        domains: [],
        structuralScopes: ['package:fixture-docs'],
        taskKinds: [],
        fileAreas: [],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-06-01T12:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        source: 'test',
      },
    })

    const packet = await buildEffectiveMemoryPacket({
      memoryDir,
      task: task({
        title: 'Fix core runtime behavior',
        description: 'Update packages/core/src/index.ts and run runtime proof.',
        domain: 'runtime',
      }),
    })

    expect(packet.included.map(record => record.id)).toContain('core-domain-rule')
    expect(packet.included.map(record => record.id)).not.toContain('docs-domain-rule')
    expect(packet.withheld).toContainEqual(expect.objectContaining({
      id: 'docs-domain-rule',
      reason: 'structural-scope:mismatch',
    }))
  })

  it('includes active matching memory and withholds proposed or risky memory with evidence refs', async () => {
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'active-proof-ui',
        scope: 'project',
        type: 'codebase_knowledge',
        status: 'active',
        summary: 'JourneyTab is the drawer surface for proof handoffs.',
        content: 'Use JourneyTab.svelte for proof-path and completion-handoff rendering.',
        tags: ['proof', 'ui'],
        domains: ['frontend'],
        taskKinds: ['ui'],
        fileAreas: ['src/web/surfaces/drawer'],
        confidence: 'high',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [{ kind: 'artifact', ref: 'src/web/surfaces/drawer/JourneyTab.svelte', summary: 'Canonical UI surface.' }],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      },
    })
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'proposed-risky',
        scope: 'project',
        type: 'product_idea',
        status: 'proposed',
        summary: 'Replace Journey with a dashboard.',
        content: 'Do not inject before approval.',
        tags: ['ui'],
        domains: ['frontend'],
        taskKinds: ['ui'],
        fileAreas: ['src/web'],
        confidence: 'low',
        risk: 'high',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      },
    })

    const packet = await buildEffectiveMemoryPacket({
      memoryDir,
      task: task(),
      maxRecords: 6,
    })

    expect(packet.included.map((record) => record.id)).toEqual(['active-proof-ui'])
    expect(packet.withheld).toEqual([
      expect.objectContaining({ id: 'proposed-risky', reason: 'status:proposed' }),
    ])
    expect(packet.evidenceRefs).toEqual([
      expect.objectContaining({ ref: 'src/web/surfaces/drawer/JourneyTab.svelte' }),
    ])
    expect(packet.rendered).toContain('## Effective Memory')
    expect(packet.rendered).toContain('JourneyTab is the drawer surface')
    expect(packet.rendered).not.toContain('Replace Journey')
  })

  it('includes system-local memory-core candidates in the effective memory rendering', async () => {
    await recordMemoryEvent({
      projectRoot: path.dirname(memoryDir),
      event: {
        scope: {
          kind: 'task_thread',
          projectId: path.basename(path.dirname(memoryDir)),
          taskId: 'task-memory',
          agentRole: 'worker',
          threadId: 'task-memory',
        },
        source: {
          kind: 'progress',
          ref: 'PROGRESS.md#memory-core',
          path: '.guildhall/PROGRESS.md',
          capturedAt: '2026-06-06T12:00:00.000Z',
        },
        content: {
          summary: 'Memory-core says Journey proof should keep source drill-down.',
        },
        metadata: {
          projectId: path.basename(path.dirname(memoryDir)),
          taskId: 'task-memory',
          retention: 'task_lifecycle',
          risk: 'low',
        },
      },
    })

    const packet = await buildEffectiveMemoryPacket({
      memoryDir,
      task: task(),
    })

    expect(packet.memoryCorePacket?.health).toMatchObject({
      adapter: 'mastra',
      fallbackUsed: false,
      semanticRecallEnabled: false,
    })
    expect(packet.rendered).toContain('## Memory-Core Candidate Packet')
    expect(packet.rendered).toContain('Memory-core says Journey proof')
    expect(packet.evidenceRefs).toEqual([
      expect.objectContaining({ ref: 'PROGRESS.md#memory-core' }),
    ])
  })

  it('honors the project memory substrate kill switch', async () => {
    updateProjectConfig(path.dirname(memoryDir), {
      memory: { substrate: 'deterministic', semanticRecall: false },
    })
    await recordMemoryEvent({
      projectRoot: path.dirname(memoryDir),
      event: {
        scope: {
          kind: 'task_thread',
          projectId: path.basename(path.dirname(memoryDir)),
          taskId: 'task-memory',
          agentRole: 'worker',
          threadId: 'task-memory',
        },
        source: {
          kind: 'progress',
          ref: 'PROGRESS.md#deterministic-switch',
          path: '.guildhall/PROGRESS.md',
          capturedAt: '2026-06-06T12:00:00.000Z',
        },
        content: {
          summary: 'Deterministic substrate should remain available.',
        },
        metadata: {
          projectId: path.basename(path.dirname(memoryDir)),
          taskId: 'task-memory',
          retention: 'task_lifecycle',
          risk: 'low',
        },
      },
    })

    const packet = await buildEffectiveMemoryPacket({
      memoryDir,
      task: task(),
    })

    expect(packet.memoryCorePacket?.health).toMatchObject({
      adapter: 'deterministic',
      fallbackUsed: true,
    })
    expect(packet.rendered).toContain('Deterministic substrate should remain available')
  })

  it('injects active memory into buildContext and keeps proposed memory inert', async () => {
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'accepted-user-pref',
        scope: 'user_global',
        type: 'user_preference',
        status: 'active',
        summary: 'Do not dual-write legacy formats when a migration exists.',
        content: 'Use migrations to carry old state forward; new writes should use the canonical store.',
        tags: ['migration'],
        domains: ['runtime'],
        taskKinds: ['migration'],
        fileAreas: ['src/runtime'],
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
        id: 'unaccepted',
        scope: 'project',
        type: 'project_fact',
        status: 'proposed',
        summary: 'Unaccepted idea should not be injected.',
        content: 'This should remain withheld.',
        tags: ['migration'],
        domains: ['runtime'],
        taskKinds: ['migration'],
        fileAreas: ['src/runtime'],
        confidence: 'medium',
        risk: 'low',
        freshness: 'fresh',
        evidenceRefs: [],
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
        source: 'test',
      },
    })

    const ctx = await buildContext(task({
      title: 'Migrate runtime command evidence',
      description: 'Stop dual-writing legacy JSONL in src/runtime/project-runtime-command.ts.',
      domain: 'runtime',
    }), memoryDir)

    expect(ctx.effectiveMemory).toContain('## Effective Memory')
    expect(ctx.effectiveMemory).toContain('Do not dual-write legacy formats')
    expect(ctx.formatted).toContain('Do not dual-write legacy formats')
    expect(ctx.formatted).not.toContain('Unaccepted idea should not be injected')
  })

  it('records memory use in context debug records', async () => {
    await recordMemoryObservation({
      memoryDir,
      record: {
        id: 'used-memory',
        scope: 'project',
        type: 'project_habit',
        status: 'active',
        summary: 'Use Journey for proof rendering.',
        content: 'Journey is the proof rendering surface.',
        tags: ['ui'],
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
    const ctx = await buildContext(task(), memoryDir)

    const debug = await writeContextDebugRecord({
      memoryDir,
      workspacePath: path.dirname(memoryDir),
      task: task(),
      ctx,
      agentName: 'worker-agent',
      modelId: 'test-model',
      prompt: ctx.formatted,
    })

    expect(debug.memoryPacket).toMatchObject({
      included: [{ id: 'used-memory', type: 'project_habit', scope: 'project' }],
      withheld: [],
    })
    expect(debug.sections.some((section) => section.key === 'effectiveMemory' && section.included)).toBe(true)
  })
})
