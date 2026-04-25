import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ensureProjectLocalStateIgnored } from '../project-config.js'

const TMP = join(tmpdir(), `guildhall-project-config-test-${process.pid}`)

describe('project config local state guard', () => {
  beforeEach(() => {
    mkdirSync(TMP, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true })
  })

  it('creates .guildhall/ and adds it to the workspace .gitignore', () => {
    const project = join(TMP, 'fresh')

    ensureProjectLocalStateIgnored(project)

    expect(existsSync(join(project, '.guildhall'))).toBe(true)
    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('.guildhall/\n')
  })

  it('preserves existing .gitignore content and does not duplicate .guildhall/', () => {
    const project = join(TMP, 'existing')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'node_modules\n', 'utf8')

    ensureProjectLocalStateIgnored(project)
    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('node_modules\n.guildhall/\n')
  })

  it('leaves an existing .guildhall/ ignore entry alone', () => {
    const project = join(TMP, 'already-ignored')
    mkdirSync(project, { recursive: true })
    writeFileSync(join(project, '.gitignore'), 'dist\n/.guildhall/\n', 'utf8')

    ensureProjectLocalStateIgnored(project)

    expect(readFileSync(join(project, '.gitignore'), 'utf8')).toBe('dist\n/.guildhall/\n')
  })
})
