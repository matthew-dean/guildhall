---
title: agent-settings.yaml
help_topic: reference.agent_settings
help_summary: |
  The lever-storage file at memory/agent-settings.yaml. Records every
  project and domain lever position with provenance. Seeded with system
  defaults on workspace init.
---

# `memory/agent-settings.yaml`

The lever-storage file. Seeded by `makeDefaultSettings()` on workspace init and edited from then on by the Setup wizard, the Settings tab, the Spec Agent during `exploring`, or by hand.

## Shape

```yaml
project:
  concurrent_task_dispatch:
    position: { kind: serial }
    rationale: "system default"
    setAt: "2026-04-10T10:00:00Z"
    setBy: system-default
  merge_policy:
    position: ff_only_local
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

- Edit by hand or through the dashboard; both are first-class.
- `setAt` and `setBy` must always be updated when `position` changes — the loader will refuse to persist a changed position with a stale setter.
- `rationale` is required. The CLI and dashboard prompt for it; hand-edits must include it.

## See also

- [Levers overview](../levers/) — lever-by-lever pages.
- [Provenance](../levers/provenance) — setter enum.
