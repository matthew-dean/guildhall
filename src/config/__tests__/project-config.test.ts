import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureProjectLocalStateIgnored, readProjectConfig, updateProjectConfig } from '../project-config.js'

const TMP = join(tmpdir(), `guildhall-project-config-test-${process.pid}`)

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
      '!.guildhall/',
      '!.guildhall/*.yaml',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
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
      '!.guildhall/',
      '!.guildhall/*.yaml',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
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
      '!.guildhall/',
      '!.guildhall/*.yaml',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
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
      '!.guildhall/',
      '!.guildhall/*.yaml',
      '.guildhall/config.yaml',
      '.guildhall/worktrees/',
      '',
    ].join('\n'))
  })

  it('keeps paid-provider fallback unset until a project explicitly opts in', () => {
    const project = join(TMP, 'provider-policy')
    mkdirSync(project, { recursive: true })

    expect(readProjectConfig(project).allowPaidProviderFallback).toBeUndefined()

    updateProjectConfig(project, { allowPaidProviderFallback: true })

    expect(readProjectConfig(project).allowPaidProviderFallback).toBe(true)
  })
})
