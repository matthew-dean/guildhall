import { describe, it, expect } from 'vitest'
import type {
  ApiMessageRequest,
  ApiStreamEvent,
  SupportsStreamingMessages,
} from '@guildhall/engine'
import type { ConversationMessage, UsageSnapshot } from '@guildhall/protocol'
import { GuildhallAgent, clampPermissionMode, composeSystemPromptWithSkills } from '../guildhall-agent.js'
import { PermissionMode, defineTool } from '@guildhall/engine'
import { z } from 'zod'
import { readFileTool, shellTool } from '@guildhall/tools'
import { createSpecAgent, createWorkerAgent, createCoordinatorAgent, createReviewerAgent, createGateCheckerAgent } from '../index.js'
import type { CoordinatorDomain } from '@guildhall/core'
import type { SkillDefinition } from '@guildhall/skills'

interface ScriptedTurn {
  textDeltas?: string[]
  message: ConversationMessage
  usage?: UsageSnapshot
}

class ScriptedApiClient implements SupportsStreamingMessages {
  private index = 0
  readonly requests: ApiMessageRequest[] = []

  constructor(private readonly script: ScriptedTurn[]) {}

  async *streamMessage(request: ApiMessageRequest): AsyncIterable<ApiStreamEvent> {
    this.requests.push(request)
    const turn = this.script[this.index]
    if (!turn) throw new Error(`ScriptedApiClient exhausted at ${this.index}`)
    this.index += 1

    for (const d of turn.textDeltas ?? []) {
      yield { type: 'text_delta', text: d }
    }
    yield {
      type: 'message_complete',
      message: turn.message,
      usage: turn.usage ?? { input_tokens: 0, output_tokens: 0 },
      stop_reason: null,
    }
  }
}

