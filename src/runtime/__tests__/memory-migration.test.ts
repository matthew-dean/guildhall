import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  getProjectContextDebugLedgerPath,
  getProjectLocalHistoryDir,
  getProjectRecentEventsPath,
  getProjectStateDir,
  getProjectTranscriptPath,
} from '@guildhall/sessions'
import { migrateLegacyMemoryToLocalHistory } from '../memory-migration.js'

let tmp: string
let projectRoot: string
let memoryDir: string

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-memory-migration-'))
  process.env.GUILDHALL_DATA_DIR = path.join(tmp, 'data')
  projectRoot = path.join(tmp, 'project')
  memoryDir = path.join(projectRoot, 'memory')
  await fs.mkdir(path.join(memoryDir, 'exploring'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'exploring', 'task-1.md'), 'legacy exploring transcript\n', 'utf8')
  await fs.mkdir(path.join(memoryDir, 'transcripts', 'task-2'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'transcripts', 'task-2', 'transcript.md'), 'legacy task transcript\n', 'utf8')
  await fs.mkdir(path.join(memoryDir, 'sessions', 'abc'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'sessions', 'abc', 'session.json'), '{"ok":true}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'events.ndjson'), '{"event":"old"}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'recent-events.jsonl'), '{"event":"recent"}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'TASKS.json'), JSON.stringify([{ id: 'task-1' }], null, 2), 'utf8')
  await fs.writeFile(path.join(memoryDir, 'MEMORY.md'), '# Project Memory\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'DECISIONS.md'), '# Decisions\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'PROGRESS.md'), '# Progress\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'agent-settings.yaml'), 'version: 1\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'learning.json'), '{"preferences":[]}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'codebase-map.yaml'), 'version: 1\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'codebase-map.history.jsonl'), '{"refresh":1}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'context-debug.jsonl'), '{"taskId":"task-1"}\n', 'utf8')
  await fs.mkdir(path.join(memoryDir, 'context-debug', 'task-1'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'context-debug', 'task-1', 'snapshot.md'), '# Snapshot\n', 'utf8')
  await fs.mkdir(path.join(memoryDir, 'tasks', 'task-1'), { recursive: true })
  await fs.writeFile(path.join(memoryDir, 'tasks', 'task-1', 'checkpoint.json'), '{"intent":"continue"}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'tasks', 'task-1', 'review-packet.md'), '# Review\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, 'bootstrap.json'), '{"ok":false}\n', 'utf8')
  await fs.writeFile(path.join(memoryDir, '.session-epoch'), '7\n', 'utf8')
  await fs.writeFile(
    path.join(projectRoot, '.gitignore'),
    ['node_modules', '/memory/exploring/', '/memory/recent-events.jsonl', ''].join('\n'),
    'utf8',
  )
})

afterEach(async () => {
  delete process.env.GUILDHALL_DATA_DIR
  await fs.rm(tmp, { recursive: true, force: true })
})

