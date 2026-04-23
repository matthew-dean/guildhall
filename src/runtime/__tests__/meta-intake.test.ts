import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  bootstrapWorkspace,
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from '@guildhall/config'
import {
  createMetaIntakeTask,
  approveMetaIntake,
  parseCoordinatorDraft,
  parseLeverInferences,
  parseBootstrapDraft,
  mergeLeverInferences,
  workspaceNeedsMetaIntake,
  META_INTAKE_TASK_ID,
  META_INTAKE_DOMAIN,
} from '../meta-intake.js'
import { TaskQueue } from '@guildhall/core'
import {
  AGENT_SETTINGS_FILENAME,
  loadLeverSettings,
  makeDefaultSettings,
  saveLeverSettings,
} from '@guildhall/levers'

// ---------------------------------------------------------------------------
// FR-14 coordinator bootstrapping via meta-intake
//
// Covers:
//  - Creating the reserved meta-intake task (idempotent).
//  - Detecting when a workspace needs a meta-intake (no coordinators / no yaml).
//  - Parsing a YAML codefence draft of coordinators out of a free-text spec.
//  - approveMetaIntake merging drafts into guildhall.yaml and closing the task.
// ---------------------------------------------------------------------------

let tmpDir: string
let memoryDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-meta-intake-'))
  // Bootstrap a fresh workspace with no coordinators — this is the common
  // entry point for meta-intake.
  bootstrapWorkspace(tmpDir, { name: 'Meta Intake Test' })
  memoryDir = path.join(tmpDir, 'memory')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function readQueue(): Promise<TaskQueue> {
  const raw = await fs.readFile(path.join(memoryDir, 'TASKS.json'), 'utf-8')
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) {
    return { version: 1, lastUpdated: new Date().toISOString(), tasks: parsed }
  }
  return TaskQueue.parse(parsed)
}

describe('workspaceNeedsMetaIntake', () => {
  it('returns true for a freshly-bootstrapped workspace with no coordinators', () => {
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(true)
  })

  it('returns false once coordinators are defined', () => {
    const config = readWorkspaceConfig(tmpDir)
    writeWorkspaceConfig(tmpDir, {
      ...config,
      coordinators: [
        {
          id: 'looma',
          name: 'Looma',
          domain: 'looma',
          mandate: 'UI',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
    })
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(false)
  })

  it('returns true when guildhall.yaml is absent entirely', async () => {
    await fs.rm(path.join(tmpDir, 'guildhall.yaml'), { force: true })
    expect(workspaceNeedsMetaIntake(tmpDir)).toBe(true)
  })
})

describe('createMetaIntakeTask', () => {
  it('seeds a critical exploring task with the reserved id + domain', async () => {
    const result = await createMetaIntakeTask({
      memoryDir,
      projectPath: tmpDir,
    })
    expect(result.taskId).toBe(META_INTAKE_TASK_ID)
    expect(result.alreadyExists).toBe(false)
    expect(result.transcriptPath).toBe(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
    )

    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)
    expect(task).toBeDefined()
    expect(task!.status).toBe('exploring')
    expect(task!.domain).toBe(META_INTAKE_DOMAIN)
    expect(task!.priority).toBe('critical')
  })

  it('writes the seed message into the exploring transcript', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
      'utf-8',
    )
    expect(transcript).toContain('coordinator definitions')
    expect(transcript).toContain('system')
  })

  it('is idempotent — calling twice does not duplicate the task', async () => {
    const first = await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const second = await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    expect(first.alreadyExists).toBe(false)
    expect(second.alreadyExists).toBe(true)
    const queue = await readQueue()
    const matches = queue.tasks.filter((t) => t.id === META_INTAKE_TASK_ID)
    expect(matches).toHaveLength(1)
  })

  it('honors a custom seed message when provided', async () => {
    await createMetaIntakeTask({
      memoryDir,
      projectPath: tmpDir,
      seedMessage: 'CUSTOM SEED PROMPT',
    })
    const transcript = await fs.readFile(
      path.join(memoryDir, 'exploring', `${META_INTAKE_TASK_ID}.md`),
      'utf-8',
    )
    expect(transcript).toContain('CUSTOM SEED PROMPT')
  })
})

