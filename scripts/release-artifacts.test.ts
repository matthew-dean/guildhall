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
    const prWorkflow = read('.github/workflows/pr.yml')
    const docsWorkflow = read('.github/workflows/docs.yml')
    const manifest = JSON.parse(read('package.json')) as { engines?: Record<string, string> }

    expect(workflow).toContain('tags:')
    expect(workflow).toContain("'v*'")
    expect(workflow).toContain("node-version: '22'")
    expect(prWorkflow).toContain("node-version: '22'")
    expect(docsWorkflow).toContain("node-version: '22'")
    expect(manifest.engines?.node).toBe('>=22')
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
    expect(readme).toContain('Node.js 22 or newer')
    expect(quickStart).toContain('Node.js 22 or newer')
    expect(readme).toContain(`GUILDHALL_VERSION=${manifest.version}`)
    expect(quickStart).toContain('GUILDHALL_VERSION=0.9.0')
    expect(quickStart).toContain('guildhall-macos.tar.gz.sha256')
  })

  it('exposes a release smoke command that checks served bundle freshness', () => {
    const manifest = JSON.parse(read('package.json')) as { scripts?: Record<string, string> }
    const script = read('scripts/release-smoke.mjs')

    expect(manifest.scripts?.['smoke:release']).toBe('node scripts/release-smoke.mjs')
    expect(script).toContain('/api/health')
    expect(script).toContain('health.git?.shortCommit')
    expect(script).toContain('GUILDHALL_SMOKE_URL')
    expect(script).toContain('process.exitCode = 1')
  })

  it('includes runtime release metadata in build, macOS package, and release smoke checks', () => {
    const build = read('build.mjs')
    const macosPackage = read('scripts/build-macos-package.mjs')
    const smoke = read('scripts/release-smoke.mjs')

    expect(build).toContain('release-manifest.json')
    expect(build).toContain('buildReleaseManifest')
    expect(macosPackage).toContain('releaseManifestRelativePath')
    expect(macosPackage).toContain('dist/release-manifest.json')
    expect(smoke).toContain('release-manifest.json')
    expect(smoke).toContain('default runtime image')
  })

  it('publishes the 0.9 runtime image to GHCR with immutable and minor-line tags', () => {
    const workflow = read('.github/workflows/runtime-image.yml')

    expect(workflow).toContain('ghcr.io/matthew-dean/guildhall-runtime-debian')
    expect(workflow).toContain('0.9.0-trixie-node22-python313-playwright')
    expect(workflow).toContain('0.9-trixie-node22-python313-playwright')
    expect(workflow).toContain('runtime/Containerfile')
    expect(workflow).toContain('docker/metadata-action')
    expect(workflow).toContain('docker/build-push-action')
    expect(workflow).toContain('outputs.digest')
  })

  it('keeps package install lazy by not pulling runtime images from installer paths', () => {
    const installer = read('scripts/install.sh')
    const macosPackage = read('scripts/build-macos-package.mjs')

    expect(installer).not.toContain('podman pull')
    expect(installer).not.toContain('ghcr.io/matthew-dean/guildhall-runtime-debian')
    expect(macosPackage).not.toContain('podman pull')
    expect(macosPackage).not.toContain('ghcr.io/matthew-dean/guildhall-runtime-debian')
  })
})
