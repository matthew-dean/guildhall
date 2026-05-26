import type { AgentQuestion, RequestIntake } from '@guildhall/core'

export interface AnalyzeRequestIntakeInput {
  ask: string
  title?: string
  createdAt?: string
}

export interface RequestIntakeAnalysis {
  requestIntake: RequestIntake
  openQuestion?: AgentQuestion
}

const SPEC_WORDS = /\b(policy|spec|plan|document|decide|decision|define|set|standard|guideline|strategy)\b/i
const IMPLEMENTATION_WORDS = /\b(apply|implement|build|wire|enforce|update|change|add|create|ship|migrate)\b/i
const POLICY_WORDS = /\b(policy|charge|fee|fees|pricing|overhead|maintenance|rate|billing)\b/i
const STACK_HINT_WORDS = /\b(system-wide|across|etc\.?|and|also|then|full|end-to-end)\b/i

export function analyzeRequestIntake(input: AnalyzeRequestIntakeInput): RequestIntakeAnalysis {
  const text = [input.title, input.ask].filter(Boolean).join('\n')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const policyLike = POLICY_WORDS.test(text)
  const specLike = SPEC_WORDS.test(text)
  const implementationLike = IMPLEMENTATION_WORDS.test(text)
  const stackLike = STACK_HINT_WORDS.test(text)
  const ambiguousPolicy = policyLike && specLike && (!implementationLike || stackLike)

  if (ambiguousPolicy) {
    const question = 'Do you want Guildhall to draft the FLL overhead policy first, or should it also plan/apply the product changes that make the policy real?'
    return {
      requestIntake: {
        intent: 'ambiguous_spec_or_implementation',
        recommendedNextAction: 'ask_clarifying_question',
        ambiguity: 'The request could mean a documented policy/spec, implementation work, or a parent feature that splits into linked child tasks.',
        componentStack: [
          {
            kind: 'policy_decision',
            title: 'Decide the overhead charge policy',
            role: 'Name the actual business rule before implementation starts.',
          },
          {
            kind: 'documented_spec',
            title: 'Write the policy/spec',
            role: 'Capture the rule, scope, examples, and out-of-scope cases as the parent feature plan.',
          },
          {
            kind: 'implementation',
            title: 'Apply the policy in product surfaces',
            role: 'Turn the policy into code only after the spec is approved and child tasks are split.',
          },
          {
            kind: 'verification',
            title: 'Verify pricing behavior and copy',
            role: 'Check calculations, visible copy, and docs against the approved policy.',
          },
        ],
        clarifyingQuestions: [question],
        createdAt,
        createdBy: 'request-intake',
      },
      openQuestion: {
        id: `q-request-scope-${createdAt.replace(/[^0-9A-Za-z]/g, '').slice(0, 14)}`,
        kind: 'choice',
        askedBy: 'coordinator-agent',
        askedAt: createdAt,
        subject: 'Policy request scope',
        description: 'This request could be a policy/spec task, a parent feature plan, or direct implementation work.',
        prompt: 'Should Guildhall draft the FLL overhead policy first, or also turn it into linked implementation work?',
        choices: [
          'Draft the policy/spec first',
          'Draft the policy and create linked implementation tasks',
          'Apply the policy now',
        ],
      },
    }
  }

  return {
    requestIntake: {
      intent: implementationLike ? 'implementation' : specLike ? 'spec_only' : 'question_or_research',
      recommendedNextAction: implementationLike
        ? 'proceed_to_implementation_spec'
        : specLike
          ? 'draft_spec'
          : 'ask_clarifying_question',
      componentStack: inferComponentStack(text),
      clarifyingQuestions: [],
      createdAt,
      createdBy: 'request-intake',
    },
  }
}

function inferComponentStack(text: string): RequestIntake['componentStack'] {
  const components: RequestIntake['componentStack'] = []
  if (POLICY_WORDS.test(text)) {
    components.push({
      kind: 'policy_decision',
      title: 'Clarify the policy decision',
      role: 'Keep the business rule separate from implementation details.',
    })
  }
  if (/\b(api|endpoint|route|contract)\b/i.test(text)) {
    components.push({
      kind: 'api_contract',
      title: 'Define the API contract',
      role: 'Separate service behavior from callers and UI.',
    })
  }
  if (/\b(ui|screen|page|dashboard|form|copy)\b/i.test(text)) {
    components.push({
      kind: 'ui_surface',
      title: 'Update the user-facing surface',
      role: 'Keep interaction and copy review focused.',
    })
  }
  if (/\b(data|database|schema|migration|stored|persistence)\b/i.test(text)) {
    components.push({
      kind: 'data_model',
      title: 'Update persisted behavior',
      role: 'Give data safety and migration work its own boundary.',
    })
  }
  return components
}