describe('parseCoordinatorDraft', () => {
  it('extracts a single coordinator from a ```yaml ...``` fence', () => {
    const spec = `
Some narrative text.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma Coordinator
    domain: looma
    mandate: |
      Oversee UI.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard nav?
    autonomousDecisions:
      - Minor copy tweaks
    escalationTriggers:
      - API surface changes
\`\`\`

More narrative.
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).not.toBeNull()
    expect(drafts).toHaveLength(1)
    const coord = drafts![0]!
    expect(coord.id).toBe('looma')
    expect(coord.name).toBe('Looma Coordinator')
    expect(coord.domain).toBe('looma')
    expect(coord.mandate).toBe('Oversee UI.')
    expect(coord.concerns).toHaveLength(1)
    expect(coord.concerns[0]!.reviewQuestions).toEqual([
      'Does this preserve keyboard nav?',
    ])
    expect(coord.autonomousDecisions).toEqual(['Minor copy tweaks'])
    expect(coord.escalationTriggers).toEqual(['API surface changes'])
  })

  it('also accepts a ```yml fence', () => {
    const spec = '```yml\ncoordinators:\n  - id: a\n    name: A\n    domain: a\n    mandate: m\n```'
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).toHaveLength(1)
    expect(drafts![0]!.id).toBe('a')
  })

  it('returns null when there is no yaml codefence', () => {
    expect(parseCoordinatorDraft('No codefence here, just prose.')).toBeNull()
  })

  it('returns null when the fence has no coordinators key', () => {
    const spec = '```yaml\nfoo: bar\n```'
    expect(parseCoordinatorDraft(spec)).toBeNull()
  })

  it('skips entries missing required fields', () => {
    const spec = `
\`\`\`yaml
coordinators:
  - id: ok
    name: OK
    domain: ok
    mandate: m
  - name: Nameless
    domain: wat
  - id: also-ok
    name: Another
    domain: also-ok
    mandate: m
\`\`\`
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts!.map((d) => d.id)).toEqual(['ok', 'also-ok'])
  })

  it('finds the first valid fence even if earlier fences are broken', () => {
    const spec = `
\`\`\`yaml
not even valid yaml because of a tab\t: field
\`\`\`

\`\`\`yaml
coordinators:
  - id: good
    name: Good
    domain: good
    mandate: m
\`\`\`
`
    const drafts = parseCoordinatorDraft(spec)
    expect(drafts).toHaveLength(1)
    expect(drafts![0]!.id).toBe('good')
  })
})

