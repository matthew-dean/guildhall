import { resolve } from 'node:path'
import { migrateProjectStateToSystem } from '@guildhall/sessions'
import { compactProjectState } from './project-state-compaction.js'

export const AUTOMATIC_PROJECT_STATE_COMPACTION_MIN_AGE_MS = 90 * 24 * 60 * 60 * 1000
export const PROJECT_STATE_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000

export interface ProjectStateMaintenance {
  ensureMaintained(projectRoot: string): Promise<void>
}

export function createProjectStateMaintenance(opts: {
  projectStatePlacement?: () => string | undefined
  now?: () => number
  maintenanceIntervalMs?: number
  terminalTaskMinAgeMs?: number
  migrateProjectState?: (projectRoot: string) => Promise<unknown>
  compactProjectState?: (input: {
    projectRoot: string
    dryRun: false
    terminalTaskMinAgeMs: number
  }) => Promise<unknown>
  warn?: (message: string) => void
} = {}): ProjectStateMaintenance {
  const migratedProjectStateRoots = new Set<string>()
  const projectStateMaintenanceLastRun = new Map<string, number>()
  const projectStatePlacement = opts.projectStatePlacement ?? (() => process.env.GUILDHALL_PROJECT_STATE_PLACEMENT)
  const now = opts.now ?? (() => Date.now())
  const maintenanceIntervalMs = opts.maintenanceIntervalMs ?? PROJECT_STATE_MAINTENANCE_INTERVAL_MS
  const terminalTaskMinAgeMs = opts.terminalTaskMinAgeMs ?? AUTOMATIC_PROJECT_STATE_COMPACTION_MIN_AGE_MS
  const migrateProjectState = opts.migrateProjectState ?? migrateProjectStateToSystem
  const compact = opts.compactProjectState ?? compactProjectState
  const warn = opts.warn ?? ((message: string) => console.warn(message))

  return {
    async ensureMaintained(projectRoot: string): Promise<void> {
      if (projectStatePlacement() === 'project') return
      const resolvedRoot = resolve(projectRoot)
      if (!migratedProjectStateRoots.has(resolvedRoot)) {
        await migrateProjectState(resolvedRoot)
        migratedProjectStateRoots.add(resolvedRoot)
      }
      const lastMaintenanceRun = projectStateMaintenanceLastRun.get(resolvedRoot)
      const currentTime = now()
      if (lastMaintenanceRun !== undefined && currentTime - lastMaintenanceRun < maintenanceIntervalMs) return
      await compact({
        projectRoot: resolvedRoot,
        dryRun: false,
        terminalTaskMinAgeMs,
      }).catch((err) => {
        warn(`[guildhall serve] project state compaction warning: ${err instanceof Error ? err.message : String(err)}`)
      })
      projectStateMaintenanceLastRun.set(resolvedRoot, currentTime)
    },
  }
}
