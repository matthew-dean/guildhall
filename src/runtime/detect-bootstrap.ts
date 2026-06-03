import {
  deriveBootstrapHypothesisFromProfiles,
  detectToolchainProfiles,
  type ToolchainPackageManager,
} from './toolchain-profile.js'

/**
 * Bootstrap hypothesis — the setup/meta-intake agent's starting guess for
 * how to put a project into a testable state. Pure static detection reads
 * project manifests and lockfiles. The agent then empirically verifies (and
 * can reject) this hypothesis before writing the final `bootstrap` block.
 */
export interface BootstrapHypothesis {
  /** Detected package manager or tool runner, if any. */
  packageManager?: ToolchainPackageManager
  /** Ordered shell commands to reach a testable state. Install is first. */
  commands: string[]
  /** Commands that, when run after `commands`, prove the project is testable. */
  successGates: string[]
}

/**
 * Inspect `projectPath` and produce a bootstrap hypothesis.
 *
 * Technology-specific assumptions live in `toolchain-profile.ts`; this module
 * preserves the historic API used by meta-intake and task-gate inference.
 */
export function detectBootstrapHypothesis(projectPath: string): BootstrapHypothesis {
  const profiles = detectToolchainProfiles(projectPath)
  const hypothesis = deriveBootstrapHypothesisFromProfiles(profiles)
  return {
    ...(hypothesis.packageManager ? { packageManager: hypothesis.packageManager } : {}),
    commands: hypothesis.commands,
    successGates: hypothesis.successGates,
  }
}
