import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  // Any task in a project that already has tests — the Test Engineer cares.
  const vitestCfg = join(signals.projectPath, 'vitest.config.ts')
  const jestCfg = join(signals.projectPath, 'jest.config.js')
  if (existsSync(vitestCfg) || existsSync(jestCfg)) return true
  return hasStructuredSurface(signals.task, 'testing')
}
