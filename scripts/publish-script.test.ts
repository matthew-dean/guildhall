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

describe('release publish script', () => {
  it('restores package.json when a pre-publish gate fails after the version bump', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-publish-script-'))
    try {
      await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true })
      await fs.copyFile(path.join(root, 'scripts/publish.mjs'), path.join(tmp, 'scripts/publish.mjs'))
      await fs.writeFile(
        path.join(tmp, 'package.json'),
        JSON.stringify({ name: 'guildhall-test-release', version: '0.4.0' }, null, 2) + '\n',
      )

      const fakeBin = path.join(tmp, 'fake-bin')
      await fs.mkdir(fakeBin)
      const fakePnpm = path.join(fakeBin, 'pnpm')
      await fs.writeFile(fakePnpm, '#!/bin/sh\nexit 1\n')
      await fs.chmod(fakePnpm, 0o755)

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
      expect(result.status).not.toBe(0)
      expect(result.output).toContain('Bumped package.json to 0.5.0')
      expect(result.output).toContain('Command failed: pnpm typecheck')
      expect(manifest.version).toBe('0.4.0')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
