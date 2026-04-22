/**
 * FR-23: Business-envelope evaluation.
 *
 * Coordinators and the proposal-promotion path consult this module when
 * deciding whether a task / proposal fits inside its parent goal's envelope.
 * The evaluator is pure: given a task, its goal, and the lever strictness,
 * it returns a decision describing what the caller should do.
 *
 * Decision shape:
 *
 *   `{ kind: 'within'     }`  — no guardrails violated; caller proceeds.
 *   `{ kind: 'advisory',
 *       violations: [...] }`  — violations exist, but strictness allows
 *                               proceeding with a warning.
 *   `{ kind: 'reject',
 *       violations: [...] }`  — strictness is `strict`; caller must reject.
 *   `{ kind: 'escalate',
 *       reason }`             — no parent goal; per FR-23, an uncategorized
 *                               task is an escalation signal. Returned even
 *                               when strictness is `off` so the caller can
 *                               decide whether to route it through FR-10.
 *
 * The evaluator does no IO. Callers (orchestrator, proposal-promotion
 * pipeline, coordinator review pipeline) supply the already-loaded goal.
 *
 * Storage for the goal book itself is separate; see
 * `loadGoalBook` / `saveGoalBook` / `findGoal` below.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Goal,
  GoalBook,
  GOALS_FILENAME,
  type Guardrail,
  type Task,
} from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'

// ---------------------------------------------------------------------------
// Decision shape
// ---------------------------------------------------------------------------

export type EnvelopeStrictness = ProjectLevers['business_envelope_strictness']['position']

/**
 * A violated guardrail the coordinator or caller should surface. `matched`
 * text is the substring (from the task's fields) that triggered the match —
 * present when the match was keyword-based, absent when the violation is
 * structural (e.g. missing goal).
 */
export interface GuardrailViolation {
  guardrailId: string
  kind: Guardrail['kind']
  description: string
  matched?: string
}

export type EnvelopeDecision =
  | { kind: 'within' }
  | { kind: 'advisory'; violations: GuardrailViolation[] }
  | { kind: 'reject'; violations: GuardrailViolation[] }
  | { kind: 'escalate'; reason: string }

export interface EvaluateEnvelopeInput {
  task: Task
  goal: Goal | undefined
  strictness: EnvelopeStrictness
}

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

/**
 * FR-23 evaluator. Returns what the caller should do.
 *
 * Semantics by strictness:
 *   - `off`      — we still flag the missing-goal case as an escalation
 *                  signal (FR-23: "uncategorized task is an escalation
 *                  signal, not a free-floating task"). Guardrail violations
 *                  are suppressed — the envelope is informational only.
 *   - `advisory` — both missing goal and guardrail violations surface as
 *                  `advisory` so the coordinator can warn and proceed.
 *   - `strict`   — any guardrail violation or missing goal is a `reject`
 *                  (which the caller may translate into a shelve, an
 *                  escalation, or a bounce back to the spec agent).
 *
 * Guardrail matching: each guardrail whose tags match the task's domain
 * (or has no tags, meaning it applies to all tasks under this goal) is
 * evaluated. A keyword match against the task's `title | description |
 * notes` text triggers. `exclude` guardrails violate on match; `include`
 * guardrails violate on absence of match. Coordinator agents still get to
 * override either way in LLM mode — this evaluator is the deterministic
 * floor the orchestrator and proposal-promotion path use.
 */
export function evaluateEnvelope(input: EvaluateEnvelopeInput): EnvelopeDecision {
  const { task, goal, strictness } = input

  // Missing goal — always an escalation signal, regardless of strictness.
  if (!goal) {
    if (strictness === 'strict') {
      return {
        kind: 'reject',
        violations: [
          {
            guardrailId: '__no_goal__',
            kind: 'include',
            description: 'Task is uncategorized (no parentGoalId) — per FR-23, every task must belong to a goal.',
          },
        ],
      }
    }
    return {
      kind: 'escalate',
      reason: `Task ${task.id} has no parent goal. FR-23 requires every task to carry a parentGoalId.`,
    }
  }

  if (strictness === 'off') {
    // Envelope is informational; skip guardrail analysis.
    return { kind: 'within' }
  }

  const violations = collectViolations(task, goal)
  if (violations.length === 0) return { kind: 'within' }

  if (strictness === 'strict') return { kind: 'reject', violations }
  return { kind: 'advisory', violations }
}

