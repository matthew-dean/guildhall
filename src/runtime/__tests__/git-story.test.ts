import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { InMemoryGitDriver } from '../git-driver.js'
import {
  classifyGitStoryState,
  inspectGitStory,
  summarizeGitStories,
} from '../git-story.js'
import { discoverChildGitProjects, effectiveGitStoryPolicy } from '../git-story-policy.js'

describe('classifyGitStoryState', () => {
  it('reports dirty work before unpublished commits', () => {
    expect(classifyGitStoryState({
      changedCount: 2,
      untrackedCount: 1,
      ahead: 3,
      hasUpstream: true,
    })).toBe('dirty_uncommitted')
  })

  it('reports no upstream when the branch has no upstream and no dirty work', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: false,
    })).toBe('no_upstream')
  })

  it('reports local commits ahead of upstream', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 2,
      hasUpstream: true,
    })).toBe('committed_local')
  })

  it('treats a clean main branch with an upstream as closed', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      branch: 'main',
      upstream: 'origin/main',
    })).toBe('clean')
  })

  it('reports open PR before pushed', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      prState: 'OPEN',
    })).toBe('pr_open')
  })

  it('lets explicit local-only and deferred overrides win', () => {
    expect(classifyGitStoryState({
      changedCount: 4,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      override: 'local_only',
    })).toBe('local_only')
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 2,
      hasUpstream: true,
      override: 'deferred',
    })).toBe('deferred')
  })

  it('reports merged when mergeRecord proves landing', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: true,
      mergeRecordResult: 'merged',
    })).toBe('merged')
  })

  it('does not let a stale merge record hide fresh worktree changes', () => {
    expect(classifyGitStoryState({
      changedCount: 1,
      untrackedCount: 4,
      ahead: 0,
      hasUpstream: true,
      mergeRecordResult: 'merged',
    })).toBe('dirty_uncommitted')
  })

  it('does not let a stale merge record hide unpublished branch state', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: false,
      mergeRecordResult: 'merged',
    })).toBe('no_upstream')

    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 1,
      hasUpstream: true,
      mergeRecordResult: 'merged',
    })).toBe('committed_local')
  })

  it('reports merged when a skipped merge record is reconciled from git history', () => {
    expect(classifyGitStoryState({
      changedCount: 0,
      untrackedCount: 0,
      ahead: 0,
      hasUpstream: false,
      mergeRecordResult: 'reconciled',
    })).toBe('merged')
  })
})

describe('inspectGitStory', () => {
  it('summarizes dirty paths from the git driver', async () => {
    const driver = new InMemoryGitDriver()
    driver.setStatusSummary('/repo', {
      branch: 'feature/work',
      upstream: 'origin/feature/work',
      changedCount: 1,
      untrackedCount: 1,
      samplePaths: ['src/a.ts', 'src/b.ts'],
      clean: false,
    })

    const snapshot = await inspectGitStory(driver, { repoRoot: '/repo', inspectPr: false })

    expect(snapshot.state).toBe('dirty_uncommitted')
    expect(snapshot.samplePaths).toEqual(['src/a.ts', 'src/b.ts'])
    expect(snapshot.reason).toContain('2 changed files')
  })

  it('includes local commits when a branch is ahead', async () => {
    const driver = new InMemoryGitDriver()
    driver.setStatusSummary('/repo', {
      branch: 'feature/work',
      upstream: 'origin/feature/work',
      ahead: 2,
    })
    driver.setLocalCommits('/repo', [
      { sha: 'abc123', subject: 'first change' },
      { sha: 'def456', subject: 'second change' },
    ])

    const snapshot = await inspectGitStory(driver, { repoRoot: '/repo', inspectPr: false })

    expect(snapshot.state).toBe('committed_local')
    expect(snapshot.localCommits.map(commit => commit.subject)).toEqual(['first change', 'second change'])
  })

  it('expands home-relative task worktree paths before inspecting git', async () => {
    const driver = new InMemoryGitDriver()
    const expandedWorktree = path.join(homedir(), '.guildhall', 'worktrees', 'demo', 'task-1')
    driver.setStatusSummary(expandedWorktree, {
      branch: 'guildhall/task-1',
      upstream: 'origin/guildhall/task-1',
      changedCount: 0,
      untrackedCount: 0,
      clean: true,
    })

    const snapshot = await inspectGitStory(driver, {
      repoRoot: '/repo',
      inspectPr: false,
      task: {
        id: 'task-1',
        title: 'Use real worktree path',
        worktreePath: '~/.guildhall/worktrees/demo/task-1',
      },
    })

    expect(snapshot.state).toBe('pushed')
    expect(snapshot.inspectedPath).toBe(expandedWorktree)
    expect(snapshot.worktreePath).toBe(expandedWorktree)
  })

  it('marks explicit local-only work as non-blocking', async () => {
    const driver = new InMemoryGitDriver()
    driver.setStatusSummary('/repo', {
      branch: 'feature/work',
      upstream: 'origin/feature/work',
      changedCount: 3,
      clean: false,
    })

    const snapshot = await inspectGitStory(driver, {
      repoRoot: '/repo',
      inspectPr: false,
      task: {
        id: 'task-1',
        title: 'Keep fixture local',
        gitStory: { override: 'local_only', reason: 'Fixture scratchpad only.' },
      },
    })
    const summary = summarizeGitStories([snapshot])

    expect(snapshot.state).toBe('local_only')
    expect(summary.ready).toBe(true)
    expect(summary.blockers).toEqual([])
  })
})