describe('migrateLegacyMemoryToLocalHistory', () => {
  it('plans every legacy memory file into either committed .guildhall state or user-local history on dry run', async () => {
    const result = await migrateLegacyMemoryToLocalHistory({ projectRoot, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.filesToCopy).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: path.join(memoryDir, 'exploring', 'task-1.md') }),
      expect.objectContaining({ source: path.join(memoryDir, 'transcripts', 'task-2', 'transcript.md') }),
      expect.objectContaining({ source: path.join(memoryDir, 'sessions', 'abc', 'session.json') }),
      expect.objectContaining({ source: path.join(memoryDir, 'events.ndjson') }),
      expect.objectContaining({ source: path.join(memoryDir, 'recent-events.jsonl') }),
      expect.objectContaining({
        source: path.join(memoryDir, 'TASKS.json'),
        destination: path.join(getProjectStateDir(projectRoot), 'TASKS.json'),
      }),
      expect.objectContaining({
        source: path.join(memoryDir, 'agent-settings.yaml'),
        destination: path.join(getProjectStateDir(projectRoot), 'agent-settings.yaml'),
      }),
      expect.objectContaining({
        source: path.join(memoryDir, 'context-debug.jsonl'),
        destination: getProjectContextDebugLedgerPath(projectRoot),
      }),
      expect.objectContaining({
        source: path.join(memoryDir, 'context-debug', 'task-1', 'snapshot.md'),
        destination: path.join(getProjectLocalHistoryDir(projectRoot), 'context-debug', 'snapshots', 'task-1', 'snapshot.md'),
      }),
      expect.objectContaining({
        source: path.join(memoryDir, 'tasks', 'task-1', 'checkpoint.json'),
        destination: path.join(getProjectLocalHistoryDir(projectRoot), 'tasks', 'task-1', 'checkpoint.json'),
      }),
      expect.objectContaining({
        source: path.join(memoryDir, 'tasks', 'task-1', 'review-packet.md'),
        destination: path.join(getProjectLocalHistoryDir(projectRoot), 'tasks', 'task-1', 'review-packet.md'),
      }),
    ]))
    await expect(fs.access(getProjectTranscriptPath(projectRoot, 'exploring', 'task-1'))).rejects.toThrow()
    await expect(fs.access(path.join(memoryDir, 'exploring', 'task-1.md'))).resolves.toBeUndefined()
  })

  it('migrates the whole legacy memory tree, removes memory, and ignores only local Guildhall data', async () => {
    const result = await migrateLegacyMemoryToLocalHistory({
      projectRoot,
      dryRun: false,
      deleteSource: true,
      updateGitignore: true,
    })

    expect(result.copied).toBe(result.filesToCopy.length)
    expect(await fs.readFile(getProjectTranscriptPath(projectRoot, 'exploring', 'task-1'), 'utf8'))
      .toContain('legacy exploring transcript')
    expect(await fs.readFile(path.join(getProjectStateDir(projectRoot), 'TASKS.json'), 'utf8'))
      .toContain('task-1')
    expect(await fs.readFile(path.join(getProjectStateDir(projectRoot), 'MEMORY.md'), 'utf8'))
      .toContain('Project Memory')
    expect(await fs.readFile(path.join(getProjectStateDir(projectRoot), 'DECISIONS.md'), 'utf8'))
      .toContain('Decisions')
    expect(await fs.readFile(path.join(getProjectStateDir(projectRoot), 'PROGRESS.md'), 'utf8'))
      .toContain('Progress')
    expect(await fs.readFile(getProjectContextDebugLedgerPath(projectRoot), 'utf8'))
      .toContain('task-1')
    expect(await fs.readFile(
      path.join(getProjectLocalHistoryDir(projectRoot), 'context-debug', 'snapshots', 'task-1', 'snapshot.md'),
      'utf8',
    )).toContain('Snapshot')
    expect(await fs.readFile(getProjectRecentEventsPath(projectRoot), 'utf8')).toContain('recent')
    expect(await fs.readFile(
      path.join(path.dirname(getProjectRecentEventsPath(projectRoot)), 'events.ndjson'),
      'utf8',
    )).toContain('old')
    expect(await fs.readFile(
      path.join(path.dirname(getProjectRecentEventsPath(projectRoot)), '..', 'transcripts', 'tasks', 'task-2', 'transcript.md'),
      'utf8',
    )).toContain('legacy task transcript')
    await expect(fs.access(path.join(memoryDir, 'exploring', 'task-1.md'))).rejects.toThrow()
    await expect(fs.access(path.join(memoryDir, 'transcripts', 'task-2', 'transcript.md'))).rejects.toThrow()
    await expect(fs.access(path.join(memoryDir, 'sessions', 'abc', 'session.json'))).rejects.toThrow()
    await expect(fs.access(memoryDir)).rejects.toThrow()

    const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8')
    expect(gitignore).toContain('node_modules')
    expect(gitignore).toContain('# BEGIN Guildhall managed')
    expect(gitignore).toContain('!.guildhall/**')
    expect(gitignore).toContain('.guildhall/config.yaml')
    expect(gitignore).toContain('.guildhall/local/')
    expect(gitignore).not.toContain('/memory/')
  })

  it('updates gitignore policy in child Git repos for multi-project workspaces', async () => {
    const workspaceRoot = path.join(tmp, 'workspace')
    const loomaRoot = path.join(workspaceRoot, 'looma')
    const knitRoot = path.join(workspaceRoot, 'knit')
    await fs.mkdir(path.join(loomaRoot, '.git'), { recursive: true })
    await fs.mkdir(path.join(knitRoot, '.git'), { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'guildhall.yaml'), [
      'name: Looma + Knit',
      'id: looma-knit',
      'kind: workspace',
      'projects:',
      '  - id: looma',
      '    path: looma',
      '  - id: knit',
      '    path: knit',
      '',
    ].join('\n'), 'utf8')
    await fs.mkdir(path.join(workspaceRoot, 'memory'), { recursive: true })
    await fs.writeFile(path.join(workspaceRoot, 'memory', 'TASKS.json'), '[]\n', 'utf8')
    await fs.writeFile(path.join(loomaRoot, '.gitignore'), 'dist\n', 'utf8')

    const result = await migrateLegacyMemoryToLocalHistory({
      projectRoot: workspaceRoot,
      dryRun: false,
      deleteSource: false,
      updateGitignore: true,
    })

    expect(result.gitignoreUpdated).toBe(true)
    expect(result.gitignoreRoots.sort()).toEqual([knitRoot, loomaRoot].sort())
    await expect(fs.access(path.join(workspaceRoot, '.gitignore'))).rejects.toThrow()
    expect(await fs.readFile(path.join(loomaRoot, '.gitignore'), 'utf8')).toContain('dist')
    expect(await fs.readFile(path.join(loomaRoot, '.gitignore'), 'utf8')).toContain('.guildhall/worktrees/')
    expect(await fs.readFile(path.join(knitRoot, '.gitignore'), 'utf8')).toContain('.guildhall/worktrees/')
  })
})
