#!/usr/bin/env node

const DEFAULT_BASE_URL = 'http://localhost:7777'

export function parseArgs(argv) {
  const options = {
    baseUrl: process.env.GUILDHALL_URL || DEFAULT_BASE_URL,
    format: 'markdown',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--base-url') {
      options.baseUrl = argv[index + 1]
      index += 1
    } else if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length)
    } else if (arg === '--json') {
      options.format = 'json'
    } else if (arg === '--markdown') {
      options.format = 'markdown'
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return options
}

function usage() {
  return [
    'Usage: node scripts/project-orientation-spine-audit.mjs [--base-url http://localhost:7777] [--json|--markdown]',
    '',
    'Audits the running Guildhall service project orientation spine for every registered project.',
    'Use after pnpm dev:install, guildhall stop, guildhall start, and stale-server proof.',
  ].join('\n')
}

async function readJson(baseUrl, pathname) {
  const url = new URL(pathname, baseUrl)
  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`${url} returned ${response.status}${text ? `: ${text.slice(0, 240)}` : ''}`)
  }
  return response.json()
}

export function classifySpine(spine) {
  const summary = spine?.summary ?? {}
  const hasPurpose = Boolean(spine?.charter?.goal || summary.purpose)
  const included = Number(summary.includedWorkCount ?? summary.includedCount ?? 0)
  const roots = Array.isArray(spine?.roots) ? spine.roots.length : 0
  const pins = Array.isArray(spine?.activePins) ? spine.activePins.length : 0
  const gaps = Array.isArray(spine?.gaps) ? spine.gaps.length : 0
  const missingCharter = spine?.gaps?.some(gap => gap?.kind === 'missing_charter') ?? false

  if (!hasPurpose || missingCharter) return 'needs-intake'
  if (included >= 10 || roots >= 10 || pins >= 3) return 'rich-progressed'
  return gaps > 0 ? 'thin-with-gaps' : 'thin-honest'
}

export function summarizeSpine(project, spine) {
  const summary = spine?.summary ?? {}
  const progress = summary.progress ?? {}
  const roots = Array.isArray(spine?.roots) ? spine.roots : []
  const pins = Array.isArray(spine?.activePins) ? spine.activePins : []
  const gaps = Array.isArray(spine?.gaps) ? spine.gaps : []
  return {
    projectId: project.id,
    projectName: project.name ?? project.id,
    classification: classifySpine(spine),
    purpose: spine?.charter?.goal ?? summary.purpose ?? null,
    audience: spine?.charter?.targetAudience ?? null,
    scope: spine?.scope?.label ?? summary.selectedScopeLabel ?? null,
    includedWorkCount: summary.includedWorkCount ?? summary.includedCount ?? 0,
    deferredWorkCount: summary.deferredWorkCount ?? summary.deferredCount ?? 0,
    rootCount: roots.length,
    nodeCount: spine?.nodes ? Object.keys(spine.nodes).length : 0,
    pinCount: pins.length,
    gapCount: gaps.length,
    progress: {
      briefed: progress.briefed ?? 0,
      specced: progress.specced ?? 0,
      proven: progress.proven ?? 0,
      blocked: progress.blocked ?? 0,
    },
    topRoots: roots.slice(0, 5).map(root => ({
      title: root.title,
      maturity: root.maturity,
    })),
    pins: pins.slice(0, 5).map(pin => ({
      label: pin.label,
      kind: pin.kind,
    })),
    gaps: gaps.slice(0, 5).map(gap => ({
      kind: gap.kind,
      severity: gap.severity,
      label: gap.label,
    })),
  }
}

export function markdownTable(rows) {
  const lines = [
    '| Project | Class | Scope | Included | Roots | Pins | Gaps | Purpose |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const row of rows) {
    lines.push([
      row.projectName,
      row.classification,
      row.scope ?? '',
      row.includedWorkCount,
      row.rootCount,
      row.pinCount,
      row.gapCount,
      row.purpose ?? '',
    ].map(value => String(value).replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'))
  }
  return lines.join('\n')
}

export function renderMarkdown(rows, baseUrl) {
  const lines = [
    '# Project Orientation Spine Audit',
    '',
    `Source: ${baseUrl}`,
    '',
    markdownTable(rows),
  ]
  for (const row of rows) {
    lines.push('', `## ${row.projectName}`, '')
    lines.push(`- Classification: ${row.classification}`)
    lines.push(`- Audience: ${row.audience ?? 'not inferred'}`)
    lines.push(`- Progress: ${row.progress.briefed} briefed, ${row.progress.specced} specced, ${row.progress.proven} proven, ${row.progress.blocked} blocked`)
    if (row.topRoots.length > 0) {
      lines.push(`- Top roots: ${row.topRoots.map(root => `${root.title} (${root.maturity})`).join('; ')}`)
    }
    if (row.pins.length > 0) {
      lines.push(`- Pins: ${row.pins.map(pin => `${pin.label} (${pin.kind})`).join('; ')}`)
    }
    if (row.gaps.length > 0) {
      lines.push(`- Gaps: ${row.gaps.map(gap => `${gap.kind}: ${gap.label}`).join('; ')}`)
    }
  }
  return lines.join('\n')
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(usage())
    return
  }

  const service = await readJson(options.baseUrl, '/api/service/projects')
  const projects = Array.isArray(service.projects) ? service.projects : []
  const rows = []
  for (const project of projects) {
    const search = new URLSearchParams({ projectId: project.id })
    const body = await readJson(options.baseUrl, `/api/project/spine?${search.toString()}`)
    rows.push(summarizeSpine(project, body.spine))
  }

  if (options.format === 'json') {
    console.log(JSON.stringify({ source: options.baseUrl, projects: rows }, null, 2))
  } else {
    console.log(renderMarkdown(rows, options.baseUrl))
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