function assistantMsg(text: string): ConversationMessage {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

describe('GuildhallAgent', () => {
  it('returns concatenated assistant text from a single-turn generation', async () => {
    const client = new ScriptedApiClient([
      { textDeltas: ['Hello', ', world'], message: assistantMsg('Hello, world') },
    ])

    const agent = new GuildhallAgent({
      name: 'test',
      llm: { apiClient: client, modelId: 'test-model' },
      systemPrompt: 'You are a test.',
      tools: [readFileTool],
    })

    const result = await agent.generate('hi')
    expect(result.text).toBe('Hello, world')
    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]?.role).toBe('user')
    expect(result.messages[1]?.role).toBe('assistant')
  })

  it('exposes the agent name', () => {
    const agent = new GuildhallAgent({
      name: 'my-agent',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'x',
      tools: [],
    })
    expect(agent.name).toBe('my-agent')
  })

  it('registers tools with the engine (schema exposed via request)', async () => {
    const client = new ScriptedApiClient([
      { message: assistantMsg('ok') },
    ])
    const agent = new GuildhallAgent({
      name: 'tool-test',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'p',
      tools: [readFileTool, shellTool],
    })
    await agent.generate('go')
    const req = client.requests[0]
    const toolNames = req?.tools.map((t) => t['name']) ?? []
    expect(toolNames).toContain('read-file')
    expect(toolNames).toContain('shell')
  })

  it('preserves conversation across multiple generate() calls', async () => {
    const client = new ScriptedApiClient([
      { message: assistantMsg('first') },
      { message: assistantMsg('second') },
    ])
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    const r1 = await agent.generate('msg1')
    expect(r1.text).toBe('first')
    const r2 = await agent.generate('msg2')
    expect(r2.text).toBe('second')
    // 2 user + 2 assistant = 4 messages
    expect(r2.messages).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// FR-15 per-task permission modes
// ---------------------------------------------------------------------------
describe('GuildhallAgent — FR-15 permission modes', () => {
  it('defaults the baseline mode to FULL_AUTO', () => {
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    expect(agent.permissionMode).toBe(PermissionMode.FULL_AUTO)
  })

  it('setPermissionMode(PLAN) narrows an agent whose baseline is FULL_AUTO', () => {
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    const applied = agent.setPermissionMode(PermissionMode.PLAN)
    expect(applied).toBe(PermissionMode.PLAN)
    expect(agent.permissionMode).toBe(PermissionMode.PLAN)
  })

  it('setPermissionMode cannot widen beyond the baseline', () => {
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
      baselinePermissionMode: PermissionMode.PLAN,
    })
    const applied = agent.setPermissionMode(PermissionMode.FULL_AUTO)
    expect(applied).toBe(PermissionMode.PLAN)
    expect(agent.permissionMode).toBe(PermissionMode.PLAN)
  })

  it('setPermissionMode(DEFAULT) narrows FULL_AUTO → DEFAULT', () => {
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    expect(agent.setPermissionMode(PermissionMode.DEFAULT)).toBe(
      PermissionMode.DEFAULT,
    )
  })

  it('setPermissionMode restores back to baseline when re-requested', () => {
    const agent = new GuildhallAgent({
      name: 't',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    agent.setPermissionMode(PermissionMode.PLAN)
    expect(agent.permissionMode).toBe(PermissionMode.PLAN)
    agent.setPermissionMode(PermissionMode.FULL_AUTO)
    expect(agent.permissionMode).toBe(PermissionMode.FULL_AUTO)
  })

  it('clampPermissionMode picks the narrower of requested/baseline', () => {
    expect(
      clampPermissionMode(PermissionMode.FULL_AUTO, PermissionMode.PLAN),
    ).toBe(PermissionMode.PLAN)
    expect(
      clampPermissionMode(PermissionMode.PLAN, PermissionMode.FULL_AUTO),
    ).toBe(PermissionMode.PLAN)
    expect(
      clampPermissionMode(PermissionMode.DEFAULT, PermissionMode.DEFAULT),
    ).toBe(PermissionMode.DEFAULT)
    expect(
      clampPermissionMode(PermissionMode.FULL_AUTO, PermissionMode.DEFAULT),
    ).toBe(PermissionMode.DEFAULT)
  })
})

// ---------------------------------------------------------------------------
// FR-17 skill prompt composition
// ---------------------------------------------------------------------------
describe('FR-17 skill composition', () => {
  const skillA: SkillDefinition = {
    name: 'coding-conventions',
    description: 'House coding style',
    content: 'Use tabs not spaces.\nAlways export named functions.',
    source: 'test',
  }
  const skillB: SkillDefinition = {
    name: 'review-rubric',
    description: 'How reviewers must think',
    content: 'Check acceptance criteria first.',
    source: 'test',
  }

  it('returns base prompt unchanged when skills array is empty', () => {
    expect(composeSystemPromptWithSkills('BASE', [])).toBe('BASE')
  })

  it('renders a ## Skills heading followed by each skill name/description/content', () => {
    const composed = composeSystemPromptWithSkills('BASE PROMPT', [skillA])
    expect(composed).toContain('BASE PROMPT')
    expect(composed).toContain('## Skills')
    expect(composed).toContain('### coding-conventions — House coding style')
    expect(composed).toContain('Use tabs not spaces.')
    expect(composed).toContain('Always export named functions.')
  })

  it('separates multiple skills and trims trailing separators', () => {
    const composed = composeSystemPromptWithSkills('BASE', [skillA, skillB])
    expect(composed).toContain('### coding-conventions')
    expect(composed).toContain('### review-rubric')
    expect(composed).toContain('---')
    expect(composed.endsWith('---')).toBe(false)
    expect(composed.endsWith('\n')).toBe(false)
    // skillA must appear before skillB
    expect(composed.indexOf('coding-conventions')).toBeLessThan(composed.indexOf('review-rubric'))
  })

  it('GuildhallAgent ctor composes skills into the system prompt sent to the API', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const agent = new GuildhallAgent({
      name: 'skilled',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'BASE SYSTEM',
      tools: [],
      skills: [skillA],
    })
    await agent.generate('go')
    const req = client.requests[0]
    const sys = req?.system_prompt ?? ''
    expect(sys).toContain('BASE SYSTEM')
    expect(sys).toContain('## Skills')
    expect(sys).toContain('### coding-conventions')
    expect(sys).toContain('Use tabs not spaces.')
  })

  it('GuildhallAgent with no skills sends the base prompt unmodified', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const agent = new GuildhallAgent({
      name: 'plain',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'BASE ONLY',
      tools: [],
    })
    await agent.generate('go')
    const sys = client.requests[0]?.system_prompt ?? ''
    expect(sys).toBe('BASE ONLY')
  })

  it('factory functions forward skills into the composed prompt', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const llm = { apiClient: client, modelId: 'm' }
    const agent = createSpecAgent(llm, { skills: [skillA] })
    await agent.generate('go')
    const sys = client.requests[0]?.system_prompt ?? ''
    expect(sys).toContain('## Skills')
    expect(sys).toContain('### coding-conventions')
  })
})

