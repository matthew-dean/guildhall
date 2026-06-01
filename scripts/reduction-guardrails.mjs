#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = process.cwd()

const forbiddenRuntimeWords = [
  /\bLooma\b/,
  /\bKnit\b/,
  /\bAlertDialog\b/,
]

const allowedWordPaths = [
  /^internal\//,
  /^examples\//,
  /^src\/runtime\/(?:.*\/)?__tests__\//,
  /^src\/runtime\/release-proof-matrix\.ts$/,
  /^src\/runtime\/app-spec-smoke\.ts$/,
]

const forbiddenTaskShapes = [
  {
    path: /^src\/core\/task\.ts$/,
    pattern: /['"]parent['"]/,
    message: 'TaskStatus must not contain parent. Use task.hierarchy links and readiness.',
  },
  {
    path: /^src\/runtime\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Runtime hierarchy must not infer containment from parentGoalId after migration.',
  },
  {
    path: /^src\/web\/lib\/work-hierarchy\.ts$/,
    pattern: /legacyParentTaskId|parentGoalId/,
    message: 'Web hierarchy must not infer containment from parentGoalId after migration.',
  },
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|svelte|js|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

const failures = []
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  if (rel.startsWith('src/runtime/') && !allowedWordPaths.some(pattern => pattern.test(rel))) {
    for (const pattern of forbiddenRuntimeWords) {
      if (pattern.test(text)) failures.push(`${rel}: generic runtime contains ${pattern}`)
    }
  }
  for (const rule of forbiddenTaskShapes) {
    if (rule.path.test(rel) && rule.pattern.test(text)) failures.push(`${rel}: ${rule.message}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
