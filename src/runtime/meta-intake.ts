import fs from 'node:fs/promises'
import path from 'node:path'
import { load as yamlLoad } from 'js-yaml'
import { TaskQueue, type Task } from '@guildhall/core'
import { readWorkspaceConfig, writeWorkspaceConfig } from '@guildhall/config'
import { appendExploringTranscript } from '@guildhall/tools'
import {
  AGENT_SETTINGS_FILENAME,
  loadLeverSettings,
  saveLeverSettings,
  validateLeverSettings,
  PROJECT_LEVER_NAMES,
  DOMAIN_LEVER_NAMES,
} from '@guildhall/levers'

// ---------------------------------------------------------------------------
// FR-14: coordinator bootstrapping via meta-intake.
//
// When a workspace has no coordinators defined, the first exploring task is a
// meta-intake: the Spec Agent interviews the user about the codebase and
// writes a draft list of coordinator definitions (mandate, concerns,
// autonomous decisions, escalation triggers) into the task's `spec`.
//
// When the user approves, `approveMetaIntake` parses the draft, merges the
// resulting coordinators into guildhall.yaml, and marks the task done.
//
// All the LLM work happens on the normal orchestrator loop — this module just
// owns the reserved task, the draft-format parser, and the config merge.
// ---------------------------------------------------------------------------

export const META_INTAKE_TASK_ID = 'task-meta-intake'
export const META_INTAKE_DOMAIN = '_meta'

function tasksPathFor(memoryDir: string): string {
  return path.join(memoryDir, 'TASKS.json')
}

