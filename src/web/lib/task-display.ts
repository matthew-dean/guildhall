export function readableTaskDescription(
  description: string | null | undefined,
  title?: string | null,
): string {
  const raw = typeof description === 'string' ? description.trim() : ''
  if (!raw) return ''

  const sourceMatch = raw.match(/^([^:\n]+):\s*(?:[-*]\s*)?(?:\*\*)?(.+?)(?:\*\*)?$/)
  if (sourceMatch) {
    const source = sourceMatch[1]?.trim()
    const label = sourceMatch[2]
      ?.replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
    const taskTitle = typeof title === 'string' ? title.trim() : ''
    if (source && label) {
      if (taskTitle && label.toLowerCase() === taskTitle.toLowerCase()) return `From ${source}`
      return `${label} from ${source}`
    }
  }

  return raw
    .replace(/^[-*]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}
