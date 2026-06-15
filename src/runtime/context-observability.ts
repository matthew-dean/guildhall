import { appendManagedTextFile, readManagedTextFile, readManagedTextFileSync, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import type { BuiltContext } from './context-builder.js'
import {
  getProjectContextDebugLedgerPath,
  getProjectContextDebugSnapshotDir,
  inferProjectRootFromMemoryDir,
} from '@guildhall/sessions'
import { FileBackedGuildhallPersistence } from '@guildhall/persistence'

export interface ContextSectionStat {
  key: string
  label: string
  chars: number
  included: boolean
}

export interface ContextHealthWarning {
  code: string
  severity: 'info' | 'warn' | 'error'
  message: string
}

export interface ContextDebugRecord {
  id: string
  at: string
  taskId: string
  taskTitle: string
  taskStatus: string
  domain: string
  agentName: string
  agentRole: string
  modelId: string
  temperature?: number
  workspacePath: string
  taskProjectPath: string
  activeWorktreePath?: string
  promptChars: number
  contextChars: number
  promptPreview: string
  snapshotPath: string
  sections: ContextSectionStat[]
  corpusMap?: {
    included: boolean
    chars: number
    readNext: string[]
  }
  health: ContextHealthWarning[]
  reasons: string[]
  applicableGuildSlugs: string[]
  reviewerSlugs: string[]
  primaryEngineerSlug: string | null
  openQuestionCount: number
  acceptanceCriteriaCount: number
  memoryPacket?: {
    included: Array<{ id: string; type: string; scope: string }>
    withheld: Array<{ id: string; reason: string }>
    evidenceRefs: number
    memoryCore?: {
      adapter: 'mastra' | 'deterministic'
      fallbackUsed: boolean
      warnings: string[]
      candidates: Array<{
        id: string
        kind: string
        summary: string
        sourceRefs: Array<{ uri: string; path?: string; sourceKind: string }>
      }>
    }
  }
  structuralMap?: {
    included: boolean
    chars: number
    omitted: Array<{
      handle: string
      reason: string
      confidence: string
      retrievalHint: string
    }>
  }
}

const DEBUG_LOG_NAME = 'context-debug.jsonl'
const MAX_PROMPT_PREVIEW_CHARS = 1200
const MAX_SNAPSHOT_CONTEXT_CHARS = 16_000
const MAX_SNAPSHOT_PROMPT_CHARS = 16_000
const SNAPSHOT_RETENTION_PER_TASK = 12

function sanitize(text: string): string {
  return text.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function preview(text: string, max = 1000): string {
  const compact = text.trim().replace(/\s+/g, ' ')
  return compact.length <= max ? compact : `${compact.slice(0, max)}...`
}

function sectionStats(ctx: BuiltContext): ContextSectionStat[] {
  const sections: Array<[string, string, string]> = [
    ['taskSummary', 'Task summary', ctx.taskSummary],
    ['personaPrompt', 'Persona prompt', ctx.personaPrompt],
    ['envelope', 'Business envelope', ctx.envelope],
    ['designSystem', 'Design system', ctx.designSystem],
    ['reviewRubrics', 'Review rubrics', ctx.reviewRubrics],
    ['corpusMap', 'Corpus map', ctx.corpusMap],
    ['structuralMapContext', 'Structural map', ctx.structuralMapContext ?? ''],
    ['effectiveMemory', 'Effective memory', ctx.effectiveMemory ?? ''],
    ['projectMemory', 'Project memory', ctx.projectMemory],
    ['recentProgress', 'Recent progress', ctx.recentProgress],
    ['recentDecisions', 'Recent decisions', ctx.recentDecisions],
    ['exploringTranscript', 'Exploring transcript', ctx.exploringTranscript],
  ]
  return sections.map(([key, label, text]) => ({
    key,
    label,
    chars: text.length,
    included: text.trim().length > 0,
  }))
}

function corpusMapEvidence(corpusMap: string): ContextDebugRecord['corpusMap'] | undefined {
  const text = corpusMap.trim()
  if (!text) return undefined
  const readNext: string[] = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*-\s+([^:]+):\s+/)
    if (!match?.[1]) continue
    const candidate = match[1].trim()
    if (candidate.includes('/')) readNext.push(candidate)
  }
  return {
    included: true,
    chars: corpusMap.length,
    readNext: [...new Set(readNext)].slice(0, 12),
  }
}

function structuralMapEvidence(ctx: BuiltContext): ContextDebugRecord['structuralMap'] | undefined {
  const text = ctx.structuralMapContext?.trim() ?? ''
  const omitted = ctx.structuralMapOmitted ?? []
  if (!text && omitted.length === 0) return undefined
  return {
    included: text.length > 0,
    chars: ctx.structuralMapContext?.length ?? 0,
    omitted: omitted.map(item => ({
      handle: item.handle,
      reason: item.reason,
      confidence: item.confidence,
      retrievalHint: `Resolve ${item.handle} through the structural map before reading deferred context.`,
    })),
  }
}

