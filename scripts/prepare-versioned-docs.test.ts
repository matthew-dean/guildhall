import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const root = path.resolve(__dirname, '..')

async function createPrepareFixture(tmp: string): Promise<void> {
  await fs.mkdir(path.join(tmp, 'scripts'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/guide'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/levers'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/releases'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/web-ui'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/versions/1.0.0/guide'), { recursive: true })
  await fs.mkdir(path.join(tmp, 'docs/versions/1.0.0/releases'), { recursive: true })
  await fs.writeFile(
    path.join(tmp, 'package.json'),
    JSON.stringify({ name: 'guildhall-docs-fixture', version: '1.0.0' }, null, 2),
  )
  await fs.copyFile(
    path.join(root, 'scripts/prepare-versioned-docs.mjs'),
    path.join(tmp, 'scripts/prepare-versioned-docs.mjs'),
  )

  await fs.writeFile(
    path.join(tmp, 'docs/index.md'),
    [
      '# Home',
      '',
      '[Guide](/guide/quick-start)',
      '[Old guide](/guildhall/guide/quick-start)',
      '[Relative release](./releases/)',
      '',
    ].join('\n'),
  )
  await fs.writeFile(path.join(tmp, 'docs/guide/quick-start.md'), '[Levers](/levers/)\n')
  await fs.writeFile(path.join(tmp, 'docs/levers/index.md'), '[Guide](../guide/quick-start)\n')
  await fs.writeFile(path.join(tmp, 'docs/releases/index.md'), '[Next](/next/guide/)\n')
  await fs.writeFile(path.join(tmp, 'docs/web-ui/flow-audit.md'), '# Internal checklist\n')

  await fs.writeFile(
    path.join(tmp, 'docs/versions/1.0.0/guide/quick-start.md'),
    [
      '[Stable](/versions/1.0.0/guide/quick-start)',
      '[Old stable](/guildhall/versions/1.0.0/guide/quick-start)',
      '[Relative stable](../releases/)',
      '',
    ].join('\n'),
  )
  await fs.writeFile(path.join(tmp, 'docs/versions/1.0.0/releases/index.md'), '# Releases\n')
}

describe('docs prepare-versioned script', () => {
  it('keeps generated current and next snapshots valid for the custom-domain root', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-prepare-docs-'))
    try {
      await createPrepareFixture(tmp)

      await execFileP('node', ['scripts/prepare-versioned-docs.mjs'], { cwd: tmp })

      const currentQuickStart = await fs.readFile(path.join(tmp, 'docs/current/guide/quick-start.md'), 'utf8')
      const nextHome = await fs.readFile(path.join(tmp, 'docs/next/index.md'), 'utf8')
      const nextQuickStart = await fs.readFile(path.join(tmp, 'docs/next/guide/quick-start.md'), 'utf8')

      expect(currentQuickStart).toContain('/guide/quick-start')
      expect(currentQuickStart).toContain('[Relative stable](../releases/)')
      expect(currentQuickStart).not.toContain('/guildhall/')
      expect(nextHome).toContain('/next/guide/quick-start')
      expect(nextHome).toContain('[Relative release](./releases/)')
      expect(nextHome).not.toContain('/guildhall/')
      expect(nextHome).not.toContain('/next/next/')
      expect(nextQuickStart).toContain('/next/levers/')
    } finally {
      await fs.rm(tmp, { recursive: true, force: true })
    }
  })
})
