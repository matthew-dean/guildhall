import { describe, expect, it } from 'vitest'

import {
  MAX_TRACKED_ACTIVE_ARTIFACTS,
  MAX_TRACKED_ASYNC_AGENT_EVENTS,
  MAX_TRACKED_ASYNC_AGENT_TASKS,
  MAX_TRACKED_READ_FILES,
  MAX_TRACKED_SKILLS,
  MAX_TRACKED_USER_GOALS,
  MAX_TRACKED_VERIFIED_WORK,
  MAX_TRACKED_WORK_LOG,
  appendCappedUnique,
  recordToolCarryover,
  rememberActiveArtifact,
  rememberAsyncAgentActivity,
  rememberAsyncAgentTask,
  rememberReadFile,
  rememberSkillInvocation,
  rememberUserGoal,
  rememberVerifiedWork,
  rememberWorkLog,
  taskFocusState,
  updatePlanMode,
  type AsyncAgentTaskEntry,
  type ReadFileEntry,
  type TaskFocusState,
} from '../tool-carryover.js'

describe('appendCappedUnique', () => {
  it('moves an existing value to the end (dedupe-with-reinsert)', () => {
    const bucket = ['a', 'b', 'c']
    appendCappedUnique(bucket, 'a', 10)
    expect(bucket).toEqual(['b', 'c', 'a'])
  })
  it('caps from the left when exceeding the limit', () => {
    const bucket = ['a', 'b', 'c']
    appendCappedUnique(bucket, 'd', 3)
    expect(bucket).toEqual(['b', 'c', 'd'])
  })
})

describe('taskFocusState', () => {
  it('seeds a default state into tool metadata on first access', () => {
    const meta: Record<string, unknown> = {}
    const state = taskFocusState(meta)
    expect(state).toEqual({
      goal: '',
      recent_goals: [],
      active_artifacts: [],
      verified_state: [],
      next_step: '',
    })
    expect(meta['task_focus_state']).toBe(state)
  })
  it('upgrades a pre-existing state dict by backfilling missing keys', () => {
    const meta: Record<string, unknown> = {
      task_focus_state: { goal: 'write tests' },
    }
    const state = taskFocusState(meta)
    expect(state.goal).toBe('write tests')
    expect(state.recent_goals).toEqual([])
    expect(state.active_artifacts).toEqual([])
  })
  it('replaces a non-object state value with a fresh default', () => {
    const meta: Record<string, unknown> = { task_focus_state: 'oops' }
    const state = taskFocusState(meta)
    expect(state.goal).toBe('')
    expect(meta['task_focus_state']).toBe(state)
  })
})

describe('rememberUserGoal', () => {
  it('normalizes whitespace and updates goal + recent_goals', () => {
    const meta: Record<string, unknown> = {}
    rememberUserGoal(meta, '  port the  carryover   helpers  ')
    const state = meta['task_focus_state'] as TaskFocusState
    expect(state.goal).toBe('port the carryover helpers')
    expect(state.recent_goals).toEqual(['port the carryover helpers'])
  })
  it('noop on empty/whitespace prompt', () => {
    const meta: Record<string, unknown> = {}
    rememberUserGoal(meta, '   ')
    expect(meta).toEqual({})
  })
  it('caps recent_goals at the documented limit', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_USER_GOALS + 3; i++) {
      rememberUserGoal(meta, `goal-${i}`)
    }
    const state = meta['task_focus_state'] as TaskFocusState
    expect(state.recent_goals).toHaveLength(MAX_TRACKED_USER_GOALS)
    expect(state.recent_goals[state.recent_goals.length - 1]).toBe(
      `goal-${MAX_TRACKED_USER_GOALS + 2}`,
    )
  })
})

describe('rememberActiveArtifact', () => {
  it('caps active_artifacts', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_ACTIVE_ARTIFACTS + 2; i++) {
      rememberActiveArtifact(meta, `/path/${i}.ts`)
    }
    const state = meta['task_focus_state'] as TaskFocusState
    expect(state.active_artifacts).toHaveLength(MAX_TRACKED_ACTIVE_ARTIFACTS)
  })
})

