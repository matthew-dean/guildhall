import type { CheckInput, CheckResult, DeterministicCheck } from './types.js'

export interface TruncatedContentFinding {
  line: number
  snippet: string
  kind: 'ellipsis-slice' | 'semantic-truncate-helper' | 'stored-ellipsis-field'
}

export interface TruncatedDataFinding {
  path: string
  preview: string
}

const SEMANTIC_FIELD_PATTERN =
  /\b(title|description|summary|detail|content|body|prompt|answer|question|label|reason|note|message)\b/i

export function findTruncatedContentStorage(source: string): TruncatedContentFinding[] {
  const findings: TruncatedContentFinding[] = []
  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue

    if (/\bslice\s*\([^)]*\)[^;\n]*['"`]\.\.\.['"`]/.test(line)) {
      findings.push({
        line: i + 1,
        snippet: trimmed.slice(0, 200),
        kind: 'ellipsis-slice',
      })
      continue
    }

    if (/\btruncate[A-Za-z0-9_]*\s*\(/.test(line) && SEMANTIC_FIELD_PATTERN.test(line)) {
      findings.push({
        line: i + 1,
        snippet: trimmed.slice(0, 200),
        kind: 'semantic-truncate-helper',
      })
      continue
    }

    if (
      SEMANTIC_FIELD_PATTERN.test(line) &&
      /[:=]\s*['"`][^'"`]*\.\.\.['"`]/.test(line) &&
      !/\b(loading|saving|starting|stopping|placeholder|aria-label)\b/i.test(line)
    ) {
      findings.push({
        line: i + 1,
        snippet: trimmed.slice(0, 200),
        kind: 'stored-ellipsis-field',
      })
    }
  }
  return findings
}

export function findTruncatedSemanticData(value: unknown, rootPath = 'task'): TruncatedDataFinding[] {
  const findings: TruncatedDataFinding[] = []
  visitSemanticData(value, rootPath, false, findings)
  return findings
}

function visitSemanticData(
  value: unknown,
  path: string,
  semanticPath: boolean,
  findings: TruncatedDataFinding[],
): void {
  if (typeof value === 'string') {
    const text = value.trim()
    if (semanticPath && /\.\.\.$/.test(text)) {
      findings.push({ path, preview: text.slice(0, 160) })
    }
    return
  }
  if (!value || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitSemanticData(item, `${path}[${index}]`, semanticPath, findings))
    return
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`
    const isSemantic = semanticPath || SEMANTIC_FIELD_PATTERN.test(key)
    visitSemanticData(child, childPath, isSemantic, findings)
  }
}

export const CONTENT_INTEGRITY_CHECK: DeterministicCheck = {
  id: 'content.no-truncated-data',
  description:
    'Flag code paths that appear to persist ellipsized or mechanically truncated prose as semantic data.',
  run(_input: CheckInput): CheckResult {
    const findings = findTruncatedSemanticData(_input.task)
    if (findings.length > 0) {
      return {
        checkId: 'content.no-truncated-data',
        pass: false,
        summary: `found ${findings.length} semantic field(s) ending in ellipsis`,
        detail: findings.map(f => `${f.path}: ${f.preview}`).join('\n'),
        suggestions: [
          'Replace ellipsized stored content with a complete short summary, or keep the original complete content in the semantic field and clip only in display.',
          'For model-generated fields with max lengths, ask the model to produce a shorter complete label rather than truncating the returned prose.',
        ],
      }
    }
    return {
      checkId: 'content.no-truncated-data',
      pass: true,
      summary: 'no ellipsized semantic task data detected',
    }
  },
}
