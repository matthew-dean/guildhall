import { createHash } from 'node:crypto'
import { appendManagedTextFile, readManagedTextFile, writeManagedTextFile } from '@guildhall/persistence'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { Task } from '@guildhall/core'
import type { BuiltContext } from './context-builder.js'
import {
  getProjectContextDebugLedgerPath,
  getProjectContextDebugSnapshotDir,
  getProjectLocalHistoryDir,
  inferProjectRootFromMemoryDir,
} from '@guildhall/sessions'

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
  promptHash?: string
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
    includedCount?: number
    withheldCount?: number
    evidenceRefs: number
    memoryCore?: {
      adapter: 'mastra' | 'deterministic'
      fallbackUsed: boolean
      warnings: string[]
      candidateCount?: number
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
const SNAPSHOT_RETENTION_PER_TASK = 3
const LEDGER_MAX_BYTES = 512 * 1024
const LEDGER_COMPACTION_THRESHOLD_BYTES = LEDGER_MAX_BYTES
const LEDGER_RETENTION_PER_TASK = 6
const MEMORY_PACKET_SAMPLE_LIMIT = 12
const MEMORY_SUMMARY_MAX_CHARS = 240
const CONTEXT_DEBUG_RECORD_MAX_BYTES = 32 * 1024
const CONTEXT_DEBUG_TEXT_MAX_CHARS = 1200
const CONTEXT_DEBUG_LIST_LIMIT = 32

function sanitize(text: string): string {
  return text.replace(/[^a-z0-9_-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
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

function boundedMemorySummary(summary: string): string {
  const compact = summary.trim().replace(/\s+/g, ' ')
  return compact.length <= MEMORY_SUMMARY_MAX_CHARS
    ? compact
    : `${compact.slice(0, MEMORY_SUMMARY_MAX_CHARS)}...`
}

function boundedDiagnosticText(value: unknown, max = CONTEXT_DEBUG_TEXT_MAX_CHARS): string {
  if (typeof value !== 'string') return ''
  const compact = value.trim().replace(/\s+/g, ' ')
  return compact.length <= max ? compact : `${compact.slice(0, max).trimEnd()}...`
}

function boundedDiagnosticStrings(value: unknown, limit = CONTEXT_DEBUG_LIST_LIMIT): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => boundedDiagnosticText(item, 240)))]
    .slice(0, limit)
}

function boundedSections(value: unknown): ContextSectionStat[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item))
    .slice(0, CONTEXT_DEBUG_LIST_LIMIT)
    .map(item => ({
      key: boundedDiagnosticText(item.key, 120),
      label: boundedDiagnosticText(item.label, 240),
      chars: typeof item.chars === 'number' && Number.isFinite(item.chars) ? Math.max(0, item.chars) : 0,
      included: item.included === true,
    }))
}

function compactMemoryPacket(
  packet: NonNullable<ContextDebugRecord['memoryPacket']>,
): NonNullable<ContextDebugRecord['memoryPacket']> {
  const memoryCore = packet.memoryCore
    ? {
        adapter: packet.memoryCore.adapter,
        fallbackUsed: packet.memoryCore.fallbackUsed === true,
        warnings: boundedDiagnosticStrings(packet.memoryCore.warnings, 16),
        candidates: packet.memoryCore.candidates.slice(0, MEMORY_PACKET_SAMPLE_LIMIT).map(candidate => ({
          id: boundedDiagnosticText(candidate.id, 240),
          kind: boundedDiagnosticText(candidate.kind, 120),
          summary: boundedMemorySummary(candidate.summary),
          sourceRefs: candidate.sourceRefs.slice(0, MEMORY_PACKET_SAMPLE_LIMIT).map(ref => ({
            uri: boundedDiagnosticText(ref.uri, 500),
            ...(ref.path ? { path: boundedDiagnosticText(ref.path, 500) } : {}),
            sourceKind: boundedDiagnosticText(ref.sourceKind, 120),
          })),
        })),
        candidateCount: packet.memoryCore.candidateCount ?? packet.memoryCore.candidates.length,
      }
    : undefined
  return {
    included: [],
    withheld: [],
    includedCount: packet.includedCount ?? packet.included.length,
    withheldCount: packet.withheldCount ?? packet.withheld.length,
    evidenceRefs: typeof packet.evidenceRefs === 'number' && Number.isFinite(packet.evidenceRefs)
      ? Math.max(0, packet.evidenceRefs)
      : 0,
    ...(memoryCore ? { memoryCore } : {}),
  }
}

