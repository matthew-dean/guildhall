export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItemKind =
  | 'required_migration'
  | 'project_understanding'
  | 'bootstrap_missing'
  | 'setup_pending'
  | 'workspace_import_pending'
  | 'import_draft_queue'
  | 'contract_result_review'
  | 'lever_questions'
  | 'spec_fill_pending'

export interface InboxItem {
  id?: string
  kind: InboxItemKind
  severity: InboxSeverity
  title: string
  detail: string
  status?: 'open' | 'resolved' | 'dismissed' | 'superseded' | string
  resolution?: 'answered' | 'dismissed' | 'migrated' | 'reconciled' | 'replaced' | 'reviewed' | 'verified' | string
  resolutionDetail?: string
  createdAt?: string
  updatedAt?: string
  resolvedAt?: string
  dismissedAt?: string
  actionHref?: string
  taskId?: string
  migrationId?: string
  resultId?: string
  contractId?: string
  changeCount?: number
  reviewBuckets?: string[]
  warningCount?: number
  taskDescription?: string
  escalationId?: string
  signals?: string[]
  defaultCount?: number
  dismissEndpoint?: string
  missingSteps?: string[]
  deliveryStepTitle?: string
  containingWorkTitle?: string
  blocking?: boolean
  dismissible?: boolean
  source?: { system?: string; id?: string }
}

export function inboxItemKey(item: InboxItem): string {
  return [
    item.id ?? '',
    item.kind,
    item.migrationId ?? '',
    item.resultId ?? '',
    item.escalationId ?? '',
    item.taskId ?? '',
    item.actionHref ?? '',
    item.title,
    item.detail ?? '',
  ].join('::')
}
