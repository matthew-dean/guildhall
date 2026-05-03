/**
 * FR-24 concurrent_task_dispatch. The lever has two positions:
 *
 *   • `serial`       — at most one task dispatched per tick (the classic loop).
 *   • `fanout_N`     — up to N tasks dispatched per tick, each on its own
 *                      worktree + slot.
 *
 * This module is purely the *selection* layer: given a queue, it returns up to
 * `capacity` actionable tasks that can be dispatched in the same tick without
 * colliding on id. The orchestrator is responsible for actually running them
 * (and for enforcing any additional isolation — worktrees per task, unique
 * slot allocation, etc.).
 *
 * Kept separate from `orchestrator.ts` so the picker logic is easy to unit-test
 * and the existing `pickNextTask` helper can remain a thin one-task convenience
 * wrapper over `pickNextTasks`.
 */

import type { Task, TaskQueue } from '@guildhall/core'
import type { ProjectLevers } from '@guildhall/levers'
import { pickNextTask, type TaskLane } from './orchestrator-picker.js'

export type FanoutCapacity = number

/**
 * Read the `concurrent_task_dispatch` lever and collapse it to an integer
 * capacity. `serial` → 1; `fanout_N` → N.
 */
export function resolveFanoutCapacity(project: ProjectLevers): FanoutCapacity {
  const pos = project.concurrent_task_dispatch.position
  if (pos.kind === 'serial') return 1
  return pos.n
}

export interface PickNextTasksInput {
  queue: TaskQueue
  capacity: FanoutCapacity
  laneCapacities?: Partial<Record<TaskLane, number>>
  domainFilter?: string
  /**
   * Ids already in flight (or claimed by an earlier pass in the same tick).
   * Those tasks are skipped during selection so the caller never dispatches
   * two workers onto the same task.
   */
  excludeIds?: ReadonlySet<string>
}

/**
 * Pick up to `capacity` actionable tasks in priority order. Each call to
 * `pickNextTask` uses a growing exclusion set so consecutive picks return
 * distinct tasks without an O(N²) full-queue re-scan.
 *
 * Order matters: the first result would also be the single task returned by
 * `pickNextTask` on its own — callers relying on the serial path get identical
 * behavior when `capacity === 1`.
 */
export function pickNextTasks(input: PickNextTasksInput): Task[] {
  const excluded = new Set(input.excludeIds ?? [])
  const laneCaps = input.laneCapacities
  const picks: Task[] = []
  if (laneCaps) {
    const remainingByLane: Record<TaskLane, number> = {
      review: Math.max(0, Math.floor(laneCaps.review ?? 0)),
      worker: Math.max(0, Math.floor(laneCaps.worker ?? 0)),
      coordinator: Math.max(0, Math.floor(laneCaps.coordinator ?? 0)),
      spec: Math.max(0, Math.floor(laneCaps.spec ?? 0)),
    }
    const laneOrder: TaskLane[] = ['review', 'worker', 'coordinator', 'spec']
    let madeProgress = true
    while (picks.length < input.capacity && madeProgress) {
      madeProgress = false
      for (const lane of laneOrder) {
        if (picks.length >= input.capacity) break
        if (remainingByLane[lane] <= 0) continue
        const next = pickNextTask(input.queue, input.domainFilter, excluded, lane)
        if (!next) continue
        picks.push(next)
        excluded.add(next.id)
        remainingByLane[lane] -= 1
        madeProgress = true
      }
    }
    return picks
  }
  for (let i = 0; i < input.capacity; i++) {
    const next = pickNextTask(input.queue, input.domainFilter, excluded)
    if (!next) break
    picks.push(next)
    excluded.add(next.id)
  }
  return picks
}
