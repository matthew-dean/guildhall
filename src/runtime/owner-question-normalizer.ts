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

function inferSubjectFromContext(context: string, question: string): string | undefined {
  const ignored = new Set(['The', 'This', 'That', 'I'])
  const component = [...context.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)]
    .map((match) => match[1])
    .find((value): value is string => Boolean(value && !ignored.has(value)))
  if (!component || ignored.has(component)) return undefined
  if (/\bvariants?\b/i.test(question)) return `${component} variants`
  return component
}

function rewriteQuestionWithSubject(question: string, subject: string | undefined): string {
  const normalized = sentenceCaseQuestion(question)
  if (!subject) return normalized
  const component = subject.replace(/\s+variants?$/i, '').trim()
  if (!component) return normalized
  return normalized
    .replace(/\bthe user\b/i, component)
    .replace(/\buser\b/i, component)
}

function isPureAgentNarration(value: string): boolean {
  const normalized = normalizeWhitespace(value).toLowerCase()
  return (
    /^i have enough\b/.test(normalized) ||
    /^let me (?:write|draft|piece|synthesize|summarize|recap)\b/.test(normalized) ||
    /^here'?s what i (?:found|know|learned|asked)\b/.test(normalized) ||
    /^what i (?:found|know|learned)\b/.test(normalized) ||
    /\blet me write the product brief first,?\s*then ask\b/.test(normalized) ||
    /\bthe key question i need to ask\b/.test(normalized)
  )
}

function extractEmbeddedQuestion(text: string): NormalizedOwnerQuestion | null {
  const trimmed = text.trim()
  const match = trimmed.match(
    /\b(?:the\s+)?(?:key|main|top|only|focused)?\s*question(?:\s+i\s+need\s+to\s+ask|\s+we\s+need\s+to\s+answer|\s+to\s+answer)?(?:\s+before\s+[^:\n]+)?\s*(?:is|:)\s*([\s\S]*?\?)/i,
  )
  if (!match || match.index === undefined) return null
  const rawQuestion = match[1]?.trim() ?? ''
  if (!rawQuestion) return null
  const context = normalizeWhitespace(trimmed.slice(0, match.index))
    .replace(/^i have enough context\.?\s*/i, '')
  const subject = inferSubjectFromContext(context, rawQuestion)
  return {
    kind: 'text',
    prompt: rewriteQuestionWithSubject(rawQuestion, subject),
    ...(subject ? { subject } : {}),
    ...(context ? { description: context } : {}),
  }
}

export function normalizeStructuredOwnerQuestion(
  input: OwnerQuestionNormalizationInput,
): NormalizedOwnerQuestion | null {
  const prompt = input.prompt.trim()
  if (!prompt) return null

  if (isPureAgentNarration(prompt)) return null

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
  const prompt = input.prompt.trim()
  if (!prompt) return null

  const embedded = extractEmbeddedQuestion(prompt)
  if (embedded) {
    return {
      ...embedded,
      ...(input.subject && !embedded.subject ? { subject: input.subject } : {}),
      ...(input.description
        ? { description: embedded.description ? `${embedded.description}\n\n${input.description}` : input.description }
        : {}),
      ...(input.choices && input.choices.length > 0 ? { choices: input.choices } : {}),
      ...(input.selectionMode ? { selectionMode: input.selectionMode } : {}),
    }
  }

  return normalizeStructuredOwnerQuestion(input)
}

export function isInvalidOwnerQuestionPrompt(value: string | undefined | null): boolean {
  const prompt = (value ?? '').trim()
  if (!prompt) return true
  return normalizeStructuredOwnerQuestion({ prompt }) === null
}
