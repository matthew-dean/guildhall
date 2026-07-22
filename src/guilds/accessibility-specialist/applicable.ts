import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  // A design system exists: the Accessibility Specialist cares about the
  // contrast matrix even if this particular task doesn't touch UI, because
  // the check is free and catches systemic regressions early.
  if (signals.designSystem) return true
  return hasStructuredSurface(signals.task, 'component')
}
