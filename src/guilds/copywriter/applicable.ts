import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  if (hasStructuredSurface(signals.task, 'user_facing') || hasStructuredSurface(signals.task, 'documentation')) return true

  if (signals.designSystem?.copyVoice) {
    // Copy voice authored → the Copywriter cares any time there's a surface.
    if (signals.designSystem.copyVoice.bannedTerms.length > 0) return true
    if (signals.designSystem.copyVoice.preferredTerms.length > 0) return true
    if (signals.designSystem.copyVoice.tone !== 'plain') return true
  }
  return false
}