async function readQueue(memoryDir: string): Promise<TaskQueue> {
  const raw = await fs.readFile(tasksPathFor(memoryDir), 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

async function writeQueue(memoryDir: string, queue: TaskQueue): Promise<void> {
  await fs.writeFile(tasksPathFor(memoryDir), JSON.stringify(queue, null, 2), 'utf-8')
}

const META_INTAKE_SEED = `You are bootstrapping a new Guildhall workspace. Your job in this conversation is to produce a DRAFT list of coordinator definitions for this codebase AND infer initial lever positions from the user's project-guidance answers.

Interview the user with short, focused PROJECT questions. Work toward answers for:

1. What are the major *zones of concern* in this codebase (e.g. UI layer, data/API layer, infra, docs, release/ops)? Each zone becomes one coordinator.
2. For each zone: one-paragraph mandate — what outcomes does it protect?
3. For each zone: 2–4 concerns (id, one-line description, 1–3 review questions each).
4. For each zone: which tweaks the coordinator may approve without human review (autonomousDecisions)?
5. For each zone: what MUST be escalated to a human (escalationTriggers)?
6. Optional sub-path inside the project that scopes this coordinator (blank if workspace root).

Lever inference — CRITICAL
=========================

While you interview, INFER lever positions from the user's answers. Do NOT ask direct meta-questions like "how autonomous do you want agents to be?" or "what is your risk tolerance?". Instead, infer from natural project-guidance signals:

- User describes a production/customer-facing system with strict compliance → tighten \`business_envelope_strictness: strict\`, \`completion_approval: human_required\`.
- User says things like "just try it and see" or describes an experimental prototype → loosen \`business_envelope_strictness: advisory\` or \`off\`, \`task_origination: agent_autonomous\`.
- User mentions CI gating by tests / CI required to merge → \`completion_approval: gates_sufficient\` is fair once all hard gates exist.
- User has a small or solo team, wants minimal friction → \`remediation_autonomy: auto\`, \`task_origination: agent_proposed_coordinator_approved\`.
- User mentions no local LLM / cost concerns → leave \`reviewer_mode: llm_with_deterministic_fallback\` (cheapest default) or tighten to \`deterministic_only\`.

Emit inferred lever positions in a SECOND YAML codefence, alongside the coordinators fence. Every inferred lever MUST include a short \`rationale\` that cites the conversational signal (e.g. "user said the codebase ships to paying customers"). Omit levers you could not infer — they will stay at system default.

Output format
=============

Put both fences into the task spec (via the update-task tool):

\`\`\`yaml
coordinators:
  - id: <slug>
    name: <human-readable name>
    domain: <slug, used for task routing>
    path: <optional sub-path>
    mandate: |
      <one-paragraph mandate>
    concerns:
      - id: <slug>
        description: <one-line description>
        reviewQuestions:
          - <question>
    autonomousDecisions:
      - <decision this coordinator may make without humans>
    escalationTriggers:
      - <condition that requires human escalation>
\`\`\`

\`\`\`yaml
levers:
  project:
    <lever_name>:
      position: <value or {kind, n/after} for parameterized levers>
      rationale: <short phrase citing the user signal that informed this>
  domains:
    default:
      <lever_name>:
        position: <value>
        rationale: <short phrase>
    overrides:
      <domain_slug>:
        <lever_name>:
          position: <value>
          rationale: <short phrase>
\`\`\`

When the user approves the draft, run the \`guildhall approve-meta-intake\` CLI command — the runtime will parse both fences, merge coordinators into \`guildhall.yaml\`, record lever positions in \`memory/agent-settings.yaml\` with \`setBy: 'spec-agent-intake'\`, and mark this task done.`

export interface CreateMetaIntakeInput {
  memoryDir: string
  projectPath: string
  /**
   * Optional custom seed message. If omitted, the default meta-intake seed
   * (explaining the job, the output format, and the approval path) is used.
   */
  seedMessage?: string
}

export interface CreateMetaIntakeResult {
  taskId: string
  transcriptPath: string
  alreadyExists: boolean
}

/**
 * Seed a workspace with the reserved meta-intake task. If one already exists,
 * this is a no-op (returning `alreadyExists: true`) so repeated invocations
 * are safe.
 */
export async function createMetaIntakeTask(
  input: CreateMetaIntakeInput,
): Promise<CreateMetaIntakeResult> {
  const queue = await readQueue(input.memoryDir)
  const existing = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)

  const transcriptPath = path.join(
    input.memoryDir,
    'exploring',
    `${META_INTAKE_TASK_ID}.md`,
  )

  if (existing) {
    return { taskId: META_INTAKE_TASK_ID, transcriptPath, alreadyExists: true }
  }

  const now = new Date().toISOString()
  const task: Task = {
    id: META_INTAKE_TASK_ID,
    title: 'Bootstrap coordinators for this workspace',
    description:
      'Interview the user about the codebase, then draft coordinator definitions for guildhall.yaml.',
    domain: META_INTAKE_DOMAIN,
    projectPath: input.projectPath,
    status: 'exploring',
    priority: 'critical',
    dependsOn: [],
    outOfScope: [],
    acceptanceCriteria: [],
    notes: [],
    gateResults: [],
    reviewVerdicts: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'system',
    createdAt: now,
    updatedAt: now,
  }

  queue.tasks.unshift(task)
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  const seed = input.seedMessage ?? META_INTAKE_SEED
  const appendResult = await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: META_INTAKE_TASK_ID,
    role: 'system',
    content: seed,
  })
  if (!appendResult.success || !appendResult.path) {
    throw new Error(`Failed to seed meta-intake transcript: ${appendResult.error ?? 'unknown'}`)
  }

  return { taskId: META_INTAKE_TASK_ID, transcriptPath: appendResult.path, alreadyExists: false }
}

/**
 * Is a meta-intake required for the given workspace? Yes iff guildhall.yaml has
 * no coordinators defined.
 */
export function workspaceNeedsMetaIntake(workspacePath: string): boolean {
  try {
    const config = readWorkspaceConfig(workspacePath)
    return (config.coordinators ?? []).length === 0
  } catch {
    // No guildhall.yaml at all — meta-intake also applies.
    return true
  }
}

/**
 * Draft coordinator as extracted from the YAML codefence in the meta-intake
 * spec. This is intentionally permissive — the full schema is validated when
 * the config is written back.
 */