describe('summarizeGitStories', () => {
  it('dedupes task echoes of the same repository follow-up', () => {
    const rootSnapshot = {
      state: 'committed_local' as const,
      repoRoot: '/workspace/story',
      inspectedPath: '/workspace/story',
      branch: 'main',
      ahead: 3,
      behind: 0,
      changedCount: 0,
      untrackedCount: 0,
      samplePaths: [],
      localCommits: ['a', 'b', 'c'],
      reason: 'main has 3 local commits not pushed to origin/main.',
      nextAction: 'Push the branch or open a PR according to this project policy.',
      inspectedAt: '2026-07-07T11:55:00.000Z',
    }
    const summary = summarizeGitStories([
      rootSnapshot,
      {
        ...rootSnapshot,
        taskId: 'task-model',
        taskTitle: 'Select drafting model',
      },
      {
        ...rootSnapshot,
        taskId: 'task-draft',
        taskTitle: 'Generate chapter draft',
      },
    ])

    expect(summary.snapshots).toHaveLength(3)
    expect(summary.blockers).toEqual([
      expect.objectContaining({
        id: 'repo:0',
        label: 'main',
        state: 'committed_local',
        reason: 'main has 3 local commits not pushed to origin/main.',
      }),
    ])
  })

  it('keeps workspace child repo identity on blockers', () => {
    const summary = summarizeGitStories([
      {
        state: 'dirty_uncommitted',
        repoRoot: '/workspace/knit',
        repoId: 'knit',
        repoLabel: 'Knit',
        inspectedPath: '/workspace/knit',
        branch: 'main',
        ahead: 0,
        behind: 0,
        changedCount: 2,
        untrackedCount: 0,
        samplePaths: ['web/app.ts'],
        localCommits: [],
        reason: '2 changed files are not committed.',
        nextAction: 'Review the diff, then commit or mark the work local-only/deferred.',
        inspectedAt: '2026-07-04T18:00:00.000Z',
      },
    ])

    expect(summary.blockers[0]).toMatchObject({
      label: 'Knit: main',
      repoId: 'knit',
      repoLabel: 'Knit',
    })
  })
})

