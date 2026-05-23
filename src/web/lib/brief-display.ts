interface BriefLike {
  userJob?: string | undefined
  successMetric?: string | undefined
  successCriteria?: string | undefined
}

const OPERATIONAL_RECEIPT =
  /\b(?:done|persisted|saved|updated|revised|set task status|appended this turn|logged a milestone|with tools|concrete progress|durable blueprint steps)\b/i

export function briefTextForReaders(value: string | undefined | null): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return undefined
  if (OPERATIONAL_RECEIPT.test(trimmed)) return undefined
  return trimmed
}

export function briefScopeForReaders(brief: BriefLike | undefined | null, fallbackTitle: string): string {
  return briefTextForReaders(brief?.userJob) ?? fallbackTitle
}

export function briefDoneWhenForReaders(brief: BriefLike | undefined | null): string | undefined {
  return briefTextForReaders(brief?.successMetric) ?? briefTextForReaders(brief?.successCriteria)
}
