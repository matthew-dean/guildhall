export function ownerInputObjectiveLabel(label: string): string {
  const trimmed = label.trim()
  if (/^review structural map\b/i.test(trimmed)) return 'Review the project map'
  return trimmed || 'This decision'
}
