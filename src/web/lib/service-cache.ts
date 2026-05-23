import type { ServiceDetail } from './types.js'

let cachedService: ServiceDetail | null = null

export function setCachedService(service: ServiceDetail | null): void {
  cachedService = service
}

export function getCachedService(): ServiceDetail | null {
  return cachedService
}
