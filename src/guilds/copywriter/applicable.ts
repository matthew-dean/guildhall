import type { GuildSignals } from '../types.js'

const COPY_KEYWORDS =
  /\b(copy|text|label|message|error|empty state|onboard|tooltip|notification|toast|heading|content|microcopy|voice|tone|i18n|localization|translation)\b/i

export function applicable(signals: GuildSignals): boolean {
  if (signals.designSystem?.copyVoice) {
    // Copy voice authored → the Copywriter cares any time there's a surface.
    if (signals.task.productBrief) return true
    if (signals.designSystem.copyVoice.bannedTerms.length > 0) return true
    if (signals.designSystem.copyVoice.preferredTerms.length > 0) return true
    if (signals.designSystem.copyVoice.tone !== 'plain') return true
  }
  return COPY_KEYWORDS.test(
    `${signals.task.title} ${signals.task.description}`,
  )
}
