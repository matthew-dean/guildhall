/**
 * Shared project state. The header, activity chip, and every project-view tab
 * all read from the same /api/project payload — stash it in a single runes
 * object and refresh on SSE supervisor_* events.
 */

import type { ProjectDetail } from './types.js'
import { currentProjectId, projectFetch } from './project-routes.js'

class ProjectStore {
  detail: ProjectDetail | null = $state(null)
  loading = $state(false)
  surfaceLoading = $state(false)
  error: string | null = $state(null)
  #requestSeq = 0
  #appliedSeq = 0
  #inFlight: Promise<ProjectDetail | null> | null = null
  #inFlightKey: string | null = null
  #inventoryOffsets = new Map<string, number>()

  async refresh(
    projectId?: string | null,
    surface?: 'overview' | 'work' | 'map' | null,
    selectedTaskId?: string | null,
    options: { inventoryOffset?: number; inventoryLimit?: number } = {},
  ): Promise<ProjectDetail | null> {
    const normalizedProjectId = projectId?.trim() || null
    const normalizedSurface = surface === 'overview' || surface === 'work' || surface === 'map' ? surface : null
    const normalizedSelectedTaskId = normalizedSurface === 'work' ? selectedTaskId?.trim() || null : null
    const inventoryKey = `${normalizedProjectId ?? ''}:${normalizedSurface ?? ''}`
    const inventoryOffset = normalizedSurface === 'work' || normalizedSurface === 'map'
      ? options.inventoryOffset ?? this.#inventoryOffsets.get(inventoryKey) ?? 0
      : 0
    const inventoryLimit = normalizedSurface === 'work'
      ? options.inventoryLimit ?? 40
      : normalizedSurface === 'map'
        ? options.inventoryLimit ?? 24
        : undefined
    const requestKey = `${inventoryKey}:${normalizedSelectedTaskId ?? ''}:${inventoryOffset}:${inventoryLimit ?? ''}`
    if (this.#inFlight && this.#inFlightKey === requestKey) return this.#inFlight
    this.#inFlightKey = requestKey
    const requestSeq = ++this.#requestSeq
    this.loading = true
    this.surfaceLoading = true
    this.#inFlight = (async () => {
      let summaryApplied = false
      let detailApplied = false
      const applyPayload = (payload: ProjectDetail): void => {
        if (requestSeq < this.#appliedSeq) return
        this.#appliedSeq = requestSeq
        this.error = null
        const current = this.detail
        this.detail = current?.id && current.id === payload.id
          ? { ...current, ...payload }
          : payload
      }
      try {
        const endpoint = normalizedSurface
          ? `/api/project?surface=${normalizedSurface}&compact=true&inventoryLimit=${inventoryLimit ?? ''}&inventoryOffset=${inventoryOffset}${normalizedSelectedTaskId ? `&task=${encodeURIComponent(normalizedSelectedTaskId)}` : ''}`
          : '/api/project?compact=true'
        const summaryProjectId = normalizedProjectId ?? currentProjectId()
        const summaryPromise = summaryProjectId
          ? fetch(`/api/service?projectId=${encodeURIComponent(summaryProjectId)}`, { cache: 'no-store' })
              .then(async response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`)
                const payload = await response.json() as { projects?: ProjectDetail[] }
                const summary = payload.projects?.find(candidate => candidate.id === summaryProjectId)
                if (!summary) throw new Error('Project summary was not returned.')
                return summary
              })
          : Promise.resolve(null)
        const detailPromise = projectFetch(endpoint, { cache: 'no-store' }, normalizedProjectId)
          .then(async response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return await response.json() as ProjectDetail
          })

        const summaryResult = summaryPromise
          .then(summary => {
            if (!summary || summary.error) return
            applyPayload(summary)
            summaryApplied = true
            this.loading = false
          })
          .catch(() => undefined)
        const detailResult = detailPromise
          .then(payload => {
            if (payload.error) throw new Error(payload.error)
            const payloadOffset = payload.taskPayload?.offset ?? 0
            if (normalizedSurface === 'work' || normalizedSurface === 'map') {
              this.#inventoryOffsets.set(inventoryKey, payloadOffset)
            }
            const current = this.detail
            const appendInventory = payloadOffset > 0 && current?.id === payload.id && Array.isArray(current.tasks) && Array.isArray(payload.tasks)
            const mergedPayload = appendInventory
              ? {
                  ...payload,
                  tasks: [...current.tasks, ...payload.tasks].filter((task, index, all) => all.findIndex(candidate => candidate.id === task.id) === index),
                }
              : payload
            applyPayload(mergedPayload)
            detailApplied = true
            return payload
          })
        await Promise.all([summaryResult, detailResult])
        if (summaryApplied) this.loading = false
        return this.detail
      } catch (err) {
        if (!summaryApplied && !detailApplied && requestSeq >= this.#appliedSeq) {
          this.#appliedSeq = requestSeq
          this.error = err instanceof Error ? err.message : String(err)
        }
        return this.detail
      } finally {
        if (requestSeq === this.#requestSeq) this.loading = false
        if (requestSeq === this.#requestSeq) this.surfaceLoading = false
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
