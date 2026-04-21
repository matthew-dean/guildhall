/**
 * Ported from openharness/src/openharness/engine/query.py
 *   (the `_remember_*` / `_record_tool_carryover` / `remember_user_goal`
 *    helpers — roughly lines 100–453 of upstream).
 * Upstream: https://github.com/HKUDS/OpenHarness (MIT)
 * Upstream SHA at port time: 559ba76f237db957a1a21453170df8500479dc7d
 *
 * Changes from upstream:
 *   - Split into its own module so the query loop file stays focused on
 *     conversation control flow rather than prompt-builder state.
 *   - `dict[str, object]` → `Record<string, unknown>`. Python `setdefault`
 *     and `list[Any]` mutation patterns are preserved (we still mutate the
 *     shared metadata bag in place, matching upstream semantics).
 *   - Tool names are matched against the Claude-convention names
 *     (`Read`, `Bash`, `Grep`, `Glob`, `TodoWrite`, `WebFetch`, `WebSearch`,
 *     `Task` for sub-agent spawn, `SendMessage`, `ExitPlanMode`,
 *     `EnterPlanMode`, `Skill`) AS WELL AS upstream's snake_case names
 *     (`read_file`, `bash`, `grep`, `glob`, `web_fetch`, `web_search`,
 *     `agent`, `send_message`, `enter_plan_mode`, `exit_plan_mode`,
 *     `skill`). Guildhall tools adopt the CamelCase form but we keep both
 *     so vendored upstream tools or test doubles still populate carryover.
 *   - `time.time()` (float seconds) → `Date.now() / 1000` to match the
 *     upstream numeric shape (seconds since epoch as a float).
 *   - Regex port: `r"Spawned agent (.+?) \(task_id=(\S+?)(?:[,)]|$)"` →
 *     the same pattern as a JS RegExp literal.
 */

export const MAX_TRACKED_READ_FILES = 6
export const MAX_TRACKED_SKILLS = 8
export const MAX_TRACKED_ASYNC_AGENT_EVENTS = 8
export const MAX_TRACKED_ASYNC_AGENT_TASKS = 12
export const MAX_TRACKED_WORK_LOG = 10
export const MAX_TRACKED_USER_GOALS = 5
export const MAX_TRACKED_ACTIVE_ARTIFACTS = 8
export const MAX_TRACKED_VERIFIED_WORK = 10

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

export function appendCappedUnique<T>(bucket: T[], value: T, limit: number): void {
  const idx = bucket.indexOf(value)
  if (idx !== -1) bucket.splice(idx, 1)
  bucket.push(value)
  if (bucket.length > limit) bucket.splice(0, bucket.length - limit)
}

function metadataBucket(
  toolMetadata: Record<string, unknown> | undefined | null,
  key: string,
): unknown[] {
  if (toolMetadata == null) return []
  const existing = toolMetadata[key]
  if (Array.isArray(existing)) return existing as unknown[]
  const replacement: unknown[] = []
  toolMetadata[key] = replacement
  return replacement
}

export interface TaskFocusState {
  goal: string
  recent_goals: string[]
  active_artifacts: string[]
  verified_state: string[]
  next_step: string
}

function defaultTaskFocusState(): TaskFocusState {
  return {
    goal: '',
    recent_goals: [],
    active_artifacts: [],
    verified_state: [],
    next_step: '',
  }
}

export function taskFocusState(
  toolMetadata: Record<string, unknown> | undefined | null,
): TaskFocusState {
  if (toolMetadata == null) return defaultTaskFocusState()
  const existing = toolMetadata['task_focus_state']
  if (existing != null && typeof existing === 'object' && !Array.isArray(existing)) {
    const rec = existing as Record<string, unknown>
    rec['goal'] ??= ''
    rec['recent_goals'] ??= []
    rec['active_artifacts'] ??= []
    rec['verified_state'] ??= []
    rec['next_step'] ??= ''
    return rec as unknown as TaskFocusState
  }
  const replacement = defaultTaskFocusState()
  toolMetadata['task_focus_state'] = replacement
  return replacement
}

function summarizeFocusText(text: string): string {
  const normalized = text.split(/\s+/).filter(Boolean).join(' ')
  if (!normalized) return ''
  return normalized.slice(0, 240)
}

function nowSeconds(): number {
  return Date.now() / 1000
}

// ---------------------------------------------------------------------------
// Individual `_remember_*` helpers
// ---------------------------------------------------------------------------

