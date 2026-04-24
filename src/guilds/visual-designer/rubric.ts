import type { SoftGateRubricItem } from '@guildhall/core'

export const VISUAL_DESIGNER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'visual-spacing-scale',
    question:
      'Does every spacing value (margin / padding / gap) come from the declared spacing scale, with no ad-hoc px literals?',
    weight: 1.0,
  },
  {
    id: 'visual-type-scale',
    question:
      'Does every text element pick a size/weight from the typography scale rather than inline font-size / font-weight values?',
    weight: 0.9,
  },
  {
    id: 'visual-hierarchy',
    question:
      'Is there a clear primary / secondary / tertiary emphasis, achieved through scale, weight, color, and negative space — not through raw boldness competition?',
    weight: 0.8,
  },
  {
    id: 'visual-rhythm-consistent',
    question:
      'Do spacings feel even across the surface — no arbitrary competing gaps (8 here, 12 there for no reason)?',
    weight: 0.7,
  },
  {
    id: 'visual-optical-alignment',
    question:
      'Are interactive elements and icon/text pairings optically aligned (not just mathematically centered)?',
    weight: 0.5,
  },
  {
    id: 'visual-responsive',
    question:
      'Does the layout read correctly at the smallest and largest declared breakpoints, not only at the happy medium?',
    weight: 0.7,
  },
]
