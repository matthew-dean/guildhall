import { describe, expect, it, vi } from 'vitest'
import { createProjectStateMaintenance } from '../project-state-maintenance.js'

describe('createProjectStateMaintenance', () => {
  it('migrates once and compacts on the runtime maintenance cadence', async () => {
    let now = 1_000
    const migrateProjectState = vi.fn(async () => undefined)
    const compactProjectState = vi.fn(async () => undefined)
    const maintenance = createProjectStateMaintenance({
      now: () => now,
      maintenanceIntervalMs: 10_000,
      terminalTaskMinAgeMs: 90_000,
      migrateProjectState,
      compactProjectState,
    })

    await maintenance.ensureMaintained('/tmp/project')
    await maintenance.ensureMaintained('/tmp/project')
    now += 10_000
    await maintenance.ensureMaintained('/tmp/project')

    expect(migrateProjectState).toHaveBeenCalledTimes(1)
    expect(compactProjectState).toHaveBeenCalledTimes(2)
    expect(compactProjectState).toHaveBeenLastCalledWith({
      projectRoot: '/tmp/project',
      dryRun: false,
      terminalTaskMinAgeMs: 90_000,
    })
  })

  it('skips maintenance when project-local state placement is explicitly enabled', async () => {
    const migrateProjectState = vi.fn(async () => undefined)
    const compactProjectState = vi.fn(async () => undefined)
    const maintenance = createProjectStateMaintenance({
      projectStatePlacement: () => 'project',
      migrateProjectState,
      compactProjectState,
    })

    await maintenance.ensureMaintained('/tmp/project')

    expect(migrateProjectState).not.toHaveBeenCalled()
    expect(compactProjectState).not.toHaveBeenCalled()
  })
})
