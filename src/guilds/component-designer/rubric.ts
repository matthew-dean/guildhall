import type { SoftGateRubricItem } from '@guildhall/core'

export const COMPONENT_DESIGNER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'component-no-external-margin',
    question:
      'Does every component avoid applying margin to its root element (spacing is the caller\'s job via Stack/Row/Grid)?',
    weight: 1.0,
  },
  {
    id: 'component-token-only-values',
    question:
      'Are all colors, spacing, radii, shadows, and font values drawn from design tokens — no hardcoded literals?',
    weight: 1.0,
  },
  {
    id: 'component-prop-api-consistent',
    question:
      'Do new components follow the catalog\'s conventions for `variant`, `size`, `as`/`asChild`, and controlled/uncontrolled patterns?',
    weight: 0.9,
  },
  {
    id: 'component-atomic-layering',
    question:
      'Does the change respect atomic layers — primitives do not depend on components, components do not depend on patterns?',
    weight: 0.8,
  },
  {
    id: 'component-a11y-props-present',
    question:
      'Do interactive components expose the a11y props they need (aria-label, aria-describedby, disabled semantics, focus management)?',
    weight: 0.9,
  },
  {
    id: 'component-both-modes-supported',
    question:
      'For form-like components, are both controlled and uncontrolled usage supported, or is the restriction documented?',
    weight: 0.5,
  },
]
