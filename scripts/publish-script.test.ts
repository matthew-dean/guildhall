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

async function writeExecutable(file: string, source: string): Promise<void> {
  await fs.writeFile(file, source)
  await fs.chmod(file, 0o755)
}

async function createMinimalReleaseFixture(tmp: string): Promise<void> {
  await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/releases'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/guide'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'dist/web'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'src/web/generated'), { recursive: true })

  await fs.copyFile(path.join(root, 'scripts/publish.mjs'), path.join(tmp, 'scripts/publish.mjs'))
  await fs.copyFile(path.join(root, 'scripts/version-docs.mjs'), path.join(tmp, 'scripts/version-docs.mjs'))
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
    'Docs default to Guildhall 0.4.0. [Start](/guildhall/versions/0.4.0/guide/quick-start).\n',
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
  await fs.writeFile(path.join(tmp, 'docs/guide/quick-start.md'), '# Quick start\n')
  await fs.writeFile(
    path.join(tmp, 'src/web/generated/help-topics.json'),
    JSON.stringify({ start: { href: '/help/start' } }),
  )
  await fs.writeFile(path.join(tmp, 'dist/web/app.js'), 'window.helpHref="/help/start"\n')
}

describe('release publish script', () => {
  it('restores package.json when a pre-publish gate fails after the version bump', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await createMinimalReleaseFixture(tmp)

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      const fakePnpm = path.join(fakeBin, 'pnpm')
      await writeExecutable(fakePnpm, '#!/bin/sh\nexit 1\n')

      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'init'])

      const result = await execFileP('node', ['scripts/publish.mjs', '0.5.0'], {
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
      expect(result.output).toContain('Bumped package.json to 0.5.0')
      expect(result.output).toContain('Command failed: pnpm typecheck')
      expect(manifest.version).toBe('0.4.0')
      expect(docsHome).toContain('Guildhall 0.4.0')
      expect(releasesIndex).toContain('Guildhall 0.4.0')
      await expect(fs.stat(path.join(tmp, 'docs/versions/0.5.0'))).rejects.toThrow()
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

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
          '  printf \'[{"files":[{"path":"dist/web/app.js"}]}]\\n\'',
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
      expect(result.status).toBe(0)
      expect(result.output).toContain('Dry-run: skipping docs versioning and public docs pointer updates.')
      expect(result.output).not.toContain('version-docs should not run during dry-run')
      expect(manifest.version).toBe('0.4.0')
      expect(docsHome).toContain('Guildhall 0.4.0')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
