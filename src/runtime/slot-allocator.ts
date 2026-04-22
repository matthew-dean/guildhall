/**
 * FR-24: Runtime-resource slot allocation.
 *
 * When `runtime_isolation: slot_allocation` is active, each concurrently
 * dispatched worker claims an integer slot `0..capacity-1`. The slot drives
 * three injection paths:
 *
 *   1. `GUILDHALL_SLOT`, `GUILDHALL_PORT_BASE`, `GUILDHALL_ENV_PREFIX` env vars
 *      on the spawned worker (consumed by the project's build/dev scripts).
 *   2. `sharedEnv` from `guildhall.yaml` passed through unchanged.
 *   3. Agent system-prompt rule injection — the worker is *told* its slot, port
 *      base, and env prefix so it can synthesize project-specific vars without
 *      them being pre-enumerated.
 *
 * This module is pure policy: it allocates/releases slots, resolves port bases
 * and env prefixes from the config, and produces the env map + prompt rule.
 * The orchestrator owns the `SlotAllocator` lifecycle and consults this module
 * at dispatch time.
 *
 * Spec: FR-24, lever `runtime_isolation` (position `slot_allocation`).
 */
import type { ProjectLevers } from '@guildhall/levers'

export const DEFAULT_PORT_BASE = 7900
export const DEFAULT_PORT_STRIDE = 100
export const DEFAULT_ENV_PREFIX_TEMPLATE = 'GUILDHALL_W{slot}_'

/**
 * Workspace-level runtime-isolation config, sourced from `guildhall.yaml`
 * under `runtime:`. All fields optional — unset fields fall back to the
 * built-in defaults so a zero-config workspace still gets sensible slot
 * allocation when the lever is flipped.
 */
export interface RuntimeIsolationConfig {
  /** First slot's port base. Subsequent slots get `portBase + slot * portStride`. */
  portBase?: number
  /** Stride between slot port bases. */
  portStride?: number
  /**
   * Template used to build the per-slot env-var prefix. `{slot}` is replaced
   * by the slot number. Default: `GUILDHALL_W{slot}_`.
   */
  envVarPrefixTemplate?: string
  /**
   * Extra env vars passed through to every spawned worker regardless of slot.
   * Declared by the project in `guildhall.yaml` — things like service URLs,
   * test credentials, or feature flags that are identical across slots.
   */
  sharedEnv?: Record<string, string>
}

export interface Slot {
  index: number
  taskId: string
  portBase: number
  envVarPrefix: string
}

export interface ResolvedSlotEnv {
  GUILDHALL_SLOT: string
  GUILDHALL_PORT_BASE: string
  GUILDHALL_ENV_PREFIX: string
  [key: string]: string
}

export class SlotAllocator {
  private readonly slotsByTask = new Map<string, Slot>()
  private readonly taskBySlot = new Map<number, string>()

  constructor(
    public readonly capacity: number,
    private readonly config: RuntimeIsolationConfig = {},
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`SlotAllocator capacity must be a positive integer, got ${capacity}`)
    }
  }

  /**
   * Claim a slot for `taskId`. Returns `null` if all slots are in use.
   * Idempotent: claiming a slot for a taskId that already holds one returns
   * the existing allocation (protects against double-dispatch under retry).
   */
  allocate(taskId: string): Slot | null {
    const existing = this.slotsByTask.get(taskId)
    if (existing) return existing

    for (let i = 0; i < this.capacity; i++) {
      if (!this.taskBySlot.has(i)) {
        const slot: Slot = {
          index: i,
          taskId,
          portBase: resolvePortBase(i, this.config),
          envVarPrefix: resolveEnvPrefix(i, this.config),
        }
        this.slotsByTask.set(taskId, slot)
        this.taskBySlot.set(i, taskId)
        return slot
      }
    }
    return null
  }

  /** Release the slot held by `taskId`. No-op if the task holds no slot. */
  release(taskId: string): void {
    const slot = this.slotsByTask.get(taskId)
    if (!slot) return
    this.slotsByTask.delete(taskId)
    this.taskBySlot.delete(slot.index)
  }

  /** Slot currently held by `taskId`, or `undefined`. */
  getByTask(taskId: string): Slot | undefined {
    return this.slotsByTask.get(taskId)
  }

  /** Number of slots currently allocated. */
  get inUse(): number {
    return this.slotsByTask.size
  }

  /** Snapshot of allocated slot indexes. */
  slotsInUse(): Set<number> {
    return new Set(this.taskBySlot.keys())
  }
}

