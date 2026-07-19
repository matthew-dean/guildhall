#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CURRENT_ENTRIES,
  NEXT_ENTRIES,
  NEXT_EXCLUDES,
  SNAPSHOT_ASSET_EXCLUDES,
  copyEntries,
  normalizeDocsBase,
  rewriteAbsoluteDocLinks,
  rewriteCurrentDocLinks,
} from './docs-generation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DOCS = join(ROOT, 'docs')
const DOCS_BASE = normalizeDocsBase(process.env.GUILDHALL_DOCS_BASE ?? '/')
const PACKAGE_VERSION = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version

const GENERATED_DIRS = [join(DOCS, 'current'), join(DOCS, 'next')]

async function resolveCurrentVersion() {
  let latestTag
  try {
    latestTag = execFileSync('git', ['tag', '--sort=-version:refname'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  } catch {
    latestTag = undefined
  }
  if (latestTag) return latestTag.slice(1)

  const versionsRoot = join(DOCS, 'versions')
  if (!existsSync(versionsRoot)) return PACKAGE_VERSION
  const versions = (await readdir(versionsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  if (versions.includes(PACKAGE_VERSION) || versions.length === 0) return PACKAGE_VERSION
  const latestSnapshot = versions[0]
  if (!latestSnapshot || PACKAGE_VERSION.localeCompare(latestSnapshot, undefined, { numeric: true }) >= 0) {
    return PACKAGE_VERSION
  }
  return latestSnapshot
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
  const currentSnapshotRoot = join(DOCS, 'versions', currentVersion)
  const currentSourceRoot = existsSync(currentSnapshotRoot) ? currentSnapshotRoot : DOCS
  await copyEntries(currentSourceRoot, currentRoot, CURRENT_ENTRIES, SNAPSHOT_ASSET_EXCLUDES)
  await rewriteCurrentDocLinks(currentRoot, DOCS_BASE, currentVersion)

  const nextRoot = join(DOCS, 'next')
  await copyEntries(DOCS, nextRoot, NEXT_ENTRIES, [...NEXT_EXCLUDES, ...SNAPSHOT_ASSET_EXCLUDES])
  await rewriteAbsoluteDocLinks(nextRoot, DOCS_BASE, '/next')
  await rewriteNextHomeStableLinks(nextRoot, currentVersion)

  console.log(`docs: prepared generated current projection from ${currentVersion} and next projection from canonical docs`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