export interface DraftCoordinator {
  id: string
  name: string
  domain: string
  path?: string
  mandate: string
  concerns: Array<{ id: string; description: string; reviewQuestions: string[] }>
  autonomousDecisions: string[]
  escalationTriggers: string[]
}

/**
 * Extract the `coordinators:` YAML codefence from a meta-intake spec and parse
 * it into a draft list. Returns null when no valid codefence is found — this
 * lets the caller distinguish "no draft yet" from "draft present but broken".
 */
export function parseCoordinatorDraft(spec: string): DraftCoordinator[] | null {
  const fence = /```ya?ml\s*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fence.exec(spec)) !== null) {
    const body = match[1] ?? ''
    let parsed: unknown
    try {
      parsed = yamlLoad(body)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    const raw = obj['coordinators']
    if (!Array.isArray(raw)) continue
    const drafts: DraftCoordinator[] = []
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const id = typeof e['id'] === 'string' ? e['id'] : undefined
      const name = typeof e['name'] === 'string' ? e['name'] : undefined
      const domain = typeof e['domain'] === 'string' ? e['domain'] : id
      const mandate = typeof e['mandate'] === 'string' ? e['mandate'].trim() : ''
      if (!id || !name || !domain) continue
      const pth = typeof e['path'] === 'string' ? e['path'] : undefined
      const draft: DraftCoordinator = {
        id,
        name,
        domain,
        mandate,
        concerns: normalizeConcerns(e['concerns']),
        autonomousDecisions: normalizeStringList(e['autonomousDecisions']),
        escalationTriggers: normalizeStringList(e['escalationTriggers']),
      }
      if (pth) draft.path = pth
      drafts.push(draft)
    }
    if (drafts.length > 0) return drafts
  }
  return null
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function normalizeConcerns(value: unknown): DraftCoordinator['concerns'] {
  if (!Array.isArray(value)) return []
  const out: DraftCoordinator['concerns'] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    const id = typeof c['id'] === 'string' ? c['id'] : undefined
    const description = typeof c['description'] === 'string' ? c['description'] : undefined
    if (!id || !description) continue
    out.push({
      id,
      description,
      reviewQuestions: normalizeStringList(c['reviewQuestions']),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Lever-inference draft: a second YAML codefence the Spec Agent emits during
// meta-intake, with positions + rationales inferred from the user's
// project-guidance answers. Merged into memory/agent-settings.yaml on approval.
// ---------------------------------------------------------------------------

export interface LeverInference {
  position: unknown
  rationale: string
}

export interface LeverInferences {
  project: Record<string, LeverInference>
  domains: {
    default: Record<string, LeverInference>
    overrides: Record<string, Record<string, LeverInference>>
  }
}

function normalizeInferenceObject(value: unknown): Record<string, LeverInference> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, LeverInference> = {}
  for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const rationale = typeof entry['rationale'] === 'string' ? entry['rationale'].trim() : ''
    if (!rationale) continue
    if (!('position' in entry)) continue
    out[k] = { position: entry['position'], rationale }
  }
  return out
}

/**
 * Extract the `levers:` YAML codefence from a meta-intake spec. Returns null
 * when no valid levers fence is present — safe to call unconditionally. The
 * shape is intentionally permissive here; `mergeLeverInferences` is the real
 * validator since individual positions must pass the lever schema.
 */
export function parseLeverInferences(spec: string): LeverInferences | null {
  const fence = /```ya?ml\s*\n([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fence.exec(spec)) !== null) {
    const body = match[1] ?? ''
    let parsed: unknown
    try {
      parsed = yamlLoad(body)
    } catch {
      continue
    }
    if (!parsed || typeof parsed !== 'object') continue
    const obj = parsed as Record<string, unknown>
    if (!('levers' in obj)) continue
    const levers = obj['levers']
    if (!levers || typeof levers !== 'object') continue
    const l = levers as Record<string, unknown>
    const project = normalizeInferenceObject(l['project'])

    const domains = l['domains'] && typeof l['domains'] === 'object'
      ? (l['domains'] as Record<string, unknown>)
      : {}
    const defaultDomain = normalizeInferenceObject(domains['default'])
    const overridesRaw = domains['overrides']
    const overrides: Record<string, Record<string, LeverInference>> = {}
    if (overridesRaw && typeof overridesRaw === 'object') {
      for (const [dName, inner] of Object.entries(overridesRaw as Record<string, unknown>)) {
        const norm = normalizeInferenceObject(inner)
        if (Object.keys(norm).length > 0) overrides[dName] = norm
      }
    }

    const hasAny =
      Object.keys(project).length > 0 ||
      Object.keys(defaultDomain).length > 0 ||
      Object.keys(overrides).length > 0
    if (!hasAny) continue

    return {
      project,
      domains: { default: defaultDomain, overrides },
    }
  }
  return null
}

