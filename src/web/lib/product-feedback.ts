import { formatUserPath } from './display-path.js'

export interface ProductFeedbackSuggestion {
  id: string
  title: string
  summary: string
  evidence?: string[]
}

export interface ProductFeedbackProject {
  name?: string | null
  path?: string | null
}

export function buildProductFeedbackIssueUrl(input: {
  suggestion: ProductFeedbackSuggestion
  project?: ProductFeedbackProject | null
}): string {
  const issue = new URL('https://github.com/matthew-dean/guildhall/issues/new')
  issue.searchParams.set('title', `Product feedback: ${input.suggestion.title}`)
  issue.searchParams.set('body', buildIssueBody(input))
  return issue.toString()
}

function buildIssueBody(input: {
  suggestion: ProductFeedbackSuggestion
  project?: ProductFeedbackProject | null
}): string {
  const projectName = input.project?.name?.trim()
  const projectPath = formatUserPath(input.project?.path)
  const evidence = input.suggestion.evidence?.filter(item => item.trim().length > 0) ?? []
  return [
    '## Product feedback',
    '',
    input.suggestion.summary.trim(),
    '',
    '## Evidence',
    '',
    evidence.length > 0
      ? evidence.map(item => `- ${item}`).join('\n')
      : '- No evidence text was attached.',
    '',
    '## Source',
    '',
    projectName ? `- Project: ${projectName}` : '- Project: Unknown',
    projectPath ? `- Path: ${projectPath}` : '',
    `- Suggestion id: ${input.suggestion.id}`,
    '- Created from Guildhall Settings -> Memory and habits.',
  ].filter(line => line !== '').join('\n')
}
