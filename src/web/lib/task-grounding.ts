import type { Task } from './types.js'
import { sourceRefsSummary } from './source-refs.js'

function normalizedText(value: string | undefined): string {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
}

function taskMatchesText(task: Task, candidate: string): boolean {
  const normalized = normalizedText(candidate)
  if (!normalized) return false
  return normalized === normalizedText(task.title) || normalized === normalizedText(task.description)
}

export function taskSourceSummary(task: Task, limit = 2): string | null {
  const refs = [...(task.sourceRefs ?? []), ...(task.references ?? [])]
  return sourceRefsSummary(refs, limit)
}

export function taskGroundingDetail(task: Task, limit = 2): string | null {
  const summary = task.orientationSummary?.trim()
  if (summary && !taskMatchesText(task, summary)) return summary
  const sourceSummary = taskSourceSummary(task, limit)
  return sourceSummary ? `Source: ${sourceSummary}` : null
}
