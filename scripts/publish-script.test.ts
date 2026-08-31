import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const root = path.resolve(__dirname, '..')

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd })
}

async function addBareOrigin(cwd: string): Promise<string> {
  const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-origin-'))
  await runGit(remote, ['init', '--bare'])
  await runGit(cwd, ['remote', 'add', 'origin', remote])
  return remote
}

async function writeExecutable(file: string, source: string): Promise<void> {
  await fs.writeFile(file, source)
  await fs.chmod(file, 0o755)
}

async function createMinimalReleaseFixture(tmp: string): Promise<void> {
  await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/releases'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/guide'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'dist/web/_app/immutable'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'src/web/generated'), { recursive: true })

  await fs.copyFile(path.join(root, 'scripts/publish.mjs'), path.join(tmp, 'scripts/publish.mjs'))
  await fs.copyFile(path.join(root, 'scripts/release-manifest.mjs'), path.join(tmp, 'scripts/release-manifest.mjs'))
  await fs.copyFile(path.join(root, 'scripts/resolve-runtime-image-digest.mjs'), path.join(tmp, 'scripts/resolve-runtime-image-digest.mjs'))
  await fs.copyFile(path.join(root, 'scripts/version-docs.mjs'), path.join(tmp, 'scripts/version-docs.mjs'))
  await fs.copyFile(path.join(root, 'scripts/docs-generation.mjs'), path.join(tmp, 'scripts/docs-generation.mjs'))
  await fs.copyFile(
    path.join(root, 'scripts/check-release-documentation.mjs'),
    path.join(tmp, 'scripts/check-release-documentation.mjs'),
  )
  await fs.writeFile(
    path.join(tmp, 'scripts/build-macos-package.mjs'),
    'console.log("fake macOS package")\n',
  )
  await fs.writeFile(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'guildhall-test-release', version: '0.4.0' }, null, 2) + '\n',
  )
  await fs.writeFile(
    path.join(tmp, 'docs/index.md'),
    'Docs default to Guildhall 0.4.0. [Start](/versions/0.4.0/guide/quick-start).\n',
  )
  await fs.writeFile(
    path.join(tmp, 'docs/releases/index.md'),
    [
      '# Releases',
      '',
      'The published docs root defaults to Guildhall 0.4.0, matching the current npm package.',
      '',
    ].join('\n'),
  )
  await fs.writeFile(path.join(tmp, 'README.md'), 'Install GUILDHALL_VERSION=0.4.0\n')
  await fs.writeFile(path.join(tmp, 'docs/guide/quick-start.md'), 'Install GUILDHALL_VERSION=0.4.0\n')
  await fs.writeFile(
    path.join(tmp, 'src/web/generated/help-topics.json'),
    JSON.stringify({ start: { href: '/help/start' } }),
  )
  await fs.writeFile(path.join(tmp, 'dist/web/index.html'), '<script type="module" src="/_app/immutable/app.js"></script>\n')
  await fs.writeFile(path.join(tmp, 'dist/web/_app/immutable/app.js'), 'window.helpHref="/help/start"\n')
}

async function gitHeadMessage(cwd: string): Promise<string> {
  const { stdout } = await execFileP('git', ['log', '-1', '--pretty=%s'], { cwd })
  return stdout.trim()
}

