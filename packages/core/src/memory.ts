import { z } from 'zod'

// ---------------------------------------------------------------------------
// Memory layer
//
// Two tiers:
//   1. Working memory — per-session, injected into agent context per call.
//      Lives in memory/ as structured markdown files.
//   2. Long-term memory — persists across sessions.
//      Also in memory/ but append-only (DECISIONS.md, PROGRESS.md).
//
// All agents read from memory before acting and write to memory after.
// ---------------------------------------------------------------------------

export const MemoryFileKey = z.enum([
  'TASKS',       // Task queue — the source of truth
  'MEMORY',      // Long-term project knowledge (conventions, architecture, decisions)
  'DECISIONS',   // Append-only ADR trail
  'PROGRESS',    // Append-only human-readable progress log
])
export type MemoryFileKey = z.infer<typeof MemoryFileKey>

export const MEMORY_FILES: Record<MemoryFileKey, string> = {
  TASKS: 'memory/TASKS.json',
  MEMORY: 'memory/MEMORY.md',
  DECISIONS: 'memory/DECISIONS.md',
  PROGRESS: 'memory/PROGRESS.md',
}

// What gets injected into an agent's context at the start of each call
export const AgentContext = z.object({
  // The task this agent is working on (if any)
  currentTask: z.string().optional(),
  // Coordinator domain this agent belongs to
  domain: z.string(),
  // Relevant excerpts from MEMORY.md
  projectMemory: z.string(),
  // Recent entries from PROGRESS.md (last N lines)
  recentProgress: z.string(),
  // Recent DECISIONS relevant to this domain
  recentDecisions: z.string(),
})
export type AgentContext = z.infer<typeof AgentContext>

// An ADR-style decision entry
export const DecisionEntry = z.object({
  id: z.string(),
  timestamp: z.string(),
  agentId: z.string(),
  domain: z.string(),
  taskId: z.string().optional(),
  title: z.string(),
  context: z.string(),
  decision: z.string(),
  consequences: z.string(),
  // If this overrides a soft gate failure
  overridesSoftGate: z.string().optional(),
})
export type DecisionEntry = z.infer<typeof DecisionEntry>

// A single progress log entry
export const ProgressEntry = z.object({
  timestamp: z.string(),
  agentId: z.string(),
  domain: z.string(),
  taskId: z.string().optional(),
  summary: z.string(),
  // 'heartbeat' = routine status, 'milestone' = significant completion, 'blocked' = needs attention
  type: z.enum(['heartbeat', 'milestone', 'blocked', 'escalation']),
})
export type ProgressEntry = z.infer<typeof ProgressEntry>
