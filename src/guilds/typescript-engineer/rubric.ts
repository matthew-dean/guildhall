import type { SoftGateRubricItem } from '@guildhall/core'

export const TYPESCRIPT_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'ts-no-unjustified-any',
    question:
      'Does the change avoid introducing `any` (using `unknown` + narrowing, or explicit types instead)?',
    weight: 1.0,
  },
  {
    id: 'ts-parse-at-boundary',
    question:
      'Is every new IO boundary (fetch, fs, user input) validated with a schema (zod/valibot) before entering typed code?',
    weight: 0.9,
  },
  {
    id: 'ts-exhaustive-switches',
    question:
      'Does every new `switch` over a discriminated union include an exhaustive `default: assertNever(...)` clause?',
    weight: 0.7,
  },
  {
    id: 'ts-discriminated-over-optional-soup',
    question:
      'Are distinct states modeled as a discriminated union rather than a single type with many optional fields?',
    weight: 0.7,
  },
  {
    id: 'ts-named-exports-only',
    question: 'Does the change avoid introducing default exports on source modules?',
    weight: 0.5,
  },
  {
    id: 'ts-explicit-public-return-types',
    question:
      'Do new exported functions declare explicit return types (not relying on inference for public API)?',
    weight: 0.6,
  },
  {
    id: 'ts-no-silent-suppressions',
    question:
      'Does the change avoid `@ts-ignore` / `@ts-expect-error` / `as unknown as X`, or justify each with a comment?',
    weight: 0.8,
  },
]
