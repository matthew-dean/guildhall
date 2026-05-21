<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Row from '../../lib/Row.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Icon from '../../lib/Icon.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import SideDrawer from '../../lib/SideDrawer.svelte'
  import WizardStepper from '../../lib/WizardStepper.svelte'
  import { project } from '../../lib/project.svelte.js'
  import { nav } from '../../lib/nav.svelte.js'
  import { projectActionHref, projectFetch } from '../../lib/project-routes.js'
  import { toast } from 'svelte-sonner'

  interface DetectedGoal {
    id: string
    title: string
    rationale: string
    source: string
    references?: readonly string[]
    confidence: 'high' | 'medium' | 'low'
  }
  interface DetectedTask {
    suggestedId: string
    title: string
    description: string
    domain: string
    priority: 'critical' | 'high' | 'normal' | 'low'
    source: string
    references?: readonly string[]
    confidence: 'high' | 'medium' | 'low'
  }
  interface DetectedMilestone {
    title: string
    evidence: string
    source: string
    references?: readonly string[]
  }
  interface DetectedContext {
    label: string
    excerpt: string
    source: string
    references?: readonly string[]
  }
  interface SourceGroup {
    key: string
    label: string
    path: string | null
    areaKey: string
    areaLabel: string
    taskCount: number
    milestoneCount: number
    goalCount: number
    contextCount: number
    existingOverlapCount: number
    kind: 'tasks' | 'milestones' | 'mixed' | 'reference'
    summary: string
    taskIds: string[]
  }
  interface AreaGroup {
    key: string
    label: string
    taskCount: number
    milestoneCount: number
    goalCount: number
    contextCount: number
    sourceCount: number
    sourceKeys: string[]
    summary: string
  }
  interface DetectedDraft {
    goals: DetectedGoal[]
    tasks: DetectedTask[]
    milestones: DetectedMilestone[]
    context: DetectedContext[]
    stats: { inputSignals: number; drafted: number; deduped: number }
    review?: {
      areaGroups: AreaGroup[]
      sourceGroups: SourceGroup[]
      totalTaskCandidates: number
      totalMilestones: number
      totalGoals: number
    }
    learning?: {
      defaults: {
        selectedAreaKeys: string[]
        selectedSourceKeys: string[]
        selectedTaskIds: string[]
        taskSelectionMode: 'all' | 'tight'
        note: string | null
      }
      coordinatorSuggestions: Array<{
        id: string
        title: string
        summary: string
        confidence: 'low' | 'medium' | 'high'
      }>
      productSuggestions: Array<{
        id: string
        title: string
        summary: string
        evidence: string[]
      }>
    }
  }
  interface DraftResponse {
    taskExists: boolean
    specReady: boolean
    taskStatus?: string | null
    detected: DetectedDraft | null
    dismissed: boolean
    anchors?: readonly string[]
    error?: string
  }
  interface CompletedImportSummary {
    tasksAdded: number
    sourceCount: number
    areaCount: number
    goalsRecorded: number
    milestonesLogged: number
  }

  type Step = 'found' | 'parts' | 'sources' | 'tasks' | 'confirm'
  type DetailFocus =
    | { kind: 'area'; key: string }
    | { kind: 'source'; key: string }
    | { kind: 'task'; id: string }
  const journeySteps = [
    { id: 'found', label: '1. Found' },
    { id: 'parts', label: '2. Parts' },
    { id: 'sources', label: '3. Notes' },
    { id: 'tasks', label: '4. Tasks' },
    { id: 'confirm', label: '5. Create' },
  ] satisfies Array<{ id: Step; label: string }>

  let data = $state<DraftResponse | null>(null)
  let error = $state<string | null>(null)
  let busy = $state<null | 'approve' | 'dismiss' | 'rerun'>(null)
  let step = $state<Step>('found')
  let selectedAreaKeys = $state<string[]>([])
  let selectedSourceKeys = $state<string[]>([])
  let selectedTaskIds = $state<string[]>([])
  let currentAreaIndex = $state(0)
  let currentGroupIndex = $state(0)
  let detailFocus = $state<DetailFocus | null>(null)
  let detailOpen = $state(false)
  let completedImport = $state<CompletedImportSummary | null>(null)
  let individualSourceReviewOpen = $state(false)

  function displayText(value: string): string {
    return value
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim()
  }

  async function load() {
    error = null
    try {
      const r = await projectFetch('/api/project/workspace-import/draft')
      const j = (await r.json()) as DraftResponse
      if (j.error) {
        error = j.error
        return
      }
      data = j
      const defaults = j.detected?.learning?.defaults
      const review = j.detected?.review
      if (
        defaults &&
        review?.totalTaskCandidates === 0 &&
        defaults.selectedAreaKeys.length === 0 &&
        defaults.selectedSourceKeys.length === 0
      ) {
        selectedAreaKeys = (review.areaGroups ?? []).map(area => area.key)
        selectedSourceKeys = (review.sourceGroups ?? []).map(group => group.key)
        selectedTaskIds = []
      } else if (defaults) {
        selectedAreaKeys = [...defaults.selectedAreaKeys]
        selectedSourceKeys = [...defaults.selectedSourceKeys]
        selectedTaskIds = [...defaults.selectedTaskIds]
      } else {
        const defaultAreas = (j.detected?.review?.areaGroups ?? []).filter(
          area => area.taskCount > 0,
        )
        const fallbackReferenceAreas = (j.detected?.review?.totalTaskCandidates ?? 0) === 0
          ? (j.detected?.review?.areaGroups ?? [])
          : []
        const selectedDefaults = defaultAreas.length > 0 ? defaultAreas : fallbackReferenceAreas
        selectedAreaKeys = selectedDefaults.map(area => area.key)
        const defaultSources = (j.detected?.review?.sourceGroups ?? []).filter(
          group =>
            selectedDefaults.some(area => area.key === group.areaKey) &&
            (defaultAreas.length > 0 ? group.taskCount > 0 : true),
        )
        selectedSourceKeys = defaultSources.map(group => group.key)
        selectedTaskIds = (j.detected?.tasks ?? [])
          .filter(task => defaultSources.some(group => group.taskIds.includes(task.suggestedId)))
          .map(task => task.suggestedId)
      }
      step = 'found'
      currentAreaIndex = 0
      currentGroupIndex = 0
      detailFocus = null
      detailOpen = false
      individualSourceReviewOpen = false
      completedImport = null
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  $effect(() => {
    load()
  })

  const areaGroups = $derived(data?.detected?.review?.areaGroups ?? [])
  const groups = $derived(data?.detected?.review?.sourceGroups ?? [])
  const totalTaskCandidates = $derived(data?.detected?.review?.totalTaskCandidates ?? 0)
  const totalGoals = $derived(data?.detected?.review?.totalGoals ?? 0)
  const primaryAreas = $derived(areaGroups.filter(area => area.taskCount > 0))
  const secondaryAreas = $derived(areaGroups.filter(area => area.taskCount === 0))
  const selectedAreas = $derived(areaGroups.filter(area => selectedAreaKeys.includes(area.key)))
  const sourceGroupsForSelectedAreas = $derived(
    groups.filter(group => selectedAreaKeys.includes(group.areaKey)),
  )
  const taskBearingGroups = $derived(sourceGroupsForSelectedAreas.filter(group => group.taskCount > 0))
  const secondaryGroups = $derived(sourceGroupsForSelectedAreas.filter(group => group.taskCount === 0))
  const allTasks = $derived(data?.detected?.tasks ?? [])
  const selectedGroups = $derived(groups.filter(group => selectedSourceKeys.includes(group.key)))
  const selectedTaskGroups = $derived(
    selectedGroups.filter(
      group => group.taskCount > 0 && selectedAreaKeys.includes(group.areaKey),
    ),
  )
  const currentArea = $derived(
    selectedAreas[Math.min(currentAreaIndex, Math.max(0, selectedAreas.length - 1))] ?? null,
  )
  const currentAreaSources = $derived(
    currentArea ? groups.filter(group => group.areaKey === currentArea.key) : [],
  )
  const currentAreaPrimarySources = $derived(
    currentAreaSources.filter(group => group.taskCount > 0),
  )
  const currentAreaSecondarySources = $derived(
    currentAreaSources.filter(group => group.taskCount === 0),
  )
  const selectedCurrentAreaSecondaryCount = $derived(
    currentAreaSecondarySources.filter(group => selectedSourceKeys.includes(group.key)).length,
  )
  const focusedArea = $derived(
    detailFocus?.kind === 'area'
      ? areaGroups.find(area => area.key === detailFocus.key) ?? null
      : null,
  )
  const focusedSource = $derived(
    detailFocus?.kind === 'source'
      ? groups.find(group => group.key === detailFocus.key) ?? null
      : null,
  )
  const focusedTask = $derived(
    detailFocus?.kind === 'task'
      ? allTasks.find(task => task.suggestedId === detailFocus.id) ?? null
      : null,
  )
  const drawerTitle = $derived.by(() => {
    if (focusedTask) return displayText(focusedTask.title)
    if (focusedSource) return focusedSource.label
    if (focusedArea) return focusedArea.label
    return 'Details'
  })
  const selectedSourceCount = $derived(
    selectedTaskGroups.length + secondaryGroups.filter(group => selectedSourceKeys.includes(group.key)).length,
  )
  const selectedTasks = $derived(
    allTasks.filter(
      task =>
        selectedTaskIds.includes(task.suggestedId) &&
        selectedGroups.some(group => group.taskIds.includes(task.suggestedId)),
    ),
  )
  const currentGroup = $derived(
    selectedTaskGroups[Math.min(currentGroupIndex, Math.max(0, selectedTaskGroups.length - 1))] ?? null,
  )
  const hasTaskCandidates = $derived(totalTaskCandidates > 0)
  const canConfirmReferenceImport = $derived(
    selectedAreaKeys.length > 0 &&
    selectedSourceKeys.length > 0 &&
    selectedTaskGroups.length === 0,
  )

  function selectArea(key: string) {
    const area = areaGroups.find(item => item.key === key)
    if (!area || selectedAreaKeys.includes(key)) return
    selectedAreaKeys = [...selectedAreaKeys, key]
    const defaultSourceKeys = groups
      .filter(group => group.areaKey === key && (area.taskCount === 0 || group.taskCount > 0))
      .map(group => group.key)
    selectedSourceKeys = [...new Set([...selectedSourceKeys, ...defaultSourceKeys])]
    const taskIdsToAdd = groups
      .filter(group => group.areaKey === key && group.taskCount > 0)
      .flatMap(group => group.taskIds)
    selectedTaskIds = [...new Set([...selectedTaskIds, ...taskIdsToAdd])]
  }

  function removeArea(key: string) {
    const area = areaGroups.find(item => item.key === key)
    if (!area) return
    if (!selectedAreaKeys.includes(key)) return
    selectedAreaKeys = selectedAreaKeys.filter(value => value !== key)
    selectedSourceKeys = selectedSourceKeys.filter(sourceKey => !area.sourceKeys.includes(sourceKey))
    const taskIdsToRemove = groups
      .filter(group => group.areaKey === key && group.taskCount > 0)
      .flatMap(group => group.taskIds)
    selectedTaskIds = selectedTaskIds.filter(id => !taskIdsToRemove.includes(id))
    currentAreaIndex = 0
  }

  function selectAreas(keys: string[]) {
    for (const key of keys) {
      const area = areaGroups.find(item => item.key === key)
      if (!area || selectedAreaKeys.includes(key)) continue
      selectedAreaKeys = [...selectedAreaKeys, key]
      const defaultSourceKeys = groups
        .filter(group => group.areaKey === key && (area.taskCount === 0 || group.taskCount > 0))
        .map(group => group.key)
      selectedSourceKeys = [...new Set([...selectedSourceKeys, ...defaultSourceKeys])]
      const taskIdsToAdd = groups
        .filter(group => group.areaKey === key && group.taskCount > 0)
        .flatMap(group => group.taskIds)
      selectedTaskIds = [...new Set([...selectedTaskIds, ...taskIdsToAdd])]
    }
  }

  function clearAreas(keys: string[]) {
    for (const key of keys) removeArea(key)
  }

  function toggleSource(key: string) {
    if (selectedSourceKeys.includes(key)) {
      selectedSourceKeys = selectedSourceKeys.filter(value => value !== key)
      const group = groups.find(item => item.key === key)
      if (group) {
        selectedTaskIds = selectedTaskIds.filter(id => !group.taskIds.includes(id))
      }
      return
    }
    selectedSourceKeys = [...selectedSourceKeys, key]
    const group = groups.find(item => item.key === key)
    if (group) {
      selectedTaskIds = [...new Set([...selectedTaskIds, ...group.taskIds])]
    }
  }

  function selectSources(keys: string[]) {
    selectedSourceKeys = [...new Set([...selectedSourceKeys, ...keys])]
    const taskIds = groups
      .filter(group => keys.includes(group.key))
      .flatMap(group => group.taskIds)
    if (taskIds.length > 0) {
      selectedTaskIds = [...new Set([...selectedTaskIds, ...taskIds])]
    }
  }

  function clearSources(keys: string[]) {
    selectedSourceKeys = selectedSourceKeys.filter(value => !keys.includes(value))
    const taskIdsToRemove = groups
      .filter(group => keys.includes(group.key))
      .flatMap(group => group.taskIds)
    if (taskIdsToRemove.length > 0) {
      selectedTaskIds = selectedTaskIds.filter(id => !taskIdsToRemove.includes(id))
    }
  }

  function focusArea(key: string) {
    detailFocus = { kind: 'area', key }
    detailOpen = true
  }

  function focusSource(key: string) {
    detailFocus = { kind: 'source', key }
    detailOpen = true
  }

  function focusTask(id: string) {
    detailFocus = { kind: 'task', id }
    detailOpen = true
  }

  function toggleTask(taskId: string) {
    selectedTaskIds = selectedTaskIds.includes(taskId)
      ? selectedTaskIds.filter(id => id !== taskId)
      : [...selectedTaskIds, taskId]
  }

  function selectAllTasksForGroup(group: SourceGroup) {
    selectedTaskIds = [...new Set([...selectedTaskIds, ...group.taskIds])]
  }

  function clearTasksForGroup(group: SourceGroup) {
    selectedTaskIds = selectedTaskIds.filter(id => !group.taskIds.includes(id))
  }

  function tasksForGroup(group: SourceGroup): DetectedTask[] {
    return allTasks.filter(task => group.taskIds.includes(task.suggestedId))
  }

  function areaSummary(area: AreaGroup): string {
    const parts: string[] = []
    if (area.taskCount > 0) {
      parts.push(`${area.taskCount} possible task${area.taskCount === 1 ? '' : 's'}`)
    }
    if (area.sourceCount > 0) {
      parts.push(`${area.sourceCount} planning source${area.sourceCount === 1 ? '' : 's'}`)
    }
    if (area.taskCount === 0 && area.milestoneCount > 0) {
      parts.push(`${area.milestoneCount} milestone note${area.milestoneCount === 1 ? '' : 's'}`)
    }
    if (area.taskCount === 0 && area.contextCount > 0) {
      parts.push(`${area.contextCount} reference note${area.contextCount === 1 ? '' : 's'}`)
    }
    return parts.join(' · ')
  }

  function sourceSummary(group: SourceGroup): string {
    const parts: string[] = []
    if (group.taskCount > 0) {
      parts.push(`${group.taskCount} possible task${group.taskCount === 1 ? '' : 's'}`)
    }
    if (group.milestoneCount > 0) {
      parts.push(`${group.milestoneCount} milestone note${group.milestoneCount === 1 ? '' : 's'}`)
    }
    if (group.contextCount > 0) {
      parts.push(`${group.contextCount} reference note${group.contextCount === 1 ? '' : 's'}`)
    }
    return parts.join(' · ')
  }

  function sourcePreview(area: AreaGroup): string {
    const names = groups
      .filter(group => group.areaKey === area.key && group.taskCount > 0)
      .slice(0, 3)
      .map(group => group.label)
    if (names.length === 0) return 'Reference notes only'
    const preview = names.join(', ')
    const remaining = area.sourceCount - names.length
    return remaining > 0 ? `${preview}, and ${remaining} more` : preview
  }

  function areaKindLabel(area: AreaGroup): string {
    return area.taskCount > 0 ? 'Task-bearing part' : 'Reference-only part'
  }

  function sourceKindLabel(group: SourceGroup): string {
    if (group.kind === 'tasks') return 'Task list'
    if (group.kind === 'mixed') return 'Mixed source'
    if (group.kind === 'milestones') return 'Milestone notes'
    return 'Reference notes'
  }

  function tasksForArea(area: AreaGroup): DetectedTask[] {
    const areaTaskIds = groups
      .filter(group => group.areaKey === area.key)
      .flatMap(group => group.taskIds)
    return allTasks.filter(task => areaTaskIds.includes(task.suggestedId))
  }

  function tasksForFocusedSource(group: SourceGroup): DetectedTask[] {
    return tasksForGroup(group).slice(0, 8)
  }

  function sourceMatches(value: string | undefined, group: SourceGroup): boolean {
    if (!value) return false
    const normalized = value.replaceAll('\\', '/').toLowerCase()
    const groupPath = group.path?.replaceAll('\\', '/').toLowerCase()
    return normalized === group.label.toLowerCase() ||
      Boolean(groupPath && (normalized === groupPath || normalized.endsWith(groupPath) || groupPath.endsWith(normalized)))
  }

  function sourceEvidence(group: SourceGroup): Array<{ label: string; text: string }> {
    const evidence: Array<{ label: string; text: string }> = []
    for (const goal of data?.detected?.goals ?? []) {
      if (sourceMatches(goal.source, group)) evidence.push({ label: 'Goal', text: displayText(goal.rationale || goal.title) })
    }
    for (const milestone of data?.detected?.milestones ?? []) {
      if (sourceMatches(milestone.source, group)) evidence.push({ label: 'Milestone', text: displayText(milestone.evidence || milestone.title) })
    }
    for (const context of data?.detected?.context ?? []) {
      if (
        sourceMatches(context.source, group) ||
        (context.references ?? []).some(ref => sourceMatches(ref, group))
      ) {
        evidence.push({ label: context.label || 'Context', text: displayText(context.excerpt) })
      }
    }
    return evidence.slice(0, 3)
  }

  function usefulSourceSummary(group: SourceGroup): string {
    const evidence = sourceEvidence(group)[0]?.text
    if (evidence && !/^[\w./-]+\.md$/i.test(evidence)) return evidence
    if (group.summary && !/^\d+\s+(reference note|reference notes|source|sources)$/i.test(group.summary)) return group.summary
    return evidence || group.summary
  }

  function displayPath(value: string | null): string {
    if (!value) return ''
    const normalized = value.replaceAll('\\', '/')
    const marker = '/looma-knit/'
    const fromProject = normalized.includes(marker)
      ? normalized.split(marker).at(-1) ?? normalized
      : normalized
    const parts = fromProject.split('/').filter(Boolean)
    if (parts.length <= 4) return fromProject
    return parts.slice(-4).join('/')
  }

  function taskSupportingText(task: DetectedTask): string {
    const raw = displayText(task.description)
      .replace(/^[^:]+:\s*/, '')
      .replace(/^[-*]\s*\[[^\]]+\]\s*/, '')
      .trim()
    if (!raw) return ''
    if (displayText(task.title).toLowerCase() === raw.toLowerCase()) return ''
    return raw
  }

  function openSourceReview() {
    step = 'sources'
    currentAreaIndex = 0
    detailFocus = null
    detailOpen = false
    individualSourceReviewOpen = false
  }

  function openTaskReview() {
    if (selectedTaskGroups.length === 0) {
      step = 'confirm'
      detailFocus = null
      detailOpen = false
      return
    }
    step = 'tasks'
    currentGroupIndex = 0
    detailFocus = null
    detailOpen = false
  }

  function nextAreaLabel(): string | null {
    if (currentAreaIndex >= selectedAreas.length - 1) return null
    return selectedAreas[currentAreaIndex + 1]?.label ?? null
  }

  function nextGroupLabel(): string | null {
    if (currentGroupIndex >= selectedTaskGroups.length - 1) return null
    const next = selectedTaskGroups[currentGroupIndex + 1]
    return next ? `${next.areaLabel} · ${next.label}` : null
  }

  function sourceGroupsWithSelectedTasks() {
    return selectedTaskGroups
      .map(group => ({
        group,
        tasks: tasksForGroup(group).filter(task => selectedTaskIds.includes(task.suggestedId)),
      }))
      .filter(entry => entry.tasks.length > 0)
  }

  function advanceFromSources() {
    if (currentAreaIndex < selectedAreas.length - 1) {
      currentAreaIndex += 1
      detailFocus = null
      detailOpen = false
      individualSourceReviewOpen = false
      return
    }
    if (selectedTaskGroups.length === 0) {
      step = 'confirm'
      detailFocus = null
      detailOpen = false
      individualSourceReviewOpen = false
      return
    }
    openTaskReview()
  }

  function advanceFromTasks() {
    if (currentGroupIndex < selectedTaskGroups.length - 1) {
      currentGroupIndex += 1
      detailFocus = null
      detailOpen = false
      return
    }
    step = 'confirm'
    detailFocus = null
    detailOpen = false
  }

  async function approve() {
    busy = 'approve'
    try {
      const r = await projectFetch('/api/project/workspace-import/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          areaKeys: selectedAreaKeys,
          sourceKeys: selectedSourceKeys,
          taskIds: selectedTaskIds,
        }),
      })
      const j = (await r.json()) as {
        ok?: boolean
        tasksAdded?: number
        goalsRecorded?: number
        milestonesLogged?: number
        error?: string
      }
      if (!r.ok || j.error) {
        toast.error(j.error ?? `Import failed (${r.status})`)
        return
      }
      completedImport = {
        tasksAdded: j.tasksAdded ?? 0,
        sourceCount: selectedGroups.length,
        areaCount: selectedAreaKeys.length,
        goalsRecorded: j.goalsRecorded ?? 0,
        milestonesLogged: j.milestonesLogged ?? 0,
      }
      try {
        sessionStorage.setItem(
          'guildhall:workspace-import-handoff',
          JSON.stringify({
            tasksAdded: j.tasksAdded ?? 0,
            sourceCount: selectedGroups.length,
          }),
        )
      } catch {
        // Non-blocking browser storage write.
      }
      await project.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busy = null
    }
  }

  async function dismiss() {
    busy = 'dismiss'
    try {
      const r = await projectFetch('/api/project/workspace-import/dismiss', { method: 'POST' })
      if (!r.ok) {
        toast.error(`Dismiss failed (${r.status})`)
        return
      }
      toast.success('Import review dismissed for now.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busy = null
    }
  }

  async function rerun() {
    busy = 'rerun'
    try {
      const r = await projectFetch('/api/project/workspace-import/rerun', { method: 'POST' })
      const j = (await r.json()) as { error?: string }
      if (!r.ok || j.error) {
        toast.error(j.error ?? `Re-run failed (${r.status})`)
        return
      }
      toast.success('Re-read project notes and rebuilt the import draft.')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busy = null
    }
  }
</script>

<div class="wrap">
  <header class="head">
    <h2>Review existing project work</h2>
    <p class="sub">
      Guildhall has already scanned the notes, roadmaps, and project docs it found here.
      You are confirming what should be remembered as context and what should become backlog tasks.
    </p>
  </header>

  {#if error}
    <Card tone="danger">
      <p class="muted">Couldn't load import findings: {error}</p>
      <Button variant="secondary" onclick={load}>Retry</Button>
    </Card>
  {:else if !data}
    <p class="muted">Loading import findings...</p>
  {:else if !data.detected}
    <Card>
      <Stack gap="4">
        <p class="muted">Guildhall did not find any importable planning material yet.</p>
        <Row justify="end" gap="3" wrap>
          <Button variant="secondary" onclick={rerun} disabled={busy !== null}>
            {busy === 'rerun' ? 'Re-reading...' : 'Re-read project notes'}
          </Button>
        </Row>
      </Stack>
    </Card>
  {:else if completedImport}
    <Card tone="accent">
      <Stack gap="5">
        <div class="section-intro">
          <div class="section-kicker">
            <Chip label="Import complete" tone="accent" />
            <span>Next up</span>
          </div>
          {#if completedImport.tasksAdded > 0}
            <h3 class="section-title">
              Guildhall created {completedImport.tasksAdded} draft task{completedImport.tasksAdded === 1 ? '' : 's'}.
            </h3>
            <p class="section-copy">
              Nothing starts automatically. These new tasks are paused drafts until you shape them in Thread.
            </p>
          {:else}
            <h3 class="section-title">Guildhall saved project context.</h3>
            <p class="section-copy">
              Guildhall did not infer draft tasks from this pass, but it recorded the sources and goals so the next task can start from real context.
            </p>
          {/if}
        </div>
        <div class="metric-row">
          <Chip label={`${completedImport.sourceCount} source${completedImport.sourceCount === 1 ? '' : 's'}`} tone="neutral" />
          <Chip label={`${completedImport.areaCount} part${completedImport.areaCount === 1 ? '' : 's'}`} tone="neutral" />
          {#if completedImport.milestonesLogged > 0}
            <Chip label={`${completedImport.milestonesLogged} milestones logged`} tone="neutral" />
          {/if}
          {#if completedImport.goalsRecorded > 0}
            <Chip label={`${completedImport.goalsRecorded} goals recorded`} tone="neutral" />
          {/if}
        </div>
        <Row justify="end" gap="3" wrap>
          <Button variant="secondary" onclick={() => nav(projectActionHref('/work'))}>
            See all tasks in Work
          </Button>
          <Button variant="primary" onclick={() => nav(projectActionHref('/thread'))}>
            {completedImport.tasksAdded > 0 ? 'Shape imported drafts in Thread' : 'Use this context in Thread'}
          </Button>
        </Row>
      </Stack>
    </Card>
  {:else}
    <WizardStepper steps={journeySteps} activeId={step} />

    {#if step === 'found'}
      <Card>
        <Stack gap="5">
          <div class="section-intro">
            <div class="section-kicker">
              <Chip label="Step 1 of 5" tone="accent" />
              <span>Found</span>
            </div>
            <h3 class="section-title">
              Guildhall found planning notes in {areaGroups.length} project part{areaGroups.length === 1 ? '' : 's'}
            </h3>
            <p class="section-copy">
              {#if hasTaskCandidates}
                Confirm the parts first. Then Guildhall will walk you through the sources and the possible tasks,
                one slice at a time.
              {:else}
                Confirm the parts first. Guildhall found planning notes and goals here, but it did not infer any draft tasks yet.
                You can still review the sources and import the project context it found.
              {/if}
            </p>
            <div class="metric-row" aria-label="Import summary">
              <Chip label={`${areaGroups.length} parts`} tone="accent" />
              {#if hasTaskCandidates}
                <Chip label={`${totalTaskCandidates} possible tasks`} tone="ok" />
              {:else if totalGoals > 0}
                <Chip label={`${totalGoals} goals`} tone="neutral" />
              {:else}
                <Chip label="0 task candidates" tone="neutral" />
              {/if}
              <Chip label={`${groups.length} sources`} tone="neutral" />
            </div>
          </div>
          {#if data.detected?.learning?.defaults?.note}
            <p class="learned-note">{data.detected.learning.defaults.note}</p>
          {/if}
          <ul class="source-summary">
            {#each primaryAreas as area (area.key)}
              <li>
                <Row justify="between" align="start" gap="4" wrap>
                  <div class="summary-main">
                    <div class="summary-title-row">
                      <strong>{area.label}</strong>
                    </div>
                    <div class="metric-row">
                      <Chip label={`${area.taskCount} tasks`} tone="ok" />
                      <Chip label={`${area.sourceCount} sources`} tone="neutral" />
                    </div>
                  </div>
                  <div class="summary-side">
                    <span class="summary-label">Planning sources</span>
                    <span class="summary-preview">{sourcePreview(area)}</span>
                  </div>
                  <Button variant="ghost" size="sm" onclick={() => focusArea(area.key)}>
                    Details
                  </Button>
                </Row>
              </li>
            {/each}
          </ul>
          {#if secondaryAreas.length > 0}
            <details class="secondary-summary">
              <summary>Show reference-only parts</summary>
              <ul class="source-summary nested">
                {#each secondaryAreas as area (area.key)}
                  <li>
                    <Row justify="between" align="start" gap="4" wrap>
                      <div class="summary-main">
                        <div class="summary-title-row">
                          <strong>{area.label}</strong>
                        </div>
                        <div class="metric-row">
                          <Chip label={`${area.milestoneCount || area.contextCount} reference notes`} tone="neutral" />
                          <Chip label={`${area.sourceCount} sources`} tone="neutral" />
                        </div>
                      </div>
                      <div class="summary-side">
                        <span class="summary-label">Reference notes</span>
                        <span class="summary-preview">{sourcePreview(area)}</span>
                      </div>
                      <Button variant="ghost" size="sm" onclick={() => focusArea(area.key)}>
                        Details
                      </Button>
                    </Row>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
          <Row justify="end" gap="3" wrap>
            <Button variant="secondary" onclick={dismiss} disabled={busy !== null}>
              {busy === 'dismiss' ? 'Dismissing...' : 'Skip import for now'}
            </Button>
            <Button variant="primary" onclick={() => (step = 'parts')}>
              {hasTaskCandidates ? 'Choose parts to review' : 'Review found sources'}
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}

    {#if step === 'parts'}
      <Card>
        <Stack gap="5">
          <div class="section-intro">
            <div class="section-kicker">
              <Chip label="Step 2 of 5" tone="accent" />
              <span>Project parts</span>
            </div>
            <h3 class="section-title">Choose the parts for this pass</h3>
            <p class="section-copy">
              Nothing is being imported yet. Select the parts you want Guildhall to review.
              Next, Guildhall will walk through their notes one part at a time.
              Reference-only parts can still be useful context; they just do not contain task candidates yet.
            </p>
            <div class="metric-row" aria-label="Part selection summary">
              <Chip label={`${selectedAreaKeys.length} selected`} tone="accent" />
              <Chip label={`${primaryAreas.length} task-bearing parts`} tone="ok" />
            </div>
          </div>
          <Stack gap="4">
          {#each primaryAreas as area (area.key)}
            <div class:selected={selectedAreaKeys.includes(area.key)} class="source-card">
              <Row justify="between" align="start" gap="4" wrap>
                <div class="card-main">
                  <Stack gap="3">
                    <div class="source-title-row">
                      <strong>{area.label}</strong>
                      {#if selectedAreaKeys.includes(area.key)}
                        <Chip label="Queued" tone="accent" />
                      {/if}
                      <span class:reference={area.taskCount === 0} class="kind-label">
                        {areaKindLabel(area)}
                      </span>
                    </div>
                    <div class="metric-row">
                      <Chip label={`${area.taskCount} tasks`} tone="ok" />
                      <Chip label={`${area.sourceCount} sources`} tone="neutral" />
                    </div>
                    <div class="source-path">{sourcePreview(area)}</div>
                  </Stack>
                </div>
                <div class="card-actions-inline">
                  <Button variant="ghost" size="sm" onclick={() => focusArea(area.key)}>
                    Details
                  </Button>
                  {#if selectedAreaKeys.includes(area.key)}
                    <Button variant="secondary" size="sm" onclick={() => removeArea(area.key)}>
                      <Icon name="x" size={14} />
                      Exclude
                    </Button>
                  {:else}
                    <Button variant="secondary" size="sm" onclick={() => selectArea(area.key)}>
                      <Icon name="plus" size={14} />
                      Include
                    </Button>
                  {/if}
                </div>
              </Row>
            </div>
          {/each}
          </Stack>
          {#if secondaryAreas.length > 0}
            <details class="secondary-summary" open={primaryAreas.length === 0}>
              <summary>Included project context</summary>
              <p class="secondary-help">
                These parts contain goals, specs, or context rather than obvious task lists. Guildhall includes project docs by default so future work starts from the project’s actual direction. Exclude a part only when it is stale, noisy, or unrelated.
              </p>
              <div class="bulk-row">
                <span class="bulk-label">{secondaryAreas.length} reference-only part{secondaryAreas.length === 1 ? '' : 's'} available</span>
                <Row gap="2" wrap>
                  <Button variant="secondary" size="sm" onclick={() => selectAreas(secondaryAreas.map(area => area.key))}>
                    Restore
                  </Button>
                  <Button variant="secondary" size="sm" onclick={() => clearAreas(secondaryAreas.map(area => area.key))}>
                    Exclude all
                  </Button>
                </Row>
              </div>
              <Stack gap="4">
              {#each secondaryAreas as area (area.key)}
                <div class:selected={selectedAreaKeys.includes(area.key)} class="source-card secondary">
                  <Row justify="between" align="start" gap="4" wrap>
                    <div class="card-main">
                      <Stack gap="3">
                        <div class="source-title-row">
                          <strong>{area.label}</strong>
                          {#if selectedAreaKeys.includes(area.key)}
                            <Chip label="Queued" tone="accent" />
                          {/if}
                          <span class="kind-label reference">Reference-only part</span>
                        </div>
                        <div class="metric-row">
                          <Chip label={`${area.sourceCount} sources`} tone="neutral" />
                          <Chip label={`${area.milestoneCount || area.contextCount} notes`} tone="neutral" />
                        </div>
                        <div class="source-path">{sourcePreview(area)}</div>
                      </Stack>
                    </div>
                    <div class="card-actions-inline">
                      <Button variant="ghost" size="sm" onclick={() => focusArea(area.key)}>
                        Details
                      </Button>
                      {#if selectedAreaKeys.includes(area.key)}
                        <Button variant="secondary" size="sm" onclick={() => removeArea(area.key)}>
                          <Icon name="x" size={14} />
                          Exclude
                        </Button>
                      {:else}
                        <Button variant="secondary" size="sm" onclick={() => selectArea(area.key)}>
                          <Icon name="plus" size={14} />
                          Include
                        </Button>
                      {/if}
                    </div>
                  </Row>
                </div>
              {/each}
              </Stack>
            </details>
          {/if}
          <Row justify="end" gap="3" wrap>
            <Button variant="secondary" onclick={() => { step = 'found'; detailOpen = false }}>Back</Button>
            <Button variant="primary" onclick={openSourceReview} disabled={selectedAreas.length === 0}>
              Review {selectedAreas.length} selected part{selectedAreas.length === 1 ? '' : 's'}
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}

    {#if step === 'sources'}
      <Card>
        <Stack gap="5">
          <div class="section-intro">
            <div class="section-kicker">
              <Chip label="Step 3 of 5" tone="accent" />
              <span>Notes</span>
            </div>
            <h3 class="section-title">{currentArea ? `Review notes in ${currentArea.label}` : 'Review notes'}</h3>
            <p class="section-copy">
            These are the planning notes Guildhall found inside this part of the project.
            Keep the notes you want to use in this pass, then move on.
            Reference notes become project context; task-bearing notes can also create draft tasks.
            </p>
            <div class="metric-row" aria-label="Source review summary">
              <Chip label={`Part ${Math.min(currentAreaIndex + 1, Math.max(selectedAreas.length, 1))} of ${Math.max(selectedAreas.length, 1)}`} tone="accent" />
              <Chip label={`${selectedSourceCount} notes in this pass`} tone="neutral" />
              <Chip label={`${selectedTasks.length} tasks currently kept`} tone="ok" />
            </div>
          </div>
        {#if currentArea}
          <Stack gap="4">
            {#each currentAreaPrimarySources as group (group.key)}
              <div class:selected={selectedSourceKeys.includes(group.key)} class="source-card">
                <Row justify="between" align="start" gap="4" wrap>
                  <div class="card-main">
                    <Stack gap="3">
                      <div class="source-title-row">
                        <strong>{group.label}</strong>
                        {#if selectedSourceKeys.includes(group.key)}
                          <Chip label="In this pass" tone="accent" />
                        {/if}
                        <span class:reference={group.kind === 'reference' || group.kind === 'milestones'} class="kind-label">
                          {sourceKindLabel(group)}
                        </span>
                      </div>
                      <div class="metric-row">
                        {#if group.taskCount > 0}
                          <Chip label={`${group.taskCount} tasks`} tone="ok" />
                        {/if}
                        {#if group.milestoneCount > 0}
                          <Chip label={`${group.milestoneCount} milestones`} tone="warn" />
                        {/if}
                        <Chip label={group.contextCount > 0 ? `${group.contextCount} notes` : 'source'} tone="neutral" />
                      </div>
                      {#if group.path}
                        <div class="source-path">{displayPath(group.path)}</div>
                      {/if}
                      {#if usefulSourceSummary(group)}
                        <p class="source-summary-copy">{usefulSourceSummary(group)}</p>
                      {/if}
                    </Stack>
                  </div>
                  <div class="card-actions-inline">
                    <Button variant="ghost" size="sm" onclick={() => focusSource(group.key)}>
                      Details
                    </Button>
                    <Button variant={selectedSourceKeys.includes(group.key) ? 'secondary' : 'primary'} size="sm" onclick={() => toggleSource(group.key)}>
                      {selectedSourceKeys.includes(group.key) ? 'Exclude' : 'Include'}
                    </Button>
                  </div>
                </Row>
              </div>
            {/each}
          </Stack>
          {#if currentAreaSecondarySources.length > 0}
            <details class="secondary-summary" open={currentAreaPrimarySources.length === 0}>
              <summary>Included context notes in {currentArea.label}</summary>
              <div class="bulk-row">
                <p class="secondary-help">
                  These notes may not create tasks by themselves, but they preserve goals, decisions, and product framing for the next work pass. Keep them selected unless a note is stale, misleading, or outside this project.
                </p>
                <Row gap="2" wrap>
                  <Chip
                    label={`${selectedCurrentAreaSecondaryCount} of ${currentAreaSecondarySources.length} selected`}
                    tone={selectedCurrentAreaSecondaryCount === currentAreaSecondarySources.length ? 'accent' : 'neutral'}
                  />
                  {#if selectedCurrentAreaSecondaryCount < currentAreaSecondarySources.length}
                    <Button variant="secondary" size="sm" onclick={() => selectSources(currentAreaSecondarySources.map(group => group.key))}>
                      Restore
                    </Button>
                  {/if}
                  {#if selectedCurrentAreaSecondaryCount > 0}
                    <Button variant="secondary" size="sm" onclick={() => clearSources(currentAreaSecondarySources.map(group => group.key))}>
                      Exclude selected
                    </Button>
                  {/if}
                </Row>
              </div>
              <div class="individual-source-list">
                <Button
                  variant="secondary"
                  size="sm"
                  onclick={() => (individualSourceReviewOpen = !individualSourceReviewOpen)}
                >
                  {individualSourceReviewOpen ? 'Hide individual notes' : 'Review individual notes'}
                </Button>
                {#if individualSourceReviewOpen}
                <Stack gap="4">
                  {#each currentAreaSecondarySources as group (group.key)}
                    <div class:selected={selectedSourceKeys.includes(group.key)} class="source-card secondary">
                      <Row justify="between" align="start" gap="4" wrap>
                        <label class="source-check">
                          <input
                            type="checkbox"
                            checked={selectedSourceKeys.includes(group.key)}
                            onchange={() => toggleSource(group.key)}
                          />
                        </label>
                        <div class="card-main">
                          <Stack gap="3">
                            <div class="source-title-row">
                              <strong>{group.label}</strong>
                              {#if selectedSourceKeys.includes(group.key)}
                                <Chip label="In this pass" tone="accent" />
                              {/if}
                              <span class="kind-label reference">{sourceKindLabel(group)}</span>
                            </div>
                            <div class="metric-row">
                              <Chip label={sourceSummary(group)} tone="neutral" />
                            </div>
                            {#if group.path}
                              <div class="source-path">{displayPath(group.path)}</div>
                            {/if}
                            {#if usefulSourceSummary(group)}
                              <p class="source-summary-copy">{usefulSourceSummary(group)}</p>
                            {/if}
                          </Stack>
                        </div>
                        <Button variant="ghost" size="sm" onclick={() => focusSource(group.key)}>
                          Details
                        </Button>
                      </Row>
                    </div>
                  {/each}
                </Stack>
                {/if}
              </div>
            </details>
          {/if}
        {/if}
        <Row justify="end" gap="3" wrap>
          <Button variant="secondary" onclick={() => { step = 'parts'; detailOpen = false }}>Back</Button>
          <Button variant="primary" onclick={advanceFromSources} disabled={selectedSourceKeys.length === 0}>
            {#if nextAreaLabel()}
              Review {nextAreaLabel()} next
            {:else if selectedTaskGroups.length === 0}
              Review import summary
            {:else}
              Review selected tasks
            {/if}
          </Button>
        </Row>
        </Stack>
      </Card>
    {/if}

    {#if step === 'tasks'}
      <Stack gap="4">
        <Card>
          <div class="section-intro">
            <div class="section-kicker">
              <Chip label="Step 4 of 5" tone="accent" />
              <span>Tasks</span>
            </div>
            <h3 class="section-title">{currentGroup ? `Review tasks from ${currentGroup.label}` : 'Review selected tasks'}</h3>
            <p class="section-copy">
            Guildhall already turned these notes into draft tasks. Keep the ones that belong in this pass.
            </p>
            <div class="metric-row" aria-label="Task review summary">
              <Chip label={`Source ${Math.min(currentGroupIndex + 1, Math.max(selectedTaskGroups.length, 1))} of ${Math.max(selectedTaskGroups.length, 1)}`} tone="accent" />
              <Chip label={`${selectedTasks.length} tasks currently kept`} tone="ok" />
            </div>
          </div>
        </Card>
        {#if currentGroup}
          <Card title={`${currentGroup.areaLabel} · ${currentGroup.label}`}>
            <Row justify="between" align="start" gap="4" wrap>
              <Stack gap="2">
                <div class="muted">{currentGroup.areaLabel}</div>
                <div class="muted">{sourceSummary(currentGroup)}</div>
              </Stack>
              <Row gap="2" wrap>
                <Button variant="secondary" size="sm" onclick={() => clearTasksForGroup(currentGroup)}>Skip this source</Button>
                <Button variant="secondary" size="sm" onclick={() => selectAllTasksForGroup(currentGroup)}>Keep this source</Button>
              </Row>
            </Row>
            <ul class="items">
              {#each tasksForGroup(currentGroup) as task (task.suggestedId)}
                <li class:selected={selectedTaskIds.includes(task.suggestedId)}>
                  <div class="task-row">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.suggestedId)}
                      onchange={() => toggleTask(task.suggestedId)}
                    />
                    <button type="button" class="inspect-task" onclick={() => focusTask(task.suggestedId)}>
                    <div class="task-copy">
                      <div class="item-title">
                        <Markdown source={displayText(task.title)} inline />
                        <Chip label={task.priority} tone={task.priority === 'high' || task.priority === 'critical' ? 'danger' : 'neutral'} />
                      </div>
                      {#if taskSupportingText(task)}
                        <div class="item-sub"><Markdown source={taskSupportingText(task)} inline /></div>
                      {/if}
                    </div>
                    </button>
                  </div>
                </li>
              {/each}
            </ul>
          </Card>
        {/if}
        <Row justify="end" gap="3" wrap>
          <Button variant="secondary" onclick={() => { step = 'sources'; detailOpen = false }}>Back</Button>
          <Button variant="primary" onclick={advanceFromTasks} disabled={selectedTaskIds.length === 0}>
            {#if nextGroupLabel()}
              Review next source
            {:else}
              Review final task list
            {/if}
          </Button>
        </Row>
      </Stack>
    {/if}

    {#if step === 'confirm'}
      <Card>
        <Stack gap="5">
          <div class="section-intro">
            <div class="section-kicker">
              <Chip label="Step 5 of 5" tone="accent" />
              <span>Create</span>
            </div>
            {#if selectedTasks.length > 0}
              <h3 class="section-title">Create {selectedTasks.length} draft task{selectedTasks.length === 1 ? '' : 's'}?</h3>
              <p class="section-copy">
              Guildhall will create paused draft tasks from these notes. Nothing starts automatically.
              Next, you will shape them in Thread before any worker begins.
              </p>
            {:else}
              <h3 class="section-title">Import the project notes and goals?</h3>
              <p class="section-copy">
              Guildhall did not infer draft tasks from these sources, but it can still record the goals and notes it found so the project starts from honest context instead of an empty slate.
              </p>
            {/if}
          </div>
          <Stack gap="4">
            {#if selectedTasks.length > 0}
              {#each sourceGroupsWithSelectedTasks() as entry (entry.group.key)}
                <Card title={`${entry.group.areaLabel} · ${entry.group.label}`}>
                  <Stack gap="3">
                    <div class="metric-row">
                      <Chip label={`${entry.tasks.length} task${entry.tasks.length === 1 ? '' : 's'}`} tone="ok" />
                    </div>
                    <ul class="items compact">
                      {#each entry.tasks as task (task.suggestedId)}
                        <li>
                          <button type="button" class="inspect-task" onclick={() => focusTask(task.suggestedId)}>
                          <div class="task-copy">
                            <div class="item-title">
                              <Markdown source={displayText(task.title)} inline />
                              <Chip label={task.priority} tone={task.priority === 'high' || task.priority === 'critical' ? 'danger' : 'neutral'} />
                            </div>
                            {#if taskSupportingText(task)}
                              <div class="item-sub"><Markdown source={taskSupportingText(task)} inline /></div>
                            {/if}
                          </div>
                          </button>
                        </li>
                      {/each}
                    </ul>
                  </Stack>
                </Card>
              {/each}
            {:else}
              <Card title="What Guildhall will keep">
                <Stack gap="3">
                  <div class="metric-row">
                    <Chip label={`${selectedAreaKeys.length} part${selectedAreaKeys.length === 1 ? '' : 's'}`} tone="accent" />
                    <Chip label={`${selectedSourceKeys.length} source${selectedSourceKeys.length === 1 ? '' : 's'}`} tone="neutral" />
                    {#if totalGoals > 0}
                      <Chip label={`${totalGoals} goal${totalGoals === 1 ? '' : 's'}`} tone="neutral" />
                    {/if}
                  </div>
                  <p class="detail-copy">
                    This pass records the project context Guildhall found so later task shaping can build on it, even though this scan did not yield any draft task candidates yet.
                  </p>
                </Stack>
              </Card>
            {/if}
          </Stack>
          <Row justify="end" gap="3" wrap>
            <Button variant="secondary" onclick={() => { step = selectedTasks.length > 0 ? 'tasks' : 'sources'; detailOpen = false }}>Back</Button>
            <Button variant="primary" onclick={approve} disabled={busy !== null || (selectedTaskIds.length === 0 && !canConfirmReferenceImport)}>
              {#if busy === 'approve'}
                {selectedTasks.length > 0 ? 'Creating tasks...' : 'Saving import...'}
              {:else}
                {selectedTasks.length > 0 ? 'Create tasks' : 'Save import'}
              {/if}
            </Button>
          </Row>
        </Stack>
      </Card>
    {/if}
  {/if}

  <SideDrawer
    open={detailOpen && detailFocus !== null}
    title={drawerTitle}
    onClose={() => (detailOpen = false)}
  >
    {#snippet children()}
      {#if focusedArea}
        <Stack gap="4">
          <div class="metric-row">
            <Chip label={selectedAreaKeys.includes(focusedArea.key) ? 'In this pass' : 'Not in this pass'} tone={selectedAreaKeys.includes(focusedArea.key) ? 'accent' : 'neutral'} />
            <Chip label={areaKindLabel(focusedArea)} tone={focusedArea.taskCount > 0 ? 'ok' : 'neutral'} />
          </div>
          <p class="detail-copy">{focusedArea.summary}</p>
          <div class="detail-block">
            <div class="detail-label">Counts</div>
            <div class="metric-row">
              <Chip label={`${focusedArea.taskCount} tasks`} tone="ok" />
              <Chip label={`${focusedArea.sourceCount} sources`} tone="neutral" />
              {#if focusedArea.milestoneCount > 0}
                <Chip label={`${focusedArea.milestoneCount} milestones`} tone="warn" />
              {/if}
            </div>
          </div>
          <div class="detail-block">
            <div class="detail-label">Sources in this part</div>
            <ul class="detail-list">
              {#each groups.filter(group => group.areaKey === focusedArea.key).slice(0, 6) as group (group.key)}
                <li>{group.label}</li>
              {/each}
            </ul>
          </div>
          {#if tasksForArea(focusedArea).length > 0}
            <div class="detail-block">
              <div class="detail-label">Example tasks</div>
              <ul class="detail-list">
                {#each tasksForArea(focusedArea).slice(0, 4) as task (task.suggestedId)}
                  <li>{displayText(task.title)}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </Stack>
      {:else if focusedSource}
        <Stack gap="4">
          <div class="metric-row">
            <Chip label={selectedSourceKeys.includes(focusedSource.key) ? 'In this pass' : 'Not in this pass'} tone={selectedSourceKeys.includes(focusedSource.key) ? 'accent' : 'neutral'} />
            <Chip label={sourceKindLabel(focusedSource)} tone={focusedSource.taskCount > 0 ? 'ok' : 'neutral'} />
          </div>
          {#if focusedSource.path}
            <div class="detail-block">
              <div class="detail-label">Source file</div>
              <div class="detail-code">{displayPath(focusedSource.path)}</div>
            </div>
          {/if}
          <p class="detail-copy">{usefulSourceSummary(focusedSource)}</p>
          {#if sourceEvidence(focusedSource).length > 0}
            <div class="detail-block">
              <div class="detail-label">Useful signals</div>
              <ul class="detail-list">
                {#each sourceEvidence(focusedSource) as item}
                  <li><strong>{item.label}:</strong> {item.text}</li>
                {/each}
              </ul>
            </div>
          {/if}
          <div class="detail-block">
            <div class="detail-label">What Guildhall found here</div>
            <div class="metric-row">
              {#if focusedSource.taskCount > 0}
                <Chip label={`${focusedSource.taskCount} tasks`} tone="ok" />
              {/if}
              {#if focusedSource.milestoneCount > 0}
                <Chip label={`${focusedSource.milestoneCount} milestones`} tone="warn" />
              {/if}
              {#if focusedSource.contextCount > 0}
                <Chip label={`${focusedSource.contextCount} notes`} tone="neutral" />
              {/if}
            </div>
          </div>
          {#if tasksForFocusedSource(focusedSource).length > 0}
            <div class="detail-block">
              <div class="detail-label">Example tasks</div>
              <ul class="detail-list">
                {#each tasksForFocusedSource(focusedSource).slice(0, 5) as task (task.suggestedId)}
                  <li>{displayText(task.title)}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </Stack>
      {:else if focusedTask}
        <Stack gap="4">
          <div class="metric-row">
            <Chip label={selectedTaskIds.includes(focusedTask.suggestedId) ? 'In this pass' : 'Not in this pass'} tone={selectedTaskIds.includes(focusedTask.suggestedId) ? 'accent' : 'neutral'} />
            <Chip label={focusedTask.priority} tone={focusedTask.priority === 'high' || focusedTask.priority === 'critical' ? 'danger' : 'neutral'} />
          </div>
          {#if taskSupportingText(focusedTask)}
            <p class="detail-copy">{taskSupportingText(focusedTask)}</p>
          {/if}
          <div class="detail-block">
            <div class="detail-label">Source note</div>
            <div class="detail-code">{displayText(focusedTask.source)}</div>
          </div>
          {#if focusedTask.references?.length}
            <div class="detail-block">
              <div class="detail-label">References</div>
              <ul class="detail-list">
                {#each focusedTask.references.slice(0, 6) as ref}
                  <li>{displayPath(ref)}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </Stack>
      {/if}
    {/snippet}
  </SideDrawer>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: var(--s-5);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .head h2 {
    margin: 0;
    font-size: var(--fs-4);
    font-weight: 700;
    line-height: var(--lh-tight);
  }
  .sub {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    max-width: 72ch;
  }
  .muted { color: var(--text-muted); font-size: var(--fs-1); }
  .section-intro {
    display: flex;
    flex-direction: column;
    gap: var(--s-3);
  }
  .section-kicker {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    color: var(--text-muted);
    font-size: var(--fs-1);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .section-title {
    margin: 0;
    color: var(--text);
  }
  .section-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    max-width: 72ch;
  }
  .detail-label {
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
    margin-bottom: var(--s-1);
  }
  .detail-copy {
    margin: 0;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .detail-list {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  .detail-code {
    color: var(--text-muted);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
    word-break: break-word;
  }
  .detail-block {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .metric-row {
    display: flex;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .learned-note {
    margin: var(--s-2) 0 0;
    color: var(--accent-2);
    font-size: var(--fs-1);
  }
  .source-summary {
    list-style: none;
    padding: 0;
    margin: var(--s-4) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .source-summary li {
    display: grid;
    grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
    gap: var(--s-4);
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    align-items: flex-start;
  }
  .summary-main {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    min-width: 0;
  }
  .summary-title-row {
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .summary-side {
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
    align-items: flex-start;
    text-align: left;
    min-width: 0;
    max-width: 52ch;
  }
  .summary-label {
    color: var(--text-muted);
    font-size: var(--fs-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .summary-preview {
    color: var(--text);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
  }
  .inspect-task {
    appearance: none;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    margin: 0;
    text-align: left;
    cursor: pointer;
  }
  .inspect-task {
    flex: 1;
    min-width: 0;
    border-radius: var(--r-1);
    transition: background-color 140ms ease, box-shadow 140ms ease;
  }
  .inspect-task:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .inspect-task:focus-visible {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .source-summary.nested {
    margin-top: var(--s-2);
  }
  .secondary-summary {
    margin-top: var(--s-4);
  }
  .secondary-help {
    margin: var(--s-3) 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    max-width: 72ch;
  }
  .bulk-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--s-3);
    flex-wrap: wrap;
    margin-block: var(--s-3);
  }
  .bulk-row .secondary-help {
    margin: 0;
    flex: 1 1 28rem;
  }
  .bulk-label {
    color: var(--text-muted);
    font-size: var(--fs-2);
  }
  .individual-source-list {
    margin-block-start: var(--s-3);
    border-top: 1px solid var(--border);
    padding-block-start: var(--s-3);
    display: grid;
    gap: var(--s-3);
  }
  .card-main {
    flex: 1;
    min-width: 0;
  }
  .source-card {
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
    padding: var(--s-4);
  }
  .source-card.selected {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--bg-raised));
  }
  .source-card.secondary {
    background: var(--surface-neutral);
  }
  .source-card.secondary.selected {
    border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-neutral));
  }
  .source-title-row {
    display: flex;
    gap: var(--s-3);
    align-items: center;
    flex-wrap: wrap;
  }
  .kind-label {
    color: var(--accent-2);
    font-size: var(--fs-0);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .kind-label.reference {
    color: var(--text-muted);
  }
  .source-path {
    font-size: var(--fs-1);
    color: var(--text-muted);
    line-height: var(--lh-body);
    max-width: 64ch;
  }
  .source-summary-copy {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-2);
    line-height: var(--lh-body);
    max-width: 72ch;
  }
  .source-check {
    display: inline-flex;
    align-items: start;
    padding-top: 2px;
  }
  .source-check input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
  }
  .card-actions-inline {
    display: flex;
    gap: var(--s-3);
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
  }
  .items {
    list-style: none;
    padding: 0;
    margin: var(--s-4) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-4);
  }
  .items li {
    padding: var(--s-3) var(--s-4);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised);
  }
  .items li.selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-raised-2));
  }
  .items.compact {
    margin-top: 0;
    gap: var(--s-2);
  }
  .items.compact li {
    padding: var(--s-2) var(--s-3);
  }
  .task-row {
    display: flex;
    gap: var(--s-2);
    align-items: flex-start;
    cursor: pointer;
  }
  .task-copy {
    flex: 1;
    min-width: 0;
  }
  .item-title {
    font-weight: 600;
    font-size: var(--fs-2);
    display: flex;
    align-items: center;
    gap: var(--s-2);
    flex-wrap: wrap;
  }
  .item-sub {
    margin-top: 6px;
    color: var(--text);
    font-size: var(--fs-1);
    line-height: var(--lh-body);
  }
  @media (max-width: 920px) {
    .source-summary li {
      grid-template-columns: 1fr;
    }
    .summary-side {
      align-items: flex-start;
      text-align: left;
      max-width: none;
    }
  }
</style>
