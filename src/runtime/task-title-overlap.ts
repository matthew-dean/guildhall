const TASK_TITLE_OVERLAP_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'of',
  'the',
  'to',
])

function normalizeTaskTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function taskTitleTokens(value: string | undefined): Set<string> {
  return new Set(normalizeTaskTitle(String(value ?? ''))
    .split(/\s+/)
    .filter(token => token.length > 2)
    .filter(token => !TASK_TITLE_OVERLAP_STOPWORDS.has(token)))
}

export function taskTitleOverlap(left: string | undefined, right: string | undefined): number {
  const leftTokens = taskTitleTokens(left)
  const rightTokens = taskTitleTokens(right)
  const smaller = Math.min(leftTokens.size, rightTokens.size)
  if (smaller < 5) return 0
  let overlap = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1
  }
  return overlap / smaller
}
