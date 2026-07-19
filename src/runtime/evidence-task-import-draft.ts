import type { EvidenceTask } from './evidence-work-graph-intake.js'

export function cleanEvidenceSnippet(snippet: string): string {
  return snippet
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .replace(/\s*\|\s*/g, ' | ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function evidenceTaskReferences(task: EvidenceTask): string[] {
  return [...new Set(task.sourceRefs.map(source => source.path).filter(Boolean))]
}

export function evidenceTaskDescription(task: EvidenceTask): string {
  const snippet = task.sourceRefs
    .map(ref => cleanEvidenceSnippet(ref.snippet))
    .find(Boolean)
  if (snippet) return snippet
  if (task.kind === 'integration') {
    return `Wire ${task.deliverableName} into ${task.consumerSurface ?? task.targetArea}.`
  }
  if (task.buildsOn.length > 0) {
    return `${task.title} using ${task.buildsOn.join(', ')}.`
  }
  return task.title
}

export function evidenceTaskWhyThisMayMatter(task: EvidenceTask): string {
  if (task.kind === 'integration') {
    return `${task.consumerSurface ?? task.targetArea} depends on ${task.deliverableName} before the live workflow can be proven.`
  }
  if (task.buildsOn.length > 0) {
    return `${task.deliverableName} is a prerequisite the project evidence already connects to ${task.buildsOn.join(', ')}.`
  }
  return `${task.deliverableName} is identified in project evidence as scoped work that still needs proof.`
}

export function evidenceTaskPriority(task: EvidenceTask): 'critical' | 'high' | 'normal' | 'low' {
  return task.kind === 'integration' ? 'normal' : 'high'
}
