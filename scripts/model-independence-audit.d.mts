export interface ModelIndependenceAuditInput {
  repoRoot?: string
  files?: string[]
}

export function findModelProseAuthority(input?: ModelIndependenceAuditInput): string[]