export interface MergeLeverInferencesResult {
  projectSet: string[]
  domainDefaultSet: string[]
  overridesSet: Record<string, string[]>
  rejected: Array<{ scope: string; lever: string; reason: string }>
}

/**
 * Apply a parsed LeverInferences block to `memory/agent-settings.yaml`. Each
 * successful write marks the entry with `setBy: 'spec-agent-intake'` and the
 * Spec Agent's supplied rationale. Positions that don't match the lever
 * schema are skipped (not fatal — they're reported as `rejected` so the CLI
 * can surface them).
 */
export async function mergeLeverInferences(
  memoryDir: string,
  inferences: LeverInferences,
  now: string = new Date().toISOString(),
): Promise<MergeLeverInferencesResult> {
  const settingsPath = path.join(memoryDir, AGENT_SETTINGS_FILENAME)
  const settings = await loadLeverSettings({ path: settingsPath })

  const result: MergeLeverInferencesResult = {
    projectSet: [],
    domainDefaultSet: [],
    overridesSet: {},
    rejected: [],
  }

  const projectNames = new Set<string>(PROJECT_LEVER_NAMES)
  const domainNames = new Set<string>(DOMAIN_LEVER_NAMES)

  // Mutate via a loose-typed facade. `validateLeverSettings` at the end
  // re-checks the whole shape, so any position that's the wrong shape
  // surfaces as a clear error path there rather than a type cast lie here.
  const projectBag = settings.project as unknown as Record<string, unknown>
  for (const [name, inf] of Object.entries(inferences.project)) {
    if (!projectNames.has(name)) {
      result.rejected.push({ scope: 'project', lever: name, reason: 'unknown project lever' })
      continue
    }
    projectBag[name] = {
      position: inf.position,
      rationale: inf.rationale,
      setAt: now,
      setBy: 'spec-agent-intake',
    }
    result.projectSet.push(name)
  }

  const defaultBag = settings.domains.default as unknown as Record<string, unknown>
  for (const [name, inf] of Object.entries(inferences.domains.default)) {
    if (!domainNames.has(name)) {
      result.rejected.push({ scope: 'domain:default', lever: name, reason: 'unknown domain lever' })
      continue
    }
    defaultBag[name] = {
      position: inf.position,
      rationale: inf.rationale,
      setAt: now,
      setBy: 'spec-agent-intake',
    }
    result.domainDefaultSet.push(name)
  }

  const existingOverrides = settings.domains.overrides ?? {}
  for (const [domainName, entries] of Object.entries(inferences.domains.overrides)) {
    const existing = (existingOverrides[domainName] as Record<string, unknown>) ?? {}
    const merged: Record<string, unknown> = { ...existing }
    const applied: string[] = []
    for (const [name, inf] of Object.entries(entries)) {
      if (!domainNames.has(name)) {
        result.rejected.push({
          scope: `domain:${domainName}`,
          lever: name,
          reason: 'unknown domain lever',
        })
        continue
      }
      merged[name] = {
        position: inf.position,
        rationale: inf.rationale,
        setAt: now,
        setBy: 'spec-agent-intake',
      }
      applied.push(name)
    }
    existingOverrides[domainName] = merged
    if (applied.length > 0) result.overridesSet[domainName] = applied
  }
  settings.domains.overrides = existingOverrides

  // Validate the whole thing before writing — catches malformed positions
  // (e.g. the Spec Agent emitted `fanout` without `n`) and throws
  // LeverSettingsCorruptError with a precise path.
  const validated = validateLeverSettings(settings)
  await saveLeverSettings({ path: settingsPath, settings: validated })

  return result
}

