import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem && signals.designSystem.tokens.color.length > 0) {
    return hasStructuredSurface(signals.task, 'user_facing')
  }
  return false
}
