export type QuestionVisibilityRecord = {
  prompt?: unknown
  restatement?: unknown
  choices?: unknown
}

function questionText(question: QuestionVisibilityRecord): string {
  const restatement = typeof question.restatement === 'string' ? question.restatement : ''
  const prompt = typeof question.prompt === 'string' ? question.prompt : ''
  return restatement || prompt
}

function normalizedQuestionText(question: QuestionVisibilityRecord): string {
  return questionText(question)
    .replace(/^#{1,6}\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizedChoiceText(question: QuestionVisibilityRecord): string[] {
  if (!Array.isArray(question.choices)) return []
  return question.choices
    .map((choice) => {
      if (typeof choice === 'string') return choice
      if (choice && typeof choice === 'object') {
        const record = choice as { label?: unknown; value?: unknown; text?: unknown }
        if (typeof record.label === 'string') return record.label
        if (typeof record.text === 'string') return record.text
        if (typeof record.value === 'string') return record.value
      }
      return ''
    })
    .map(choice => choice
      .replace(/\*\*/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase())
    .filter(Boolean)
}

function looksLikeOwnerDecisionPrompt(text: string): boolean {
  return (
    text.includes('?') ||
    /\b(?:which|what|should i|should we|should this|do you want|would you prefer|pick|choose|confirm)\b/.test(text)
  )
}

function looksLikeOutputPromisePrompt(text: string): boolean {
  return (
    /^if you pick one,?\s+i(?:'|’)ll immediately produce:?$/.test(text) ||
    /^if you choose one,?\s+i(?:'|’)ll immediately produce:?$/.test(text)
  )
}

export function isOperationalReceiptQuestion(question: QuestionVisibilityRecord): boolean {
  const text = normalizedQuestionText(question)
  if (!text) return false
  if (/^(?:done|complete|completed|finished)\s*(?:[—-]\s*|\:\s*|$)/.test(text)) return true
  if (/^i took (?:the )?durable .*steps:?$/.test(text)) return true
  if (/^i persisted (?:this|the) .* with tools:?$/.test(text)) return true
  if (/^i(?:'|’)ve now persisted progress with tools\b/.test(text)) return true
  if (/^i took durable tool steps this turn:?$/.test(text)) return true
  if (/^i have enough from\b.*\b(?:glob|search|read|scan|inspection|results?)\b/.test(text)) return true
  if (/^i don(?:'|’)t see\b.*\b(?:todo|readme|file|directory|docs?)\b/.test(text)) return true
  if (/^i found\b.*\b(?:glob|search|read|scan|inspection|results?)\b/.test(text) && !looksLikeOwnerDecisionPrompt(text)) return true
  if (/^based on (?:the )?(?:glob|search|read|scan|inspection|results?)\b/.test(text) && !looksLikeOwnerDecisionPrompt(text)) return true
  if (looksLikeOutputPromisePrompt(text)) return true
  if (
    /^i (?:will|can|now|have)\b.*\b(?:persist|draft|update|write|post|set|move|create|record)\b/.test(text) &&
    !looksLikeOwnerDecisionPrompt(text)
  ) return true
  if (/^recorded durable intake progress\b/.test(text)) return true
  if (/^logged this turn to the exploring transcript\b/.test(text)) return true
  if (/^posted (?:a |one |two |three |\d+ )?(?:focused |scope |structured )?questions?\b/.test(text)) return true

  const choices = normalizedChoiceText(question)
  if (choices.length === 0) return false
  const choiceText = choices.join(' ')
  const operationalChoiceCount = [
    /\bupdated the product brief\b/,
    /\bupdate(?:d)? the? ?product brief\b/,
    /\bi (?:will|can|now|have)\b.*\b(?:persist|draft|update|write|post|set|move|create|record)\b/,
    /\brevised and strengthened the spec\b/,
    /\bset task status to\b/,
    /\bmove task to spec_review\b/,
    /\bappended .*exploring transcript\b/,
    /\bread back .*transcript\b/,
    /\blogged a milestone\b/,
    /\blogged the current progress state\b/,
    /\bprogress\.md\b/,
    /\bpersist(?:ed)? progress with tools\b/,
    /\bposted the .*question\b/,
  ].filter((pattern) => pattern.test(choiceText)).length
  return operationalChoiceCount >= 2
}

function genericChoicePromptKey(text: string): string {
  if (/^(?:pick|choose|select)\b/.test(text)) return 'generic-choice'
  if (/^which\b.*\b(?:fallback\s+)?(?:path|option|choice|approach|direction)\b.*\b(?:should|use|pick|choose)\b/.test(text)) {
    return 'generic-choice'
  }
  return text
}

export function visibleQuestionSignature(question: QuestionVisibilityRecord): string {
  const kind = typeof (question as { kind?: unknown }).kind === 'string'
    ? (question as { kind: string }).kind.trim().toLowerCase()
    : ''
  const selectionMode = typeof (question as { selectionMode?: unknown }).selectionMode === 'string'
    ? (question as { selectionMode: string }).selectionMode.trim().toLowerCase()
    : ''
  const choices = normalizedChoiceText(question)
  const text = normalizedQuestionText(question)
  const promptKey = choices.length >= 2 ? genericChoicePromptKey(text) : text
  return [kind, promptKey, choices.join('|'), selectionMode].join('::')
}
