import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GuildSignals } from '../types.js'
import { hasStructuredSurface } from '../structured-signals.js'

/**
 * A backend dependency is a project fact, but it does not make every task a
 * backend task. The task still needs an explicit domain or structured
 * contract/data signal.
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
  return projectHasBackendDeps(signals.projectPath) && hasStructuredSurface(signals.task, 'api')
}
