import type { SoftGateRubricItem } from '@guildhall/core'

export const COPYWRITER_RUBRIC: SoftGateRubricItem[] = [
  {
    id: 'copy-voice-consistent',
    question:
      "Does every user-facing string match the declared copyVoice.tone (plain / warm / precise / playful / authoritative)?",
    weight: 0.9,
  },
  {
    id: 'copy-banned-terms-absent',
    question:
      'Are the design system\'s bannedTerms absent from all user-facing copy?',
    weight: 1.0,
  },
  {
    id: 'copy-preferred-terms-used',
    question:
      "Are the design system's preferredTerms used where applicable (e.g. 'member' over 'user')?",
    weight: 0.7,
  },
  {
    id: 'copy-casing-consistent',
    question:
      'Is casing (title vs sentence) consistent within each surface class (buttons, nav items, headings)?',
    weight: 0.6,
  },
  {
    id: 'copy-error-with-recovery',
    question:
      'Does every error string name the problem AND give a concrete recovery path — never "Something went wrong" alone?',
    weight: 0.9,
  },
  {
    id: 'copy-empty-state-teaches',
    question:
      "Does every empty state teach the user what the list/surface is for, rather than just saying '(empty)' or 'No results'?",
    weight: 0.6,
  },
  {
    id: 'copy-no-jargon-or-placeholders',
    question:
      'Are all user-facing strings free of internal jargon, placeholder text (lorem, TODO), and console-style error codes?',
    weight: 0.8,
  },
]
