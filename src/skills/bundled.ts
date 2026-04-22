/**
 * Ported from openharness/src/openharness/skills/bundled/__init__.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Python `Path(__file__).parent / "content"` →
 *     `fileURLToPath(import.meta.url)` + `dirname` to locate the bundled
 *     content directory relative to the compiled module
 *   - Shared the frontmatter parsing with loader.ts via frontmatter.ts so
 *     bundled + user skills use the same parse rules
 *   - `sorted(_CONTENT_DIR.glob("*.md"))` → `readdirSync(...).filter(...).sort()`
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseSkillFrontmatter } from './frontmatter.js'
import type { SkillDefinition } from './types.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = join(MODULE_DIR, 'bundled', 'content')

export function getBundledSkills(): SkillDefinition[] {
  if (!existsSync(CONTENT_DIR)) return []

  const files = readdirSync(CONTENT_DIR)
    .filter((n) => n.endsWith('.md'))
    .sort()

  const skills: SkillDefinition[] = []
  for (const file of files) {
    const path = join(CONTENT_DIR, file)
    const content = readFileSync(path, 'utf8')
    const stem = file.replace(/\.md$/, '')
    const { name, description } = parseSkillFrontmatter(stem, content)
    skills.push({ name, description, content, source: 'bundled', path })
  }
  return skills
}
