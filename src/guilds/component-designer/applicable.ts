import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

/**
 * The Component Designer sits at the table when the task touches UI or a
 * design system exists. We keep the trigger broad — almost every UI change
 * risks introducing external-margin or token-bypass regressions, and it's
 * cheaper to invite the expert than to miss them.
 */
export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem) return true
  return hasStructuredSurface(signals.task, 'component')
}