describe('rememberVerifiedWork', () => {
  it('writes into both recent_verified_work and task_focus_state.verified_state', () => {
    const meta: Record<string, unknown> = {}
    rememberVerifiedWork(meta, 'Ran tests — all green')
    expect(meta['recent_verified_work']).toEqual(['Ran tests — all green'])
    const state = meta['task_focus_state'] as TaskFocusState
    expect(state.verified_state).toEqual(['Ran tests — all green'])
  })
  it('caps both buckets', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_VERIFIED_WORK + 3; i++) {
      rememberVerifiedWork(meta, `work-${i}`)
    }
    expect((meta['recent_verified_work'] as string[]).length).toBe(
      MAX_TRACKED_VERIFIED_WORK,
    )
  })
})

describe('rememberReadFile', () => {
  it('stores span + preview and replaces prior entry for the same path', () => {
    const meta: Record<string, unknown> = {}
    rememberReadFile(meta, {
      path: '/a/b.ts',
      offset: 0,
      limit: 10,
      output: 'line one\nline two\n',
    })
    rememberReadFile(meta, {
      path: '/a/b.ts',
      offset: 10,
      limit: 20,
      output: 'later lines',
    })
    const bucket = meta['read_file_state'] as ReadFileEntry[]
    expect(bucket).toHaveLength(1)
    expect(bucket[0]!.span).toBe('lines 11-30')
  })
  it('caps at MAX_TRACKED_READ_FILES across distinct paths', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_READ_FILES + 2; i++) {
      rememberReadFile(meta, {
        path: `/f${i}.ts`,
        offset: 0,
        limit: 1,
        output: '',
      })
    }
    const bucket = meta['read_file_state'] as ReadFileEntry[]
    expect(bucket).toHaveLength(MAX_TRACKED_READ_FILES)
  })
})

describe('rememberSkillInvocation', () => {
  it('caps invoked_skills list', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_SKILLS + 2; i++) {
      rememberSkillInvocation(meta, { skillName: `skill-${i}` })
    }
    expect((meta['invoked_skills'] as string[]).length).toBe(MAX_TRACKED_SKILLS)
  })
  it('dedupes by re-inserting at end', () => {
    const meta: Record<string, unknown> = {}
    rememberSkillInvocation(meta, { skillName: 'a' })
    rememberSkillInvocation(meta, { skillName: 'b' })
    rememberSkillInvocation(meta, { skillName: 'a' })
    expect(meta['invoked_skills']).toEqual(['b', 'a'])
  })
})

describe('rememberAsyncAgentActivity', () => {
  it('formats a Spawned summary for agent tool', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentActivity(meta, {
      toolName: 'agent',
      toolInput: { description: 'review PR' },
      output: 'task queued',
    })
    const bucket = meta['async_agent_state'] as string[]
    expect(bucket[0]).toContain('Spawned async agent')
    expect(bucket[0]).toContain('review PR')
    expect(bucket[0]).toContain('task queued')
  })
  it('formats a follow-up for send_message', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentActivity(meta, {
      toolName: 'send_message',
      toolInput: { task_id: 'T-42' },
      output: '',
    })
    expect((meta['async_agent_state'] as string[])[0]).toContain('follow-up message')
  })
  it('caps at MAX_TRACKED_ASYNC_AGENT_EVENTS', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_ASYNC_AGENT_EVENTS + 3; i++) {
      rememberAsyncAgentActivity(meta, {
        toolName: 'agent',
        toolInput: { description: `d-${i}` },
        output: '',
      })
    }
    expect((meta['async_agent_state'] as string[]).length).toBe(
      MAX_TRACKED_ASYNC_AGENT_EVENTS,
    )
  })
})

