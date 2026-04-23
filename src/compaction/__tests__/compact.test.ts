import { describe, expect, it } from 'vitest'

import type {
  CompactProgressEvent,
  ConversationMessage,
  UsageSnapshot,
} from '@guildhall/protocol'

import {
  AUTOCOMPACT_BUFFER_TOKENS,
  COMPACT_HOOK_POST,
  COMPACT_HOOK_PRE,
  CONTEXT_COLLAPSE_TEXT_CHAR_LIMIT,
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  MAX_OUTPUT_TOKENS_FOR_SUMMARY,
  autoCompactIfNeeded,
  buildCompactSummaryMessage,
  buildPostCompactMessages,
  compactConversation,
  createAsyncAgentAttachment,
  createAutoCompactState,
  createCompactBoundaryMessage,
  createInvokedSkillsAttachment,
  createPlanAttachment,
  createRecentFilesAttachment,
  createRecentVerifiedWorkAttachment,
  createTaskFocusAttachment,
  createWorkLogAttachment,
  formatCompactSummary,
  getAutocompactThreshold,
  getContextWindow,
  shouldAutocompact,
  tryContextCollapse,
  trySessionMemoryCompaction,
  type CompactApiClient,
  type CompactApiRequest,
  type CompactApiStreamEvent,
  type CompactHookExecutor,
} from '../index.js'

// ----------------------------- test doubles -----------------------------

function userText(text: string): ConversationMessage {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function assistantText(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function assistantToolUse(id: string, name: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name, input: {} }] }
}

function toolResult(id: string, content: string): ConversationMessage {
  return {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: id, content, is_error: false }],
  }
}

interface ScriptedTurn {
  summary?: string
  throwOnce?: string
  throwAlways?: string
  usage?: UsageSnapshot
}

class ScriptedCompactClient implements CompactApiClient {
  public readonly requests: CompactApiRequest[] = []
  private index = 0
  constructor(private readonly script: ScriptedTurn[]) {}

  async *streamMessage(request: CompactApiRequest): AsyncIterable<CompactApiStreamEvent> {
    this.requests.push(request)
    const turn = this.script[this.index]
    if (!turn) throw new Error(`scripted client exhausted at ${this.index}`)
    this.index += 1
    if (turn.throwAlways) throw new Error(turn.throwAlways)
    if (turn.throwOnce) throw new Error(turn.throwOnce)
    const summary = turn.summary ?? '<summary>ok</summary>'
    yield {
      type: 'message_complete',
      message: { role: 'assistant', content: [{ type: 'text', text: summary }] },
      usage: turn.usage ?? { input_tokens: 1, output_tokens: 1 },
      stop_reason: null,
    }
  }
}

class RecordingHookExecutor implements CompactHookExecutor {
  public readonly events: Array<{ event: string; payload: Record<string, unknown> }> = []
  constructor(
    private readonly outcomes: Partial<
      Record<string, { blocked: boolean; reason?: string }>
    > = {},
  ) {}
  async execute(event: string, payload: Record<string, unknown>) {
    this.events.push({ event, payload })
    return this.outcomes[event] ?? { blocked: false }
  }
}

// ------------------------------- thresholds -------------------------------

describe('getContextWindow', () => {
  it('returns 200k for known Claude models', () => {
    expect(getContextWindow('claude-opus-4-7')).toBe(200_000)
    expect(getContextWindow('claude-sonnet-4-6')).toBe(200_000)
    expect(getContextWindow('claude-haiku-4-5')).toBe(200_000)
  })
  it('honors explicit context_window_tokens override', () => {
    expect(getContextWindow('anything', { context_window_tokens: 131_072 })).toBe(131_072)
  })
  it('falls back to the default for unknown models', () => {
    expect(getContextWindow('kimi-k1')).toBe(200_000)
  })
})

describe('getAutocompactThreshold', () => {
  it('subtracts reserved summary + buffer from the window by default', () => {
    const threshold = getAutocompactThreshold('claude-opus-4-7')
    expect(threshold).toBe(200_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY - AUTOCOMPACT_BUFFER_TOKENS)
  })
  it('honors explicit auto_compact_threshold_tokens override', () => {
    expect(
      getAutocompactThreshold('claude-opus-4-7', { auto_compact_threshold_tokens: 50_000 }),
    ).toBe(50_000)
  })
  it('derives from the provided context_window_tokens when given', () => {
    const threshold = getAutocompactThreshold('unknown', { context_window_tokens: 64_000 })
    expect(threshold).toBe(64_000 - MAX_OUTPUT_TOKENS_FOR_SUMMARY - AUTOCOMPACT_BUFFER_TOKENS)
  })
})

