#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(new URL('..', import.meta.url).pathname)
const DOCS = join(ROOT, 'docs')

const PUBLIC_DIRS = ['guide', 'web-ui']
const PUBLIC_FILES = ['index.md']
const EXCLUDED = new Set([
  'web-ui/flow-audit.md',
  'web-ui/design-tokens.md',
  'web-ui/help-system.md',
])

const PATTERNS = [
  /\bGuildhall should\b/i,
  /\bagents should\b/i,
  /\bagent should\b/i,
  /\bworker should\b/i,
  /\breviewer should\b/i,
  /\bcoordinator should\b/i,
  /\bhuman input\b/i,
  /\bhuman questions?\b/i,
  /\bhuman decisions?\b/i,
  /\bhuman intervention\b/i,
  /\bhuman owner\b/i,
  /\bhuman operator\b/i,
  /\bhumans\b/i,
]

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...await walk(full))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full)
  }
  return files
}

const files = [
  ...PUBLIC_FILES.map((file) => join(DOCS, file)),
]
for (const dir of PUBLIC_DIRS) {
  files.push(...await walk(join(DOCS, dir)))
}

const findings = []
for (const file of files) {
  const rel = relative(DOCS, file)
  if (EXCLUDED.has(rel)) continue
  const lines = (await readFile(file, 'utf8')).split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const pattern of PATTERNS) {
      if (pattern.test(line)) {
        findings.push(`${rel}:${index + 1}: ${line.trim()}`)
        break
      }
    }
  })
}

if (findings.length > 0) {
  console.error('Public docs copy still contains internal agent-instruction voice:')
  for (const finding of findings) console.error(`- ${finding}`)
  process.exit(1)
}

console.log('public-copy: voice check passed')
