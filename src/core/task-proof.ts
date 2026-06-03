import { z } from 'zod'
import { EvidenceRef } from './evidence.js'

const LEGACY_TIMESTAMP = '1970-01-01T00:00:00.000Z'

export const LaunchStepBase = z.object({
  id: z.string(),
  title: z.string(),
  expectedOutcome: z.string().optional(),
})

export const LaunchStep = z.discriminatedUnion('kind', [
  LaunchStepBase.extend({
    kind: z.literal('copy_command'),
    command: z.string(),
    cwd: z.string().optional(),
  }),
  LaunchStepBase.extend({
    kind: z.literal('open_url'),
    url: z.string(),
  }),
  LaunchStepBase.extend({
    kind: z.literal('manual_step'),
    instructions: z.string(),
  }),
  LaunchStepBase.extend({
    kind: z.literal('external_dashboard'),
    service: z.string(),
    url: z.string().optional(),
    instructions: z.string().optional(),
  }),
  LaunchStepBase.extend({
    kind: z.literal('blocked_until_setup'),
    setupRequirement: z.string(),
    ownerAction: z.string(),
  }),
])
export type LaunchStep = z.infer<typeof LaunchStep>

export const EvidenceKind = z.enum(['automated', 'manual', 'browser', 'provider', 'artifact', 'external'])
export type EvidenceKind = z.infer<typeof EvidenceKind>

export const ExpectedEvidence = z.object({
  id: z.string(),
  kind: EvidenceKind,
  description: z.string(),
  required: z.boolean().default(true),
  sourceRef: z.string().optional(),
})
export type ExpectedEvidence = z.infer<typeof ExpectedEvidence>

export const VerificationRecord = z.object({
  id: z.string(),
  evidenceId: z.string().optional(),
  kind: EvidenceKind,
  status: z.enum(['passed', 'failed', 'blocked', 'not_run']),
  summary: z.string(),
  command: z.string().optional(),
  url: z.string().optional(),
  recordedAt: z.string(),
  recordedBy: z.string(),
  evidenceRefs: z.array(EvidenceRef).default([]),
})
export type VerificationRecord = z.infer<typeof VerificationRecord>

export const ProofPathScope = z.object({
  type: z.enum(['task', 'project']),
  id: z.string(),
})
export type ProofPathScope = z.infer<typeof ProofPathScope>

export const ProofPath = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : 'legacy-proof-path'
  return {
    ...record,
    id,
    scope: record.scope ?? { type: 'task', id },
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : id,
    summary:
      typeof record.summary === 'string' && record.summary.trim()
        ? record.summary.trim()
        : 'Legacy proof path carried forward until it is reshaped.',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : LEGACY_TIMESTAMP,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : LEGACY_TIMESTAMP,
    createdBy: typeof record.createdBy === 'string' && record.createdBy.trim() ? record.createdBy.trim() : 'legacy-import',
  }
}, z.object({
  id: z.string(),
  scope: ProofPathScope,
  title: z.string(),
  summary: z.string(),
  status: z.enum(['planned', 'in_progress', 'verified', 'blocked', 'stale']).default('planned'),
  launchSteps: z.array(LaunchStep).default([]),
  expectedEvidence: z.array(ExpectedEvidence).default([]),
  verificationRecords: z.array(VerificationRecord).default([]),
  notes: z.string().optional(),
  relatedTaskIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string(),
  updatedBy: z.string().optional(),
}))
export type ProofPath = z.infer<typeof ProofPath>

export const CompletionHandoff = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const record = value as Record<string, unknown>
  const taskId = typeof record.taskId === 'string' && record.taskId.trim() ? record.taskId.trim() : 'legacy-task'
  return {
    ...record,
    id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${taskId}-completion-handoff`,
    taskId,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : LEGACY_TIMESTAMP,
    completedBy: typeof record.completedBy === 'string' && record.completedBy.trim() ? record.completedBy.trim() : 'legacy-import',
    summary:
      typeof record.summary === 'string' && record.summary.trim()
        ? record.summary.trim()
        : 'Legacy completion handoff carried forward until it is reshaped.',
    verificationSummary:
      typeof record.verificationSummary === 'string' && record.verificationSummary.trim()
        ? record.verificationSummary.trim()
        : 'Legacy verification summary not yet normalized.',
    residualRisk:
      typeof record.residualRisk === 'string' && record.residualRisk.trim()
        ? record.residualRisk.trim()
        : 'Legacy residual risk not yet normalized.',
  }
}, z.object({
  id: z.string(),
  taskId: z.string(),
  completedAt: z.string(),
  completedBy: z.string(),
  summary: z.string(),
  proofPathIds: z.array(z.string()).default([]),
  verificationSummary: z.string(),
  automatedProof: z.array(VerificationRecord).default([]),
  manualProof: z.array(VerificationRecord).default([]),
  providerProof: z.array(VerificationRecord).default([]),
  residualRisk: z.string(),
  followUpTaskIds: z.array(z.string()).default([]),
  evidenceRefs: z.array(EvidenceRef).default([]),
}))
export type CompletionHandoff = z.infer<typeof CompletionHandoff>
