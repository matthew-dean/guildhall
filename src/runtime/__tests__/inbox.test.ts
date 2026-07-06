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
import { getProjectLocalHistoryDir, getProjectSystemStatePath } from '@guildhall/sessions'

import {
  ATTENTION_OWNED_INBOX_KINDS,
  buildInbox,
  buildInboxBlockers,
  isAttentionOwnedInboxItem,
  type InboxItem,
} from '../inbox.js'
import { writeProjectDeliveryModel } from '../delivery-spine.js'

let tmpDir: string
let dataDir: string
let projectStateDir: string

function fixturePath(rel: string): string {
  const normalized = rel.replace(/\\/g, '/')
  if (normalized === '.guildhall') return projectStateDir
  if (normalized.startsWith('.guildhall/')) {
    return path.join(projectStateDir, normalized.slice('.guildhall/'.length))
  }
  return path.join(tmpDir, rel)
}

async function writeYaml(rel: string, value: unknown): Promise<void> {
  const p = fixturePath(rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, stringifyYaml(value), 'utf8')
}

async function writeJson(rel: string, value: unknown): Promise<void> {
  const p = fixturePath(rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(value, null, 2), 'utf8')
}

async function writeFile(rel: string, contents: string): Promise<void> {
  const p = fixturePath(rel)
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
    projectStateDir,
    snapshotOptions: {
      readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
      detectOauthProviders: () => ({ claude: false, codex: false }),
    },
  })
}

function itemKinds(items: readonly InboxItem[]): string[] {
  return items.map(item => item.kind as string)
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
  projectStateDir = getProjectSystemStatePath(tmpDir, '')
  await fs.mkdir(projectStateDir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  await fs.rm(dataDir, { recursive: true, force: true })
  delete process.env.GUILDHALL_DATA_DIR
})

