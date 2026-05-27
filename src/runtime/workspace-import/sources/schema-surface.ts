import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { TaskSource, WorkspaceSignal } from '../types.js'

const IGNORE_PATH_RE = /(^|\/)(node_modules|\.git|dist|build|coverage|\.nuxt)(\/|$)/
const MAX_SQL_FILES = 80

function listSqlFiles(projectPath: string): string[] {
  const out: string[] = []
  const walk = (relDir: string) => {
    const absDir = join(projectPath, relDir)
    let entries
    try {
      entries = readdirSync(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (IGNORE_PATH_RE.test(rel)) continue
      if (entry.isDirectory()) {
        walk(rel)
      } else if (entry.isFile() && /\.sql$/i.test(entry.name)) {
        out.push(rel)
      }
      if (out.length >= MAX_SQL_FILES) return
    }
  }
  walk('')
  return out.sort((a, b) => a.localeCompare(b))
}

function extractNames(raw: string, re: RegExp): string[] {
  const names = new Set<string>()
  for (const match of raw.matchAll(re)) {
    const name = match[1]?.replace(/"/g, '').trim()
    if (name) names.add(name)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

function sourceReference(projectPath: string, rel: string): string {
  return join(projectPath, rel)
}

function compactList(values: readonly string[], max = 10): string {
  const visible = values.slice(0, max)
  const suffix = values.length > max ? `, +${values.length - max} more` : ''
  return `${visible.join(', ')}${suffix}`
}

export const schemaSurfaceSource: TaskSource = {
  id: 'schema-surface',
  label: 'Database schema surface',

  async detect({ projectPath }) {
    const relPaths = listSqlFiles(projectPath)
    if (relPaths.length === 0) return []

    const tables = new Set<string>()
    const functions = new Set<string>()
    const refs: string[] = []

    for (const rel of relPaths) {
      const abs = sourceReference(projectPath, rel)
      if (!existsSync(abs)) continue
      try {
        const st = statSync(abs)
        if (!st.isFile() || st.size > 1_000_000) continue
      } catch {
        continue
      }
      const raw = readFileSync(abs, 'utf-8')
      refs.push(abs)
      for (const name of extractNames(raw, /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[\w-]+"?\.)?("?[\w-]+"?)/gi)) {
        tables.add(name)
      }
      for (const name of extractNames(raw, /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?[\w-]+"?\.)?("?[\w-]+"?)/gi)) {
        functions.add(name)
      }
    }

    const tableList = [...tables].sort((a, b) => a.localeCompare(b))
    const functionList = [...functions].sort((a, b) => a.localeCompare(b))
    if (tableList.length === 0 && functionList.length === 0) return []

    const signals: WorkspaceSignal[] = [{
      source: 'schema-surface',
      kind: 'context',
      title: 'Database schema surface',
      evidence: `SQL migrations define tables: ${compactList(tableList)}${functionList.length ? `; functions: ${compactList(functionList)}` : ''}`,
      references: refs,
      confidence: 'high',
      domainHint: 'database',
    }]

    if (tables.has('software') && tables.has('projects')) {
      signals.push({
        source: 'schema-surface',
        kind: 'open_work',
        title: 'Resolve software/projects schema naming split',
        evidence: 'SQL migrations define both software and projects as product/listing entities.',
        references: refs.filter((ref) => {
          const rel = relative(projectPath, ref).replaceAll('\\', '/')
          return /migrations\//.test(rel)
        }),
        confidence: 'high',
        domainHint: 'database',
      })
    }

    if (tables.has('transactions') && tables.has('payments')) {
      signals.push({
        source: 'schema-surface',
        kind: 'open_work',
        title: 'Resolve transactions/payments schema split',
        evidence: 'SQL migrations define both transactions and payments for Stripe/payment records.',
        references: refs,
        confidence: 'high',
        domainHint: 'database',
      })
    }

    if (tables.has('eligibility_checks') || functions.has('check_user_eligibility')) {
      signals.push({
        source: 'schema-surface',
        kind: 'open_work',
        title: 'Wire eligibility checks through the application flow',
        evidence: 'SQL migrations already define eligibility checks or check_user_eligibility, so intake should track the app-facing feature.',
        references: refs,
        confidence: 'high',
        domainHint: 'backend',
      })
    }

    return signals
  },
}
