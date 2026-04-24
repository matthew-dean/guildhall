import type { GuildSignals } from '../types.js'

const UI_KEYWORDS =
  /\b(ui|page|screen|button|form|modal|dialog|toast|nav|menu|link|input|select|checkbox|radio|switch|tab|accordion|tooltip|popover|component|a11y|accessibility|contrast|aria|keyboard|focus)\b/i

export function applicable(signals: GuildSignals): boolean {
  // A design system exists: the Accessibility Specialist cares about the
  // contrast matrix even if this particular task doesn't touch UI, because
  // the check is free and catches systemic regressions early.
  if (signals.designSystem) return true
  const text = `${signals.task.title} ${signals.task.description}`
  if (UI_KEYWORDS.test(text)) return true
  if (signals.task.productBrief) return true
  return false
}
