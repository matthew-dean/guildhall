/**
 * Coordinator inbox aggregator — one test per item kind plus empty state and
 * severity-ordering. The aggregator reads files directly (no server), so we
 * just stamp fixtures into a tmpdir and assert on the returned items.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { stringify as stringifyYaml } from 'yaml'

import { buildInbox } from '../inbox.js'

let tmpDir: string
let memoryDir: string

async function writeYaml(rel: string, value: unknown): Promise<void> {
  const p = path.join(tmpDir, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, stringifyYaml(value), 'utf8')
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  const p = path.join(tmpDir, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(value, null, 2), 'utf8')
}

async function writeFile(rel: string, contents: string): Promise<void> {
  const p = path.join(tmpDir, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, contents, 'utf8')
}

/** A minimal, schema-valid agent-settings.yaml with every entry system-default. */
function fullSystemDefaultSettings(): unknown {
  const now = new Date().toISOString()
  const entry = (position: unknown) => ({
    position,
    rationale: 'seeded default',
    setAt: now,
    setBy: 'system-default',
  })
  return {
    version: 1,
    project: {
      concurrent_task_dispatch: entry({ kind: 'serial' }),
      worktree_isolation: entry('none'),
      merge_policy: entry('ff_only_local'),
      rejection_dampening: entry({ kind: 'off' }),
      business_envelope_strictness: entry('advisory'),
      agent_health_strictness: entry('standard'),
      remediation_autonomy: entry('confirm_destructive'),
      runtime_isolation: entry('none'),
      workspace_import_autonomy: entry('suggest'),
    },
    domains: {
      default: {
        task_origination: entry('agent_proposed_human_approved'),
        spec_completeness: entry('stage_appropriate'),
        pre_rejection_policy: entry('requeue_lower_priority'),
        completion_approval: entry('human_required'),
        reviewer_mode: entry('llm_with_deterministic_fallback'),
        reviewer_fanout_policy: entry('strict'),
        max_revisions: entry(3),
        escalation_on_ambiguity: entry('coordinator_first'),
        crash_recovery_default: entry('prefer_resume'),
      },
      overrides: {},
    },
  }
}