describe('rememberAsyncAgentTask', () => {
  it('parses "Spawned agent <name> (task_id=<id>)" from output', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentTask(meta, {
      toolName: 'agent',
      toolInput: { description: 'ship it' },
      output: 'Spawned agent Explorer (task_id=T-1)',
    })
    const bucket = meta['async_agent_tasks'] as AsyncAgentTaskEntry[]
    expect(bucket[0]!.agent_id).toBe('Explorer')
    expect(bucket[0]!.task_id).toBe('T-1')
    expect(bucket[0]!.status).toBe('spawned')
  })
  it('prefers result_metadata over regex scraping when both present', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentTask(meta, {
      toolName: 'agent',
      toolInput: { description: 'x' },
      output: 'Spawned agent Bogus (task_id=B-1)',
      resultMetadata: { agent_id: 'Real', task_id: 'R-1' },
    })
    const bucket = meta['async_agent_tasks'] as AsyncAgentTaskEntry[]
    expect(bucket[0]!.agent_id).toBe('Real')
    expect(bucket[0]!.task_id).toBe('R-1')
  })
  it('replaces prior entry for the same task_id', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentTask(meta, {
      toolName: 'agent',
      toolInput: { description: 'first' },
      output: 'Spawned agent A (task_id=T-9)',
    })
    rememberAsyncAgentTask(meta, {
      toolName: 'agent',
      toolInput: { description: 'second' },
      output: 'Spawned agent A (task_id=T-9)',
    })
    const bucket = meta['async_agent_tasks'] as AsyncAgentTaskEntry[]
    expect(bucket).toHaveLength(1)
    expect(bucket[0]!.description).toBe('second')
  })
  it('noop when tool is not an agent spawn', () => {
    const meta: Record<string, unknown> = {}
    rememberAsyncAgentTask(meta, {
      toolName: 'bash',
      toolInput: {},
      output: 'Spawned agent X (task_id=T-3)',
    })
    expect(meta['async_agent_tasks']).toBeUndefined()
  })
  it('caps at MAX_TRACKED_ASYNC_AGENT_TASKS', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_ASYNC_AGENT_TASKS + 2; i++) {
      rememberAsyncAgentTask(meta, {
        toolName: 'agent',
        toolInput: { description: `t-${i}` },
        output: `Spawned agent A (task_id=T-${i})`,
      })
    }
    expect((meta['async_agent_tasks'] as AsyncAgentTaskEntry[]).length).toBe(
      MAX_TRACKED_ASYNC_AGENT_TASKS,
    )
  })
})

describe('rememberWorkLog', () => {
  it('caps at MAX_TRACKED_WORK_LOG', () => {
    const meta: Record<string, unknown> = {}
    for (let i = 0; i < MAX_TRACKED_WORK_LOG + 3; i++) {
      rememberWorkLog(meta, { entry: `e-${i}` })
    }
    expect((meta['recent_work_log'] as string[]).length).toBe(MAX_TRACKED_WORK_LOG)
  })
})

describe('updatePlanMode', () => {
  it('writes permission_mode directly onto metadata', () => {
    const meta: Record<string, unknown> = {}
    updatePlanMode(meta, 'plan')
    expect(meta['permission_mode']).toBe('plan')
  })
})

