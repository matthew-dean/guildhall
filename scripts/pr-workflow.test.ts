import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
}

interface Workflow {
  name?: string
  on?: unknown
  jobs?: Record<string, { steps?: WorkflowStep[] }>
}

function readWorkflow(): { raw: string; workflow: Workflow; steps: WorkflowStep[] } {
  const raw = readFileSync('.github/workflows/pr.yml', 'utf8')
  const workflow = yaml.load(raw) as Workflow
  const steps = workflow.jobs?.verify?.steps ?? []
  return { raw, workflow, steps }
}

describe('PR workflow', () => {
  it('runs the minimal PR quality gates before merge', () => {
    const { workflow, steps } = readWorkflow()
    const runs = steps.map((step) => step.run).filter(Boolean)
    const uses = steps.map((step) => step.uses).filter(Boolean)

    expect(workflow.name).toBe('PR checks')
    expect(JSON.stringify(workflow.on)).toContain('pull_request')
    expect(uses).toContain('actions/checkout@v4')
    expect(uses).toContain('pnpm/action-setup@v4')
    expect(uses).toContain('actions/setup-node@v4')
    expect(runs).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm typecheck',
      'pnpm docs:check-help-sync',
      'pnpm lint:deps',
      'pnpm test:ui:install',
      'pnpm test:release',
      'pnpm build',
      'pnpm test:ui',
    ])
  })

  it('records the 90 percent coverage floor as the next PR gate once coverage is ready', () => {
    const { raw } = readWorkflow()
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>
    }
    const coverageConfig = readFileSync('vitest.coverage-90.config.ts', 'utf8')

    expect(pkg.scripts?.['test:coverage:90']).toBe(
      'vitest run --coverage --config vitest.coverage-90.config.ts',
    )
    expect(coverageConfig).toContain('statements: 90')
    expect(coverageConfig).toContain('lines: 90')
    expect(coverageConfig).toContain('functions: 90')
    expect(coverageConfig).toContain('branches: 90')
    expect(raw).toContain('pnpm test:coverage:90')
    expect(raw).toContain('90% floor')
  })
})
