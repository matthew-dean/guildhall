import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  return hasStructuredSurface(signals.task, 'api')
}
