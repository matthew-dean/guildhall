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

  async refresh(): Promise<ProjectDetail | null> {
    this.loading = true
    try {
      const r = await fetch('/api/project')
      const j = (await r.json()) as ProjectDetail
      if (j.error) {
        this.error = j.error
        return null
      }
      this.error = null
      this.detail = j
      return j
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      this.loading = false
    }
  }
}

export const project = new ProjectStore()