// ---------------------------------------------------------------------------
// FR-18 hookExecutor forwarding
// ---------------------------------------------------------------------------
describe('FR-18 hookExecutor forwarding', () => {
  it('GuildhallAgent forwards hookExecutor to the engine, firing USER_PROMPT_SUBMIT on generate', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const events: string[] = []
    const hookExecutor = {
      async execute(event: string) {
        events.push(event)
        return { blocked: false }
      },
    }
    const agent = new GuildhallAgent({
      name: 'hooked',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
      hookExecutor,
    })
    await agent.generate('hello')
    expect(events).toContain('user_prompt_submit')
  })

  it('GuildhallAgent with no hookExecutor skips hook execution entirely (no errors)', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const agent = new GuildhallAgent({
      name: 'plain',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'p',
      tools: [],
    })
    const result = await agent.generate('hi')
    expect(result.text).toBe('ok')
  })

  it('createSpecAgent forwards hookExecutor through the options bag', async () => {
    const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
    const events: string[] = []
    const hookExecutor = {
      async execute(event: string) {
        events.push(event)
        return { blocked: false }
      },
    }
    const agent = createSpecAgent(
      { apiClient: client, modelId: 'm' },
      { hookExecutor },
    )
    await agent.generate('go')
    expect(events).toContain('user_prompt_submit')
  })
})

