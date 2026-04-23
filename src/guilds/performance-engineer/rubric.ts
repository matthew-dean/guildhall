import type { SoftGateRubricItem } from '@guildhall/core'

export const PERFORMANCE_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'perf-bundle-impact-considered',
    question:
      'If this adds a dependency, has the bundle-size impact been measured or estimated, and is the dep justified by the cost?',
    weight: 0.9,
  },
  {
    id: 'perf-critical-path-deferred',
    question:
      'Is non-critical-path work (heavy components, analytics, third-party widgets) lazy-loaded rather than blocking initial render?',
    weight: 0.8,
  },
  {
    id: 'perf-render-path-efficient',
    question:
      'At realistic data sizes, does any new render path avoid unnecessary re-renders (with memoization used where measured, not speculatively)?',
    weight: 0.7,
  },
  {
    id: 'perf-network-waterfalls',
    question:
      'Does the change avoid new request waterfalls — parallelizing independent requests, preloading predictable ones?',
    weight: 0.8,
  },
  {
    id: 'perf-db-queries-indexed',
    question:
      'Are any new DB queries parameterized AND indexed appropriately — no N+1, no unbounded result sets?',
    weight: 0.9,
  },
  {
    id: 'perf-animation-properties',
    question:
      'Do new animations use GPU-accelerated properties (transform, opacity) rather than layout-triggering ones (top, left, width, height)?',
    weight: 0.6,
  },
  {
    id: 'perf-measurement-plan',
    question:
      'Is there a measurement plan (metric, threshold, where it is observed) that confirms the change shipped successfully?',
    weight: 0.5,
  },
]