describe('approveMetaIntake', () => {
  const sampleDraft = `## Summary
Draft coordinator definitions based on the interview.

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma Coordinator
    domain: looma
    path: frontend
    mandate: |
      UI quality and design-system fidelity.
    concerns:
      - id: a11y
        description: Accessibility regressions
        reviewQuestions:
          - Does this preserve keyboard navigation?
    autonomousDecisions:
      - Minor copy tweaks
    escalationTriggers:
      - Public API changes
  - id: knit
    name: Knit Coordinator
    domain: knit
    mandate: |
      Data / API layer concerns.
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`
`

  beforeEach(async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    // Attach a draft spec to the meta-intake task (as the Spec Agent would).
    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!
    task.spec = sampleDraft
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
  })

  it('merges drafts into guildhall.yaml and closes the task', async () => {
    const result = await approveMetaIntake({
      workspacePath: tmpDir,
      memoryDir,
    })
    expect(result.success).toBe(true)
    expect(result.coordinatorsAdded).toBe(2)

    const config = readWorkspaceConfig(tmpDir)
    expect(config.coordinators).toHaveLength(2)
    expect(config.coordinators.map((c) => c.id)).toEqual(['looma', 'knit'])
    expect(config.coordinators[0]!.path).toBe('frontend')

    const queue = await readQueue()
    const task = queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!
    expect(task.status).toBe('done')
    expect(task.completedAt).toBeDefined()
  })

  it('deduplicates against coordinators already in guildhall.yaml', async () => {
    // Pre-seed looma into the yaml.
    const config = readWorkspaceConfig(tmpDir)
    writeWorkspaceConfig(tmpDir, {
      ...config,
      coordinators: [
        {
          id: 'looma',
          name: 'Looma (existing)',
          domain: 'looma',
          mandate: 'existing',
          concerns: [],
          autonomousDecisions: [],
          escalationTriggers: [],
        },
      ],
    })

    const result = await approveMetaIntake({
      workspacePath: tmpDir,
      memoryDir,
    })
    expect(result.success).toBe(true)
    // Only knit is new; looma should be preserved as the pre-existing version.
    expect(result.coordinatorsAdded).toBe(1)
    const after = readWorkspaceConfig(tmpDir)
    expect(after.coordinators).toHaveLength(2)
    expect(after.coordinators.find((c) => c.id === 'looma')!.name).toBe('Looma (existing)')
  })

  it('errors when the spec has no yaml codefence', async () => {
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = 'just prose, no draft'
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain('codefence')
  })

  it('errors when there is no meta-intake task', async () => {
    const queue = await readQueue()
    queue.tasks = queue.tasks.filter((t) => t.id !== META_INTAKE_TASK_ID)
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain(META_INTAKE_TASK_ID)
  })

  it('errors when the meta-intake task has no spec yet', async () => {
    const queue = await readQueue()
    delete queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain('no spec')
  })
})

// ---------------------------------------------------------------------------
// AC-14: the Spec Agent infers lever positions during meta-intake and records
// rationales. No direct meta-questions — the positions come from
// project-guidance answers, and every lever write includes its source.
// ---------------------------------------------------------------------------

describe('parseLeverInferences', () => {
  it('extracts project + domain + override levers from a ```yaml levers: fence', () => {
    const spec = `Some narrative.

\`\`\`yaml
levers:
  project:
    business_envelope_strictness:
      position: strict
      rationale: user described production SOC2 workload
    remediation_autonomy:
      position: confirm_destructive
      rationale: small team but regulated data
  domains:
    default:
      completion_approval:
        position: human_required
        rationale: regulated compliance requires human sign-off
    overrides:
      looma:
        reviewer_mode:
          position: llm_only
          rationale: UI polish benefits from LLM critique
\`\`\`
`
    const inferences = parseLeverInferences(spec)
    expect(inferences).not.toBeNull()
    expect(inferences!.project.business_envelope_strictness).toEqual({
      position: 'strict',
      rationale: 'user described production SOC2 workload',
    })
    expect(inferences!.project.remediation_autonomy!.position).toBe('confirm_destructive')
    expect(inferences!.domains.default.completion_approval!.rationale).toContain(
      'regulated',
    )
    expect(inferences!.domains.overrides.looma!.reviewer_mode).toEqual({
      position: 'llm_only',
      rationale: 'UI polish benefits from LLM critique',
    })
  })

  it('returns null when no levers fence is present', () => {
    expect(parseLeverInferences('```yaml\ncoordinators: []\n```')).toBeNull()
    expect(parseLeverInferences('no fence at all')).toBeNull()
  })

  it('skips entries missing a rationale', () => {
    const spec = `\`\`\`yaml
levers:
  project:
    business_envelope_strictness:
      position: strict
      rationale: ""
    agent_health_strictness:
      position: strict
      rationale: local LLM is fast and reliable
\`\`\``
    const inf = parseLeverInferences(spec)
    expect(inf).not.toBeNull()
    expect(Object.keys(inf!.project)).toEqual(['agent_health_strictness'])
  })

  it('accepts parameterized positions (fanout-n, soft_penalty-after)', () => {
    const spec = `\`\`\`yaml
levers:
  project:
    concurrent_task_dispatch:
      position:
        kind: fanout
        n: 3
      rationale: multi-CPU box and independent tasks
    rejection_dampening:
      position:
        kind: soft_penalty
        after: 2
      rationale: reject repeats after two tries
\`\`\``
    const inf = parseLeverInferences(spec)
    expect(inf!.project.concurrent_task_dispatch!.position).toEqual({
      kind: 'fanout',
      n: 3,
    })
    expect(inf!.project.rejection_dampening!.position).toEqual({
      kind: 'soft_penalty',
      after: 2,
    })
  })
})