describe('shouldAutocompact', () => {
  it('returns false for short conversations', () => {
    const state = createAutoCompactState()
    expect(shouldAutocompact([userText('hi')], 'claude-opus-4-7', state)).toBe(false)
  })
  it('returns true when token estimate crosses the threshold', () => {
    const state = createAutoCompactState()
    const huge = userText('x'.repeat(4_000_000))
    expect(shouldAutocompact([huge], 'claude-opus-4-7', state)).toBe(true)
  })
  it('returns false once consecutive_failures hits the breaker', () => {
    const state = createAutoCompactState()
    state.consecutive_failures = MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
    const huge = userText('x'.repeat(4_000_000))
    expect(shouldAutocompact([huge], 'claude-opus-4-7', state)).toBe(false)
  })
})

describe('createAutoCompactState', () => {
  it('starts zeroed out', () => {
    expect(createAutoCompactState()).toEqual({
      compacted: false,
      turn_counter: 0,
      turn_id: '',
      consecutive_failures: 0,
    })
  })
})

// ------------------------------- context collapse -------------------------------

describe('tryContextCollapse', () => {
  it('returns null when nothing exceeds the collapse threshold', () => {
    const msgs = Array.from({ length: 10 }, (_, i) => userText(`short ${i}`))
    expect(tryContextCollapse(msgs, { preserveRecent: 3 })).toBeNull()
  })

  it('collapses oversized text blocks in older messages but preserves recent ones verbatim', () => {
    const big = 'a'.repeat(CONTEXT_COLLAPSE_TEXT_CHAR_LIMIT + 1_000)
    const msgs: ConversationMessage[] = [
      userText(big),
      assistantText('still big ' + 'b'.repeat(CONTEXT_COLLAPSE_TEXT_CHAR_LIMIT + 1_000)),
      userText('older but small'),
      assistantText('still older'),
      userText('and older'),
      assistantText('one more older'),
      userText('keep me'),
      assistantText('keep me too'),
      userText('and me'),
    ]
    const result = tryContextCollapse(msgs, { preserveRecent: 3 })
    expect(result).not.toBeNull()
    const firstBlock = result![0]!.content[0]
    if (firstBlock?.type === 'text') {
      expect(firstBlock.text).toContain('...[collapsed')
      expect(firstBlock.text.length).toBeLessThan(big.length)
    }
    // Recent three messages should be identical to the originals.
    expect(result!.slice(-3)).toEqual(msgs.slice(-3))
  })

  it('returns null when collapse does not actually shrink the conversation', () => {
    const msgs: ConversationMessage[] = [userText('tiny'), userText('tiny'), userText('tiny')]
    expect(tryContextCollapse(msgs, { preserveRecent: 1 })).toBeNull()
  })
})

// ------------------------------- session memory -------------------------------

describe('trySessionMemoryCompaction', () => {
  it('returns null when conversation is shorter than keep_recent + 4', () => {
    const msgs = Array.from({ length: 8 }, (_, i) => userText(`m ${i}`))
    expect(trySessionMemoryCompaction(msgs)).toBeNull()
  })

  it('produces a boundary + summary + newer tail for long conversations', () => {
    const msgs: ConversationMessage[] = []
    for (let i = 0; i < 30; i += 1) {
      msgs.push(userText(`question ${i}`))
      msgs.push(assistantText(`answer ${i}`))
    }
    const result = trySessionMemoryCompaction(msgs, { preserveRecent: 6 })
    expect(result).not.toBeNull()
    expect(result!.compact_kind).toBe('session_memory')
    expect(result!.summary_messages).toHaveLength(1)
    expect(result!.messages_to_keep).toHaveLength(6)
    const summaryBlock = result!.summary_messages[0]!.content[0]
    if (summaryBlock?.type === 'text') {
      expect(summaryBlock.text).toContain('Session memory summary')
    }
  })
})

// ------------------------------- boundary + post-compact --------------------

