#!/usr/bin/env node
// CI check: every help_topic id referenced in the UI must exist in docs.
//
// Finds all `help="foo.bar"` / `topic="foo.bar"` references in .svelte files
// under src/web/, runs the extractor, and fails if any referenced id is
// missing from the generated topic map.

import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const WEB_DIR = resolve(ROOT, 'src/web')
const GENERATED = resolve(ROOT, 'src/web/generated/help-topics.json')

const extract = spawnSync('node', ['scripts/extract-help-topics.mjs'], {
  cwd: ROOT,
  stdio: 'inherit',
})
if (extract.status !== 0) process.exit(extract.status ?? 1)

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const out = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'generated' || entry.name === 'node_modules') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else if (entry.isFile() && (entry.name.endsWith('.svelte') || entry.name.endsWith('.ts'))) out.push(full)
  }
  return out
}

const HELP_RE = /\b(?:topic|help)=["']([a-z0-9][a-z0-9._-]*)["']/g

async function main() {
  const topics = JSON.parse(await readFile(GENERATED, 'utf8'))
  const known = new Set(Object.keys(topics))

  const files = await walk(WEB_DIR)
  const missing = new Map() // id -> [files]
  let totalRefs = 0

  for (const abs of files) {
    const src = await readFile(abs, 'utf8')
    let m
    while ((m = HELP_RE.exec(src))) {
      totalRefs++
      const id = m[1]
      if (!known.has(id)) {
        const rel = relative(ROOT, abs)
        if (!missing.has(id)) missing.set(id, [])
        missing.get(id).push(rel)
      }
    }
  }

  if (missing.size) {
    console.error('\nhelp-sync: UI references help topics that do not exist in docs:')
    for (const [id, refs] of missing) {
      console.error(`  - ${id}`)
      for (const r of refs) console.error(`      referenced in ${r}`)
    }
    console.error('\nEither add a docs page with `help_topic: <id>` in its frontmatter,')
    console.error('or remove the reference from the UI.\n')
    process.exit(1)
  }

  console.log(`help-sync: ${totalRefs} UI reference(s) resolve cleanly against ${known.size} docs topic(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