/** guildhall.yaml with a complete bootstrap block (install + gates). */
async function writeCompleteBootstrap(): Promise<void> {
  await writeYaml('guildhall.yaml', {
    name: 'Inbox Test',
    id: 'inbox-test',
    coordinators: [],
    bootstrap: {
      install: ['pnpm install'],
      gates: ['pnpm typecheck'],
    },
  })
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-inbox-'))
  memoryDir = path.join(tmpDir, 'memory')
  await fs.mkdir(memoryDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('buildInbox', () => {
  it('empty state: complete bootstrap, no tasks, no workspace signals, no default levers → no items', async () => {
    await writeCompleteBootstrap()
    // Suppress workspace-import: also write workspace-goals.json so the check
    // short-circuits before we look at signal files.
    await writeJson('memory/workspace-goals.json', { goals: [] })
    // An agent-settings.yaml with no system-defaults: mark every entry as
    // user-direct so lever_questions doesn't trip.
    const userSet = fullSystemDefaultSettings() as {
      project: Record<string, { setBy: string }>
      domains: { default: Record<string, { setBy: string }> }
    }
    for (const e of Object.values(userSet.project)) e.setBy = 'user-direct'
    for (const e of Object.values(userSet.domains.default)) e.setBy = 'user-direct'
    await writeYaml('memory/agent-settings.yaml', userSet)
    await writeJson('memory/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items).toEqual([])
  })

  it('bootstrap_missing: emitted when guildhall.yaml has no bootstrap block', async () => {
    await writeYaml('guildhall.yaml', { name: 'x', id: 'x', coordinators: [] })
    await writeJson('memory/workspace-goals.json', { goals: [] })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'bootstrap_missing')
    expect(hit).toBeDefined()
    if (!hit) throw new Error('unreachable')
    expect(hit.severity).toBe('high')
    expect(hit.actionHref).toBe('/settings/ready')
  })

  it('workspace_import_pending: emitted when README + package.json present but goals file missing', async () => {
    await writeCompleteBootstrap()
    await writeFile('README.md', '# hello')
    await writeFile('package.json', '{}')

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'workspace_import_pending')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'workspace_import_pending') throw new Error('unreachable')
    expect(hit.severity).toBe('high')
    expect(hit.signals).toContain('README.md')
    expect(hit.signals).toContain('package.json')
    expect(hit.actionHref).toBe('/workspace-import')
  })

  it('brief_approval: emitted for tasks whose productBrief has no approvedAt', async () => {
    await writeCompleteBootstrap()
    await writeJson('memory/workspace-goals.json', { goals: [] })
    await writeJson('memory/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-a',
          title: 'Pick color palette',
          status: 'exploring',
          productBrief: {
            userJob: 'choose a palette',
            successMetric: 'palette chosen',
          },
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'brief_approval')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'brief_approval') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-a')
    expect(hit.actionHref).toBe('/task/task-a')
  })

  it('spec_approval: emitted for tasks in status=spec_review', async () => {
    await writeCompleteBootstrap()
    await writeJson('memory/workspace-goals.json', { goals: [] })
    await writeJson('memory/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [{ id: 'task-b', title: 'Wire auth', status: 'spec_review' }],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'spec_approval')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'spec_approval') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-b')
  })

  it('open_escalation: one item per unresolved escalation', async () => {
    await writeCompleteBootstrap()
    await writeJson('memory/workspace-goals.json', { goals: [] })
    await writeJson('memory/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-c',
          title: 'Big refactor',
          status: 'blocked',
          escalations: [
            { id: 'esc-1', reason: 'scope', summary: 'Scope unclear' },
            { id: 'esc-0', reason: 'done', summary: 'resolved', resolvedAt: '2024-01-01T00:00:00Z' },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hits = items.filter(i => i.kind === 'open_escalation')
    expect(hits).toHaveLength(1)
    const first = hits[0]
    if (!first || first.kind !== 'open_escalation') throw new Error('unreachable')
    expect(first.escalationId).toBe('esc-1')
    expect(first.severity).toBe('high')
    expect(first.detail).toMatch(/scope/i)
  })

  it('lever_questions: single summary item when any lever is system-default', async () => {
    await writeCompleteBootstrap()
    await writeJson('memory/workspace-goals.json', { goals: [] })
    await writeYaml('memory/agent-settings.yaml', fullSystemDefaultSettings())

    const items = buildInbox({ projectPath: tmpDir })
    const hits = items.filter(i => i.kind === 'lever_questions')
    expect(hits).toHaveLength(1)
    const first = hits[0]
    if (!first || first.kind !== 'lever_questions') throw new Error('unreachable')
    // 9 project + 9 domain-default = 18 system-defaults in the fixture
    expect(first.defaultCount).toBe(18)
    expect(first.severity).toBe('low')
    expect(first.actionHref).toBe('/settings/advanced')
  })

  it('severity ordering: high → medium → low', async () => {
    // No bootstrap (high), brief awaiting approval (medium), defaults (low).
    await writeYaml('guildhall.yaml', { name: 'x', id: 'x', coordinators: [] })
    await writeJson('memory/workspace-goals.json', { goals: [] })
    await writeYaml('memory/agent-settings.yaml', fullSystemDefaultSettings())
    await writeJson('memory/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-a',
          title: 'Some task',
          status: 'exploring',
          productBrief: { userJob: 'x', successMetric: 'y' },
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const severities = items.map(i => i.severity)
    // Must be non-decreasing in the severity rank order.
    const rank = { high: 0, medium: 1, low: 2 } as const
    for (let i = 1; i < severities.length; i++) {
      const cur = severities[i]
      const prev = severities[i - 1]
      if (!cur || !prev) throw new Error('unreachable')
      expect(rank[cur]).toBeGreaterThanOrEqual(rank[prev])
    }
    // And we actually observed all three tiers.
    expect(severities).toContain('high')
    expect(severities).toContain('medium')
    expect(severities).toContain('low')
  })
})
