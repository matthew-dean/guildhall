import { z } from 'zod'

export const PersistenceRef = z.object({
  scope: z.enum([
    'shared_project',
    'local_history',
    'global_user',
    'exported_artifact',
  ]),
  collection: z.string().min(1),
  id: z.string().min(1),
  path: z.string().min(1),
})
export type PersistenceRef = z.infer<typeof PersistenceRef>

export const EvidenceRef = PersistenceRef.extend({
  hash: z.string().optional(),
  contentType: z.string().optional(),
})
export type EvidenceRef = z.infer<typeof EvidenceRef>
