import type { SoftGateRubricItem } from '@guildhall/core'

export const COLOR_THEORIST_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'color-semantic-naming',
    question:
      'Are new colors introduced as semantically named tokens (e.g. color.danger.fg) rather than raw hex or rgb values?',
    weight: 1.0,
  },
  {
    id: 'color-no-duplicates',
    question:
      'Is every added color perceptually distinct from the existing palette (no near-duplicates introduced)?',
    weight: 0.7,
  },
  {
    id: 'color-scale-perceptual-stepping',
    question:
      'If a color scale was extended or added, do its lightness steps feel perceptually even (not raw-hex-even)?',
    weight: 0.6,
  },
  {
    id: 'color-dark-mode-coverage',
    question:
      'Do new color roles declare both light and dark variants, or is the restriction documented?',
    weight: 0.6,
  },
  {
    id: 'color-role-before-value',
    question:
      'Does the change describe its color in terms of role (primary, danger, on-surface, …) rather than a specific hue?',
    weight: 0.5,
  },
]
