import { defineConfig } from 'vitepress'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
const currentVersion = pkg.version
const stableVersion = resolveStableVersion(currentVersion)
const nextVersion = resolveNextMinorVersion(stableVersion)
const currentBase = ''
const stableBase = `/versions/${stableVersion}`
const nextBase = '/next'
const archiveVersionItems = listVersionDirs()
  .filter((version) => version !== stableVersion)
  .map((version) => ({ text: `v${version}`, link: `/versions/${version}/guide/quick-start` }))

type SidebarSection = {
  text: string
  items: Array<{ text: string; link: string }>
}

function prefixSections(sections: SidebarSection[], prefix: string): SidebarSection[] {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => ({
      ...item,
      link: item.link.startsWith('/') ? `${prefix}${item.link}` : item.link,
    })),
  }))
}

function git(args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return result.status === 0 ? result.stdout.trim() : ''
}

function resolveStableVersion(version: string): string {
  if (existsSync(new URL(`../versions/${version}`, import.meta.url))) return version
  if (git(['rev-parse', '--verify', '--quiet', `v${version}`])) return version
  const versionDir = new URL('../versions', import.meta.url)
  if (existsSync(versionDir)) {
    const latestDir = readdirSync(versionDir)
      .filter((name) => /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      [0]
    if (latestDir) return latestDir
  }
  const latest = git(['tag', '--sort=-version:refname'])
    .split(/\r?\n/)
    .find((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
  return latest ? latest.slice(1) : version
}

function resolveNextMinorVersion(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(-[\w.]+)?$/)
  if (!match) return 'Next'
  const major = Number(match[1])
  const minor = Number(match[2])
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return 'Next'
  return `${major}.${minor + 1}.0`
}

function listVersionDirs(): string[] {
  const versionDir = new URL('../versions', import.meta.url)
  if (!existsSync(versionDir)) return []
  return readdirSync(versionDir)
    .filter((name) => /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(name))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
}

const guideStartItems = [
  { text: 'What Guildhall is', link: '/guide/introduction' },
  { text: 'Start here', link: '/guide/quick-start' },
  { text: 'How Guildhall works', link: '/guide/how-guildhall-works' },
  { text: 'New project', link: '/guide/new-project' },
  { text: 'Existing project', link: '/guide/existing-project' },
  { text: 'First task set', link: '/guide/first-tasks' },
  { text: 'Many projects', link: '/guide/managing-projects' },
  { text: 'Core concepts', link: '/guide/concepts' },
]

const guideWorksItems = [
  { text: 'How Guildhall works', link: '/guide/how-guildhall-works' },
  { text: 'How Guildhall builds', link: '/guide/how-guildhall-builds' },
  { text: 'Agent context', link: '/guide/agent-context' },
  { text: 'Corpus Map', link: '/guide/corpus-map' },
  { text: 'Memory, learning, and recovery', link: '/guide/memory-and-recovery' },
]

const guideOperateItems = [
  { text: 'Projects and work', link: '/guide/dashboard' },
  { text: 'Project files & state', link: '/guide/workspaces' },
  { text: 'Running Guildhall', link: '/guide/running' },
  { text: 'App reference ↗', link: '/web-ui/' },
]

const guideTaskItems = [
  { text: 'Pressure-Test Intake', link: '/guide/pressure-test-intake' },
  { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
  { text: 'Git Story Closure', link: '/guide/git-story-closure' },
]

const guideSpecItems = [
  { text: 'Onboarding and levers', link: '/guide/onboarding-and-levers' },
  { text: 'Internal routing', link: '/guide/coordinators' },
  { text: 'Agents & models', link: '/guide/agents-and-models' },
  { text: 'Open model recommendations', link: '/guide/open-models' },
]

const guideSidebarSections = [
  {
    text: 'Guide',
    items: [{ text: 'Overview', link: '/guide/' }],
  },
  {
    text: 'First read',
    items: guideStartItems,
  },
  {
    text: 'Projects',
    items: guideOperateItems,
  },
  {
    text: 'How it works',
    items: guideWorksItems,
  },
  {
    text: 'Tasks',
    items: guideTaskItems,
  },
  {
    text: 'Specs & policy',
    items: guideSpecItems,
  },
]

const guide060SidebarSections = [
  {
    text: 'Guide',
    items: [{ text: 'Overview', link: '/guide/' }],
  },
  {
    text: 'Projects',
    items: guideOperateItems,
  },
  {
    text: 'Tasks',
    items: [
      { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
      { text: 'Memory and recovery', link: '/guide/memory-and-recovery' },
    ],
  },
  {
    text: 'Specs & policy',
    items: [
      { text: 'Onboarding and levers', link: '/guide/onboarding-and-levers' },
      { text: 'Internal routing', link: '/guide/coordinators' },
      { text: 'Agents & models', link: '/guide/agents-and-models' },
    ],
  },
  {
    text: 'Concepts',
    items: [
      { text: 'Introduction', link: '/guide/introduction' },
      { text: 'How Guildhall builds', link: '/guide/how-guildhall-builds' },
      { text: 'Core concepts', link: '/guide/concepts' },
    ],
  },
]

const stableGuideSidebarSections = guideSidebarSections.map((section) => section.text === 'Specs & policy'
  ? {
      ...section,
      items: section.items.filter((item) => item.link !== '/guide/open-models'),
    }
  : section.text === 'How it works'
    ? {
        ...section,
        items: section.items.filter((item) =>
          item.link !== '/guide/how-guildhall-works' &&
          item.link !== '/guide/agent-context' &&
          item.link !== '/guide/corpus-map'),
      }
  : section)

const referenceSidebarSections = [
  {
    text: 'Guildhall app',
    items: [
      { text: 'Overview', link: '/web-ui/' },
      { text: 'Projects home', link: '/web-ui/dashboard' },
      { text: 'Setup wizard', link: '/web-ui/setup' },
      { text: 'Project shell', link: '/web-ui/project-view' },
      { text: 'Task drawer', link: '/web-ui/task-drawer' },
      { text: 'Providers', link: '/web-ui/providers' },
    ],
  },
  {
    text: 'Command line',
    items: [
      { text: 'CLI overview', link: '/cli/' },
      { text: 'Command reference', link: '/cli/reference' },
    ],
  },
  {
    text: 'Project state',
    items: [
      { text: 'guildhall.yaml', link: '/reference/workspace-config' },
      { text: 'agent-settings.yaml', link: '/reference/agent-settings' },
      { text: 'Environment variables', link: '/reference/env' },
      { text: 'Memory layout', link: '/reference/memory-layout' },
    ],
  },
  {
    text: 'System reference',
    items: [
      { text: 'Levers ↗', link: '/levers/' },
      { text: 'Releases ↗', link: '/releases/' },
    ],
  },
]

const reference060SidebarSections = [
  {
    text: 'Guildhall app',
    items: [
      { text: 'Overview', link: '/web-ui/' },
      { text: 'Dashboard', link: '/web-ui/dashboard' },
      { text: 'Setup wizard', link: '/web-ui/setup' },
      { text: 'Project view', link: '/web-ui/project-view' },
      { text: 'Task drawer', link: '/web-ui/task-drawer' },
      { text: 'Providers', link: '/web-ui/providers' },
    ],
  },
  {
    text: 'Command line',
    items: [
      { text: 'CLI overview', link: '/cli/' },
      { text: 'Command reference', link: '/cli/reference' },
    ],
  },
  {
    text: 'Project state',
    items: [
      { text: 'guildhall.yaml', link: '/reference/workspace-config' },
      { text: 'agent-settings.yaml', link: '/reference/agent-settings' },
      { text: 'Environment variables', link: '/reference/env' },
      { text: 'Memory layout', link: '/reference/memory-layout' },
      { text: 'HTTP API', link: '/reference/http-api' },
    ],
  },
  {
    text: 'System reference',
    items: [
      { text: 'Levers ↗', link: '/levers/' },
      { text: 'Subsystems ↗', link: '/subsystems/' },
      { text: 'Releases ↗', link: '/releases/' },
    ],
  },
]

const subsystem060SidebarSections = [
  {
    text: 'Subsystems',
    items: [
      { text: 'Overview', link: '/subsystems/' },
      { text: 'Agents', link: '/subsystems/agents' },
      { text: 'Backend host', link: '/subsystems/backend-host' },
      { text: 'Compaction', link: '/subsystems/compaction' },
      { text: 'Config loader', link: '/subsystems/config' },
      { text: 'Core', link: '/subsystems/core' },
      { text: 'Engine', link: '/subsystems/engine' },
      { text: 'Engineering defaults', link: '/subsystems/engineering-defaults' },
      { text: 'Guilds', link: '/subsystems/guilds' },
      { text: 'Hooks', link: '/subsystems/hooks' },
      { text: 'Levers', link: '/subsystems/levers' },
      { text: 'MCP', link: '/subsystems/mcp' },
      { text: 'Protocol', link: '/subsystems/protocol' },
      { text: 'Providers', link: '/subsystems/providers' },
      { text: 'Runtime bundle', link: '/subsystems/runtime-bundle' },
      { text: 'Runtime', link: '/subsystems/runtime' },
      { text: 'Sessions', link: '/subsystems/sessions' },
      { text: 'Skills', link: '/subsystems/skills' },
      { text: 'Tools', link: '/subsystems/tools' },
    ],
  },
]

const leverSidebarSections = [
  {
    text: 'Levers',
    items: [
      { text: 'How levers work', link: '/levers/' },
      { text: 'Provenance', link: '/levers/provenance' },
    ],
  },
  {
    text: 'Project levers',
    items: [
      { text: 'concurrent_task_dispatch', link: '/levers/concurrent-task-dispatch' },
      { text: 'worktree_isolation', link: '/levers/worktree-isolation' },
      { text: 'merge_policy', link: '/levers/merge-policy' },
      { text: 'rejection_dampening', link: '/levers/rejection-dampening' },
      { text: 'business_envelope_strictness', link: '/levers/business-envelope-strictness' },
      { text: 'agent_health_strictness', link: '/levers/agent-health-strictness' },
      { text: 'remediation_autonomy', link: '/levers/remediation-autonomy' },
      { text: 'runtime_isolation', link: '/levers/runtime-isolation' },
      { text: 'workspace_import_autonomy', link: '/levers/workspace-import-autonomy' },
    ],
  },
  {
    text: 'Domain levers',
    items: [
      { text: 'task_origination', link: '/levers/task-origination' },
      { text: 'spec_completeness', link: '/levers/spec-completeness' },
      { text: 'pre_rejection_policy', link: '/levers/pre-rejection-policy' },
      { text: 'completion_approval', link: '/levers/completion-approval' },
      { text: 'reviewer_mode', link: '/levers/reviewer-mode' },
      { text: 'reviewer_fanout_policy', link: '/levers/reviewer-fanout-policy' },
      { text: 'max_revisions', link: '/levers/max-revisions' },
      { text: 'escalation_on_ambiguity', link: '/levers/escalation-on-ambiguity' },
      { text: 'crash_recovery_default', link: '/levers/crash-recovery-default' },
    ],
  },
]

const releaseSidebarSections = [
  {
    text: 'Releases',
    items: [
      { text: 'Overview', link: '/releases/' },
      { text: '0.8.0', link: '/releases/0.8.0' },
      { text: '0.7.0', link: '/releases/0.7.0' },
      { text: '0.6.0', link: '/releases/0.6.0' },
      { text: '0.5.1', link: '/releases/0.5.1' },
      { text: '0.5.0', link: '/releases/0.5.0' },
      { text: '0.4.0', link: '/releases/0.4.0' },
    ],
  },
]

const stableReleaseSidebarSections = releaseSidebarSections.map((section) => ({
  ...section,
  items: section.items.filter((item) => item.link !== '/releases/0.8.0' && item.link !== '/releases/0.7.0'),
}))

function guideSectionsForVersion(prefix: string, options: { includeNextOnlyPages?: boolean } = {}): SidebarSection[] {
  if (options.includeNextOnlyPages) return guideSidebarSections
  if (prefix === '' && stableVersion === '0.6.0') return guide060SidebarSections
  if (prefix === '/versions/0.6.0') return guide060SidebarSections
  return stableGuideSidebarSections
}

function referenceSectionsForVersion(prefix: string, options: { includeNextOnlyPages?: boolean } = {}): SidebarSection[] {
  if (options.includeNextOnlyPages) return referenceSidebarSections
  if (prefix === '' && stableVersion === '0.6.0') return reference060SidebarSections
  if (prefix === '/versions/0.6.0') return reference060SidebarSections
  return referenceSidebarSections
}

function subsystemSectionsForVersion(prefix: string, options: { includeNextOnlyPages?: boolean } = {}): SidebarSection[] | null {
  if (options.includeNextOnlyPages) return null
  if (prefix === '' && stableVersion === '0.6.0') return subsystem060SidebarSections
  if (prefix === '/versions/0.6.0') return subsystem060SidebarSections
  return null
}

function addVersionedSidebars(
  prefix: string,
  options: { includeStarted?: boolean; includeNextOnlyPages?: boolean } = {},
): Record<string, SidebarSection[]> {
  const includeStarted = options.includeStarted ?? true
  const guideSections = guideSectionsForVersion(prefix, options)
  const referenceSections = referenceSectionsForVersion(prefix, options)
  const subsystemSections = subsystemSectionsForVersion(prefix, options)
  const releaseSections = options.includeNextOnlyPages ? releaseSidebarSections : stableReleaseSidebarSections
  const sidebars: Record<string, SidebarSection[]> = {
    [`${prefix}/guide/`]: prefixSections(guideSections, prefix),
    [`${prefix}/cli/`]: prefixSections(referenceSections, prefix),
    [`${prefix}/web-ui/`]: prefixSections(referenceSections, prefix),
    [`${prefix}/reference/`]: prefixSections(referenceSections, prefix),
    [`${prefix}/levers/`]: prefixSections(leverSidebarSections, prefix),
    [`${prefix}/releases/`]: prefixSections(releaseSections, prefix),
  }
  if (subsystemSections) {
    sidebars[`${prefix}/subsystems/`] = prefixSections(subsystemSections, prefix)
  }
  if (includeStarted) {
    for (const path of [
      '/guide/introduction',
      '/guide/concepts',
      '/guide/quick-start',
      '/guide/how-guildhall-works',
      '/guide/new-project',
      '/guide/existing-project',
      '/guide/first-tasks',
      '/guide/managing-projects',
    ]) {
      sidebars[`${prefix}${path}`] = prefixSections(guideSections, prefix)
    }
  }
  return sidebars
}

export default defineConfig({
  title: 'Guildhall',
  description: 'Local service for unattended software work with visible state, reviewer guardrails, and inspectable transcripts.',
  cleanUrls: true,
  lastUpdated: true,
  base: '/guildhall/',
  ignoreDeadLinks: [
    // VitePress normalizes `/next/guide/` to this internal target during
    // dead-link checks even though `docs/next/guide/index.md` exists.
    /^\/next\/guide\/index$/,
  ],
  rewrites(id) {
    return id.startsWith('current/') ? id.slice('current/'.length) : id
  },
  srcExclude: [
    'cli/**',
    'design/**',
    'guide/**',
    'levers/**',
    'reference/**',
    'releases/**',
    'superpowers/**',
    'subsystems/**',
    'web-ui/**',
  ],
  transformHead({ page }) {
    if (page.startsWith('versions/')) {
      return [['meta', { name: 'robots', content: 'noindex,follow' }]]
    }
  },
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', href: '/guildhall/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#141418' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Get started', link: '/guide/introduction', activeMatch: '^(/next)?/guide/(introduction|concepts|quick-start|how-guildhall-works|new-project|existing-project|first-tasks|managing-projects)' },
      { text: 'Guide', link: '/guide/', activeMatch: '^(/next)?/guide/(?!(introduction|concepts|quick-start|how-guildhall-works|new-project|existing-project|first-tasks|managing-projects))' },
      { text: 'Reference', link: '/reference/', activeMatch: '^(/next)?/(reference|cli|web-ui|levers|releases)/' },
      {
        text: 'Version',
        items: [
          { text: `Current (v${stableVersion})`, link: '/guide/introduction' },
          { text: `Next (v${nextVersion})`, link: `${nextBase}/guide/` },
          ...archiveVersionItems,
        ],
      },
    ],
    sidebar: {
      ...addVersionedSidebars(currentBase),
      ...addVersionedSidebars(stableBase),
      ...addVersionedSidebars(nextBase, { includeNextOnlyPages: true }),
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/matthew-dean/guildhall' }],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the FLL-1.2 License.',
      copyright: 'Copyright © 2026 Guildhall contributors',
    },
    editLink: {
      pattern: 'https://github.com/matthew-dean/guildhall/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
