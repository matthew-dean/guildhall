#!/usr/bin/env node
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DOCS = join(ROOT, 'docs')
const DOCS_BASE = normalizeDocsBase(process.env.GUILDHALL_DOCS_BASE ?? '/')

const GENERATED_DIRS = [
  join(DOCS, 'current'),
  join(DOCS, 'next'),
]

const CURRENT_ENTRIES = [
  'assets',
  'cli',
  'guide',
  'levers',
  'reference',
  'releases',
  'subsystems',
  'web-ui',
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

function normalizeDocsBase(value) {
  const trimmed = String(value).trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

function docsHref(prefix, section) {
  const base = DOCS_BASE === '/' ? '' : DOCS_BASE.slice(0, -1)
  return `${base}${prefix}/${section}/`
}

async function resolveCurrentVersion() {
  const versionsRoot = join(DOCS, 'versions')
  if (!existsSync(versionsRoot)) {
    throw new Error('docs: cannot prepare /current/ because docs/versions does not exist')
  }
  const versions = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  const current = versions[0]
  if (!current) {
    throw new Error('docs: cannot prepare /current/ because docs/versions has no versioned snapshots')
  }
  return current
}

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
  const rootDocLink = /(?<=["'(])\/(?:guildhall\/)?(guide|reference|web-ui|cli|levers|releases)\//g
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const next = raw.replace(rootDocLink, (_match, section) => docsHref(prefix, section))
    if (next !== raw) await writeFile(file, next, 'utf8')
  }
}

async function rewriteCurrentDocLinks(root, version) {
  const files = await walkFiles(root)
  const versionedRootDocLink = new RegExp(`(?<=["'(])/(?:guildhall/)?versions/${version}/(guide|reference|web-ui|cli|levers|releases)/`, 'g')
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const next = raw.replace(versionedRootDocLink, (_match, section) => docsHref('', section))
    if (next !== raw) await writeFile(file, next, 'utf8')
  }
}

async function rewriteNextHomeStableLinks(root, currentVersion) {
  const file = join(root, 'index.md')
  if (!existsSync(file)) return
  const raw = await readFile(file, 'utf8')
  const next = raw
    .replaceAll(`/guildhall/next/releases/${currentVersion}`, `/releases/${currentVersion}`)
    .replaceAll(`/next/releases/${currentVersion}`, `/releases/${currentVersion}`)
  if (next !== raw) await writeFile(file, next, 'utf8')
}

async function main() {
  for (const dir of GENERATED_DIRS) {
    await rm(dir, { recursive: true, force: true })
  }

  const currentVersion = await resolveCurrentVersion()
  const currentRoot = join(DOCS, 'current')
  await copyEntries(join(DOCS, 'versions', currentVersion), currentRoot, CURRENT_ENTRIES)
  await rewriteCurrentDocLinks(currentRoot, currentVersion)

  const nextRoot = join(DOCS, 'next')
  await copyEntries(DOCS, nextRoot, NEXT_ENTRIES, NEXT_EXCLUDES)
  await rewriteAbsoluteDocLinks(nextRoot, '/next')
  await rewriteNextHomeStableLinks(nextRoot, currentVersion)

  console.log(`docs: prepared /current/ from ${currentVersion} and /next/ from current docs`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
