#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const args = process.argv.slice(2)
const writeBaseline = args.includes('--write-baseline')
const rootArg = args.find(arg => arg !== '--write-baseline')
const root = rootArg ?? process.cwd()
const baselinePath = join(root, 'internal/audits/2026-06-01-design-token-baseline.json')

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

function loadBaseline() {
  if (!existsSync(baselinePath)) {
    return { version: 1, generatedBy: 'scripts/design-token-audit.mjs', violations: {} }
  }

  const parsed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  return {
    version: parsed.version ?? 1,
    generatedBy: parsed.generatedBy ?? 'scripts/design-token-audit.mjs',
    violations: parsed.violations ?? {},
  }
}

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

function addViolation(violations, rel, line, signature) {
  violations.push({ rel, line, signature })
}

function countViolations(violations) {
  const byFile = new Map()

  for (const violation of violations) {
    const current = byFile.get(violation.rel) ?? new Map()
    current.set(violation.signature, (current.get(violation.signature) ?? 0) + 1)
    byFile.set(violation.rel, current)
  }

  const sorted = {}
  for (const rel of [...byFile.keys()].sort()) {
    const signatures = byFile.get(rel)
    sorted[rel] = {}
    for (const signature of [...signatures.keys()].sort()) {
      sorted[rel][signature] = signatures.get(signature)
    }
  }
  return sorted
}

function formatViolation(violation) {
  if (violation.line === null) return `${violation.rel}: ${violation.signature}`
  return `${violation.rel}:${violation.line}: ${violation.signature}`
}

function overBaselineFailures(violations, baseline) {
  const baselineViolations = baseline.violations ?? {}
  const seen = new Map()
  const out = []

  for (const violation of violations) {
    const key = `${violation.rel}\0${violation.signature}`
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)

    const allowed = baselineViolations[violation.rel]?.[violation.signature] ?? 0
    if (count <= allowed) continue

    out.push(`${formatViolation(violation)} (over baseline ${allowed})`)
  }

  return out
}

const failures = []

for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    const rel = relative(root, file).split('\\').join('/')
    const source = readFileSync(file, 'utf8')
    const allowedTokenFile = isAllowedFile(rel)

    if (duplicatePrimitiveFiles.some(pattern => pattern.test(rel))) {
      addViolation(failures, rel, null, 'duplicate primitive; use packages/ui or a temporary compat wrapper')
    }

    if (allowedTokenFile) continue

    for (const match of cssDeclarations(source)) {
      const property = match[1]?.trim().toLowerCase() ?? ''
      const value = match[2]?.trim() ?? ''
      for (const check of cssDeclarationChecks) {
        if (!check.property.test(property)) continue
        if (!check.value.test(value)) continue
        addViolation(failures, rel, lineFor(source, match.index ?? 0), `${check.label}: ${property}: ${value};`)
      }
    }

    for (const check of tokenReferenceChecks) {
      if (check.allowed?.some(pattern => pattern.test(rel))) continue
      for (const match of source.matchAll(check.pattern)) {
        addViolation(failures, rel, lineFor(source, match.index ?? 0), `${check.label}: ${match[0]}`)
      }
    }
  }
}

if (writeBaseline) {
  mkdirSync(join(root, 'internal/audits'), { recursive: true })
  writeFileSync(baselinePath, `${JSON.stringify({
    version: 1,
    generatedBy: 'scripts/design-token-audit.mjs',
    violations: countViolations(failures),
  }, null, 2)}\n`)
  process.exit(0)
}

const baseline = loadBaseline()
const unbudgetedFailures = overBaselineFailures(failures, baseline)

if (unbudgetedFailures.length) {
  console.error(unbudgetedFailures.join('\n'))
  process.exit(1)
}
