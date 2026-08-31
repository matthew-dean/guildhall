---
title: Setup wizard
help_topic: web.setup
help_summary: |
  First-run onboarding at `/setup`. Collects project identity, detects
  installed providers, collects API keys or CLI auth, and optionally kicks
  off the meta-intake agent to draft coordinators.
---

# Setup wizard

The setup wizard appears when a project folder is not ready to run yet. It
collects the minimum project identity and provider information Guildhall needs
before it can create tasks or start work.

## Steps

1. **Identity** — project name and slug. The slug becomes the project id used by
   the browser UI and CLI.
2. **Provider detection** — Guildhall checks the provider paths it knows today:
   Claude OAuth, Codex OAuth, Anthropic-compatible API credentials,
   OpenAI-compatible API credentials, and the configured local
   OpenAI-compatible server path. Detected providers light up; missing ones show
   an inline setup prompt.
3. **Credentials** — for hosted providers, either paste an API key or log in via
   the provider's CLI. API keys land in `~/.guildhall/providers.yaml`, while
   Claude and Codex OAuth stay in their own CLI auth stores. Guildhall's default
   provider and model choices are machine-wide in `~/.guildhall/config.yaml`;
   use a project-local `./.guildhall/config.yaml` override only when one project
   truly needs different behavior. See [Open model recommendations](../guide/open-models)
   for the current tested open-model defaults.
4. **Launch** — choose between "bootstrap via meta-intake" (recommended) or
   "skip to the project shell." Meta-intake drafts coordinators, verified
   bootstrap commands, and suggested lever settings for approval.

## Re-running

`guildhall config` re-opens the wizard on an existing project so you can
reconfigure providers, change models, or rerun meta-intake without losing
state.

If the project is already configured but the task list feels stale, start
re-intake from the project conversation instead. Re-intake keeps setup intact,
re-reads the project evidence, and drafts a cleaner plan for review.