function isTaskScopedWorktree(activeWorktreePath: string | undefined, task: Task): boolean {
  if (!activeWorktreePath) return false
  const normalized = activeWorktreePath.split(path.sep).filter(Boolean)
  return normalized.includes(task.id)
}

function healthChecks(input: {
  task: Task
  ctx: BuiltContext
  sections: ContextSectionStat[]
  contextChars: number
  workspacePath: string
  activeWorktreePath?: string
  agentRole: string
}): ContextHealthWarning[] {
  const warnings: ContextHealthWarning[] = []
  const largest = [...input.sections].sort((a, b) => b.chars - a.chars)[0]

  if (input.contextChars > 20_000) {
    warnings.push({
      code: 'context_too_large',
      severity: 'error',
      message: `Context payload is very large (${input.contextChars} chars).`,
    })
  } else if (input.contextChars > 12_000) {
    warnings.push({
      code: 'context_large',
      severity: 'warn',
      message: `Context payload is getting large (${input.contextChars} chars).`,
    })
  }

  if (largest && largest.chars > 3_000 && largest.chars / Math.max(1, input.contextChars) > 0.65) {
    warnings.push({
      code: 'section_dominates',
      severity: 'warn',
      message: `${largest.label} dominates the injected context (${largest.chars} chars).`,
    })
  }

  if (input.task.status !== 'exploring' && !input.task.spec?.trim()) {
    warnings.push({
      code: 'missing_spec',
      severity: 'warn',
      message: `Task is ${input.task.status} but has no saved spec.`,
    })
  }

  if (
    input.task.status === 'exploring' &&
    (input.task.openQuestions?.some((q) => !q.answeredAt) ?? false) &&
    !input.ctx.exploringTranscript.trim()
  ) {
    warnings.push({
      code: 'missing_transcript_tail',
      severity: 'warn',
      message: 'Exploring task has unanswered questions but no transcript tail was injected.',
    })
  }

  if (
    (input.agentRole === 'worker' || input.agentRole === 'coordinator' || input.agentRole === 'reviewer') &&
    !input.ctx.personaPrompt.trim()
  ) {
    warnings.push({
      code: 'missing_role_context',
      severity: 'warn',
      message: `${input.agentRole} context is missing a persona/role guidance block.`,
    })
  }

  if (
    input.task.projectPath &&
    input.task.projectPath !== input.workspacePath &&
    !input.activeWorktreePath?.startsWith(input.task.projectPath) &&
    !isTaskScopedWorktree(input.activeWorktreePath, input.task)
  ) {
    warnings.push({
      code: 'subproject_scope_mismatch',
      severity: 'warn',
      message: `Task targets ${input.task.projectPath} but the active worktree path is ${input.activeWorktreePath ?? input.workspacePath}.`,
    })
  }

  if (
    !input.ctx.projectMemory.trim() &&
    !input.ctx.recentDecisions.trim() &&
    !input.ctx.recentProgress.trim()
  ) {
    warnings.push({
      code: 'thin_project_context',
      severity: 'info',
      message: 'No project memory, recent decisions, or recent progress were injected.',
    })
  }

  return warnings
}

function explainContext(input: {
  task: Task
  ctx: BuiltContext
  taskProjectPath: string
  activeWorktreePath?: string
  agentRole: string
}): string[] {
  const reasons = [
    `${input.agentRole} handling ${input.task.status} for task ${input.task.id}.`,
    `Task scoped to ${input.taskProjectPath}.`,
  ]
  if (input.activeWorktreePath && input.activeWorktreePath !== input.taskProjectPath) {
    reasons.push(`Code-edit worktree is ${input.activeWorktreePath}.`)
  }
  if (input.task.spec?.trim()) reasons.push('Task spec was injected.')
  if (input.ctx.personaPrompt.trim()) reasons.push('Role/persona guidance was injected.')
  if (input.ctx.exploringTranscript.trim()) reasons.push('Exploring transcript tail was injected.')
  if (input.ctx.reviewRubrics.trim()) reasons.push('Review rubrics were injected.')
  if (input.ctx.corpusMap.trim()) reasons.push('Corpus map guidance was injected.')
  if (input.ctx.projectMemory.trim()) reasons.push('Relevant project memory excerpts were injected.')
  if (input.ctx.effectiveMemory?.trim()) reasons.push('Effective memory packet was injected.')
  return reasons
}

