import type { GuildSignals } from '../types.js'

const SEC_KEYWORDS =
  /\b(auth|login|password|token|secret|key|credential|session|cookie|csrf|xss|sql|injection|sanitiz|encrypt|decrypt|oauth|jwt|rbac|permission|role|admin|endpoint|api|upload|file|sandbox|eval)\b/i

export function applicable(signals: GuildSignals): boolean {
  // Every task gets a security review — the cost of not inviting the Security
  // Engineer is too high. But we bias toward task-text matching so the
  // reviewer gets a focused rubric.
  return (
    SEC_KEYWORDS.test(`${signals.task.title} ${signals.task.description}`) ||
    // Any task with product surface carries authn/authz risk.
    Boolean(signals.task.productBrief)
  )
}
