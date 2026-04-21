import { z } from 'zod'
import type { Task } from './task.js'
import type { DesignSystem } from './design-system.js'

// ---------------------------------------------------------------------------
// Gate system
//
// Hard gates: shell commands that must exit 0. Non-negotiable.
// Soft gates: reviewer rubric items that must score above a threshold.
//   Soft gate failures can be overridden with a reason (creating an ADR entry).
// ---------------------------------------------------------------------------

export const HardGate = z.object({
  id: z.string(),
  label: z.string(),
  // Shell command to run, relative to the task's projectPath
  command: z.string(),
  // Optional timeout in milliseconds
  timeoutMs: z.number().default(120_000),
})
export type HardGate = z.infer<typeof HardGate>

export const SoftGateRubricItem = z.object({
  id: z.string(),
  question: z.string(), // Reviewer agent answers yes/no + justification
  weight: z.number().min(0).max(1).default(1),
})
export type SoftGateRubricItem = z.infer<typeof SoftGateRubricItem>

export const SoftGate = z.object({
  id: z.string(),
  label: z.string(),
  rubric: z.array(SoftGateRubricItem),
  // Fraction of weighted rubric items that must pass (0–1)
  passingThreshold: z.number().min(0).max(1).default(0.8),
})
export type SoftGate = z.infer<typeof SoftGate>

// A GateSet is registered per task type in the GateRegistry
export const GateSet = z.object({
  hard: z.array(HardGate).default([]),
  soft: z.array(SoftGate).default([]),
})
export type GateSet = z.infer<typeof GateSet>

// ---------------------------------------------------------------------------
// Built-in hard gates for TypeScript monorepos
// Projects can extend these with project-specific gates.
// ---------------------------------------------------------------------------

export const STANDARD_TS_GATES = {
  typecheck: {
    id: 'typecheck',
    label: 'TypeScript typecheck',
    command: 'pnpm typecheck',
    timeoutMs: 120_000,
  },
  build: {
    id: 'build',
    label: 'Build',
    command: 'pnpm build',
    timeoutMs: 180_000,
  },
  test: {
    id: 'test',
    label: 'Unit tests',
    command: 'pnpm test',
    timeoutMs: 120_000,
  },
  lint: {
    id: 'lint',
    label: 'Lint',
    command: 'pnpm lint',
    timeoutMs: 60_000,
  },
} satisfies Record<string, HardGate>

// ---------------------------------------------------------------------------
// Built-in soft gate rubrics
// ---------------------------------------------------------------------------

export const STANDARD_CODE_REVIEW_RUBRIC: SoftGateRubricItem[] = [
  { id: 'acceptance-criteria-met', question: 'Are all acceptance criteria explicitly met by the implementation?', weight: 1 },
  { id: 'no-scope-creep', question: 'Does the change stay within the defined task scope (no out-of-scope work)?', weight: 0.8 },
  { id: 'conventions-followed', question: 'Does the code follow the conventions documented in the project?', weight: 0.7 },
  { id: 'no-regressions', question: 'Are there no obvious regressions to previously working functionality?', weight: 1 },
  { id: 'documented', question: 'Are public APIs, components, or interfaces adequately documented?', weight: 0.6 },
]

// ---------------------------------------------------------------------------
// Specialized review rubrics (v0.2 rails)
//
// Each rubric captures a distinct reviewer lens. The reviewer-agent runs the
// code-review rubric always; specialized rubrics are attached to a review
// only when the task's surface warrants it — see `selectApplicableReviewRubrics`
// for the selection heuristics.
// ---------------------------------------------------------------------------

export const DESIGN_REVIEW_RUBRIC: SoftGateRubricItem[] = [
  { id: 'design-tokens-respected', question: 'Does the implementation use the approved design tokens (colors, spacing, typography) rather than ad-hoc values?', weight: 1 },
  { id: 'primitives-used', question: 'Does the implementation reach for approved primitives before introducing a new ad-hoc component?', weight: 0.8 },
  { id: 'visual-consistency', question: 'Is the visual result consistent with other surfaces in the same product area?', weight: 0.7 },
]

export const COPY_REVIEW_RUBRIC: SoftGateRubricItem[] = [
  { id: 'voice-tone', question: 'Does the copy match the approved voice/tone in the design system?', weight: 0.8 },
  { id: 'banned-terms', question: 'Does the copy avoid banned terms and prefer the preferred alternatives?', weight: 1 },
  { id: 'copy-clarity', question: 'Is every piece of user-facing copy clear and necessary (no jargon, no filler)?', weight: 0.7 },
]