/**
 * Pure: walk every applicable guardrail on the goal and emit violations.
 * Exported so callers can generate "here's what the coordinator noticed"
 * summaries without re-running the strictness gate.
 */
export function collectViolations(task: Task, goal: Goal): GuardrailViolation[] {
  const haystack = buildTaskText(task).toLowerCase()
  const violations: GuardrailViolation[] = []

  for (const rail of goal.guardrails) {
    if (!guardrailApplies(rail, task)) continue
    const hit = findMatch(haystack, rail.description)
    if (rail.kind === 'exclude' && hit) {
      violations.push({
        guardrailId: rail.id,
        kind: rail.kind,
        description: rail.description,
        matched: hit,
      })
    } else if (rail.kind === 'include' && !hit) {
      violations.push({
        guardrailId: rail.id,
        kind: rail.kind,
        description: rail.description,
      })
    }
  }
  return violations
}

/**
 * A guardrail applies to a task when either the guardrail has no tags (it
 * applies universally under this goal) or the task's domain is in the tag
 * list. Tag matching is case-insensitive.
 */
export function guardrailApplies(rail: Guardrail, task: Task): boolean {
  if (rail.tags.length === 0) return true
  const domain = task.domain.toLowerCase()
  return rail.tags.some((t) => t.toLowerCase() === domain)
}

/**
 * Return the matching text span if any non-stopword token in the guardrail's
 * description appears in the haystack; otherwise null. Intentionally cheap:
 * this is the deterministic floor, not the coordinator's semantic check.
 *
 * Stopwords are filtered so guardrails phrased in natural English ("no
 * public API changes") don't trip on the word "no" or "changes" showing
 * up anywhere in the task text.
 */
export function findMatch(haystack: string, needleDescription: string): string | null {
  const tokens = tokenize(needleDescription).filter((t) => !STOPWORDS.has(t))
  for (const tok of tokens) {
    if (haystack.includes(tok)) return tok
  }
  return null
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'for',
  'from', 'has', 'have', 'if', 'in', 'into', 'is', 'it', 'its', 'must', 'no',
  'not', 'of', 'on', 'or', 'should', 'that', 'the', 'their', 'this', 'to',
  'with', 'without',
])

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 3)
}

function buildTaskText(task: Task): string {
  const parts: string[] = [task.title, task.description]
  for (const n of task.notes) parts.push(n.content)
  for (const c of task.acceptanceCriteria) parts.push(c.description)
  for (const o of task.outOfScope) parts.push(o)
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Goal storage
// ---------------------------------------------------------------------------

export function goalsPath(memoryDir: string): string {
  return path.join(memoryDir, GOALS_FILENAME)
}

/**
 * Load GOALS.json. Returns an empty book when the file is missing so the
 * orchestrator's first run on a fresh workspace can proceed — meta-intake
 * (FR-14) is what populates real goals.
 */
export async function loadGoalBook(memoryDir: string): Promise<GoalBook> {
  const p = goalsPath(memoryDir)
  try {
    const raw = await fs.readFile(p, 'utf-8')
    return GoalBook.parse(JSON.parse(raw))
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return GoalBook.parse({
        version: 1,
        lastUpdated: new Date(0).toISOString(),
        goals: [],
      })
    }
    throw err
  }
}

/**
 * Persist GOALS.json atomically. `.tmp` → rename so a crash mid-write leaves
 * either the old file or the new file intact, never a truncated one.
 */
export async function saveGoalBook(
  memoryDir: string,
  book: GoalBook,
): Promise<void> {
  const p = goalsPath(memoryDir)
  const tmp = `${p}.tmp`
  const validated = GoalBook.parse({ ...book, lastUpdated: new Date().toISOString() })
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), 'utf-8')
  await fs.rename(tmp, p)
}

/** Pure lookup; returns undefined for unknown ids. */
export function findGoal(book: GoalBook, id: string | undefined): Goal | undefined {
  if (!id) return undefined
  return book.goals.find((g) => g.id === id)
}

/**
 * Convenience: load the goal for a task, or undefined when the task has no
 * parentGoalId or the id points at an unknown goal.
 */
export async function loadGoalForTask(
  memoryDir: string,
  task: Task,
): Promise<Goal | undefined> {
  const book = await loadGoalBook(memoryDir)
  return findGoal(book, task.parentGoalId)
}
