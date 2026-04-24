import type { SoftGateRubricItem } from '@guildhall/core'

export const BACKEND_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'be-built-to-spec',
    question:
      'Does the implementation match the API contract exactly — paths, methods, request/response shapes, status codes, error envelopes?',
    weight: 1.0,
  },
  {
    id: 'be-pure-first-io-at-edges',
    question:
      'Is business logic in pure, testable functions with I/O (DB, HTTP, fs, queue) confined to thin adapters at the boundary?',
    weight: 0.8,
  },
  {
    id: 'be-transactions-for-multi-step',
    question:
      'Do multi-step writes that must succeed or fail together run inside a transaction?',
    weight: 0.9,
  },
  {
    id: 'be-observability',
    question:
      'Do hot paths have metrics, multi-hop flows have trace spans, and every 5xx response carries a log with enough context to diagnose?',
    weight: 0.8,
  },
  {
    id: 'be-idempotent-when-specified',
    question:
      'Where the spec says the operation is idempotent, is idempotency enforced at the storage layer — not just a best-effort handler shim?',
    weight: 0.9,
  },
  {
    id: 'be-migrations-compatible',
    question:
      'Do any new DB migrations have a defined compatibility window (old + new readers/writers coexist during deploy)?',
    weight: 0.8,
  },
  {
    id: 'be-no-dead-code',
    question:
      'Is the submitted diff clean — no commented-out alternatives, no unused exports, no half-finished branches?',
    weight: 0.6,
  },
]
