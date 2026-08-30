import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { readProjectRepositorySignature } from '../project-repository-signature.js'

const tempDirs: string[] = []

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function makeRepository(): { projectRoot: string; remoteRoot: string } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'guildhall-repository-signature-'))
  const remoteRoot = mkdtempSync(join(tmpdir(), 'guildhall-repository-signature-origin-'))
  tempDirs.push(projectRoot, remoteRoot)
  git(projectRoot, ['init', '-b', 'main'])
  git(projectRoot, ['config', 'user.name', 'Guildhall Test'])
  git(projectRoot, ['config', 'user.email', 'guildhall@example.test'])
  writeFileSync(join(projectRoot, 'README.md'), '# fixture\n')
  git(projectRoot, ['add', 'README.md'])
  git(projectRoot, ['commit', '-m', 'seed'])
  git(remoteRoot, ['init', '--bare'])
  git(projectRoot, ['remote', 'add', 'origin', remoteRoot])
  git(projectRoot, ['push', '-u', 'origin', 'main'])
  return { projectRoot, remoteRoot }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('readProjectRepositorySignature', () => {
  it('changes after a push clears an ahead branch even when HEAD stays the same', () => {
    const { projectRoot } = makeRepository()
    writeFileSync(join(projectRoot, 'CHANGELOG.md'), 'first release note\n')
    git(projectRoot, ['add', 'CHANGELOG.md'])
    git(projectRoot, ['commit', '-m', 'release note'])

    const beforePush = readProjectRepositorySignature(projectRoot)
    expect(beforePush).toContain('# branch.ab +1 -0')

    git(projectRoot, ['push', 'origin', 'main'])

    const afterPush = readProjectRepositorySignature(projectRoot)
    expect(afterPush).not.toBe(beforePush)
    expect(afterPush).toContain('# branch.ab +0 -0')
  })

  it('changes when the working tree becomes dirty', () => {
    const { projectRoot } = makeRepository()
    const clean = readProjectRepositorySignature(projectRoot)

    writeFileSync(join(projectRoot, 'README.md'), '# changed fixture\n')

    expect(readProjectRepositorySignature(projectRoot)).not.toBe(clean)
  })

  it('changes after a same-length rewrite restores its original mtime', () => {
    const { projectRoot } = makeRepository()
    const readmePath = join(projectRoot, 'README.md')
    const clean = readProjectRepositorySignature(projectRoot)
    const originalMtime = statSync(readmePath).mtime

    writeFileSync(readmePath, '# revised\n')
    utimesSync(readmePath, originalMtime, originalMtime)

    expect(readProjectRepositorySignature(projectRoot)).not.toBe(clean)
  })

  it('changes for staged, untracked, and removed worktree paths', () => {
    const { projectRoot } = makeRepository()
    const clean = readProjectRepositorySignature(projectRoot)

    writeFileSync(join(projectRoot, 'README.md'), '# changed\n')
    const unstaged = readProjectRepositorySignature(projectRoot)
    expect(unstaged).not.toBe(clean)

    git(projectRoot, ['add', 'README.md'])
    const staged = readProjectRepositorySignature(projectRoot)
    expect(staged).not.toBe(unstaged)

    writeFileSync(join(projectRoot, 'untracked.txt'), 'new file\n')
    const untracked = readProjectRepositorySignature(projectRoot)
    expect(untracked).not.toBe(staged)

    rmSync(join(projectRoot, 'README.md'))
    const removed = readProjectRepositorySignature(projectRoot)
    expect(removed).not.toBe(untracked)
  })

  it('is stable when the repository does not change', () => {
    const { projectRoot } = makeRepository()

    expect(readProjectRepositorySignature(projectRoot)).toBe(readProjectRepositorySignature(projectRoot))
  })

  it('changes when a tracked file inside a submodule becomes dirty', () => {
    const { projectRoot } = makeRepository()
    const { projectRoot: submoduleSource } = makeRepository()
    git(projectRoot, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      submoduleSource,
      'vendor/component',
    ])
    git(projectRoot, ['commit', '-m', 'add component submodule'])
    const clean = readProjectRepositorySignature(projectRoot)

    writeFileSync(join(projectRoot, 'vendor/component/README.md'), '# changed\n')

    expect(readProjectRepositorySignature(projectRoot)).not.toBe(clean)
  })

  it('keeps parent changes observable when a submodule becomes unavailable', () => {
    const { projectRoot } = makeRepository()
    const { projectRoot: submoduleSource } = makeRepository()
    const submodulePath = join(projectRoot, 'vendor/component')
    git(projectRoot, [
      '-c',
      'protocol.file.allow=always',
      'submodule',
      'add',
      submoduleSource,
      'vendor/component',
    ])
    git(projectRoot, ['commit', '-m', 'add component submodule'])
    readProjectRepositorySignature(projectRoot)

    rmSync(submodulePath, { force: true, recursive: true })
    const unavailableSubmodule = readProjectRepositorySignature(projectRoot)
    writeFileSync(join(projectRoot, 'README.md'), '# changed\n')

    expect(readProjectRepositorySignature(projectRoot)).not.toBe(unavailableSubmodule)
  })

  it('does not invoke content filters while observing repository freshness', () => {
    const { projectRoot } = makeRepository()
    const assetPath = join(projectRoot, 'asset.bin')
    const filterScriptPath = join(projectRoot, 'slow-clean-filter.cjs')
    const filterSentinelPath = join(projectRoot, 'slow-clean-filter-invoked')

    writeFileSync(join(projectRoot, '.gitattributes'), '*.bin filter=slow\n')
    writeFileSync(assetPath, 'original asset\n')
    git(projectRoot, ['add', '.gitattributes', 'asset.bin'])
    git(projectRoot, ['commit', '-m', 'track filtered asset'])

    writeFileSync(filterScriptPath, [
      "const fs = require('node:fs')",
      'fs.writeFileSync(process.argv[2], \'invoked\\n\')',
      'process.stdin.pipe(process.stdout)',
      'setTimeout(() => {}, 2_000)',
      '',
    ].join('\n'))
    git(projectRoot, [
      'config',
      'filter.slow.clean',
      `"${process.execPath}" "${filterScriptPath}" "${filterSentinelPath}"`,
    ])

    const clean = readProjectRepositorySignature(projectRoot)
    writeFileSync(assetPath, 'changed asset\n')
    const dirty = readProjectRepositorySignature(projectRoot)

    expect(dirty).not.toBe(clean)
    expect(existsSync(filterSentinelPath)).toBe(false)

    git(projectRoot, ['add', 'asset.bin'])
    expect(existsSync(filterSentinelPath)).toBe(true)
  })

  it('shares one timeout across the complete repository observation', () => {
    const { projectRoot } = makeRepository()
    const gitWrapperRoot = mkdtempSync(join(tmpdir(), 'guildhall-slow-git-'))
    const gitWrapperPath = join(gitWrapperRoot, 'git')
    const gitWrapperSentinelPath = join(gitWrapperRoot, 'invoked')
    tempDirs.push(gitWrapperRoot)
    writeFileSync(gitWrapperPath, [
      '#!/usr/bin/env node',
      "const { spawnSync } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `writeFileSync(${JSON.stringify(gitWrapperSentinelPath)}, 'invoked\\n')`,
      'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300)',
      "const result = spawnSync('/usr/bin/git', process.argv.slice(2), { stdio: 'inherit' })",
      'process.exit(result.status ?? 1)',
      '',
    ].join('\n'))
    chmodSync(gitWrapperPath, 0o755)

    const originalPath = process.env['PATH']
    const startedAt = performance.now()
    let signature: string | null
    try {
      process.env['PATH'] = `${gitWrapperRoot}:${originalPath ?? ''}`
      signature = readProjectRepositorySignature(projectRoot)
    } finally {
      process.env['PATH'] = originalPath
    }
    const elapsedMs = performance.now() - startedAt

    expect(signature).toContain('workspace:unavailable:')
    expect(existsSync(gitWrapperSentinelPath)).toBe(true)
    expect(elapsedMs).toBeGreaterThan(600)
    expect(elapsedMs).toBeLessThan(1_200)
  })
})
