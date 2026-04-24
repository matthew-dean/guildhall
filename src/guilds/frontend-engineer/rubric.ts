import type { SoftGateRubricItem } from '@guildhall/core'

/**
 * The Frontend Engineer reviews in their own lane — another engineer's
 * frontend work. They are not the primary a11y / visual / component-API
 * reviewer; those are the Accessibility Specialist, Visual Designer, and
 * Component Designer respectively.
 */
export const FRONTEND_ENGINEER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'fe-built-to-spec',
    question:
      'Does the implementation match the spec exactly — same variants, slots, controlled/uncontrolled stance, keyboard behavior?',
    weight: 1.0,
  },
  {
    id: 'fe-framework-idioms',
    question:
      'Are framework patterns used idiomatically (Rules of Hooks / runes / composition API as applicable)?',
    weight: 0.9,
  },
  {
    id: 'fe-layout-primitives-for-spacing',
    question:
      'Does the component rely on layout primitives (Stack/Row/Grid) for spacing rather than applying external margin?',
    weight: 0.9,
  },
  {
    id: 'fe-token-only-values',
    question:
      'Are all visual values (colors, spacing, radii, shadows, type) drawn from design tokens — no inline hex or px literals?',
    weight: 1.0,
  },
  {
    id: 'fe-no-dead-code',
    question:
      'Is the submitted diff clean — no commented-out alternatives, no unused exports, no half-finished branches?',
    weight: 0.6,
  },
]
