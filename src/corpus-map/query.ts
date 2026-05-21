import path from 'node:path'
import type {
  CodebaseMap,
  CodebaseMapQuery,
  CodebaseMapQueryResult,
  CorpusTaskContext,
  ContextBudgetOptions,
  ScoredCorpusAbstraction,
  ScoredCorpusArea,
  ScoredCorpusFile,
} from './types.js'

export function queryCodebaseMap(map: CodebaseMap, query: CodebaseMapQuery): CodebaseMapQueryResult {
  const tokens = tokenize([
    query.text,
    query.area ?? '',
    query.kind ?? '',
    ...(query.paths ?? []),
  ].join(' '))
  const limit = query.limit ?? 8
  const files = Object.values(map.files)
    .map((file): ScoredCorpusFile => {
      const haystack = tokenize([
        file.path,
        file.kind,
        file.language,
        file.summary,
        file.symbols.join(' '),
        file.imports.join(' '),
        file.areaIds.join(' '),
      ].join(' '))
      const reasons: string[] = []
      let score = scoreTokens(tokens, haystack)
      if (query.paths?.some((candidate) => normalize(candidate) === file.path)) {
        score += 12
        reasons.push('likely touched file')
      }
      if (query.area && file.areaIds.includes(query.area)) {
        score += 5
        reasons.push(`inside ${query.area}`)
      }
      if (query.kind && file.kind === query.kind) {
        score += 3
        reasons.push(`${query.kind} file`)
      }
      if (score > 0 && reasons.length === 0) reasons.push('matches task language')
      return { file, score, reasons }
    })
    .filter((item) => item.score > 0)
    .sort(sortScored)
    .slice(0, limit)

  const areas = map.areas
    .map((area): ScoredCorpusArea => {
      const haystack = tokenize([
        area.id,
        area.title,
        area.summary,
        area.owns.join(' '),
        area.conventions.join(' '),
        area.canonicalFiles.map((file) => `${file.path} ${file.summary} ${file.symbols.join(' ')}`).join(' '),
      ].join(' '))
      const score = scoreTokens(tokens, haystack) + (query.area === area.id ? 10 : 0)
      return { area, score, reasons: score > 0 ? ['matches task area or vocabulary'] : [] }
    })
    .filter((item) => item.score > 0)
    .sort(sortScored)
    .slice(0, Math.min(4, limit))

  const abstractions = findExistingAbstraction(map, query.text, limit)
  const readNext = [
    ...abstractions.map((item) => ({ path: item.abstraction.canonicalPath, reason: `Reuse ${item.abstraction.title}` })),
    ...files.map((item) => ({ path: item.file.path, reason: item.reasons[0] ?? 'Relevant file' })),
  ].filter((item, index, array) => array.findIndex((other) => other.path === item.path) === index)
    .slice(0, limit)

  return {
    files,
    areas,
    abstractions,
    readNext,
    explanations: [
      'Prefer existing abstractions before adding new files or surface-local patterns.',
      'Open the read-next files only as needed; the map is a navigation aid, not a full source dump.',
    ],
  }
}

export function findExistingAbstraction(
  map: CodebaseMap,
  text: string,
  limit = 6,
): ScoredCorpusAbstraction[] {
  const tokens = tokenize(text)
  return map.abstractions
    .map((abstraction): ScoredCorpusAbstraction => {
      const haystack = tokenize([
        abstraction.id,
        abstraction.title,
        abstraction.kind,
        abstraction.canonicalPath,
        abstraction.useWhen.join(' '),
        abstraction.avoid.join(' '),
        abstraction.related.join(' '),
      ].join(' '))
      let score = scoreTokens(tokens, haystack)
      const basename = path.basename(abstraction.canonicalPath).replace(/\.[^.]+$/, '').toLowerCase()
      if (tokens.includes(abstraction.id)) score += 12
      if (tokens.includes(basename)) score += 10
      if (abstraction.id === 'button' && tokens.some((token) => ['button', 'action', 'cta', 'control'].includes(token))) {
        score += 15
      }
      return {
        abstraction,
        score,
        reasons: score > 0 ? ['existing abstraction matches task'] : [],
      }
    })
    .filter((item) => item.score > 0)
    .sort(sortScored)
    .slice(0, limit)
}

