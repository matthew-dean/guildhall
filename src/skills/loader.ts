/**
 * Ported from openharness/src/openharness/skills/loader.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `get_config_dir()` → `getConfigDir()` from `@guildhall/sessions`
 *   - Plugin loading is deferred — upstream's `load_plugins` walks a plugin
 *     registry that hasn't been ported yet; the `extraSkillDirs` hook is
 *     still wired so host code can inject extra roots explicitly
 *   - Directory existence checks use `mkdirSync(..., { recursive: true })`
 *     to mirror upstream's `Path.mkdir(parents=True, exist_ok=True)`
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

import { getConfigDir } from '@guildhall/sessions'

import { getBundledSkills } from './bundled.js'
import { parseSkillFrontmatter } from './frontmatter.js'
import { SkillRegistry } from './registry.js'
import type { SkillDefinition } from './types.js'

export function getUserSkillsDir(): string {
  const dir = join(getConfigDir(), 'skills')
  mkdirSync(dir, { recursive: true })
  return dir
}

export interface LoadSkillRegistryOptions {
  cwd?: string
  extraSkillDirs?: readonly string[]
}

export function loadSkillRegistry(opts: LoadSkillRegistryOptions = {}): SkillRegistry {
  const registry = new SkillRegistry()
  for (const skill of getBundledSkills()) registry.register(skill)
  for (const skill of loadUserSkills()) registry.register(skill)
  for (const skill of loadSkillsFromDirs(opts.extraSkillDirs, 'user')) registry.register(skill)
  return registry
}

export function loadUserSkills(): SkillDefinition[] {
  return loadSkillsFromDirs([getUserSkillsDir()], 'user')
}

export function loadSkillsFromDirs(
  directories: readonly string[] | undefined,
  source = 'user',
): SkillDefinition[] {
  const skills: SkillDefinition[] = []
  if (!directories || directories.length === 0) return skills

  const seen = new Set<string>()
  for (const directory of directories) {
    const root = resolve(expandHome(directory))
    mkdirSync(root, { recursive: true })

    const candidates: string[] = []
    for (const entry of readdirSync(root).sort()) {
      const childPath = join(root, entry)
      let childStat
      try {
        childStat = statSync(childPath)
      } catch {
        continue
      }
      if (!childStat.isDirectory()) continue
      const skillPath = join(childPath, 'SKILL.md')
      if (existsSync(skillPath)) candidates.push(skillPath)
    }

    for (const path of candidates) {
      if (seen.has(path)) continue
      seen.add(path)
      const content = readFileSync(path, 'utf8')
      const parent = path.slice(0, path.length - '/SKILL.md'.length)
      const defaultName = parent.split('/').pop() ?? 'skill'
      const { name, description } = parseSkillFrontmatter(defaultName, content)
      skills.push({ name, description, content, source, path })
    }
  }
  return skills
}

function expandHome(p: string): string {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (p === '~') return homedir()
  return p
}
