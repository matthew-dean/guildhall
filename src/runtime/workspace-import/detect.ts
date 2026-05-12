import type { TaskSource, TaskSourceContext, WorkspaceSignal } from './types.js'
import { readmeSource } from './sources/readme.js'
import { agentsMdSource } from './sources/agents-md.js'
import { roadmapSource } from './sources/roadmap.js'
import { planningDocsSource } from './sources/planning-docs.js'
import { todoCommentsSource } from './sources/todo-comments.js'
import { gitLogSource } from './sources/git-log.js'

/**
 * Built-in task sources, in the order their signals appear in inventory
 * previews. Callers wanting to add a Jira/Linear/GitHub source pass it via
 * `extraSources` in `detectWorkspaceSignals`.
 */
export const BUILTIN_TASK_SOURCES: readonly TaskSource[] = [
  readmeSource,
  agentsMdSource,
  roadmapSource,
  planningDocsSource,
  gitLogSource,
  todoCommentsSource,
]

export interface DetectWorkspaceOptions {
  projectPath: string
  /** Additional sources appended to the built-in set. */
  extraSources?: readonly TaskSource[]
  /** Subset of source ids to run. Default: all built-ins + extras. */
  only?: readonly string[]
  /** Injected exec (tests). Forwarded to every source that shells out. */
  exec?: TaskSourceContext['exec']
}

export interface WorkspaceInventory {
  signals: readonly WorkspaceSignal[]
  bySource: Record<string, readonly WorkspaceSignal[]>
  /** Which sources ran; useful for the dashboard preview. */
  ran: readonly string[]
  /** Sources that threw — rare, but surfaced for diagnostics. */
  failed: readonly { id: string; error: string }[]
}

/**
 * Runs all configured sources in parallel and returns a flat inventory.
 * Sources that throw are captured in `failed` but never abort the batch —
 * one broken source (e.g. git unavailable) must not starve the rest.
 */
export async function detectWorkspaceSignals(
  opts: DetectWorkspaceOptions,
): Promise<WorkspaceInventory> {
  const sources = [...BUILTIN_TASK_SOURCES, ...(opts.extraSources ?? [])]
  const selected = opts.only
    ? sources.filter((s) => opts.only!.includes(s.id))
    : sources

  const ctx: TaskSourceContext = {
    projectPath: opts.projectPath,
    ...(opts.exec ? { exec: opts.exec } : {}),
  }

  const results = await Promise.all(
    selected.map(async (source) => {
      try {
        const signals = await source.detect(ctx)
        return { source, signals, error: undefined as string | undefined }
      } catch (err) {
        return {
          source,
          signals: [] as readonly WorkspaceSignal[],
          error: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )

  const bySource: Record<string, readonly WorkspaceSignal[]> = {}
  const failed: { id: string; error: string }[] = []
  const flat: WorkspaceSignal[] = []
  for (const r of results) {
    bySource[r.source.id] = r.signals
    if (r.error) failed.push({ id: r.source.id, error: r.error })
    flat.push(...r.signals)
  }

  return {
    signals: flat,
    bySource,
    ran: selected.map((s) => s.id),
    failed,
  }
}