describe('mergeLeverInferences', () => {
  it('writes inferred positions with setBy=spec-agent-intake and the supplied rationale', async () => {
    // Seed default settings.
    const settingsPath = path.join(memoryDir, AGENT_SETTINGS_FILENAME)
    await fs.mkdir(memoryDir, { recursive: true })
    await saveLeverSettings({ path: settingsPath, settings: makeDefaultSettings() })

    const now = '2026-04-21T00:00:00.000Z'
    const result = await mergeLeverInferences(
      memoryDir,
      {
        project: {
          business_envelope_strictness: {
            position: 'strict',
            rationale: 'prod SOC2 workload',
          },
        },
        domains: {
          default: {
            completion_approval: {
              position: 'human_required',
              rationale: 'regulated — humans sign off',
            },
          },
          overrides: {
            looma: {
              reviewer_mode: {
                position: 'llm_only',
                rationale: 'UI critique benefits from LLM judgment',
              },
            },
          },
        },
      },
      now,
    )

    expect(result.projectSet).toEqual(['business_envelope_strictness'])
    expect(result.domainDefaultSet).toEqual(['completion_approval'])
    expect(result.overridesSet.looma).toEqual(['reviewer_mode'])
    expect(result.rejected).toEqual([])

    const reloaded = await loadLeverSettings({ path: settingsPath })
    expect(reloaded.project.business_envelope_strictness).toEqual({
      position: 'strict',
      rationale: 'prod SOC2 workload',
      setAt: now,
      setBy: 'spec-agent-intake',
    })
    expect(reloaded.domains.default.completion_approval).toEqual({
      position: 'human_required',
      rationale: 'regulated — humans sign off',
      setAt: now,
      setBy: 'spec-agent-intake',
    })
    expect(reloaded.domains.overrides!.looma!.reviewer_mode).toEqual({
      position: 'llm_only',
      rationale: 'UI critique benefits from LLM judgment',
      setAt: now,
      setBy: 'spec-agent-intake',
    })
  })

  it('rejects unknown lever names without crashing', async () => {
    const settingsPath = path.join(memoryDir, AGENT_SETTINGS_FILENAME)
    await fs.mkdir(memoryDir, { recursive: true })
    await saveLeverSettings({ path: settingsPath, settings: makeDefaultSettings() })
    const result = await mergeLeverInferences(memoryDir, {
      project: {
        fake_project_lever: { position: 'x', rationale: 'r' },
      },
      domains: {
        default: {
          fake_domain_lever: { position: 'x', rationale: 'r' },
        },
        overrides: {},
      },
    })
    expect(result.projectSet).toEqual([])
    expect(result.domainDefaultSet).toEqual([])
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected.map((r) => r.scope).sort()).toEqual([
      'domain:default',
      'project',
    ])
  })

  it('throws when an inferred position fails schema validation (bad picklist value)', async () => {
    const settingsPath = path.join(memoryDir, AGENT_SETTINGS_FILENAME)
    await fs.mkdir(memoryDir, { recursive: true })
    await saveLeverSettings({ path: settingsPath, settings: makeDefaultSettings() })
    await expect(
      mergeLeverInferences(memoryDir, {
        project: {
          business_envelope_strictness: {
            position: 'not_a_real_position',
            rationale: 'typo',
          },
        },
        domains: { default: {}, overrides: {} },
      }),
    ).rejects.toThrow(/business_envelope_strictness/)
  })
})

