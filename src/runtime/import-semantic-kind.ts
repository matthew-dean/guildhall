/**
 * Explicit meaning supplied by an importer or evidence adapter.
 *
 * This is intentionally intake-only. It is not a second persisted task kind:
 * once imported work is shaped, the task's structured spec, work units,
 * review-risk profile, and proof paths are authoritative.
 */
export const IMPORT_SEMANTIC_KINDS = [
  'fixture',
  'runner',
  'evaluation',
  'debug_report',
  'schema_prune',
  'drafting_model',
  'author_intent',
  'chapter_draft',
  'writer_packet',
  'provenance',
  'world_state_review',
  'spatial_review',
  'reviewer_lane',
  'workflow',
  'contract',
  'retrieval',
  'agent_call',
  'invalidation',
  'telemetry',
  /** Explicit coordinator metadata for non-executable planning instructions. */
  'planning_instruction',
] as const

export type ImportSemanticKind = typeof IMPORT_SEMANTIC_KINDS[number]
