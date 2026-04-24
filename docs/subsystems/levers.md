---
title: Levers
help_topic: subsystem.levers
help_summary: |
  Every behavioral knob in GuildHall is a named "lever" with enumerated
  positions, persisted in memory/agent-settings.yaml with who-set-it, when,
  and why. No hidden defaults.
---

# Levers

The lever system is GuildHall's policy surface. Instead of scattered hardcoded defaults, every behavioral knob is a named decision point with an enumerated set of positions and full provenance.

**Source:** `src/levers/`
**Storage:** `memory/agent-settings.yaml`
**Reference:** full list of levers in [Levers reference](../levers/).

## Schema

Every lever entry has the same shape:

```yaml
merge_policy:
  position: ff_only_with_push
  rationale: "Team wants auto-push on green main so CI runs on origin"
  setAt: "2026-04-10T11:02:00Z"
  setBy: user-direct
```

- `position` — the actual value. Some levers are simple enums (`serial`, `fanout_4`), others are discriminated unions (`{ kind: "fanout", n: 4 }`).
- `rationale` — free text. Required; explains *why* this position was chosen.
- `setAt` — ISO 8601 timestamp.
- `setBy` — `system-default`, `spec-agent-intake`, `user-direct`, or `coordinator:<name>`.

## Scope

There are two scopes:

- **Project levers** — singleton per workspace. See [project levers](../levers/#project-levers).
- **Domain levers** — per coordinator domain, with a `default` entry as fallback. See [domain levers](../levers/#domain-levers).

## Public API

```ts
import {
  makeDefaultSettings,
  readAgentSettings,
  writeAgentSettings,
  type LeverSettings,
  type ProjectLevers,
  type DomainLevers,
  type LeverSetter,
} from 'guildhall/levers'
```

- `makeDefaultSettings()` — seeds a new workspace with system defaults.
- `readAgentSettings(cwd)` — validated load from disk.
- `writeAgentSettings(cwd, settings)` — atomic write; preserves YAML comments.

## Related

- Each lever has a dedicated docs page under [Levers](../levers/) with positions, effects, and examples.
- The dashboard Settings tab exposes every lever with a `?` icon that links back here.
