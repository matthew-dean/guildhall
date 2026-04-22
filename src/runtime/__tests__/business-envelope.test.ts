import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Goal, GoalBook, Task, type Guardrail } from '@guildhall/core'
import {
  evaluateEnvelope,
  collectViolations,
  guardrailApplies,
  findMatch,
  loadGoalBook,
  saveGoalBook,
  findGoal,
  loadGoalForTask,
  goalsPath,
} from '../business-envelope.js'

function mkTask(overrides: Partial<Task> = {}): Task {
  return Task.parse({
    id: 't-1',
    title: 'Do a thing',
    description: 'Ordinary implementation work',
    domain: 'looma',
    projectPath: '/tmp/p',
    status: 'in_progress',
    priority: 'normal',
    acceptanceCriteria: [],
    outOfScope: [],
    dependsOn: [],
    notes: [],
    gateResults: [],
    escalations: [],
    agentIssues: [],
    revisionCount: 0,
    remediationAttempts: 0,
    origination: 'human',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    ...overrides,
  })
}

function mkGoal(overrides: Partial<Goal> = {}): Goal {
  return Goal.parse({
    id: 'g-1',
    title: 'Ship v1',
    description: 'Stable release',
    successCondition: 'All hard gates pass on main',
    guardrails: [],
    status: 'active',
    createdAt: '2026-04-20T00:00:00Z',
    updatedAt: '2026-04-20T00:00:00Z',
    ...overrides,
  })
}

function mkRail(overrides: Partial<Guardrail> & { id: string; description: string }): Guardrail {
  return {
    id: overrides.id,
    kind: overrides.kind ?? 'exclude',
    description: overrides.description,
    tags: overrides.tags ?? [],
  }
}

// ---------------------------------------------------------------------------
// Pure evaluator — strictness matrix
// ---------------------------------------------------------------------------

describe('evaluateEnvelope — no-goal escalation', () => {
  it('strict: no parent goal → reject', () => {
    const task = mkTask({ parentGoalId: undefined })
    const out = evaluateEnvelope({ task, goal: undefined, strictness: 'strict' })
    expect(out.kind).toBe('reject')
    if (out.kind === 'reject') {
      expect(out.violations[0]!.guardrailId).toBe('__no_goal__')
    }
  })

  it('advisory: no parent goal → escalate (uncategorized signal)', () => {
    const task = mkTask({ parentGoalId: undefined })
    const out = evaluateEnvelope({ task, goal: undefined, strictness: 'advisory' })
    expect(out.kind).toBe('escalate')
  })

  it('off: no parent goal → escalate (uncategorized signal, still surfaced per FR-23)', () => {
    const task = mkTask({ parentGoalId: undefined })
    const out = evaluateEnvelope({ task, goal: undefined, strictness: 'off' })
    expect(out.kind).toBe('escalate')
  })
})

describe('evaluateEnvelope — off strictness', () => {
  it('within when a goal exists, regardless of guardrail violations', () => {
    const task = mkTask({ parentGoalId: 'g-1', description: 'Add a public API change' })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'exclude', description: 'No public API changes allowed' })],
    })
    const out = evaluateEnvelope({ task, goal, strictness: 'off' })
    expect(out.kind).toBe('within')
  })
})

