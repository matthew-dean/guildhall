#!/usr/bin/env node
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DOCS = join(ROOT, 'docs')

const GENERATED_DIRS = [
  join(DOCS, 'next'),
]

const NEXT_ENTRIES = [
  'assets',
  'cli',
  'guide',
  'levers',
  'reference',
  'releases',
  'web-ui',
  'index.md',
]

const NEXT_EXCLUDES = [
  /^web-ui\/flow-audit\.md$/,
  /^web-ui\/design-tokens\.md$/,
  /^web-ui\/help-system\.md$/,
]

async function copyEntry(fromRoot, toRoot, entry, excludePatterns = []) {
  const from = join(fromRoot, entry)
  if (!existsSync(from)) return
  const to = join(toRoot, entry)
  await cp(from, to, {
    recursive: true,
    force: true,
    filter(source) {
      const rel = source.slice(fromRoot.length + 1)
      return !excludePatterns.some((pattern) => pattern.test(rel))
    },
  })
}

async function copyEntries(fromRoot, toRoot, entries, excludePatterns = []) {
  for (const entry of entries) {
    await copyEntry(fromRoot, toRoot, entry, excludePatterns)
  }
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

async function main() {
  for (const dir of GENERATED_DIRS) {
    await rm(dir, { recursive: true, force: true })
  }

  const nextRoot = join(DOCS, 'next')
  await copyEntries(DOCS, nextRoot, NEXT_ENTRIES, NEXT_EXCLUDES)
  await rewriteAbsoluteDocLinks(nextRoot, '/next')

  console.log('docs: prepared /next/ from current docs')
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
