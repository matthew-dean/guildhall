export function friendlyDomain(domain: string | undefined): string {
  if (!domain) return ''
  if (domain === '_meta') return 'Setup'
  if (domain === '_workspace_import') return 'Workspace import'
  return domain
    .replace(/^_+/, '')
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function friendlyStatus(status: string | undefined): string {
  switch (status) {
    case 'proposed': return 'Backlog'
    case 'exploring': return 'Intake'
    case 'spec_review': return 'Needs spec review'
    case 'pending': return 'Ready'
    case 'ready': return 'Ready'
    case 'in_progress': return 'In progress'
    case 'review': return 'In review'
    case 'gate_check': return 'Checking gates'
    case 'done': return 'Done'
    case 'blocked': return 'Blocked'
    case 'shelved': return 'Shelved'
    default: return status ? friendlyDomain(status) : 'Unknown'
  }
}

export function friendlyPriority(priority: string | undefined): string {
  switch (priority) {
    case 'critical': return 'Critical'
    case 'high': return 'High'
    case 'normal': return 'Normal'
    case 'low': return 'Low'
    default: return priority ? friendlyDomain(priority) : 'Normal'
  }
}
