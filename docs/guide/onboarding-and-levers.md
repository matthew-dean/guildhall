---
title: Onboarding and levers
---

# Onboarding and levers

Guildhall does not ask you to fill out a wall of behavior toggles before it can
work. The browser UI starts with a small setup wizard, then the
**meta-intake** agent learns enough about the project to propose both the
work routing and the first behavior settings.

Those settings are called **levers**. They decide things like how much
autonomy Guildhall has, how strict reviews are, when you approve completion,
whether work can fan out into multiple worktrees, and how aggressively the
runtime recovers from problems.

## The first-run flow

1. **Setup wizard** creates the project shell: `guildhall.yaml`, local `.guildhall/` state, provider selection, and the initial route into the project shell.
2. **Meta-intake** asks focused project questions: what the major areas are, what each area owns, what needs your approval, and how cautious the project needs to be.
3. **The Spec Agent drafts settings** for coordinators and inferred levers. You
   answer in normal language; Guildhall turns that into settings.
4. **You approve the draft** from the browser UI or CLI.
5. **Guildhall writes the result**: routing/coordinator structure and bootstrap commands go into `guildhall.yaml`; inferred levers go into `memory/agent-settings.yaml` with provenance.

After that, the Settings area shows the current lever positions. You can
change them later, but the first pass feels like onboarding into a project, not
configuring a cockpit.

## What the agent infers

The meta-intake prompt tells the Spec Agent to listen for project signals and infer only the levers it has evidence for. Examples:

| Project signal | Likely lever inference |
|---|---|
| “This ships to paying customers” or “compliance matters” | stricter `business_envelope_strictness`, often more completion approval |
| “Prototype, move fast, try things” | more autonomy for task origination or remediation |
| “CI is the source of truth before merge” | `completion_approval` can move toward `gates_sufficient` once gates exist |
| “Small solo project, keep friction low” | coordinator approval may be enough for more routine work |
| “Cost/local model constraints matter” | reviewer mode may stay conservative or prefer deterministic fallback |

If Guildhall cannot infer a lever with confidence, it leaves the system default
alone. Defaults are still written with provenance, so even "unchanged" behavior
is inspectable later.

## Where the settings land

`memory/agent-settings.yaml` is the lever source of truth. Each lever entry records:

```yaml
position: coordinator_sufficient
rationale: "User described a solo project and asked for low-friction routine work."
setAt: "2026-04-24T18:12:00Z"
setBy: spec-agent-intake
```

The important part is `setBy`. It tells you whether a lever came from:

- `system-default` — seeded automatically when the lever file is created.
- `spec-agent-intake` — inferred during onboarding or exploratory intake.
- `user-direct` — changed explicitly by you.
- `coordinator:<id>` — changed by a coordinator with an audit trail.

## Project vs domain levers

Project levers apply once to the whole project/workspace. Examples: merge
behavior, worktree isolation, runtime isolation, remediation autonomy.

Domain levers apply per coordinator domain, with a `default` fallback. That lets UI work and infra work have different review or approval strictness in the same repo.

A common shape is:

```yaml
domains:
  default:
    completion_approval:
      position: coordinator_sufficient
      setBy: spec-agent-intake
  release:
    completion_approval:
      position: human_required
      setBy: spec-agent-intake
```

The result is not "the AI made a secret decision." It is a visible proposal,
approved by you, stored in a plain file, and traceable later when behavior
surprises you.

## Changing your mind

Levers are not permanent. Use the Settings page for normal edits, or edit
`memory/agent-settings.yaml` directly when you need a precise reviewable diff.

When changing a lever by hand, update the `position`, `rationale`, `setAt`, and `setBy` together. The rationale matters because future you will want to know why the guild suddenly became more cautious, more autonomous, or more parallel.

## Related docs

- [Levers](../levers/) — every lever and position.
- [Provenance](../levers/provenance) — what `setBy` values mean.
- [`agent-settings.yaml`](../reference/agent-settings) — storage shape.
- [Setup wizard](../web-ui/setup) — the browser onboarding surface.
