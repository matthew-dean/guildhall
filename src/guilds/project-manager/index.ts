import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { TaskStatus } from '@guildhall/core'
import type { GuildDefinition, GuildSignals } from '../types.js'
import { applicable } from './applicable.js'
import { PROJECT_MANAGER_RUBRIC } from './rubric.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
// Match the layout used by @guildhall/engineering-defaults: in dev/test the
// markdown sits alongside index.ts; in the esbuild bundle, build.mjs copies
// it to `dist/guilds/<slug>/…`, and MODULE_DIR collapses to `dist/`, so we
// try a nested path as well.
const CONTENT_CANDIDATES = [
  MODULE_DIR,
  join(MODULE_DIR, 'guilds', 'project-manager'),
]

function resolveAsset(relative: string): string | null {
  for (const base of CONTENT_CANDIDATES) {
    const p = join(base, relative)
    if (existsSync(p)) return p
  }
  return null
}

function readAsset(relative: string): string {
  const p = resolveAsset(relative)
  if (!p) return ''
  try {
    return readFileSync(p, 'utf8').trim()
  } catch {
    return ''
  }
}

const BASE_PRINCIPLES = readAsset('principles.md')

const STAGE_FILES: Record<TaskStatus, string> = {
  proposed: 'stages/proposed.md',
  exploring: 'stages/exploring.md',
  spec_review: 'stages/spec_review.md',
  ready: 'stages/ready.md',
  in_progress: 'stages/in_progress.md',
  review: 'stages/review.md',
  gate_check: 'stages/gate_check.md',
  pending_pr: 'stages/pending_pr.md',
  done: 'stages/done.md',
  shelved: 'stages/shelved.md',
  blocked: 'stages/blocked.md',
}

const stageCache = new Map<TaskStatus, string>()
function loadStagePlaybook(status: TaskStatus, memoryDir?: string): string {
  if (memoryDir) {
    const override = join(memoryDir, 'guilds', 'project-manager', 'stages', `${status}.md`)
    if (existsSync(override)) {
      try {
        return readFileSync(override, 'utf8').trim()
      } catch {
        // fall through
      }
    }
  }
  const cached = stageCache.get(status)
  if (cached !== undefined) return cached
  const body = readAsset(STAGE_FILES[status])
  stageCache.set(status, body)
  return body
}

export const projectManagerGuild: GuildDefinition = {
  slug: 'project-manager',
  name: 'The Project Manager',
  role: 'overseer',
  blurb:
    'Lifecycle discipline, clean handoffs, audit-trail obsession. Always at the table.',
  principles: BASE_PRINCIPLES,
  rubric: PROJECT_MANAGER_RUBRIC,
  deterministicChecks: [],
  applicable,
  specializePrinciples(signals: GuildSignals): string | null {
    const playbook = loadStagePlaybook(signals.task.status, signals.memoryDir)
    if (!playbook) return null
    return [
      BASE_PRINCIPLES,
      '',
      `**Playbook for status \`${signals.task.status}\`:**`,
      '',
      playbook,
    ].join('\n')
  },
}

/** Test helper — clear the stage playbook cache. */
export function __resetProjectManagerCache(): void {
  stageCache.clear()
}