describe('agent factories', () => {
  const client = new ScriptedApiClient([])
  const llm = { apiClient: client, modelId: 'test' }

  it('createSpecAgent returns a GuildhallAgent named "spec-agent"', () => {
    const a = createSpecAgent(llm)
    expect(a).toBeInstanceOf(GuildhallAgent)
    expect(a.name).toBe('spec-agent')
  })

  it('createWorkerAgent registers shell + file tools', async () => {
    const a = createWorkerAgent(llm)
    expect(a.name).toBe('worker-agent')
  })

  it('createWorkerAgent gives coding tasks a larger turn budget', async () => {
    const a = createWorkerAgent(llm)
    expect((a as unknown as { engine: { getMaxTurns(): number | null } }).engine.getMaxTurns())
      .toBe(24)
  })

  it('createReviewerAgent', () => {
    const a = createReviewerAgent(llm)
    expect(a.name).toBe('reviewer-agent')
  })

  it('createGateCheckerAgent', () => {
    const a = createGateCheckerAgent(llm)
    expect(a.name).toBe('gate-checker-agent')
  })

  // ------------------------------------------------------------------
  // extraTools injection — every factory must surface caller-provided
  // tools in the engine's tool registry. This is the seam MCP adapters
  // ride through the orchestrator.
  // ------------------------------------------------------------------
  describe('extraTools injection', () => {
    function stubTool(name: string) {
      return defineTool<Record<string, never>>({
        name,
        description: `stub ${name}`,
        inputSchema: z.object({}),
        jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: async () => ({ output: 'ok', is_error: false }),
      })
    }

    async function toolNamesAfterGenerate(agent: GuildhallAgent, client: ScriptedApiClient) {
      await agent.generate('go')
      return client.requests[0]?.tools.map((t) => t['name']) ?? []
    }

    it('createSpecAgent appends extraTools to its built-in set', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createSpecAgent(
        { apiClient: client, modelId: 'm' },
        { extraTools: [stubTool('mcp__x__ping')] },
      )
      const names = await toolNamesAfterGenerate(agent, client)
      expect(names).toContain('mcp__x__ping')
      expect(names).toContain('read-file') // built-ins preserved
    })

    it('createWorkerAgent appends extraTools', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createWorkerAgent(
        { apiClient: client, modelId: 'm' },
        { extraTools: [stubTool('mcp__x__tool')] },
      )
      const names = await toolNamesAfterGenerate(agent, client)
      expect(names).toContain('mcp__x__tool')
      expect(names).toContain('shell')
    })

    it('createReviewerAgent appends extraTools', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createReviewerAgent(
        { apiClient: client, modelId: 'm' },
        { extraTools: [stubTool('mcp__x__r')] },
      )
      const names = await toolNamesAfterGenerate(agent, client)
      expect(names).toContain('mcp__x__r')
    })

    it('createGateCheckerAgent appends extraTools', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createGateCheckerAgent(
        { apiClient: client, modelId: 'm' },
        { extraTools: [stubTool('mcp__x__g')] },
      )
      const names = await toolNamesAfterGenerate(agent, client)
      expect(names).toContain('mcp__x__g')
    })

    it('createGateCheckerAgent defaults to STANDARD_TS_GATES when no successGates passed', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createGateCheckerAgent({ apiClient: client, modelId: 'm' })
      await agent.generate('go')
      const sys = client.requests[0]?.system_prompt ?? ''
      expect(sys).toContain('typecheck')
      expect(sys).toContain('falling back to the TypeScript defaults')
    })

    it("createGateCheckerAgent uses project's successGates verbatim when provided", async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const agent = createGateCheckerAgent(
        { apiClient: client, modelId: 'm' },
        { successGates: ['pnpm typecheck', 'pnpm test', 'cargo clippy -- -D warnings'] },
      )
      await agent.generate('go')
      const sys = client.requests[0]?.system_prompt ?? ''
      expect(sys).toContain('`pnpm typecheck`')
      expect(sys).toContain('`pnpm test`')
      expect(sys).toContain('`cargo clippy -- -D warnings`')
      expect(sys).toContain('verified `bootstrap.successGates`')
      expect(sys).not.toContain('falling back to the TypeScript defaults')
    })

    it('createCoordinatorAgent appends extraTools', async () => {
      const client = new ScriptedApiClient([{ message: assistantMsg('ok') }])
      const domain: CoordinatorDomain = {
        id: 'looma',
        name: 'Looma',
        mandate: 'UI quality.',
        projectPaths: [],
        concerns: [],
        autonomousDecisions: [],
        escalationTriggers: [],
      }
      const agent = createCoordinatorAgent(
        domain,
        { apiClient: client, modelId: 'm' },
        { extraTools: [stubTool('mcp__x__c')] },
      )
      const names = await toolNamesAfterGenerate(agent, client)
      expect(names).toContain('mcp__x__c')
    })
  })

  it('createCoordinatorAgent interpolates the domain name', () => {
    const domain: CoordinatorDomain = {
      id: 'looma',
      name: 'Looma',
      mandate: 'Oversee UI quality.',
      projectPaths: ['/x'],
      concerns: [{ id: 'a11y', description: 'Accessibility', reviewQuestions: ['Is it a11y?'] }],
      autonomousDecisions: ['minor copy tweaks'],
      escalationTriggers: ['a11y regression'],
    }
    const a = createCoordinatorAgent(domain, llm)
    expect(a.name).toBe('coordinator-looma')
  })
})

