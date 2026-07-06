/**
 * Shared project state. The header, activity chip, and every project-view tab
 * all read from the same /api/project payload — stash it in a single runes
 * object and refresh on SSE supervisor_* events.
 */

import type { ProjectDetail } from './types.js'
import { projectFetch } from './project-routes.js'

class ProjectStore {
  detail: ProjectDetail | null = $state(null)
  loading = $state(false)
  error: string | null = $state(null)
  #requestSeq = 0
  #appliedSeq = 0
  #inFlight: Promise<ProjectDetail | null> | null = null
  #inFlightKey: string | null = null

  async refresh(projectId?: string | null, surface?: 'work' | null): Promise<ProjectDetail | null> {
    const normalizedProjectId = projectId?.trim() || null
    const normalizedSurface = surface === 'work' ? 'work' : null
    const requestKey = `${normalizedProjectId ?? ''}:${normalizedSurface ?? ''}`
    if (this.#inFlight && this.#inFlightKey === requestKey) return this.#inFlight
    this.#inFlightKey = requestKey
    const requestSeq = ++this.#requestSeq
    this.loading = true
    this.#inFlight = (async () => {
      try {
        const endpoint = normalizedSurface ? `/api/project?surface=${normalizedSurface}` : '/api/project'
        const r = await projectFetch(endpoint, { cache: 'no-store' }, normalizedProjectId)
        const j = (await r.json()) as ProjectDetail
        if (requestSeq < this.#appliedSeq) return this.detail
        if (j.error) {
          this.#appliedSeq = requestSeq
          this.error = j.error
          return null
        }
        this.#appliedSeq = requestSeq
        this.error = null
        this.detail = j
        return j
      } catch (err) {
        if (requestSeq < this.#appliedSeq) return this.detail
        this.#appliedSeq = requestSeq
        this.error = err instanceof Error ? err.message : String(err)
        return null
      } finally {
        if (requestSeq === this.#requestSeq) this.loading = false
        if (this.#inFlightKey === requestKey) {
          this.#inFlight = null
          this.#inFlightKey = null
        }
      }
    })()
    return this.#inFlight
  }
}

export const project = new ProjectStore()
