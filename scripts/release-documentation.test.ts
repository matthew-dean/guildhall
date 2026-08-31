import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(__dirname, '..')
const temporaryRoots: string[] = []

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

describe('release documentation gate', () => {
  it('requires a release note, capture manifest, screenshot set, and versioned snapshot', () => {
    const fixture = createReleaseDocsFixture()

    const result = check(fixture)

    expect(result).toContain('Release documentation is complete for 0.13.2.')
  })

  it('fails clearly when the versioned screenshot snapshot is incomplete', () => {
    const fixture = createReleaseDocsFixture()
    fs.rmSync(path.join(fixture, 'docs/versions/0.13.2/assets/ui-audit/0-13-2/owner-review.png'))

    expect(() => check(fixture)).toThrow(/Expected at least two release screenshots/)
  })
})

function createReleaseDocsFixture() {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-release-docs-'))
  temporaryRoots.push(fixture)
  write(fixture, 'docs/releases/0.13.2.md', [
    '# Guildhall 0.13.2',
    '![Owner review](../assets/ui-audit/0-13-2/owner-review.png)',
  ].join('\n'))
  write(fixture, 'docs/assets/ui-audit/0-13-2/README.md', [
    '# Guildhall 0.13.2 UI Screenshot Evidence',
    'Route: /projects/t-minus-t/overview',
    'Viewport: 1280x800',
  ].join('\n'))
  write(fixture, 'docs/assets/ui-audit/0-13-2/owner-review.png', '')
  write(fixture, 'docs/assets/ui-audit/0-13-2/work-review.png', '')
  write(fixture, 'docs/versions/0.13.2/releases/0.13.2.md', '# Guildhall 0.13.2')
  write(fixture, 'docs/versions/0.13.2/assets/ui-audit/0-13-2/owner-review.png', '')
  write(fixture, 'docs/versions/0.13.2/assets/ui-audit/0-13-2/work-review.png', '')
  return fixture
}

function check(fixture: string) {
  return execFileSync(
    process.execPath,
    ['scripts/check-release-documentation.mjs', '0.13.2', '--root', fixture],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

function write(rootPath: string, relativePath: string, contents: string) {
  const target = path.join(rootPath, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}
