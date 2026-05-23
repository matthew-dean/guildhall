import { labelForIdentifier } from './identifier-labels.js'

export function friendlyDomain(domain: string | undefined): string {
  return domain ? labelForIdentifier('domain', domain).label : ''
}

export function friendlyStewardName(_legacyName: string | undefined, domain?: string, id?: string): string {
  const source = friendlyDomain(domain) || friendlyDomain(id) || 'Project'
  return source
}

export function friendlyStatus(status: string | undefined): string {
  return labelForIdentifier('status', status).label
}

export function friendlyPriority(priority: string | undefined): string {
  return priority ? labelForIdentifier('priority', priority).label : 'Normal'
}
