export interface TaskSourceRefInput {
  title?: string
  description?: string
  spec?: string
  structuredSpec?: unknown
  acceptanceCriteria?: Array<{ description?: string; text?: string; command?: string }>
  notes?: unknown[]
  gateResults?: unknown[]
  adjudications?: unknown[]
}

export function explicitMarkdownSourceRefsFromTask(task: TaskSourceRefInput): string[] {
  const text = [
    task.title,
    task.description,
    task.spec,
    task.structuredSpec ? JSON.stringify(task.structuredSpec) : null,
    ...(task.acceptanceCriteria ?? []).map(criterion =>
      [criterion.description, criterion.text, criterion.command].filter(Boolean).join(' '),
    ),
    ...(task.notes ?? []).map(value => JSON.stringify(value)),
    ...(task.gateResults ?? []).map(value => JSON.stringify(value)),
    ...(task.adjudications ?? []).map(value => JSON.stringify(value)),
  ].filter(Boolean).join('\n')
  return [...new Set([...text.matchAll(/(?:^|[\s`'"([])([\w./-]*docs\/[\w./-]+\.md)\b/g)]
    .map(match => match[1])
    .filter((ref): ref is string => Boolean(ref)))]
}
