import type { SoftGateRubricItem } from '@guildhall/core'

export const API_DESIGNER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'api-resource-verb-conventions',
    question:
      'Do new endpoints follow resource-as-noun, method-as-verb conventions (GET /users/:id, not GET /getUser)?',
    weight: 0.9,
  },
  {
    id: 'api-error-envelope-consistent',
    question:
      'Does every error response follow the declared error envelope shape (code + message + details), with distinct error codes documented?',
    weight: 1.0,
  },
  {
    id: 'api-versioned',
    question:
      'Are new endpoints under the declared versioned prefix (e.g. /v1/…)?',
    weight: 0.7,
  },
  {
    id: 'api-pagination-explicit',
    question:
      'If the endpoint returns a list, is pagination explicit (cursor or offset, with nextCursor/hasMore or total in the response)?',
    weight: 0.7,
  },
  {
    id: 'api-idempotency',
    question:
      'Are unsafe repeatable operations (POST-that-creates, billing ops) either idempotent by shape or gated by an Idempotency-Key header?',
    weight: 0.8,
  },
  {
    id: 'api-boundary-validation',
    question:
      'Are request and response payloads validated at the boundary (zod/typebox/OpenAPI/JSON schema), not just typed after the fact?',
    weight: 0.9,
  },
  {
    id: 'api-breaking-changes-communicated',
    question:
      'Are any breaking changes covered by deprecation headers, changelog entries, and a migration note — never a silent removal?',
    weight: 1.0,
  },
]
