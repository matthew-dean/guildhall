import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  acceptStructuralMap,
  draftStructuralMap,
  submitStructuralMapForReview,
} from '../structural-map.js'
import { summarizeStructuralTaskContext } from '../structural-task-context.js'

let previousConfigDir: string | undefined
let systemDir: string
let projectRoot: string

beforeEach(async () => {
  previousConfigDir = process.env.GUILDHALL_CONFIG_DIR
  systemDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-context-system-'))
  projectRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'guildhall-task-context-project-'))
  process.env.GUILDHALL_CONFIG_DIR = systemDir
})

afterEach(async () => {
  if (previousConfigDir === undefined) delete process.env.GUILDHALL_CONFIG_DIR
  else process.env.GUILDHALL_CONFIG_DIR = previousConfigDir
  await fsp.rm(systemDir, { recursive: true, force: true })
  await fsp.rm(projectRoot, { recursive: true, force: true })
})

describe('summarizeStructuralTaskContext', () => {
  it('turns accepted structural routing into user-facing task start context', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        { dir: 'packages/core', name: '@example/core', scripts: { test: 'vitest run packages/core' } },
        { dir: 'packages/docs', name: '@example/docs', scripts: { build: 'vitepress build docs' } },
      ],
    })
    const accepted = await acceptFreshMap(projectRoot, 'example')

    const context = summarizeStructuralTaskContext({
      map: accepted,
      task: {
        id: 'task-core-render',
        title: 'Fix core render buffer placement',
        files: ['packages/core/src/render.ts'],
        text: 'Eval/render work in core needs focused proof.',
      },
    })

    expect(context).toEqual(expect.objectContaining({
      taskId: 'task-core-render',
      status: 'matched',
      likelyArea: expect.objectContaining({
        id: 'package:example-core',
        label: '@example/core',
        path: 'packages/core',
      }),
      primaryDomain: expect.objectContaining({
        id: 'domain:core',
        label: 'core',
      }),
    }))
    expect(context.checks).toContainEqual(expect.objectContaining({
      id: 'exec:example-core:test',
      command: 'pnpm --filter @example/core test',
    }))
    expect(context.reasons).toEqual(expect.arrayContaining([
      'Matched files under packages/core.',
      'Uses the core work area.',
    ]))
  })

  it('returns unmatched context when the accepted map cannot route the task', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        { dir: 'packages/core', name: '@example/core', scripts: { test: 'vitest run packages/core' } },
      ],
    })
    const accepted = await acceptFreshMap(projectRoot, 'example')

    const context = summarizeStructuralTaskContext({
      map: accepted,
      task: {
        id: 'task-unknown',
        title: 'Investigate customer request',
        text: 'No clear package or domain evidence yet.',
      },
    })

    expect(context.status).toBe('unmatched')
    expect(context.summary).toBe('Guildhall does not have a confident structural match for this task yet.')
    expect(context.reasons).toContain('No package or domain matched the current task text.')
  })

  it('does not present setup tasks as routed project work', async () => {
    await writeRepoFixture(projectRoot, {
      name: '@example/root',
      workspace: ['packages/*'],
      packages: [
        { dir: 'packages/compat', name: '@example/compat', scripts: { test: 'vitest run packages/compat' } },
      ],
    })
    const accepted = await acceptFreshMap(projectRoot, 'example')

    const context = summarizeStructuralTaskContext({
      map: accepted,
      task: {
        id: 'task-meta-intake',
        title: 'Inspect the repo and draft starter tasks',
        text: 'Infer compatible package routing and setup details.',
      },
    })

    expect(context.status).toBe('unavailable')
    expect(context.checks).toEqual([])
    expect(context.reasons).toContain('Setup tasks shape the project map instead of being routed through it.')
  })
})

async function writeRepoFixture(root: string, input: {
  name: string
  workspace: string[]
  packages: Array<{
    dir: string
    name: string
    scripts?: Record<string, string>
  }>
}): Promise<void> {
  await fsp.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: input.name,
    private: true,
    scripts: { test: 'vitest run' },
    packageManager: 'pnpm@10.0.0',
  }, null, 2)}\n`)
  await fsp.writeFile(path.join(root, 'pnpm-workspace.yaml'), `packages:\n${input.workspace.map(pattern => `  - ${pattern}`).join('\n')}\n`)
  for (const pkg of input.packages) {
    await fsp.mkdir(path.join(root, pkg.dir, 'src'), { recursive: true })
    await fsp.writeFile(path.join(root, pkg.dir, 'package.json'), `${JSON.stringify({
      name: pkg.name,
      scripts: pkg.scripts ?? {},
    }, null, 2)}\n`)
    await fsp.writeFile(path.join(root, pkg.dir, 'src', 'index.ts'), `export const name = ${JSON.stringify(pkg.name)}\n`)
  }
}

async function acceptFreshMap(root: string, projectId: string) {
  const draft = await draftStructuralMap({
    projectId,
    projectRoot: root,
    now: '2026-06-01T12:00:00.000Z',
  })
  await submitStructuralMapForReview({
    projectRoot: root,
    mapId: draft.id,
    actor: `coordinator:${projectId}`,
    now: '2026-06-01T12:01:00.000Z',
  })
  return acceptStructuralMap({
    projectRoot: root,
    mapId: draft.id,
    actor: 'owner',
    now: '2026-06-01T12:02:00.000Z',
  })
}
