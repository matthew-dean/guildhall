/**
 * Ported from openharness/src/openharness/skills/registry.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `dict[str, SkillDefinition]` → `Map<string, SkillDefinition>`
 *   - `sorted(..., key=lambda s: s.name)` → `[...map.values()].sort((a, b) =>
 *     a.name.localeCompare(b.name))`
 */

import type { SkillDefinition } from './types.js'

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>()

  register(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill)
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}
