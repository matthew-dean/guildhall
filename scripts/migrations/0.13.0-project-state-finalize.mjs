#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const cli = join(root, 'dist', 'cli.js')
const migrations = [
  '0.13.0/project-state-finalize',
  '0.13.0/project-state-legacy-live-file-cleanup',
  '0.13.1/release-membership',
]
const input = process.argv.slice(2)
const dryRun = input.includes('--dry-run')
const forwarded = input.filter(argument => argument !== '--dry-run')

if (!existsSync(cli)) {
  console.error('[guildhall] dist/cli.js not found. Run `pnpm build` before using this migration script.')
  process.exit(1)
}

function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (dryRun) {
  run(['migrate', 'plan', ...forwarded])
  console.log(`[guildhall] Final project-state cutover migrations are applied explicitly as ${migrations.join(' and ')}.`)
  process.exit(0)
}

// Bring each project through all known conversion steps first. The final
// required migration is intentionally excluded from this pass and is applied
// only after its SQLite verification gate succeeds.
run(['migrate', 'apply', '--include-prompt', ...forwarded])
for (const migration of migrations) {
  run(['migrate', 'apply', '--migration', migration, ...forwarded])
}
run(['migrate', 'status', ...forwarded])
