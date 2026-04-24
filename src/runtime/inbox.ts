/**
 * Coordinator inbox aggregator.
 *
 * The inbox is the prioritized queue of things the coordinator needs the
 * human to resolve right now. It sources exclusively from files already on
 * disk — `guildhall.yaml`, `memory/TASKS.json`, `memory/agent-settings.yaml`,
 * and a handful of workspace-signal files — so the endpoint is cheap enough
 * to poll and deterministic enough to snapshot in tests.
 *
 * Item ordering: severity (high → medium → low), then the kind enumeration
 * order declared by KIND_ORDER.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItem =
  | { kind: 'bootstrap_missing'; severity: 'high'; title: string; detail: string; actionHref?: string }
  | { kind: 'workspace_import_pending'; severity: 'high'; title: string; detail: string; signals: string[]; actionHref: string }
  | { kind: 'brief_approval'; severity: 'medium'; taskId: string; title: string; detail: string; actionHref: string }
  | { kind: 'spec_approval'; severity: 'medium'; taskId: string; title: string; detail: string; actionHref: string }
  | { kind: 'open_escalation'; severity: 'high'; taskId: string; escalationId: string; title: string; detail: string; actionHref: string }
  | { kind: 'lever_questions'; severity: 'low'; title: string; detail: string; defaultCount: number; actionHref: string }

export interface BuildInboxOptions {
  projectPath: string
}

const KIND_ORDER: Record<InboxItem['kind'], number> = {
  bootstrap_missing: 0,
  workspace_import_pending: 1,
  open_escalation: 2,
  brief_approval: 3,
  spec_approval: 4,
  lever_questions: 5,
}

const SEVERITY_ORDER: Record<InboxSeverity, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function truncateTitle(title: string, max = 80): string {
  if (title.length <= max) return title
  return title.slice(0, max - 1).trimEnd() + '…'
}

function readJsonSafe(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function readYamlSafe(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function detectWorkspaceSignals(projectPath: string): string[] {
  const candidates = [
    'README.md',
    'pnpm-workspace.yaml',
    'package.json',
    'packages',
    'skills',
    'ROADMAP.md',
  ]
  return candidates.filter(name => existsSync(join(projectPath, name)))
}

function tasksArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>
  if (raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)) {
    return (raw as { tasks: Array<Record<string, unknown>> }).tasks
  }
  return []
}

export function buildInbox(opts: BuildInboxOptions): InboxItem[] {
  const { projectPath } = opts
  const items: InboxItem[] = []

  // --- bootstrap_missing ---------------------------------------------------
  const yamlPath = join(projectPath, 'guildhall.yaml')
  if (existsSync(yamlPath)) {
    const cfg = readYamlSafe(yamlPath) as
      | { bootstrap?: { install?: unknown; gates?: unknown; commands?: unknown; successGates?: unknown } }
      | null
    const b = cfg?.bootstrap
    const hasInstall =
      (Array.isArray(b?.install) && b!.install.length > 0) ||
      (Array.isArray(b?.commands) && b!.commands.length > 0)
    const hasGates =
      (Array.isArray(b?.gates) && b!.gates.length > 0) ||
      (Array.isArray(b?.successGates) && b!.successGates.length > 0)
    if (!b || !hasInstall || !hasGates) {
      items.push({
        kind: 'bootstrap_missing',
        severity: 'high',
        title: 'Bootstrap incomplete',
        detail:
          'No verified install/gate commands in guildhall.yaml — agents run against an unverified environment.',
        actionHref: '/settings/ready',
      })
    }
  }

  // --- workspace_import_pending --------------------------------------------
  const goalsPath = join(projectPath, 'memory', 'workspace-goals.json')
  const hasGoals = existsSync(goalsPath)
  const signals = detectWorkspaceSignals(projectPath)
  const hasReadme = signals.includes('README.md')
  const hasAnchor =
    signals.includes('pnpm-workspace.yaml') ||
    signals.includes('package.json') ||
    signals.includes('packages') ||
    signals.includes('skills') ||
    signals.includes('ROADMAP.md')
  if (!hasGoals && hasReadme && hasAnchor) {
    items.push({
      kind: 'workspace_import_pending',
      severity: 'high',
      title: 'Workspace not scanned',
      detail: 'README + packages found but no proposals imported.',
      signals,
      actionHref: '/workspace-import',
    })
  }

  // --- tasks: briefs / specs / escalations ---------------------------------
  const tasksPath = join(projectPath, 'memory', 'TASKS.json')
  const tasks = tasksArray(readJsonSafe(tasksPath))
  for (const t of tasks) {
    const id = typeof t.id === 'string' ? t.id : ''
    const title = typeof t.title === 'string' ? t.title : id
    if (!id) continue

    const brief = t.productBrief as { approvedAt?: unknown } | undefined
    if (brief && typeof brief === 'object' && !brief.approvedAt) {
      items.push({
        kind: 'brief_approval',
        severity: 'medium',
        taskId: id,
        title: truncateTitle(title),
        detail: 'Brief awaiting approval.',
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }

    if (t.status === 'spec_review') {
      items.push({
        kind: 'spec_approval',
        severity: 'medium',
        taskId: id,
        title: truncateTitle(title),
        detail: 'Spec awaiting approval.',
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }

    const escalations = Array.isArray(t.escalations)
      ? (t.escalations as Array<Record<string, unknown>>)
      : []
    for (const esc of escalations) {
      if (esc.resolvedAt) continue
      const escId = typeof esc.id === 'string' ? esc.id : ''
      const summary =
        typeof esc.summary === 'string' && esc.summary.trim()
          ? esc.summary
          : typeof esc.reason === 'string'
            ? esc.reason
            : 'Agent escalation awaiting human input.'
      items.push({
        kind: 'open_escalation',
        severity: 'high',
        taskId: id,
        escalationId: escId,
        title: truncateTitle(title),
        detail: summary,
        actionHref: '/task/' + encodeURIComponent(id),
      })
    }
  }

  // --- lever_questions -----------------------------------------------------
  const settingsPath = join(projectPath, 'memory', 'agent-settings.yaml')
  if (existsSync(settingsPath)) {
    const raw = readYamlSafe(settingsPath) as
      | {
          project?: Record<string, { setBy?: unknown }>
          domains?: { default?: Record<string, { setBy?: unknown }> }
        }
      | null
    let defaultCount = 0
    const countBucket = (bucket: Record<string, { setBy?: unknown }> | undefined) => {
      if (!bucket || typeof bucket !== 'object') return
      for (const entry of Object.values(bucket)) {
        if (entry && typeof entry === 'object' && entry.setBy === 'system-default') {
          defaultCount += 1
        }
      }
    }
    countBucket(raw?.project)
    countBucket(raw?.domains?.default)
    if (defaultCount > 0) {
      items.push({
        kind: 'lever_questions',
        severity: 'low',
        title: `${defaultCount} levers at system defaults`,
        detail: 'Policy positions not yet confirmed for this project.',
        defaultCount,
        actionHref: '/settings/advanced',
      })
    }
  }

  // --- stable sort ---------------------------------------------------------
  items.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sev !== 0) return sev
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  })

  return items
}