describe('approveMetaIntake + lever inferences (AC-14 e2e)', () => {
  it('parses both coordinators and levers fences, merges both, and records rationale per lever', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    // Seed default lever settings so the merge has something to load.
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings: makeDefaultSettings(),
    })

    const spec = `## Draft

\`\`\`yaml
coordinators:
  - id: looma
    name: Looma
    domain: looma
    mandate: UI quality
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`

\`\`\`yaml
levers:
  project:
    business_envelope_strictness:
      position: strict
      rationale: user said "we ship to paying customers"
  domains:
    default:
      completion_approval:
        position: human_required
        rationale: compliance requires human sign-off
    overrides:
      looma:
        reviewer_mode:
          position: llm_only
          rationale: UI work benefits from LLM judgment
\`\`\`
`
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )

    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(true)
    expect(result.coordinatorsAdded).toBe(1)
    expect(result.leversSet).toBeDefined()
    expect(result.leversSet!.project).toEqual(['business_envelope_strictness'])
    expect(result.leversSet!.domainDefault).toEqual(['completion_approval'])
    expect(result.leversSet!.overrides.looma).toEqual(['reviewer_mode'])

    const settings = await loadLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
    })
    expect(settings.project.business_envelope_strictness).toMatchObject({
      position: 'strict',
      setBy: 'spec-agent-intake',
      rationale: expect.stringContaining('paying customers'),
    })
    expect(settings.domains.default.completion_approval).toMatchObject({
      position: 'human_required',
      setBy: 'spec-agent-intake',
      rationale: expect.stringContaining('compliance'),
    })
    expect(settings.domains.overrides!.looma!.reviewer_mode).toMatchObject({
      position: 'llm_only',
      setBy: 'spec-agent-intake',
      rationale: expect.stringContaining('LLM'),
    })
  })

  it('still succeeds when only coordinators are present (no levers fence)', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = `\`\`\`yaml
coordinators:
  - id: a
    name: A
    domain: a
    mandate: m
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\``
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )
    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(true)
    expect(result.leversSet).toBeUndefined()
  })

  it('returns an error (and does not close the task) when an inferred lever is schema-invalid', async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
    await saveLeverSettings({
      path: path.join(memoryDir, AGENT_SETTINGS_FILENAME),
      settings: makeDefaultSettings(),
    })
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = `\`\`\`yaml
coordinators:
  - id: a
    name: A
    domain: a
    mandate: m
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`

\`\`\`yaml
levers:
  project:
    business_envelope_strictness:
      position: bogus_value
      rationale: typo from the spec agent
\`\`\``
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )

    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to merge inferred levers')
  })
})

// ---------------------------------------------------------------------------
// Bootstrap-verification fence: the meta-intake agent runs candidate install +
// gate commands via shell, records pass/fail in provenance.tried, and emits
// a bootstrap: YAML codefence once a working sequence is found. approveMetaIntake
// merges that block into guildhall.yaml so the orchestrator's bootstrap phase
// can use it.
// ---------------------------------------------------------------------------

describe('parseBootstrapDraft', () => {
  it('extracts commands + successGates + provenance from a bootstrap: fence', () => {
    const spec = `\`\`\`yaml
bootstrap:
  commands:
    - pnpm install
  successGates:
    - pnpm typecheck
    - pnpm test
  timeoutMs: 600000
  provenance:
    establishedBy: spec-agent-intake
    establishedAt: 2026-04-23T10:00:00.000Z
    tried:
      - command: pnpm install
        result: pass
      - command: npm install
        result: fail
        stderr: "npm: command not found"
\`\`\``
    const draft = parseBootstrapDraft(spec)
    expect(draft).not.toBeNull()
    expect(draft!.commands).toEqual(['pnpm install'])
    expect(draft!.successGates).toEqual(['pnpm typecheck', 'pnpm test'])
    expect(draft!.timeoutMs).toBe(600000)
    expect(draft!.provenance!.establishedBy).toBe('spec-agent-intake')
    expect(draft!.provenance!.tried).toHaveLength(2)
    expect(draft!.provenance!.tried[1]!.result).toBe('fail')
    expect(draft!.provenance!.tried[1]!.stderr).toContain('command not found')
  })

  it('returns null when no bootstrap fence is present', () => {
    expect(parseBootstrapDraft('```yaml\ncoordinators: []\n```')).toBeNull()
    expect(parseBootstrapDraft('no fence at all')).toBeNull()
  })

  it('accepts a bootstrap block with no provenance', () => {
    const spec = `\`\`\`yaml
bootstrap:
  commands:
    - pnpm install
  successGates: []
\`\`\``
    const draft = parseBootstrapDraft(spec)
    expect(draft).not.toBeNull()
    expect(draft!.commands).toEqual(['pnpm install'])
    expect(draft!.successGates).toEqual([])
    expect(draft!.provenance).toBeUndefined()
  })

  it('ignores non-string commands in the list', () => {
    const spec = `\`\`\`yaml
bootstrap:
  commands:
    - pnpm install
    - 42
    - null
  successGates: []
\`\`\``
    const draft = parseBootstrapDraft(spec)
    expect(draft!.commands).toEqual(['pnpm install'])
  })

  it('returns null when both commands and successGates are empty', () => {
    const spec = `\`\`\`yaml
bootstrap:
  commands: []
  successGates: []
\`\`\``
    expect(parseBootstrapDraft(spec)).toBeNull()
  })

  it('skips tried entries missing command or result', () => {
    const spec = `\`\`\`yaml
bootstrap:
  commands: [pnpm install]
  successGates: []
  provenance:
    establishedBy: spec-agent-intake
    establishedAt: 2026-04-23T10:00:00.000Z
    tried:
      - command: ok
        result: pass
      - command: missing-result
      - result: pass
\`\`\``
    const draft = parseBootstrapDraft(spec)
    expect(draft!.provenance!.tried).toHaveLength(1)
    expect(draft!.provenance!.tried[0]!.command).toBe('ok')
  })
})

