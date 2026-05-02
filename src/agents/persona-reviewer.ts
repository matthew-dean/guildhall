import {
  readFileTool,
  listFilesTool,
  readTasksTool,
} from '@guildhall/tools'
import type { GuildDefinition } from '@guildhall/guilds'
import type { SoftGateRubricItem } from '@guildhall/core'
import { GuildhallAgent } from './guildhall-agent.js'
import type { AgentLLM } from './llm.js'
import type { AnyTool, Compactor, HookExecutor } from '@guildhall/engine'

/**
 * Build the system prompt for a single persona reviewer. This is the
 * opinionated voice that evaluates the worker's output through one expert's
 * lens — no other personas are in the context, no status transitions are
 * allowed. The fan-out runner aggregates multiple persona verdicts into a
 * single status transition once all personas have spoken.
 */
export function personaReviewerSystemPrompt(guild: GuildDefinition): string {
  const rubricLines = (guild.rubric ?? []).map(
    (r: SoftGateRubricItem) => `- **${r.id}** (weight ${r.weight}) — ${r.question}`,
  )
  return [
    `You are ${guild.name}. Review completed work through your lens alone.`,
    '',
    '## Your principles',
    '',
    guild.principles.trim(),
    '',
    '## Your rubric',
    '',
    rubricLines.length > 0
      ? rubricLines.join('\n')
      : '_(this persona has no rubric items; evaluate principles only)_',
    '',
    '## How to review',
    '',
    'Read the task\'s spec, acceptance criteria, self-critique, and the changed files. Evaluate ONLY what falls in your lane — ignore concerns other experts are responsible for (they review independently).',
    '',
    '## Output format (REQUIRED — parsed machine-readably)',
    '',
    'Emit exactly this structure, nothing else:',
    '',
    '```',
    '**Rubric:**',
    '- <item-id>: yes / no / n-a — <one-line justification>',
    '(repeat for every rubric item)',
    '',
    '**Verdict:** approve | revise',
    '',
    '**Reasoning:** <2–4 sentences naming the load-bearing finding from your lens alone — the specific AC, file:line, or concrete evidence that drove your call>',
    '',
    '**If revise, what must change (your lane only):**',
    '- <concrete, actionable revision item>',
    '- (repeat)',
    '```',
    '',
    'Do not mutate the task queue. Do not call update-task, log-decision, or raise-escalation. Your output is the verdict; the orchestrator aggregates across all personas and decides the task\'s next status.',
  ].join('\n')
}

/**
 * Create a one-shot reviewer scoped to a single persona. Tools are
 * read-only: the persona can read files and the task but cannot mutate
 * state. Session persistence is disabled — each fan-out call is a fresh
 * turn so personas don't contaminate each other across reviews.
 */
export function createPersonaReviewerAgent(
  guild: GuildDefinition,
  llm: AgentLLM,
  opts: {
    hookExecutor?: HookExecutor
    compactor?: Compactor
    cwd?: string
    extraTools?: readonly AnyTool[]
  } = {},
): GuildhallAgent {
  return new GuildhallAgent({
    name: `persona-reviewer:${guild.slug}`,
    llm,
    systemPrompt: personaReviewerSystemPrompt(guild),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    tools: [
      readFileTool,
      listFilesTool,
      readTasksTool,
      ...(opts.extraTools ?? []),
    ],
    ...(opts.hookExecutor ? { hookExecutor: opts.hookExecutor } : {}),
    ...(opts.compactor ? { compactor: opts.compactor } : {}),
    // engineeringDefaults and skills intentionally omitted — the persona's
    // own principles ARE its prompt floor. Layering defaults on top dilutes
    // the persona's voice.
    engineeringDefaults: [],
    maxTurns: 3,
  })
}