/**
 * Context diagnostics are a manifest, not a second copy of the request.
 * Keep enough information to explain selection and health without retaining
 * prompt/context bodies or unbounded repeated memory identifiers.
 */
export function compactContextDebugRecord(record: ContextDebugRecord): ContextDebugRecord {
  const compacted: ContextDebugRecord = {
    id: boundedDiagnosticText(record.id, 240),
    at: boundedDiagnosticText(record.at, 80),
    taskId: boundedDiagnosticText(record.taskId, 240),
    taskTitle: boundedDiagnosticText(record.taskTitle),
    taskStatus: boundedDiagnosticText(record.taskStatus, 120),
    domain: boundedDiagnosticText(record.domain, 240),
    agentName: boundedDiagnosticText(record.agentName, 240),
    agentRole: boundedDiagnosticText(record.agentRole, 120),
    modelId: boundedDiagnosticText(record.modelId, 240),
    ...(record.temperature !== undefined ? { temperature: record.temperature } : {}),
    workspacePath: boundedDiagnosticText(record.workspacePath),
    taskProjectPath: boundedDiagnosticText(record.taskProjectPath),
    ...(record.activeWorktreePath ? { activeWorktreePath: boundedDiagnosticText(record.activeWorktreePath) } : {}),
    promptChars: typeof record.promptChars === 'number' && Number.isFinite(record.promptChars) ? Math.max(0, record.promptChars) : 0,
    contextChars: typeof record.contextChars === 'number' && Number.isFinite(record.contextChars) ? Math.max(0, record.contextChars) : 0,
    promptPreview: '',
    ...(record.promptHash ? { promptHash: boundedDiagnosticText(record.promptHash, 128) } : {}),
    snapshotPath: boundedDiagnosticText(record.snapshotPath),
    sections: boundedSections(record.sections),
    ...(record.corpusMap ? {
      corpusMap: {
        included: record.corpusMap.included === true,
        chars: typeof record.corpusMap.chars === 'number' && Number.isFinite(record.corpusMap.chars) ? Math.max(0, record.corpusMap.chars) : 0,
        readNext: boundedDiagnosticStrings(record.corpusMap.readNext, 16),
      },
    } : {}),
    health: Array.isArray(record.health)
      ? record.health.slice(0, CONTEXT_DEBUG_LIST_LIMIT).map(warning => ({
          code: boundedDiagnosticText(warning.code, 160),
          severity: warning.severity,
          message: boundedDiagnosticText(warning.message),
        }))
      : [],
    reasons: boundedDiagnosticStrings(record.reasons, CONTEXT_DEBUG_LIST_LIMIT),
    applicableGuildSlugs: boundedDiagnosticStrings(record.applicableGuildSlugs),
    reviewerSlugs: boundedDiagnosticStrings(record.reviewerSlugs),
    primaryEngineerSlug: record.primaryEngineerSlug ? boundedDiagnosticText(record.primaryEngineerSlug, 240) : null,
    openQuestionCount: typeof record.openQuestionCount === 'number' && Number.isFinite(record.openQuestionCount) ? Math.max(0, record.openQuestionCount) : 0,
    acceptanceCriteriaCount: typeof record.acceptanceCriteriaCount === 'number' && Number.isFinite(record.acceptanceCriteriaCount) ? Math.max(0, record.acceptanceCriteriaCount) : 0,
    ...(record.memoryPacket ? { memoryPacket: compactMemoryPacket(record.memoryPacket) } : {}),
    ...(record.structuralMap ? {
      structuralMap: {
        included: record.structuralMap.included === true,
        chars: typeof record.structuralMap.chars === 'number' && Number.isFinite(record.structuralMap.chars) ? Math.max(0, record.structuralMap.chars) : 0,
        omitted: record.structuralMap.omitted.slice(0, CONTEXT_DEBUG_LIST_LIMIT).map(item => ({
          handle: boundedDiagnosticText(item.handle, 500),
          reason: boundedDiagnosticText(item.reason, 240),
          confidence: boundedDiagnosticText(item.confidence, 120),
          retrievalHint: boundedDiagnosticText(item.retrievalHint),
        })),
      },
    } : {}),
  }

  if (Buffer.byteLength(JSON.stringify(compacted), 'utf8') <= CONTEXT_DEBUG_RECORD_MAX_BYTES) return compacted

  // Keep the invariant at the write boundary even if a future diagnostic field
  // grows unexpectedly. Low-value retrieval samples are the first things to
  // discard; counts, sizes, health, and identity remain available.
  return {
    ...compacted,
    reasons: compacted.reasons.slice(-8),
    health: compacted.health.slice(-8),
    applicableGuildSlugs: compacted.applicableGuildSlugs.slice(0, 8),
    reviewerSlugs: compacted.reviewerSlugs.slice(0, 8),
    ...(compacted.corpusMap ? { corpusMap: { ...compacted.corpusMap, readNext: [] } } : {}),
    ...(compacted.structuralMap ? { structuralMap: { ...compacted.structuralMap, omitted: [] } } : {}),
    ...(compacted.memoryPacket ? {
      memoryPacket: {
        ...compacted.memoryPacket,
        memoryCore: compacted.memoryPacket.memoryCore
          ? { ...compacted.memoryPacket.memoryCore, candidates: [] }
          : undefined,
      },
    } : {}),
  }
}

