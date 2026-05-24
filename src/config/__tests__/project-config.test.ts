import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureProjectLocalStateIgnored, readProjectConfig, updateProjectConfig } from '../project-config.js'

const TMP = join(tmpdir(), `guildhall-project-config-test-${process.pid}`)
const EXTRA_LOCAL_IGNORES = [
  '.guildhall/cache/',
  '.guildhall/tmp/',
  '.guildhall/logs/',
  '.guildhall/sessions/',
  '.guildhall/transcripts/',
  '.guildhall/context-debug/',
  '.guildhall/events/',
  '.guildhall/checkpoints/',
]

describe('project config local state guard', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('creates .guildhall/ and ignores only local/private project state', () => {
    const project = join(TMP, 'fresh')

    ensureProjectLocalStateIgnored(project)

    expect(existsSync(join(project, '.guildhall'))).toBe(true)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe([
      '# BEGIN Guildhall managed',
      '# Shared Guildhall project state is trackable by default.',
      '!.guildhall/',
      '!.guildhall/**',
      '# Local/private Guildhall state stays out of git.',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '.guildhall/local/',
      ...EXTRA_LOCAL_IGNORES,
      '# END Guildhall managed',
      '',
    ].join('\n'))
  })

  it('preserves existing .gitignore content and does not duplicate local/private entries', () => {
    const project = join(TMP, 'existing')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n', 'utf8')

    ensureProjectLocalStateIgnored(project)
    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe([
      'node_modules',
      '',
      '# BEGIN Guildhall managed',
      '# Shared Guildhall project state is trackable by default.',
      '!.guildhall/',
      '!.guildhall/**',
      '# Local/private Guildhall state stays out of git.',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '.guildhall/local/',
      ...EXTRA_LOCAL_IGNORES,
      '# END Guildhall managed',
      '',
    ].join('\n'))
  })

  it('keeps old broad .guildhall ignores from hiding shared metadata', () => {
    const project = join(TMP, 'already-ignored')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'dist\n/.guildhall/\n', 'utf8')

    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe([
      'dist',
      '/.guildhall/',
      '',
      '# BEGIN Guildhall managed',
      '# Shared Guildhall project state is trackable by default.',
      '!.guildhall/',
      '!.guildhall/**',
      '# Local/private Guildhall state stays out of git.',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '.guildhall/local/',
      ...EXTRA_LOCAL_IGNORES,
      '# END Guildhall managed',
      '',
    ].join('\n'))
  })

  it('repairs older .guildhall/* ignores so shared yaml metadata can be committed', () => {
    const project = join(TMP, 'old-shared-ignore')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), '.guildhall/*\n', 'utf8')

    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe([
      '.guildhall/*',
      '',
      '# BEGIN Guildhall managed',
      '# Shared Guildhall project state is trackable by default.',
      '!.guildhall/',
      '!.guildhall/**',
      '# Local/private Guildhall state stays out of git.',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '.guildhall/local/',
      ...EXTRA_LOCAL_IGNORES,
      '# END Guildhall managed',
      '',
    ].join('\n'))
  })

  it('updates an older Guildhall-managed block in place', () => {
    const project = join(TMP, 'managed-block')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), [
      'node_modules',
      '',
      '# BEGIN Guildhall managed',
      '!.guildhall/',
      '!.guildhall/*.yaml',
      '.guildhall/config.yaml',
      '# END Guildhall managed',
      '',
    ].join('\n'), 'utf8')

    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe([
      'node_modules',
      '',
      '# BEGIN Guildhall managed',
      '# Shared Guildhall project state is trackable by default.',
      '!.guildhall/',
      '!.guildhall/**',
      '# Local/private Guildhall state stays out of git.',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '.guildhall/local/',
      ...EXTRA_LOCAL_IGNORES,
      '# END Guildhall managed',
      '',
    ].join('\n'))
  })

  it('makes Git ignore co-located local state while leaving shared .guildhall state trackable', () => {
    const project = join(TMP, 'git-ignore-behavior')
    mkdirSync(project, { recursive: true })
    execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' })

    ensureProjectLocalStateIgnored(project)
    writeFileSync(join(project, '.guildhall', 'TASKS.json'), '[]\n', 'utf8')
    writeFileSync(join(project, '.guildhall', 'agent-settings.yaml'), 'version: 1\n', 'utf8')
    writeFileSync(join(project, '.guildhall', 'config.yaml'), 'preferredProvider: codex\n', 'utf8')
    mkdirSync(join(project, '.guildhall', 'worktrees', 'task-1'), { recursive: true })
    writeFileSync(join(project, '.guildhall', 'worktrees', 'task-1', 'file.txt'), 'local\n', 'utf8')
    mkdirSync(join(project, '.guildhall', 'context-debug'), { recursive: true })
    writeFileSync(join(project, '.guildhall', 'context-debug', 'snapshot.md'), '# local\n', 'utf8')

    for (const ignored of [
      '.guildhall/config.yaml',
      '.guildhall/worktrees/task-1/file.txt',
      '.guildhall/context-debug/snapshot.md',
    ]) {
      expect(spawnSync('git', ['check-ignore', '-q', ignored], { cwd: project }).status).toBe(0)
    }

    for (const trackable of [
      '.guildhall/TASKS.json',
      '.guildhall/agent-settings.yaml',
    ]) {
      expect(spawnSync('git', ['check-ignore', '-q', trackable], { cwd: project }).status).toBe(1)
    }
  })

  it('keeps paid-provider fallback unset until a project explicitly opts in', () => {
    const project = join(TMP, 'provider-policy')
    mkdirSync(project, { recursive: true })

    expect(readProjectConfig(project).allowPaidProviderFallback).toBeUndefined()

    updateProjectConfig(project, { allowPaidProviderFallback: true })

    expect(readProjectConfig(project).allowPaidProviderFallback).toBe(true)
  })
})
