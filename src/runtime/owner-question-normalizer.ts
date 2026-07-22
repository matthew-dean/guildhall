export type OwnerQuestionKind = 'confirm' | 'yesno' | 'choice' | 'text'

export interface OwnerQuestionNormalizationInput {
  kind?: OwnerQuestionKind | string
  prompt: string
  subject?: string
  description?: string
  choices?: string[]
  selectionMode?: 'single' | 'multiple' | string
}

export interface NormalizedOwnerQuestion {
  kind?: OwnerQuestionKind | string
  prompt: string
  subject?: string
  description?: string
  choices?: string[]
  selectionMode?: 'single' | 'multiple' | string
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sentenceCaseQuestion(value: string): string {
  const trimmed = normalizeWhitespace(value).replace(/\s+\?/g, '?')
  if (!trimmed) return trimmed
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export function normalizeStructuredOwnerQuestion(
  input: OwnerQuestionNormalizationInput,
): NormalizedOwnerQuestion | null {
  const prompt = sentenceCaseQuestion(input.prompt)
  if (!prompt) return null
  // A durable owner-input record must be an actual question. Model narration,
  // evidence summaries, and heading-like fragments are not a second authoring
  // API merely because they contain a colon or a plausible choice list.
  if (!prompt.includes('?')) return null

  return {
    ...(input.kind ? { kind: input.kind } : {}),
    prompt,
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.choices && input.choices.length > 0 ? { choices: input.choices } : {}),
    ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
  }
}

export function normalizeLegacyOwnerQuestion(
  input: OwnerQuestionNormalizationInput,
): NormalizedOwnerQuestion | null {
  // Legacy records are normalized, never interpreted. In particular, do not
  // mine a question out of assistant prose; that made model phrasing a
  // durable state boundary and silently manufactured owner work.
  if (!input.kind && !(input.choices && input.choices.length > 0)) return null
  return normalizeStructuredOwnerQuestion(input)
}

export function isInvalidOwnerQuestionPrompt(value: string | undefined | null): boolean {
  const prompt = (value ?? '').trim()
  if (!prompt) return true
  return normalizeStructuredOwnerQuestion({ prompt }) === null
}
