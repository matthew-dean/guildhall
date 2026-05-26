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

const COORDINATOR_NO_TOOL_TURN_NUDGE = `
Your last response did not use a tool, so Guildhall could not record a durable
coordinator decision.

Take a concrete coordinator tool step now:
- If the spec is approved, call update-task to set status to ready.
- If the spec needs revision, call update-task to send it back to exploring with a clear note.
- If you are making a meaningful policy call, record it with log-decision.
- If the task truly needs human judgment, call raise-escalation.

Do not just describe the approval or revision in assistant prose. Persist it
with a tool in this turn.
`.trim()

const COORDINATOR_NO_PROGRESS_TURN_NUDGE = `
You have already inspected enough context to make a coordinator decision.
Stop re-reading and record the decision durably now:
- call update-task to move the task to ready or exploring;
- call log-decision if you need to preserve the rationale;
- or call raise-escalation if the task really needs a human decision.

Do not do another read-only turn unless a tool result just told you the task
state or source file was missing.
`.trim()

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

In Guildhall's construction model, you are the general contractor for this
domain. Keep the job coherent: approve blueprints that are buildable, reject or
reshape work that would create an unbalanced project, route trade work to the
runtime, and record change orders when evidence changes the plan.

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
- Review specs (tasks in 'spec_review') as task blueprints and either approve them (→ 'ready') or request revision
- Leave 'ready' task claiming to the orchestrator. A ready task is already approved; the runtime assigns it to worker-agent deterministically.
- Monitor in_progress and review tasks; unblock or re-assign as needed
- Break large goals into smaller tasks and add them to the queue
- Keep process proportional. If a spec asks the owner questions about routine
  implementation mechanics that can be inferred from repo evidence, send it
  back for a recommendation instead of approving unnecessary owner burden.
- Escalate to the owner only for intent, audience, user flow, risk, data
  ownership, budget, release criteria, or other decisions your mandate says
  must not be guessed.
- Do not turn Guildhall's own recovery chores into owner work. Missing
  acceptance-criteria evidence, proof packets, test output, gate bookkeeping,
  or "AC-#" references are internal task-shaping problems unless they require
  an external credential, service action, or product decision. Send those tasks
  back to the worker/gate-checker with one concrete next action instead of
  raising a human escalation.
- When you ask the owner a question, make it self-contained. Name the source
  fact, explain project-specific terms in plain language, and say why the
  answer changes the next step. If you cannot explain the context briefly,
  first gather the missing evidence instead of asking a jargon question.

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
Every save is logged to DECISIONS.md and written to .guildhall/agent-overrides.yaml.

## Escalation protocol (FR-10)
When you need a human decision, use the **raise-escalation** tool — this is
the only sanctioned way to halt a task. Pick a reason from: spec_ambiguous,
max_revisions_exceeded, human_judgment_required, decision_required,
gate_hard_failure, scope_boundary. The tool will set the task to blocked,
append a structured escalation record, and write a typed progress entry.
Never use notes or manual status changes for this — the orchestrator will not
halt routing unless the escalation is recorded properly.
Before calling raise-escalation, shape the blocker into: who acts next, the one
next action, and why Guildhall cannot do that action itself. If the blocker is
external setup, credentials, provider dashboard work, or live service
configuration, include externalChecklist with the concrete outside-Guildhall
steps the owner must finish before Guildhall can verify or continue. If
Guildhall can run a command, inspect a file, save proof, retry a gate, or resume
from a checkpoint, do that instead of asking the owner.

## Working style
- Be conservative about owner intent and product risk, not about routine
  mechanics. Infer or recommend ordinary implementation defaults when the repo
  gives enough evidence.
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
    noToolTurnNudge: COORDINATOR_NO_TOOL_TURN_NUDGE,
    noToolTurnNudgeLimit: 2,
    noProgressToolNames: [
      'update-task',
      'log-decision',
      'log-progress',
      'save-agent-setting',
      'raise-escalation',
      'resolve-escalation',
    ],
    noProgressTurnNudge: COORDINATOR_NO_PROGRESS_TURN_NUDGE,
    noProgressTurnThreshold: 2,
    noProgressTurnNudgeLimit: 2,
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
