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
  const title = task.title?.trim()
  const description = task.description?.trim()
  const recovered = recoverClippedTitle(title, description)
  const derived = derivedQuestionTaskLabel(recovered ?? title, description)
  if (derived) return derived
  if (recovered) return recovered
  return title || task.id || fallback
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
  if (description.length <= title.length) return null
  if (!description.toLowerCase().startsWith(compactTitle.toLowerCase())) return null
  return description
}

function isQuestionLike(value: string): boolean {
  const normalized = value.trim()
  return /\?\s*$/.test(normalized) || /^(?:what|why|how|when|where|who|which|should|can|could|do|does|did|is|are)\b/i.test(normalized)
}

function sameText(left: string, right: string): boolean {
  return left.replace(/\s+/g, ' ').trim().toLowerCase() === right.replace(/\s+/g, ' ').trim().toLowerCase()
}
