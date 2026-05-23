---
title: agent-settings.yaml
help_topic: reference.agent_settings
help_summary: |
  The lever-storage file at ./memory/agent-settings.yaml. Records every
  project and domain lever position with provenance. Seeded with system
  defaults on project init.
---

# `./memory/agent-settings.yaml`

The lever-storage file. Seeded by `makeDefaultSettings()` on first read and edited from then on by the Settings tab, the Spec Agent during meta-intake/exploring, or by hand.

During onboarding, meta-intake may infer initial positions from your project-guidance answers. Approved inferences are written here with `setBy: spec-agent-intake`; defaults that were not inferred remain `setBy: system-default`.

Learned behavior is stored separately. `./memory/learning.json` holds
project-scoped learned defaults and suggestions, `./memory/project-skills.json`
holds project skill proposals, and `~/.guildhall/learning.json` holds
user/global preferences. Use Settings → Memory to inspect project memories,
cross-project preferences, project playbooks, and product ideas. Suggested
records stay off until you choose to use them; `./memory/agent-settings.yaml` remains
the explicit lever file.

## Shape

```yaml
project:
  concurrent_task_dispatch:
    position: { kind: serial }
    rationale: "system default"
    setAt: "2026-04-10T10:00:00Z"
    setBy: system-default
  landing_strategy:
    position: cherry_pick_local
    rationale: "system default"
    setAt: "2026-04-10T10:00:00Z"
    setBy: system-default
  # ... all 9 project levers ...

domains:
  default:                      # required fallback
    task_origination:
      position: agent_proposed_coordinator_approved
      rationale: "system default"
      setAt: "2026-04-10T10:00:00Z"
      setBy: system-default
    # ... all 9 domain levers ...

  ui:                           # override for a specific domain
    spec_completeness:
      position: full_upfront
      rationale: "UI domain requires complete acceptance criteria before work starts"
      setAt: "2026-04-10T11:30:00Z"
      setBy: user-direct
```

## Resolution rules

For a given domain, the effective position for each domain lever is read in this order:

1. `domains.<id>.<lever>` if present.
2. `domains.default.<lever>` otherwise.

Project levers have no domain override — there's only `project.<lever>`.

## Editing safely

- Edit by hand or through the browser UI; both are first-class.
- `setAt` and `setBy` must always be updated when `position` changes — the loader will refuse to persist a changed position with a stale setter.
- `rationale` is required. The CLI and browser UI prompt for it; hand-edits must include it.

## See also

- [Levers overview](../levers/) — lever-by-lever pages.
- [Provenance](../levers/provenance) — setter enum.
