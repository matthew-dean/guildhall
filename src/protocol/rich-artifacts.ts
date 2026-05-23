import { z } from 'zod'

export const richArtifactKindSchema = z.enum([
  'blueprint',
  'review',
  'design-system',
  'micro-editor',
  'diagram',
])

export const richArtifactSchema = z.object({
  contentType: z.literal('guildhall-html-v1'),
  artifactKind: richArtifactKindSchema,
  title: z.string(),
  html: z.string(),
  fallbackMarkdown: z.string(),
  createdBy: z.string().optional(),
  schemaVersion: z.literal(1),
})

export type RichArtifact = z.infer<typeof richArtifactSchema>
export type RichArtifactKind = z.infer<typeof richArtifactKindSchema>

export type RichArtifactComponent = {
  type: 'gh-checklist' | 'gh-step' | 'gh-decision' | 'gh-option'
  props: Record<string, string>
  text?: string
}

export type RichArtifactRenderTree = {
  contentType: 'guildhall-html-v1'
  artifactKind: RichArtifactKind
  title: string
  components: RichArtifactComponent[]
  fallbackMarkdown: string
  createdBy: string
}

export type RichArtifactValidationResult =
  | { ok: true; artifact: RichArtifact; renderTree: RichArtifactRenderTree; errors: [] }
  | { ok: false; artifact?: RichArtifact; renderTree?: undefined; errors: string[] }

const ALLOWED_HTML_TAGS = new Set([
  'a',
  'article',
  'blockquote',
  'br',
  'code',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'small',
  'span',
  'strong',
  'summary',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
])

const ALLOWED_COMPONENT_TAGS = new Set(['gh-checklist', 'gh-step', 'gh-decision', 'gh-option'])
const ALLOWED_ATTRS = new Set(['href', 'id', 'mode', 'recommended', 'status', 'title', 'value'])
const URI_ATTRS = new Set(['href'])
const TAG_PATTERN = /<\/?\s*([a-zA-Z][\w:-]*)\b([^>]*)>/g
const ATTR_PATTERN = /([:@a-zA-Z_][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g

export function compileRichArtifact(input: unknown): RichArtifactValidationResult {
  const parsed = richArtifactSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => issue.message) }
  }
  return validateRichArtifact(parsed.data)
}

export function validateRichArtifact(artifact: RichArtifact): RichArtifactValidationResult {
  const errors: string[] = []
  if (!artifact.title.trim()) errors.push('title is required')
  if (!artifact.fallbackMarkdown.trim()) errors.push('fallbackMarkdown is required')
  if (!artifact.createdBy?.trim()) errors.push('createdBy is required')

  const components = validateMarkup(artifact.html, errors)
  if (errors.length > 0) {
    return { ok: false, artifact, errors: [...new Set(errors)] }
  }

  return {
    ok: true,
    artifact,
    errors: [],
    renderTree: {
      contentType: artifact.contentType,
      artifactKind: artifact.artifactKind,
      title: artifact.title.trim(),
      fallbackMarkdown: artifact.fallbackMarkdown,
      createdBy: artifact.createdBy?.trim() ?? '',
      components,
    },
  }
}

function validateMarkup(html: string, errors: string[]): RichArtifactComponent[] {
  const components: RichArtifactComponent[] = []
  for (const match of html.matchAll(TAG_PATTERN)) {
    const rawTag = match[1] ?? ''
    const tag = rawTag.toLowerCase()
    const attrs = match[2] ?? ''
    const closing = match[0].startsWith('</')
    const isComponent = tag.startsWith('gh-')

    if (isComponent && !ALLOWED_COMPONENT_TAGS.has(tag)) {
      errors.push(`${tag} is not an allowed Guildhall component tag`)
    } else if (!isComponent && !ALLOWED_HTML_TAGS.has(tag)) {
      errors.push(`${tag} is not an allowed tag`)
    }

    const props = validateAttrs(attrs, errors)
    if (!closing && isComponent && ALLOWED_COMPONENT_TAGS.has(tag)) {
      components.push({
        type: tag as RichArtifactComponent['type'],
        props,
        text: componentText(html, tag, match.index ?? 0, isLeafComponent(tag)),
      })
    }
  }
  return components
}

function validateAttrs(rawAttrs: string, errors: string[]): Record<string, string> {
  const props: Record<string, string> = {}
  for (const match of rawAttrs.matchAll(ATTR_PATTERN)) {
    const name = (match[1] ?? '').toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    if (name.startsWith('on')) {
      errors.push('event handler attributes are not allowed')
      continue
    }
    if (name === 'style') {
      errors.push('inline style attributes are not allowed')
      continue
    }
    if (!ALLOWED_ATTRS.has(name)) {
      errors.push(`${name} is not an allowed rich artifact attribute`)
      continue
    }
    if (URI_ATTRS.has(name) && !safeUrl(value)) {
      errors.push(`${value.split(':', 1)[0] || 'unsafe'}: URLs are not allowed in rich artifacts`)
      continue
    }
    props[name] = value
  }
  return props
}

function safeUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('#')) return true
  try {
    const url = new URL(trimmed, 'https://guildhall.local')
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
  } catch {
    return false
  }
}

function isLeafComponent(tag: string): boolean {
  return tag === 'gh-step' || tag === 'gh-option'
}

function componentText(html: string, tag: string, start: number, leaf: boolean): string | undefined {
  if (!leaf) return undefined
  const openEnd = html.indexOf('>', start)
  if (openEnd < 0) return undefined
  const close = html.indexOf(`</${tag}>`, openEnd)
  if (close < 0) return undefined
  const text = html.slice(openEnd + 1, close).replace(TAG_PATTERN, '').replace(/\s+/g, ' ').trim()
  return text || undefined
}
