import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Guildhall',
  description: 'Local service for unattended software work with visible state, reviewer guardrails, and inspectable transcripts.',
  cleanUrls: true,
  lastUpdated: true,
  base: '/guildhall/',
  head: [
    ['link', { rel: 'icon', href: '/guildhall/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#141418' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Start', link: '/guide/quick-start' },
      { text: 'Dashboard', link: '/guide/dashboard' },
      { text: 'Web UI', link: '/web-ui/' },
      { text: 'CLI', link: '/cli/' },
      { text: 'Reference', link: '/reference/' },
      {
        text: 'More',
        items: [
          { text: 'Guide', link: '/guide/introduction' },
          { text: 'Levers', link: '/levers/' },
          { text: 'Subsystems', link: '/subsystems/' },
          { text: 'Design notes', link: '/design/' },
          { text: 'Releases', link: '/releases/' },
          { text: 'guildhall.yaml', link: '/reference/workspace-config' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [
            { text: 'Quick start', link: '/guide/quick-start' },
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'The dashboard', link: '/guide/dashboard' },
            { text: 'Onboarding and levers', link: '/guide/onboarding-and-levers' },
            { text: 'Setup wizard', link: '/web-ui/setup' },
            { text: 'Project view', link: '/web-ui/project-view' },
            { text: 'Task drawer', link: '/web-ui/task-drawer' },
            { text: 'Core concepts', link: '/guide/concepts' },
            { text: 'Task lifecycle', link: '/guide/task-lifecycle' },
          ],
        },
        {
          text: 'Working with Guildhall',
          items: [
            { text: 'Project files & workspace state', link: '/guide/workspaces' },
            { text: 'Coordinators & domains', link: '/guide/coordinators' },
            { text: 'Agents & models', link: '/guide/agents-and-models' },
            { text: 'Running the orchestrator', link: '/guide/running' },
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
      '/cli/': [
        {
          text: 'CLI',
          items: [
            { text: 'Overview', link: '/cli/' },
            { text: 'Command reference', link: '/cli/reference' },
          ],
        },
      ],
      '/web-ui/': [
        {
          text: 'Dashboard UI',
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
            { text: 'CLI', link: '/cli/reference' },
            { text: 'guildhall.yaml', link: '/reference/workspace-config' },
            { text: 'agent-settings.yaml', link: '/reference/agent-settings' },
            { text: 'Environment variables', link: '/reference/env' },
            { text: 'Memory layout', link: '/reference/memory-layout' },
            { text: 'Web server routes', link: '/reference/http-api' },
          ],
        },
      ],
      '/releases/': [
        {
          text: 'Releases',
          items: [
            { text: 'Overview', link: '/releases/' },
            { text: '0.5.0', link: '/releases/0.5.0' },
            { text: '0.4.0', link: '/releases/0.4.0' },
          ],
        },
      ],
      '/design/': [
        {
          text: 'Design notes',
          items: [
            { text: 'Disagreement & handoff', link: '/design/disagreement-and-handoff' },
            { text: 'UI structural audit', link: '/design/ui-audit' },
            { text: 'Symphony comparison', link: '/design/symphony-comparison' },
            { text: 'Beads and one-task pivot', link: '/design/beads-and-one-task-pivot' },
            { text: 'Provider abstraction and throughput', link: '/design/provider-abstraction-and-throughput' },
            { text: 'Node vs Deno packaging for 0.5.0', link: '/design/deno-vs-node-packaging' },
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