describe('evaluateEnvelope — strict strictness', () => {
  it('within when no guardrails violated', () => {
    const task = mkTask({ parentGoalId: 'g-1', description: 'refactor helper utility' })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'exclude', description: 'No database migrations' })],
    })
    expect(evaluateEnvelope({ task, goal, strictness: 'strict' }).kind).toBe('within')
  })

  it('reject when an exclude guardrail is tripped by the task text', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      description: 'Add a new database migration for users table',
    })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'exclude', description: 'No database migrations in this phase' })],
    })
    const out = evaluateEnvelope({ task, goal, strictness: 'strict' })
    expect(out.kind).toBe('reject')
    if (out.kind === 'reject') {
      expect(out.violations[0]!.guardrailId).toBe('r1')
      expect(out.violations[0]!.matched).toBeDefined()
    }
  })

  it('reject when an include guardrail is missing required keywords', () => {
    const task = mkTask({ parentGoalId: 'g-1', description: 'Add a loader module' })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'include', description: 'Must include typescript strict mode' })],
    })
    const out = evaluateEnvelope({ task, goal, strictness: 'strict' })
    expect(out.kind).toBe('reject')
  })

  it('aggregates multiple violations', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      description: 'Add database migration and mutate production secrets',
    })
    const goal = mkGoal({
      guardrails: [
        mkRail({ id: 'r1', kind: 'exclude', description: 'No database migration' }),
        mkRail({ id: 'r2', kind: 'exclude', description: 'No secrets touching' }),
      ],
    })
    const out = evaluateEnvelope({ task, goal, strictness: 'strict' })
    expect(out.kind).toBe('reject')
    if (out.kind === 'reject') {
      expect(out.violations.map((v) => v.guardrailId).sort()).toEqual(['r1', 'r2'])
    }
  })
})

describe('evaluateEnvelope — advisory strictness', () => {
  it('advisory when guardrails are violated (does not block)', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      description: 'Add database migration for users',
    })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'exclude', description: 'No database migration' })],
    })
    const out = evaluateEnvelope({ task, goal, strictness: 'advisory' })
    expect(out.kind).toBe('advisory')
    if (out.kind === 'advisory') {
      expect(out.violations).toHaveLength(1)
      expect(out.violations[0]!.guardrailId).toBe('r1')
    }
  })

  it('within when no guardrails are violated', () => {
    const task = mkTask({ parentGoalId: 'g-1' })
    const goal = mkGoal({
      guardrails: [mkRail({ id: 'r1', kind: 'exclude', description: 'No nukes' })],
    })
    expect(evaluateEnvelope({ task, goal, strictness: 'advisory' }).kind).toBe('within')
  })
})

describe('guardrailApplies (tag filtering)', () => {
  it('applies when the guardrail has no tags', () => {
    const rail = mkRail({ id: 'r', description: 'x' })
    expect(guardrailApplies(rail, mkTask({ domain: 'knit' }))).toBe(true)
  })

  it('applies when domain matches one of the tags (case-insensitive)', () => {
    const rail = mkRail({ id: 'r', description: 'x', tags: ['Looma', 'knit'] })
    expect(guardrailApplies(rail, mkTask({ domain: 'looma' }))).toBe(true)
    expect(guardrailApplies(rail, mkTask({ domain: 'KNIT' }))).toBe(true)
  })

  it('skips when domain is not in the tag list', () => {
    const rail = mkRail({ id: 'r', description: 'x', tags: ['frontend'] })
    expect(guardrailApplies(rail, mkTask({ domain: 'backend' }))).toBe(false)
  })

  it('evaluator honors domain filtering so a non-matching guardrail cannot violate', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      domain: 'backend',
      description: 'Add database migration',
    })
    const goal = mkGoal({
      guardrails: [
        mkRail({ id: 'r1', kind: 'exclude', description: 'No migration', tags: ['frontend'] }),
      ],
    })
    expect(evaluateEnvelope({ task, goal, strictness: 'strict' }).kind).toBe('within')
  })
})

describe('findMatch (tokenizer)', () => {
  it('matches a literal substring ignoring stopwords', () => {
    expect(findMatch('we need a database migration done', 'No database migrations')).toBe('database')
  })

  it('returns null when nothing matches', () => {
    expect(findMatch('refactor helper', 'No database migrations')).toBeNull()
  })

  it('ignores stopwords like "no" that appear in guardrail phrasing', () => {
    expect(findMatch('the quick fox', 'no database changes')).toBeNull()
  })

  it('filters tokens shorter than 3 chars', () => {
    expect(findMatch('abcd', 'xx yy')).toBeNull()
  })
})

