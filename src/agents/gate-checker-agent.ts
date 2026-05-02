import {
  shellTool,
  readTasksTool,
  updateTaskTool,
  logDecisionTool,
  logProgressTool,
  runGatesTool,
  raiseEscalationTool,
} from '@guildhall/tools'
import { STANDARD_TS_GATES } from '@guildhall/core'
import { GuildhallAgent } from './guildhall-agent.js'
import type { AgentLLM } from './llm.js'
import type { SkillDefinition } from '@guildhall/skills'
import type { AnyTool, Compactor, HookExecutor } from '@guildhall/engine'

function renderGateDescriptions(gates: readonly string[] | undefined): {
  descriptions: string
  source: 'project-bootstrap' | 'standard-ts'
} {
  if (gates !== undefined) {
    return {
      descriptions:
        gates.length > 0
          ? gates.map((g) => `- \`${g}\``).join('\n')
          : '- No verified shell gates are currently configured for this project bootstrap.',
      source: 'project-bootstrap',
    }
  }
  return {
    descriptions: Object.values(STANDARD_TS_GATES)
      .map((g) => `- ${g.id}: \`${g.command}\``)
      .join('\n'),
    source: 'standard-ts',
  }
}

function buildPrompt(gates: readonly string[] | undefined): string {
  const { descriptions, source } = renderGateDescriptions(gates)
  const sourceLine =
    source === 'project-bootstrap'
      ? "These are the project's verified bootstrap gates from guildhall.yaml. They were empirically established during meta-intake or bootstrap verification and are the authoritative list for this project. Do not invent extra gates beyond this list."
      : 'No project-level gates configured — falling back to the TypeScript defaults. When in doubt, run typecheck and build at minimum.'
  return `
You are the Gate Checker Agent in the Guildhall multi-agent system.
You run automated hard gates to verify that completed work actually passes.

## Hard gates
${sourceLine}

${descriptions}

## Process

1. Read the task (status should be 'gate_check').
2. Run the gates above against the task's projectPath.
3. Prefer the run-gates tool: it runs each gate serially, captures output, and
   reports pass/fail. Use shell only for ad-hoc checks not in the registered set.
4. Record each result (passed/failed, output) in the task's gateResults.

## Outcomes

All gates pass:
- Set task status to 'done'
- Set completedAt to now
- Log a 'milestone' progress entry: "Task [id] complete. All gates passed."

Any gate fails:
- Add a note with the exact gate output (truncated to 50 lines if very long)
- Increment revisionCount
- Set status back to 'in_progress'
- Log a 'heartbeat' progress entry: "Gate [id] failed on task [id]. Returning to worker."

## Escalation (FR-10)
If a hard gate cannot be made to pass (e.g. environment-level failure,
infrastructure outage, or a gate that times out even after a clean rerun),
use raise-escalation with reason='gate_hard_failure'. Do not set the task
to 'blocked' by hand.

## Important
- Never skip a gate. Hard gates are non-negotiable.
- If a gate times out once, treat it as a failure and send the task back to
  'in_progress' for the worker to address. Only escalate when the failure is
  beyond the worker's reach.
- Do not attempt to fix the code yourself. Your job is only to run and report.
`.trim()
}

export function createGateCheckerAgent(
  llm: AgentLLM,
  opts: {
    skills?: readonly SkillDefinition[]
    hookExecutor?: HookExecutor
    compactor?: Compactor
    cwd?: string
    sessionPersistence?: { cwd: string; sessionId?: string }
    /** Optional tools appended to the factory's built-in set (e.g. MCP adapters). */
    extraTools?: readonly AnyTool[]
    /**
     * Verified success-gate commands from the project's `bootstrap` block.
     * When present, the agent is told to run these (and only these); when
     * absent, the prompt falls back to STANDARD_TS_GATES so legacy projects
     * without a bootstrap block still get sensible behaviour.
     */
    successGates?: readonly string[]
  } = {},
): GuildhallAgent {
  return new GuildhallAgent({
    name: 'gate-checker-agent',
    llm,
    systemPrompt: buildPrompt(opts.successGates),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    tools: [runGatesTool, shellTool, readTasksTool, updateTaskTool, logDecisionTool, logProgressTool, raiseEscalationTool, ...(opts.extraTools ?? [])],
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
    ...(opts.compactor ? { compactor: opts.compactor } : {}),
    ...(opts.sessionPersistence ? { sessionPersistence: opts.sessionPersistence } : {}),
  })
}
