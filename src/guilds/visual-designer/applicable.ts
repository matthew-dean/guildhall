import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem) return true
  return hasStructuredSurface(signals.task, 'user_facing')
}