export function rememberUserGoal(
  toolMetadata: Record<string, unknown> | undefined | null,
  prompt: string,
): void {
  const summary = summarizeFocusText(prompt)
  if (!summary) return
  const state = taskFocusState(toolMetadata)
  appendCappedUnique(state.recent_goals, summary, MAX_TRACKED_USER_GOALS)
  state.goal = summary
}

export function rememberActiveArtifact(
  toolMetadata: Record<string, unknown> | undefined | null,
  artifact: string,
): void {
  const normalized = artifact.trim()
  if (!normalized) return
  const state = taskFocusState(toolMetadata)
  appendCappedUnique(state.active_artifacts, normalized.slice(0, 240), MAX_TRACKED_ACTIVE_ARTIFACTS)
}

export function rememberVerifiedWork(
  toolMetadata: Record<string, unknown> | undefined | null,
  entry: string,
): void {
  const normalized = entry.trim()
  if (!normalized) return
  const bucket = metadataBucket(toolMetadata, 'recent_verified_work') as string[]
  appendCappedUnique(bucket, normalized.slice(0, 320), MAX_TRACKED_VERIFIED_WORK)
  const state = taskFocusState(toolMetadata)
  appendCappedUnique(state.verified_state, normalized.slice(0, 320), MAX_TRACKED_VERIFIED_WORK)
}

export interface ReadFileEntry {
  path: string
  span: string
  preview: string
  timestamp: number
}

export function rememberReadFile(
  toolMetadata: Record<string, unknown> | undefined | null,
  params: { path: string; offset: number; limit: number; output: string },
): void {
  const bucket = metadataBucket(toolMetadata, 'read_file_state') as ReadFileEntry[]
  const previewLines = params.output
    .split('\n')
    .slice(0, 6)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const entry: ReadFileEntry = {
    path: params.path,
    span: `lines ${params.offset + 1}-${params.offset + params.limit}`,
    preview: previewLines.join(' | ').slice(0, 320),
    timestamp: nowSeconds(),
  }
  // Filter out existing entries for the same path, then append and cap.
  const filtered = bucket.filter(
    (e) => !(e && typeof e === 'object' && (e as unknown as Record<string, unknown>).path === params.path),
  )
  filtered.push(entry)
  bucket.splice(0, bucket.length, ...filtered)
  if (bucket.length > MAX_TRACKED_READ_FILES) {
    bucket.splice(0, bucket.length - MAX_TRACKED_READ_FILES)
  }
}

export function rememberSkillInvocation(
  toolMetadata: Record<string, unknown> | undefined | null,
  params: { skillName: string },
): void {
  const normalized = params.skillName.trim()
  if (!normalized) return
  const bucket = metadataBucket(toolMetadata, 'invoked_skills') as string[]
  appendCappedUnique(bucket, normalized, MAX_TRACKED_SKILLS)
}

export function rememberAsyncAgentActivity(
  toolMetadata: Record<string, unknown> | undefined | null,
  params: {
    toolName: string
    toolInput: Record<string, unknown>
    output: string
  },
): void {
  const bucket = metadataBucket(toolMetadata, 'async_agent_state') as string[]
  let summary: string
  if (params.toolName === 'agent' || params.toolName === 'Task' || params.toolName === 'Agent') {
    const description = String(
      params.toolInput['description'] ?? params.toolInput['prompt'] ?? '',
    ).trim()
    summary = `Spawned async agent. ${description}`.trim()
    if (params.output.trim()) {
      summary = `${summary} [${params.output.trim().slice(0, 180)}]`.trim()
    }
  } else if (params.toolName === 'send_message' || params.toolName === 'SendMessage') {
    const target = String(params.toolInput['task_id'] ?? '').trim()
    summary = `Sent follow-up message to async agent ${target}`.trim()
  } else {
    summary = params.output.trim().slice(0, 220) || `Async agent activity via ${params.toolName}`
  }
  bucket.push(summary)
  if (bucket.length > MAX_TRACKED_ASYNC_AGENT_EVENTS) {
    bucket.splice(0, bucket.length - MAX_TRACKED_ASYNC_AGENT_EVENTS)
  }
}

const SPAWNED_AGENT_RE = /Spawned agent (.+?) \(task_id=(\S+?)(?:[,)]|$)/

function parseSpawnedAgentIdentity(
  output: string,
  metadata: Record<string, unknown> | null | undefined,
): [string, string] | null {
  if (metadata != null && typeof metadata === 'object') {
    const agentId = String(metadata['agent_id'] ?? '').trim()
    const taskId = String(metadata['task_id'] ?? '').trim()
    if (agentId && taskId) return [agentId, taskId]
  }
  const m = SPAWNED_AGENT_RE.exec(output.trim())
  if (m === null) return null
  return [m[1]!.trim(), m[2]!.trim()]
}

