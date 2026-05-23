export type AvatarTone =
  | 'coordinator'
  | 'spec'
  | 'builder'
  | 'reviewer'
  | 'gate'
  | 'human'
  | 'system'

export function avatarToneForRole(role: string | undefined | null): AvatarTone {
  const normalized = (role ?? '').trim().toLowerCase()
  if (normalized.includes('coord')) return 'coordinator'
  if (normalized.includes('spec')) return 'spec'
  if (normalized.includes('build') || normalized.includes('worker')) return 'builder'
  if (normalized.includes('review')) return 'reviewer'
  if (normalized.includes('gate')) return 'gate'
  if (normalized.includes('human') || normalized.includes('you')) return 'human'
  return 'system'
}
