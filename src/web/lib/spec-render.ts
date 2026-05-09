export function stripAcceptanceCriteriaSection(spec: string): string {
  const lines = spec.split(/\r?\n/)
  const kept: string[] = []
  let skipping = false
  let skipDepth = 0

  for (const line of lines) {
    const heading = /^(#{2,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      const depth = heading[1]!.length
      const title = heading[2]!.trim().toLowerCase()
      if (skipping && depth <= skipDepth) {
        skipping = false
        skipDepth = 0
      }
      if (!skipping && title === 'acceptance criteria') {
        skipping = true
        skipDepth = depth
        continue
      }
    }
    if (!skipping) kept.push(line)
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export function escapeAngleBracketPlaceholders(value: string): string {
  return value.replace(/<([^>\n]+)>/g, '&lt;$1&gt;')
}
