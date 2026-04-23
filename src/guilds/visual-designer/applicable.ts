import type { GuildSignals } from '../types.js'

const SURFACE_KEYWORDS =
  /\b(ui|page|screen|layout|design|spacing|typography|type|hierarchy|card|modal|nav|header|footer|grid|align|visual|theme)\b/i

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem) return true
  if (signals.task.productBrief) return true
  return SURFACE_KEYWORDS.test(
    `${signals.task.title} ${signals.task.description}`,
  )
}
