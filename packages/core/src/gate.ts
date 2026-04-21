import { z } from 'zod'

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
