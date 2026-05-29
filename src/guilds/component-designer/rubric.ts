import type { SoftGateRubricItem } from '@guildhall/core'

export const COMPONENT_DESIGNER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'component-author-intent-preserved',
    question:
      'Does the review preserve the author\'s product intent and accepted taste constraints before proposing quality improvements?',
    weight: 1.0,
  },
  {
    id: 'component-blind-spots-raised',
    question:
      'Does the review surface blind spots that would make the interface easier to use, navigate, understand, or enjoy without silently expanding scope?',
    weight: 0.9,
  },
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
    id: 'component-agent-ready-guidance',
    question:
      'Can an agent tell when to use this component, each variant, and important props instead of nearby alternatives, including what layout primitive owns spacing?',
    weight: 1.0,
  },
  {
    id: 'component-interaction-semantics',
    question:
      'Does each interactive element use the right control type for its job: button for one-shot command, link/tab for navigation, segmented control/radio/tabs for mutually exclusive modes, checkbox for independent booleans, switch for persistent binary state, and disclosure for show/hide?',
    weight: 1.0,
  },
  {
    id: 'component-reference-backed-control-choice',
    question:
      'When the local design system is thin or silent, did the reviewer check established control-pattern guidance (for example WAI-ARIA APG, Material, Apple HIG, or usability guidance) and adapt it to this project rather than guessing?',
    weight: 0.7,
  },
  {
    id: 'component-findable-long-lists',
    question:
      'For long, searchable, user-specific, or remote option sets, does the design prefer a combobox/typeahead/autocomplete affordance over a strict select, with clear empty/loading/no-results and keyboard behavior?',
    weight: 0.9,
  },
  {
    id: 'component-architecture-opportunity-routed',
    question:
      'When a stronger design calls for a broader architecture or dependency pivot, is it routed as an owner-visible opportunity with tradeoffs instead of being smuggled into the current task?',
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
