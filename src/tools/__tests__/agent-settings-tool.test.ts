import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { bootstrapWorkspace, readAgentSettings } from '@guildhall/config'
import { getProjectStateDir } from '@guildhall/sessions'
import { saveAgentSetting, saveAgentSettingTool } from '../agent-settings-tool.js'

let tmpDir: string
let decisionsPath: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'guildhall-agent-settings-tool-'))
  bootstrapWorkspace(tmpDir, { name: 'Agent Settings Tool' })
  decisionsPath = path.join(getProjectStateDir(tmpDir), 'DECISIONS.md')
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('saveAgentSetting', () => {
  it('persists coordinator learning and appends an auditable decision entry', async () => {
    const result = await saveAgentSetting({
      workspacePath: tmpDir,
      decisionsPath,
      agentRole: 'coordinator',
      rationale: 'Knit tasks repeatedly need scoped mobile proof before worker handoff.',
      coordinatorId: 'knit',
      addConcern: {
        id: 'mobile-proof',
        description: 'Mobile behavior should be verified before marking UX work done.',
        reviewQuestions: ['Was the relevant mobile viewport exercised?'],
      },
      addAutonomousDecision: 'Choose routine component placement when evidence is local.',
      addEscalationTrigger: 'Ask when a task crosses app/package boundaries.',
      mandateAddendum: 'Prefer a small verification note before dispatching worker work.',
      addIgnorePattern: 'dist',
      maxRevisions: 4,
    })

    expect(result).toMatchObject({ success: true })
    expect(result.summary).toContain('Added concern "mobile-proof" to coordinator knit')
    expect(result.summary).toContain('Updated maxRevisions to 4')

    const settings = readAgentSettings(tmpDir)
    expect(settings.maxRevisions).toBe(4)
    expect(settings.addIgnore).toEqual(['dist'])
    expect(settings.coordinators.knit?.addConcerns[0]).toMatchObject({
      id: 'mobile-proof',
      description: 'Mobile behavior should be verified before marking UX work done.',
    })
    expect(settings.coordinators.knit?.addAutonomousDecisions).toEqual([
      'Choose routine component placement when evidence is local.',
    ])
    expect(settings.coordinators.knit?.addEscalationTriggers).toEqual([
      'Ask when a task crosses app/package boundaries.',
    ])
    expect(settings.coordinators.knit?.mandateAddendum).toBe(
      'Prefer a small verification note before dispatching worker work.',
    )
    expect(settings.coordinators.knit?.history[0]).toMatchObject({
      agentRole: 'coordinator',
      rationale: 'Knit tasks repeatedly need scoped mobile proof before worker handoff.',
    })

    const decisions = await fs.readFile(decisionsPath, 'utf-8')
    expect(decisions).toContain('## [agent-setting]')
    expect(decisions).toContain('**Agent:** coordinator (auto-learned)')
    expect(decisions).toContain('Added concern "mobile-proof" to coordinator knit')
    expect(decisions).toContain('Added ignore pattern: "dist"')
    expect(decisions).toContain('Knit tasks repeatedly need scoped mobile proof before worker handoff.')
  })

  it('records removals and no-op calls distinctly', async () => {
    const removal = await saveAgentSetting({
      workspacePath: tmpDir,
      decisionsPath,
      agentRole: 'reviewer',
      rationale: 'Old escalation rule is too noisy.',
      coordinatorId: 'looma',
      removeConcernId: 'legacy-copy-rule',
    })

    expect(removal.success).toBe(true)
    expect(removal.summary).toBe('Saved: Removed concern "legacy-copy-rule" from coordinator looma')

    const noOp = await saveAgentSetting({
      workspacePath: tmpDir,
      decisionsPath,
      agentRole: 'worker',
      rationale: 'Observed nothing durable enough to persist.',
    })

    expect(noOp).toEqual({
      success: true,
      summary: 'No changes recorded (all inputs were empty)',
    })

    const decisions = await fs.readFile(decisionsPath, 'utf-8')
    expect(decisions).toContain('Removed concern "legacy-copy-rule" from coordinator looma')
    expect(decisions).toContain('**Rationale:** Observed nothing durable enough to persist.')
  })

  it('returns a structured error when the audit log cannot be written', async () => {
    const result = await saveAgentSetting({
      workspacePath: tmpDir,
      decisionsPath: tmpDir,
      agentRole: 'worker',
      rationale: 'This should fail because the audit destination is missing.',
      addIgnorePattern: 'coverage',
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/EISDIR|illegal operation on a directory/i)
  })
})

describe('saveAgentSettingTool', () => {
  it('wraps successful saves with non-error tool metadata', async () => {
    const result = await saveAgentSettingTool.execute(
      {
        workspacePath: tmpDir,
        decisionsPath,
        agentRole: 'coordinator',
        rationale: 'Persist common generated-artifact ignore behavior.',
        addIgnorePattern: 'coverage',
      },
      { cwd: tmpDir, metadata: {} },
    )

    expect(result.is_error).toBe(false)
    expect(result.output).toBe('Saved: Added ignore pattern: "coverage"')
    expect(result.metadata).toMatchObject({ success: true })
  })

  it('surfaces save failures as tool errors', async () => {
    const result = await saveAgentSettingTool.execute(
      {
        workspacePath: tmpDir,
        decisionsPath: tmpDir,
        agentRole: 'coordinator',
        rationale: 'Missing audit log destination should be explicit.',
        maxRevisions: 2,
      },
      { cwd: tmpDir, metadata: {} },
    )

    expect(result.is_error).toBe(true)
    expect(result.output).toContain('Error saving setting:')
    expect(result.metadata?.success).toBe(false)
  })
})
