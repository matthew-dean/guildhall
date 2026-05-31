import { describe, expect, it } from 'vitest'

import * as runtime from '../index.js'

describe('runtime public entrypoint', () => {
  it('exports the orchestration, workspace, and runtime helpers used by integrations', () => {
    expect(runtime.Orchestrator).toBeTypeOf('function')
    expect(runtime.runOrchestrator).toBeTypeOf('function')
    expect(runtime.buildContext).toBeTypeOf('function')
    expect(runtime.buildHookExecutor).toBeTypeOf('function')
    expect(runtime.tickOutcomeToBackendEvent).toBeTypeOf('function')
    expect(runtime.LivenessTracker).toBeTypeOf('function')
    expect(runtime.evaluateProposal).toBeTypeOf('function')
    expect(runtime.writeCheckpoint).toBeTypeOf('function')
    expect(runtime.authorizeAction).toBeTypeOf('function')
    expect(runtime.SlotAllocator).toBeTypeOf('function')
    expect(runtime.evaluateEnvelope).toBeTypeOf('function')
    expect(runtime.evaluatePreRejection).toBeTypeOf('function')
    expect(runtime.selectApiClient).toBeTypeOf('function')
    expect(runtime.resolveWorkspace).toBeTypeOf('function')
    expect(runtime.detectPackageManager).toBeTypeOf('function')
    expect(runtime.detectRuntimeBackendSetup).toBeTypeOf('function')
    expect(runtime.runRuntimeHealthChecks).toBeTypeOf('function')
    expect(runtime.planProjectRuntimeMigration).toBeTypeOf('function')
    expect(runtime.runInit).toBeTypeOf('function')
    expect(runtime.runServe).toBeTypeOf('function')
    expect(runtime.ProcessRegistry).toBeTypeOf('function')
    expect(runtime.isLocalOnly).toBeTypeOf('function')
    expect(runtime.deterministicReview).toBeTypeOf('function')
    expect(runtime.loadDesignSystem).toBeTypeOf('function')
    expect(runtime.createExploringTask).toBeTypeOf('function')
    expect(runtime.createMetaIntakeTask).toBeTypeOf('function')
  })
})