describe('createCompactBoundaryMessage', () => {
  it('includes trigger / kind / footprints', () => {
    const boundary = createCompactBoundaryMessage({
      trigger: 'auto',
      compact_kind: 'full',
      pre_compact_message_count: 50,
      pre_compact_token_count: 150_000,
      post_compact_message_count: 12,
      post_compact_token_count: 30_000,
    })
    const block = boundary.content[0]
    if (block?.type === 'text') {
      expect(block.text).toContain('Trigger: auto')
      expect(block.text).toContain('Compaction kind: full')
      expect(block.text).toContain('messages=50')
      expect(block.text).toContain('tokens=150000')
      expect(block.text).toContain('messages=12')
      expect(block.text).toContain('tokens=30000')
    }
  })
})

describe('buildPostCompactMessages', () => {
  it('emits boundary, summary, kept, attachments, hook results in order', () => {
    const boundary = createCompactBoundaryMessage({})
    const summary = userText('summary')
    const kept1 = userText('k1')
    const kept2 = userText('k2')
    const out = buildPostCompactMessages({
      trigger: 'manual',
      compact_kind: 'full',
      boundary_marker: boundary,
      summary_messages: [summary],
      messages_to_keep: [kept1, kept2],
      attachments: [{ kind: 'x', title: 'X', body: 'x-body', metadata: {} }],
      hook_results: [{ kind: 'hook_results', title: 'hooks', body: 'note', metadata: {} }],
      compact_metadata: {},
    })
    expect(out[0]).toBe(boundary)
    expect(out[1]).toBe(summary)
    expect(out[2]).toBe(kept1)
    expect(out[3]).toBe(kept2)
    const attBlock = out[4]!.content[0]
    if (attBlock?.type === 'text') expect(attBlock.text).toContain('x-body')
    const hookBlock = out[5]!.content[0]
    if (hookBlock?.type === 'text') expect(hookBlock.text).toContain('note')
  })
})

// ------------------------------- formatting -------------------------------

describe('formatCompactSummary', () => {
  it('strips <analysis> and unwraps <summary>', () => {
    const raw = '<analysis>walkthrough...</analysis>\n<summary>actual summary body</summary>'
    const out = formatCompactSummary(raw)
    expect(out).not.toContain('<analysis>')
    expect(out).toContain('Summary:')
    expect(out).toContain('actual summary body')
  })

  it('collapses runs of blank lines', () => {
    expect(formatCompactSummary('a\n\n\n\nb')).toBe('a\n\nb')
  })
})

describe('buildCompactSummaryMessage', () => {
  it('prefixes the continuation message and strips analysis tags', () => {
    const out = buildCompactSummaryMessage('<analysis>x</analysis><summary>body</summary>')
    expect(out).toContain('previous conversation')
    expect(out).toContain('body')
    expect(out).not.toContain('<analysis>')
  })
  it('appends recent-preserved and suppress-follow-up hints when requested', () => {
    const out = buildCompactSummaryMessage('<summary>body</summary>', {
      recentPreserved: true,
      suppressFollowUp: true,
    })
    expect(out).toContain('Recent messages are preserved verbatim.')
    expect(out).toContain('Resume directly')
  })
})

// ------------------------------- attachment builders -------------------------------

