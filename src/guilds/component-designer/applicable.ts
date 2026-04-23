import type { GuildSignals } from '../types.js'

/**
 * The Component Designer sits at the table when the task touches UI or a
 * design system exists. We keep the trigger broad — almost every UI change
 * risks introducing external-margin or token-bypass regressions, and it's
 * cheaper to invite the expert than to miss them.
 */
const UI_KEYWORDS =
  /\b(component|primitive|ui|page|screen|button|form|modal|dialog|toast|nav|menu|layout|card|tooltip|popover|stack|row|grid|cluster|icon|badge)\b/i

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem) return true
  const text = `${signals.task.title} ${signals.task.description}`
  if (UI_KEYWORDS.test(text)) return true
  if (signals.task.productBrief) return true
  return false
}
