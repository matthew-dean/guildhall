import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectBootstrapHypothesis } from '../detect-bootstrap.js'

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'guildhall-detect-'))
}

describe('detectBootstrapHypothesis', () => {
  let dir = ''
  beforeEach(() => {
    dir = makeTmp()
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns empty hypothesis when no package.json is present', () => {
    const h = detectBootstrapHypothesis(dir)
    expect(h.commands).toEqual([])
    expect(h.successGates).toEqual([])
    expect(h.packageManager).toBeUndefined()
  })

  it('detects pnpm when pnpm-lock.yaml exists', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: {} }))
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 6.0\n')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('pnpm')
    expect(h.commands).toEqual(['pnpm install'])
  })

  it('detects yarn when yarn.lock exists', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'yarn.lock'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('yarn')
    expect(h.commands).toEqual(['yarn install'])
  })

  it('detects bun when bun.lockb exists', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'bun.lockb'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('bun')
    expect(h.commands).toEqual(['bun install'])
  })

  it('falls back to npm when only package-lock.json exists', () => {
    writeFileSync(join(dir, 'package.json'), '{}')
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('npm')
    expect(h.commands).toEqual(['npm install'])
  })

  it('prefers packageManager field over lockfile when both disagree', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@9.0.0' }))
    writeFileSync(join(dir, 'package-lock.json'), '{}')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('pnpm')
    expect(h.commands).toEqual(['pnpm install'])
  })

  it('picks up test/typecheck/build/lint scripts as successGates when present', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', build: 'tsc -p .', lint: 'eslint .' },
      }),
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.successGates).toEqual([
      'pnpm typecheck',
      'pnpm build',
      'pnpm test',
      'pnpm lint',
    ])
  })

  it('omits successGates that are not defined as scripts', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.successGates).toEqual(['pnpm test'])
  })

  it('returns hypothesis commands in install-first order', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' } }),
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.commands[0]).toBe('pnpm install')
  })

  it('detects python projects via pyproject.toml (uv) and proposes uv sync', () => {
    writeFileSync(join(dir, 'pyproject.toml'), '[tool.uv]\n')
    writeFileSync(join(dir, 'uv.lock'), '')
    const h = detectBootstrapHypothesis(dir)
    expect(h.packageManager).toBe('uv')
    expect(h.commands).toEqual(['uv sync'])
  })
})
