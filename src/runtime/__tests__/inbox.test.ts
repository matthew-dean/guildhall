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
import { getProjectLocalHistoryDir, getProjectStateDir } from '@guildhall/sessions'

import { buildInbox, buildInboxBlockers, type InboxItem } from '../inbox.js'

let tmpDir: string
let dataDir: string
let projectStateDir: string

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

async function writeLocalHistoryJson(rel: string, value: unknown): Promise<void> {
  const p = path.join(getProjectLocalHistoryDir(tmpDir), rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(value, null, 2), 'utf8')
}

function buildInboxWithProviderSetup(): InboxItem[] {
  return buildInbox({
    projectPath: tmpDir,
    snapshotOptions: {
      readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    },
  })
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
      landing_strategy: entry('cherry_pick_local'),
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
  dataDir = path.join(os.tmpdir(), `guildhall-data-${path.basename(tmpDir)}`)
  process.env.GUILDHALL_DATA_DIR = dataDir
  projectStateDir = getProjectStateDir(tmpDir)
  await fs.mkdir(projectStateDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
  delete process.env.GUILDHALL_DATA_DIR
})

describe('buildInbox', () => {
  it('empty state: complete bootstrap, no tasks, no workspace signals, no default levers → no items', async () => {
    await writeCompleteBootstrap()
    // Suppress workspace-import: also write workspace-goals.json so the check
    // short-circuits before we look at signal files.
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    // An agent-settings.yaml with no system-defaults: mark every entry as
    // user-direct so lever_questions doesn't trip.
    const userSet = fullSystemDefaultSettings() as {
      project: Record<string, { setBy: string }>
      domains: { default: Record<string, { setBy: string }> }
    }
    for (const e of Object.values(userSet.project)) e.setBy = 'user-direct'
    for (const e of Object.values(userSet.domains.default)) e.setBy = 'user-direct'
    await writeYaml('.guildhall/agent-settings.yaml', userSet)
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })
    await writeJson('.guildhall/pressure-test-intake/pti-project-check-in.json', {
      id: 'pti-project-check-in',
      rawRequest: 'Run a project check-in.',
      target: { type: 'project', id: 'project-check-in', title: 'Project check-in' },
      status: 'complete',
      activeDomainId: null,
      pendingQuestion: null,
      domains: [],
      outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    expect(items).toEqual([])
  })

  it('structural bootstrap with verifiedAt + gates → no bootstrap_missing item', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'Ready',
      id: 'ready',
      coordinators: [],
      bootstrap: {
        verifiedAt: '2026-04-23T00:00:00Z',
        packageManager: 'pnpm',
        install: { command: 'pnpm install', status: 'ok', lastRunAt: '2026-04-23T00:00:00Z' },
        gates: {
          lint: { command: 'pnpm lint', available: true },
          typecheck: { command: 'pnpm tsc --noEmit', available: true },
          build: { command: 'pnpm build', available: true },
          test: { command: 'pnpm test', available: true },
        },
      },
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    expect(items.find(i => i.kind === 'bootstrap_missing')).toBeUndefined()
  })

  it('structural bootstrap without verifiedAt → still emits bootstrap_missing', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'NotReady',
      id: 'notready',
      coordinators: [],
      bootstrap: {
        packageManager: 'pnpm',
        install: { command: 'pnpm install' },
        gates: { lint: { command: 'pnpm lint', available: true } },
      },
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    expect(items.find(i => i.kind === 'bootstrap_missing')).toBeDefined()
  })

  it('bootstrap_missing: emitted when guildhall.yaml has no bootstrap block', async () => {
    await writeYaml('guildhall.yaml', { name: 'x', id: 'x', coordinators: [] })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    const hit = items.find(i => i.kind === 'bootstrap_missing')
    expect(hit).toBeDefined()
    if (!hit) throw new Error('unreachable')
    expect(hit.severity).toBe('high')
    expect(hit.actionHref).toBe('/settings/ready')
  })

  it('bootstrap_missing: reports the last failed bootstrap gate even when config was previously verified', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeLocalHistoryJson('bootstrap.json', {
      success: false,
      lastRunAt: '2026-04-25T00:00:00Z',
      durationMs: 10,
      commandHash: 'x',
      lockfileHash: null,
      steps: [
        {
          kind: 'gate',
          command: 'pnpm run build',
          result: 'fail',
          exitCode: 2,
          output: '> build\nsrc/customEditorProvider.ts(6,8): error TS2307: Cannot find module',
          durationMs: 10,
        },
      ],
    })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    const hit = items.find(i => i.kind === 'bootstrap_missing')
    expect(hit).toBeDefined()
    if (!hit) throw new Error('unreachable')
    expect(hit.title).toBe('Bootstrap failed')
    expect(hit.detail).toContain('pnpm run build failed with exit 2')
    expect(hit.detail).toContain('Cannot find module')
  })

  it('setup_pending: emitted for the next meaningful setup step after provider/bootstrap/routing are already done', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'Ready for direction',
      id: 'ready-for-direction',
      coordinators: [{ id: 'frontend', name: 'Frontend' }],
      bootstrap: {
        verifiedAt: '2026-05-11T00:00:00.000Z',
        commands: ['pnpm install'],
        successGates: ['pnpm build'],
      },
    })
    await writeLocalHistoryJson('bootstrap.json', {
      success: true,
      lastRunAt: '2026-05-11T00:00:00.000Z',
      durationMs: 10,
      commandHash: 'a',
      lockfileHash: 'b',
      steps: [],
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    const hit = items.find(i => i.kind === 'setup_pending')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'setup_pending') throw new Error('unreachable')
    expect(hit.stepId).toBe('direction')
    expect(hit.title).toBe('Give the project direction')
    expect(hit.actionHref).toBe('/thread')
  })

  it('workspace_import_pending: emitted when README + package.json present but goals file missing', async () => {
    await writeCompleteBootstrap()
    await writeFile('README.md', '# hello')
    await writeFile('package.json', '{}')

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'workspace_import_pending')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'workspace_import_pending') throw new Error('unreachable')
    expect(hit.severity).toBe('medium')
    expect(hit.dismissEndpoint).toBe('/api/project/workspace-import/dismiss')
    expect(hit.signals).toContain('README.md')
    expect(hit.signals).toContain('package.json')
    expect(hit.actionHref).toBe('/workspace-import')
    // Language matters: the chip-side label must say "anchors", not
    // "signals", so it doesn't contradict the Workspace Import tab (which
    // uses "signals" for semantic content the detector extracted).
    expect(hit.title).toBe('Existing repo detected')
    expect(hit.detail).toMatch(/anchors found/i)
    expect(hit.detail).not.toMatch(/\d+ signals?/i)
  })

  it('project_check_in: nudges older projects that have not answered Guildhall project questions yet', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', {
      goals: [{ title: 'Keep the project moving', source: 'test' }],
    })
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'project_check_in')

    expect(hit).toMatchObject({
      severity: 'low',
      title: 'Run project check-in',
      actionHref: '/thread',
    })
    expect(hit?.detail).toContain('Start the check-in pass')
  })

  it('project_check_in: does not nudge again after any project check-in exists', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', {
      goals: [{ title: 'Keep the project moving', source: 'test' }],
    })
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })
    await writeJson('.guildhall/pressure-test-intake/pti-project-check-in.json', {
      id: 'pti-project-check-in',
      rawRequest: 'Run a project check-in.',
      target: { type: 'project', id: 'project-check-in', title: 'Project check-in' },
      status: 'complete',
      activeDomainId: null,
      pendingQuestion: null,
      domains: [],
      outputs: { assumptions: [], decisions: [], languageMapCandidates: [], taskSplitCandidates: [] },
      createdAt: '2026-05-24T00:00:00.000Z',
      updatedAt: '2026-05-24T00:00:00.000Z',
    })

    const items = buildInboxWithProviderSetup()

    expect(items.find(i => i.kind === 'project_check_in')).toBeUndefined()
  })

  it('brief_approval: emitted for tasks whose productBrief has no approvedAt', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
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

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'brief_approval')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'brief_approval') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-a')
    expect(hit.actionHref).toBe('/task/task-a?tab=current')
  })

  it('brief_approval: suppressed while the same task has an unanswered question', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
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
          openQuestions: [
            {
              id: 'q-1',
              kind: 'confirm',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              restatement: 'Should this palette target a warm editorial feel?',
            },
          ],
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    expect(items.find(i => i.kind === 'agent_question_pending' && i.taskId === 'task-a')).toBeDefined()
    expect(items.find(i => i.kind === 'brief_approval' && i.taskId === 'task-a')).toBeUndefined()
  })

  it('agent_question_pending: emitted when a task has an unanswered agent question', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-q',
          title: 'Bootstrap coordinators for this workspace',
          status: 'exploring',
          openQuestions: [
            {
              id: 'q-1',
              kind: 'confirm',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              restatement: 'Is this the right split for this project?',
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'agent_question_pending')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'agent_question_pending') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-q')
    expect(hit.detail).toContain('right split')
    expect(hit.actionHref).toBe('/task/task-q?tab=current')
  })

  it('agent_question_pending: ignores operational receipt prose mistaken for a question', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-db-bootstrap',
          title: 'Bootstrap database — run migrations, verify schema',
          status: 'exploring',
          openQuestions: [
            {
              id: 'q-fallback-task-db-bootstrap',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-22T20:56:21.883Z',
              prompt: 'Done — I took the durable blueprint steps:',
              selectionMode: 'single',
              choices: [
                'Updated the **product brief**',
                'Revised and strengthened the **spec**',
                'Set task status to **`spec_review`**',
                'Appended this turn to the exploring transcript',
                'Logged a milestone in `PROGRESS.md`',
              ],
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.some(i => i.kind === 'agent_question_pending' && i.taskId === 'task-db-bootstrap')).toBe(false)
  })

  it('agent_question_pending: ignores operational receipt questions', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-db-bootstrap',
          title: 'Bootstrap database',
          status: 'exploring',
          openQuestions: [
            {
              id: 'q-receipt',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              prompt: 'Done — I took the durable blueprint steps:',
              selectionMode: 'single',
              choices: [
                'Updated the product brief',
                'Revised and strengthened the spec',
                'Set task status to `spec_review`',
                'Appended this turn to the exploring transcript',
                'Logged a milestone in `PROGRESS.md`',
              ],
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.some(i => i.kind === 'agent_question_pending')).toBe(false)
  })

  it('agent_question_pending: ignores output-promise choices', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-blueprint',
          title: 'Draft the blueprint',
          status: 'exploring',
          openQuestions: [
            {
              id: 'q-promise',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00.000Z',
              prompt: 'Next, pick the output path:',
              selectionMode: 'single',
              choices: [
                'I will draft the blueprint',
                'I will update the product brief',
                'I will persist progress with tools',
              ],
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.some(i => i.kind === 'agent_question_pending')).toBe(false)
  })

  it('import_draft_queue: emitted when imported drafts are waiting to be shaped', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'Inbox Test',
      id: 'inbox-test',
      coordinators: [{ id: 'frontend', name: 'Frontend' }],
      bootstrap: {
        verifiedAt: '2026-05-11T00:00:00.000Z',
        install: ['pnpm install'],
        gates: ['pnpm typecheck'],
      },
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeFile('.guildhall/project-brief.md', 'Fair Labor License helps projects ship with a fair labor license.')
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-import-a',
          title: 'Inspect the repo and draft starter tasks',
          status: 'import_draft',
        },
        {
          id: 'task-import-b',
          title: 'Review workspace roadmap',
          status: 'import_draft',
        },
      ],
    })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    const hit = items.find(i => i.kind === 'import_draft_queue')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'import_draft_queue') throw new Error('unreachable')
    expect(hit.severity).toBe('medium')
    expect(hit.taskId).toBe('task-import-a')
    expect(hit.title).toBe('2 imported drafts need task briefs')
    expect(hit.detail).toMatch(/Inspect the repo and draft starter tasks/)
    expect(hit.actionHref).toBe('/task/task-import-a')
  })

  it('suppresses import_draft_queue while a later setup step still owns the next user action', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'Inbox Test',
      id: 'inbox-test',
      coordinators: [{ id: 'frontend', name: 'Frontend' }],
      bootstrap: {
        verifiedAt: '2026-05-11T00:00:00.000Z',
        install: ['pnpm install'],
        gates: ['pnpm typecheck'],
      },
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-import-a',
          title: 'Version diff view (deferred)',
          status: 'import_draft',
        },
      ],
    })

    const items = buildInbox({
      projectPath: tmpDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })

    expect(items.some(i => i.kind === 'setup_pending' && i.stepId === 'direction')).toBe(true)
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(false)
  })

  it('suppresses import_draft_queue while the reserved workspace import question still needs an answer', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          status: 'spec_review',
          openQuestions: [
            {
              id: 'q-import',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              prompt: 'Which planning docs should become tasks?',
              choices: ['A', 'B'],
              selectionMode: 'multiple',
            },
          ],
        },
        {
          id: 'task-import-a',
          title: 'Version diff view (deferred)',
          status: 'import_draft',
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.some(i => i.kind === 'agent_question_pending' && i.taskId === 'task-workspace-import')).toBe(true)
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(false)
  })

  it('does not let stale unanswered questions on a done workspace-import task suppress the import draft queue', async () => {
    await writeYaml('guildhall.yaml', {
      name: 'Inbox Test',
      id: 'inbox-test',
      coordinators: [{ id: 'frontend', name: 'Frontend' }],
      bootstrap: {
        verifiedAt: '2026-05-11T00:00:00.000Z',
        install: ['pnpm install'],
        gates: ['pnpm typecheck'],
      },
    })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeFile('.guildhall/project-brief.md', 'Looma and Knit are one coordinated product effort.')
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-workspace-import',
          title: 'Review existing project work',
          status: 'done',
          openQuestions: [
            {
              id: 'q-import',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              prompt: 'Which planning docs should become tasks?',
              choices: ['A', 'B'],
              selectionMode: 'multiple',
            },
          ],
        },
        {
          id: 'task-import-a',
          title: 'Version diff view (deferred)',
          status: 'import_draft',
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    expect(items.some(i => i.kind === 'agent_question_pending' && i.taskId === 'task-workspace-import')).toBe(false)
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(true)
  })

  it('suppresses obsolete meta-intake routing questions once a valid routing draft already exists', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-meta-intake',
          title: 'Inspect the repo and draft starter tasks',
          status: 'spec_review',
          spec: `\`\`\`yaml
coordinators:
  - id: frontend
    domain: frontend
    mandate: Draft UI routing
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\``,
          openQuestions: [
            {
              id: 'q-routing',
              kind: 'choice',
              askedBy: 'spec-agent',
              askedAt: '2026-05-11T00:00:00.000Z',
              prompt: 'Pick the project areas (review lanes) you want coordinators for.',
              choices: ['Frontend/UI'],
              selectionMode: 'multiple',
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.some(i => i.kind === 'agent_question_pending' && i.taskId === 'task-meta-intake')).toBe(false)
    expect(items.some(i => i.kind === 'spec_approval' && i.taskId === 'task-meta-intake')).toBe(true)
  })

  it('brief_approval: not emitted once the task has moved beyond intake', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-review',
          title: 'Already underway',
          status: 'review',
          productBrief: {
            userJob: 'fix the handoff',
            successMetric: 'tests pass again',
          },
        },
        {
          id: 'task-done',
          title: 'Already shipped',
          status: 'done',
          productBrief: {
            userJob: 'audit the integration',
            successMetric: 'no local fork remains',
          },
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'brief_approval')).toBeUndefined()
  })

  it('spec_fill_pending: not emitted once work has started even if the brief is still sparse', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-live',
          title: 'Already being worked',
          status: 'ready',
          description: 'Narrow unit-test follow-up in progress.',
          productBrief: {},
          acceptanceCriteria: [
            {
              id: 'ac-1',
              description: 'A real acceptance criterion exists',
              verifiedBy: 'review',
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'spec_fill_pending')).toBeUndefined()
  })

  it('spec_approval: emitted for tasks in status=spec_review', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
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

  it('spec_approval: suppressed while a spec-review task still has an unanswered question', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [{
        id: 'task-b',
        title: 'Wire auth',
        status: 'spec_review',
        openQuestions: [
          {
            id: 'q-1',
            kind: 'confirm',
            askedBy: 'spec-agent',
            askedAt: '2026-05-11T00:00:00.000Z',
            restatement: 'Is this the right split?',
          },
        ],
      }],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'spec_approval')).toBeUndefined()
  })

  it('spec_approval: not suppressed by a stale starter-task focus question once a concrete spec exists', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [{
        id: 'task-b',
        title: 'Wire auth',
        status: 'spec_review',
        updatedAt: '2026-05-11T20:24:50.064Z',
        spec: '## Summary\n\nDraft spec.\n\n## Acceptance Criteria\n\n1. Given...\n\n## Out of Scope\n\n- None\n\n## Open Questions\n\n- None',
        acceptanceCriteria: [
          { id: 'ac-1', description: 'Real AC', verifiedBy: 'review', met: false },
        ],
        openQuestions: [
          {
            id: 'q-1',
            kind: 'choice',
            askedBy: 'spec-agent',
            askedAt: '2026-05-11T20:24:31.428Z',
            prompt: 'What should this first starter task focus on?',
            selectionMode: 'single',
            choices: ['Onboarding', 'Bootstrap'],
          },
        ],
      }],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'spec_approval')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'spec_approval') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-b')
  })

  it('open_escalation: one item per unresolved escalation', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
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

  it('open_escalation: keeps full task content separate from the compact title', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-c',
          title: 'We should have a system-wide policy of how much FLL charges on overhe...',
          description: 'We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.',
          status: 'blocked',
          escalations: [
            { id: 'esc-1', reason: 'spec_ambiguous', summary: 'Card component exists but template syntax mismatch prevents edit' },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'open_escalation')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'open_escalation') throw new Error('unreachable')
    expect(hit.title).toBe('We should have a system-wide policy of how much FLL charges on overhe...')
    expect(hit.taskDescription).toBe('We should have a system-wide policy of how much FLL charges on overhead for maintenance fees etc.')
  })

  it('open_escalation: collapses duplicate visible rows so the next move is not buried', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-c',
          title: 'Block menu',
          status: 'blocked',
          escalations: [
            { id: 'esc-1', reason: 'spec_ambiguous', summary: 'spec_ambiguous: Need the menu ownership decision.' },
            { id: 'esc-2', reason: 'spec_ambiguous', summary: 'spec_ambiguous: Need the menu ownership decision.' },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hits = items.filter(i => i.kind === 'open_escalation')
    expect(hits).toHaveLength(1)
    const hit = hits[0]
    if (!hit || hit.kind !== 'open_escalation') throw new Error('unreachable')
    expect(hit.detail).toBe('Need the menu ownership decision.')
  })

  it('agent_question_pending: hides internal agent narration instead of turning it into a user task', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-question-receipt',
          title: 'Choose migration source of truth',
          description: 'Decide which migration status signal matters.',
          status: 'ready',
          openQuestions: [
            {
              id: 'q-receipt',
              kind: 'text',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00.000Z',
              prompt: 'No problem - I already have the question posted and will wait for the user answer.',
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'agent_question_pending' && i.taskId === 'task-question-receipt')).toBeUndefined()
  })

  it('open_escalation: surfaces blocked tasks that only have a block reason', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-blockreason',
          title: 'Fix bootstrap',
          status: 'blocked',
          blockReason: 'worktree bootstrap failed on command `pixi install`.',
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'open_escalation')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'open_escalation') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-blockreason')
    expect(hit.escalationId).toBe('block-reason')
    expect(hit.detail).toContain('pixi install')
  })

  it('lever_questions: single summary item when any lever is system-default', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeYaml('.guildhall/agent-settings.yaml', fullSystemDefaultSettings())

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

  it('spec_fill_pending: emitted for an open task missing acceptance criteria', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-sf',
          title: 'Ship auth audit',
          description: 'Audit the auth flow for launch blockers.',
          // Brief is approved so brief_approval doesn't fire.
          productBrief: {
            userJob: 'solo devs',
            successCriteria: 'passes audit',
            approvedAt: '2026-01-01T00:00:00Z',
          },
          status: 'ready',
          acceptanceCriteria: [],
        },
      ],
    })
    const items = buildInbox({ projectPath: tmpDir })
    const hit = items.find(i => i.kind === 'spec_fill_pending')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'spec_fill_pending') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-sf')
    expect(hit.missingSteps).toContain('acceptance')
    expect(hit.detail).toMatch(/acceptance/i)
    expect(hit.severity).toBe('low')
    expect(hit.actionHref).toBe('/task/task-sf?tab=spec')
  })

  it('spec_fill_pending: NOT emitted while the same task has an unanswered question', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-question-first',
          title: 'Choose migration source of truth',
          description: 'Decide which migration status signal matters.',
          productBrief: {
            userJob: 'operators',
            successCriteria: 'clear source of truth',
            approvedAt: '2026-01-01T00:00:00Z',
          },
          status: 'ready',
          acceptanceCriteria: [],
          openQuestions: [
            {
              id: 'q-migration-source',
              kind: 'text',
              askedBy: 'spec-agent',
              askedAt: '2026-05-23T00:00:00.000Z',
              prompt: 'Which migration status should be authoritative?',
            },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'agent_question_pending' && i.taskId === 'task-question-first')).toBeDefined()
    expect(items.find(i => i.kind === 'spec_fill_pending' && i.taskId === 'task-question-first')).toBeUndefined()
  })

  it('spec_fill_pending: NOT emitted when brief is awaiting approval (dedupe)', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-dup',
          title: 'Foo',
          description: 'Something to look at.',
          productBrief: { userJob: 'x', successCriteria: 'y' }, // no approvedAt
          status: 'exploring',
          acceptanceCriteria: [],
        },
      ],
    })
    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'brief_approval')).toBeDefined()
    expect(items.find(i => i.kind === 'spec_fill_pending')).toBeUndefined()
  })

  it('spec_fill_pending: NOT emitted for terminal tasks', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'done-task',
          title: 'Already shipped',
          status: 'done',
          acceptanceCriteria: [],
        },
      ],
    })
    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'spec_fill_pending')).toBeUndefined()
  })

  it('spec_fill_pending: NOT emitted for blocked tasks', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-b',
          title: 'Blocked task',
          status: 'blocked',
          description: 'Long enough to dodge the description gap.',
          acceptanceCriteria: [{ id: 'ac-1', description: 'x' }],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir })
    expect(items.find(i => i.kind === 'spec_fill_pending')).toBeUndefined()
  })

  it('spec_fill_pending: capped at 3 per pass to avoid flooding the inbox', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    const tasks = Array.from({ length: 6 }).map((_, i) => ({
      id: `t-${i}`,
      title: `Task ${i}`,
      description: 'Exploring something real.',
      productBrief: {
        userJob: 'u',
        successCriteria: 'd',
        approvedAt: '2026-01-01T00:00:00Z',
      },
      status: 'ready',
      acceptanceCriteria: [],
    }))
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks })
    const items = buildInbox({ projectPath: tmpDir })
    const hits = items.filter(i => i.kind === 'spec_fill_pending')
    expect(hits).toHaveLength(3)
  })

  it('severity ordering: high → medium → low', async () => {
    // No bootstrap (high), brief awaiting approval (medium), defaults (low).
    await writeYaml('guildhall.yaml', { name: 'x', id: 'x', coordinators: [] })
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeYaml('.guildhall/agent-settings.yaml', fullSystemDefaultSettings())
    await writeJson('.guildhall/TASKS.json', {
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

describe('buildInboxBlockers', () => {
  const item = (kind: InboxItem['kind']): InboxItem => {
    // Minimal shape cast — only `kind` matters to buildInboxBlockers.
    return { kind, severity: 'high', title: 't', detail: 'd' } as unknown as InboxItem
  }

  it('returns all-false when the inbox is empty', () => {
    expect(buildInboxBlockers([])).toEqual({ bootstrap: false, workspaceImport: false })
  })

  it('flags bootstrap when bootstrap_missing is present', () => {
    const blockers = buildInboxBlockers([item('bootstrap_missing')])
    expect(blockers.bootstrap).toBe(true)
    expect(blockers.workspaceImport).toBe(false)
  })

  it('flags workspaceImport when workspace_import_pending is present', () => {
    const blockers = buildInboxBlockers([item('workspace_import_pending')])
    expect(blockers.bootstrap).toBe(false)
    expect(blockers.workspaceImport).toBe(true)
  })

  it('does not flag blockers for non-blocking kinds (briefs, escalations, lever questions)', () => {
    const blockers = buildInboxBlockers([
      item('brief_approval'),
      item('spec_approval'),
      item('open_escalation'),
      item('lever_questions'),
    ])
    expect(blockers).toEqual({ bootstrap: false, workspaceImport: false })
  })
})
