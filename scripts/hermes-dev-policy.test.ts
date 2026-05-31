import fs from 'node:fs/promises'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '..')

describe('Hermes dev comparator policy', () => {
  it('keeps Hermes out of install/runtime dependency and publish surfaces', async () => {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
      bundledDependencies?: string[]
      bundleDependencies?: string[]
      devDependencies?: Record<string, string>
      files?: string[]
      scripts?: Record<string, string>
    }
    const packageSections = [
      manifest.dependencies,
      manifest.optionalDependencies,
      manifest.devDependencies,
    ].filter(Boolean) as Array<Record<string, string>>
    const installSections = [
      manifest.dependencies,
      manifest.optionalDependencies,
    ].filter(Boolean) as Array<Record<string, string>>

    for (const section of installSections) {
      expect(Object.keys(section).filter(name => /hermes/i.test(name))).toEqual([])
    }
    expect(manifest.bundledDependencies ?? manifest.bundleDependencies ?? []).not.toContain('hermes')
    expect(manifest.files ?? []).not.toContain('.guildhall')
    expect(manifest.files ?? []).not.toContain('scripts/install-hermes-dev.mjs')
    expect(manifest.files ?? []).not.toContain('scripts/compare-hermes-quality.mjs')

    expect(packageSections.some(section => Object.keys(section).some(name => /hermes/i.test(name)))).toBe(false)
    expect(manifest.scripts?.['dev:hermes:install']).toBe('node ./scripts/install-hermes-dev.mjs')
    expect(manifest.scripts?.['benchmarks:compare:hermes']).toContain('--hermes-root .guildhall/dev-tools/hermes-agent')
    expect(manifest.scripts?.['benchmarks:compare:hermes-quality']).toBe('pnpm build && node scripts/compare-hermes-quality.mjs')
    expect(manifest.scripts?.['benchmarks:compare:hermes-app-explicit']).toBe('pnpm build && node scripts/compare-hermes-quality.mjs --mode app-explicit')
    expect(manifest.scripts?.['benchmarks:compare:hermes-app-infer']).toBe('pnpm build && node scripts/compare-hermes-quality.mjs --mode app-infer')
  })

  it('ignores the local Hermes checkout and home under Guildhall private state', async () => {
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.guildhall/dev-tools/')
  })
})