export function buildWorkerCorpusContext(
  map: CodebaseMap,
  task: CorpusTaskContext,
  budget: ContextBudgetOptions = {},
): string {
  const maxChars = budget.maxChars ?? 3200
  const readNextLimit = budget.readNextLimit ?? 6
  const result = queryCodebaseMap(map, {
    text: `${task.title}\n${task.description}`,
    paths: task.likelyFiles,
    limit: readNextLimit,
  })
  const lines: string[] = [
    '## Corpus Map',
    '',
    `Project: ${map.project.summary}`,
  ]
  if (map.project.primaryFrameworks.length > 0) {
    lines.push(`Frameworks: ${map.project.primaryFrameworks.join(', ')}`)
  }
  if (map.designSystem) {
    lines.push('', 'Design system:')
    lines.push(
      `- Maturity: ${map.designSystem.maturity}${map.designSystem.approved ? ', approved' : ', not approved'}`,
    )
    const tokenSummary = Object.entries(map.designSystem.tokenCounts)
      .map(([name, count]) => `${name} ${count}`)
      .join(', ')
    lines.push(`- Tokens: ${tokenSummary}`)
    if (map.designSystem.primitives.length > 0) {
      lines.push(`- Primitives: ${map.designSystem.primitives.map((primitive) => primitive.name).slice(0, 8).join(', ')}`)
    }
    for (const recommendation of map.designSystem.recommendations.slice(0, 1)) {
      lines.push(`- ${recommendation}`)
    }
  }
  if (result.areas.length > 0) {
    lines.push('', 'Mapped area:')
    for (const item of result.areas.slice(0, 2)) {
      lines.push(`- ${item.area.title}: ${item.area.summary}`)
      for (const convention of item.area.conventions.slice(0, 2)) {
        lines.push(`  - ${convention}`)
      }
    }
  }
  if (result.abstractions.length > 0) {
    lines.push('', 'Reuse / Extend:')
    for (const item of result.abstractions.slice(0, 4)) {
      lines.push(`- ${item.abstraction.title} (${item.abstraction.canonicalPath})`)
      if (item.abstraction.useWhen[0]) lines.push(`  - Use when: ${item.abstraction.useWhen[0]}`)
      if (item.abstraction.avoid[0]) lines.push(`  - Avoid: ${item.abstraction.avoid[0]}`)
    }
  }
  if (result.readNext.length > 0) {
    lines.push('', 'Read next:')
    for (const item of result.readNext.slice(0, readNextLimit)) lines.push(`- ${item.path}: ${item.reason}`)
  }
  const corpusFitRequirement = 'Corpus fit required: before editing, name the existing primitive, helper, package, design token, component, or area you are extending; if two similar ideas already exist, consider consolidation before adding a third. For design-system gaps, systemize just in time when repetition is stable enough to outweigh the maintenance cost.'
  lines.push('', corpusFitRequirement)
  const rendered = lines.join('\n')
  if (rendered.length <= maxChars) return rendered
  const suffix = `\n... [corpus map clipped]\n\n${corpusFitRequirement}`
  const prefixLength = Math.max(0, maxChars - suffix.length)
  return `${rendered.slice(0, prefixLength).trimEnd()}${suffix}`
}

function tokenize(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1))]
}

function scoreTokens(needles: string[], haystack: string[]): number {
  if (needles.length === 0) return 0
  let score = 0
  const hay = new Set(haystack)
  for (const token of needles) {
    if (hay.has(token)) score += 4
    else if (haystack.some((item) => item.includes(token) || token.includes(item))) score += 1
  }
  return score
}

function sortScored<T extends { score: number }>(left: T, right: T): number {
  return right.score - left.score
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '')
}
