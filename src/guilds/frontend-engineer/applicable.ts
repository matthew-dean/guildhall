import type { GuildSignals } from '../types.js'
import { detectFramework } from './frameworks.js'

const UI_KEYWORDS =
  /\b(component|primitive|ui|page|screen|route|button|form|modal|dialog|toast|nav|menu|layout|card|tooltip|popover|stack|row|grid|badge|icon|style)\b/i

export function applicable(signals: GuildSignals): boolean {
  // If the project has a detected frontend framework, the Frontend Engineer
  // is a plausible builder for any task — they may not be chosen, but they
  // are eligible.
  if (detectFramework(signals.projectPath)) return true
  // Otherwise, UI-shaped task text signals eligibility.
  if (signals.designSystem) return true
  const text = `${signals.task.title} ${signals.task.description}`
  return UI_KEYWORDS.test(text)
}
