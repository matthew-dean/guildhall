import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const VERSIONED_ENTRIES = [
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

export const VERSIONED_EXCLUDES = [
  /^web-ui\/flow-audit\.md$/,
  /^assets\/ui-audit\/[^/]+\/README\.md$/,
]

export const CURRENT_ENTRIES = [
  'assets',
  'cli',
  'guide',
  'levers',
  'reference',
  'releases',
  'subsystems',
  'web-ui',
]

export const NEXT_ENTRIES = [
  'assets',
  'cli',
  'guide',
  'levers',
  'reference',
  'releases',
  'web-ui',
  'index.md',
]

export const NEXT_EXCLUDES = [
  /^web-ui\/flow-audit\.md$/,
  /^web-ui\/design-tokens\.md$/,
  /^web-ui\/help-system\.md$/,
]

export const SNAPSHOT_ASSET_EXCLUDES = [
  /^assets\/ui-audit\/README\.md$/,
  /^assets\/ui-audit\/[^/]+\/README\.md$/,
]

export function normalizeDocsBase(value) {
  const trimmed = String(value).trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`
}

export function docsHref(docsBase, prefix, section) {
  const base = docsBase === '/' ? '' : docsBase.slice(0, -1)
  return `${base}${prefix}/${section}/`
}

export function minorLine(value) {
  const match = value.match(/^(\d+)\.(\d+)(?:\.\d+)?(?:-[\w.]+)?$/)
  return match ? `${match[1]}.${match[2]}` : value
}

export async function copyEntry(fromRoot, toRoot, entry, excludePatterns = []) {
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

export async function copyEntries(fromRoot, toRoot, entries, excludePatterns = []) {
  for (const entry of entries) {
    await copyEntry(fromRoot, toRoot, entry, excludePatterns)
  }
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(full))
    else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.ts'))) files.push(full)
  }
  return files
}

export async function rewriteAbsoluteDocLinks(root, docsBase, prefix) {
  const files = await walkFiles(root)
  const rootDocLink = /(?<=['"(])\/(?:guildhall\/)?(guide|reference|web-ui|cli|levers|releases)\//g
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const next = raw.replace(rootDocLink, (_match, section) => docsHref(docsBase, prefix, section))
    if (next !== raw) await writeFile(file, next, 'utf8')
  }
}

export async function rewriteCurrentDocLinks(root, docsBase, version) {
  const files = await walkFiles(root)
  const versionedRootDocLink = new RegExp(`(?<=['"(])/(?:guildhall/)?versions/${version}/(guide|reference|web-ui|cli|levers|releases)/`, 'g')
  for (const file of files) {
    const raw = await readFile(file, 'utf8')
    const next = raw.replace(versionedRootDocLink, (_match, section) => docsHref(docsBase, '', section))
    if (next !== raw) await writeFile(file, next, 'utf8')
  }
}

export async function rewriteStableReleaseIndex(root, version, canonicalReleaseRoot = null) {
  const file = join(root, 'releases', 'index.md')
  if (!existsSync(file)) return
  const raw = await readFile(file, 'utf8')
  const snapshotNotice = `This is the version-pinned docs snapshot for Guildhall ${version}. The public docs root defaults to this latest published release; unreleased main-branch docs live under [Next](/next/guide/).`
  const noticeStart = raw.search(/^(?:The published docs root defaults|This is the version-pinned docs snapshot)/m)
  const releaseListStart = raw.search(/^- \[\d+\.\d+\.\d+/m)
  let next = raw
  if (noticeStart >= 0) {
    next = releaseListStart >= 0
      ? `${raw.slice(0, noticeStart)}${snapshotNotice}\n\n${raw.slice(releaseListStart)}`
      : `${raw.slice(0, noticeStart)}${snapshotNotice}\n`
  }
  next = next.replace(/Historical release notes stay versioned[\s\S]*?\/guide\/quick-start\)\./, '')
  if (!next.includes('version-pinned docs snapshot')) {
    next = next.replace(
      'Guildhall release notes capture the product claim each version can honestly make, the proof behind that claim, and the limits that still remain.',
      `Guildhall release notes capture the product claim each version can honestly make, the proof behind that claim, and the limits that still remain.\n\n${snapshotNotice}`,
    )
  }
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (canonicalReleaseRoot) {
    const canonicalIndex = join(canonicalReleaseRoot, 'releases', 'index.md')
    if (existsSync(canonicalIndex)) {
      const canonical = await readFile(canonicalIndex, 'utf8')
      const canonicalLine = canonical.match(new RegExp(`^- \\[${escapedVersion}\\][^\\n]*$`, 'm'))?.[0]
      if (canonicalLine) {
        next = next.replace(new RegExp(`^- \\[${escapedVersion}\\][^\\n]*$`, 'm'), canonicalLine)
      }
    }
  }
  next = next.replace(new RegExp(`(^- \\[${escapedVersion}\\][^\\n]*) \\(Upcoming\\.\\)$`, 'm'), '$1')
  await writeFile(file, next, 'utf8')
}

export async function rewriteVersionedHome(root, docsBase, version) {
  const file = join(root, 'index.md')
  if (!existsSync(file)) return
  const raw = await readFile(file, 'utf8')
  const versionedLinks = new RegExp(`/(?:guildhall/)?versions/\\d+\\.\\d+\\.\\d+(-[\\w.]+)?/`, 'g')
  const base = docsBase === '/' ? '' : docsBase.slice(0, -1)
  const versionPrefix = `${base}/versions/${version}`
  const next = raw
    .replace(versionedLinks, `${versionPrefix}/`)
    .replace(/<p class="gh-home-version">[\s\S]*?<\/p>/, `<p class="gh-home-version">Current docs: <a href="${versionPrefix}/releases/${version}">${version}</a>.</p>`)
  if (next !== raw) await writeFile(file, next, 'utf8')
}

export async function removeSameMinorSnapshots(versionsRoot, targetVersion) {
  if (!existsSync(versionsRoot)) return
  const targetMinor = minorLine(targetVersion)
  const entries = await readdir(versionsRoot, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name === targetVersion) continue
    if (minorLine(entry.name) !== targetMinor) continue
    await rm(join(versionsRoot, entry.name), { recursive: true, force: true })
  }
}

export async function generateVersionedSnapshot({ sourceRoot, targetRoot, version, docsBase = '/', canonicalReleaseRoot = null }) {
  await mkdir(targetRoot, { recursive: true })
  for (const entry of VERSIONED_ENTRIES) {
    await copyEntry(sourceRoot, targetRoot, entry, VERSIONED_EXCLUDES)
  }
  if (canonicalReleaseRoot) {
    await copyEntry(canonicalReleaseRoot, targetRoot, `releases/${version}.md`)
  }
  await rewriteAbsoluteDocLinks(targetRoot, docsBase, `/versions/${version}`)
  await rewriteVersionedHome(targetRoot, docsBase, version)
  await rewriteStableReleaseIndex(targetRoot, version, canonicalReleaseRoot)
}
