import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
})
