import type { GuildDefinition, GuildSignals } from '../types.js'
import { loadGuildAsset } from '../load-asset.js'
import { applicable } from './applicable.js'
import { FRONTEND_ENGINEER_RUBRIC } from './rubric.js'
import { detectFramework, frameworkLayer } from './frameworks.js'

const BASE_PRINCIPLES = loadGuildAsset({
  importMetaUrl: import.meta.url,
  slug: 'frontend-engineer',
  relative: 'principles.md',
})

export const frontendEngineerGuild: GuildDefinition = {
  slug: 'frontend-engineer',
  name: 'The Frontend Engineer',
  role: 'engineer',
  blurb:
    'Builds UI to spec using the project\'s framework idiomatically. Detects Vue / React / Svelte / Solid / Angular.',
  principles: BASE_PRINCIPLES,
  rubric: FRONTEND_ENGINEER_RUBRIC,
  deterministicChecks: [],
  applicable,
  specializePrinciples(signals: GuildSignals): string | null {
    const framework = detectFramework(signals.projectPath)
    const layer = frameworkLayer(framework)
    if (!layer) return null
    return [BASE_PRINCIPLES, '', layer].join('\n')
  },
}

export { detectFramework, frameworkLayer } from './frameworks.js'
