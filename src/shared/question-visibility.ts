export type QuestionVisibilityRecord = {
  kind?: unknown
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

export function visibleQuestionSignature(question: QuestionVisibilityRecord): string {
  const kind = typeof (question as { kind?: unknown }).kind === 'string'
    ? (question as { kind: string }).kind.trim().toLowerCase()
    : ''
  const selectionMode = typeof (question as { selectionMode?: unknown }).selectionMode === 'string'
    ? (question as { selectionMode: string }).selectionMode.trim().toLowerCase()
    : ''
  const choices = normalizedChoiceText(question)
  const text = normalizedQuestionText(question)
  return [kind, text, choices.join('|'), selectionMode].join('::')
}
