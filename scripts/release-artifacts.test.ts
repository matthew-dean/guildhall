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
    expect(manifest.engines?.node).toBe('>=22.12.0')
    expect(workflow).toContain('pnpm model:bakeoff')
    expect(workflow).toContain('pnpm build:macos-package')
    expect(workflow).toContain('guildhall-macos.tar.gz')
    expect(workflow).toContain('guildhall-macos.tar.gz.sha256')
    expect(workflow).toContain('softprops/action-gh-release')
  })

  it('keeps the documented curl installer tied to GitHub latest releases', () => {
    const installer = read('scripts/install.sh')
    const readme = read('README.md')
    const quickStart = read('docs/guide/quick-start.md')
    const docsIndex = read('docs/index.md')

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
    const pinnedVersion = quickStart.match(/GUILDHALL_VERSION=(\d+\.\d+\.\d+)/)?.[1]
    const publicDocsVersion = docsIndex.match(/\/releases\/(\d+\.\d+\.\d+)/)?.[1]
    expect(pinnedVersion).toBeDefined()
    expect(pinnedVersion).toBe(publicDocsVersion)
    expect(readme).toContain(`GUILDHALL_VERSION=${pinnedVersion}`)
    expect(quickStart).toContain(`GUILDHALL_VERSION=${pinnedVersion}`)
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

  it('builds the web app through SvelteKit and Vite instead of a single esbuild outfile', () => {
    const build = read('build.mjs')
    const manifest = JSON.parse(read('package.json')) as {
      devDependencies?: Record<string, string>
    }

    expect(manifest.devDependencies?.['@sveltejs/kit']).toBeTruthy()
    expect(build).toContain("node_modules/.bin/vite")
    expect(build).toContain("spawnSync(viteBin, ['build']")
    expect(build).not.toContain("outfile: join(WEB_OUT_DIR, 'app.js')")
    expect(read('svelte.config.js')).toContain('@sveltejs/adapter-static')
    expect(read('vite.config.ts')).toContain('sveltekit')
  })

  it('keeps web route surfaces behind dynamic imports for route-level chunks', () => {
    const router = read('src/web/Router.svelte')

    expect(router).not.toContain("import ProjectsHome from './surfaces/ProjectsHome.svelte'")
    expect(router).toContain("import('./surfaces/ProjectsHome.svelte')")
    expect(router).not.toContain("import ProjectView from './surfaces/ProjectView.svelte'")
    expect(router).toContain("import('./surfaces/ProjectView.svelte')")
  })

  it('keeps project tabs behind dynamic imports inside the project route chunk', () => {
    const projectView = read('src/web/surfaces/ProjectView.svelte')

    for (const tab of [
      'ProjectOverviewTab',
      'ThreadTab',
      'NeedsYouTab',
      'WorkTab',
      'WorkspaceImportTab',
      'ProjectAttachFlow',
      'FactsTab',
      'TimelineTab',
      'ReleaseTab',
      'SettingsTab',
      'ProjectStructurePanel',
    ]) {
      expect(projectView).not.toContain(`import ${tab} from`)
    }
    expect(projectView).toContain("import('./project/ProjectOverviewTab.svelte')")
    expect(projectView).toContain("import('./project/ThreadTab.svelte')")
    expect(projectView).toContain("import('./project/WorkTab.svelte')")
    expect(projectView).toContain("import('./project/ProjectAttachFlow.svelte')")
    expect(projectView).toContain("import('./project/structure/ProjectStructurePanel.svelte')")
  })

  it('publishes the current runtime image to GHCR with immutable and minor-line tags', () => {
    const workflow = read('.github/workflows/runtime-image.yml')

    expect(workflow).toContain('ghcr.io/matthew-dean/guildhall-runtime-debian')
    expect(workflow).toContain("'v0.13.*'")
    expect(workflow).toContain('0.13.0-trixie-node22-python313-playwright')
    expect(workflow).toContain('0.13-trixie-node22-python313-playwright')
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

  it('builds the local runtime image through a Docker-or-Podman helper', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    const buildScript = read('scripts/runtime-image-build.mjs')
    const smokeScript = read('scripts/runtime-image-smoke.mjs')

    expect(pkg.scripts['runtime:image:build']).toBe('node scripts/runtime-image-build.mjs')
    expect(buildScript).toContain('docker')
    expect(buildScript).toContain('podman')
    expect(smokeScript).toContain('docker')
    expect(smokeScript).toContain('podman')
    expect(buildScript).toContain('buildReleaseManifest')
    expect(smokeScript).toContain('buildReleaseManifest')
    expect(buildScript).toContain('DOCKER_BUILDKIT')
    expect(buildScript).toContain('GUILDHALL_CONTAINER_BUILD_TIMEOUT_MS')
    expect(buildScript).toContain('GUILDHALL_RUNTIME_IMAGE_VERSION')
    expect(smokeScript).toContain('GUILDHALL_RUNTIME_IMAGE_VERSION')
  })

  it('keeps runtime image build context narrow and excludes git sockets', () => {
    const dockerignore = read('.dockerignore')

    expect(dockerignore).toContain('.git')
    expect(dockerignore).toContain('dist')
    expect(dockerignore).toContain('node_modules')
    expect(dockerignore).toContain('!.dockerignore')
    expect(dockerignore).toContain('!runtime/**')
  })
})
