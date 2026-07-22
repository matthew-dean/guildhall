import type { GuildSignals } from '../types.js'
import { detectFramework } from './frameworks.js'
import { hasStructuredSurface } from '../structured-signals.js'

export function applicable(signals: GuildSignals): boolean {
  // If the project has a detected frontend framework, the Frontend Engineer
  // is a plausible builder for any task — they may not be chosen, but they
  // are eligible.
  if (detectFramework(signals.projectPath)) return true
  if (signals.designSystem) return true
  return hasStructuredSurface(signals.task, 'component')
}