describe('buildInbox', () => {
  it('classifies only alert-owned inbox kinds explicitly', async () => {
    expect(ATTENTION_OWNED_INBOX_KINDS).toEqual([
      'required_migration',
      'project_understanding',
      'bootstrap_missing',
      'setup_pending',
      'workspace_import_pending',
      'proof_reconciliation',
      'import_draft_queue',
      'contract_result_review',
      'lever_questions',
      'spec_fill_pending',
    ])

    expect(isAttentionOwnedInboxItem({ kind: 'workspace_import_pending' } as InboxItem)).toBe(true)
    expect(isAttentionOwnedInboxItem({ kind: 'lever_questions' } as InboxItem)).toBe(true)
  })

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
      projectStateDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })
    expect(items).toEqual([])
  })

  it('contract_result_review: emits pending contract review items without resurfacing applied evidence', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })
    await writeProjectDeliveryModel(tmpDir, {
      version: 1,
      updatedAt: '2026-06-05T12:00:00.000Z',
      drivers: [],
      primitives: [],
      validationEvidence: [
        {
          id: 'project-primitive-setup-pending',
          contractId: 'project-primitive-setup',
          status: 'pending_review',
          createdAt: '2026-06-05T12:00:00.000Z',
          summary: { drivers: 0, primitives: 2, taskLinks: 1, ownerQuestions: 0 },
          reviewBuckets: [
            { kind: 'keep', label: 'Keep', changeIds: ['primitive:menu'], reason: 'Validated changes can be accepted.' },
            { kind: 'needs_proof', label: 'Needs proof', changeIds: ['primitive:menu'], reason: 'Proof is missing.' },
          ],
          warnings: [{ code: 'missing_invariants', message: 'One primitive has no observable invariants.' }],
        },
        {
          id: 'project-primitive-setup-applied',
          contractId: 'project-primitive-setup',
          status: 'applied',
          createdAt: '2026-06-05T12:05:00.000Z',
          summary: { drivers: 0, primitives: 1, taskLinks: 0, ownerQuestions: 0 },
        },
      ],
      rejectedCandidates: [],
    })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(item => item.kind === 'contract_result_review')

    expect(hit).toEqual(expect.objectContaining({
      kind: 'contract_result_review',
      severity: 'medium',
      resultId: 'project-primitive-setup-pending',
      contractId: 'project-primitive-setup',
      title: 'Review primitive setup result',
      actionHref: '/overview/inbox',
      changeCount: 3,
    }))
    expect(items.some(item => item.kind === 'contract_result_review' && item.resultId === 'project-primitive-setup-applied')).toBe(false)
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
      projectStateDir,
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
      projectStateDir,
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
      projectStateDir,
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
      projectStateDir,
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
      projectStateDir,
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

  it('proof_reconciliation: emitted when completed work still has unmet acceptance criteria', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      tasks: [
        {
          id: 'task-stale-proof',
          title: 'Draft chapter in author voice',
          status: 'done',
          acceptanceCriteria: [
            { id: 'voice', description: 'Author voice proof is attached.', met: false },
            { id: 'outline', description: 'Outline was generated.', met: true },
          ],
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'proof_reconciliation')
    if (!hit || hit.kind !== 'proof_reconciliation') throw new Error('unreachable')

    expect(hit).toMatchObject({
      severity: 'medium',
      taskId: 'task-stale-proof',
      title: 'Review stale proof records',
      actionHref: '/task/task-stale-proof?tab=spec',
      count: 1,
    })
    expect(hit.detail).toContain('Draft chapter in author voice')
    expect(hit.detail).toContain('reconcile the task evidence or reopen the work')
  })

  it('proof_reconciliation: includes every proof-missing task signal', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      tasks: Array.from({ length: 10 }, (_, index) => ({
        id: `task-proof-${index + 1}`,
        title: `Proof task ${index + 1}`,
        status: 'done',
        acceptanceCriteria: [
          { id: 'proof', description: 'Proof is attached.', met: false },
        ],
      })),
    })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'proof_reconciliation')
    if (!hit || hit.kind !== 'proof_reconciliation') throw new Error('unreachable')

    expect(hit.count).toBe(10)
    expect(hit.signals).toHaveLength(10)
    expect(hit.signals).toEqual(Array.from({ length: 10 }, (_, index) => `task:task-proof-${index + 1}`))
  })

  it('proof_reconciliation: ignores stale unmet criteria already settled by approving review proof', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      tasks: [
        {
          id: 'task-stale-proof',
          title: 'Draft chapter in author voice',
          status: 'done',
          acceptanceCriteria: [
            { id: 'voice', description: 'Author voice proof is attached.', met: false },
          ],
          reviewVerdicts: [{
            verdict: 'approve',
            reviewerPath: 'llm',
            reason: 'Reviewer approved.',
            reasoning: 'code-review:acceptance-criteria-met: yes — all acceptance criteria are satisfied.',
            failingSignals: [],
            recordedAt: '2026-07-04T10:07:21.557Z',
          }],
        },
      ],
    })

    const items = buildInboxWithProviderSetup()

    expect(items.some(i => i.kind === 'proof_reconciliation')).toBe(false)
  })

  it('proof_reconciliation: ignores unmet proof outside the selected release scope', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '2026-07-06T00:00:00.000Z',
      selectedReleaseId: 'current-scope',
      releases: [{
        id: 'current-scope',
        label: 'Current scope',
        kind: 'release',
        state: 'active',
        source: 'release_plan',
        nodeIds: ['work:task-current'],
        deferredNodeIds: ['work:task-later'],
      }],
      tasks: [
        {
          id: 'task-current',
          title: 'Ship current proof',
          status: 'done',
          releaseIds: ['current-scope'],
          acceptanceCriteria: [
            { id: 'proof', description: 'Current proof is attached.', met: true },
          ],
          doneSummaryBundle: {
            taskId: 'task-current',
            status: 'done',
            completedAt: '2026-07-06T00:00:00.000Z',
            summary: {
              journey: 'Current proof shipped.',
              decision: 'Task finished as done.',
              evidence: 'current proof attached.',
              learningCandidates: [],
              openResidue: 'No open residue recorded.',
            },
            retention: {
              transcriptPrimaryArtifact: false,
              compactedFullTranscript: false,
              fullEvidenceAvailable: true,
            },
            evidenceRefs: [],
            createdAt: '2026-07-06T00:00:00.000Z',
            createdBy: 'test',
          },
        },
        {
          id: 'task-later',
          title: 'Clean up later proof',
          status: 'done',
          releaseIds: ['later-scope'],
          acceptanceCriteria: [
            { id: 'proof', description: 'Later proof is attached.', met: false },
          ],
        },
      ],
    })

    const items = buildInboxWithProviderSetup()

    expect(items.some(i => i.kind === 'proof_reconciliation')).toBe(false)
  })

  it('does not expose project check-ins or pressure-test questions through project inbox', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', {
      goals: [{ title: 'Keep the project moving', source: 'test' }],
    })
    await writeJson('.guildhall/TASKS.json', { version: 1, lastUpdated: '', tasks: [] })
    await writeJson('.guildhall/pressure-test-intake/pti-narrative-harness-project-check-in.json', {
      id: 'pti-narrative-harness-project-check-in',
      rawRequest: 'Start a project check-in for Narrative Harness.',
      target: { type: 'project', id: 'narrative-harness-project-check-in', title: 'Narrative Harness project check-in' },
      status: 'active',
      activeDomainId: 'project-planner',
      pendingQuestion: {
        id: 'project-direction-priority',
        domainId: 'project-planner',
        prompt: 'For the next few Narrative Harness tasks, should Guildhall bias toward reviewer-lane MVPs, author-facing editor UX, story-memory/schema foundations, or generation/evaluation loops?',
        why: 'This changes which backlog items Guildhall should shape first and what evidence workers need.',
        evidence: [],
        askedAt: '2026-05-31T00:00:00.000Z',
      },
      domains: [],
      outputs: {
        assumptions: [],
        decisions: [],
        languageMapCandidates: [],
        taskSplitCandidates: [],
        projectQuestionPlanner: {
          inferredFacts: [],
          decisions: [],
          discardedAnswers: [],
          askedCandidateIds: ['project-direction-priority'],
        },
      },
      createdAt: '2026-05-31T00:00:00.000Z',
      updatedAt: '2026-05-31T00:00:00.000Z',
    })

    const items = buildInboxWithProviderSetup()
    expect(itemKinds(items)).not.toContain('project_check_in')
    expect(itemKinds(items)).not.toContain('pressure_test_pending')
  })

  it('does not expose task questions or task approvals through project inbox', async () => {
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
        {
          id: 'task-b',
          title: 'Wire auth',
          status: 'spec_review',
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    expect(itemKinds(items)).not.toContain('brief_approval')
    expect(itemKinds(items)).not.toContain('agent_question_pending')
    expect(itemKinds(items)).not.toContain('spec_approval')
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
      projectStateDir,
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

  it('import_draft_queue: includes imported source-recovery work that is not runnable yet', async () => {
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
    await writeFile('.guildhall/project-brief.md', 'Project brief exists so setup no longer owns the next action.')
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-import-a',
          title: 'Recover source-backed contract surface',
          status: 'exploring',
          notes: [{ agentId: 'workspace-importer', role: 'importer', content: 'Imported from docs.' }],
          productBrief: {
            userJob: 'Recover the contract surface.',
            whyItMattersNow: 'Workers need concrete contracts before implementation.',
            successMetric: 'The relevant contract names are recovered from source.',
            nonGoals: ['Do not invent contracts.'],
          },
          acceptanceCriteria: [{ id: 'AC-1', description: 'Contract surfaces are named.', verifiedBy: 'review', met: false }],
          taskReadiness: {
            recommendation: 'needs_research_spike',
            summary: 'This imported task still needs concrete contract names before Guildhall can hand it to a worker.',
          },
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'import_draft_queue')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'import_draft_queue') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-import-a')
    expect(hit.title).toBe('1 imported task needs shaping')
    expect(hit.detail).toContain('Recover source-backed contract surface')
    expect(hit.actionHref).toBe('/task/task-import-a')
  })

  it('import_draft_queue: counts only the selected release shaping work', async () => {
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
    await writeFile('.guildhall/project-brief.md', 'Project brief exists so setup no longer owns the next action.')
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      selectedReleaseId: 'current-release',
      lastUpdated: '',
      releases: [
        {
          id: 'current-release',
          label: 'Current Release',
          kind: 'release',
          state: 'active',
          source: 'release_plan',
          nodeIds: ['work:task-import-current'],
          deferredNodeIds: ['work:task-import-later'],
        },
      ],
      tasks: [
        {
          id: 'task-import-current',
          title: 'Shape current release work',
          status: 'import_draft',
          releaseIds: ['current-release'],
        },
        {
          id: 'task-import-later',
          title: 'Shape later release work',
          status: 'import_draft',
          scope: 'later',
        },
      ],
    })

    const items = buildInboxWithProviderSetup()
    const hit = items.find(i => i.kind === 'import_draft_queue')
    expect(hit).toBeDefined()
    if (!hit || hit.kind !== 'import_draft_queue') throw new Error('unreachable')
    expect(hit.taskId).toBe('task-import-current')
    expect(hit.title).toBe('1 imported draft needs a task brief')
    expect(hit.detail).not.toContain('later')
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
      projectStateDir,
      snapshotOptions: {
        readProviders: () => ({ providers: { 'openai-api': { apiKey: 'sk-test' } } }),
        detectOauthProviders: () => ({ claude: false, codex: false }),
      },
    })

    expect(items.some(i => i.kind === 'setup_pending' && i.stepId === 'direction')).toBe(true)
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(false)
  })

  it('does not let task-local workspace import questions suppress the import draft queue', async () => {
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
    await writeFile('.guildhall/project-brief.md', 'Project brief exists so setup no longer owns the next action.')
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

    const items = buildInboxWithProviderSetup()
    expect(itemKinds(items)).not.toContain('agent_question_pending')
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(true)
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
    expect(itemKinds(items)).not.toContain('agent_question_pending')
    expect(items.some(i => i.kind === 'import_draft_queue')).toBe(true)
  })

  it('does not expose obsolete meta-intake routing questions or spec approvals through inbox', async () => {
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('agent_question_pending')
    expect(itemKinds(items)).not.toContain('spec_approval')
  })

  it('brief_approval: not emitted by project inbox', async () => {
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('brief_approval')
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(items.find(i => i.kind === 'spec_fill_pending')).toBeUndefined()
  })

  it('does not expose spec-review approvals through project inbox', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [{ id: 'task-b', title: 'Wire auth', status: 'spec_review' }],
    })

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('spec_approval')
  })

  it('does not expose task escalations through project inbox', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeJson('.guildhall/TASKS.json', {
      version: 1,
      lastUpdated: '',
      tasks: [
        {
          id: 'task-c',
          title: 'Blocked task',
          status: 'blocked',
          blockReason: 'worktree bootstrap failed on command `pixi install`.',
          escalations: [
            { id: 'esc-1', reason: 'scope', summary: 'Scope unclear' },
          ],
        },
      ],
    })

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('open_escalation')
  })

  it('lever_questions: single summary item when any lever is system-default', async () => {
    await writeCompleteBootstrap()
    await writeJson('.guildhall/workspace-goals.json', { goals: [] })
    await writeYaml('.guildhall/agent-settings.yaml', fullSystemDefaultSettings())

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
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
    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('agent_question_pending')
    expect(items.find(i => i.kind === 'spec_fill_pending' && i.taskId === 'task-question-first')).toBeDefined()
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
    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    expect(itemKinds(items)).not.toContain('brief_approval')
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
    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
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
    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
    const hits = items.filter(i => i.kind === 'spec_fill_pending')
    expect(hits).toHaveLength(3)
  })

  it('severity ordering: high → medium → low', async () => {
    // No bootstrap (high), workspace import pending (medium), defaults (low).
    await writeYaml('guildhall.yaml', { name: 'x', id: 'x', coordinators: [] })
    await writeFile('README.md', '# hello')
    await writeFile('package.json', '{}')
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

    const items = buildInbox({ projectPath: tmpDir, projectStateDir })
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

  it('does not flag blockers for non-blocking alert kinds', () => {
    const blockers = buildInboxBlockers([
      item('lever_questions'),
      item('spec_fill_pending'),
    ])
    expect(blockers).toEqual({ bootstrap: false, workspaceImport: false })
  })
})
