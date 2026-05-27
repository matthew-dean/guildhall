import type { Task } from '@guildhall/core'
import type { GitStatusSummary } from './git-driver.js'

export const COMMIT_STORY_PRACTICE_ID = 'commit-story'

export interface BuildCommitStoryMessageInput {
  task: Pick<Task, 'id' | 'title'>
  status: Pick<GitStatusSummary, 'changedCount' | 'untrackedCount' | 'samplePaths'>
}

const WEAK_TITLES = [
  /^do a thing$/i,
  /^fix stuff$/i,
  /^misc(?:ellaneous)?$/i,
  /^update files?$/i,
  /^wip\b/i,
]

const LEADING_VERBS = [
  'add',
  'address',
  'allow',
  'build',
  'clean',
  'complete',
  'create',
  'define',
  'document',
  'enable',
  'fix',
  'harden',
  'implement',
  'improve',
  'introduce',
  'move',
  'prepare',
  'record',
  'remove',
  'repair',
  'replace',
  'resolve',
  'restore',
  'surface',
  'update',
  'wire',
]

export function buildCommitStoryMessage(input: BuildCommitStoryMessageInput): string {
  const subject =
    normalizeSubject(input.task.title) ??
    subjectFromPaths(input.status.samplePaths) ??
    `Complete ${input.task.id}`
  const body = buildBody(input)
  return body ? `${subject}\n\n${body}` : subject
}

function normalizeSubject(title: string | undefined): string | undefined {
  const clean = (title ?? '')
    .replace(/^#+\s*/, '')
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^task[-:\s]+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,\s]+$/, '')
    .trim()
  if (clean.length === 0 || WEAK_TITLES.some((pattern) => pattern.test(clean))) return undefined
  const firstWord = clean.split(/\s+/, 1)[0]?.toLowerCase()
  const withVerb = firstWord && LEADING_VERBS.includes(firstWord)
    ? clean
    : `Complete ${clean.charAt(0).toLowerCase()}${clean.slice(1)}`
  return truncateSubject(capitalizeFirst(withVerb))
}

function subjectFromPaths(paths: string[]): string | undefined {
  const useful = paths.map((filePath) => filePath.replace(/\\/g, '/')).filter(Boolean)
  if (useful.length === 0) return undefined
  const topLevels = new Set(
    useful.map((filePath) => filePath.split('/').filter(Boolean)[0]).filter(Boolean),
  )
  const basenames = useful.map((filePath) => filePath.split('/').filter(Boolean).at(-1) ?? filePath)
  const testOnly = basenames.length > 0 && basenames.every((name) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name))
  if (testOnly) return 'Update tests'
  if (topLevels.size === 1) return truncateSubject(`Update ${[...topLevels][0]} work`)
  return 'Update completed task work'
}

function buildBody(input: BuildCommitStoryMessageInput): string | undefined {
  const changedTotal = input.status.changedCount + input.status.untrackedCount
  const paths = input.status.samplePaths.slice(0, 4)
  if (changedTotal <= 1 && paths.length <= 1) return undefined

  const lines = [`Task: ${input.task.id}`]
  if (changedTotal > 0) {
    const tracked = input.status.changedCount
    const untracked = input.status.untrackedCount
    const parts = [
      tracked > 0 ? `${tracked} changed` : undefined,
      untracked > 0 ? `${untracked} untracked` : undefined,
    ].filter(Boolean)
    lines.push(`Changes: ${parts.join(', ')}`)
  }
  if (paths.length > 0) {
    lines.push('Paths:')
    lines.push(...paths.map((filePath) => `- ${filePath}`))
  }
  if (input.status.samplePaths.length > paths.length) {
    lines.push(`- and ${input.status.samplePaths.length - paths.length} more`)
  }
  return lines.join('\n')
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function truncateSubject(value: string): string {
  if (value.length <= 72) return value
  return `${value.slice(0, 69).trimEnd()}...`
}