export interface AsyncAgentTaskEntry {
  agent_id: string
  task_id: string
  description: string
  status: string
  notification_sent: boolean
  spawned_at: number
}

export function rememberAsyncAgentTask(
  toolMetadata: Record<string, unknown> | undefined | null,
  params: {
    toolName: string
    toolInput: Record<string, unknown>
    output: string
    resultMetadata?: Record<string, unknown> | null
  },
): void {
  if (params.toolName !== 'agent' && params.toolName !== 'Task' && params.toolName !== 'Agent') {
    return
  }
  const identity = parseSpawnedAgentIdentity(params.output, params.resultMetadata ?? null)
  if (identity === null) return
  const [agentId, taskId] = identity
  const bucket = metadataBucket(toolMetadata, 'async_agent_tasks') as AsyncAgentTaskEntry[]
  const description = String(
    params.toolInput['description'] ?? params.toolInput['prompt'] ?? '',
  ).trim()
  const entry: AsyncAgentTaskEntry = {
    agent_id: agentId,
    task_id: taskId,
    description: description.slice(0, 240),
    status: 'spawned',
    notification_sent: false,
    spawned_at: nowSeconds(),
  }
  const filtered = bucket.filter(
    (e) =>
      !(e && typeof e === 'object' && (e as unknown as Record<string, unknown>).task_id === taskId),
  )
  filtered.push(entry)
  bucket.splice(0, bucket.length, ...filtered)
  if (bucket.length > MAX_TRACKED_ASYNC_AGENT_TASKS) {
    bucket.splice(0, bucket.length - MAX_TRACKED_ASYNC_AGENT_TASKS)
  }
}

export function rememberWorkLog(
  toolMetadata: Record<string, unknown> | undefined | null,
  params: { entry: string },
): void {
  const normalized = params.entry.trim()
  if (!normalized) return
  const bucket = metadataBucket(toolMetadata, 'recent_work_log') as string[]
  bucket.push(normalized.slice(0, 320))
  if (bucket.length > MAX_TRACKED_WORK_LOG) {
    bucket.splice(0, bucket.length - MAX_TRACKED_WORK_LOG)
  }
}

