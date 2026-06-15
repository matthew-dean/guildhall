#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cli = join(root, 'dist', 'cli.js')

if (!existsSync(cli)) {
  console.error('[guildhall] dist/cli.js not found. Run `pnpm build` before using this migration script.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [
  cli,
  'migrate',
  'apply',
  '--migration',
  '0.10.0/task-hierarchy-links',
  ...process.argv.slice(2),
], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})

process.exit(result.status ?? 1)
