import type { WorkspaceInventory } from './detect.js'
import type { WorkspaceSignal } from './types.js'

/**
 * Deterministic hypothesis former (FR-34 step 3).
 *
 * Input: the raw `WorkspaceInventory` produced by `detectWorkspaceSignals`.
 * Output: a draft import that the human can preview in the dashboard and
 * that the workspace-importer agent refines during its reserved task.
 *
 * Intent mapping:
 *   - `goal`      → `goals[]`       (north-stars for the project)
 *   - `open_work` → `tasks[]`       (candidate tasks to seed TASKS.json)
 *   - `milestone` → `milestones[]`  (progress backfill — already-done work)
 *   - `context`   → `context[]`     (framing that informs future tasks)
 *
 * Dedup is deliberate: README + ROADMAP + TODO comments routinely echo each
 * other, and we don't want 8 copies of "Add dark mode" on the draft board.
 * We normalize titles (lowercase, strip punctuation, collapse whitespace)
 * and keep the highest-confidence signal per normalized title, folding
 * other references into that signal's `references` list.
 */

export type DraftConfidence = 'high' | 'medium' | 'low'

export interface DraftGoal {
  id: string
  title: string
  rationale: string
  source: string
  references?: readonly string[]
  confidence: DraftConfidence
}

export interface DraftTask {
  /**
   * Stable suggested id derived from the normalized title. The reserved
   * importer task rewrites these before merging into TASKS.json so they
   * follow the project's `<area>-<n>` convention.
   */
  suggestedId: string
  title: string
  description: string
  whyThisMayMatter?: string
  assumptions?: readonly string[]
  missingInformation?: readonly string[]
  domain: string
  scope: 'current' | 'later'
  priority: 'critical' | 'high' | 'normal' | 'low'
  acceptanceCriteria?: readonly Array<{
    id: string
    description: string
    verifiedBy?: string
  }>
  dependsOn?: readonly string[]
  proofPaths?: readonly Record<string, unknown>[]
  source: string
  references?: readonly string[]
  confidence: DraftConfidence
}

export interface DraftMilestone {
  title: string
  evidence: string
  source: string
  references?: readonly string[]
}

export interface DraftContext {
  label: string
  excerpt: string
  source: string
  references?: readonly string[]
  domain?: string
  role?: 'capability' | 'reference' | 'brief_input'
  linkedTaskHints?: readonly string[]
}

export interface WorkspaceImportDraft {
  goals: readonly DraftGoal[]
  tasks: readonly DraftTask[]
  milestones: readonly DraftMilestone[]
  context: readonly DraftContext[]
  /**
   * Totals for dashboard previews. `inputSignals` is the raw count across all
   * sources; `drafted` is how many ended up in the four buckets above;
   * `deduped` counts signals merged into an existing draft entry.
   */
  stats: {
    inputSignals: number
    drafted: number
    deduped: number
  }
}

