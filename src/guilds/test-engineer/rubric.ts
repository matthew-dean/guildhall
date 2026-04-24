import type { SoftGateRubricItem } from '@guildhall/core'

export const TEST_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'test-no-only-or-skip',
    question:
      'Is the diff free of `.only`, `fdescribe`, or unjustified `.skip` / `xit` / `xdescribe` in test files?',
    weight: 1.0,
  },
  {
    id: 'test-no-flaky-sleeps',
    question:
      'Do new tests avoid `setTimeout` / `sleep` / `delay` based waits, preferring deterministic synchronization (events, promises, test clocks)?',
    weight: 0.9,
  },
  {
    id: 'test-aaa-structure',
    question:
      'Does each new test follow an arrange-act-assert structure that a reader can skim in 10 seconds?',
    weight: 0.7,
  },
  {
    id: 'test-names-describe-behavior',
    question:
      'Do new test names describe observable behavior ("returns 401 when token expired"), not implementation ("calls handleSubmit")?',
    weight: 0.6,
  },
  {
    id: 'test-covers-acceptance-criteria',
    question:
      'Is each acceptance criterion for this task backed by at least one test that would fail if the criterion were unmet?',
    weight: 1.0,
  },
  {
    id: 'test-integration-over-mocks-where-cheap',
    question:
      'Are integration tests used where cheap (a real DB in docker, a real HTTP handler) rather than mocks that can mask real regressions?',
    weight: 0.6,
  },
  {
    id: 'test-coverage-meaningful',
    question:
      'Do new tests exercise meaningful behavior, not just bump coverage numbers on happy paths?',
    weight: 0.6,
  },
]
