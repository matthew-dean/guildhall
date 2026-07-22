import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'

export function applicable(signals: GuildSignals): boolean {
  // A project with a tsconfig is a TypeScript project; the TS Engineer cares.
  if (existsSync(join(signals.projectPath, 'tsconfig.json'))) return true
  return false
}
