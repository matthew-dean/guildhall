import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { runtimeExecutableNames } from '../index.js'

const repoRoot = resolve(import.meta.dirname, '../../..')

describe('runtime image contract', () => {
  it('pins the current runtime to Debian trixie with Node 22', async () => {
    const containerfile = await readFile(resolve(repoRoot, 'runtime/Containerfile'), 'utf8')

    expect(containerfile).toContain('FROM node:22-trixie-slim')
    expect(containerfile).toContain('org.opencontainers.image.title="Guildhall Runtime Debian"')
    expect(containerfile).toContain('Project-scoped Guildhall runtime image for 0.11 agent execution')
    expect(containerfile).toContain('GUILDHALL_RUNTIME_OS=debian')
    expect(containerfile).toContain('GUILDHALL_RUNTIME_DEBIAN_VERSION=13')
    expect(containerfile).toContain('GUILDHALL_RUNTIME_DEBIAN_CODENAME=trixie')
    expect(containerfile).toContain('GUILDHALL_RUNTIME_IMAGE_TAG=0.11.0-trixie-node22-python313-playwright')
    expect(containerfile).toContain('GUILDHALL_PROJECT_ROOT=/workspace/project')
    expect(containerfile).toContain('GUILDHALL_HOME=/home/guildhall/.guildhall')
  })

  it('installs every declared runtime executable into the image PATH', async () => {
    const containerfile = await readFile(resolve(repoRoot, 'runtime/Containerfile'), 'utf8')

    for (const name of runtimeExecutableNames) {
      expect(containerfile).toContain(`runtime/bin/${name}`)
      expect(containerfile).toContain(`/usr/local/bin/${name}`)
    }

    expect(containerfile).toContain('ENTRYPOINT ["guildhall-runtime"]')
  })

  it('installs the baseline project toolchain, Corepack, pipx, and Playwright system dependencies', async () => {
    const containerfile = await readFile(resolve(repoRoot, 'runtime/Containerfile'), 'utf8')

    for (const pkg of [
      'bash',
      'build-essential',
      'ca-certificates',
      'coreutils',
      'curl',
      'findutils',
      'git',
      'jq',
      'openssh-client',
      'pipx',
      'python3',
      'python3-venv',
      'ripgrep',
      'tar',
      'unzip',
      'xz-utils',
    ]) {
      expect(containerfile).toContain(pkg)
    }

    expect(containerfile).toContain('corepack enable')
    expect(containerfile).toContain('npx --yes playwright install-deps chromium')
  })
})
