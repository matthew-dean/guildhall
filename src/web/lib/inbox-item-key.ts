export type InboxSeverity = 'high' | 'medium' | 'low'

export type InboxItemKind =
  | 'bootstrap_missing'
  | 'workspace_import_pending'
  | 'brief_approval'
  | 'spec_approval'
  | 'open_escalation'
  | 'lever_questions'
  | 'spec_fill_pending'

export interface InboxItem {
  kind: InboxItemKind
  severity: InboxSeverity
  title: string
  detail: string
  actionHref?: string
  taskId?: string
  escalationId?: string
  signals?: string[]
  defaultCount?: number
  dismissEndpoint?: string
  missingSteps?: string[]
}

export function inboxItemKey(item: InboxItem): string {
  return [
    item.kind,
    item.escalationId ?? '',
    item.taskId ?? '',
    item.actionHref ?? '',
    item.title,
    item.detail ?? '',
  ].join('::')
}
