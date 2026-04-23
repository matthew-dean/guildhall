import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'

const BACKEND_KEYWORDS =
  /\b(api|endpoint|handler|controller|server|backend|db|database|query|migration|schema|model|orm|sql|mongo|postgres|mysql|redis|queue|worker|cron|job|webhook|route)\b/i

/**
 * Heuristic: the project has a backend if `package.json` declares
 * server-ish dependencies OR the task text mentions backend concerns.
 */
const BACKEND_DEP_MARKERS = [
  'express',
  'fastify',
  'hono',
  'koa',
  '@nestjs/core',
  'next', // app-router API routes
  'remix',
  '@sveltejs/kit',
  'drizzle-orm',
  'prisma',
  'typeorm',
  'sequelize',
  'mongoose',
  'pg',
  'mysql2',
]

function projectHasBackendDeps(projectPath: string): boolean {
  const pkgPath = join(projectPath, 'package.json')
  if (!existsSync(pkgPath)) return false
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
    const deps = {
      ...(pkg.dependencies as Record<string, string> | undefined),
      ...(pkg.devDependencies as Record<string, string> | undefined),
      ...(pkg.peerDependencies as Record<string, string> | undefined),
    }
    return BACKEND_DEP_MARKERS.some((m) => m in deps)
  } catch {
    return false
  }
}

export function applicable(signals: GuildSignals): boolean {
  if (projectHasBackendDeps(signals.projectPath)) {
    return BACKEND_KEYWORDS.test(
      `${signals.task.title} ${signals.task.description}`,
    )
  }
  return BACKEND_KEYWORDS.test(
    `${signals.task.title} ${signals.task.description}`,
  )
}
