const defaultEnv = (): Record<string, unknown> =>
  (import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}

export function advancedStructureEnabled(env: Record<string, unknown> | undefined = defaultEnv()): boolean {
  const value = env?.VITE_GUILDHALL_ADVANCED_STRUCTURE
  return value === '1' || value === 'true'
}
