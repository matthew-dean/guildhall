import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runMemoryCorePrototype } from '../prototype-runner.js'

let tmp: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-prototype-'))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('runMemoryCorePrototype', () => {
  it('runs against opted-in project state, skips non-Guildhall roots, and writes reviewable reports', async () => {
    const projectRoot = path.join(tmp, 'project')
    const skippedRoot = path.join(tmp, 'not-guildhall')
    const outputDir = path.join(tmp, 'out')
    await fs.mkdir(path.join(projectRoot, '.guildhall'), { recursive: true })
    await fs.mkdir(skippedRoot, { recursive: true })
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'TASKS.json'), JSON.stringify({
      version: 1,
      tasks: [{ id: 'task-1', status: 'blocked', title: 'Shrink memory state' }],
    }), 'utf8')
    await fs.writeFile(path.join(projectRoot, '.guildhall', 'PROGRESS.md'), 'Decision: keep memory system-local.\n', 'utf8')

    const report = await runMemoryCorePrototype({
      projectRoots: [projectRoot, skippedRoot],
      outputDir,
    })

    expect(report.projects).toHaveLength(1)
    expect(report.projects[0]).toMatchObject({
      projectRoot,
      eventsRecorded: expect.any(Number),
      filesScanned: expect.any(Number),
    })
    expect(report.projects[0]?.eventsRecorded).toBeGreaterThan(0)
    expect(report.projects[0]?.packetBytes).toBeGreaterThan(0)

    const json = JSON.parse(await fs.readFile(path.join(outputDir, 'report.json'), 'utf8')) as typeof report
    expect(json.projects[0]?.projectRoot).toBe(projectRoot)

    const markdown = await fs.readFile(path.join(outputDir, 'report.md'), 'utf8')
    expect(markdown).toContain('# Memory Core Prototype Report')
    expect(markdown).toContain(projectRoot)
    expect(markdown).toContain('Included packet summaries:')
  })
})