function renderDiagnosticSnapshot(record: ContextDebugRecord): string {
  return [
    '# Context Diagnostic',
    '',
    `- At: ${record.at}`,
    `- Task: ${record.taskId} — ${record.taskTitle}`,
    `- Status: ${record.taskStatus}`,
    `- Agent: ${record.agentName} (${record.agentRole})`,
    `- Model: ${record.modelId}`,
    record.temperature !== undefined ? `- Temperature: ${record.temperature}` : '',
    `- Workspace: ${record.workspacePath}`,
    `- Task project path: ${record.taskProjectPath}`,
    record.activeWorktreePath ? `- Active worktree: ${record.activeWorktreePath}` : '',
    `- Context chars: ${record.contextChars}`,
    `- Prompt chars: ${record.promptChars}`,
    record.promptHash ? `- Prompt hash: ${record.promptHash}` : '',
    record.health.length > 0 ? `- Health: ${record.health.map((h) => `${h.severity}:${h.code}`).join(', ')}` : '- Health: clean',
    '',
    '## Why this context',
    ...record.reasons.map((reason) => `- ${reason}`),
    '',
    '## Section sizes',
    ...record.sections.map((section) => `- ${section.label}: ${section.chars} chars${section.included ? '' : ' (empty)'}`),
    record.structuralMap?.omitted.length
      ? [
          '',
          '## Structural Omitted Context',
          ...record.structuralMap.omitted.map(item => `- ${item.handle}: ${item.reason}; ${item.retrievalHint}`),
        ].join('\n')
      : '',
    '',
    '## Retention',
    '- Prompt and formatted context bodies are intentionally not persisted.',
    '- Use the live request path when a full payload is needed for an active run.',
  ].filter(Boolean).join('\n')
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

  const record = compactContextDebugRecord({
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
    promptPreview: '',
    promptHash: hashText(input.prompt),
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
            includedCount: input.ctx.effectiveMemoryPacket.included.length,
            withheldCount: input.ctx.effectiveMemoryPacket.withheld.length,
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
  })

  await writeManagedTextFile(snapshotPath, renderDiagnosticSnapshot(record), 'utf8')

  const ledgerPath = getProjectContextDebugLedgerPath(projectRoot)
  await appendManagedTextFile(ledgerPath, `${JSON.stringify(record)}\n`, 'utf8')
  try {
    if ((await fs.stat(ledgerPath)).size > LEDGER_COMPACTION_THRESHOLD_BYTES) {
      await compactProjectContextDebug(projectRoot, { dryRun: false })
    }
  } catch {
    // Diagnostic retention must never interrupt the agent run.
  }
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

export interface ContextDebugCompactionResult {
  ledgerBytesBefore: number
  ledgerBytesAfter: number
  ledgerRecordsSeen: number
  ledgerRecordsCompacted: number
  snapshotFilesSeen: number
  snapshotFilesCompacted: number
  snapshotBytesBefore: number
  snapshotBytesAfter: number
  duplicateEventFilesRemoved: number
  duplicateEventBytesBefore: number
  duplicateEventBytesAfter: number
}

async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...await listFiles(full))
      else if (entry.isFile()) files.push(full)
    }
    return files
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

