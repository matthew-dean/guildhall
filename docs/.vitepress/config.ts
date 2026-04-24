import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'GuildHall',
  description: 'A multi-agent operating system for software projects.',
  cleanUrls: true,
  lastUpdated: true,
  base: '/guildhall/',
  head: [
    ['link', { rel: 'icon', href: '/guildhall/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#7c6df0' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Subsystems', link: '/subsystems/' },
      { text: 'Levers', link: '/levers/' },
      { text: 'Web UI', link: '/web-ui/' },
      {
        text: 'Resources',
        items: [
          { text: 'CLI Reference', link: '/reference/cli' },
          { text: 'guildhall.yaml', link: '/reference/workspace-config' },
          { text: 'Environment variables', link: '/reference/env' },
          { text: 'Design notes', link: '/design/disagreement-and-handoff' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Quick start', link: '/guide/quick-start' },
            { text: 'Core concepts', link: '/guide/concepts' },
            { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
          ],
        },
        {
          text: 'Working with GuildHall',
          items: [
            { text: 'Workspaces', link: '/guide/workspaces' },
            { text: 'Coordinators & domains', link: '/guide/coordinators' },
            { text: 'Agents & models', link: '/guide/agents-and-models' },
            { text: 'Running the orchestrator', link: '/guide/running' },
            { text: 'The dashboard', link: '/guide/dashboard' },
          ],
        },
      ],
      '/subsystems/': [
        {
          text: 'Overview',
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
          text: 'Lever reference',
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
      '/web-ui/': [
        {
          text: 'Web UI',
          items: [
            { text: 'Overview', link: '/web-ui/' },
            { text: 'Setup wizard', link: '/web-ui/setup' },
            { text: 'Dashboard', link: '/web-ui/dashboard' },
            { text: 'Project view', link: '/web-ui/project-view' },
            { text: 'Task drawer', link: '/web-ui/task-drawer' },
            { text: 'Providers page', link: '/web-ui/providers' },
            { text: 'Design tokens', link: '/web-ui/design-tokens' },
            { text: 'In-UI help system', link: '/web-ui/help-system' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI', link: '/reference/cli' },
            { text: 'guildhall.yaml', link: '/reference/workspace-config' },
            { text: 'agent-settings.yaml', link: '/reference/agent-settings' },
            { text: 'Environment variables', link: '/reference/env' },
            { text: 'Memory layout', link: '/reference/memory-layout' },
            { text: 'Web server routes', link: '/reference/http-api' },
          ],
        },
      ],
      '/design/': [
        {
          text: 'Design notes',
          items: [
            { text: 'Disagreement & handoff', link: '/design/disagreement-and-handoff' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/anthropics/guildhall' }],
    search: { provider: 'local' },
    footer: {
      message: 'Released under the FLL-1.2 License.',
      copyright: 'Copyright © 2026 GuildHall contributors',
    },
    editLink: {
      pattern: 'https://github.com/anthropics/guildhall/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
