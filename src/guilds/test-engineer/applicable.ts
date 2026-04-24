import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'

const TEST_KEYWORDS = /\b(test|tests|spec|testing|vitest|jest|pytest|mocha|cypress|playwright|property|coverage)\b/i

export function applicable(signals: GuildSignals): boolean {
  // Any task in a project that already has tests — the Test Engineer cares.
  const vitestCfg = join(signals.projectPath, 'vitest.config.ts')
  const jestCfg = join(signals.projectPath, 'jest.config.js')
  if (existsSync(vitestCfg) || existsSync(jestCfg)) return true
  return TEST_KEYWORDS.test(`${signals.task.title} ${signals.task.description}`)
}
