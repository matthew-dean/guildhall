#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DOCS = join(ROOT, 'docs')

const args = process.argv.slice(2)
const version = args.find((arg) => !arg.startsWith('--'))
const force = args.includes('--force')
const fromRef = takeFlagValue('--from-ref')

if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Usage: node scripts/version-docs.mjs <version> [--force] [--from-ref <git-ref>]')
  process.exit(1)
}

const VERSIONED_ENTRIES = [
  'assets',
  'cli',
  'guide',
  'levers',
  'reference',
  'releases',
  'subsystems',
  'web-ui',
  'index.md',
]

const VERSIONED_EXCLUDES = [
  /^web-ui\/flow-audit\.md$/,
]

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
  execFileSync('tar', ['-xf', archive, '-C', tmp], {
    stdio: 'inherit',
  })
  return { sourceRoot: join(tmp, 'docs'), cleanup: () => rm(tmp, { recursive: true, force: true }) }
}

async function copyEntry(fromRoot, toRoot, entry, excludePatterns = []) {
  const from = join(fromRoot, entry)
  if (!existsSync(from)) return
  await cp(from, join(toRoot, entry), {
    recursive: true,
    force: true,
    filter(source) {
      const rel = source.slice(fromRoot.length + 1)
      return !excludePatterns.some((pattern) => pattern.test(rel))
    },
  })
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...(await walkFiles(full)))
    else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.ts'))) files.push(full)
  }
  return files
}

async function rewriteAbsoluteDocLinks(root, prefix) {
  const files = await walkFiles(root)
  const absoluteDocLink = /\/guildhall\/(guide|reference|web-ui|cli|levers|releases)\//g
  const rootRelativeDocLink = /(?<=["'(])\/(guide|reference|web-ui|cli|levers|releases)\//g
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const next = raw
      .replace(absoluteDocLink, `/guildhall${prefix}/$1/`)
      .replace(rootRelativeDocLink, `${prefix}/$1/`)
    if (next !== raw) await writeFile(file, next, 'utf8')
  }
}

async function rewriteStableReleaseIndex(root) {
  const file = join(root, 'releases', 'index.md')
  if (!existsSync(file)) return
  const raw = await readFile(file, 'utf8')
  let next = raw.replace(
    /The published docs root defaults[\s\S]*?current npm package\./,
    `This is the version-pinned docs snapshot for Guildhall ${version}. The public docs root defaults to this latest published release; unreleased main-branch docs live under [Next](/next/guide/).`,
  )
  next = next.replace(
    /Historical release notes stay versioned[\s\S]*?\/guide\/quick-start\)\./,
    '',
  )
  if (!next.includes('version-pinned docs snapshot')) {
    next = next.replace(
      'GuildHall release notes capture the product claim each version can honestly make, the proof behind that claim, and the limits that still remain.',
      `GuildHall release notes capture the product claim each version can honestly make, the proof behind that claim, and the limits that still remain.\n\nThis is the version-pinned docs snapshot for Guildhall ${version}. The public docs root defaults to this latest published release; unreleased main-branch docs live under [Next](/next/guide/).`,
    )
  }
  await writeFile(file, next, 'utf8')
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

    await mkdir(target, { recursive: true })
    for (const entry of VERSIONED_ENTRIES) {
      await copyEntry(sourceRoot, target, entry, VERSIONED_EXCLUDES)
    }
    await rewriteAbsoluteDocLinks(target, `/versions/${version}`)
    await rewriteStableReleaseIndex(target)

    console.log(`docs: cut versioned docs at docs/versions/${version}${fromRef ? ` from ${fromRef}` : ''}`)
  } finally {
    await cleanup()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