describe('attachment builders', () => {
  it('createTaskFocusAttachment returns null without state', () => {
    expect(createTaskFocusAttachment({})).toBeNull()
  })

  it('createTaskFocusAttachment emits goal / artifacts / next step lines', () => {
    const a = createTaskFocusAttachment({
      task_focus_state: {
        goal: 'ship runtime-bundle',
        recent_goals: ['g1', 'g2'],
        active_artifacts: ['a1'],
        verified_state: ['v1'],
        next_step: 'write tests',
      },
    })
    expect(a).not.toBeNull()
    expect(a!.kind).toBe('task_focus')
    expect(a!.body).toContain('ship runtime-bundle')
    expect(a!.body).toContain('- a1')
    expect(a!.body).toContain('next step: write tests')
  })

  it('createRecentFilesAttachment returns null for empty input', () => {
    expect(createRecentFilesAttachment(null)).toBeNull()
    expect(createRecentFilesAttachment([])).toBeNull()
  })

  it('createRecentFilesAttachment lists up to 4 paths with span and preview', () => {
    const entries = Array.from({ length: 6 }, (_, i) => ({
      path: `/p/${i}`,
      span: `1-${i}`,
      preview: `snippet ${i}`,
      timestamp: i,
    }))
    const a = createRecentFilesAttachment(entries)
    expect(a!.kind).toBe('recent_files')
    // Newest (timestamp 5) comes first
    expect(a!.body).toContain('/p/5')
    expect(a!.body).toContain('snippet 5')
    const lines = a!.body.split('\n').filter((l) => l.startsWith('- '))
    expect(lines.length).toBeLessThanOrEqual(4)
  })

  it('createRecentVerifiedWorkAttachment ignores empty input', () => {
    expect(createRecentVerifiedWorkAttachment(null)).toBeNull()
    expect(createRecentVerifiedWorkAttachment(['', '  '])).toBeNull()
  })

  it('createRecentVerifiedWorkAttachment lists verified entries', () => {
    const a = createRecentVerifiedWorkAttachment(['typecheck green', 'tests passing'])
    expect(a!.body).toContain('typecheck green')
    expect(a!.body).toContain('tests passing')
  })

  it('createPlanAttachment only fires when permission_mode === plan', () => {
    expect(createPlanAttachment({ permission_mode: 'auto' })).toBeNull()
    const a = createPlanAttachment({ permission_mode: 'plan', plan_summary: 'do steps' })
    expect(a!.kind).toBe('plan')
    expect(a!.body).toContain('Plan mode')
    expect(a!.body).toContain('do steps')
  })

  it('createInvokedSkillsAttachment lists skills', () => {
    const a = createInvokedSkillsAttachment(['architect', 'design-review'])
    expect(a!.body).toContain('architect')
    expect(a!.body).toContain('design-review')
  })

  it('createAsyncAgentAttachment lists recent entries', () => {
    const a = createAsyncAgentAttachment(['agent1 completed', 'agent2 pending'])
    expect(a!.body).toContain('agent1 completed')
    expect(a!.body).toContain('agent2 pending')
  })

  it('createWorkLogAttachment lists execution checkpoints', () => {
    const a = createWorkLogAttachment(['ran tests', 'fixed lint'])
    expect(a!.body).toContain('ran tests')
    expect(a!.body).toContain('fixed lint')
  })
})

// ------------------------------- compactConversation -------------------------------

describe('compactConversation', () => {
  function longConvo(n: number): ConversationMessage[] {
    const msgs: ConversationMessage[] = []
    for (let i = 0; i < n; i += 1) {
      msgs.push(userText(`q${i}`))
      msgs.push(assistantToolUse(`t${i}`, 'bash'))
      msgs.push(toolResult(`t${i}`, `result ${i}`))
      msgs.push(assistantText(`a${i}`))
    }
    return msgs
  }

  it('returns passthrough when the conversation is already within preserve_recent', async () => {
    const client = new ScriptedCompactClient([])
    const msgs = [userText('one'), assistantText('two')]
    const result = await compactConversation(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      preserveRecent: 6,
    })
    expect(result.summary_messages).toHaveLength(0)
    expect(result.messages_to_keep).toEqual(msgs)
    expect(client.requests).toHaveLength(0)
  })

  it('issues a single streaming call and emits compact_end on happy path', async () => {
    const msgs = longConvo(10)
    const client = new ScriptedCompactClient([{ summary: '<summary>did stuff</summary>' }])
    const events: CompactProgressEvent[] = []
    const result = await compactConversation(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      preserveRecent: 4,
      progressCallback: (e) => {
        events.push(e)
      },
    })
    expect(client.requests).toHaveLength(1)
    expect(result.compact_kind).toBe('full')
    expect(result.summary_messages).toHaveLength(1)
    const summaryBlock = result.summary_messages[0]!.content[0]
    if (summaryBlock?.type === 'text') expect(summaryBlock.text).toContain('did stuff')
    expect(events.map((e) => e.phase)).toContain('compact_start')
    expect(events.map((e) => e.phase)).toContain('compact_end')
  })

  it('fires PRE_COMPACT then POST_COMPACT when a hookExecutor is provided', async () => {
    const msgs = longConvo(10)
    const client = new ScriptedCompactClient([{ summary: '<summary>ok</summary>' }])
    const hooks = new RecordingHookExecutor()
    await compactConversation(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      preserveRecent: 4,
      hookExecutor: hooks,
    })
    expect(hooks.events.map((e) => e.event)).toEqual([COMPACT_HOOK_PRE, COMPACT_HOOK_POST])
  })

  it('returns a passthrough result when pre-compact hook blocks compaction', async () => {
    const msgs = longConvo(10)
    const client = new ScriptedCompactClient([])
    const hooks = new RecordingHookExecutor({
      [COMPACT_HOOK_PRE]: { blocked: true, reason: 'frozen' },
    })
    const events: CompactProgressEvent[] = []
    const result = await compactConversation(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      preserveRecent: 4,
      hookExecutor: hooks,
      progressCallback: (e) => {
        events.push(e)
      },
    })
    expect(client.requests).toHaveLength(0)
    expect(result.summary_messages).toHaveLength(0)
    expect(result.compact_metadata.reason).toBe('frozen')
    expect(events.map((e) => e.phase)).toContain('compact_failed')
  })

  it('retries with head truncation on "prompt too long" and succeeds', async () => {
    const msgs = longConvo(20)
    const client = new ScriptedCompactClient([
      { throwOnce: 'prompt too long, please shorten' },
      { summary: '<summary>retried success</summary>' },
    ])
    const events: CompactProgressEvent[] = []
    const result = await compactConversation(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      preserveRecent: 4,
      progressCallback: (e) => {
        events.push(e)
      },
    })
    expect(client.requests).toHaveLength(2)
    const summaryBlock = result.summary_messages[0]!.content[0]
    if (summaryBlock?.type === 'text') expect(summaryBlock.text).toContain('retried success')
    expect(events.some((e) => e.phase === 'compact_retry')).toBe(true)
  })
})

