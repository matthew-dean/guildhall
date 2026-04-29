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
  writeCheckpointTool,
  raiseEscalationTool,
  webFetchTool,
  webSearchTool,
  skillTool,
  notebookEditTool,
  sleepTool,
  briefTool,
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

## Task tools vs implementation files
- TASKS.json is state, not the implementation target. Read it only to confirm task state,
  and update it only when recording concrete progress, self-critique, or status.
- Do not edit TASKS.json with read-file/edit-file/write-file. Use update-task,
  write-checkpoint, log-progress, or raise-escalation for task state.
- When a tool requires taskId, use the exact current task id from the prompt.
  Never use placeholders like [TASK_ID], <task-id>, or TODO.
- Before claiming the implementation is complete, inspect the source and test files
  named by the spec and run the relevant command. A self-critique without file
  inspection and verification is not acceptable.

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

## No plan-only turns
Every assistant turn must make observable progress. Before ending a turn, do one
of these:
- call a tool that reads, edits, searches, runs a command, or otherwise changes
  what you know or what is on disk;
- update the task with concrete progress, a self-critique, or the next status;
- raise an escalation if the task is blocked.

Do not end a turn with only a plan, checklist, explanation, or promise about what
you will do next. If you know the next step, take it with a tool call in the same
turn.

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
After writing the self-critique note, write a checkpoint, set task status to
'review', and log a heartbeat progress entry.
`.trim()

const WORKER_NO_TOOL_TURN_NUDGE = `
Your last response did not call a tool or update task state. Take the next
concrete step now. If you need more information, call a read/search/shell tool.
If you can edit, call edit-file or write-file. If the task is blocked, call
raise-escalation.

Do not say "I will now", "I will start", "in a new turn", or describe future
work. This is the turn. Your response must include a tool call unless you are
raising an escalation.
`.trim()

export function createWorkerAgent(
  llm: AgentLLM,
  opts: {
    skills?: readonly SkillDefinition[]
    hookExecutor?: HookExecutor
    compactor?: Compactor
    cwd?: string
    sessionPersistence?: { cwd: string; sessionId?: string }
    /** Optional tools appended to the factory's built-in set (e.g. MCP adapters). */
    extraTools?: readonly AnyTool[]
  } = {},
): GuildhallAgent {
  return new GuildhallAgent({
    name: 'worker-agent',
    llm,
    systemPrompt: WORKER_AGENT_PROMPT,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    maxTurns: 24,
    noToolTurnNudge: WORKER_NO_TOOL_TURN_NUDGE,
    noToolTurnNudgeLimit: 3,
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
      writeCheckpointTool,
      logProgressTool,
      raiseEscalationTool,
      webFetchTool,
      webSearchTool,
      skillTool,
      notebookEditTool,
      sleepTool,
      briefTool,
      ...(opts.extraTools ?? []),
    ],
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
    ...(opts.compactor ? { compactor: opts.compactor } : {}),
    ...(opts.sessionPersistence ? { sessionPersistence: opts.sessionPersistence } : {}),
  })
}
