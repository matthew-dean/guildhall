import { defineConfig } from 'vitepress'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
const currentVersion = pkg.version
const stableVersion = resolveStableVersion(currentVersion)
const currentBase = ''
const stableBase = `/versions/${stableVersion}`
const nextBase = '/next'

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

const guideStartItems = [
  { text: 'Start here', link: '/guide/quick-start' },
  { text: 'How Guildhall works', link: '/guide/how-guildhall-works' },
  { text: 'New project', link: '/guide/new-project' },
  { text: 'Existing project', link: '/guide/existing-project' },
  { text: 'First task set', link: '/guide/first-tasks' },
  { text: 'Many projects', link: '/guide/managing-projects' },
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
  { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
]

const guideSpecItems = [
  { text: 'Onboarding and levers', link: '/guide/onboarding-and-levers' },
  { text: 'Internal routing', link: '/guide/coordinators' },
  { text: 'Agents & models', link: '/guide/agents-and-models' },
  { text: 'Open model recommendations', link: '/guide/open-models' },
]

const guideConceptItems = [
  { text: 'Introduction', link: '/guide/introduction' },
  { text: 'Core concepts', link: '/guide/concepts' },
  { text: 'How Guildhall builds', link: '/guide/how-guildhall-builds' },
]

const guideSidebarSections = [
  {
    text: 'Guide',
    items: [{ text: 'Overview', link: '/guide/' }],
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
  {
    text: 'Concepts',
    items: guideConceptItems,
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

const getStartedSidebarSections = [
  {
    text: 'Get started',
    items: guideStartItems,
  },
]

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
  items: section.items.filter((item) => item.link !== '/releases/0.7.0'),
}))

function addVersionedSidebars(
  prefix: string,
  options: { includeStarted?: boolean; includeNextOnlyPages?: boolean } = {},
): Record<string, SidebarSection[]> {
  const includeStarted = options.includeStarted ?? true
  const guideSections = options.includeNextOnlyPages ? guideSidebarSections : stableGuideSidebarSections
  const releaseSections = options.includeNextOnlyPages ? releaseSidebarSections : stableReleaseSidebarSections
  const sidebars: Record<string, SidebarSection[]> = {
    [`${prefix}/guide/`]: prefixSections(guideSections, prefix),
    [`${prefix}/cli/`]: prefixSections(referenceSidebarSections, prefix),
    [`${prefix}/web-ui/`]: prefixSections(referenceSidebarSections, prefix),
    [`${prefix}/reference/`]: prefixSections(referenceSidebarSections, prefix),
    [`${prefix}/levers/`]: prefixSections(leverSidebarSections, prefix),
    [`${prefix}/releases/`]: prefixSections(releaseSections, prefix),
  }
  if (includeStarted) {
    for (const path of [
      '/guide/quick-start',
      '/guide/how-guildhall-works',
      '/guide/new-project',
      '/guide/existing-project',
      '/guide/first-tasks',
      '/guide/managing-projects',
    ]) {
      sidebars[`${prefix}${path}`] = prefixSections(getStartedSidebarSections, prefix)
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
      { text: 'Get started', link: '/guide/quick-start', activeMatch: '^(/next)?/guide/(quick-start|how-guildhall-builds|new-project|existing-project|first-tasks|managing-projects)' },
      { text: 'Guide', link: '/guide/', activeMatch: '^(/next)?/guide/(?!(quick-start|how-guildhall-builds|new-project|existing-project|first-tasks|managing-projects))' },
      { text: 'Reference', link: '/reference/', activeMatch: '^(/next)?/(reference|cli|web-ui|levers|releases)/' },
      {
        text: 'Version',
        items: [
          { text: `Current (v${stableVersion})`, link: '/guide/quick-start' },
          { text: 'Next', link: `${nextBase}/guide/` },
          { text: `Version archive v${stableVersion}`, link: `${stableBase}/guide/quick-start` },
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