export function roleForAgentName(agentName: string): string {
  if (agentName === 'spec-agent') return 'spec'
  if (agentName === 'worker-agent') return 'worker'
  if (agentName === 'reviewer-agent') return 'reviewer'
  if (agentName === 'gate-checker-agent') return 'gateChecker'
  if (agentName === 'context-indexer-agent' || agentName === 'corpus-map') return 'contextIndexer'
  if (agentName.startsWith('coordinator-')) return 'coordinator'
  if (agentName.startsWith('reviewer-persona-')) return 'reviewer'
  return agentName
}

export function modelForAgentName(agentName: string, models: {
  spec: string
  coordinator: string
  worker: string
  reviewer: string
  gateChecker: string
  contextIndexer: string
}): string {
  const role = roleForAgentName(agentName)
  switch (role) {
    case 'spec': return models.spec
    case 'worker': return models.worker
    case 'reviewer': return models.reviewer
    case 'gateChecker': return models.gateChecker
    case 'contextIndexer': return models.contextIndexer
    case 'coordinator': return models.coordinator
    default: return models.worker
  }
}

export async function writeContextDebugRecord(input: {
  memoryDir: string
  workspacePath: string
  activeWorktreePath?: string
  task: Task
  ctx: BuiltContext
  agentName: string
  modelId: string
  temperature?: number
  prompt: string
}): Promise<ContextDebugRecord> {
  const at = new Date().toISOString()
  const id = `${at.replace(/[:.]/g, '-')}-${sanitize(input.agentName)}`
  const agentRole = roleForAgentName(input.agentName)
  const sections = sectionStats(input.ctx)
  const corpusMap = corpusMapEvidence(input.ctx.corpusMap)
  const structuralMap = structuralMapEvidence(input.ctx)
  const contextChars = input.ctx.formatted.length
  const promptChars = input.prompt.length
  const taskProjectPath = input.task.projectPath || input.workspacePath
  const health = healthChecks({
    task: input.task,
    ctx: input.ctx,
    sections,
    contextChars,
    workspacePath: input.workspacePath,
    ...(input.activeWorktreePath ? { activeWorktreePath: input.activeWorktreePath } : {}),
    agentRole,
  })
  const reasons = explainContext({
    task: input.task,
    ctx: input.ctx,
    taskProjectPath,
    ...(input.activeWorktreePath ? { activeWorktreePath: input.activeWorktreePath } : {}),
    agentRole,
  })

  const projectRoot = inferProjectRootFromMemoryDir(input.memoryDir)
  const debugDir = getProjectContextDebugSnapshotDir(projectRoot, input.task.id)
  await fs.mkdir(debugDir, { recursive: true })
  await pruneSnapshots(debugDir)
  const snapshotPath = path.join(debugDir, `${id}.md`)
  const boundedPrompt =
    input.prompt.length <= MAX_SNAPSHOT_PROMPT_CHARS
      ? input.prompt
      : `${input.prompt.slice(0, MAX_SNAPSHOT_PROMPT_CHARS)}\n\n[truncated ${input.prompt.length - MAX_SNAPSHOT_PROMPT_CHARS} chars]`
  const boundedContext =
    input.ctx.formatted.length <= MAX_SNAPSHOT_CONTEXT_CHARS
      ? input.ctx.formatted
      : `${input.ctx.formatted.slice(0, MAX_SNAPSHOT_CONTEXT_CHARS)}\n\n[truncated ${input.ctx.formatted.length - MAX_SNAPSHOT_CONTEXT_CHARS} chars]`
  const snapshot = [
    `# Context Snapshot`,
    ``,
    `- At: ${at}`,
    `- Task: ${input.task.id} — ${input.task.title}`,
    `- Status: ${input.task.status}`,
    `- Agent: ${input.agentName} (${agentRole})`,
    `- Model: ${input.modelId}`,
    input.temperature !== undefined ? `- Temperature: ${input.temperature}` : '',
    `- Workspace: ${input.workspacePath}`,
    `- Task project path: ${taskProjectPath}`,
    input.activeWorktreePath ? `- Active worktree: ${input.activeWorktreePath}` : '',
    `- Context chars: ${contextChars}`,
    `- Prompt chars: ${promptChars}`,
    health.length > 0 ? `- Health: ${health.map((h) => `${h.severity}:${h.code}`).join(', ')}` : '- Health: clean',
    ``,
    `## Why this context`,
    ...reasons.map((reason) => `- ${reason}`),
    ``,
    `## Section sizes`,
    ...sections.map((section) => `- ${section.label}: ${section.chars} chars${section.included ? '' : ' (empty)'}`),
    structuralMap?.omitted.length
      ? [
          ``,
          `## Structural Omitted Context`,
          ...structuralMap.omitted.map(item => `- ${item.handle}: ${item.reason}; ${item.retrievalHint}`),
        ].join('\n')
      : '',
    ``,
    `## Formatted Context`,
    '```md',
    boundedContext,
    '```',
    ``,
    `## Full Prompt`,
    '```md',
    boundedPrompt,
    '```',
  ].filter(Boolean).join('\n')
  await writeManagedTextFile(snapshotPath, snapshot, 'utf8')

  const record: ContextDebugRecord = {
    id,
    at,
    taskId: input.task.id,
    taskTitle: input.task.title,
    taskStatus: input.task.status,
    domain: input.task.domain,
    agentName: input.agentName,
    agentRole,
    modelId: input.modelId,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    workspacePath: input.workspacePath,
    taskProjectPath,
    ...(input.activeWorktreePath ? { activeWorktreePath: input.activeWorktreePath } : {}),
    promptChars,
    contextChars,
    promptPreview: preview(input.prompt, MAX_PROMPT_PREVIEW_CHARS),
    snapshotPath,
    sections,
    ...(corpusMap ? { corpusMap } : {}),
    ...(structuralMap ? { structuralMap } : {}),
    health,
    reasons,
    applicableGuildSlugs: input.ctx.applicableGuildSlugs,
    reviewerSlugs: input.ctx.reviewerSlugs,
    primaryEngineerSlug: input.ctx.primaryEngineerSlug,
    openQuestionCount: input.task.openQuestions?.length ?? 0,
    acceptanceCriteriaCount: input.task.acceptanceCriteria?.length ?? 0,
    ...(input.ctx.effectiveMemoryPacket
      ? {
          memoryPacket: {
            included: input.ctx.effectiveMemoryPacket.included.map((record) => ({
              id: record.id,
              type: record.type,
              scope: record.scope,
            })),
            withheld: input.ctx.effectiveMemoryPacket.withheld.map((record) => ({
              id: record.id,
              reason: record.reason,
            })),
            evidenceRefs: input.ctx.effectiveMemoryPacket.evidenceRefs.length,
            ...(input.ctx.effectiveMemoryPacket.memoryCorePacket
              ? {
                  memoryCore: {
                    adapter: input.ctx.effectiveMemoryPacket.memoryCorePacket.health.adapter,
                    fallbackUsed: input.ctx.effectiveMemoryPacket.memoryCorePacket.health.fallbackUsed,
                    warnings: input.ctx.effectiveMemoryPacket.memoryCorePacket.health.warnings,
                    candidates: input.ctx.effectiveMemoryPacket.memoryCorePacket.candidates.map(candidate => ({
                      id: candidate.id,
                      kind: candidate.kind,
                      summary: candidate.summary,
                      sourceRefs: candidate.sourceRefs.map(ref => ({
                        uri: ref.uri,
                        ...(ref.path ? { path: ref.path } : {}),
                        sourceKind: ref.sourceKind,
                      })),
                    })),
                  },
                }
              : {}),
          },
        }
      : {}),
  }

  const ledgerPath = getProjectContextDebugLedgerPath(projectRoot)
  const persistence = new FileBackedGuildhallPersistence()
  await persistence.appendEvent({
    projectRoot,
    placement: {
      scope: 'local_history',
      retention: 'debug',
      visibility: 'internal_audit',
      commitPolicy: 'ignored',
    },
    collection: 'context-debug',
    streamId: input.task.id,
    eventId: id,
    schemaName: 'context-debug-record',
    schemaVersion: 1,
    createdBy: 'context-observability',
    sourceRefs: [`task:${input.task.id}`],
    payload: record,
    now: () => new Date(at),
  })
  await appendManagedTextFile(ledgerPath, `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

async function pruneSnapshots(debugDir: string): Promise<void> {
  try {
    const entries = await fs.readdir(debugDir, { withFileTypes: true })
    const markdownFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort()
    const overflow = markdownFiles.length - (SNAPSHOT_RETENTION_PER_TASK - 1)
    if (overflow <= 0) return
    await Promise.all(
      markdownFiles
        .slice(0, overflow)
        .map((name) => fs.rm(path.join(debugDir, name), { force: true })),
    )
  } catch {
    // Snapshot retention is best-effort; debugability should not block a run.
  }
}

export async function readContextDebugForTask(
  memoryDir: string,
  taskId: string,
  limit = 6,
): Promise<ContextDebugRecord[]> {
  const projectRoot = inferProjectRootFromMemoryDir(memoryDir)
  const ledgerPath = getProjectContextDebugLedgerPath(projectRoot)
  try {
    const raw = await readManagedTextFile(ledgerPath, 'utf8')
    const matches: ContextDebugRecord[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line) as ContextDebugRecord
        if (record.taskId === taskId) matches.push(record)
      } catch {
        // ignore malformed lines
      }
    }
    return matches.slice(-limit).reverse()
  } catch {
    return []
  }
}
