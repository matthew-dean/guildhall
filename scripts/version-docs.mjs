#!/usr/bin/env node
// Creates one immutable release snapshot. Ordinary docs builds only project it.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  generateVersionedSnapshot,
  normalizeDocsBase,
  removeSameMinorSnapshots,
} from './docs-generation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DOCS = join(ROOT, 'docs')
const DOCS_BASE = normalizeDocsBase(process.env.GUILDHALL_DOCS_BASE ?? '/')

const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith('--'))
const force = args.includes('--force')
const fromRef = takeFlagValue('--from-ref')

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/version-docs.mjs <version> [--force] [--from-ref <git-ref>]')
  process.exit(1)
}

function takeFlagValue(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) {
    console.error(`Flag ${flag} requires a value.`)
    process.exit(1)
  }
  return value
}

async function docsSourceRoot() {
  if (!fromRef) return { sourceRoot: DOCS, cleanup: async () => {} }

  const tmp = await mkdtemp(join(tmpdir(), 'guildhall-version-docs-'))
  const archive = join(tmp, 'docs.tar')
  execFileSync('git', ['archive', '--format=tar', '-o', archive, fromRef, 'docs'], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  execFileSync('tar', ['-xf', archive, '-C', tmp], { stdio: 'inherit' })
  return { sourceRoot: join(tmp, 'docs'), cleanup: () => rm(tmp, { recursive: true, force: true }) }
}

async function main() {
  const { sourceRoot, cleanup } = await docsSourceRoot()
  try {
    const target = join(DOCS, 'versions', version)
    if (existsSync(target)) {
      if (!force) {
        throw new Error(`docs version already exists: docs/versions/${version} (pass --force to replace it)`)
      }
      await rm(target, { recursive: true, force: true })
    }

    await removeSameMinorSnapshots(join(DOCS, 'versions'), version)
    await mkdir(target, { recursive: true })
    await generateVersionedSnapshot({
      sourceRoot,
      targetRoot: target,
      version,
      docsBase: DOCS_BASE,
      canonicalReleaseRoot: DOCS,
    })

    console.log(`docs: cut one-time versioned snapshot at docs/versions/${version}${fromRef ? ` from ${fromRef}` : ''}`)
  } finally {
    await cleanup()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
