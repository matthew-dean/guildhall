#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] ?? process.cwd())
const webRoot = join(root, 'src', 'web')
const legacyPrimitivePaths = new Set([
  normalize(join(root, 'src', 'web', 'lib', 'Card.svelte')),
  normalize(join(root, 'src', 'web', 'lib', 'NoticeBand.svelte')),
])
const chipPrimitivePaths = new Set([
  normalize(join(root, 'src', 'web', 'lib', 'Chip.svelte')),
  normalize(join(root, 'src', 'web', 'lib', 'IdentifierChip.svelte')),
])
const legacyChipDebt = new Map([
  [
    normalize(join(root, 'src', 'web', 'surfaces', 'project', 'ThreadTab.svelte')),
    new Set(['task-chip', 'task-chip-text']),
  ],
])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.svelte')) out.push(full)
  }
  return out
}

function isCompatWrapper(file) {
  const rel = relative(root, file).split(sep).join('/')
  return rel.startsWith('src/web/lib/ui-compat/')
}

function resolveImport(file, specifier) {
  if (specifier.startsWith('.')) return normalize(resolve(dirname(file), specifier))
  if (specifier.startsWith('$lib/')) {
    return normalize(join(root, 'src', 'web', 'lib', specifier.slice('$lib/'.length)))
  }
  if (specifier.startsWith('/src/web/')) return normalize(join(root, specifier.slice(1)))
  if (specifier.startsWith('src/web/')) return normalize(join(root, specifier))
  return null
}

function legacyImportSpec(specifier) {
  return /(?:^|\/)(?:Card|NoticeBand)\.svelte$/.test(specifier) &&
    /(?:^|\/)src\/web\/lib\/(?:Card|NoticeBand)\.svelte$/.test(specifier)
}

const importPattern = /\bimport(?:\s+[\s\S]*?\s+from\s+)?['"]([^'"]+\.svelte)['"]/g
const chipClassSelectorPattern = /\.([A-Za-z0-9_-]*(?:chip|pill)[A-Za-z0-9_-]*)\b/g
const failures = []

for (const file of walk(webRoot)) {
  if (isCompatWrapper(file)) continue

  const rel = relative(root, file).split(sep).join('/')
  const source = readFileSync(file, 'utf8')
  const matches = source.matchAll(importPattern)
  for (const match of matches) {
    const specifier = match[1]
    const resolved = resolveImport(file, specifier)
    if ((resolved && legacyPrimitivePaths.has(resolved)) || legacyImportSpec(specifier)) {
      failures.push(`${rel}: import package UI primitives or ui-compat wrappers instead of old local NoticeBand/Card`)
      break
    }
  }

  if (!chipPrimitivePaths.has(normalize(file))) {
    const allowedLegacyClasses = legacyChipDebt.get(normalize(file)) ?? new Set()
    for (const match of source.matchAll(chipClassSelectorPattern)) {
      const className = match[1]
      const isChipContainer = className.endsWith('chips')
      const isAllowedLegacyDebt = allowedLegacyClasses.has(className)
      if (isChipContainer || isAllowedLegacyDebt) continue
      if (
        className === 'status-pill' ||
        className.startsWith('chip-') ||
        className.endsWith('-chip') ||
        className.includes('-chip-')
      ) {
        failures.push(`${rel}: use shared Chip/StatusPill primitives instead of local .${className} styling`)
        break
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
