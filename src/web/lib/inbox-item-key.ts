export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItemKind =
  | 'required_migration'
  | 'project_understanding'
  | 'bootstrap_missing'
  | 'setup_pending'
  | 'workspace_import_pending'
  | 'project_check_in'
  | 'pressure_test_pending'
  | 'agent_question_pending'
  | 'import_draft_queue'
  | 'brief_approval'
  | 'spec_approval'
  | 'open_escalation'
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
  taskDescription?: string
  escalationId?: string
  signals?: string[]
  defaultCount?: number
  dismissEndpoint?: string
  missingSteps?: string[]
  blocking?: boolean
  dismissible?: boolean
  source?: { system?: string; id?: string }
}

export function inboxItemKey(item: InboxItem): string {
  return [
    item.id ?? '',
    item.kind,
    item.migrationId ?? '',
    item.escalationId ?? '',
    item.taskId ?? '',
    item.actionHref ?? '',
    item.title,
    item.detail ?? '',
  ].join('::')
}
