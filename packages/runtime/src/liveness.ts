/**
 * FR-30 Agent liveness via event-stream silence.
 *
 * The orchestrator's view of "is this agent alive?" is purely a function of
 * the FR-16 event stream emitted by the agent's QueryEngine: any event the
 * agent emits (`tool_started`, `tool_completed`, `assistant_delta`,
 * `task_transition`, `agent_issue`, …) renews the liveness timestamp. There
 * is NO separate heartbeat file and NO polling channel — silence IS the
 * signal.
 *
 * This module is the pure-policy half of the feature: feed it event
 * timestamps via `touch()` and ask it `scanStalls(now)` to get stall flags.
 * The orchestrator owns the integration (register on start, touch from the
 * wire-events emitter, unregister on agent exit) but doesn't own the
 * threshold math or the stall data shape — those live here so they can be
 * tested without spinning up a workspace.
 *
 * Stall flags are INPUTS to the FR-32 coordinator remediation loop. A stall
 * does NOT by itself restart the agent — the coordinator decides.
 */

import type { ProjectLevers } from '@guildhall/levers'

export type AgentHealthStrictness =
  ProjectLevers['agent_health_strictness']['position']

/**
 * FR-30 thresholds are fixed by the spec, not tunable per-project beyond
 * the lever's three named positions. Expressed in milliseconds so callers
 * can pass a numeric clock without unit conversion.
 */
export const STALL_THRESHOLD_MS: Record<AgentHealthStrictness, number> = {
  lax: 5 * 60 * 1000, // 5 minutes
  standard: 2 * 60 * 1000, // 2 minutes
  strict: 45 * 1000, // 45 seconds
}

export function thresholdMs(strictness: AgentHealthStrictness): number {
  return STALL_THRESHOLD_MS[strictness]
}

/**
 * A single registered agent's liveness state. `lastEventAt` is an epoch-ms
 * timestamp (not ISO) because all the arithmetic this module does is
 * numeric; the ISO form is an observability concern for the caller.
 */
export interface LivenessEntry {
  agentId: string
  taskId: string
  lastEventAt: number
}

/**
 * A stall flag produced by `scanStalls`. The coordinator's remediation loop
 * (FR-32) consumes these; renderers surface them in the UI. Note that a
 * stall flag alone is not a crash — the agent may still be alive but
 * blocked on e.g. a long-running subprocess. The coordinator decides what
 * (if anything) to do about it.
 */
export interface StallFlag {
  agentId: string
  taskId: string
  lastEventAt: number
  silentMs: number
  strictness: AgentHealthStrictness
}

export interface LivenessTrackerOptions {
  /** Initial strictness; can be updated via `setStrictness`. */
  strictness: AgentHealthStrictness
  /** Optional clock for deterministic tests. Defaults to Date.now(). */
  now?: () => number
}

export class LivenessTracker {
  private entries = new Map<string, LivenessEntry>()
  private strictness: AgentHealthStrictness
  private readonly now: () => number

  constructor(opts: LivenessTrackerOptions) {
    this.strictness = opts.strictness
    this.now = opts.now ?? (() => Date.now())
  }

  /**
   * Start tracking an agent. Registration resets the liveness clock even if
   * the same agent was previously tracked on a different task — the agent
   * is logically a fresh session from the orchestrator's perspective.
   */
  register(agentId: string, taskId: string): void {
    this.entries.set(agentId, {
      agentId,
      taskId,
      lastEventAt: this.now(),
    })
  }

  /**
   * An agent emitted an event. Reset its liveness clock. A touch for an
   * unregistered agent is silently ignored — the spec says events renew
   * existing liveness, not that every event registers a new agent.
   */
  touch(agentId: string): void {
    const entry = this.entries.get(agentId)
    if (entry) entry.lastEventAt = this.now()
  }

  /**
   * Stop tracking an agent (clean exit, task completion, etc.). Idempotent.
   */
  unregister(agentId: string): void {
    this.entries.delete(agentId)
  }

  /** Update the stall threshold, e.g. after a live lever change. */
  setStrictness(strictness: AgentHealthStrictness): void {
    this.strictness = strictness
  }

  /** Currently registered agents. Useful for UIs and tests. */
  snapshot(): LivenessEntry[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e }))
  }

  /**
   * Return stall flags for all tracked agents whose last event is older
   * than the threshold. Does not mutate state: a stalled agent remains
   * tracked (and therefore continues to be flagged on subsequent scans)
   * until the coordinator takes explicit action to clear it.
   */
  scanStalls(nowOverride?: number): StallFlag[] {
    const now = nowOverride ?? this.now()
    const threshold = thresholdMs(this.strictness)
    const flags: StallFlag[] = []
    for (const entry of this.entries.values()) {
      const silent = now - entry.lastEventAt
      if (silent >= threshold) {
        flags.push({
          agentId: entry.agentId,
          taskId: entry.taskId,
          lastEventAt: entry.lastEventAt,
          silentMs: silent,
          strictness: this.strictness,
        })
      }
    }
    return flags
  }
}
