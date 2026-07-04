export interface DisplayTaskLike {
  id?: string
  title?: string
  description?: string
  request?: {
    kind?: string
    raw?: string
  }
}

export function taskDisplayLabel(task: DisplayTaskLike, fallback = 'Untitled work'): string {
  const title = effectiveTaskTitle(task)
  const description = task.description?.trim()
  const derived = derivedQuestionTaskLabel(title, description)
  if (derived) return derived
  return title || task.id || fallback
}

export function effectiveTaskTitle(task: DisplayTaskLike): string | undefined {
  const title = task.title?.trim()
  const description = task.description?.trim()
  return recoverClippedTitle(title, description) ?? title
}

export function taskSourceQuestion(task: DisplayTaskLike): string | null {
  const raw = task.request?.raw?.trim()
  if (raw && isQuestionLike(raw)) return raw
  const title = task.title?.trim()
  if (title && isQuestionLike(title)) return title
  const description = task.description?.trim()
  if (description && isQuestionLike(description)) return description
  return null
}

function derivedQuestionTaskLabel(title: string | undefined, description: string | undefined): string | null {
  const question = questionCandidate(title, description)
  if (!question) return null
  const lower = question.toLowerCase()

  if (/\bcommands?\b/.test(lower) && /\bsmoke[- ]?test\b/.test(lower)) {
    return /\bwithout changing files\b|\bread[- ]only\b|\bsafe\b/.test(lower)
      ? 'Define safe smoke-test commands'
      : 'Define smoke-test commands'
  }
  if (/^what\s+commands?\s+should\s+i\s+run\b/i.test(question)) {
    return 'Define project commands'
  }
  if (/^how\s+should\s+(?:i|we)\s+verify\b/i.test(question)) {
    return 'Define verification approach'
  }
  return null
}

function questionCandidate(title: string | undefined, description: string | undefined): string | null {
  const candidate = title || description
  if (!candidate || !isQuestionLike(candidate)) return null
  if (description && description !== candidate && !sameText(candidate, description)) return null
  return candidate
}

function recoverClippedTitle(title: string | undefined, description: string | undefined): string | null {
  if (!title || !description) return null
  const compactTitle = title.replace(/\.\.\.$/, '').trim()
  const titleLooksClipped = title.length >= 60 || title.endsWith('...')
  if (!titleLooksClipped) return null
  const descriptionBody = stripSourcePrefix(description)
  if (descriptionBody.length <= title.length) return null
  if (!descriptionBody.toLowerCase().startsWith(compactTitle.toLowerCase())) return null
  return descriptionBody
}

function stripSourcePrefix(description: string): string {
  return description
    .replace(/^(?:[A-Za-z]:)?[^:\n]{1,240}\.(?:md|mdx|txt|yaml|yml|json):\s*(?:[-*]\s*)?(?:\d+[.)]\s*)?/i, '')
    .trim()
}

function isQuestionLike(value: string): boolean {
  const normalized = value.trim()
  return /\?\s*$/.test(normalized) || /^(?:what|why|how|when|where|who|which|should|can|could|do|does|did|is|are)\b/i.test(normalized)
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\s+/g, ' ').trim().toLowerCase() === right.replace(/\s+/g, ' ').trim().toLowerCase()
}
