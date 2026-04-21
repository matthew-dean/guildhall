import { z } from 'zod'

// ---------------------------------------------------------------------------
// Coordinator domain definition
//
// A coordinator is instantiated with a "perspective" — a domain, a set of
// concerns, and escalation rules. Multiple coordinators can exist for the
// same project with different perspectives (e.g. a quality coordinator and
// a velocity coordinator), or one per sub-project (Looma vs Knit).
//
// Coordinators negotiate via a formal Request protocol.
// ---------------------------------------------------------------------------

export const CoordinatorConcern = z.object({
  id: z.string(),
  description: z.string(),
  // Questions this coordinator asks before approving any task or component
  reviewQuestions: z.array(z.string()),
})
export type CoordinatorConcern = z.infer<typeof CoordinatorConcern>

export const CoordinatorDomain = z.object({
  id: z.string(),
  name: z.string(),
  // One-paragraph description of what this coordinator cares about
  mandate: z.string(),
  // The project path(s) this coordinator governs
  projectPaths: z.array(z.string()),
  concerns: z.array(CoordinatorConcern),
  // Decisions this coordinator can make autonomously
  autonomousDecisions: z.array(z.string()),
  // Decisions that require escalation to human
  escalationTriggers: z.array(z.string()),
})
export type CoordinatorDomain = z.infer<typeof CoordinatorDomain>

// ---------------------------------------------------------------------------
// Inter-coordinator request protocol
//
// When one coordinator needs something from another (e.g. Knit coordinator
// requests a new Looma component), it files a CrossDomainRequest.
// The target coordinator reviews it against its own concerns before approving.
// ---------------------------------------------------------------------------

export const CrossDomainRequest = z.object({
  id: z.string(),
  fromDomain: z.string(),
  toDomain: z.string(),
  title: z.string(),
  // What is being requested
  request: z.string(),
  // Business justification from the requesting coordinator
  rationale: z.string(),
  // What the requesting coordinator is willing to own vs. what it needs from the target
  ownershipBoundary: z.string(),
  status: z.enum(['pending', 'approved', 'rejected', 'needs_revision']),
  // Response from the target coordinator
  response: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
})
export type CrossDomainRequest = z.infer<typeof CrossDomainRequest>

// ---------------------------------------------------------------------------
// Escalation protocol
// ---------------------------------------------------------------------------

export const EscalationLevel = z.enum([
  'coordinator',  // Escalate to the other coordinator(s) first
  'human',        // Requires human judgment
])

export const EscalationRequest = z.object({
  id: z.string(),
  fromAgentId: z.string(),
  taskId: z.string().optional(),
  level: EscalationLevel,
  reason: z.string(),
  // The specific question that needs to be resolved
  question: z.string(),
  // Options the escalating agent sees (coordinator/human can pick or override)
  options: z.array(z.string()).optional(),
  status: z.enum(['open', 'resolved']),
  resolution: z.string().optional(),
  resolvedBy: z.string().optional(),
  createdAt: z.string(),
  resolvedAt: z.string().optional(),
})
export type EscalationRequest = z.infer<typeof EscalationRequest>
