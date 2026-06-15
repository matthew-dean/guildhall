<script lang="ts">
  import { untrack } from 'svelte'
  import FrameCard from '../../../../../packages/ui/src/components/FrameCard.svelte'
  import NoticeBand from '../../../../../packages/ui/src/components/NoticeBand.svelte'
  import SectionHeader from '../../../../../packages/ui/src/components/SectionHeader.svelte'
  import StatusPill from '../../../../../packages/ui/src/components/StatusPill.svelte'
  import Byline from '../../../lib/Byline.svelte'
  import Button from '../../../lib/Button.svelte'
  import Card from '../../../lib/ui-compat/Card.svelte'
  import DefinitionList from '../../../lib/DefinitionList.svelte'
  import Icon from '../../../lib/Icon.svelte'
  import LogViewer from '../../../lib/LogViewer.svelte'
  import Row from '../../../lib/Row.svelte'
  import Stack from '../../../lib/Stack.svelte'
  import UtilityPanel from '../../../lib/UtilityPanel.svelte'
  import { nav } from '../../../lib/nav.svelte.js'
  import { project } from '../../../lib/project.svelte.js'
  import { projectActionHref } from '../../../lib/project-routes.js'
  import type { RuntimeSetupStatus } from './types.js'
  import type { SettingsStore } from './settings-store.svelte.js'

  interface Props {
    store: SettingsStore
    onMigrate?: () => void | Promise<void>
  }

  let { store, onMigrate }: Props = $props()

  $effect(() => {
    untrack(() => {
      void store.loadReadiness()
    })
  })

  const readiness = $derived(store.readiness)
  const bootstrapInfo = $derived(readiness.bootstrap)
  const coordinators = $derived(project.detail?.config?.coordinators ?? [])
  const workspaceChildProjects = $derived(bootstrapInfo?.workspaceProjects ?? [])
  const hasWorkspaceChildProjects = $derived(workspaceChildProjects.length > 0)
  const workspaceChildGateCount = $derived(
    workspaceChildProjects.reduce((count, child) => count + (child.bootstrap?.successGates?.length ?? 0), 0),
  )
  const bootstrapVerified = $derived(Boolean(
    bootstrapInfo?.configured && bootstrapInfo?.status?.success && !bootstrapInfo?.needed,
  ))
  const bootstrapReady = $derived(Boolean(
    bootstrapVerified ||
      (bootstrapInfo && !bootstrapInfo.configured && !bootstrapInfo.needed && !hasWorkspaceChildProjects),
  ))
  const bootstrapShellLabel = $derived(
    bootstrapInfo?.configured && bootstrapInfo?.status?.success && bootstrapInfo?.needed
      ? 're-run needed'
      : bootstrapInfo?.configured && bootstrapInfo?.status?.success
        ? 'passed'
        : bootstrapInfo?.configured
          ? 'failed'
          : hasWorkspaceChildProjects
            ? `${workspaceChildProjects.length} child project${workspaceChildProjects.length === 1 ? '' : 's'}`
            : bootstrapInfo && !bootstrapInfo.needed
              ? 'not required'
              : 'not set',
  )
  const bootstrapShellTone = $derived(
    bootstrapReady
      ? 'ok'
      : bootstrapInfo?.configured && bootstrapInfo?.status?.success && bootstrapInfo?.needed
        ? 'warn'
        : bootstrapInfo?.configured
          ? 'danger'
          : hasWorkspaceChildProjects
            ? 'info'
            : 'warn',
  )
  const providerReady = $derived(Boolean(readiness.providers?.configured))
  const coordinatorsReady = $derived(coordinators.length > 0)
  const readinessCount = $derived(
    (bootstrapReady ? 1 : 0) + (coordinatorsReady ? 1 : 0) + (providerReady ? 1 : 0),
  )
  const projectStartBlocker = $derived(
    project.detail?.startReadiness?.canStart === false &&
      project.detail.startReadiness.code !== 'all_terminal'
      ? project.detail.startReadiness
      : null,
  )
  const readinessPillLabel = $derived(projectStartBlocker ? 'Blocked' : `${readinessCount}/3 ready`)
  const readinessPillTone = $derived(projectStartBlocker ? 'warn' : readinessCount === 3 ? 'ok' : 'warn')
  const migrationCount = $derived((readiness.migrations?.blocked?.length ?? 0) + (readiness.migrations?.pending?.length ?? 0))
  const hasSecondaryMigrations = $derived(
    migrationCount > 0 && projectStartBlocker?.code !== 'required_migration_pending',
  )

  function runtimeStatusTone(status: RuntimeSetupStatus): 'ok' | 'warn' | 'neutral' {
    if (status === 'ready') return 'ok'
    if (status === 'unsupported-platform') return 'neutral'
    return 'warn'
  }

  function runtimeStatusLabel(status: RuntimeSetupStatus): string {
    switch (status) {
      case 'ready': return 'ready'
      case 'missing': return 'needs runtime'
      case 'machine-not-created': return 'setup needed'
      case 'machine-stopped': return 'stopped'
      case 'installed-unhealthy': return 'not running'
      case 'unsupported-platform': return 'compatibility mode'
      case 'unknown-error': return 'needs attention'
    }
  }

  function runtimeBackendLabel(backend: string | undefined): string {
    if (backend === 'docker') return 'Docker'
    if (backend === 'podman') return 'Podman'
    if (backend === 'none') return 'None'
    return 'Auto'
  }

  function runtimeInstallLabel(
    runtime: { status?: string; version?: string | null; path?: string | null; error?: string } | undefined,
  ): string {
    if (!runtime) return 'not checked'
    if (runtime.status === 'ready') return runtime.version ?? 'ready'
    if (runtime.status === 'installed-unhealthy') return runtime.error ? 'installed, not running' : 'installed'
    if (runtime.path) return 'installed'
    return 'not installed'
  }

  function runtimeServiceLabel(): string {
    const machine = readiness.runtime?.runtimes?.podman?.machine ?? readiness.runtime?.machine
    if (!machine) return 'not checked'
    return machine.exists ? `${machine.name ?? 'default'} ${machine.running ? 'running' : 'stopped'}` : 'not created'
  }

  function hostRunPolicyLabel(): string {
    const policy = readiness.runtime?.nonContainerExecution
    if (!policy?.allowed) return 'blocked by default'
    if (policy.source === 'project') return 'allowed by project config'
    if (policy.source === 'global') return 'allowed by global config'
    return 'allowed by config'
  }

  function showRuntimeCompatibilityNote(): boolean {
    return Boolean(readiness.runtime && readiness.runtime.status !== 'ready' && readiness.runtime.nonContainerExecution?.allowed)
  }
