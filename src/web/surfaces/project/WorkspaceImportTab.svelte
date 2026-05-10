<script lang="ts">
  import Card from '../../lib/Card.svelte'
  import Stack from '../../lib/Stack.svelte'
  import Button from '../../lib/Button.svelte'
  import Chip from '../../lib/Chip.svelte'
  import Markdown from '../../lib/Markdown.svelte'
  import { project } from '../../lib/project.svelte.js'
  import { nav } from '../../lib/nav.svelte.js'
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

  type Step = 'found' | 'parts' | 'sources' | 'tasks' | 'confirm'

  let data = $state<DraftResponse | null>(null)
  let error = $state<string | null>(null)
  let busy = $state<null | 'approve' | 'dismiss' | 'rerun'>(null)
  let step = $state<Step>('found')
  let selectedAreaKeys = $state<string[]>([])
  let selectedSourceKeys = $state<string[]>([])
  let selectedTaskIds = $state<string[]>([])
  let currentAreaIndex = $state(0)
  let currentGroupIndex = $state(0)
  let currentTaskPage = $state(0)
  const TASKS_PER_PAGE = 10

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
      const r = await fetch('/api/project/workspace-import/draft')
      const j = (await r.json()) as DraftResponse
      if (j.error) {
        error = j.error
        return
      }
      data = j
      const defaultAreas = (j.detected?.review?.areaGroups ?? []).filter(
        area => area.taskCount > 0,
      )
      selectedAreaKeys = defaultAreas.map(area => area.key)
      const defaults = (j.detected?.review?.sourceGroups ?? []).filter(
        group => defaultAreas.some(area => area.key === group.areaKey) && group.taskCount > 0,
      )
      selectedSourceKeys = defaults.map(group => group.key)
      selectedTaskIds = (j.detected?.tasks ?? [])
        .filter(task => defaults.some(group => group.taskIds.includes(task.suggestedId)))
        .map(task => task.suggestedId)
      step = 'found'
      currentAreaIndex = 0
      currentGroupIndex = 0
      currentTaskPage = 0
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
  }

  $effect(() => {
    load()
  })

  const areaGroups = $derived(data?.detected?.review?.areaGroups ?? [])
  const groups = $derived(data?.detected?.review?.sourceGroups ?? [])
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

  function toggleArea(key: string) {
    const area = areaGroups.find(item => item.key === key)
    if (!area) return
    if (selectedAreaKeys.includes(key)) {
      selectedAreaKeys = selectedAreaKeys.filter(value => value !== key)
      selectedSourceKeys = selectedSourceKeys.filter(sourceKey => !area.sourceKeys.includes(sourceKey))
      const taskIdsToRemove = groups
        .filter(group => area.sourceKeys.includes(group.key))
        .flatMap(group => group.taskIds)
      selectedTaskIds = selectedTaskIds.filter(id => !taskIdsToRemove.includes(id))
      currentAreaIndex = 0
      return
    }
    selectedAreaKeys = [...selectedAreaKeys, key]
    const taskBearingSourceKeys = groups
      .filter(group => group.areaKey === key && group.taskCount > 0)
      .map(group => group.key)
    selectedSourceKeys = [...new Set([...selectedSourceKeys, ...taskBearingSourceKeys])]
    const taskIdsToAdd = groups
      .filter(group => group.areaKey === key && group.taskCount > 0)
      .flatMap(group => group.taskIds)
    selectedTaskIds = [...new Set([...selectedTaskIds, ...taskIdsToAdd])]
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

  function sourceTaskPage(group: SourceGroup): DetectedTask[] {
    const start = currentTaskPage * TASKS_PER_PAGE
    return tasksForGroup(group).slice(start, start + TASKS_PER_PAGE)
  }

  function sourceTaskPageCount(group: SourceGroup): number {
    return Math.max(1, Math.ceil(tasksForGroup(group).length / TASKS_PER_PAGE))
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
  }

  function openTaskReview() {
    step = 'tasks'
    currentGroupIndex = 0
    currentTaskPage = 0
  }

  async function approve() {
    busy = 'approve'
    try {
      const r = await fetch('/api/project/workspace-import/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
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
      toast.success(
        `Created ${j.tasksAdded ?? 0} tasks from ${selectedGroups.length} source${selectedGroups.length === 1 ? '' : 's'}.`,
      )
      await load()
      await project.refresh()
      setTimeout(() => nav('/work'), 900)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      busy = null
    }
  }

  async function dismiss() {
    busy = 'dismiss'
    try {
      const r = await fetch('/api/project/workspace-import/dismiss', { method: 'POST' })
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
      const r = await fetch('/api/project/workspace-import/rerun', { method: 'POST' })
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
      You are confirming what should become backlog tasks.
    </p>
  </header>

  {#if error}
    <Card tone="danger">
      <p class="muted">Couldn't load import findings: {error}</p>
      <Button variant="secondary" onclick={load}>Retry</Button>
    </Card>
  {:else if !data}
    <p class="muted">Loading import findings…</p>
  {:else if !data.detected}
    <Card>
      <p class="muted">Guildhall did not find any importable planning material yet.</p>
      <div class="row">
        <Button variant="secondary" onclick={rerun} disabled={busy !== null}>
          {busy === 'rerun' ? 'Re-reading…' : 'Re-read project notes'}
        </Button>
      </div>
    </Card>
  {:else}
    <div class="stepper" aria-label="Workspace import steps">
      <div class:active={step === 'found'}>1. Found</div>
      <div class:active={step === 'parts'}>2. Parts</div>
      <div class:active={step === 'sources'}>3. Sources</div>
      <div class:active={step === 'tasks'}>4. Tasks</div>
      <div class:active={step === 'confirm'}>5. Confirm</div>
    </div>

    {#if step === 'found'}
      <Card>
        <h3>Guildhall found planning notes in {areaGroups.length} part{areaGroups.length === 1 ? '' : 's'} of this project</h3>
        <p class="lede">
          Start broad. First confirm which parts of the project matter right now.
          Then Guildhall will walk you through the source notes and the possible tasks,
          one slice at a time.
        </p>
        <ul class="source-summary">
          {#each primaryAreas as area (area.key)}
            <li>
              <div class="summary-copy">
                <strong>{area.label}</strong>
                <span>{areaSummary(area)}</span>
              </div>
              <span>{sourcePreview(area)}</span>
            </li>
          {/each}
        </ul>
        {#if secondaryAreas.length > 0}
          <details class="secondary-summary">
            <summary>Show reference-only parts</summary>
            <ul class="source-summary nested">
              {#each secondaryAreas as area (area.key)}
                <li>
                  <div class="summary-copy">
                    <strong>{area.label}</strong>
                    <span>{areaSummary(area)}</span>
                  </div>
                  <span>{sourcePreview(area)}</span>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        <div class="actions">
          <Button variant="secondary" onclick={dismiss} disabled={busy !== null}>
            {busy === 'dismiss' ? 'Dismissing…' : 'Skip import for now'}
          </Button>
          <Button variant="primary" onclick={() => (step = 'parts')}>
            Review project parts
          </Button>
        </div>
      </Card>
    {/if}

    {#if step === 'parts'}
      <Card>
        <h3>Which parts of this project should Guildhall use right now?</h3>
        <p class="lede">
          This is just about scope. You can inspect the actual source docs and trim the task list in the next steps.
        </p>
        <Stack gap="3">
          {#each primaryAreas as area (area.key)}
            <div class="source-card">
              <div class="source-card-head">
                <div>
                  <div class="source-title-row">
                    <strong>{area.label}</strong>
                    <Chip label={area.taskCount > 0 ? 'tasks' : 'reference'} tone={area.taskCount > 0 ? 'success' : 'neutral'} />
                  </div>
                  <div class="muted">{areaSummary(area)}</div>
                  <div class="source-path">{sourcePreview(area)}</div>
                </div>
                <Button variant={selectedAreaKeys.includes(area.key) ? 'primary' : 'secondary'} onclick={() => toggleArea(area.key)}>
                  {selectedAreaKeys.includes(area.key) ? 'Included' : 'Include'}
                </Button>
              </div>
            </div>
          {/each}
        </Stack>
        {#if secondaryAreas.length > 0}
          <details class="secondary-summary">
            <summary>Optional reference-only parts</summary>
            <Stack gap="3">
              {#each secondaryAreas as area (area.key)}
                <div class="source-card secondary">
                  <div class="source-card-head">
                    <div>
                      <div class="source-title-row">
                        <strong>{area.label}</strong>
                        <Chip label="reference" tone="neutral" />
                      </div>
                      <div class="muted">{areaSummary(area)}</div>
                      <div class="source-path">{sourcePreview(area)}</div>
                    </div>
                    <Button variant={selectedAreaKeys.includes(area.key) ? 'primary' : 'secondary'} onclick={() => toggleArea(area.key)}>
                      {selectedAreaKeys.includes(area.key) ? 'Included' : 'Include'}
                    </Button>
                  </div>
                </div>
              {/each}
            </Stack>
          </details>
        {/if}
        <div class="actions">
          <Button variant="secondary" onclick={() => (step = 'found')}>Back</Button>
          <Button variant="primary" onclick={openSourceReview} disabled={selectedAreas.length === 0}>
            Review sources
          </Button>
        </div>
      </Card>
    {/if}

    {#if step === 'sources'}
      <Card>
        <h3>{currentArea ? `Review sources in ${currentArea.label}` : 'Review sources'}</h3>
        <p class="lede">
          Guildhall is only showing the notes that look useful for task creation in this part of the project.
          Include the sources you want to mine for tasks.
        </p>
        {#if currentArea}
          <Stack gap="3">
            {#each currentAreaPrimarySources as group (group.key)}
              <div class="source-card">
                <div class="source-card-head">
                  <div>
                    <div class="source-title-row">
                      <strong>{group.label}</strong>
                      <Chip label={group.kind} tone={group.kind === 'tasks' ? 'success' : group.kind === 'mixed' ? 'warn' : 'neutral'} />
                    </div>
                    <div class="muted">{sourceSummary(group)}</div>
                    {#if group.path}
                      <div class="source-path">{displayPath(group.path)}</div>
                    {/if}
                  </div>
                  <Button variant={selectedSourceKeys.includes(group.key) ? 'primary' : 'secondary'} onclick={() => toggleSource(group.key)}>
                    {selectedSourceKeys.includes(group.key) ? 'Included' : 'Include'}
                  </Button>
                </div>
              </div>
            {/each}
          </Stack>
          {#if currentAreaSecondarySources.length > 0}
            <details class="secondary-summary">
              <summary>Optional milestone and reference notes in {currentArea.label}</summary>
              <Stack gap="3">
                {#each currentAreaSecondarySources as group (group.key)}
                  <div class="source-card secondary">
                    <div class="source-card-head">
                      <div>
                        <div class="source-title-row">
                          <strong>{group.label}</strong>
                          <Chip label={group.kind} tone="neutral" />
                        </div>
                        <div class="muted">{sourceSummary(group)}</div>
                        {#if group.path}
                          <div class="source-path">{displayPath(group.path)}</div>
                        {/if}
                      </div>
                      <Button variant={selectedSourceKeys.includes(group.key) ? 'primary' : 'secondary'} onclick={() => toggleSource(group.key)}>
                        {selectedSourceKeys.includes(group.key) ? 'Included' : 'Include'}
                      </Button>
                    </div>
                  </div>
                {/each}
              </Stack>
            </details>
          {/if}
        {/if}
        <div class="actions">
          <Button variant="secondary" onclick={() => (step = 'parts')}>Back</Button>
          <Button
            variant="secondary"
            onclick={() => {
              currentAreaIndex = Math.max(0, currentAreaIndex - 1)
            }}
            disabled={currentAreaIndex === 0}
          >
            Previous part
          </Button>
          <Button
            variant="secondary"
            onclick={() => {
              currentAreaIndex = Math.min(selectedAreas.length - 1, currentAreaIndex + 1)
            }}
            disabled={currentAreaIndex >= selectedAreas.length - 1}
          >
            Next part
          </Button>
          <Button variant="primary" onclick={openTaskReview} disabled={selectedTaskGroups.length === 0}>
            Review possible tasks
          </Button>
        </div>
      </Card>
    {/if}

    {#if step === 'tasks'}
      <Stack gap="3">
        <Card>
          <h3>Review the possible tasks</h3>
          <p class="lede">
            Guildhall has already broken the work apart by source. You are trimming and confirming,
            not starting from scratch.
          </p>
        </Card>
        {#if currentGroup}
          <Card title={`${currentGroup.areaLabel} · ${currentGroup.label}`}>
            <div class="source-card-head">
              <div>
                <div class="muted">{sourceSummary(currentGroup)}</div>
                <div class="muted">Source {currentGroupIndex + 1} of {selectedTaskGroups.length}</div>
              </div>
              <div class="row">
                <Button variant="secondary" size="sm" onclick={() => clearTasksForGroup(currentGroup)}>Skip this source</Button>
                <Button variant="secondary" size="sm" onclick={() => selectAllTasksForGroup(currentGroup)}>Keep this source</Button>
              </div>
            </div>
            <ul class="items">
              {#each sourceTaskPage(currentGroup) as task (task.suggestedId)}
                <li class:selected={selectedTaskIds.includes(task.suggestedId)}>
                  <label class="task-row">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.suggestedId)}
                      onchange={() => toggleTask(task.suggestedId)}
                    />
                    <div class="task-copy">
                      <div class="item-title">
                        <Markdown source={displayText(task.title)} inline />
                        <Chip label={task.priority} tone={task.priority === 'high' || task.priority === 'critical' ? 'danger' : 'neutral'} />
                      </div>
                      {#if taskSupportingText(task)}
                        <div class="item-sub"><Markdown source={taskSupportingText(task)} inline /></div>
                      {/if}
                    </div>
                  </label>
                </li>
              {/each}
            </ul>
            {#if sourceTaskPageCount(currentGroup) > 1}
              <div class="task-footer">
                <div class="muted">Page {currentTaskPage + 1} of {sourceTaskPageCount(currentGroup)}</div>
                <div class="row">
                  <Button variant="secondary" size="sm" disabled={currentTaskPage === 0} onclick={() => (currentTaskPage -= 1)}>Previous page</Button>
                  <Button variant="secondary" size="sm" disabled={currentTaskPage >= sourceTaskPageCount(currentGroup) - 1} onclick={() => (currentTaskPage += 1)}>Next page</Button>
                </div>
              </div>
            {/if}
          </Card>
        {/if}
        <div class="actions">
          <Button variant="secondary" onclick={() => (step = 'sources')}>Back</Button>
          <Button
            variant="secondary"
            onclick={() => {
              if (!currentGroup) return
              currentGroupIndex = Math.max(0, currentGroupIndex - 1)
              currentTaskPage = 0
            }}
            disabled={currentGroupIndex === 0}
          >
            Previous source
          </Button>
          <Button
            variant="secondary"
            onclick={() => {
              currentGroupIndex = Math.min(selectedTaskGroups.length - 1, currentGroupIndex + 1)
              currentTaskPage = 0
            }}
            disabled={currentGroupIndex >= selectedTaskGroups.length - 1}
          >
            Next source
          </Button>
          <Button variant="primary" onclick={() => (step = 'confirm')} disabled={selectedTaskIds.length === 0}>
            Review final list
          </Button>
        </div>
      </Stack>
    {/if}

    {#if step === 'confirm'}
      <Card>
        <h3>Create {selectedTasks.length} draft task{selectedTasks.length === 1 ? '' : 's'}?</h3>
        <p class="lede">
          Guildhall will add these to the backlog as draft tasks. You can still rename, split,
          or shelve them afterward.
        </p>
        <ul class="confirm-list">
          {#each selectedAreas as area (area.key)}
            <li>
              <div class="summary-copy">
                <strong>{area.label}</strong>
                <span>{groups.filter(group => area.sourceKeys.includes(group.key) && selectedSourceKeys.includes(group.key)).length} source{groups.filter(group => area.sourceKeys.includes(group.key) && selectedSourceKeys.includes(group.key)).length === 1 ? '' : 's'}</span>
              </div>
              <span>{selectedTasks.filter(task => groups.some(group => group.areaKey === area.key && group.taskIds.includes(task.suggestedId))).length} task{selectedTasks.filter(task => groups.some(group => group.areaKey === area.key && group.taskIds.includes(task.suggestedId))).length === 1 ? '' : 's'}</span>
            </li>
          {/each}
        </ul>
        <div class="actions">
          <Button variant="secondary" onclick={() => (step = 'tasks')}>Back</Button>
          <Button variant="secondary" onclick={rerun} disabled={busy !== null}>
            {busy === 'rerun' ? 'Re-reading…' : 'Re-read project notes'}
          </Button>
          <Button variant="primary" onclick={approve} disabled={busy !== null || selectedTaskIds.length === 0}>
            {busy === 'approve' ? 'Creating tasks…' : 'Create tasks'}
          </Button>
        </div>
      </Card>
    {/if}
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: var(--s-3); }
  .head h2 { margin: 0; font-size: var(--fs-4); font-weight: 700; }
  .sub { margin: var(--s-1) 0 0; color: var(--text-muted); font-size: var(--fs-1); }
  .muted { color: var(--text-muted); font-size: var(--fs-1); }
  .lede { color: var(--text); font-size: var(--fs-2); }
  .stepper {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--s-2);
  }
  .stepper div {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    color: var(--text-muted);
    background: var(--bg-raised-1);
    text-align: center;
    font-size: var(--fs-1);
  }
  .stepper div.active {
    color: var(--text);
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-raised-1));
  }
  .source-summary, .confirm-list {
    list-style: none;
    padding: 0;
    margin: var(--s-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .source-summary li, .confirm-list li {
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .summary-copy {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .source-summary.nested {
    margin-top: var(--s-2);
  }
  .secondary-summary {
    margin-top: var(--s-3);
  }
  .source-card {
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
    padding: var(--s-3);
  }
  .source-card.secondary {
    background: var(--bg-raised-1);
  }
  .source-card-head {
    display: flex;
    justify-content: space-between;
    gap: var(--s-3);
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .source-title-row {
    display: flex;
    gap: var(--s-2);
    align-items: center;
    flex-wrap: wrap;
  }
  .source-path {
    margin-top: 4px;
    font-size: var(--fs-0);
    color: var(--text-muted);
  }
  .actions, .row {
    display: flex;
    gap: var(--s-2);
    justify-content: flex-end;
    flex-wrap: wrap;
    margin-top: var(--s-3);
  }
  .task-footer {
    margin-top: var(--s-3);
    display: flex;
    justify-content: space-between;
    gap: var(--s-2);
    flex-wrap: wrap;
    align-items: center;
  }
  .items {
    list-style: none;
    padding: 0;
    margin: var(--s-3) 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--s-2);
  }
  .items li {
    padding: var(--s-2);
    border: 1px solid var(--border);
    border-radius: var(--r-1);
    background: var(--bg-raised-2);
  }
  .items li.selected {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
    background: color-mix(in srgb, var(--accent) 8%, var(--bg-raised-2));
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
    margin-top: 2px;
    color: var(--text);
    font-size: var(--fs-1);
  }
</style>