export function updatePlanMode(
  toolMetadata: Record<string, unknown> | undefined | null,
  mode: string,
): void {
  if (toolMetadata == null) return
  toolMetadata['permission_mode'] = mode
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

function isReadTool(name: string): boolean {
  return name === 'read_file' || name === 'Read' || name === 'ReadFile'
}
function isBashTool(name: string): boolean {
  return name === 'bash' || name === 'Bash'
}
function isGrepTool(name: string): boolean {
  return name === 'grep' || name === 'Grep'
}
function isGlobTool(name: string): boolean {
  return name === 'glob' || name === 'Glob'
}
function isWebFetchTool(name: string): boolean {
  return name === 'web_fetch' || name === 'WebFetch'
}
function isWebSearchTool(name: string): boolean {
  return name === 'web_search' || name === 'WebSearch'
}
function isAgentTool(name: string): boolean {
  return name === 'agent' || name === 'Task' || name === 'Agent'
}
function isSendMessageTool(name: string): boolean {
  return name === 'send_message' || name === 'SendMessage'
}
function isSkillTool(name: string): boolean {
  return name === 'skill' || name === 'Skill'
}
function isEnterPlanModeTool(name: string): boolean {
  return name === 'enter_plan_mode' || name === 'EnterPlanMode'
}
function isExitPlanModeTool(name: string): boolean {
  return name === 'exit_plan_mode' || name === 'ExitPlanMode'
}

export interface RecordToolCarryoverParams {
  toolMetadata: Record<string, unknown> | undefined | null
  toolName: string
  toolInput: Record<string, unknown>
  toolOutput: string
  toolResultMetadata?: Record<string, unknown> | null
  isError: boolean
  resolvedFilePath: string | null
}

export function recordToolCarryover(params: RecordToolCarryoverParams): void {
  const { toolMetadata, toolName, toolInput, toolOutput, isError, resolvedFilePath } = params
  if (isError) return

  if (resolvedFilePath !== null) {
    rememberActiveArtifact(toolMetadata, resolvedFilePath)
  }

  if (isReadTool(toolName) && resolvedFilePath !== null) {
    const offset = Number(toolInput['offset'] ?? 0) || 0
    const limit = Number(toolInput['limit'] ?? 200) || 200
    rememberReadFile(toolMetadata, {
      path: resolvedFilePath,
      offset,
      limit,
      output: toolOutput,
    })
    rememberVerifiedWork(
      toolMetadata,
      `Inspected file ${resolvedFilePath} (lines ${offset + 1}-${offset + limit})`,
    )
  } else if (isSkillTool(toolName)) {
    const skillName = String(toolInput['name'] ?? '').trim()
    rememberSkillInvocation(toolMetadata, { skillName })
    if (skillName) {
      rememberActiveArtifact(toolMetadata, `skill:${skillName}`)
      rememberVerifiedWork(toolMetadata, `Loaded skill ${skillName}`)
    }
  } else if (isAgentTool(toolName) || isSendMessageTool(toolName)) {
    rememberAsyncAgentActivity(toolMetadata, {
      toolName,
      toolInput,
      output: toolOutput,
    })
    rememberAsyncAgentTask(toolMetadata, {
      toolName,
      toolInput,
      output: toolOutput,
      resultMetadata: params.toolResultMetadata ?? null,
    })
    const description = String(
      toolInput['description'] ?? toolInput['prompt'] ?? toolName,
    ).trim()
    rememberVerifiedWork(
      toolMetadata,
      `Confirmed async-agent activity via ${toolName}: ${description.slice(0, 180)}`,
    )
  } else if (isEnterPlanModeTool(toolName)) {
    updatePlanMode(toolMetadata, 'plan')
  } else if (isExitPlanModeTool(toolName)) {
    updatePlanMode(toolMetadata, 'default')
  } else if (isWebFetchTool(toolName)) {
    const url = String(toolInput['url'] ?? '').trim()
    if (url) {
      rememberActiveArtifact(toolMetadata, url)
      rememberVerifiedWork(toolMetadata, `Fetched remote content from ${url}`)
    }
  } else if (isWebSearchTool(toolName)) {
    const query = String(toolInput['query'] ?? '').trim()
    if (query) {
      rememberVerifiedWork(toolMetadata, `Ran web search for ${query.slice(0, 180)}`)
    }
  } else if (isGlobTool(toolName)) {
    const pattern = String(toolInput['pattern'] ?? '').trim()
    if (pattern) {
      rememberVerifiedWork(toolMetadata, `Expanded glob pattern ${pattern.slice(0, 180)}`)
    }
  } else if (isGrepTool(toolName)) {
    const pattern = String(toolInput['pattern'] ?? '').trim()
    if (pattern) {
      rememberVerifiedWork(
        toolMetadata,
        `Checked repository matches for grep pattern ${pattern.slice(0, 180)}`,
      )
    }
  } else if (isBashTool(toolName)) {
    const command = String(toolInput['command'] ?? '').trim()
    const firstLine = toolOutput.trim() ? toolOutput.split('\n')[0]!.trim() : 'no output'
    rememberVerifiedWork(
      toolMetadata,
      `Ran bash command ${command.slice(0, 160)} [${firstLine.slice(0, 120)}]`,
    )
  }

  // Work log entries (upstream has a parallel switch block for this)
  if (isReadTool(toolName) && resolvedFilePath !== null) {
    rememberWorkLog(toolMetadata, { entry: `Read file ${resolvedFilePath}` })
  } else if (isBashTool(toolName)) {
    const command = String(toolInput['command'] ?? '').trim()
    const firstLine = toolOutput.trim() ? toolOutput.split('\n')[0]!.trim() : 'no output'
    rememberWorkLog(toolMetadata, {
      entry: `Ran bash: ${command.slice(0, 160)} [${firstLine.slice(0, 120)}]`,
    })
  } else if (isGrepTool(toolName)) {
    const pattern = String(toolInput['pattern'] ?? '').trim()
    rememberWorkLog(toolMetadata, {
      entry: `Searched with grep pattern=${pattern.slice(0, 160)}`,
    })
  } else if (isSkillTool(toolName)) {
    rememberWorkLog(toolMetadata, {
      entry: `Loaded skill ${String(toolInput['name'] ?? '').trim()}`,
    })
  } else if (isAgentTool(toolName) || isSendMessageTool(toolName)) {
    rememberWorkLog(toolMetadata, { entry: `Async agent action via ${toolName}` })
  } else if (isEnterPlanModeTool(toolName)) {
    rememberWorkLog(toolMetadata, { entry: 'Entered plan mode' })
  } else if (isExitPlanModeTool(toolName)) {
    rememberWorkLog(toolMetadata, { entry: 'Exited plan mode' })
  }
}
