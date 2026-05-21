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

async function createDocsFixture(tmp: string, marker = 'current docs'): Promise<void> {
  await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/guide'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/web-ui'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/releases'), { recursive: true })
  await fs.copyFile(path.join(root, 'scripts/version-docs.mjs'), path.join(tmp, 'scripts/version-docs.mjs'))
  await fs.writeFile(
    path.join(tmp, 'docs/index.md'),
    `# Home\n\n${marker}\n\n[Guide](/guildhall/guide/quick-start)\n`,
  )
  await fs.writeFile(path.join(tmp, 'docs/guide/quick-start.md'), '[Work](/web-ui/project-view)\n')
  await fs.writeFile(path.join(tmp, 'docs/web-ui/project-view.md'), '# Project view\n')
  await fs.writeFile(path.join(tmp, 'docs/web-ui/flow-audit.md'), '# Internal checklist\n')
  await fs.writeFile(
    path.join(tmp, 'docs/releases/index.md'),
    [
      '# Releases',
      '',
      'The published docs root defaults to Guildhall 0.9.0, matching the current npm package.',
      '',
      'Historical release notes stay versioned, while the current docs are available at [Quick start](/guide/quick-start).',
      '',
    ].join('\n'),
  )
}

describe('docs versioning script', () => {
  it('cuts a versioned docs snapshot with rewritten public links and without live audit pages', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-version-docs-'))
    try {
      await createDocsFixture(tmp)

      await execFileP('node', ['scripts/version-docs.mjs', '1.2.3'], { cwd: tmp })

      const versionRoot = path.join(tmp, 'docs/versions/1.2.3')
      const home = await fs.readFile(path.join(versionRoot, 'index.md'), 'utf8')
      const quickStart = await fs.readFile(path.join(versionRoot, 'guide/quick-start.md'), 'utf8')
      const releaseIndex = await fs.readFile(path.join(versionRoot, 'releases/index.md'), 'utf8')

      await expect(fs.stat(path.join(versionRoot, 'web-ui/flow-audit.md'))).rejects.toThrow()
      expect(home).toContain('/guildhall/versions/1.2.3/guide/quick-start')
      expect(quickStart).toContain('/versions/1.2.3/web-ui/project-view')
      expect(releaseIndex).toContain('version-pinned docs snapshot for Guildhall 1.2.3')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })

  it('can bootstrap an existing docs version from a git ref instead of current docs', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-version-docs-'))
    try {
      await createDocsFixture(tmp, 'published docs')
      await runGit(tmp, ['init', '-b', 'main'])
      await runGit(tmp, ['config', 'user.name', 'Guildhall Test'])
      await runGit(tmp, ['config', 'user.email', 'guildhall-test@example.com'])
      await runGit(tmp, ['add', '.'])
      await runGit(tmp, ['commit', '--no-verify', '-m', 'published docs'])
      await runGit(tmp, ['tag', 'v1.2.3'])

      await fs.writeFile(path.join(tmp, 'docs/index.md'), '# Home\n\nnext docs\n')
      await execFileP('node', ['scripts/version-docs.mjs', '1.2.3', '--from-ref', 'v1.2.3'], { cwd: tmp })

      const home = await fs.readFile(path.join(tmp, 'docs/versions/1.2.3/index.md'), 'utf8')
      expect(home).toContain('published docs')
      expect(home).not.toContain('next docs')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