</script>

<Stack gap="4">
  {#if store.bootstrapToast}
    <NoticeBand
      tone={store.bootstrapToast.tone === 'ok' ? 'ok' : 'danger'}
      role={store.bootstrapToast.tone === 'ok' ? 'status' : 'alert'}
      label="Bootstrap"
      title={store.bootstrapToast.tone === 'ok' ? 'Bootstrap verified' : 'Bootstrap failed'}
      density="compact"
    >
      <p>{store.bootstrapToast.text}</p>
    </NoticeBand>
  {/if}

  <SectionHeader
    eyebrow="Settings"
    title="Ready to start?"
    description="Check the prerequisites Guildhall needs before unattended project runs."
    headingTag="h2"
    density="compact"
  >
    {#snippet meta()}
      <StatusPill label={readinessPillLabel} tone={readinessPillTone} emphasis="default" />
    {/snippet}
  </SectionHeader>

  {#if hasSecondaryMigrations}
    <NoticeBand tone="neutral" icon="refresh-cw" density="compact">
      <strong>
        {migrationCount} pending Guildhall migration{migrationCount === 1 ? '' : 's'} will need review after the current blocker.
      </strong>
      {#snippet actions()}
        <Button variant="secondary" size="sm" onclick={() => { void onMigrate?.() }}>Review migrations</Button>
      {/snippet}
    </NoticeBand>
  {/if}

  <Card className="readiness-card" frosted>
    <ul class="checklist">
      <li class="check-row">
        <div class="check-copy">
          <span class="check-label">Bootstrap</span>
          <span class="check-detail">Project bootstrap commands and success gates.</span>
        </div>
        <div class="check-actions">
          <StatusPill label={bootstrapShellLabel} tone={bootstrapShellTone} />
          {#if !bootstrapReady}
            <Button variant="agent" size="sm" onclick={store.runBootstrap} disabled={store.bootstrapRunning}>
              <Icon name="sparkles" size={14} />
              {store.bootstrapRunning ? 'Running...' : 'Run bootstrap'}
            </Button>
          {/if}
        </div>
        {#if store.bootstrapError}
          <div class="row-error">{store.bootstrapError}</div>
        {/if}
      </li>

      <li class="check-row">
        <div class="check-copy">
          <span class="check-label">Coordinators</span>
          <span class="check-detail">Routing roles that own planning and task execution.</span>
        </div>
        <div class="check-actions">
          <StatusPill label={coordinatorsReady ? `${coordinators.length} defined` : 'none'} tone={coordinatorsReady ? 'ok' : 'warn'} />
          {#if !coordinatorsReady}
            <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/settings/coordinators'))}>
              Open coordinators
            </Button>
          {/if}
        </div>
      </li>

      <li class="check-row">
        <div class="check-copy">
          <span class="check-label">LLM provider</span>
          <span class="check-detail">Active model host and runtime selection for this project.</span>
        </div>
        <div class="check-actions">
          <StatusPill label={providerReady ? (readiness.providers?.active ?? 'configured') : 'not configured'} tone={providerReady ? 'ok' : 'warn'} />
          {#if !providerReady}
            <Button variant="secondary" size="sm" onclick={() => nav(projectActionHref('/settings/providers'))}>
              Choose provider
            </Button>
          {/if}
        </div>
      </li>
    </ul>
  </Card>

  <Card className="runtime-setup-card" frosted>
    <div class="panel-head">
      <div>
        <h3>Local runtime</h3>
        <p>Guildhall runs project work in Docker or Podman. Host-run requires explicit config opt-in.</p>
      </div>
      {#if readiness.runtime}
        <StatusPill label={runtimeStatusLabel(readiness.runtime.status)} tone={runtimeStatusTone(readiness.runtime.status)} />
      {/if}
    </div>
    {#if readiness.runtime}
      <Stack gap="3">
        <p class="muted">{readiness.runtime.message}</p>
        <dl class="fact-grid" aria-label="Local runtime setup facts">
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Host</dt>
            <dd>{readiness.runtime.platform === 'darwin' ? 'macOS' : readiness.runtime.platform}</dd>
          </UtilityPanel>
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Selected</dt>
            <dd>{runtimeBackendLabel(readiness.runtime.backend)}</dd>
          </UtilityPanel>
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Docker</dt>
            <dd>{runtimeInstallLabel(readiness.runtime.runtimes?.docker ?? { status: readiness.runtime.dockerPath ? 'installed-unhealthy' : 'missing', version: readiness.runtime.dockerVersion, path: readiness.runtime.dockerPath })}</dd>
          </UtilityPanel>
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Podman</dt>
            <dd>{runtimeInstallLabel(readiness.runtime.runtimes?.podman ?? { status: readiness.runtime.podmanPath ? readiness.runtime.status : 'missing', version: readiness.runtime.podmanVersion, path: readiness.runtime.podmanPath })}</dd>
          </UtilityPanel>
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Service</dt>
            <dd>{runtimeServiceLabel()}</dd>
          </UtilityPanel>
          <UtilityPanel as="div" className="runtime-fact" tone="neutral">
            <dt>Host-run</dt>
            <dd>{hostRunPolicyLabel()}</dd>
          </UtilityPanel>
        </dl>
        {#if readiness.runtime.actions.length > 0}
          <div class="button-row">
            {#each readiness.runtime.actions as action (action.id)}
              <Button
                variant={action.id === 'use-host-run-compatibility' ? 'ghost' : action.mutatesHost ? 'agent' : 'secondary'}
                size="sm"
                disabled={store.runtimeSetupBusy !== null}
                onclick={() => store.runRuntimeSetupAction(action)}
              >
                {store.runtimeSetupBusy === action.id ? 'Working...' : action.label}
              </Button>
            {/each}
          </div>
        {/if}
        {#if showRuntimeCompatibilityNote()}
          <p class="muted">{readiness.runtime.compatibilityModeLabel} is available because config explicitly allows host execution.</p>
        {/if}
      </Stack>
    {:else}
      <p class="muted">Checking local runtime setup...</p>
    {/if}
    {#if store.runtimeSetupError}
      <p class="row-error">{store.runtimeSetupError}</p>
    {/if}
  </Card>

  <FrameCard class="capability-grants-card" density="compact">
    {#snippet header()}
      <SectionHeader
        title="Extra folder access"
        description="Approved mounts are narrow, visible, and revocable from the project."
        headingTag="h3"
        density="dense"
      >
        {#snippet meta()}
          <StatusPill
            label={readiness.activeCapabilityGrants.length === 1 ? '1 active grant' : `${readiness.activeCapabilityGrants.length} active grants`}
            tone={readiness.activeCapabilityGrants.length > 0 ? 'warn' : 'ok'}
          />
        {/snippet}
      </SectionHeader>
    {/snippet}

    {#if readiness.activeCapabilityGrants.length > 0}
      <Stack gap="3">
        {#each readiness.activeCapabilityGrants as grant (grant.id)}
          <UtilityPanel as="div" className="grant-row" tone="neutral">
            <div class="grant-copy">
              <Row gap="2" align="center" wrap>
                <strong>{grant.hostPath}</strong>
                <StatusPill label={grant.access} tone={grant.access === 'read-only' ? 'ok' : 'warn'} />
                <StatusPill label={grant.duration} tone="neutral" />
              </Row>
              <p>{grant.containerPath}</p>
              <p>{grant.evidence}</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={store.capabilityGrantBusyId === grant.id}
              onclick={() => store.revokeCapabilityGrant(grant)}
            >
              {store.capabilityGrantBusyId === grant.id ? 'Revoking...' : 'Revoke'}
            </Button>
          </UtilityPanel>
        {/each}
      </Stack>
    {:else}
      <p class="muted">No extra host folders are mounted for this project.</p>
    {/if}
    {#if store.capabilityGrantError}
      <p class="row-error">{store.capabilityGrantError}</p>
    {/if}
  </FrameCard>

  {#if hasWorkspaceChildProjects}
    <NoticeBand tone="info" role="note" label="Workspace" title="This workspace coordinates child projects" density="compact">
      <p>
        The root shell is the council layer. Task bootstrap and verification should come from the
        child project a task belongs to, so a missing root package file is not itself a project failure.
      </p>
      <ul class="workspace-project-list" aria-label="Child project bootstrap contracts">
        {#each workspaceChildProjects as child (child.id)}
          <li>
            <span class="workspace-project-name">{child.label}</span>
            <span class="workspace-project-path">{child.path}</span>
            {#if child.bootstrap?.commands?.length}
              <span>{child.bootstrap.commands.length} setup command{child.bootstrap.commands.length === 1 ? '' : 's'}</span>
            {/if}
            {#if child.bootstrap?.successGates?.length}
              <span>{child.bootstrap.successGates.length} gate{child.bootstrap.successGates.length === 1 ? '' : 's'}</span>
            {/if}
          </li>
        {/each}
      </ul>
      {#if workspaceChildGateCount === 0}
        <p class="workspace-project-note">No child gates are configured yet. Add gates to each child project before expecting fully unattended work.</p>
      {/if}
    </NoticeBand>
  {/if}

  {#if bootstrapInfo?.configured}
    <FrameCard tone={bootstrapInfo.status?.success ? 'info' : bootstrapInfo.status ? 'warn' : 'default'} class="bootstrap-card">
      {#snippet header()}
        <SectionHeader title="Bootstrap detail" description="The last verification pass and the commands behind it." headingTag="h3" density="dense">
          {#snippet meta()}
            <StatusPill label={bootstrapInfo.status?.success ? 'passed' : bootstrapInfo.status ? 'failed' : 'never run'} tone={bootstrapInfo.status?.success ? 'ok' : bootstrapInfo.status ? 'danger' : 'warn'} />
            {#if bootstrapInfo.needed}
              <StatusPill label="re-run needed" tone="warn" />
            {/if}
          {/snippet}
        </SectionHeader>
      {/snippet}

      <Stack gap="3">
        {#if bootstrapInfo.status}
          <Byline verb="Last run" at={bootstrapInfo.status.lastRunAt} />
        {/if}
        <DefinitionList
          size="sm"
          items={[
            ['Commands', bootstrapInfo.bootstrap?.commands.join(' · ') ?? '-'],
            ['Gates', bootstrapInfo.bootstrap?.successGates.join(' · ') ?? '-'],
            ['Established by', bootstrapInfo.bootstrap?.provenance ? `${bootstrapInfo.bootstrap.provenance.establishedBy} (${bootstrapInfo.bootstrap.provenance.establishedAt})` : null],
          ]}
        />
        {#if bootstrapInfo.status && bootstrapInfo.status.steps.length > 0}
          <LogViewer
            lines={bootstrapInfo.status.steps.map(step => `[${step.result === 'pass' ? 'pass' : 'fail'}] ${step.kind}: ${step.command} (${step.durationMs}ms)`)}
            maxHeight="200px"
          />
        {/if}
        <Row justify="end">
          <Button variant="agent" onclick={store.runBootstrap} disabled={store.bootstrapRunning}>
            <Icon name="sparkles" size={14} />
            {store.bootstrapRunning ? 'Running...' : 'Re-run bootstrap'}
          </Button>
        </Row>
      </Stack>
    </FrameCard>
  {/if}
</Stack>

<style>
  .checklist,
  .workspace-project-list {
    list-style: none;
    display: grid;
    gap: 0;
    padding: 0;
    margin: 0;
  }
  .check-row {
    display: grid;
    gap: var(--gh-space-3);
    align-items: start;
    padding: var(--gh-space-4) 0;
    border-top: 1px solid var(--border);
  }
  .check-row:first-child {
    border-top: none;
  }
  .check-copy {
    display: grid;
    gap: var(--gh-space-1);
  }
  .check-label {
    font-size: var(--gh-type-size-panel-title);
    font-weight: var(--gh-type-weight-strong);
    line-height: var(--gh-type-line-height-tight);
  }
  .check-detail,
  .muted {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .check-actions,
  .button-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
  }
  .row-error {
    color: var(--danger);
    font-size: var(--gh-type-size-meta);
  }
  .panel-head {
    display: flex;
    flex-wrap: wrap;
    align-items: start;
    justify-content: space-between;
    gap: var(--gh-space-3);
    margin-bottom: var(--gh-space-3);
  }
  .panel-head h3,
  .panel-head p,
  .grant-copy p {
    margin: 0;
  }
  .panel-head p,
  .grant-copy p {
    color: var(--text-muted);
    font-size: var(--gh-type-size-body);
    line-height: var(--gh-type-line-height-body);
  }
  .fact-grid {
    display: grid;
    gap: var(--gh-space-2);
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    margin: 0;
  }
  :global(.runtime-fact) {
    display: grid;
    gap: var(--gh-space-1);
  }
  .fact-grid dt {
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
    font-weight: var(--gh-type-weight-medium);
    text-transform: uppercase;
  }
  .fact-grid dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  :global(.grant-row) {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--gh-space-3);
    align-items: start;
  }
  .grant-copy {
    display: grid;
    gap: var(--gh-space-1);
  }
  .workspace-project-list {
    gap: var(--gh-space-2);
    margin-block-start: var(--gh-space-3);
  }
  .workspace-project-list li {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gh-space-2);
    align-items: center;
    color: var(--text-muted);
    font-size: var(--gh-type-size-meta);
  }
  .workspace-project-name {
    color: var(--text);
    font-weight: var(--gh-type-weight-strong);
  }
  .workspace-project-path {
    font-family: var(--font-mono);
  }
  @container (min-width: 42rem) {
    .check-row {
      grid-template-columns: minmax(0, 1fr) minmax(16rem, auto);
      align-items: center;
    }
    .check-actions {
      justify-content: flex-end;
    }
    .row-error {
      grid-column: 1 / -1;
    }
  }
  @container (max-width: 42rem) {
    :global(.grant-row) {
      grid-template-columns: 1fr;
    }
  }
</style>
