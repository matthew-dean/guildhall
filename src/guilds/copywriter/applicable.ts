import type { GuildSignals } from '../types.js'

const COPY_KEYWORDS =
  /\b(copy|text|label|message|error|empty state|onboard|tooltip|notification|toast|heading|content|microcopy|voice|tone|i18n|localization|translation)\b/i

const USER_FACING_SURFACE_KEYWORDS =
  /\b(ui|ux|frontend|front-end|web|page|screen|view|route|component|primitive|button|form|input|select|modal|dialog|drawer|toast|nav|menu|toolbar|sidebar|rail|layout|card|tooltip|popover|badge|chip|icon|settings|onboarding|workspace import|release notes?|changelog|docs?|documentation|guide|readme|markdown|mdx|vitepress|docusaurus|website|homepage|landing page|screenshot)\b/i

const USER_FACING_DOMAINS = new Set([
  'content',
  'design',
  'docs',
  'documentation',
  'frontend',
  'marketing',
  'product',
  'ui',
  'ux',
  'web',
])

function textFor(signals: GuildSignals): string {
  const task = signals.task
  return [
    task.title,
    task.description,
    task.spec,
    ...task.acceptanceCriteria.map((criterion) => criterion.description),
    ...task.notes.map((note) => note.content),
  ]
    .filter(Boolean)
    .join('\n')
}

function touchesUserFacingSurface(signals: GuildSignals): boolean {
  const domain = signals.task.domain.toLowerCase()
  if (USER_FACING_DOMAINS.has(domain)) return true
  return USER_FACING_SURFACE_KEYWORDS.test(textFor(signals))
}

export function applicable(signals: GuildSignals): boolean {
  if (touchesUserFacingSurface(signals)) return true

  if (signals.designSystem?.copyVoice) {
    // Copy voice authored → the Copywriter cares any time there's a surface.
    if (signals.task.productBrief) return true
    if (signals.designSystem.copyVoice.bannedTerms.length > 0) return true
    if (signals.designSystem.copyVoice.preferredTerms.length > 0) return true
    if (signals.designSystem.copyVoice.tone !== 'plain') return true
  }
  return COPY_KEYWORDS.test(textFor(signals))
}
