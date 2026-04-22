/**
 * Ported from the YAML-frontmatter parsing blocks in
 *   openharness/src/openharness/skills/loader.py:_parse_skill_markdown
 *   openharness/src/openharness/skills/bundled/__init__.py:_parse_frontmatter
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Upstream's loader uses `yaml.safe_load` on the frontmatter block; the
 *     bundled loader does line-by-line parsing without yaml. Both only ever
 *     read `name` and `description` keys, so we port a single line-by-line
 *     parser that handles both call sites and avoids pulling in a YAML dep.
 *   - Quoted-value stripping matches upstream's
 *     `val.strip().strip("'\"")` (both single and double quotes).
 */

function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

export function parseSkillFrontmatter(
  defaultName: string,
  content: string,
): { name: string; description: string } {
  let name = defaultName
  let description = ''

  const lines = content.split('\n')

  if (content.startsWith('---\n')) {
    const endIndex = content.indexOf('\n---\n', 4)
    if (endIndex !== -1) {
      const block = content.slice(4, endIndex)
      for (const rawLine of block.split('\n')) {
        const line = rawLine.trim()
        if (line.startsWith('name:')) {
          const val = stripQuotes(line.slice(5))
          if (val) name = val
        } else if (line.startsWith('description:')) {
          const val = stripQuotes(line.slice(12))
          if (val) description = val
        }
      }
    }
  }

  if (!description) {
    for (const rawLine of lines) {
      const stripped = rawLine.trim()
      if (stripped.startsWith('# ')) {
        if (!name || name === defaultName) {
          const heading = stripped.slice(2).trim()
          name = heading || defaultName
        }
        continue
      }
      if (stripped && !stripped.startsWith('---') && !stripped.startsWith('#')) {
        description = stripped.slice(0, 200)
        break
      }
    }
  }

  if (!description) description = `Skill: ${name}`
  return { name, description }
}
