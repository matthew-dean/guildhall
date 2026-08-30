import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { readWorkspaceConfig } from '@guildhall/config'

import { discoverChildGitProjects, resolveWorkspaceProjectPathsOrDiscover } from './git-story-policy.js'

const GIT_OBSERVATION_TIMEOUT_MS = 750
const GIT_OBSERVATION_MAX_BUFFER = 16 * 1024 * 1024
const FILESYSTEM_FINGERPRINT_SCRIPT = String.raw`
const { createHash } = require('node:crypto')
const { lstatSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const root = process.argv[1]
const paths = readFileSync(0, 'utf8').split('\0').filter(Boolean)
const fingerprint = createHash('sha256')
for (const relativePath of paths) {
  fingerprint.update('\0').update(relativePath).update('\0')
  try {
    const stat = lstatSync(join(root, relativePath), { bigint: true })
    fingerprint
      .update(String(stat.dev)).update(':')
      .update(String(stat.ino)).update(':')
      .update(String(stat.mode)).update(':')
      .update(String(stat.size)).update(':')
      .update(String(stat.mtimeNs)).update(':')
      .update(String(stat.ctimeNs))
  } catch (error) {
    fingerprint.update(error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unavailable')
  }
}
process.stdout.write(fingerprint.digest('hex'))
`
const lastSuccessfulRootSignatures = new Map<string, string>()

function gitObservationEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
  }
}

function remainingObservationTime(deadline: number): number {
  const remaining = Math.floor(deadline - performance.now())
  if (remaining <= 0) throw new Error('Repository observation timed out')
  return remaining
}

function readGitOutput(root: string, args: string[], deadline: number): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: remainingObservationTime(deadline),
    maxBuffer: GIT_OBSERVATION_MAX_BUFFER,
    env: gitObservationEnvironment(),
  })
}

function readOptionalGitOutput(root: string, args: string[], deadline: number): string | null {
  try {
    return readGitOutput(root, args, deadline).trim()
  } catch (error) {
    if (typeof (error as { status?: unknown }).status === 'number') return null
    throw error
  }
}

function visitNulRecords(output: string, visit: (record: string) => void): void {
  let start = 0
  while (start < output.length) {
    const terminator = output.indexOf('\0', start)
    const end = terminator === -1 ? output.length : terminator
    if (end > start) visit(output.slice(start, end))
    if (terminator === -1) break
    start = terminator + 1
  }
}

/**
 * Fingerprint index entries and working-tree metadata without asking Git to
 * inspect file content. This notices staged, unstaged, added, and removed files
 * while avoiding clean/process filters entirely.
 */
function readFilesystemFingerprint(root: string, paths: ReadonlySet<string>, deadline: number): string {
  return execFileSync(process.execPath, ['-e', FILESYSTEM_FINGERPRINT_SCRIPT, root], {
    encoding: 'utf8',
    input: [...paths].join('\0'),
    timeout: remainingObservationTime(deadline),
    maxBuffer: 1024,
  }).trim()
}

function readWorktreeFingerprint(root: string, deadline: number): string {
  const stagedEntries = readGitOutput(root, ['ls-files', '--stage', '-z'], deadline)
  const untrackedEntries = readGitOutput(root, ['ls-files', '--others', '--exclude-standard', '-z'], deadline)
  const paths = new Set<string>()
  const submodulePaths: string[] = []
  visitNulRecords(stagedEntries, (entry) => {
    const tab = entry.indexOf('\t')
    const relativePath = entry.slice(tab + 1)
    paths.add(relativePath)
    if (entry.startsWith('160000 ')) submodulePaths.push(relativePath)
  })
  visitNulRecords(untrackedEntries, path => paths.add(path))
  const fingerprint = createHash('sha256')
    .update(stagedEntries)
    .update('\0--untracked--\0')
    .update(untrackedEntries)

  fingerprint.update('\0--filesystem--\0').update(readFilesystemFingerprint(root, paths, deadline))
  for (const submodulePath of submodulePaths) {
    const submoduleRoot = join(root, submodulePath)
    let submoduleSignature: string
    try {
      submoduleSignature = readRepositoryRootSignature(submoduleRoot, deadline)
    } catch {
      submoduleSignature = lastSuccessfulRootSignatures.get(submoduleRoot)
        ?? `unavailable:${basename(submoduleRoot)}`
    }
    fingerprint
      .update('\0--submodule--\0')
      .update(submodulePath)
      .update('\0')
      .update(submoduleSignature)
  }

  return fingerprint.digest('hex')
}

/**
 * Observe the repository without asking Git to refresh or clean working-tree
 * content. A full `git status` can invoke filters such as Git LFS; killing that
 * work on a polling timeout leaves partially written filter objects behind.
 */
function readRepositoryRootSignature(
  root: string,
  deadline = performance.now() + GIT_OBSERVATION_TIMEOUT_MS,
): string {
  const headOid = readOptionalGitOutput(root, ['rev-parse', '--verify', 'HEAD'], deadline)
  const branchName = readOptionalGitOutput(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], deadline)
  const upstreamName = readOptionalGitOutput(root, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ], deadline)
  const aheadBehind = upstreamName
    ? readOptionalGitOutput(root, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], deadline)
    : null
  const [ahead = '0', behind = '0'] = aheadBehind?.split(/\s+/) ?? []

  const worktreeFingerprint = readWorktreeFingerprint(root, deadline)

  const signature = [
    `# branch.oid ${headOid ?? '(initial)'}`,
    `# branch.head ${branchName ?? '(detached)'}`,
    ...(upstreamName ? [`# branch.upstream ${upstreamName}`, `# branch.ab +${ahead} -${behind}`] : []),
    `# worktree.fingerprint ${worktreeFingerprint}`,
  ].join('\n')
  lastSuccessfulRootSignatures.set(root, signature)
  return signature
}

/**
 * A bounded, side-effect-free Git observation for the projection freshness
 * watcher. The branch header carries ahead/behind state, which changes after a
 * push even when the working tree and HEAD stay the same.
 */
export function readProjectRepositorySignature(projectRoot: string): string | null {
  let childProjects = discoverChildGitProjects(projectRoot)
  try {
    const workspaceConfig = readWorkspaceConfig(projectRoot)
    childProjects = workspaceConfig.kind === 'workspace'
      ? resolveWorkspaceProjectPathsOrDiscover(projectRoot, workspaceConfig)
      : discoverChildGitProjects(projectRoot)
  } catch {
    // Standalone repositories have no Guildhall config to resolve.
  }
  const roots = childProjects.length > 0
    ? childProjects.map(child => ({ id: child.id, path: child.path }))
    : [{ id: 'workspace', path: projectRoot }]

  const signatures = roots.map(root => {
    try {
      return `${root.id}:${readRepositoryRootSignature(root.path)}`
    } catch {
      const lastSuccessful = lastSuccessfulRootSignatures.get(root.path)
      return lastSuccessful
        ? `${root.id}:${lastSuccessful}`
        : `${root.id}:unavailable:${basename(root.path)}`
    }
  })

  return signatures.length > 0 ? signatures.join('\n') : null
}
