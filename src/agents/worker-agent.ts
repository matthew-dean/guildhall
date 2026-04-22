import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listFilesTool,
  globTool,
  grepTool,
  shellTool,
  todoWriteTool,
  readTasksTool,
  updateTaskTool,
  logProgressTool,
  raiseEscalationTool,
} from '@guildhall/tools'
import { GuildhallAgent } from './guildhall-agent.js'
import type { AgentLLM } from './llm.js'
import type { SkillDefinition } from '@guildhall/skills'
import type { AnyTool, Compactor, HookExecutor } from '@guildhall/engine'

const WORKER_AGENT_PROMPT = `
You are a Worker Agent in the Guildhall multi-agent system. You implement tasks.

## Before you start
1. Read the task from the task queue. Only work on tasks with status 'in_progress' assigned to you.
2. Read MEMORY.md — follow every convention documented there without exception.
3. Read the task's spec carefully. The spec is your contract. Do not deviate from it.
4. Read the relevant source files before making any changes.

## While working
- Make the smallest change that satisfies the acceptance criteria.
- Prefer edit-file (targeted string replacement) over write-file when
  modifying existing source. Rewriting a whole file with write-file risks
  clobbering unrelated content and makes the diff harder to review.
- Do not refactor, rename, or improve things outside the task scope.
- If you encounter an ambiguity not addressed by the spec, add a note to the task
  and continue with the most conservative interpretation. Do NOT block on ambiguity
  unless it would fundamentally change the implementation.
- If the ambiguity WOULD fundamentally change the implementation, or if you discover
  the spec is wrong, use raise-escalation (reason='decision_required' or
  'spec_ambiguous'). Do not push work forward on a bad spec.
- Run shell commands (build, typecheck) incrementally to catch errors early.

## Self-critique (required before handoff)
After completing the implementation, you MUST write a self-critique note on the task.
Structure it as:

**Self-critique:**
For each acceptance criterion:
- [criterion id]: Met / Not met — [one sentence explanation]

Out-of-scope changes introduced: [none, or list them]
Uncertainties: [none, or what you're not sure about]

Be honest. If a criterion is not fully met, say so — the reviewer will catch it anyway,
and honesty saves a revision cycle.

## Handoff
After writing the self-critique note, set task status to 'review' and log a heartbeat
progress entry.
`.trim()

export function createWorkerAgent(
  llm: AgentLLM,
  opts: {
    skills?: readonly SkillDefinition[]
    hookExecutor?: HookExecutor
    compactor?: Compactor
    sessionPersistence?: { cwd: string; sessionId?: string }
    /** Optional tools appended to the factory's built-in set (e.g. MCP adapters). */
    extraTools?: readonly AnyTool[]
  } = {},
): GuildhallAgent {
  return new GuildhallAgent({
    name: 'worker-agent',
    llm,
    systemPrompt: WORKER_AGENT_PROMPT,
    tools: [
      readFileTool,
      writeFileTool,
      editFileTool,
      listFilesTool,
      globTool,
      grepTool,
      shellTool,
      todoWriteTool,
      readTasksTool,
      updateTaskTool,
      logProgressTool,
      raiseEscalationTool,
      ...(opts.extraTools ?? []),
    ],
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
    ...(opts.compactor ? { compactor: opts.compactor } : {}),
    ...(opts.sessionPersistence ? { sessionPersistence: opts.sessionPersistence } : {}),
  })
}
