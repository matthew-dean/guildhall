/**
 * Skill lookup tool — read a bundled / user / workspace skill by name.
 *
 * Ported from
 *   openharness/src/openharness/tools/skill_tool.py
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - `load_skill_registry` in upstream takes (cwd, extra_skill_dirs,
 *     extra_plugin_roots); the Guildhall port's `loadSkillRegistry` has no
 *     plugin root concept yet (see skills/loader.ts header), so the tool
 *     only forwards `extra_skill_dirs` from the ToolExecutionContext
 *     metadata.
 *   - Lowercase / title-case fallback lookups are preserved verbatim.
 */

import { defineTool } from '@guildhall/engine'
import { loadSkillRegistry } from '@guildhall/skills'
import { z } from 'zod'

const skillInputSchema = z.object({
  name: z.string().describe('Skill name'),
})
export type SkillToolInput = z.input<typeof skillInputSchema>

function titleCase(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export const skillTool = defineTool({
  name: 'skill',
  description: 'Read a bundled, user, or workspace skill by name.',
  inputSchema: skillInputSchema,
  jsonSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Skill name' } },
    required: ['name'],
  },
  isReadOnly: () => true,
  execute: async (input, ctx) => {
    const extra = ctx.metadata?.extra_skill_dirs as readonly string[] | undefined
    const registry = loadSkillRegistry({
      ...(ctx.cwd ? { cwd: ctx.cwd } : {}),
      ...(extra ? { extraSkillDirs: extra } : {}),
    })
    const skill =
      registry.get(input.name) ??
      registry.get(input.name.toLowerCase()) ??
      registry.get(titleCase(input.name))
    if (!skill) {
      return {
        output: `Skill not found: ${input.name}`,
        is_error: true,
      }
    }
    return { output: skill.content, is_error: false }
  },
})
