---
title: Setup wizard
help_topic: web.setup
help_summary: |
  First-run onboarding at http://localhost:7842/setup. Collects workspace
  identity, detects installed providers, collects API keys or CLI auth,
  and optionally kicks off the meta-intake agent to draft coordinators.
---

# Setup wizard

Lives at `/setup` and is rendered by `src/web/surfaces/SetupWizard.svelte`.

## Steps

1. **Identity** — workspace name and slug. The slug becomes the workspace id used by `guildhall run <slug>`.
2. **Provider detection** — `POST /api/setup/providers` scans for authenticated CLIs plus configured OpenAI-compatible and Anthropic-compatible providers. Detected providers light up; undetected ones show an inline configuration prompt.
3. **Credentials** — for hosted providers, either paste an API key or log in via the provider's CLI. Machine-scoped credentials land in `~/.guildhall/providers.yaml`; the project only stores its preferred provider in `.guildhall/config.yaml`.
4. **Launch** — choose between "bootstrap via meta-intake" (recommended) or "skip to dashboard."

## Re-running

`guildhall config` re-opens the wizard on an existing workspace so you can reconfigure providers, change models, or rerun meta-intake without losing state.