describe('release publish script', () => {
  it('restores package.json when a pre-publish gate fails after the version bump', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      await fs.mkdir(path.join(tmp, 'docs/versions/0.5.0/guide'), { recursive: true })
      await fs.writeFile(path.join(tmp, 'docs/versions/0.5.0/guide/quick-start.md'), '# Old patch docs\n')
      await fs.writeFile(
        path.join(tmp, 'scripts/version-docs.mjs'),
        [
          'import { mkdirSync, writeFileSync } from "node:fs"',
          'import { join } from "node:path"',
          'const version = process.argv[2]',
          'mkdirSync(join(process.cwd(), "docs/versions", version, "guide"), { recursive: true })',
          'writeFileSync(join(process.cwd(), "docs/versions", version, "guide/quick-start.md"), "# New docs\\n")',
          '',
        ].join('\n'),
      )

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ]; then',
          '  exit 1',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )
      const fakePnpm = path.join(fakeBin, 'pnpm')
      await writeExecutable(
        fakePnpm,
        '#!/bin/sh\nif [ "$1" = "typecheck" ]; then exit 1; fi\nexit 0\n',
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.1', '--no-push'], {
        cwd: tmp,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'))
      const docsHome = await fs.readFile(path.join(tmp, 'docs/index.md'), 'utf8')
      const releasesIndex = await fs.readFile(path.join(tmp, 'docs/releases/index.md'), 'utf8')
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('Bumped package.json to 0.5.1')
      expect(result.output).toContain('Command failed: pnpm typecheck')
      expect(manifest.version).toBe('0.4.0')
      expect(docsHome).toContain('Guildhall 0.4.0')
      expect(releasesIndex).toContain('Guildhall 0.4.0')
      await expect(fs.stat(path.join(tmp, 'docs/versions/0.5.0/guide/quick-start.md'))).resolves.toBeTruthy()
      await expect(fs.stat(path.join(tmp, 'docs/versions/0.5.1'))).rejects.toThrow()
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 15_000)

  it('skips docs versioning during dry-run publish', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      await writeExecutable(
        path.join(tmp, 'scripts/version-docs.mjs'),
        '#!/bin/sh\necho "version-docs should not run during dry-run" >&2\nexit 42\n',
      )

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'exit 0',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--dry-run', '--skip-tests'], {
        cwd: tmp,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'))
      const docsHome = await fs.readFile(path.join(tmp, 'docs/index.md'), 'utf8')
      await expect(fs.stat(path.join(tmp, 'docs/versions/0.5.0'))).rejects.toThrow()
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('Dry-run: skipping docs versioning and public docs pointer updates.')
      expect(result.output).not.toContain('version-docs should not run during dry-run')
      expect(manifest.version).toBe('0.4.0')
      expect(docsHome).toContain('Guildhall 0.4.0')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('uses the published npm version as the release baseline and bumps package.json forward after publish', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.5.0'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      const operationLog = path.join(tmp, 'release-order.log')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'curl'),
        [
          '#!/bin/sh',
          'printf "curl %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      )
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ] && [ "$2" = "guildhall" ] && [ "$3" = "version" ]; then',
          '  echo "0.4.0"',
          '  exit 0',
          'fi',
          'if [ "$1" = "whoami" ]; then',
          '  echo "guildhall-test"',
          '  exit 0',
          'fi',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "publish" ]; then',
          '  printf "npm publish\\n" >> "$PUBLISH_TEST_LOG"',
          '  exit 0',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])
      const remote = await addBareOrigin(tmp)

      const result = await execFileP('node', ['scripts/publish.mjs', '--remote', 'origin', '0.5.0', '--skip-tests'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
        },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const nextManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      const releaseTag = await execFileP('git', ['tag', '--list', 'v0.5.0'], { cwd: tmp })
      const remoteTag = await execFileP('git', ['ls-remote', '--tags', 'origin', 'refs/tags/v0.5.0'], { cwd: tmp })
      const remoteHead = await execFileP('git', ['rev-parse', 'refs/heads/main'], { cwd: remote })
      const headMessage = await gitHeadMessage(tmp)
      const orderLog = await fs.readFile(operationLog, 'utf8')

      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('Published version: 0.4.0')
      expect(result.output).toContain('Target version:    0.5.0')
      expect(result.output).toContain('Next dev version: 0.5.1')
      expect(result.output).toContain('Pushed main and v0.5.0 to origin.')
      expect(result.output).toContain('GitHub release artifacts for v0.5.0 are available.')
      expect(nextManifest.version).toBe('0.5.1')
      expect(releaseTag.stdout.trim()).toBe('v0.5.0')
      expect(remoteTag.stdout.trim()).toMatch(/refs\/tags\/v0\.5\.0$/)
      expect(remoteHead.stdout.trim()).toBeTruthy()
      expect(headMessage).toBe('chore: start 0.5.1')
      expect(orderLog.indexOf('curl')).toBeLessThan(orderLog.indexOf('npm publish'))
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('prompts npm login before release refs are pushed when npm is not authenticated', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.5.0'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      const operationLogDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-log-'))
      const operationLog = path.join(operationLogDir, 'release-order.log')
      const npmAuthStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-npm-auth-state-'))
      const npmAuthState = path.join(npmAuthStateDir, 'logged-in')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'curl'),
        [
          '#!/bin/sh',
          'printf "curl %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      )
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ] && [ "$2" = "guildhall" ] && [ "$3" = "version" ]; then',
          '  echo "0.4.0"',
          '  exit 0',
          'fi',
          'if [ "$1" = "whoami" ]; then',
          '  if [ -f "$PUBLISH_TEST_NPM_AUTH_STATE" ]; then',
          '    echo "guildhall-test"',
          '    exit 0',
          '  fi',
          '  exit 1',
          'fi',
          'if [ "$1" = "login" ]; then',
          '  printf "npm login\\n" >> "$PUBLISH_TEST_LOG"',
          '  touch "$PUBLISH_TEST_NPM_AUTH_STATE"',
          '  exit 0',
          'fi',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "publish" ]; then',
          '  printf "npm publish\\n" >> "$PUBLISH_TEST_LOG"',
          '  exit 0',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])
      await addBareOrigin(tmp)

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--skip-tests'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
          PUBLISH_TEST_NPM_AUTH_STATE: npmAuthState,
        },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const orderLog = await fs.readFile(operationLog, 'utf8')
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('npm is not logged in for guildhall; starting npm login before release refs are pushed.')
      expect(result.output).toContain('npm authenticated as guildhall-test.')
      expect(orderLog).toContain('npm login')
      expect(orderLog.indexOf('npm login')).toBeLessThan(orderLog.indexOf('curl'))
      expect(orderLog.indexOf('npm login')).toBeLessThan(orderLog.indexOf('npm publish'))
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('resumes when release refs already exist and an annotated local release tag matches HEAD', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.5.0'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
      await fs.writeFile(
        path.join(tmp, 'docs/index.md'),
        'Docs default to Guildhall 0.5.0. [Start](/versions/0.5.0/guide/quick-start).\n',
      )
      await fs.writeFile(
        path.join(tmp, 'docs/releases/index.md'),
        [
          '# Releases',
          '',
          'The published docs root defaults to Guildhall 0.5.0, matching the current npm package.',
          '',
        ].join('\n'),
      )
      await fs.mkdir(path.join(tmp, 'docs/versions/0.5.0/guide'), { recursive: true })
      await fs.mkdir(path.join(tmp, 'docs/versions/0.5.0/releases'), { recursive: true })
      await fs.writeFile(path.join(tmp, 'docs/versions/0.5.0/index.md'), '# Guildhall 0.5.0\n')
      await fs.writeFile(path.join(tmp, 'docs/versions/0.5.0/releases/index.md'), '# Releases\n')
      await fs.writeFile(path.join(tmp, 'docs/versions/0.5.0/guide/quick-start.md'), '# Quick start\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      const operationLog = path.join(tmp, 'release-order.log')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'curl'),
        [
          '#!/bin/sh',
          'printf "curl %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      )
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ] && [ "$2" = "guildhall" ] && [ "$3" = "version" ]; then',
          '  echo "0.4.0"',
          '  exit 0',
          'fi',
          'if [ "$1" = "whoami" ]; then',
          '  echo "guildhall-test"',
          '  exit 0',
          'fi',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "publish" ]; then',
          '  printf "npm publish\\n" >> "$PUBLISH_TEST_LOG"',
          '  exit 0',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'chore(release): guildhall@0.5.0'])
      await runGit(tmp, ['tag', '-a', 'v0.5.0', '-m', 'Guildhall 0.5.0'])
      await addBareOrigin(tmp)
      await runGit(tmp, ['push', 'origin', 'HEAD:main', 'refs/tags/v0.5.0'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--skip-tests'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
        },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const nextManifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      const headMessage = await gitHeadMessage(tmp)
      expect(result.status, result.output).toBe(0)
      expect(result.output).toContain('Remote tag v0.5.0 already exists on origin and matches the local tag; release publish can resume.')
      expect(result.output).toContain('Release refs for main and v0.5.0 are already pushed to origin; resuming.')
      expect(result.output).toContain('Published guildhall@0.5.0')
      expect(result.output).not.toContain('refusing to publish a release that cannot create a fresh GitHub artifact')
      expect(nextManifest.version).toBe('0.5.1')
      expect(headMessage).toBe('chore: start 0.5.1')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('refuses to resume from a checkout newer than the existing release tag', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.5.0'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      const operationLog = path.join(tmp, 'release-order.log')
      await fs.mkdir(fakeBin)
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ]; then echo "0.4.0"; exit 0; fi',
          'if [ "$1" = "whoami" ]; then echo "guildhall-test"; exit 0; fi',
          'printf "npm %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'chore(release): guildhall@0.5.0'])
      await runGit(tmp, ['tag', 'v0.5.0'])
      await fs.writeFile(path.join(tmp, 'post-tag-fix.txt'), 'not part of v0.5.0\n')
      await runGit(tmp, ['add', 'post-tag-fix.txt'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'fix: post-tag change'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--skip-tests'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
        },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      expect(result.status).not.toBe(0)
      expect(result.output).toContain('Check out the tagged release commit before resuming')
      await expect(fs.stat(operationLog)).rejects.toThrow()
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('stages commit and tag without publishing npm when push is disabled', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      await fs.writeFile(
        path.join(tmp, 'docs/index.md'),
        '<p class="gh-home-version">Current docs: <a href="/releases/0.4.0">0.4.0</a>.</p>\n',
      )
      await fs.writeFile(
        path.join(tmp, 'docs/releases/index.md'),
        [
          'The current stable release is [Guildhall 0.4.0](./0.4.0); older snapshots remain',
          'available under [Versions](/versions/0.4.0/guide/quick-start).',
          '',
          '- [0.5.0 (next patch)](./0.5.0) - ready for release.',
        ].join('\n'),
      )
      const operationLog = path.join(tmp, 'release-order.log')

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "view" ]; then',
          '  echo "0.4.0"',
          '  exit 0',
          'fi',
          'if [ "$1" = "publish" ]; then',
          '  printf "npm publish\\n" >> "$PUBLISH_TEST_LOG"',
          '  exit 0',
          'fi',
          'exit 0',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--skip-tests', '--no-push'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
        },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const manifest = JSON.parse(await fs.readFile(path.join(tmp, 'package.json'), 'utf8'))
      const releaseTag = await execFileP('git', ['tag', '--list', 'v0.5.0'], { cwd: tmp })
      const docsHome = await fs.readFile(path.join(tmp, 'docs/index.md'), 'utf8')
      const releasesIndex = await fs.readFile(path.join(tmp, 'docs/releases/index.md'), 'utf8')
      const readme = await fs.readFile(path.join(tmp, 'README.md'), 'utf8')
      const quickStart = await fs.readFile(path.join(tmp, 'docs/guide/quick-start.md'), 'utf8')

      expect(result.status).toBe(0)
      expect(result.output).toContain('skipping npm publish because GitHub release artifacts cannot be verified')
      expect(manifest.version).toBe('0.5.0')
      expect(releaseTag.stdout.trim()).toBe('v0.5.0')
      expect(docsHome).toContain('href="/releases/0.5.0">0.5.0</a>')
      expect(releasesIndex).toContain('Guildhall 0.5.0](./0.5.0)')
      expect(releasesIndex).toContain('/versions/0.5.0/guide/quick-start')
      expect(releasesIndex).not.toContain('(next patch)')
      expect(readme).toContain('GUILDHALL_VERSION=0.5.0')
      expect(quickStart).toContain('GUILDHALL_VERSION=0.5.0')
      await expect(fs.stat(operationLog)).rejects.toThrow()
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('refuses to republish an already published version', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.5.1'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ] && [ "$2" = "guildhall" ] && [ "$3" = "version" ]; then',
          '  echo "0.5.0"',
          '  exit 0',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0', '--skip-tests'], {
        cwd: tmp,
        env: { ...process.env, PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}` },
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      expect(result.status).not.toBe(0)
      expect(result.output).toContain('guildhall@0.5.0 is already published on npm')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('publishes and records the runtime image digest automatically for runtime-backed releases', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)
      const manifestPath = path.join(tmp, 'package.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
      manifest.name = 'guildhall'
      manifest.version = '0.9.0'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')

      const fakeBin = path.join(tmp, 'fake-bin')
      const operationLog = path.join(tmp, 'release-order.log')
      const digestFixture = path.join(tmp, 'digest-sequence.txt')
      await fs.writeFile(digestFixture, 'missing\nsha256:feedface\n')
      await fs.mkdir(fakeBin)
      await writeExecutable(path.join(fakeBin, 'pnpm'), '#!/bin/sh\nexit 0\n')
      await writeExecutable(
        path.join(fakeBin, 'gh'),
        [
          '#!/bin/sh',
          'printf "gh %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'if [ "$1" = "workflow" ] && [ "$2" = "run" ]; then',
          '  exit 0',
          'fi',
          'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
          '  printf \'[{"databaseId":12345,"createdAt":"2099-01-01T00:00:00Z","displayTitle":"Runtime image 0.9.0","url":"https://example.test/run"}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "run" ] && [ "$2" = "watch" ]; then',
          '  exit 0',
          'fi',
          'echo "unexpected gh args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )
      await writeExecutable(
        path.join(fakeBin, 'curl'),
        [
          '#!/bin/sh',
          'printf "curl %s\\n" "$*" >> "$PUBLISH_TEST_LOG"',
          'exit 0',
          '',
        ].join('\n'),
      )
      await writeExecutable(
        path.join(fakeBin, 'npm'),
        [
          '#!/bin/sh',
          'if [ "$1" = "view" ] && [ "$2" = "guildhall" ] && [ "$3" = "version" ]; then',
          '  echo "0.8.0"',
          '  exit 0',
          'fi',
          'if [ "$1" = "whoami" ]; then',
          '  echo "guildhall-test"',
          '  exit 0',
          'fi',
          'if [ "$1" = "pack" ]; then',
          '  printf \'[{"files":[{"path":"dist/web/index.html"},{"path":"dist/web/_app/immutable/app.js"}]}]\\n\'',
          '  exit 0',
          'fi',
          'if [ "$1" = "publish" ]; then',
          '  printf "npm publish\\n" >> "$PUBLISH_TEST_LOG"',
          '  exit 0',
          'fi',
          'echo "unexpected npm args: $*" >&2',
          'exit 1',
          '',
        ].join('\n'),
      )

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])
      await addBareOrigin(tmp)

      const result = await execFileP('node', ['scripts/publish.mjs', '0.9.0', '--skip-tests'], {
        cwd: tmp,
        env: {
          ...process.env,
          PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
          PUBLISH_TEST_LOG: operationLog,
          GUILDHALL_RUNTIME_IMAGE_DIGEST: '',
          GUILDHALL_RUNTIME_IMAGE_DIGEST_FIXTURE_FILE: digestFixture,
        },
        timeout: 10_000,
      }).then(
        ({ stdout, stderr }) => ({ status: 0, output: stdout + stderr }),
        (error: { code?: number; stdout?: string; stderr?: string }) => ({
          status: error.code ?? 1,
          output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
        }),
      )

      const orderLog = await fs.readFile(operationLog, 'utf8')
      expect(result.status).toBe(0)
      expect(result.output).toContain('Publishing runtime image ghcr.io/matthew-dean/guildhall-runtime-debian:0.9.0-trixie-node22-python313-playwright via GitHub Actions')
      expect(result.output).toContain('Verified runtime image digest for ghcr.io/matthew-dean/guildhall-runtime-debian:0.9.0-trixie-node22-python313-playwright: sha256:feedface')
      expect(result.output).toContain('Publishing guildhall@0.9.0')
      expect(orderLog).toContain('gh workflow run runtime-image.yml')
      expect(orderLog.indexOf('gh run watch')).toBeLessThan(orderLog.indexOf('npm publish'))
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  }, 15_000)
})
