import { resolve, join, basename } from 'node:path'
import { existsSync } from 'node:fs'
import { input, select, confirm } from '@inquirer/prompts'
import {
  bootstrapWorkspace,
  slugify,
  readWorkspaceConfig,
  writeWorkspaceConfig,
  readGlobalConfig,
  resolveModelsForProvider,
  updateGlobalConfig,
  writeModelsForProvider,
  FORGE_YAML_FILENAME,
} from '@guildhall/config'
import { MODEL_CATALOG, DEFAULT_LOCAL_MODEL_ASSIGNMENT, type ModelAssignmentConfig } from '@guildhall/core'

// ---------------------------------------------------------------------------
// guildhall init / guildhall config — interactive setup wizard
//
// Creates or updates a guildhall.yaml and registers the workspace in ~/.guildhall/.
// ---------------------------------------------------------------------------

export interface InitOptions {
  targetDir: string
  /** If true, reconfigure an existing workspace rather than creating a new one */
  reconfigure?: boolean
}

export async function runInit(opts: InitOptions): Promise<void> {
  const { targetDir, reconfigure = false } = opts
  const absPath = resolve(targetDir)
  const hasExisting = existsSync(join(absPath, FORGE_YAML_FILENAME))

  console.log()
  if (reconfigure && hasExisting) {
    console.log(`Reconfiguring workspace at: ${absPath}`)
  } else {
    console.log(`Initializing new GuildHall workspace at: ${absPath}`)
  }
  console.log()

  // Load existing config if present
  const existing = hasExisting ? readWorkspaceConfig(absPath) : null

  // -------------------------------------------------------------------------
  // Step 1: Identity
  // -------------------------------------------------------------------------
  const name = await input({
    message: 'Workspace name:',
    default: existing?.name ?? basename(absPath),
    validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
  })

  const id = await input({
    message: 'Workspace ID (slug, used in CLI + registry):',
    default: existing?.id ?? slugify(name),
    validate: (v: string) => /^[a-z0-9-]+$/.test(v) || 'ID must be lowercase letters, numbers, and dashes only',
  })

  // -------------------------------------------------------------------------
  // Step 2: Project path
  // -------------------------------------------------------------------------
  const projectPathInput = await input({
    message: 'Project path (blank = use workspace directory):',
    default: existing?.projectPath ?? '',
    validate: (v: string) => {
      if (!v.trim()) return true
      if (!existsSync(resolve(v))) return `Path does not exist: ${v}`
      return true
    },
  })
  const projectPath = projectPathInput.trim() || undefined

  // -------------------------------------------------------------------------
  // Step 3: Model configuration
  // -------------------------------------------------------------------------
  console.log()
  console.log('━━━ Model Configuration ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log()

  const modelScope = await select({
    message: 'Model assignments:',
    choices: [
      { name: 'Use global defaults from ~/.guildhall/config.yaml', value: 'global-default' },
      { name: 'Set global defaults for this machine', value: 'global' },
      { name: 'Override only this workspace', value: 'workspace' },
    ],
    default: 'global-default',
  })

  let models: Partial<ModelAssignmentConfig> | undefined

  const modelStrategy = modelScope === 'global-default' ? 'skip' : await select({
    message: 'How are you running your LLMs?',
    choices: [
      { name: 'Local OpenAI-compatible server (for example LM Studio)', value: 'local' },
      { name: 'Mix: local workers, cloud reasoning (spec/coordinator)', value: 'mixed' },
      { name: 'Cloud only (Anthropic or OpenAI)', value: 'cloud' },
    ],
    default: 'local',
  })

  const selectedModels: ModelAssignmentConfig = { ...DEFAULT_LOCAL_MODEL_ASSIGNMENT }

  if (modelStrategy !== 'skip') {
    const localChoices = MODEL_CATALOG
      .filter(m => m.provider === 'lm-studio')
      .map(m => ({ name: `${m.id}${m.notes ? ` — ${m.notes}` : ''}`, value: m.id }))

    const cloudChoices = MODEL_CATALOG
      .filter(m => m.provider !== 'lm-studio')
      .map(m => ({ name: `${m.id} (${m.provider})`, value: m.id }))

    if (modelStrategy === 'local' || modelStrategy === 'mixed') {
      const workerModel = await select({
        message: 'Worker model (code writing):',
        choices: localChoices,
        default: DEFAULT_LOCAL_MODEL_ASSIGNMENT.worker,
      })
      selectedModels.worker = workerModel

      const reviewerModel = await select({
        message: 'Reviewer / gate-checker model (fast evaluation):',
        choices: localChoices,
        default: DEFAULT_LOCAL_MODEL_ASSIGNMENT.reviewer,
      })
      selectedModels.reviewer = reviewerModel
      selectedModels.gateChecker = reviewerModel
    }

    if (modelStrategy === 'mixed') {
      const reasoningModel = await select({
        message: 'Spec + coordinator model (reasoning — cloud recommended):',
        choices: [...cloudChoices, ...localChoices],
        default: 'claude-sonnet-4-6',
      })
      selectedModels.spec = reasoningModel
      selectedModels.coordinator = reasoningModel
    }

    if (modelStrategy === 'cloud') {
      const primaryModel = await select({
        message: 'Primary cloud model:',
        choices: cloudChoices,
        default: 'claude-sonnet-4-6',
      })
      selectedModels.spec = primaryModel
      selectedModels.coordinator = primaryModel
      selectedModels.worker = primaryModel

      const fastModel = await select({
        message: 'Fast model for reviewer + gate-checker:',
        choices: cloudChoices,
        default: 'claude-haiku-4-5',
      })
      selectedModels.reviewer = fastModel
      selectedModels.gateChecker = fastModel
    }
    models = selectedModels
  }

  // -------------------------------------------------------------------------
  // Step 4: Coordinators
  // -------------------------------------------------------------------------
  console.log()
  console.log('━━━ Coordinator Domains ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Coordinators route tasks and enforce domain-specific quality gates.')
  console.log()

  type CoordEntry = {
    id: string
    name: string
    domain: string
    path?: string | undefined
    mandate: string
    concerns: Array<{ id: string; description: string; reviewQuestions: string[] }>
    autonomousDecisions: string[]
    escalationTriggers: string[]
  }

  const coordinators: CoordEntry[] = existing?.coordinators?.map(c => ({ ...c })) ?? []

  const addMore = await confirm({
    message: coordinators.length > 0
      ? `${coordinators.length} coordinator(s) defined. Add more?`
      : 'Add a coordinator domain now? (You can edit guildhall.yaml later to add more)',
    default: coordinators.length === 0,
  })

  if (addMore) {
    let addAnother = true
    while (addAnother) {
      console.log()
      const coordName = await input({
        message: 'Coordinator display name (e.g. "Looma Coordinator"):',
        validate: (v: string) => v.trim().length > 0 || 'Name is required',
      })

      const coordDomain = await input({
        message: 'Domain ID for task routing (e.g. "looma"):',
        default: slugify(coordName),
        validate: (v: string) => /^[a-z0-9-]+$/.test(v) || 'Use lowercase letters, numbers, dashes',
      })

      const coordPath = await input({
        message: 'Project sub-path for this domain (blank = workspace root):',
        default: '',
      })

      const mandate = await input({
        message: 'One-line mandate (what does this coordinator oversee?):',
        default: `Coordinate work for the ${coordName} domain.`,
      })

      coordinators.push({
        id: coordDomain,
        name: coordName,
        domain: coordDomain,
        ...(coordPath.trim() ? { path: coordPath.trim() } : {}),
        mandate,
        concerns: [],
        autonomousDecisions: ['Approve minor spec revisions that do not change scope', 'Assign tasks to worker agents'],
        escalationTriggers: ['Any change to a public API surface', 'Unresolvable disagreement between agents'],
      })

      console.log(`  ✓ Added: ${coordName}`)

      addAnother = await confirm({ message: 'Add another coordinator?', default: false })
    }
  }

  // -------------------------------------------------------------------------
  // Step 5: Advanced (optional)
  // -------------------------------------------------------------------------
  const advanced = await confirm({
    message: 'Configure advanced orchestrator options?',
    default: false,
  })

  let maxRevisions = existing?.maxRevisions ?? 3
  let heartbeatInterval = existing?.heartbeatInterval ?? 5

  if (advanced) {
    const maxStr = await input({
      message: 'Max revision cycles before a task is marked blocked:',
      default: String(maxRevisions),
      validate: (v: string) => (Number.isInteger(Number(v)) && Number(v) > 0) || 'Must be a positive integer',
    })
    maxRevisions = Number(maxStr)

    const hbStr = await input({
      message: 'Heartbeat interval (task transitions between progress log entries):',
      default: String(heartbeatInterval),
      validate: (v: string) => (Number.isInteger(Number(v)) && Number(v) > 0) || 'Must be a positive integer',
    })
    heartbeatInterval = Number(hbStr)
  }

  // -------------------------------------------------------------------------
  // Step 6: Confirm
  // -------------------------------------------------------------------------
  console.log()
  console.log('━━━ Summary ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Name:         ${name}`)
  console.log(`  ID:           ${id}`)
  console.log(`  Directory:    ${absPath}`)
  if (projectPath) console.log(`  Project:      ${projectPath}`)
  console.log(`  Coordinators: ${coordinators.length > 0 ? coordinators.map(c => c.name).join(', ') : 'none'}`)
  if (modelScope === 'global-default') {
    const globalModels = resolveModelsForProvider(readGlobalConfig().models)
    console.log(`  Models:       global defaults`)
    console.log(`  Worker:       ${globalModels.worker ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.worker}`)
    console.log(`  Spec:         ${globalModels.spec ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.spec}`)
  } else {
    console.log(`  Models:       ${modelScope === 'global' ? 'write global defaults' : 'workspace override'}`)
    console.log(`  Worker:       ${models?.worker ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.worker}`)
    console.log(`  Spec:         ${models?.spec ?? DEFAULT_LOCAL_MODEL_ASSIGNMENT.spec}`)
  }
  console.log()

  const go = await confirm({
    message: hasExisting ? 'Update guildhall.yaml?' : 'Create workspace?',
    default: true,
  })

  if (!go) {
    console.log('[guildhall] Aborted.')
    return
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------
  const config = {
    name,
    id,
    ...(projectPath ? { projectPath } : {}),
    ...(modelScope === 'workspace' && models ? { models } : {}),
    coordinators,
    maxRevisions,
    heartbeatInterval,
    ignore: existing?.ignore ?? ['node_modules', 'dist', '.git', 'coverage'],
    tags: existing?.tags ?? [],
  }

  if (modelScope === 'global' && models) {
    const global = readGlobalConfig()
    updateGlobalConfig({
      ...global,
      models: writeModelsForProvider(global.models, undefined, {
        ...resolveModelsForProvider(global.models),
        ...models,
      }),
    })
  }

  if (hasExisting) {
    writeWorkspaceConfig(absPath, config as any)
  } else {
    bootstrapWorkspace(absPath, { name, ...(projectPath ? { projectPath } : {}) })
    writeWorkspaceConfig(absPath, config as any)
  }

  console.log(`\n[guildhall] ✓ guildhall.yaml → ${absPath}`)
  console.log(`[guildhall] ✓ memory/ directory ready`)
  console.log()
  console.log('Next step:')
  console.log(`  • The dashboard will now launch at http://localhost:7777`)
  console.log(`  • Use the setup wizard to pick an agent provider, then add tasks`)
  console.log()
}