describe('discoverChildGitProjects', () => {
  it('recognizes immediate child git repos under a non-git workspace envelope', async () => {
    const workspacePath = await fs.mkdtemp(path.join(tmpdir(), 'guildhall-child-git-'))
    try {
      await fs.mkdir(path.join(workspacePath, 'looma', '.git'), { recursive: true })
      await fs.mkdir(path.join(workspacePath, 'knit', '.git'), { recursive: true })

      expect(discoverChildGitProjects(workspacePath).map(project => project.id)).toEqual(['knit', 'looma'])
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('does not split a real git repo into child repos', async () => {
    const workspacePath = await fs.mkdtemp(path.join(tmpdir(), 'guildhall-root-git-'))
    try {
      await fs.mkdir(path.join(workspacePath, '.git'), { recursive: true })
      await fs.mkdir(path.join(workspacePath, 'package-a', '.git'), { recursive: true })

      expect(discoverChildGitProjects(workspacePath)).toEqual([])
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true })
    }
  })
})

describe('effectiveGitStoryPolicy', () => {
  it('prefers the matching workspace child project policy for task git closure', () => {
    const policy = effectiveGitStoryPolicy({
      workspacePath: '/workspace',
      workspaceProjectPath: '/workspace',
      workspaceGitStory: {
        completionTarget: 'open_pr',
        commit: 'ask',
        push: 'ask',
        pullRequest: 'ask',
        merge: 'ask',
        localOnlyAllowed: true,
        deferAllowed: true,
        requireCleanRelease: true,
        allowForcePush: false,
        allowSharedBranchRebase: false,
        discoveredFrom: [],
      },
      workspaceProjects: [
        {
          id: 'looma',
          path: '/workspace/looma',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'auto',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
        {
          id: 'knit',
          path: '/workspace/knit',
        },
      ],
      task: {
        domain: 'looma',
        projectPath: '/workspace/looma',
      },
    })

    expect(policy.commit).toBe('auto')
    expect(policy.policyRoot).toBe('/workspace/looma')
    expect(policy.source).toBe('workspace-project')
  })

  it('uses the child project policy when task text names one child repo', () => {
    const policy = effectiveGitStoryPolicy({
      workspacePath: '/workspace',
      workspaceProjectPath: '/workspace',
      workspaceGitStory: {
        completionTarget: 'open_pr',
        commit: 'ask',
        push: 'ask',
        pullRequest: 'ask',
        merge: 'ask',
        localOnlyAllowed: true,
        deferAllowed: true,
        requireCleanRelease: true,
        allowForcePush: false,
        allowSharedBranchRebase: false,
        discoveredFrom: [],
      },
      workspaceProjects: [
        {
          id: 'looma',
          path: '/workspace/looma',
        },
        {
          id: 'knit',
          path: '/workspace/knit',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'auto',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
      ],
      task: {
        projectPath: '/workspace',
        title: 'Integrate AlertDialog into Knit destructive confirmation flow',
      },
    })

    expect(policy.commit).toBe('auto')
    expect(policy.policyRoot).toBe('/workspace/knit')
    expect(policy.source).toBe('workspace-project')
  })

  it('keeps workspace policy when task text names multiple child repos', () => {
    const policy = effectiveGitStoryPolicy({
      workspacePath: '/workspace',
      workspaceProjectPath: '/workspace',
      workspaceGitStory: {
        completionTarget: 'open_pr',
        commit: 'ask',
        push: 'ask',
        pullRequest: 'ask',
        merge: 'ask',
        localOnlyAllowed: true,
        deferAllowed: true,
        requireCleanRelease: true,
        allowForcePush: false,
        allowSharedBranchRebase: false,
        discoveredFrom: [],
      },
      workspaceProjects: [
        {
          id: 'looma',
          path: '/workspace/looma',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'auto',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
        {
          id: 'knit',
          path: '/workspace/knit',
          gitStory: {
            completionTarget: 'open_pr',
            commit: 'auto',
            push: 'ask',
            pullRequest: 'ask',
            merge: 'ask',
            localOnlyAllowed: true,
            deferAllowed: true,
            requireCleanRelease: true,
            allowForcePush: false,
            allowSharedBranchRebase: false,
            discoveredFrom: [],
          },
        },
      ],
      task: {
        title: 'Coordinate Looma and Knit release proof',
      },
    })

    expect(policy.commit).toBe('ask')
    expect(policy.policyRoot).toBe('/workspace')
    expect(policy.source).toBe('workspace')
  })
})
