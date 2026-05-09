/**
 * Shared project state. The header, activity chip, and every project-view tab
 * all read from the same /api/project payload — stash it in a single runes
 * object and refresh on SSE supervisor_* events.
 */

import type { ProjectDetail } from './types.js'

class ProjectStore {
  detail: ProjectDetail | null = $state(null)
  loading = $state(false)
  error: string | null = $state(null)
  #requestSeq = 0
  #appliedSeq = 0

  async refresh(): Promise<ProjectDetail | null> {
    const requestSeq = ++this.#requestSeq
    this.loading = true
    try {
      const r = await fetch('/api/project', { cache: 'no-store' })
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
    }
  }
}

export const project = new ProjectStore()
