import type { GuildSignals } from '../types.js'

/**
 * The Project Manager always sits at the table. Every task has a lifecycle,
 * every lifecycle has transitions, and every transition needs a clean
 * handoff — no exceptions.
 */
export function applicable(_signals: GuildSignals): boolean {
  return true
}
