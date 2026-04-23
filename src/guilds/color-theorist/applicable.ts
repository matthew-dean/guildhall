import type { GuildSignals } from '../types.js'

const COLOR_KEYWORDS = /\b(color|palette|theme|token|dark mode|light mode|brand)\b/i

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem && signals.designSystem.tokens.color.length > 0) {
    return true
  }
  const text = `${signals.task.title} ${signals.task.description}`
  return COLOR_KEYWORDS.test(text)
}
