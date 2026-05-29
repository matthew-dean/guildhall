#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_ROOT = path.join(repoRoot, '.guildhall', 'dev-tools', 'hermes-agent')
const DEFAULT_HOME = path.join(repoRoot, '.guildhall', 'dev-tools', 'hermes-home')
const HERMES_REPO = 'https://github.com/NousResearch/hermes-agent.git'

const args = process.argv.slice(2)

function argValue(flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? path.resolve(args[index + 1]) : fallback
}

function stringArg(flag, fallback) {
  const index = args.indexOf(flag)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

async function main() {
  const hermesRoot = argValue('--root', DEFAULT_ROOT)
  const hermesHome = argValue('--home', DEFAULT_HOME)
  const ref = stringArg('--ref', 'main')
  const verify = !args.includes('--no-verify')

  await fs.mkdir(path.dirname(hermesRoot), { recursive: true })
  await fs.mkdir(hermesHome, { recursive: true })

  if (!existsSync(path.join(hermesRoot, '.git'))) {
    console.log(`[guildhall] Cloning optional Hermes dev comparator into ${hermesRoot}`)
    await execFileP('git', ['clone', '--depth', '1', '--branch', ref, HERMES_REPO, hermesRoot], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 20,
    })
  } else {
    console.log(`[guildhall] Hermes dev comparator already exists at ${hermesRoot}`)
    console.log('[guildhall] Leaving the checkout untouched; update it manually if you need a newer Hermes commit.')
  }

  if (verify) {
    console.log('[guildhall] Verifying Hermes through uv...')
    const { stdout } = await execFileP('uv', [
      'run',
      '--python',
      '3.11',
      '--project',
      hermesRoot,
      'hermes',
      '--version',
    ], {
      cwd: repoRoot,
      env: { ...process.env, HERMES_HOME: hermesHome },
      maxBuffer: 1024 * 1024 * 20,
    })
    process.stdout.write(stdout)
  }

  console.log('[guildhall] Hermes is installed as an optional local dev comparator only.')
  console.log(`[guildhall] HERMES_HOME=${hermesHome}`)
  console.log(`[guildhall] Compare with: pnpm benchmarks:compare:hermes`)
}

main().catch((err) => {
  console.error('[guildhall] Failed to prepare optional Hermes dev comparator:')
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
