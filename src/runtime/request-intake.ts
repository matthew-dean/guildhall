import type { AgentQuestion, PressureTestSummary, RequestIntake } from '@guildhall/core'

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
const POLICY_WORDS = /\b(charge|fee|fees|pricing|overhead|maintenance|rate|billing)\b/i
const STACK_HINT_WORDS = /\b(system-wide|across|etc\.?|and|also|then|full|end-to-end)\b/i
const UI_WORDS = /\b(ui|web app|app|screen|page|dashboard|form|component|button|filter|tab|segmented|toggle|card|modal|dialog|layout|palette|theme|color|typography|visual|design)\b/i
const QUALITY_BAR = 'Apply enough pressure to make this task trustworthy without asking the owner to choose a process.'
const OWNER_QUESTION_POLICY = 'Only ask when the answer could change product intent, quality bar, risk tolerance, release boundary, or a tradeoff the repo cannot decide on its own.'

export function analyzeRequestIntake(input: AnalyzeRequestIntakeInput): RequestIntakeAnalysis {
  const text = [input.title, input.ask].filter(Boolean).join('\n')
  const createdAt = input.createdAt ?? new Date().toISOString()
  const policyLike = POLICY_WORDS.test(text)
  const specLike = SPEC_WORDS.test(text)
  const implementationLike = IMPLEMENTATION_WORDS.test(text)
  const stackLike = STACK_HINT_WORDS.test(text)
  const uiLike = isUiLikeRequest(text)
  const ambiguousPolicy = policyLike && specLike && (!implementationLike || stackLike)

  if (ambiguousPolicy) {
    const question = 'Do you want Guildhall to draft the FLL overhead policy first, or should it also plan/apply the product changes that make the policy real?'
    return {
      requestIntake: {
        intent: 'ambiguous_spec_or_implementation',
        recommendedNextAction: 'ask_clarifying_question',
        ambiguity: 'The request could mean a documented policy/spec, implementation work, or a parent feature that splits into linked child tasks.',
        pressureTestSummary: pressureTestSummary('guided'),
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
      pressureTestSummary: pressureTestSummary(stackLike || specLike ? 'guided' : 'automatic', {
        designQuality: uiLike,
      }),
      clarifyingQuestions: [],
      createdAt,
      createdBy: 'request-intake',
    },
  }
}

function pressureTestSummary(
  degree: PressureTestSummary['degree'],
  opts: { designQuality?: boolean } = {},
): PressureTestSummary {
  const ownerJudgment = degree === 'automatic' ? 'system-check' : 'needs-owner-judgment'
  const checks: PressureTestSummary['checks'] = [
    {
      id: 'owner-intent',
      title: 'Owner intent',
      status: ownerJudgment,
      reason: degree === 'automatic'
        ? 'The ask is concrete enough for Guildhall to infer intent and keep moving.'
        : 'The ask may change direction depending on what the owner actually wants.',
    },
    {
      id: 'scope-boundary',
      title: 'Scope boundary',
      status: ownerJudgment,
      reason: 'Separate the smallest trustworthy task from adjacent policy, release, UI, API, data, or docs work.',
    },
    {
      id: 'acceptance-criteria',
      title: 'Acceptance criteria',
      status: 'system-check',
      reason: 'The Spec Agent must turn the request into concrete criteria before implementation starts.',
    },
    {
      id: 'verification',
      title: 'Verification',
      status: 'system-check',
      reason: 'Guildhall must identify how this work can be proven, including tests, commands, review, or a clear manual check.',
    },
    {
      id: 'review-lenses',
      title: 'Review lenses',
      status: 'system-check',
      reason: 'Guildhall must decide which reviewers or rubrics should inspect the work.',
    },
    {
      id: 'release-boundary',
      title: 'Release boundary',
      status: ownerJudgment,
      reason: 'Guildhall must separate repo-local completion from owner-only setup, rollout, or release calls.',
    },
  ]
  if (opts.designQuality) {
    checks.push(
      {
        id: 'design-system',
        title: 'Design system',
        status: 'system-check',
        reason: 'Guildhall must discover or define the design system, component catalog, pattern source, or compact UI foundation before implementation.',
      },
      {
        id: 'interaction-semantics',
        title: 'Interaction semantics',
        status: 'system-check',
        reason: 'Guildhall must choose controls by user job: segmented control or tabs for mutually exclusive modes, button for commands, checkbox for independent booleans, switch for persistent binary state.',
      },
      {
        id: 'palette-direction',
        title: 'Palette direction',
        status: 'system-check',
        reason: 'Guildhall must name the palette mood, semantic color roles, saturation budget, and status-color boundaries before the worker invents colors.',
      },
      {
        id: 'visual-proof',
        title: 'Visual proof',
        status: 'system-check',
        reason: 'Guildhall must define the rendered screenshots, responsive checks, component states, or live preview evidence needed before the UI can be called done.',
      },
    )
  }
  return {
    systemOwned: true,
    degree,
    qualityBar: QUALITY_BAR,
    ownerQuestionPolicy: OWNER_QUESTION_POLICY,
    checks,
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

function isUiLikeRequest(text: string): boolean {
  return UI_WORDS.test(text)
}
