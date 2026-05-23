import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

describe('release artifact contract', () => {
  it('builds and uploads the macOS installer artifact from version tags', () => {
    const workflow = read('.github/workflows/release.yml')

    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain('pnpm model:bakeoff')
    expect(workflow).toContain('pnpm build:macos-package')
    expect(workflow).toContain('guildhall-macos.tar.gz')
    expect(workflow).toContain('guildhall-macos.tar.gz.sha256')
    expect(workflow).toContain('softprops/action-gh-release')
  })

  it('keeps the documented curl installer tied to GitHub latest releases', () => {
    const installer = read('scripts/install.sh')
    const manifest = JSON.parse(read('package.json')) as { version: string }
    const readme = read('README.md')
    const quickStart = read('docs/guide/quick-start.md')

    const curlCommand =
      'curl -fsSL https://raw.githubusercontent.com/matthew-dean/guildhall/main/scripts/install.sh | sh'

    expect(installer).toContain(
      'https://github.com/matthew-dean/guildhall/releases/latest/download/guildhall-macos.tar.gz',
    )
    expect(installer).toContain(
      'https://github.com/matthew-dean/guildhall/releases/download/v${VERSION}/guildhall-macos.tar.gz',
    )
    expect(installer).toContain('guildhall-macos.tar.gz.sha256')
    expect(installer).toContain('shasum -a 256')
    expect(installer).toContain('Checksum mismatch')
    expect(readme).toContain(curlCommand)
    expect(quickStart).toContain(curlCommand)
    expect(readme).toContain(`GUILDHALL_VERSION=${manifest.version}`)
    expect(quickStart).toContain(`GUILDHALL_VERSION=${manifest.version}`)
    expect(quickStart).toContain('guildhall-macos.tar.gz.sha256')
  })

  it('exposes a release smoke command that checks served bundle freshness', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const script = read('scripts/release-smoke.mjs')

    expect(manifest.scripts?.['smoke:release']).toBe('node scripts/release-smoke.mjs')
    expect(script).toContain('/api/stale-server')
    expect(script).toContain('/api/version')
    expect(script).toContain('GUILDHALL_SMOKE_URL')
    expect(script).toContain('process.exitCode = 1')
  })
})
