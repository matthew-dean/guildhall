import type { SoftGateRubricItem } from '@guildhall/core'

export const ACCESSIBILITY_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'a11y-keyboard-reachable',
    question:
      'Is every new interactive element reachable and operable with keyboard alone (Tab/Shift+Tab/Enter/Space)?',
    weight: 1.0,
  },
  {
    id: 'a11y-focus-visible',
    question:
      'Does every focusable element show a visible focus indicator with adequate contrast against adjacent colors?',
    weight: 1.0,
  },
  {
    id: 'a11y-contrast-ok',
    question:
      'Does every text/background pair used in this change meet the WCAG 2.2 AA contrast threshold (4.5:1 normal, 3:1 large)?',
    weight: 1.0,
  },
  {
    id: 'a11y-semantic-elements',
    question:
      'Are native HTML elements used where possible, with ARIA only bridging genuinely missing semantics?',
    weight: 0.8,
  },
  {
    id: 'a11y-accessible-names',
    question:
      'Does every interactive element have an accessible name (visible label, aria-label, or aria-labelledby)?',
    weight: 1.0,
  },
  {
    id: 'a11y-landmarks-headings',
    question:
      'Is document structure correct — one h1, no skipped heading levels, appropriate landmark regions?',
    weight: 0.6,
  },
  {
    id: 'a11y-reduced-motion',
    question:
      'Does animation respect prefers-reduced-motion (disabled or substantially reduced)?',
    weight: 0.5,
  },
  {
    id: 'a11y-error-association',
    question:
      'Are form errors associated with their inputs (aria-describedby / aria-invalid) and not conveyed by color alone?',
    weight: 0.7,
  },
]