export const A11Y_REVIEW_RUBRIC: SoftGateRubricItem[] = [
  { id: 'keyboard-navigable', question: 'Is every new interactive element reachable and operable by keyboard alone?', weight: 1 },
  { id: 'focus-visible', question: 'Do focusable elements have a visible focus indicator that meets the design-system focus rule?', weight: 0.9 },
  { id: 'aria-semantics', question: 'Are appropriate roles, labels, and ARIA attributes present for assistive technology?', weight: 0.9 },
  { id: 'contrast-ok', question: 'Does all text/background meet the design-system minimum contrast ratio?', weight: 1 },
  { id: 'reduced-motion', question: 'Is motion either disabled or reduced under prefers-reduced-motion?', weight: 0.5 },
]

export const PRODUCT_REVIEW_RUBRIC: SoftGateRubricItem[] = [
  { id: 'user-job-served', question: 'Does the delivered change materially advance the userJob named in the product brief?', weight: 1 },
  { id: 'success-metric-measurable', question: 'Can the success metric now be observed or instrumented against the delivered behavior?', weight: 0.9 },
  { id: 'anti-patterns-avoided', question: 'Does the change avoid every anti-pattern enumerated in the product brief?', weight: 1 },
  { id: 'rollout-ready', question: 'Is the rollout plan (flags, staging, migration) honored in what was delivered?', weight: 0.5 },
]

// ---------------------------------------------------------------------------
// Selection: which rubrics apply to this task?
//
// Pure function — inputs in, outputs out. The reviewer agent attaches the
// selected rubrics to the standard code-review rubric. Selection errs toward
// including a rubric when evidence points at its lens mattering; reviewers
// can always mark an item as "n/a" in practice.
// ---------------------------------------------------------------------------

export interface ReviewRubricSelection {
  code: SoftGateRubricItem[]
  design?: SoftGateRubricItem[]
  copy?: SoftGateRubricItem[]
  a11y?: SoftGateRubricItem[]
  product?: SoftGateRubricItem[]
}

function taskTouchesProductSurface(task: Task): boolean {
  if (task.productBrief) return true
  const text = `${task.title} ${task.description}`.toLowerCase()
  return /\b(ui|page|screen|button|form|modal|dialog|toast|nav|menu|layout|copy|onboard|wizard|dashboard|empty state)\b/.test(text)
}

export function selectApplicableReviewRubrics(
  task: Task,
  designSystem: DesignSystem | undefined,
): ReviewRubricSelection {
  const sel: ReviewRubricSelection = { code: STANDARD_CODE_REVIEW_RUBRIC }
  const touchesProduct = taskTouchesProductSurface(task)

  if (designSystem && touchesProduct) {
    sel.design = DESIGN_REVIEW_RUBRIC
    sel.a11y = A11Y_REVIEW_RUBRIC
    if (
      designSystem.copyVoice.bannedTerms.length > 0
      || designSystem.copyVoice.preferredTerms.length > 0
      || designSystem.copyVoice.tone !== 'plain'
    ) {
      sel.copy = COPY_REVIEW_RUBRIC
    }
  }
  if (task.productBrief) {
    sel.product = PRODUCT_REVIEW_RUBRIC
  }
  return sel
}

/**
 * Render the selection as markdown the reviewer agent sees in its context.
 * Grouped by lens so the reviewer can march through them top-to-bottom.
 */
export function renderRubricSelection(sel: ReviewRubricSelection): string {
  const blocks: string[] = []
  const writeBlock = (label: string, items: SoftGateRubricItem[]): void => {
    if (items.length === 0) return
    blocks.push(
      [
        `### ${label}`,
        ...items.map((i) => `- **${i.id}** (weight ${i.weight}) — ${i.question}`),
      ].join('\n'),
    )
  }
  writeBlock('Code review', sel.code)
  if (sel.product) writeBlock('Product review', sel.product)
  if (sel.design) writeBlock('Design review', sel.design)
  if (sel.copy) writeBlock('Copy review', sel.copy)
  if (sel.a11y) writeBlock('Accessibility review', sel.a11y)
  return blocks.join('\n\n')
}
