/**
 * Engineering defaults — the "invisible best-practices floor" injected into
 * every agent's system prompt so agents produce high-quality, maintainable
 * code even when the user has not explicitly documented conventions.
 *
 * Content lives as markdown in this directory (one file per topic) so it is
 * human-readable, easy to edit, and can later be shadowed per-project by
 * `memory/engineering-defaults/*.md` if the user wants to override.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const CONTENT_DIR = join(MODULE_DIR, 'engineering-defaults')

export type EngineeringDefaultTopic =
  | 'voice'
  | 'coding'
  | 'testing'
  | 'frontend'
  | 'git'
  | 'security'
  | 'dependencies'
  | 'architecture'
  | 'documentation'
  | 'review'

const ALL_TOPICS: readonly EngineeringDefaultTopic[] = [
  'voice',
  'coding',
  'testing',
  'frontend',
  'git',
  'security',
  'dependencies',
  'architecture',
  'documentation',
  'review',
]

export interface EngineeringDefault {
  topic: EngineeringDefaultTopic
  content: string
}

let cached: readonly EngineeringDefault[] | null = null

export function loadEngineeringDefaults(): readonly EngineeringDefault[] {
  if (cached) return cached
  if (!existsSync(CONTENT_DIR)) {
    cached = []
    return cached
  }
  const files = readdirSync(CONTENT_DIR).filter((n) => n.endsWith('.md')).sort()
  const defaults: EngineeringDefault[] = []
  for (const file of files) {
    const topic = file.replace(/\.md$/, '') as EngineeringDefaultTopic
    if (!ALL_TOPICS.includes(topic)) continue
    const content = readFileSync(join(CONTENT_DIR, file), 'utf8').trim()
    defaults.push({ topic, content })
  }
  cached = defaults
  return cached
}

/**
 * Append the engineering-defaults block to a base system prompt.
 *
 * `topics` selects which files to include (default: all). Reviewer / gate-
 * checker roles get the full set so they can enforce it; worker / spec /
 * coordinator get it as a floor to aim for.
 */
export function composeSystemPromptWithDefaults(
  basePrompt: string,
  topics: readonly EngineeringDefaultTopic[] = ALL_TOPICS,
): string {
  const defaults = loadEngineeringDefaults().filter((d) => topics.includes(d.topic))
  if (defaults.length === 0) return basePrompt
  const blocks: string[] = [
    basePrompt.trimEnd(),
    '',
    '---',
    '',
    '# Engineering defaults',
    '',
    'The rules below are the invisible floor every project inherits. Follow them unless the project explicitly overrides them in `memory/engineering-defaults/*.md`. If you are unsure whether an override applies, prefer the rule here.',
    '',
  ]
  for (const def of defaults) {
    blocks.push(def.content.trim())
    blocks.push('')
    blocks.push('---')
    blocks.push('')
  }
  while (blocks.length > 0 && (blocks[blocks.length - 1] === '---' || blocks[blocks.length - 1] === '')) {
    blocks.pop()
  }
  return blocks.join('\n')
}