// ------------------------------- autoCompactIfNeeded -------------------------------

describe('autoCompactIfNeeded', () => {
  it('no-ops when token estimate is below threshold', async () => {
    const msgs = [userText('hello'), assistantText('hi')]
    const state = createAutoCompactState()
    const client = new ScriptedCompactClient([])
    const out = await autoCompactIfNeeded(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      state,
    })
    expect(out.compacted).toBe(false)
    expect(out.messages).toBe(msgs)
    expect(client.requests).toHaveLength(0)
  })

  it('falls through to session-memory compaction when threshold is exceeded', async () => {
    const msgs: ConversationMessage[] = []
    for (let i = 0; i < 30; i += 1) {
      msgs.push(userText(`q${i}`))
      msgs.push(assistantText(`a${i}`))
    }
    const state = createAutoCompactState()
    const client = new ScriptedCompactClient([])
    const out = await autoCompactIfNeeded(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      state,
      autoCompactThresholdTokens: 20,
      preserveRecent: 6,
    })
    expect(out.compacted).toBe(true)
    expect(state.turn_counter).toBe(1)
    expect(state.turn_id).toMatch(/^[0-9a-f]{12}$/)
    expect(state.consecutive_failures).toBe(0)
    // session_memory handled it — no API call made
    expect(client.requests).toHaveLength(0)
  })

  // AC-10: crossing the autocompact threshold emits `compact_progress`
  // FR-16 events for the phase transitions consumable by a subscriber.
  it('AC-10: emits compact_progress events when threshold is exceeded', async () => {
    const msgs: ConversationMessage[] = []
    for (let i = 0; i < 30; i += 1) {
      msgs.push(userText(`q${i}`))
      msgs.push(assistantText(`a${i}`))
    }
    const state = createAutoCompactState()
    const client = new ScriptedCompactClient([])
    const events: CompactProgressEvent[] = []
    const out = await autoCompactIfNeeded(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      state,
      autoCompactThresholdTokens: 20,
      preserveRecent: 6,
      progressCallback: async (e) => {
        events.push(e)
      },
    })
    expect(out.compacted).toBe(true)
    // Subscriber must observe at least start + end for the session-memory
    // compaction path, both typed as compact_progress with a known trigger.
    const phases = events.map((e) => e.phase)
    expect(phases).toContain('session_memory_start')
    expect(phases).toContain('session_memory_end')
    for (const e of events) {
      expect(e.type).toBe('compact_progress')
      expect(e.trigger).toBe('auto')
    }
  })

  it('bumps consecutive_failures when the LLM compact call fails', async () => {
    const msgs: ConversationMessage[] = []
    // keep this short so session-memory cannot kick in (needs keep_recent + 4)
    for (let i = 0; i < 6; i += 1) {
      msgs.push(userText(`q${i}`))
      msgs.push(assistantText(`a${i}`))
    }
    const state = createAutoCompactState()
    const client = new ScriptedCompactClient([
      { throwAlways: 'some upstream error' },
      { throwAlways: 'some upstream error' },
      { throwAlways: 'some upstream error' },
    ])
    const out = await autoCompactIfNeeded(msgs, {
      apiClient: client,
      model: 'claude-opus-4-7',
      state,
      force: true,
      preserveRecent: 6,
    })
    expect(out.compacted).toBe(false)
    expect(state.consecutive_failures).toBe(1)
  })
})