/** Pure: resolve the port base for a given slot from config. */
export function resolvePortBase(slot: number, config: RuntimeIsolationConfig = {}): number {
  const base = config.portBase ?? DEFAULT_PORT_BASE
  const stride = config.portStride ?? DEFAULT_PORT_STRIDE
  return base + slot * stride
}

/** Pure: resolve the env-var prefix for a given slot from config. */
export function resolveEnvPrefix(slot: number, config: RuntimeIsolationConfig = {}): string {
  const template = config.envVarPrefixTemplate ?? DEFAULT_ENV_PREFIX_TEMPLATE
  return template.replace(/\{slot\}/g, String(slot))
}

/**
 * Pure: build the env map handed to a spawned worker process for a slot.
 * Includes the three canonical `GUILDHALL_*` vars plus any `sharedEnv`
 * passthrough. Caller merges this on top of `process.env` at spawn time.
 */
export function buildSlotEnv(
  slot: Slot,
  config: RuntimeIsolationConfig = {},
): ResolvedSlotEnv {
  const shared = config.sharedEnv ?? {}
  return {
    ...shared,
    GUILDHALL_SLOT: String(slot.index),
    GUILDHALL_PORT_BASE: String(slot.portBase),
    GUILDHALL_ENV_PREFIX: slot.envVarPrefix,
  }
}

/**
 * Pure: compose the agent system-prompt rule that tells the worker its slot,
 * port base, and env prefix. The orchestrator appends this to the dispatched
 * prompt so the worker can synthesize project-specific env vars without them
 * being pre-enumerated by Guildhall.
 */
export function slotSystemPromptRule(slot: Slot): string {
  return [
    '## Runtime isolation (FR-24)',
    '',
    `Your worker slot is **${slot.index}**. Port base is **${slot.portBase}**.`,
    `If you need additional environment variables, prefix them with \`${slot.envVarPrefix}\`.`,
    `If you need ports, start incrementing from ${slot.portBase}.`,
    '',
    'Your workspace\'s build and dev scripts read `GUILDHALL_SLOT`, `GUILDHALL_PORT_BASE`,',
    'and `GUILDHALL_ENV_PREFIX` from your process env to pick non-clashing ports,',
    'database names, and container names.',
  ].join('\n')
}

/**
 * Decide whether runtime-isolation slot allocation is active, based on the
 * project-scope lever. Pure: no disk or env access. Used by the orchestrator
 * to decide whether to instantiate a `SlotAllocator`.
 */
export function isSlotAllocationEnabled(levers: Pick<ProjectLevers, 'runtime_isolation'>): boolean {
  return levers.runtime_isolation.position === 'slot_allocation'
}

/**
 * Decide the slot-allocator capacity based on the `concurrent_task_dispatch`
 * project lever. Pure. `serial` → 1, `fanout_N` → N.
 */
export function slotCapacityFromLever(
  levers: Pick<ProjectLevers, 'concurrent_task_dispatch'>,
): number {
  const pos = levers.concurrent_task_dispatch.position
  if (pos.kind === 'serial') return 1
  return pos.n
}

/**
 * Composite helper: compute the effective slot-allocator shape for a project.
 * Returns `{enabled, capacity}` so a caller can decide to instantiate an
 * allocator without needing to know the lever schema.
 *
 * A project with `runtime_isolation: none` still gets `enabled: false`
 * regardless of fanout — the orchestrator warns elsewhere (FR-24) when a
 * project runs fanout without isolation.
 */
export function resolveSlotShape(
  levers: Pick<ProjectLevers, 'runtime_isolation' | 'concurrent_task_dispatch'>,
): { enabled: boolean; capacity: number } {
  return {
    enabled: isSlotAllocationEnabled(levers),
    capacity: slotCapacityFromLever(levers),
  }
}
