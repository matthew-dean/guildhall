import {
  readFileTool,
  readTasksTool,
  updateTaskTool,
  addTaskTool,
  logDecisionTool,
  logProgressTool,
  updateMemoryTool,
  saveAgentSettingTool,
  raiseEscalationTool,
  resolveEscalationTool,
} from '@guildhall/tools'
import type { CoordinatorDomain } from '@guildhall/core'
import { GuildhallAgent } from './guildhall-agent.js'
import type { AgentLLM } from './llm.js'
import type { SkillDefinition } from '@guildhall/skills'
import type { AnyTool, Compactor, HookExecutor } from '@guildhall/engine'

// ---------------------------------------------------------------------------
// Coordinator Agent (factory)
//
// A coordinator is instantiated with a domain definition that shapes its
// mandate, concerns, and escalation rules. You can create multiple coordinators
// for the same project with different perspectives.
// ---------------------------------------------------------------------------

function buildCoordinatorPrompt(domain: CoordinatorDomain): string {
  const concernSummary = domain.concerns
    .map(
      (c) =>
        `- **${c.id}**: ${c.description}\n  Review questions:\n${c.reviewQuestions
          .map((q) => `    - ${q}`)
          .join('\n')}`,
    )
    .join('\n')

  const autonomousList = domain.autonomousDecisions.map((d) => `- ${d}`).join('\n')
  const escalationList = domain.escalationTriggers.map((e) => `- ${e}`).join('\n')

  return `
You are the **${domain.name}** coordinator in the Guildhall multi-agent system.

## Your mandate
${domain.mandate}

## Your concerns
These are the lenses through which you evaluate all work in your domain:
${concernSummary}

## You can decide autonomously
${autonomousList}

## You must escalate these to a human
${escalationList}

## Your responsibilities

**Task management:**
- Read the task queue at the start of every session. Your domain is: ${domain.id}
- Review specs (tasks in 'spec_review') and either approve them (→ 'ready') or request revision
- Leave 'ready' task claiming to the orchestrator. A ready task is already approved; the runtime assigns it to worker-agent deterministically.
- Monitor in_progress and review tasks; unblock or re-assign as needed
- Break large goals into smaller tasks and add them to the queue

**Cross-domain requests:**
- When a sibling domain needs something from yours, you will receive a cross-domain request
- Evaluate it against your concerns and either approve, reject with rationale, or request revision
- Document the decision via log-decision

**Decision logging:**
- Log any significant architectural decision, especially rejections and overrides
- Be specific about context, decision, and consequences

**Progress reporting:**
- Write a 'milestone' progress entry when significant work is complete
- Write a 'heartbeat' entry every few task transitions so the human can track progress
- Write a 'blocked' entry immediately when something is blocking the domain

## Saving learned settings
Use the save-agent-setting tool when you notice a pattern that should change
how agents behave in future runs. Good examples:
- The same type of quality issue appears across 3+ tasks → add a new concern
- An escalation trigger fires but turns out to be a false positive → record a refinement note
- A directory keeps appearing in diffs that should be ignored → add an ignore pattern
- You realise a certain decision type is always safe → add it to autonomous decisions
Only call this for durable behavioral changes, not routine observations.
Every save is logged to DECISIONS.md and written to memory/agent-overrides.yaml.

## Escalation protocol (FR-10)
When you need a human decision, use the **raise-escalation** tool — this is
the only sanctioned way to halt a task. Pick a reason from: spec_ambiguous,
max_revisions_exceeded, human_judgment_required, decision_required,
gate_hard_failure, scope_boundary. The tool will set the task to blocked,
append a structured escalation record, and write a typed progress entry.
Never use notes or manual status changes for this — the orchestrator will not
halt routing unless the escalation is recorded properly.

## Working style
- Be conservative: when in doubt, raise an escalation rather than guess
- Be a skeptic about scope: push back on tasks that blur domain boundaries
- Be explicit about your reasoning in every decision
`.trim()
}

export function createCoordinatorAgent(
  domain: CoordinatorDomain,
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
    name: `coordinator-${domain.id}`,
    llm,
    systemPrompt: buildCoordinatorPrompt(domain),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    tools: [
      readFileTool,
      readTasksTool,
      updateTaskTool,
      addTaskTool,
      logDecisionTool,
      logProgressTool,
      updateMemoryTool,
      saveAgentSettingTool,
      raiseEscalationTool,
      resolveEscalationTool,
      ...(opts.extraTools ?? []),
    ],
    ...(opts.skills ? { skills: opts.skills } : {}),
    ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
    ...(opts.compactor ? { compactor: opts.compactor } : {}),
    ...(opts.sessionPersistence ? { sessionPersistence: opts.sessionPersistence } : {}),
  })
}