describe('collectViolations', () => {
  it('matches against note content and acceptance-criterion descriptions', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      description: 'safe refactor',
      notes: [
        {
          agentId: 'w',
          role: 'worker',
          content: 'I may need to run a database migration later',
          timestamp: '2026-04-20T00:00:00Z',
        },
      ],
      acceptanceCriteria: [
        {
          id: 'ac1',
          description: 'migration runs cleanly on empty schema',
          verifiedBy: 'automated',
          met: false,
        },
      ],
    })
    const goal = mkGoal({
      guardrails: [
        mkRail({ id: 'r', kind: 'exclude', description: 'No database migration' }),
      ],
    })
    expect(collectViolations(task, goal).map((v) => v.guardrailId)).toEqual(['r'])
  })

  it('skips guardrails that do not apply to the task domain', () => {
    const task = mkTask({
      parentGoalId: 'g-1',
      domain: 'backend',
      description: 'introduce migration',
    })
    const goal = mkGoal({
      guardrails: [
        mkRail({ id: 'ok', kind: 'exclude', description: 'No migration', tags: ['frontend'] }),
        mkRail({ id: 'hit', kind: 'exclude', description: 'No migration', tags: [] }),
      ],
    })
    const violations = collectViolations(task, goal)
    expect(violations.map((v) => v.guardrailId)).toEqual(['hit'])
  })
})

// ---------------------------------------------------------------------------
// Goal storage
// ---------------------------------------------------------------------------

describe('GOALS.json storage', () => {
  let memDir: string

  beforeEach(async () => {
    memDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-envelope-'))
  })

  afterEach(async () => {
    await fs.rm(memDir, { recursive: true, force: true })
  })

  it('loadGoalBook returns an empty book when the file is missing', async () => {
    const book = await loadGoalBook(memDir)
    expect(book.goals).toEqual([])
    expect(book.version).toBe(1)
  })

  it('saveGoalBook → loadGoalBook round-trips the payload', async () => {
    const book = GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal()],
    })
    await saveGoalBook(memDir, book)
    const got = await loadGoalBook(memDir)
    expect(got.goals).toHaveLength(1)
    expect(got.goals[0]!.id).toBe('g-1')
  })

  it('saveGoalBook writes atomically (no .tmp sibling remains)', async () => {
    await saveGoalBook(memDir, GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal()],
    }))
    const files = await fs.readdir(memDir)
    expect(files).toContain('GOALS.json')
    expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true)
  })

  it('goalsPath uses GOALS_FILENAME', () => {
    expect(goalsPath('/m')).toBe(path.join('/m', 'GOALS.json'))
  })

  it('findGoal resolves by id', () => {
    const book = GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal({ id: 'a' }), mkGoal({ id: 'b' })],
    })
    expect(findGoal(book, 'a')?.id).toBe('a')
    expect(findGoal(book, 'missing')).toBeUndefined()
    expect(findGoal(book, undefined)).toBeUndefined()
  })

  it('loadGoalForTask pulls the task\'s goal by parentGoalId', async () => {
    await saveGoalBook(memDir, GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal({ id: 'g-42' })],
    }))
    const task = mkTask({ parentGoalId: 'g-42' })
    const goal = await loadGoalForTask(memDir, task)
    expect(goal?.id).toBe('g-42')
  })

  it('loadGoalForTask returns undefined for a task with no parentGoalId', async () => {
    await saveGoalBook(memDir, GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal()],
    }))
    const goal = await loadGoalForTask(memDir, mkTask({ parentGoalId: undefined }))
    expect(goal).toBeUndefined()
  })

  it('loadGoalForTask returns undefined when id points to an unknown goal', async () => {
    await saveGoalBook(memDir, GoalBook.parse({
      version: 1,
      lastUpdated: '2026-04-20T00:00:00Z',
      goals: [mkGoal({ id: 'g-known' })],
    }))
    const goal = await loadGoalForTask(memDir, mkTask({ parentGoalId: 'g-unknown' }))
    expect(goal).toBeUndefined()
  })
})
