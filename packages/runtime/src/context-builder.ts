import fs from 'node:fs/promises'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import { loadGoalForTask } from './business-envelope.js'

// ---------------------------------------------------------------------------
// Just-in-time context builder
//
// Instead of dumping all of MEMORY.md into every agent call, this builder
// assembles a focused, task-scoped context block. This is critical for
// local LLMs with limited context windows — irrelevant content actively
// degrades output quality.
//
// Each agent receives:
//   1. Its own role description (from its system prompt)
//   2. The specific task it's working on
//   3. Relevant memory excerpts (sections matching task domain/keywords)
//   4. The last N progress entries (recent activity, not full history)
//   5. Recent decisions relevant to the task's domain
//
// Context is assembled fresh for each agent invocation.
// ---------------------------------------------------------------------------

const RECENT_PROGRESS_LINES = 60   // Last ~10-15 entries
const MAX_MEMORY_CHARS = 4000       // Cap memory injection size
const MAX_DECISIONS_CHARS = 2000    // Cap decisions injection size
const MAX_EXPLORING_CHARS = 6000    // Transcript tail cap for exploring intake

export interface BuiltContext {
  taskSummary: string
  projectMemory: string
  recentProgress: string
  recentDecisions: string
  /**
   * FR-08 / FR-12: if the task is in the `exploring` phase, the last chunk of
   * the ongoing conversation transcript so the Spec Agent can resume intake
   * mid-conversation instead of starting over. Empty for tasks not in exploring
   * or with no transcript yet.
   */
  exploringTranscript: string
  /**
   * FR-23: business-envelope summary for the task's parent goal. Empty when
   * the task has no `parentGoalId` or the goal book is absent. Agents see the
   * goal title, success condition, and guardrails so they can self-check
   * against the envelope before taking destructive actions; the coordinator
   * makes the authoritative call via `evaluateEnvelope`.
   */
  envelope: string
  /** Concatenated string ready to prepend to an agent message */
  formatted: string
}

/**
 * Extract sections from MEMORY.md that are relevant to the given task.
 * Relevance is determined by matching domain name, task keywords, and
 * any component/file names mentioned in the task description.
 */
function extractRelevantMemorySections(memory: string, task: Task): string {
  const keywords = [
    task.domain,
    ...task.title.toLowerCase().split(/\s+/),
    ...(task.description.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []),
  ].map(k => k.toLowerCase())

  const sections = memory.split(/^## /m).filter(Boolean)

  const scored = sections.map(section => {
    const lower = section.toLowerCase()
    const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0)
    return { section: `## ${section}`, score }
  })

  const relevant = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.section)
    .join('\n')

  return relevant.slice(0, MAX_MEMORY_CHARS)
}

/**
 * Extract the last N lines of PROGRESS.md.
 */
function extractRecentProgress(progress: string): string {
  const lines = progress.trimEnd().split('\n')
  return lines.slice(-RECENT_PROGRESS_LINES).join('\n')
}

/**
 * Extract decision entries from DECISIONS.md that match the task's domain.
 */
function extractRelevantDecisions(decisions: string, domain: string): string {
  const entries = decisions.split(/^---$/m).filter(Boolean)
  const relevant = entries
    .filter(e => e.toLowerCase().includes(domain.toLowerCase()))
    .slice(-5) // Last 5 relevant decisions
    .join('\n---\n')

  return relevant.slice(0, MAX_DECISIONS_CHARS)
}

export async function buildContext(
  task: Task,
  memoryDir: string
): Promise<BuiltContext> {
  const readSafe = async (file: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(memoryDir, file), 'utf-8')
    } catch {
      return ''
    }
  }

  const [memory, progress, decisions, exploring, goal] = await Promise.all([
    readSafe('MEMORY.md'),
    readSafe('PROGRESS.md'),
    readSafe('DECISIONS.md'),
    // Only bother with the transcript when we're actually in the exploring phase.
    task.status === 'exploring'
      ? readSafe(path.join('exploring', `${task.id}.md`))
      : Promise.resolve(''),
    // FR-23: resolve the task's parent goal. Missing-goal cases become
    // `undefined` — the summary renderer omits the envelope block.
    loadGoalForTask(memoryDir, task).catch(() => undefined),
  ])

  const projectMemory = extractRelevantMemorySections(memory, task)
  const recentProgress = extractRecentProgress(progress)
  const recentDecisions = extractRelevantDecisions(decisions, task.domain)
  const exploringTranscript = exploring
    ? exploring.slice(-MAX_EXPLORING_CHARS)
    : ''
  const envelope = goal
    ? [
        `**Parent goal:** ${goal.id} — ${goal.title} (${goal.status})`,
        `**Success condition:** ${goal.successCondition}`,
        goal.guardrails.length > 0
          ? `**Guardrails:**\n${goal.guardrails
              .map(
                (g) =>
                  `- [${g.kind}] ${g.description}${g.tags.length ? ` (tags: ${g.tags.join(', ')})` : ''}`,
              )
              .join('\n')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : ''

  const taskSummary = [
    `## Current Task: ${task.id}`,
    `**Title:** ${task.title}`,
    `**Domain:** ${task.domain}`,
    `**Status:** ${task.status}`,
    `**Priority:** ${task.priority}`,
    task.spec ? `\n### Spec\n${task.spec}` : '',
    task.acceptanceCriteria.length > 0
      ? `\n### Acceptance Criteria\n${task.acceptanceCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}`
      : '',
    task.outOfScope.length > 0
      ? `\n### Out of Scope\n${task.outOfScope.map(s => `- ${s}`).join('\n')}`
      : '',
    task.notes.length > 0
      ? `\n### Agent Notes\n${task.notes.slice(-5).map(n => `**${n.agentId} (${n.role})** ${n.timestamp}:\n${n.content}`).join('\n\n')}`
      : '',
  ].filter(Boolean).join('\n')

  const formatted = [
    '<!-- FORGE CONTEXT: injected just-in-time, do not modify -->',
    '',
    taskSummary,
    '',
    envelope ? `## Business Envelope (FR-23)\n${envelope}` : '',
    '',
    projectMemory ? `## Relevant Project Memory\n${projectMemory}` : '',
    '',
    recentProgress ? `## Recent Progress\n${recentProgress}` : '',
    '',
    recentDecisions ? `## Recent Decisions (${task.domain})\n${recentDecisions}` : '',
    '',
    exploringTranscript
      ? `## Exploring Transcript (tail)\n${exploringTranscript}`
      : '',
    '',
    '<!-- END FORGE CONTEXT -->',
  ].filter(s => s !== undefined).join('\n').trim()

  return {
    taskSummary,
    projectMemory,
    recentProgress,
    recentDecisions,
    exploringTranscript,
    envelope,
    formatted,
  }
}
