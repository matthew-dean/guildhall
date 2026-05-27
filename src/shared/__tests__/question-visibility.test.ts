import { describe, expect, it } from 'vitest'

import { isOperationalReceiptQuestion } from '../question-visibility.js'

describe('isOperationalReceiptQuestion', () => {
  it('filters split-summary narration that is not an owner decision', () => {
    expect(isOperationalReceiptQuestion({
      prompt: 'The parent task (task-006) was about "Set FLL overhead charge policy" — it was split into 3 children:',
      choices: [
        '**task-006-split-implement-the-billing-settings-workflow** (this one) — "Keep the user-facing workflow small enough for UX review"',
        'task-006-split-add-the-admin-subscription-api-contract — backend API',
        'task-006-split-implement-invite-email-delivery — email delivery',
      ],
    })).toBe(true)
    expect(isOperationalReceiptQuestion({
      prompt: 'From the parent task-006 spec, I can see it covers:',
      choices: [
        'A public fees/pricing page at `/fees`',
        'An author dashboard fee breakdown card',
      ],
    })).toBe(true)
  })
})
