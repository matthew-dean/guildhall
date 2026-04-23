import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'

const TS_KEYWORDS = /\b(typescript|tsc|types?|typed?|zod|schema|interface|generic)\b/i

export function applicable(signals: GuildSignals): boolean {
  // A project with a tsconfig is a TypeScript project; the TS Engineer cares.
  if (existsSync(join(signals.projectPath, 'tsconfig.json'))) return true
  const text = `${signals.task.title} ${signals.task.description}`
  return TS_KEYWORDS.test(text)
}
