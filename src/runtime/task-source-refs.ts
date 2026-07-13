export interface TaskSourceRefInput {
  title?: string
  description?: string
  spec?: string
  structuredSpec?: unknown
  acceptanceCriteria?: Array<{ description?: string; text?: string; command?: string }>
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
  ].filter(Boolean).join('\n')
  return [...new Set([...text.matchAll(/(?:^|[\s`'"([])([\w./-]*docs\/[\w./-]+\.md)\b/g)]
    .map(match => match[1])
    .filter((ref): ref is string => Boolean(ref)))]
}