export interface ApproveMetaIntakeInput {
  workspacePath: string
  memoryDir: string
}

export interface ApproveMetaIntakeResult {
  success: boolean
  coordinatorsAdded?: number
  leversSet?: {
    project: string[]
    domainDefault: string[]
    overrides: Record<string, string[]>
    rejected: Array<{ scope: string; lever: string; reason: string }>
  }
  error?: string
}

/**
 * Consume the meta-intake draft: parse the task spec, merge coordinators into
 * guildhall.yaml, transition the task to `done`.
 */
export async function approveMetaIntake(
  input: ApproveMetaIntakeInput,
): Promise<ApproveMetaIntakeResult> {
  const queue = await readQueue(input.memoryDir)
  const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)
  if (!task) return { success: false, error: `No meta-intake task found (id: ${META_INTAKE_TASK_ID})` }
  if (!task.spec || task.spec.trim().length === 0) {
    return { success: false, error: 'Meta-intake task has no spec yet; ask the Spec Agent to emit the coordinators draft first.' }
  }

  const drafts = parseCoordinatorDraft(task.spec)
  if (!drafts || drafts.length === 0) {
    return { success: false, error: 'Could not find a valid `coordinators:` YAML codefence in the meta-intake spec.' }
  }

  const config = readWorkspaceConfig(input.workspacePath)
  const existingIds = new Set((config.coordinators ?? []).map((c) => c.id))
  const merged = [...(config.coordinators ?? [])]
  let added = 0
  for (const draft of drafts) {
    if (existingIds.has(draft.id)) continue
    merged.push({
      id: draft.id,
      name: draft.name,
      domain: draft.domain,
      ...(draft.path ? { path: draft.path } : {}),
      mandate: draft.mandate,
      concerns: draft.concerns,
      autonomousDecisions: draft.autonomousDecisions,
      escalationTriggers: draft.escalationTriggers,
    })
    added++
  }

  writeWorkspaceConfig(input.workspacePath, { ...config, coordinators: merged })

  const now = new Date().toISOString()

  // Optional second fence: lever inferences. Absence is fine — levers just
  // stay at system-default. A parseable-but-invalid position surfaces as an
  // error (caller's call what to do with it).
  const inferences = parseLeverInferences(task.spec)
  let leverMerge: MergeLeverInferencesResult | undefined
  if (inferences) {
    try {
      leverMerge = await mergeLeverInferences(input.memoryDir, inferences, now)
    } catch (err) {
      return {
        success: false,
        error: `Failed to merge inferred levers: ${(err as Error).message}`,
      }
    }
  }

  task.status = 'done'
  task.updatedAt = now
  task.completedAt = now
  queue.lastUpdated = now
  await writeQueue(input.memoryDir, queue)

  const transcriptSummary = leverMerge
    ? `Meta-intake approved. Added ${added} coordinator(s) to guildhall.yaml. Levers set: project=${leverMerge.projectSet.length}, domain-default=${leverMerge.domainDefaultSet.length}, overrides=${Object.keys(leverMerge.overridesSet).length}.`
    : `Meta-intake approved. Added ${added} coordinator(s) to guildhall.yaml.`

  await appendExploringTranscript({
    memoryDir: input.memoryDir,
    taskId: META_INTAKE_TASK_ID,
    role: 'system',
    content: transcriptSummary,
  })

  return {
    success: true,
    coordinatorsAdded: added,
    ...(leverMerge
      ? {
          leversSet: {
            project: leverMerge.projectSet,
            domainDefault: leverMerge.domainDefaultSet,
            overrides: leverMerge.overridesSet,
            rejected: leverMerge.rejected,
          },
        }
      : {}),
  }
}