describe('approveMetaIntake + bootstrap fence', () => {
  beforeEach(async () => {
    await createMetaIntakeTask({ memoryDir, projectPath: tmpDir })
  })

  it('merges bootstrap into guildhall.yaml alongside coordinators', async () => {
    const spec = `\`\`\`yaml
coordinators:
  - id: core
    name: Core
    domain: core
    mandate: core stuff
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`

\`\`\`yaml
bootstrap:
  commands:
    - pnpm install
  successGates:
    - pnpm typecheck
    - pnpm test
  provenance:
    establishedBy: spec-agent-intake
    establishedAt: 2026-04-23T10:00:00.000Z
    tried:
      - command: pnpm install
        result: pass
      - command: pnpm typecheck
        result: pass
\`\`\``
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )

    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(true)
    expect(result.bootstrap).toEqual({
      commands: ['pnpm install'],
      successGates: ['pnpm typecheck', 'pnpm test'],
    })

    const config = readWorkspaceConfig(tmpDir)
    expect(config.bootstrap).toBeDefined()
    expect(config.bootstrap!.commands).toEqual(['pnpm install'])
    expect(config.bootstrap!.successGates).toEqual(['pnpm typecheck', 'pnpm test'])
    expect(config.bootstrap!.provenance!.establishedBy).toBe('spec-agent-intake')
    expect(config.bootstrap!.provenance!.tried).toHaveLength(2)
  })

  it('stamps default provenance when the agent omits it', async () => {
    const spec = `\`\`\`yaml
coordinators:
  - id: core
    name: Core
    domain: core
    mandate: m
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\`

\`\`\`yaml
bootstrap:
  commands: [pnpm install]
  successGates: [pnpm test]
\`\`\``
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )

    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(true)
    const config = readWorkspaceConfig(tmpDir)
    expect(config.bootstrap!.provenance!.establishedBy).toBe('spec-agent-intake')
    expect(config.bootstrap!.provenance!.establishedAt).toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(config.bootstrap!.provenance!.tried).toEqual([])
  })

  it('still succeeds when no bootstrap fence is present', async () => {
    const spec = `\`\`\`yaml
coordinators:
  - id: core
    name: Core
    domain: core
    mandate: m
    concerns: []
    autonomousDecisions: []
    escalationTriggers: []
\`\`\``
    const queue = await readQueue()
    queue.tasks.find((t) => t.id === META_INTAKE_TASK_ID)!.spec = spec
    await fs.writeFile(
      path.join(memoryDir, 'TASKS.json'),
      JSON.stringify(queue, null, 2),
      'utf-8',
    )

    const result = await approveMetaIntake({ workspacePath: tmpDir, memoryDir })
    expect(result.success).toBe(true)
    expect(result.bootstrap).toBeUndefined()
    const config = readWorkspaceConfig(tmpDir)
    expect(config.bootstrap).toBeUndefined()
  })
})