function compactSnapshotMarkdown(raw: string): string {
  const marker = raw.search(/\n## (?:Formatted Context|Full Prompt)\b/)
  const head = marker >= 0 ? raw.slice(0, marker) : raw
  if (head.includes('## Retention')) return `${head.trimEnd()}\n`
  return `${head.trimEnd()}\n\n## Retention\n- Prompt and formatted context bodies were removed during project-state compaction.\n- Context diagnostics retain sizes, health, reasons, and retrieval handles only.\n`
}

function compactLedger(raw: string, activeTaskIds?: ReadonlySet<string>): {
  content: string
  recordsSeen: number
  recordsCompacted: number
  recordsDropped: number
} {
  const lines = raw.split('\n').filter(line => line.trim().length > 0)
  const parsed: Array<{ index: number; taskId: string; line: string }> = []
  const opaque: Array<{ index: number; line: string }> = []
  let recordsCompacted = 0

  for (const [index, line] of lines.entries()) {
    try {
      const record = JSON.parse(line) as ContextDebugRecord
      const compacted = compactContextDebugRecord(record)
      if (JSON.stringify(compacted) !== JSON.stringify(record)) recordsCompacted += 1
      if (activeTaskIds && !activeTaskIds.has(record.taskId)) continue
      parsed.push({ index, taskId: record.taskId, line: JSON.stringify(compacted) })
    } catch {
      opaque.push({ index, line })
    }
  }

  const keep = new Set<number>()
  const byTask = new Map<string, number[]>()
  for (const record of parsed) {
    const indexes = byTask.get(record.taskId) ?? []
    indexes.push(record.index)
    byTask.set(record.taskId, indexes)
  }
  for (const indexes of byTask.values()) {
    for (const index of indexes.slice(-LEDGER_RETENTION_PER_TASK)) keep.add(index)
  }
  for (const record of opaque) keep.add(record.index)

  const retainedLines = [...parsed, ...opaque]
    .filter(record => keep.has(record.index))
    .sort((a, b) => a.index - b.index)
    .map(record => record.line)
  const compactedLines: string[] = []
  let retainedBytes = 0
  for (let index = retainedLines.length - 1; index >= 0; index -= 1) {
    const line = retainedLines[index]
    if (line === undefined) continue
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1
    if (lineBytes > LEDGER_MAX_BYTES) {
      recordsCompacted += 1
      continue
    }
    if (retainedBytes + lineBytes > LEDGER_MAX_BYTES) break
    compactedLines.unshift(line)
    retainedBytes += lineBytes
  }
  return {
    content: compactedLines.length > 0 ? `${compactedLines.join('\n')}\n` : '',
    recordsSeen: lines.length,
    recordsCompacted,
    recordsDropped: lines.length - compactedLines.length,
  }
}

/**
 * Compact old context diagnostics in place. The local ledger is the single
 * durable source; the old persistence event mirror is deleted because it was
 * byte-for-byte duplicate debug history with no reader of its own.
 */
export async function compactProjectContextDebug(
  projectRoot: string,
  options: { dryRun?: boolean; activeTaskIds?: ReadonlySet<string> } = {},
): Promise<ContextDebugCompactionResult> {
  const dryRun = options.dryRun ?? true
  const resolvedRoot = path.resolve(projectRoot)
  const ledgerPath = getProjectContextDebugLedgerPath(resolvedRoot)
  let ledgerRaw = ''
  try {
    ledgerRaw = await readManagedTextFile(ledgerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const compactedLedgerResult = compactLedger(ledgerRaw, options.activeTaskIds)
  const compactedLedger = compactedLedgerResult.content
  if (!dryRun && ledgerRaw.length > 0 && compactedLedger !== ledgerRaw) {
    await writeManagedTextFile(ledgerPath, compactedLedger, 'utf8')
  }

  const snapshotFiles = (await listFiles(path.join(getProjectLocalHistoryDir(resolvedRoot), 'context-debug', 'snapshots')))
    .filter(file => file.endsWith('.md'))
  const snapshotsByTask = new Map<string, string[]>()
  for (const file of snapshotFiles) {
    const taskDir = path.dirname(file)
    const files = snapshotsByTask.get(taskDir) ?? []
    files.push(file)
    snapshotsByTask.set(taskDir, files)
  }
  const keptSnapshots = new Set<string>()
  for (const files of snapshotsByTask.values()) {
    const taskId = path.basename(path.dirname(files[0] ?? ''))
    if (options.activeTaskIds && !options.activeTaskIds.has(taskId)) continue
    for (const file of files.sort().slice(-SNAPSHOT_RETENTION_PER_TASK)) keptSnapshots.add(file)
  }

  let snapshotBytesBefore = 0
  let snapshotBytesAfter = 0
  let snapshotFilesCompacted = 0
  for (const file of snapshotFiles) {
    const raw = await fs.readFile(file, 'utf8')
    snapshotBytesBefore += Buffer.byteLength(raw, 'utf8')
    if (!keptSnapshots.has(file)) {
      snapshotFilesCompacted += 1
      if (!dryRun) await fs.rm(file, { force: true })
      continue
    }
    const compacted = compactSnapshotMarkdown(raw)
    snapshotBytesAfter += Buffer.byteLength(compacted, 'utf8')
    if (compacted !== raw) {
      snapshotFilesCompacted += 1
      if (!dryRun) await writeManagedTextFile(file, compacted, 'utf8')
    }
  }

  const duplicateEventDir = path.join(
    getProjectLocalHistoryDir(resolvedRoot),
    'persistence',
    'events',
    'context-debug',
  )
  const duplicateEventFiles = await listFiles(duplicateEventDir)
  let duplicateEventBytesBefore = 0
  for (const file of duplicateEventFiles) {
    duplicateEventBytesBefore += (await fs.stat(file)).size
  }
  if (!dryRun && duplicateEventFiles.length > 0 && compactedLedgerResult.recordsSeen > 0) {
    await fs.rm(duplicateEventDir, { recursive: true, force: true })
  }

  return {
    ledgerBytesBefore: Buffer.byteLength(ledgerRaw, 'utf8'),
    ledgerBytesAfter: Buffer.byteLength(compactedLedger, 'utf8'),
    ledgerRecordsSeen: compactedLedgerResult.recordsSeen,
    ledgerRecordsCompacted: compactedLedgerResult.recordsCompacted + compactedLedgerResult.recordsDropped,
    snapshotFilesSeen: snapshotFiles.length,
    snapshotFilesCompacted,
    snapshotBytesBefore,
    snapshotBytesAfter,
    duplicateEventFilesRemoved: duplicateEventFiles.length,
    duplicateEventBytesBefore,
    duplicateEventBytesAfter: dryRun ? duplicateEventBytesBefore : 0,
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
        if (record.taskId === taskId) matches.push(compactContextDebugRecord(record))
      } catch {
        // ignore malformed lines
      }
    }
    return matches.slice(-limit).reverse()
  } catch {
    return []
  }
}
