#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.argv[2] ?? process.cwd()

const sourceRoots = [
  'src/web',
  'packages/ui/src',
].map(part => join(root, part)).filter(existsSync)

const ignoredDirectories = new Set([
  '.git',
  'dist',
  'node_modules',
])

const allowedTokenDefinitionFiles = [
  /^src\/web\/tokens\.css$/,
  /^packages\/ui\/src\/styles\.css$/,
  /^packages\/ui\/src\/token-definitions\.(js|ts)$/,
]

const duplicatePrimitiveFiles = [
  /^src\/web\/lib\/NoticeBand\.svelte$/,
  /^src\/web\/lib\/Card\.svelte$/,
]

const cssDeclarationChecks = [
  {
    label: 'raw font-size',
    property: /font-size/,
    value: /^(?!var\(--gh-type-size-)(?!inherit\b)(?!unset\b)(?!0\b).+/,
  },
  {
    label: 'raw font-weight',
    property: /font-weight/,
    value: /^(?!var\(--gh-type-weight-)(?!inherit\b)(?!unset\b).+/,
  },
  {
    label: 'raw line-height',
    property: /line-height/,
    value: /^(?!var\(--gh-type-line-height-)(?!inherit\b)(?!unset\b).+/,
  },
  {
    label: 'raw padding',
    property: /padding(?:-[a-z-]+)?/,
    value: /^(?!var\(--gh-)(?!inherit\b)(?!unset\b)(?!0\b).*(?:px|rem|em|clamp\(|calc\()/,
  },
  {
    label: 'raw gap',
    property: /(?:row-gap|column-gap|gap)/,
    value: /^(?!var\(--gh-)(?!inherit\b)(?!unset\b)(?!0\b).*(?:px|rem|em|clamp\(|calc\()/,
  },
  {
    label: 'raw radius',
    property: /border-radius/,
    value: /^(?!var\(--gh-radius-)(?!inherit\b)(?!unset\b)(?!0\b).+/,
  },
  {
    label: 'negative letter-spacing',
    property: /letter-spacing/,
    value: /^-/,
  },
  {
    label: 'raw z-index',
    property: /z-index/,
    value: /^(?!var\(--gh-layer-)(?!auto\b)(?!inherit\b)(?!unset\b).+/,
  },
  {
    label: 'raw shadow',
    property: /(?:box-shadow|text-shadow)/,
    value: /^(?!var\(--gh-elevation-)(?!none\b)(?!inherit\b)(?!unset\b).+/,
  },
]

const tokenReferenceChecks = [
  {
    label: 'legacy token family',
    pattern: /var\(--(?:fs|s|r|lh)-[a-z0-9-]+\)/g,
  },
  {
    label: 'scale-number type token in surface',
    pattern: /var\(--gh-type-size-[0-9]+\)/g,
    allowed: [/^packages\/ui\/src\/components\//],
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (ignoredDirectories.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(svelte|css|ts|js)$/.test(entry)) out.push(full)
  }
  return out
}

function isAllowedFile(rel) {
  return allowedTokenDefinitionFiles.some(pattern => pattern.test(rel))
}

function lineFor(source, index) {
  return source.slice(0, index).split('\n').length
}

function cssDeclarations(source) {
  const declarationPattern = /([a-z-]+)\s*:\s*([^;{}]+);/gi
  return source.matchAll(declarationPattern)
}

const failures = []

for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    const rel = relative(root, file).split('\\').join('/')
    const source = readFileSync(file, 'utf8')
    const allowedTokenFile = isAllowedFile(rel)

    if (duplicatePrimitiveFiles.some(pattern => pattern.test(rel))) {
      failures.push(`${rel}: duplicate primitive; use packages/ui or a temporary compat wrapper`)
    }

    if (allowedTokenFile) continue

    for (const match of cssDeclarations(source)) {
      const property = match[1]?.trim().toLowerCase() ?? ''
      const value = match[2]?.trim() ?? ''
      for (const check of cssDeclarationChecks) {
        if (!check.property.test(property)) continue
        if (!check.value.test(value)) continue
        failures.push(`${rel}:${lineFor(source, match.index ?? 0)}: ${check.label}: ${property}: ${value};`)
      }
    }

    for (const check of tokenReferenceChecks) {
      if (check.allowed?.some(pattern => pattern.test(rel))) continue
      for (const match of source.matchAll(check.pattern)) {
        failures.push(`${rel}:${lineFor(source, match.index ?? 0)}: ${check.label}: ${match[0]}`)
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
