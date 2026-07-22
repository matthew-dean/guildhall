const EMPTY_MODEL_REPLY =
  'The model returned an empty reply, so task state stayed intact. Retry the run or switch providers if this keeps happening.'

const IDLE_LIMIT =
  'The run stopped after reaching the idle limit. Start it again when you are ready to continue.'

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
  const withoutErrorPrefix = text.replace(/^ERROR:\s*/i, '').trim()
  if (/^spec_ambiguous\b/i.test(withoutErrorPrefix)) {
    return withoutErrorPrefix.replace(/^spec_ambiguous\b:?\s*/i, '').trim() ||
      'The task brief is missing a decision or concrete implementation path.'
  }
  if (/^human_judgment_required\b/i.test(withoutErrorPrefix)) {
    return withoutErrorPrefix.replace(/^human_judgment_required\b:?\s*/i, '').trim() ||
      'A product or recovery decision is needed before work can continue.'
  }
  if (withoutErrorPrefix !== text) {
    return withoutErrorPrefix || fallback
  }

  return text.replace(/^[a-z][a-z0-9_]*:\s*/i, '').trim() || fallback
}
