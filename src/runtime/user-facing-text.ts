const EMPTY_MODEL_REPLY =
  'Guildhall got an empty model reply, so it kept the task state intact. Retry the run or switch providers if this keeps happening.'

const IDLE_LIMIT =
  'Guildhall stopped after reaching the idle limit. Start the run again when you are ready to continue.'

const WAITING_FOR_ANSWER =
  'Guildhall asked a question and is waiting for the answer.'

const RESEARCH_BUDGET =
  'Guildhall paused after gathering enough context. Open the task to choose the next step.'

export function isInternalAgentNarration(value: string | undefined | null): boolean {
  const text = (value ?? '').trim()
  return (
    /already have the question posted|posted (?:a |the )?(?:choice|freeform)?\s*question|wait for the user's answer|yield now|q-\d/i.test(text) ||
    /research budget exhausted|hit the research budget|refusing more read-only tool calls|do not call more read-only tools now/i.test(text)
  )
}

export function userFacingText(
  value: string | undefined | null,
  fallback = 'Open the task to choose the next step.',
): string {
  const text = (value ?? '').trim()
  if (!text) return fallback

  if (/Model returned an empty assistant message|Model returned an empty reply/i.test(text)) {
    return EMPTY_MODEL_REPLY
  }
  if (/\bstopped\s*\(\s*Idle Limit\s*\)|\bIdle Limit\b/i.test(text)) {
    return IDLE_LIMIT
  }
  if (/already have the question posted|posted (?:a |the )?(?:choice|freeform)?\s*question|wait for the user's answer|yield now|q-\d/i.test(text)) {
    return WAITING_FOR_ANSWER
  }
  if (/research budget exhausted|hit the research budget|refusing more read-only tool calls|do not call more read-only tools now/i.test(text)) {
    return RESEARCH_BUDGET
  }

  const withoutErrorPrefix = text.replace(/^ERROR:\s*/i, '').trim()
  if (/^spec_ambiguous\b/i.test(withoutErrorPrefix)) {
    return withoutErrorPrefix.replace(/^spec_ambiguous\b:?\s*/i, '').trim() ||
      'The task brief is missing a decision or concrete implementation path.'
  }
  if (/^human_judgment_required\b/i.test(withoutErrorPrefix)) {
    return withoutErrorPrefix.replace(/^human_judgment_required\b:?\s*/i, '').trim() ||
      'Guildhall needs a product or recovery decision before it can continue.'
  }
  if (withoutErrorPrefix !== text) {
    return withoutErrorPrefix || fallback
  }

  return text.replace(/^[a-z][a-z0-9_]*:\s*/i, '').trim() || fallback
}
