import { defineConfig } from 'vitepress'

const guideStartItems = [
  { text: 'Start here', link: '/guide/quick-start' },
  { text: 'How Guildhall builds', link: '/guide/how-guildhall-builds' },
  { text: 'New project', link: '/guide/new-project' },
  { text: 'Existing project', link: '/guide/existing-project' },
  { text: 'First task set', link: '/guide/first-tasks' },
  { text: 'Many projects', link: '/guide/managing-projects' },
]

const guideOperateItems = [
  { text: 'Projects and work', link: '/guide/dashboard' },
  { text: 'Project files & state', link: '/guide/workspaces' },
  { text: 'Running Guildhall', link: '/guide/running' },
  { text: 'App reference ↗', link: '/web-ui/' },
]

const guideTaskItems = [
  { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
  { text: 'Memory and recovery', link: '/guide/memory-and-recovery' },
]

const guideSpecItems = [
  { text: 'Onboarding and levers', link: '/guide/onboarding-and-levers' },
  { text: 'Internal routing', link: '/guide/coordinators' },
  { text: 'Agents & models', link: '/guide/agents-and-models' },
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
    text: 'Implementation reference',
    items: [
      { text: 'Design tokens', link: '/web-ui/design-tokens' },
      { text: 'In-UI help', link: '/web-ui/help-system' },
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
      { text: 'Web server routes', link: '/reference/http-api' },
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

export default defineConfig({
  title: 'Guildhall',
  description: 'Local service for unattended software work with visible state, reviewer guardrails, and inspectable transcripts.',
  cleanUrls: true,
  lastUpdated: true,
  base: '/guildhall/',
  srcExclude: ['design/**', 'superpowers/**', 'web-ui/flow-audit.md'],
  appearance: 'dark',
  head: [
    ['link', { rel: 'icon', href: '/guildhall/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#141418' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Get started', link: '/guide/quick-start', activeMatch: '^/guide/(quick-start|how-guildhall-builds|new-project|existing-project|first-tasks|managing-projects)' },
      { text: 'Guide', link: '/guide/', activeMatch: '^/guide/(?!(quick-start|how-guildhall-builds|new-project|existing-project|first-tasks|managing-projects))' },
      { text: 'Reference', link: '/reference/', activeMatch: '^/(reference|cli|web-ui|levers|subsystems|releases)/' },
    ],
    sidebar: {
      '/guide/quick-start': getStartedSidebarSections,
      '/guide/how-guildhall-builds': getStartedSidebarSections,
      '/guide/new-project': getStartedSidebarSections,
      '/guide/existing-project': getStartedSidebarSections,
      '/guide/first-tasks': getStartedSidebarSections,
      '/guide/managing-projects': getStartedSidebarSections,
      '/guide/': guideSidebarSections,
      '/subsystems/': [
        {
          text: 'Subsystems',
          items: [{ text: 'Architecture', link: '/subsystems/' }],
        },
        {
          text: 'Orchestration',
          items: [
            { text: 'Runtime', link: '/subsystems/runtime' },
            { text: 'Runtime bundle', link: '/subsystems/runtime-bundle' },
            { text: 'Engine', link: '/subsystems/engine' },
            { text: 'Core', link: '/subsystems/core' },
            { text: 'Sessions', link: '/subsystems/sessions' },
            { text: 'Compaction', link: '/subsystems/compaction' },
          ],
        },
        {
          text: 'Policy & personas',
          items: [
            { text: 'Levers', link: '/subsystems/levers' },
            { text: 'Guilds', link: '/subsystems/guilds' },
            { text: 'Agents', link: '/subsystems/agents' },
            { text: 'Engineering defaults', link: '/subsystems/engineering-defaults' },
            { text: 'Skills', link: '/subsystems/skills' },
          ],
        },
        {
          text: 'Integrations',
          items: [
            { text: 'Providers', link: '/subsystems/providers' },
            { text: 'MCP', link: '/subsystems/mcp' },
            { text: 'Hooks', link: '/subsystems/hooks' },
            { text: 'Tools', link: '/subsystems/tools' },
          ],
        },
        {
          text: 'Wire & config',
          items: [
            { text: 'Protocol', link: '/subsystems/protocol' },
            { text: 'Backend host', link: '/subsystems/backend-host' },
            { text: 'Config loader', link: '/subsystems/config' },
          ],
        },
      ],
      '/levers/': [
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
      ],
      '/cli/': referenceSidebarSections,
      '/web-ui/': referenceSidebarSections,
      '/reference/': referenceSidebarSections,
      '/releases/': [
        {
          text: 'Releases',
          items: [
            { text: 'Overview', link: '/releases/' },
            { text: '0.6.0', link: '/releases/0.6.0' },
            { text: '0.5.1', link: '/releases/0.5.1' },
            { text: '0.5.0', link: '/releases/0.5.0' },
            { text: '0.4.0', link: '/releases/0.4.0' },
          ],
        },
      ],
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
