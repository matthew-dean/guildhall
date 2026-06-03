import { project } from '../../../lib/project.svelte.js'
import type { projectFetch as projectFetchImpl } from '../../../lib/project-routes.js'
import type {
  BootstrapInfo,
  CapabilityGrant,
  CapabilityRequest,
  CodebaseMapStatus,
  DesignFeedbackReadout,
  DesignSystemReadout,
  DeveloperToolsReadout,
  Lever,
  OperatingProfileReadout,
  ProjectIdentity,
  RuntimeSetupAction,
  RuntimeSetupActionId,
  RuntimeSetupReadout,
  SettingsReadiness,
  WorktreeIncludeCandidate,
  WorktreeIncludeScope,
} from './types.js'
import type { ProjectMigrationStatus } from '../../../lib/types.js'

type ProjectFetch = typeof projectFetchImpl

export function createSettingsStore(projectFetch: ProjectFetch) {
  let readiness = $state<SettingsReadiness>({
    bootstrap: null,
    providers: null,
    runtime: null,
    capabilityRequests: [],
    activeCapabilityGrants: [],
    migrations: null,
  })
  let identity = $state<ProjectIdentity>({
    initialized: null,
    name: '',
    id: '',
    worktreeIncludeText: '',
    worktreeIncludeCandidates: [],
    worktreeIncludeScopes: [],
    selectedWorktreeProjectId: null,
  })
  let profile = $state<OperatingProfileReadout>({ levers: null, error: null })
  let developer = $state<DeveloperToolsReadout>({
    levers: null,
    leversError: null,
    codebaseMap: null,
    codebaseMapError: null,
    designSystem: undefined,
    designFeedback: null,
    reintakeStatus: null,
  })

  let bootstrapRunning = $state(false)
  let bootstrapError = $state<string | null>(null)
  let bootstrapToast = $state<{ text: string; tone: 'ok' | 'danger' } | null>(null)
  let runtimeSetupBusy = $state<RuntimeSetupActionId | null>(null)
  let runtimeSetupError = $state<string | null>(null)
  let capabilityGrantBusyId = $state<string | null>(null)
  let capabilityGrantError = $state<string | null>(null)
  let savingIdentity = $state(false)
  let identityStatus = $state<{ text: string; error: boolean } | null>(null)
  let worktreeIncludeBusy = $state(false)
  let worktreeIncludeStatus = $state<{ text: string; error: boolean } | null>(null)
  let savingLever = $state<string | null>(null)
  let codebaseMapBusy = $state(false)

  function patchReadiness(patch: Partial<SettingsReadiness>): void {
    readiness = { ...readiness, ...patch }
  }

  function patchIdentity(patch: Partial<ProjectIdentity>): void {
    identity = { ...identity, ...patch }
  }

  function patchDeveloper(patch: Partial<DeveloperToolsReadout>): void {
    developer = { ...developer, ...patch }
  }

  async function loadSetupStatus(): Promise<void> {
    try {
      const setup = await projectFetch('/api/setup/status').then(r => r.json())
      patchIdentity({
        initialized: Boolean(setup.initialized),
        name: setup.name ?? '',
        id: setup.id ?? '',
      })
    } catch {
      patchIdentity({ initialized: false })
    }
  }

  async function loadLevers(): Promise<void> {
    try {
      const j = await projectFetch('/api/config/levers').then(r => r.json())
      if (j.error) {
        profile = { levers: null, error: String(j.error) }
        patchDeveloper({ levers: null, leversError: String(j.error) })
        return
      }
      const levers = j.levers ?? []
      profile = { levers, error: null }
      patchDeveloper({ levers, leversError: null })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      profile = { levers: null, error }
      patchDeveloper({ levers: null, leversError: error })
    }
  }

  async function loadProviderStatus(): Promise<void> {
    try {
      const j = await projectFetch('/api/setup/providers').then(r => r.ok ? r.json() : null)
      if (!j) return
      const preferred = j?.preferredProvider
      const preferredMeta = typeof preferred === 'string' ? j?.providers?.[preferred] : null
      patchReadiness({
        providers: {
          configured: Boolean(preferred && preferredMeta?.detected),
          active: preferredMeta?.label ?? preferred ?? undefined,
        },
      })
    } catch {
      patchReadiness({ providers: { configured: false } })
    }
  }

  async function loadBootstrap(): Promise<void> {
    try {
      const bootstrap = await projectFetch('/api/project/bootstrap/status').then(r => r.json()) as BootstrapInfo
      patchReadiness({ bootstrap })
    } catch {
      patchReadiness({ bootstrap: null })
    }
  }

  async function loadRuntimeSetup(): Promise<void> {
    try {
      const j = await projectFetch('/api/project/runtime/setup', { cache: 'no-store' }).then(r => r.json()) as RuntimeSetupReadout & { error?: string }
      if (j.error) {
        runtimeSetupError = j.error
        return
      }
      patchReadiness({
        runtime: {
          ...j,
          machine: j.machine ?? { exists: false, name: null, running: false },
          actions: j.actions ?? [],
        },
      })
      runtimeSetupError = null
    } catch (err) {
      runtimeSetupError = err instanceof Error ? err.message : String(err)
    }
  }

  async function loadCapabilityGrants(): Promise<void> {
    try {
      const r = await projectFetch('/api/project/capability-requests', { cache: 'no-store' })
      const j = await r.json() as {
        requests?: CapabilityRequest[]
        activeGrants?: CapabilityGrant[]
        error?: string
      }
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
      patchReadiness({
        capabilityRequests: j.requests ?? [],
        activeCapabilityGrants: j.activeGrants ?? [],
      })
      capabilityGrantError = null
    } catch (err) {
      capabilityGrantError = err instanceof Error ? err.message : String(err)
      patchReadiness({ capabilityRequests: [], activeCapabilityGrants: [] })
    }
  }

  async function loadMigrationStatus(): Promise<void> {
    try {
      const r = await projectFetch('/api/project/migrations', { cache: 'no-store' })
      const j = await r.json().catch(() => null) as ProjectMigrationStatus & { error?: string } | null
      if (!r.ok || j?.error) throw new Error(j?.error ?? `HTTP ${r.status}`)
      patchReadiness({ migrations: j })
    } catch {
      patchReadiness({ migrations: null })
    }
  }

  async function loadWorktreeIncludes(): Promise<void> {
    try {
      const suffix = identity.selectedWorktreeProjectId
        ? `?workspaceProjectId=${encodeURIComponent(identity.selectedWorktreeProjectId)}`
        : ''
      const r = await projectFetch(`/api/project/worktree-includes${suffix}`, { cache: 'no-store' })
      const j = await r.json() as {
        include?: string[]
        candidates?: WorktreeIncludeCandidate[]
        scopes?: WorktreeIncludeScope[]
        error?: string
      }
      if (j.error) {
        worktreeIncludeStatus = { text: j.error, error: true }
        return
      }
      const scopes = j.scopes ?? []
      const selected = identity.selectedWorktreeProjectId ?? scopes.find(scope => scope.projectId)?.projectId ?? null
      const activeScope = selected ? scopes.find(scope => scope.projectId === selected) : null
      patchIdentity({
        worktreeIncludeScopes: scopes,
        selectedWorktreeProjectId: selected,
        worktreeIncludeText: activeScope ? activeScope.include.join('\n') : (j.include ?? []).join('\n'),
        worktreeIncludeCandidates: activeScope ? activeScope.candidates : j.candidates ?? [],
      })
    } catch (err) {
      worktreeIncludeStatus = { text: err instanceof Error ? err.message : String(err), error: true }
    }
  }

  async function loadCodebaseMapStatus(): Promise<void> {
    try {
      patchDeveloper({ codebaseMapError: null })
      const r = await projectFetch('/api/project/codebase-map/status')
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || typeof j !== 'object') {
        patchDeveloper({ codebaseMapError: j && typeof j === 'object' && 'error' in j ? String(j.error) : `HTTP ${r.status}` })
        return
      }
      if ('error' in j && j.error) {
        patchDeveloper({ codebaseMapError: String(j.error) })
        return
      }
      patchDeveloper({ codebaseMap: j as CodebaseMapStatus })
    } catch (err) {
      patchDeveloper({ codebaseMapError: err instanceof Error ? err.message : String(err) })
    }
  }

  async function loadDesignDiagnostics(): Promise<void> {
    const [designSystem, designFeedback, reintakeStatus] = await Promise.all([
      projectFetch('/api/project/design-system').then(r => r.json()).then(j => j?.designSystem ?? null).catch(() => null),
      projectFetch('/api/project/design-feedback').then(r => r.json()).then(j => j?.feedback ?? null).catch(() => null),
      projectFetch('/api/project/reintake/status', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
    ])
    patchDeveloper({
      designSystem: designSystem as DesignSystemReadout | null,
      designFeedback: designFeedback as DesignFeedbackReadout | null,
      reintakeStatus,
    })
  }

  async function loadReadiness(): Promise<void> {
    await Promise.all([
      loadSetupStatus(),
      loadBootstrap(),
      loadProviderStatus(),
      loadRuntimeSetup(),
      loadCapabilityGrants(),
      loadMigrationStatus(),
    ])
  }

  async function loadIdentity(): Promise<void> {
    await Promise.all([loadSetupStatus(), loadWorktreeIncludes()])
  }

  async function loadProfile(): Promise<void> {
    await loadLevers()
  }

  async function loadDeveloper(): Promise<void> {
    await Promise.all([loadLevers(), loadCodebaseMapStatus(), loadDesignDiagnostics()])
  }

  function flashBootstrap(text: string, tone: 'ok' | 'danger'): void {
    bootstrapToast = { text, tone }
    setTimeout(() => {
      if (bootstrapToast?.text === text) bootstrapToast = null
    }, 4500)
  }

  function summarizeBootstrapResult(j: unknown): string {
    const detected = (j as {
      detected?: { packageManager?: string; gates?: Record<string, { available?: boolean }> }
    })?.detected
    if (!detected) return 'Bootstrap verified.'
    const pm = detected.packageManager ?? 'none'
    const gates = detected.gates
      ? Object.entries(detected.gates).filter(([, value]) => value?.available).map(([key]) => key)
      : []
    return `Bootstrap verified (${pm}): ${gates.length > 0 ? gates.join(', ') : 'no gates'}`
  }

  async function runBootstrap(): Promise<void> {
    if (bootstrapRunning) return
    bootstrapRunning = true
    bootstrapError = null
    try {
      const r = await projectFetch('/api/project/bootstrap/run', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        bootstrapError = j?.error ?? `HTTP ${r.status}`
        flashBootstrap(`Bootstrap failed: ${bootstrapError}`, 'danger')
      } else {
        flashBootstrap(summarizeBootstrapResult(j), 'ok')
      }
      await loadBootstrap()
    } catch (err) {
      bootstrapError = err instanceof Error ? err.message : String(err)
      flashBootstrap(`Bootstrap failed: ${bootstrapError}`, 'danger')
    } finally {
      bootstrapRunning = false
    }
  }

  async function runRuntimeSetupAction(action: RuntimeSetupAction): Promise<void> {
    if (action.id === 'install-instructions') {
      const url = action.officialInstallerUrl ?? readiness.runtime?.installGuidance?.officialInstallerUrl
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      return
    }

    runtimeSetupBusy = action.id
    runtimeSetupError = null
    try {
      const r = await projectFetch('/api/project/runtime/setup/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action.id, approved: action.mutatesHost }),
      })
      const j = await r.json() as { error?: string; status?: RuntimeSetupReadout }
      if (!r.ok || j.error) runtimeSetupError = j.error ?? `Runtime setup action failed with ${r.status}.`
      if (j.status) patchReadiness({ runtime: j.status })
    } catch (err) {
      runtimeSetupError = err instanceof Error ? err.message : String(err)
    } finally {
      runtimeSetupBusy = null
    }
  }

  async function revokeCapabilityGrant(grant: CapabilityGrant): Promise<void> {
    const request = readiness.capabilityRequests.find(candidate => candidate.grant?.id === grant.id)
    if (!request) return
    capabilityGrantBusyId = grant.id
    capabilityGrantError = null
    try {
      const r = await projectFetch(`/api/project/capability-requests/${encodeURIComponent(request.id)}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Revoked from project settings.' }),
      })
      const j = await r.json().catch(() => ({})) as { error?: string }
      if (!r.ok || j.error) throw new Error(j.error ?? `HTTP ${r.status}`)
      await loadCapabilityGrants()
    } catch (err) {
      capabilityGrantError = err instanceof Error ? err.message : String(err)
    } finally {
      capabilityGrantBusyId = null
    }
  }

  function setIdentityName(value: string): void {
    patchIdentity({ name: value })
  }

  function setIdentityId(value: string): void {
    patchIdentity({ id: value })
  }

  function setWorktreeIncludeText(value: string): void {
    patchIdentity({ worktreeIncludeText: value })
  }

  function selectWorktreeIncludeScope(scope: WorktreeIncludeScope): void {
    patchIdentity({
      selectedWorktreeProjectId: scope.projectId ?? null,
      worktreeIncludeText: scope.include.join('\n'),
      worktreeIncludeCandidates: scope.candidates,
    })
    worktreeIncludeStatus = null
  }

  function addWorktreeIncludeCandidate(candidate: string): void {
    const lines = identity.worktreeIncludeText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!lines.includes(candidate)) lines.push(candidate)
    patchIdentity({ worktreeIncludeText: lines.join('\n') })
  }

  async function saveIdentity(): Promise<void> {
    const name = identity.name.trim()
    const id = identity.id.trim()
    if (!name) {
      identityStatus = { text: 'Name is required', error: true }
      return
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      identityStatus = { text: 'Invalid ID', error: true }
      return
    }
    savingIdentity = true
    try {
      const r = await projectFetch('/api/setup/identity', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, id }),
      })
      const j = await r.json()
      identityStatus = j.error ? { text: j.error, error: true } : { text: 'Saved', error: false }
      if (!j.error) void project.refresh()
    } finally {
      savingIdentity = false
    }
  }

  async function saveWorktreeIncludes(): Promise<void> {
    worktreeIncludeBusy = true
    worktreeIncludeStatus = null
    try {
      const r = await projectFetch('/api/project/worktree-includes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          includeText: identity.worktreeIncludeText,
          ...(identity.selectedWorktreeProjectId ? { workspaceProjectId: identity.selectedWorktreeProjectId } : {}),
        }),
      })
      const j = await r.json() as { include?: string[]; error?: string }
      if (j.error) {
        worktreeIncludeStatus = { text: j.error, error: true }
        return
      }
      patchIdentity({ worktreeIncludeText: (j.include ?? []).join('\n') })
      worktreeIncludeStatus = { text: 'Saved', error: false }
      await loadWorktreeIncludes()
    } finally {
      worktreeIncludeBusy = false
    }
  }

  async function resetLevers(): Promise<void> {
    patchDeveloper({ leversError: null })
    profile = { ...profile, error: null }
    const r = await projectFetch('/api/config/levers/reset', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    if (j?.error) {
      const error = String(j.error)
      profile = { ...profile, error }
      patchDeveloper({ leversError: error })
      return
    }
    await loadLevers()
  }

  async function saveLever(lever: Lever, nextValue: string): Promise<void> {
    const key = `${lever.scope}:${lever.name}`
    savingLever = key
    patchDeveloper({ leversError: null })
    try {
      const r = await projectFetch('/api/config/levers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: lever.scope,
          name: lever.name,
          position: nextValue === 'same_as_global' ? null : nextValue,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j?.error) {
        const error = j?.error ?? `HTTP ${r.status}`
        profile = { ...profile, error }
        patchDeveloper({ leversError: error })
        return
      }
      const levers = j.levers ?? []
      profile = { levers, error: null }
      patchDeveloper({ levers, leversError: null })
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      profile = { ...profile, error }
      patchDeveloper({ leversError: error })
    } finally {
      savingLever = null
    }
  }

  async function refreshCodebaseMap(): Promise<void> {
    if (codebaseMapBusy) return
    codebaseMapBusy = true
    patchDeveloper({ codebaseMapError: null })
    try {
      const r = await projectFetch('/api/project/codebase-map/refresh', { method: 'POST' })
      const j = await r.json().catch(() => null)
      if (!r.ok || !j || typeof j !== 'object' || ('error' in j && j.error)) {
        patchDeveloper({ codebaseMapError: j && typeof j === 'object' && 'error' in j ? String(j.error) : `HTTP ${r.status}` })
        return
      }
      patchDeveloper({ codebaseMap: (j as { status?: CodebaseMapStatus }).status ?? null })
    } catch (err) {
      patchDeveloper({ codebaseMapError: err instanceof Error ? err.message : String(err) })
    } finally {
      codebaseMapBusy = false
    }
  }

  async function approveDesignSystem(): Promise<void> {
    const r = await projectFetch('/api/project/design-system/approve', { method: 'POST' })
    const j = await r.json()
    if (j.error) return alert(`Approve failed: ${j.error}`)
    const reload = await projectFetch('/api/project/design-system').then(r => r.json())
    patchDeveloper({ designSystem: reload?.designSystem ?? null })
  }

  return {
    get readiness() { return readiness },
    get identity() { return identity },
    get profile() { return profile },
    get developer() { return developer },
    get bootstrapRunning() { return bootstrapRunning },
    get bootstrapError() { return bootstrapError },
    get bootstrapToast() { return bootstrapToast },
    get runtimeSetupBusy() { return runtimeSetupBusy },
    get runtimeSetupError() { return runtimeSetupError },
    get capabilityGrantBusyId() { return capabilityGrantBusyId },
    get capabilityGrantError() { return capabilityGrantError },
    get savingIdentity() { return savingIdentity },
    get identityStatus() { return identityStatus },
    get worktreeIncludeBusy() { return worktreeIncludeBusy },
    get worktreeIncludeStatus() { return worktreeIncludeStatus },
    get savingLever() { return savingLever },
    get codebaseMapBusy() { return codebaseMapBusy },
    loadReadiness,
    loadIdentity,
    loadProfile,
    loadDeveloper,
    runBootstrap,
    runRuntimeSetupAction,
    revokeCapabilityGrant,
    setIdentityName,
    setIdentityId,
    setWorktreeIncludeText,
    selectWorktreeIncludeScope,
    addWorktreeIncludeCandidate,
    saveIdentity,
    saveWorktreeIncludes,
    resetLevers,
    saveLever,
    refreshCodebaseMap,
    approveDesignSystem,
  }
}

export type SettingsStore = ReturnType<typeof createSettingsStore>