// ---------------------------------------------------------------------------
// FR-20: session persistence — save after each turn, load for mid-turn resume.
//
// We redirect the sessions package's config dir to a per-test tmp so the
// snapshots land in a sandbox and don't pollute the user's ~/.guildhall.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach } from 'vitest'

describe('GuildhallAgent — FR-20 session persistence', () => {
  let sessionBase: string
  let projectCwd: string

  beforeEach(() => {
    sessionBase = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-agent-sess-'))
    process.env.GUILDHALL_CONFIG_DIR = sessionBase
    projectCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'guildhall-agent-proj-'))
  })

  afterEach(() => {
    delete process.env.GUILDHALL_CONFIG_DIR
    delete process.env.GUILDHALL_DATA_DIR
    fs.rmSync(sessionBase, { recursive: true, force: true })
    fs.rmSync(projectCwd, { recursive: true, force: true })
  })

  it('auto-persists a snapshot after each successful generate()', async () => {
    const client = new ScriptedApiClient([
      { message: assistantMsg('first reply'), usage: { input_tokens: 5, output_tokens: 3 } },
    ])
    const agent = new GuildhallAgent({
      name: 'persisting',
      llm: { apiClient: client, modelId: 'test-model' },
      systemPrompt: 'sys',
      tools: [],
      sessionPersistence: { cwd: projectCwd, sessionId: 'sess-aaa' },
    })
    await agent.generate('first user prompt')

    // Rebuild a fresh agent against an empty script and confirm the snapshot
    // rehydrates messages + usage + tool metadata.
    const reloader = new GuildhallAgent({
      name: 'reload',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'test-model' },
      systemPrompt: 'sys',
      tools: [],
    })
    const found = reloader.loadSession({ cwd: projectCwd, sessionId: 'sess-aaa' })
    expect(found).toBe(true)
    expect(reloader.messages).toHaveLength(2)
    expect(reloader.messages[0]?.role).toBe('user')
    expect(reloader.messages[1]?.role).toBe('assistant')
    expect(reloader.totalUsage).toEqual({ input_tokens: 5, output_tokens: 3 })
  })

  it('persists a recoverable snapshot when generate stops on max turns', async () => {
    const client = new ScriptedApiClient([
      {
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu-1', name: 'shell', input: { command: 'echo hi' } },
          ],
        },
        usage: { input_tokens: 5, output_tokens: 3 },
      },
    ])
    const agent = new GuildhallAgent({
      name: 'persisting-error',
      llm: { apiClient: client, modelId: 'test-model' },
      systemPrompt: 'sys',
      tools: [shellTool],
      maxTurns: 1,
      sessionPersistence: { cwd: projectCwd, sessionId: 'max-turn' },
    })

    await expect(agent.generate('run a command')).rejects.toThrow('Exceeded maximum turn limit (1)')

    const reloader = new GuildhallAgent({
      name: 'reload',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'test-model' },
      systemPrompt: 'sys',
      tools: [shellTool],
    })
    expect(reloader.loadSession({ cwd: projectCwd, sessionId: 'max-turn' })).toBe(true)
    expect(reloader.messages).toHaveLength(3)
    expect(reloader.hasPendingContinuation()).toBe(true)
  })

  it('loadSession returns false when no snapshot exists', () => {
    const agent = new GuildhallAgent({
      name: 'cold',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: '',
      tools: [],
    })
    expect(agent.loadSession({ cwd: projectCwd, sessionId: 'nope' })).toBe(false)
    expect(agent.loadSession({ cwd: projectCwd })).toBe(false)
  })

  it('saveSession is a no-op when session persistence is not configured', () => {
    const agent = new GuildhallAgent({
      name: 'no-persist',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: '',
      tools: [],
    })
    expect(agent.saveSession()).toBeNull()
  })

  it('mid-turn resume: tool-result tail triggers continue() instead of a fresh prompt', async () => {
    // The engine considers a conversation "pending continuation" when the
    // tail is a user tool_result following an assistant tool_use. We simulate
    // that scenario by directly shaping the message list and persisting, then
    // rehydrating into a new agent and driving continue() to finish the turn.
    const toolUseMsg: ConversationMessage = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'reading file' },
        { type: 'tool_use', id: 'tu-1', name: 'shell', input: { command: 'ls' } },
      ],
    }
    const toolResultMsg: ConversationMessage = {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'file.txt', is_error: false }],
    }

    // Build an agent, stuff its engine history directly, persist.
    const saver = new GuildhallAgent({
      name: 'saver',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'm' },
      systemPrompt: 'sys',
      tools: [],
      sessionPersistence: { cwd: projectCwd, sessionId: 'mid-turn' },
    })
    // loadSession can also accept a pre-shaped payload; easier to write a
    // snapshot via the engine by loading + saving.
    ;(saver as unknown as { engine: { loadMessages: (m: ConversationMessage[]) => void } })
      .engine.loadMessages([
        { role: 'user', content: [{ type: 'text', text: 'please list files' }] },
        toolUseMsg,
        toolResultMsg,
      ])
    saver.saveSession()

    // New agent: rehydrate, verify the pending flag, then continue the turn
    // against a scripted client that returns the final assistant message.
    const client = new ScriptedApiClient([
      { message: assistantMsg('file.txt is there'), usage: { input_tokens: 2, output_tokens: 3 } },
    ])
    const resumer = new GuildhallAgent({
      name: 'resumer',
      llm: { apiClient: client, modelId: 'm' },
      systemPrompt: 'sys',
      tools: [shellTool],
    })
    expect(resumer.loadSession({ cwd: projectCwd, sessionId: 'mid-turn' })).toBe(true)
    expect(resumer.hasPendingContinuation()).toBe(true)

    const result = await resumer.continue()
    expect(result.text).toBe('file.txt is there')
    // Final history: user prompt, assistant tool_use, user tool_result, assistant final
    expect(resumer.messages).toHaveLength(4)
    expect(resumer.messages[3]?.role).toBe('assistant')
  })

  it('saveSession with overrides writes a snapshot even without ctor config', async () => {
    const client = new ScriptedApiClient([
      { message: assistantMsg('one-shot'), usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    const agent = new GuildhallAgent({
      name: 'one-shot',
      llm: { apiClient: client, modelId: 'test-model' },
      systemPrompt: 'sys',
      tools: [],
    })
    await agent.generate('hello')
    const written = agent.saveSession({ cwd: projectCwd, sessionId: 'manual-id' })
    expect(written).not.toBeNull()

    const reloader = new GuildhallAgent({
      name: 'reload',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'test-model' },
      systemPrompt: '',
      tools: [],
    })
    expect(reloader.loadSession({ cwd: projectCwd, sessionId: 'manual-id' })).toBe(true)
    expect(reloader.messages).toHaveLength(2)
  })

  it('loadSession refuses snapshots saved for a different model', async () => {
    const client = new ScriptedApiClient([
      { message: assistantMsg('old-model reply'), usage: { input_tokens: 1, output_tokens: 1 } },
    ])
    const saver = new GuildhallAgent({
      name: 'saver',
      llm: { apiClient: client, modelId: 'old-model' },
      systemPrompt: 'sys',
      tools: [],
      sessionPersistence: { cwd: projectCwd, sessionId: 'model-bound' },
    })
    await saver.generate('hello')

    const reloader = new GuildhallAgent({
      name: 'reload',
      llm: { apiClient: new ScriptedApiClient([]), modelId: 'new-model' },
      systemPrompt: 'sys',
      tools: [],
    })
    expect(reloader.loadSession({ cwd: projectCwd, sessionId: 'model-bound' })).toBe(false)
    expect(reloader.messages).toHaveLength(0)
  })
})