describe('recordToolCarryover (top-level dispatcher)', () => {
  it('is a full no-op when is_error is true', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Read',
      toolInput: { file_path: '/a.ts' },
      toolOutput: 'hello',
      isError: true,
      resolvedFilePath: '/a.ts',
    })
    expect(meta).toEqual({})
  })

  it('Read: remembers artifact + read-file entry + verified_work + work_log', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Read',
      toolInput: { file_path: '/a.ts', offset: 0, limit: 100 },
      toolOutput: 'first\nsecond',
      isError: false,
      resolvedFilePath: '/a.ts',
    })
    expect((meta['task_focus_state'] as TaskFocusState).active_artifacts).toContain('/a.ts')
    expect(meta['read_file_state']).toBeInstanceOf(Array)
    expect((meta['recent_verified_work'] as string[]).some((s) => s.includes('Inspected file'))).toBe(true)
    expect((meta['recent_work_log'] as string[]).some((s) => s.includes('Read file'))).toBe(true)
  })

  it('Bash: work log + verified work include command snippet and first output line', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Bash',
      toolInput: { command: 'pnpm test' },
      toolOutput: 'PASS foo.test.ts\n(more lines)',
      isError: false,
      resolvedFilePath: null,
    })
    const verified = meta['recent_verified_work'] as string[]
    const worklog = meta['recent_work_log'] as string[]
    expect(verified[0]).toContain('pnpm test')
    expect(verified[0]).toContain('PASS foo.test.ts')
    expect(worklog[0]).toContain('pnpm test')
  })

  it('Bash with no output records "no output"', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Bash',
      toolInput: { command: 'true' },
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect((meta['recent_verified_work'] as string[])[0]).toContain('no output')
  })

  it('Grep: records pattern in both verified_work and work_log', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Grep',
      toolInput: { pattern: 'TODO' },
      toolOutput: 'file.ts:42',
      isError: false,
      resolvedFilePath: null,
    })
    expect((meta['recent_verified_work'] as string[])[0]).toContain('grep pattern TODO')
    expect((meta['recent_work_log'] as string[])[0]).toContain('grep pattern=TODO')
  })

  it('Glob: records pattern in verified_work only (no work_log entry for Glob)', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Glob',
      toolInput: { pattern: '**/*.ts' },
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect((meta['recent_verified_work'] as string[])[0]).toContain('**/*.ts')
    expect(meta['recent_work_log']).toBeUndefined()
  })

  it('WebFetch: active_artifact + verified_work capture the URL', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'WebFetch',
      toolInput: { url: 'https://example.com/x' },
      toolOutput: 'ok',
      isError: false,
      resolvedFilePath: null,
    })
    expect((meta['task_focus_state'] as TaskFocusState).active_artifacts).toContain(
      'https://example.com/x',
    )
    expect((meta['recent_verified_work'] as string[])[0]).toContain('example.com')
  })

  it('WebSearch: verified_work captures query but no artifact', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'WebSearch',
      toolInput: { query: 'zod discriminated union' },
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect((meta['recent_verified_work'] as string[])[0]).toContain('zod discriminated union')
  })

  it('EnterPlanMode / ExitPlanMode flip permission_mode and log work', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'EnterPlanMode',
      toolInput: {},
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect(meta['permission_mode']).toBe('plan')
    expect((meta['recent_work_log'] as string[])[0]).toBe('Entered plan mode')

    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'ExitPlanMode',
      toolInput: {},
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect(meta['permission_mode']).toBe('default')
    expect((meta['recent_work_log'] as string[])[1]).toBe('Exited plan mode')
  })

  it('Skill: invoked_skills + active artifact ("skill:<name>") + verified work', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Skill',
      toolInput: { name: 'code-review' },
      toolOutput: '',
      isError: false,
      resolvedFilePath: null,
    })
    expect(meta['invoked_skills']).toEqual(['code-review'])
    expect((meta['task_focus_state'] as TaskFocusState).active_artifacts).toContain(
      'skill:code-review',
    )
    expect((meta['recent_verified_work'] as string[])[0]).toContain('Loaded skill code-review')
    expect((meta['recent_work_log'] as string[])[0]).toContain('Loaded skill code-review')
  })

  it('Task (agent): records async_agent_state + async_agent_tasks + verified work', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'Task',
      toolInput: { description: 'triage issue' },
      toolOutput: 'Spawned agent Triager (task_id=T-7)',
      isError: false,
      resolvedFilePath: null,
    })
    expect(meta['async_agent_state']).toBeInstanceOf(Array)
    const tasks = meta['async_agent_tasks'] as AsyncAgentTaskEntry[]
    expect(tasks[0]!.agent_id).toBe('Triager')
    expect(tasks[0]!.task_id).toBe('T-7')
    expect((meta['recent_verified_work'] as string[])[0]).toContain('triage issue')
  })

  it('Unknown tool: only artifact (if filePath given) is recorded', () => {
    const meta: Record<string, unknown> = {}
    recordToolCarryover({
      toolMetadata: meta,
      toolName: 'NotARealTool',
      toolInput: {},
      toolOutput: '',
      isError: false,
      resolvedFilePath: '/path/to/thing',
    })
    expect((meta['task_focus_state'] as TaskFocusState).active_artifacts).toEqual([
      '/path/to/thing',
    ])
    expect(meta['recent_verified_work']).toBeUndefined()
    expect(meta['recent_work_log']).toBeUndefined()
  })

  it('null toolMetadata: no crash, no side effects', () => {
    expect(() =>
      recordToolCarryover({
        toolMetadata: null,
        toolName: 'Read',
        toolInput: { file_path: '/x' },
        toolOutput: '',
        isError: false,
        resolvedFilePath: '/x',
      }),
    ).not.toThrow()
  })
})