function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/\bui-([a-z0-9][a-z0-9-]*)\b/g, '$1')
    .replace(/[`*_~]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(text: string): Set<string> {
  const normalized = normalize(text)
  const expanded = normalized.replace(/-/g, ' ')
  return new Set(
    expanded
      .split(' ')
      .filter((token) => token.length >= 3),
  )
}

const GENERIC_TASK_TOKENS = new Set([
  'add',
  'after',
  'and',
  'baseline',
  'build',
  'create',
  'define',
  'fix',
  'from',
  'implement',
  'improve',
  'into',
  'lane',
  'path',
  'proof',
  'review',
  'reviewer',
  'resolve',
  'schema',
  'schemas',
  'ship',
  'simpler',
  'split',
  'stable',
  'task',
  'the',
  'then',
  'this',
  'through',
  'use',
  'uses',
  'using',
  'work',
])

function meaningfulTokenSet(text: string): Set<string> {
  return new Set(
    [...tokenSet(text)].filter((token) => !GENERIC_TASK_TOKENS.has(token)),
  )
}

function firstMeaningfulToken(text: string): string | undefined {
  return [...meaningfulTokenSet(text)][0] ?? normalize(text).split(' ').find(Boolean)
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) {
    if (b.has(token)) shared += 1
  }
  return shared / Math.max(a.size, b.size)
}

function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const token of a) {
    if (b.has(token)) shared += 1
  }
  return shared
}

function referenceBasenames(refs: readonly string[] | undefined): Set<string> {
  return new Set(
    (refs ?? [])
      .map(ref => ref.replaceAll('\\', '/').split('/').pop()?.trim() ?? '')
      .filter(Boolean),
  )
}

function planningDocStructuralForm(
  item: Pick<WorkspaceSignal, 'evidence' | 'source'>,
): 'numbered' | 'bullet' | null {
  if (item.source !== 'planning-docs') return null
  const evidence = item.evidence.trim()
  if (/: \d+\.\s+/.test(evidence)) return 'numbered'
  if (/: -\s+/.test(evidence)) return 'bullet'
  return null
}

function planningDocSourcePath(
  item: Pick<WorkspaceSignal, 'evidence' | 'source'>,
): string | null {
  if (item.source !== 'planning-docs') return null
  const match = /^(.+?\.md):\s+/.exec(item.evidence.trim())
  return match?.[1]?.trim() ?? null
}

function stableHash(input: string): string {
  let h = 0x811c9dc5
  for (const ch of input) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).slice(0, 7)
}

function compactGeneratedId(prefix: string, title: string, fallback: number): string {
  const key = normalize(title)
  return `${prefix}-${stableHash(key || String(fallback))}`
}

function supportingText(title: string, evidence: string): string {
  return normalize(title) === normalize(evidence) ? '' : evidence
}

const CONFIDENCE_RANK: Record<DraftConfidence, number> = {
  high: 2,
  medium: 1,
  low: 0,
}

function mergeReferences(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string[] | undefined {
  const out = new Set<string>()
  for (const r of a ?? []) out.add(r)
  for (const r of b ?? []) out.add(r)
  return out.size > 0 ? [...out] : undefined
}

function priorityFromConfidence(confidence: DraftConfidence): DraftTask['priority'] {
  if (confidence === 'high') return 'normal'
  if (confidence === 'medium') return 'normal'
  return 'low'
}

function draftTaskAssumptions(sig: WorkspaceSignal): string[] {
  const assumptions: string[] = []
  if (sig.source === 'roadmap' || sig.source === 'planning-docs') {
    assumptions.push('This item still reflects current project intent and has not already been completed or superseded elsewhere.')
  }
  if (sig.confidence === 'low') {
    assumptions.push('The source signal may be incomplete and should be confirmed against current repo reality before shaping proceeds.')
  }
  return assumptions
}

function draftTaskMissingInformation(sig: WorkspaceSignal): string[] {
  const missing: string[] = []
  const supporting = supportingText(sig.title, sig.evidence)
  if (!supporting) {
    missing.push('The source names the work, but not yet the concrete outcome or proof boundary.')
  }
  if (sig.confidence !== 'high') {
    missing.push('Guildhall still needs to confirm scope, current relevance, and success criteria during shaping.')
  }
  return missing
}

function domainFromSignal(sig: WorkspaceSignal): string {
  if (typeof sig.domainHint === 'string' && sig.domainHint.trim()) {
    return sig.domainHint.trim()
  }
  return 'core'
}

function domainsCompatibleForDedup(left: string, right: string): boolean {
  return left === right || left === 'core' || right === 'core'
}

function scopeFromSignal(sig: WorkspaceSignal): DraftTask['scope'] {
  return sig.scopeHint === 'later' ? 'later' : 'current'
}

export function isFormattingDebris(sig: Pick<WorkspaceSignal, 'title'>): boolean {
  if (sig.title.trim().endsWith(':')) return true
  const title = normalize(sig.title)
  if (!title) return true
  if (title === 'none' || title === 'n a' || title === 'na' || title === 'tbd') return true
  if (title.includes('umbrella doc') && title.includes('covered by child specs')) return true
  if (title === 'open questions if any' || title === 'out of scope') return true
  if (title === 'numbered given when then acceptance criteria') return true
  if (title === 'test mapping which ac is unit vs integration') return true
  if (/^once you (pick|answer)\b/.test(title)) return true
  if (/^i(?: |ll| will) draft the full spec\b/.test(title)) return true
  return false
}

function isContextualOpenWork(sig: WorkspaceSignal): boolean {
  const title = normalize(sig.title)
  if (!title) return false
  if (/^strong recurrence in\b/.test(title)) return true
  if (/\buser must run\b/.test(title)) return true
  if (/\bmust be enabled\b/.test(title)) return true
  if (/\brequired for\b/.test(title)) return true
  if (/\bneeds server side\b/.test(title)) return true
  if (/\badmin api required\b/.test(title)) return true
  return false
}

function isGenericTodo(sig: WorkspaceSignal): boolean {
  if (sig.source !== 'todo-comments' || sig.confidence !== 'low') return false
  const title = normalize(sig.title.replace(/^todo\s*:?\s*/i, ''))
  if (!title) return true
  if (/^add more features?$/.test(title)) return true
  if (/^(could|maybe|possibly|eventually)\b/.test(title)) return true
  return false
}

function isBootstrapChore(sig: WorkspaceSignal): boolean {
  if (sig.source !== 'roadmap') return false
  const title = normalize(sig.title)
  return (
    /\bpnpm install\b/.test(title) ||
    /\bnpm install\b/.test(title) ||
    /\byarn install\b/.test(title) ||
    /\bverify bootstrap\b/.test(title)
  )
}

function shouldSkipTaskSignal(sig: WorkspaceSignal): boolean {
  return isGenericTodo(sig) || isBootstrapChore(sig) || isFormattingDebris(sig)
}

/**
 * Folds the raw inventory into a preview-ready draft. Pure function — no IO,
 * no randomness, no wall-clock. Given the same inventory you get the same
 * draft every call, which matters because the dashboard re-renders on every
 * inventory refresh and IDs must be stable.
 */
export function formWorkspaceHypothesis(
  inventory: WorkspaceInventory,
): WorkspaceImportDraft {
  const goalIndex = new Map<string, DraftGoal>()
  const taskIndex = new Map<string, DraftTask>()
  const milestoneIndex = new Map<string, DraftMilestone>()
  const contextIndex = new Map<string, DraftContext>()
  let deduped = 0

  const bump = (
    current: { confidence: DraftConfidence } | undefined,
    next: DraftConfidence,
  ): boolean => {
    if (!current) return true
    return CONFIDENCE_RANK[next] > CONFIDENCE_RANK[current.confidence]
  }

  for (const sig of inventory.signals) {
    if (sig.kind === 'goal') addGoal(goalIndex, sig, bump)
    else if (sig.kind === 'open_work') {
      if (isContextualOpenWork(sig)) addContext(contextIndex, sig)
      else addTask(taskIndex, sig, bump)
    }
    else if (sig.kind === 'milestone') addMilestone(milestoneIndex, sig)
    else if (sig.kind === 'context') addContext(contextIndex, sig)
  }

  // Count merges: signals − unique entries across all buckets.
  const uniques =
    goalIndex.size + taskIndex.size + milestoneIndex.size + contextIndex.size
  deduped = Math.max(0, inventory.signals.length - uniques)

  const goals = [...goalIndex.values()]
  const context = [...contextIndex.values()]
  const tasks = enrichTasksWithRelatedContext([...taskIndex.values()], context)
  const milestones = [...milestoneIndex.values()]

  return {
    goals,
    tasks,
    milestones,
    context,
    stats: {
      inputSignals: inventory.signals.length,
      drafted: uniques,
      deduped,
    },
  }
}

function addGoal(
  index: Map<string, DraftGoal>,
  sig: WorkspaceSignal,
  bump: (cur: { confidence: DraftConfidence } | undefined, next: DraftConfidence) => boolean,
): void {
  const key = normalize(sig.title)
  if (!key) return
  const existing = index.get(key)
  if (!existing) {
    index.set(key, {
      id: compactGeneratedId('goal', sig.title, index.size + 1),
      title: sig.title,
      rationale: supportingText(sig.title, sig.evidence),
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
      confidence: sig.confidence,
    })
    return
  }
  const shouldBump = bump(existing, sig.confidence)
  const merged: DraftGoal = {
    ...existing,
    confidence: shouldBump ? sig.confidence : existing.confidence,
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) merged.references = refs
  if (shouldBump) {
    merged.rationale = supportingText(sig.title, sig.evidence)
    merged.source = sig.source
  }
  index.set(key, merged)
}

function addTask(
  index: Map<string, DraftTask>,
  sig: WorkspaceSignal,
  bump: (cur: { confidence: DraftConfidence } | undefined, next: DraftConfidence) => boolean,
): void {
  if (shouldSkipTaskSignal(sig)) return
  let key = normalize(sig.title)
  if (!key) return
  if (!index.has(key)) {
    const sigTokens = tokenSet(sig.title)
    const sigMeaningfulTokens = meaningfulTokenSet(sig.title)
    const sigRef = sig.references?.[0]
    const sigDomain = domainFromSignal(sig)
    for (const [existingKey, existing] of index.entries()) {
      if (!domainsCompatibleForDedup(existing.domain, sigDomain)) continue
      const existingRef = existing.references?.[0]
      const overlap = overlapRatio(sigTokens, tokenSet(existing.title))
      const existingMeaningfulTokens = meaningfulTokenSet(existing.title)
      const meaningfulOverlap = overlapRatio(
        sigMeaningfulTokens,
        existingMeaningfulTokens,
      )
      const sharedMeaningfulTokens = sharedTokenCount(sigMeaningfulTokens, existingMeaningfulTokens)
      const sameReference = Boolean(sigRef && existingRef && sigRef === existingRef)
      const sharedReferenceBasename = [...referenceBasenames(sig.references)].some(ref =>
        referenceBasenames(existing.references).has(ref),
      )
      const sigStructuralForm = planningDocStructuralForm(sig)
      const existingStructuralForm = planningDocStructuralForm({
        source: existing.source,
        evidence: existing.description,
      })
      const sigSourcePath = planningDocSourcePath(sig)
      const existingSourcePath = planningDocSourcePath({
        source: existing.source,
        evidence: existing.description,
      })
      const keepDistinctRoadmapSlices =
        sigStructuralForm &&
        existingStructuralForm &&
        sigStructuralForm !== existingStructuralForm &&
        sigSourcePath &&
        existingSourcePath &&
        sigSourcePath === existingSourcePath
      if (keepDistinctRoadmapSlices) continue
      const planningDocEcho =
        sig.source === 'planning-docs' &&
        existing.source === 'planning-docs' &&
        sigStructuralForm === existingStructuralForm &&
        (
          (
            firstMeaningfulToken(sig.title) === firstMeaningfulToken(existing.title) &&
            meaningfulOverlap >= 0.5
          ) ||
          meaningfulOverlap >= 0.45
        )
      const sameReferenceEcho =
        sameReference &&
        overlap >= 0.7 &&
        meaningfulOverlap >= 0.34
      const sameReferenceFamilyEcho =
        sharedReferenceBasename &&
        meaningfulOverlap >= 0.45 &&
        sharedMeaningfulTokens >= 2
      if (sameReferenceEcho || sameReferenceFamilyEcho || planningDocEcho) {
        key = existingKey
        break
      }
    }
  }
  const existing = index.get(key)
  if (!existing) {
    index.set(key, {
      suggestedId: compactGeneratedId('task-import', sig.title, index.size + 1),
      title: sig.title,
      description: supportingText(sig.title, sig.evidence),
      ...(supportingText(sig.title, sig.evidence) ? { whyThisMayMatter: sig.evidence } : {}),
      assumptions: draftTaskAssumptions(sig),
      missingInformation: draftTaskMissingInformation(sig),
      domain: domainFromSignal(sig),
      scope: scopeFromSignal(sig),
      priority: priorityFromConfidence(sig.confidence),
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
      confidence: sig.confidence,
    })
    return
  }
  const shouldBump = bump(existing, sig.confidence)
  const merged: DraftTask = {
    ...existing,
    confidence: shouldBump ? sig.confidence : existing.confidence,
    domain:
      existing.domain === 'core' && domainFromSignal(sig) !== 'core'
        ? domainFromSignal(sig)
        : existing.domain,
    scope:
      existing.scope === 'current' || scopeFromSignal(sig) === 'current'
        ? 'current'
        : 'later',
    priority: shouldBump
      ? priorityFromConfidence(sig.confidence)
      : existing.priority,
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) merged.references = refs
  if (shouldBump) {
    merged.description = supportingText(sig.title, sig.evidence)
    merged.whyThisMayMatter = supportingText(sig.title, sig.evidence) ? sig.evidence : existing.whyThisMayMatter
    merged.assumptions = draftTaskAssumptions(sig)
    merged.missingInformation = draftTaskMissingInformation(sig)
    merged.source = sig.source
  }
  index.set(key, merged)
}

function addMilestone(
  index: Map<string, DraftMilestone>,
  sig: WorkspaceSignal,
): void {
  const key = normalize(sig.title)
  if (!key) return
  const existing = index.get(key)
  if (!existing) {
    index.set(key, {
      title: sig.title,
      evidence: sig.evidence,
      source: sig.source,
      ...(sig.references ? { references: sig.references } : {}),
    })
    return
  }
  const refs = mergeReferences(existing.references, sig.references)
  if (refs) index.set(key, { ...existing, references: refs })
}

function addContext(
  index: Map<string, DraftContext>,
  sig: WorkspaceSignal,
): void {
  const refKey = sig.references?.[0] ?? sig.title
  const key = `${sig.source}:${refKey}:${normalize(sig.title)}`
  if (index.has(key)) return
  index.set(key, {
    label: sig.title,
    excerpt: sig.evidence,
    source: sig.source,
    ...(sig.references ? { references: sig.references } : {}),
    ...(sig.domainHint ? { domain: sig.domainHint } : {}),
    ...(sig.role ? { role: sig.role } : {}),
    ...(sig.linkedTaskHints?.length ? { linkedTaskHints: [...sig.linkedTaskHints] } : {}),
  })
}

function enrichTasksWithRelatedContext(
  tasks: DraftTask[],
  context: readonly DraftContext[],
): DraftTask[] {
  if (tasks.length === 0 || context.length === 0) return tasks
  return tasks.map(task => {
    const relatedReferences = relatedContextReferences(task, context)
    if (relatedReferences.length === 0) return task
    return {
      ...task,
      references: mergeReferences(task.references, relatedReferences),
    }
  })
}

function relatedContextReferences(
  task: DraftTask,
  context: readonly DraftContext[],
): string[] {
  const text = `${task.title}\n${task.description}\n${task.whyThisMayMatter ?? ''}`
  const taskTokens = meaningfulTokenSet(text)
  const existingRefs = new Set(task.references ?? [])
  const ranked = context
    .map(entry => {
      const ref = entry.references?.[0]
      if (!ref || existingRefs.has(ref)) return null
      const score = relatedContextScore(task, entry, taskTokens)
      if (score < 2) return null
      return { ref, score }
    })
    .filter((entry): entry is { ref: string; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.ref.localeCompare(right.ref))

  return ranked.slice(0, 4).map(entry => entry.ref)
}

function relatedContextScore(
  task: DraftTask,
  entry: DraftContext,
  taskTokens: Set<string>,
): number {
  const contextText = `${entry.label}\n${entry.excerpt}`
  const contextTokens = meaningfulTokenSet(contextText)
  const overlap = overlapRatio(taskTokens, contextTokens)
  let score = overlap * 10
  const taskText = normalize(`${task.title} ${task.description} ${task.whyThisMayMatter ?? ''}`)
  const contextNormalized = normalize(contextText)
  const contextRef = entry.references?.[0] ?? ''

  if (/\bschema|contract|record\b/.test(taskText) && /\bschema|contract|record\b/.test(contextNormalized)) {
    score += 4
  }
  if (/\bpacket|context|compaction\b/.test(taskText) && /\bpacket|context|compaction\b/.test(contextNormalized)) {
    score += 4
  }
  if (/\bfixture|expected\b/.test(taskText) && /\bfixture|expected|prototype\b/.test(contextNormalized)) {
    score += 3
  }
  if (/\brunner|run|workflow\b/.test(taskText) && /\brunner|run|workflow|prototype\b/.test(contextNormalized)) {
    score += 3
  }
  if (/\bdebug|trace|evaluation|report\b/.test(taskText) && /\bdebug|trace|evaluation|report\b/.test(contextNormalized)) {
    score += 4
  }
  if (task.scope === 'current' && /docs\/harness\//.test(contextRef)) {
    score += 0.5
  }
  if (task.scope === 'current' && /docs\/specs\//.test(contextRef)) {
    score += 0.5
  }
  return score
}
