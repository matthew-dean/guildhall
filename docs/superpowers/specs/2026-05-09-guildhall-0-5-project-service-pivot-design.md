# Guildhall 0.5.0 Project Service Pivot Design

## Goal

Reframe Guildhall as a macOS-first, user-local service that operates over many projects, with a friendly installer and a top-level Projects experience. `0.5.0` should make the product feel like "Guildhall runs on my projects" rather than "Guildhall is a package I install inside one repo."

## Problem

The current `0.4.x` story is caught between two models:

- Guildhall already has a global registry and multi-workspace/service concepts.
- The UI still feels primarily like a single-project app.
- Packaging still teaches a "Node package in a repo" mental model instead of a product/service mental model.

That mismatch creates avoidable confusion:

- `guildhall serve` sounds like a simple "open Guildhall" action, but the product underneath behaves more like a manually managed local app server.
- The product does not yet clearly separate the global view of many projects from the inside of one project.
- Install/distribution is not yet optimized for the best user experience.

`0.5.0` should resolve those mismatches instead of layering more behavior on top of them.

## Product Direction

### Summary

Guildhall becomes:

- a **macOS-first local service**
- managing **many user-local projects**
- with a **Projects** home screen at the top level
- and the current Guildhall UI living **inside a selected project**

### User-facing terminology

Use **project** as the primary user-facing term.

`workspace` may remain an internal/config/runtime term if it is useful for code and file layout, but the product should not teach users that concept unless there is a real distinction worth learning.

## Primary User Experience

### Install

The recommended install path is:

```bash
curl -fsSL <installer-url> | sh
```

That installer should install a packaged executable with its runtime included, so the recommended path does **not** require the user to think about Node.

Also supported:

```bash
npm install -g guildhall
```

But npm-global is secondary and should not be the primary onboarding path.

### Launch

`guildhall serve` becomes the friendly "Guildhall for dummies" path.

Expected behavior:

- ensure the local Guildhall service is running
- open the web UI
- if invoked from inside a project folder, bias the UI toward that project
- if invoked elsewhere, open Guildhall with no project selected

This lets normal users think "open Guildhall" rather than "manage a daemon."

### Background service

The underlying macOS service should use a **LaunchAgent**.

Advanced lifecycle commands should exist:

- `guildhall start` — start background service only
- `guildhall stop` — stop background service only
- `guildhall open` — open the web UI

But the main product story should lead with `guildhall serve`.

## Top-level Information Architecture

### Root screen

The top level becomes a **Projects** screen.

Each project card should show:

- project name
- local path
- current agent/service status for that project
- a concise health summary
- a concise work summary
- obvious `Open`, `Start`, and `Stop` actions

Projects are startable/stoppable **per project**, not globally.

### Project shell

Opening a project enters the current Guildhall experience for that project:

- Thread
- Work
- Coordinators
- Settings
- Release
- and other current project-specific surfaces

The product should provide a persistent way to go:

- back to **Projects**
- or otherwise "up" one level

### Project creation / attachment

The Projects screen should support **New Project**.

The first action is:

- **Pick an existing folder**

Guildhall should intentionally make the user do a little pre-thought instead of generating a new folder/project structure first.

After folder selection:

1. inspect the folder
2. if Guildhall config/state already exists:
   - register it locally
   - open the project
3. if Guildhall config/state does not yet exist:
   - register/open it as an **uninitialized project**
   - let setup happen inside the project shell

This slow path is important because it also supports the case where:

- a Guildhall project was already started on another machine
- the user picks that folder on this machine
- Guildhall detects the existing config and simply adds it to the local project list

## Runtime / Service Model

### Local registry

Guildhall should keep a user-local registry of known projects.

This remains the local "projects I know about on this machine" list, not the ultimate source of truth for project identity.

### Project source of truth

Each project's own config/state remains inside the project folder.

That means:

- attaching an existing project should be reversible and local
- moving across machines should still work by picking the same project folder
- the local registry should point at projects, not redefine them

### Serve semantics

`guildhall serve` should feel project-aware without being project-bound.

If invoked inside a project folder:

- Guildhall may preselect or foreground that project in the UI

If invoked outside any project folder:

- Guildhall should open the Projects screen with no project selected

The local service itself should not be thought of as "serving one project." It serves Guildhall as a whole.

## Chosen approach

For `0.5.0`, use:

- **Approach A: Node-based packaged executable + LaunchAgent**

### Why this approach

It gives the best balance of:

- better user experience
- lower migration risk
- less architectural churn inside the existing codebase

It lets us improve the packaging/distribution layer and product shell without coupling `0.5.0` to a large runtime rewrite.

## Deno evaluation

Deno should still be evaluated as a packaging/distribution option, because it may offer a cleaner bundled-executable story.

But for `0.5.0`, Deno should be treated as a **comparison spike**, not as the default direction unless it clearly wins on practical criteria.

### Comparison criteria

Node-packaged executable vs Deno-packaged executable should be compared on:

- artifact size
- startup reliability
- service management friendliness on macOS
- local file/network/process access needs
- release/build complexity
- developer workflow disruption
- future portability

The goal of that spike is to confirm the packaging choice, not to reopen the whole product direction.

## UI / Navigation Requirements

`0.5.0` should introduce an explicit two-level structure:

1. **Projects level**
2. **Inside one project**

That means:

- current project surfaces should no longer masquerade as the whole app
- header/nav/state should reflect whether the user is looking at:
  - all projects
  - or one selected project

The current UI should be preserved where it still works, but nested appropriately.

## UI Architecture Requirements

`0.5.0` should also use this pivot as an opportunity to revisit the UI
component structure itself, not only the route structure.

The goal is to avoid a Projects shell that is built from one-off bespoke
project-specific UI/data components with muddy responsibilities.

### Required qualities

The UI should move toward components that are:

- **sensible** — clear responsibilities and naming
- **responsive** — layouts work cleanly across supported viewport sizes
- **consistent** — repeated patterns behave and look the same
- **atomic/composable** — reusable building blocks instead of one-off blobs
- **separated by concern** — presentation, view composition, and data shaping
  should not be unnecessarily fused together

### Practical implications

This means `0.5.0` should include a deliberate pass over the current project UI
surface to identify:

- components that should become reusable shell/layout primitives
- components that should become reusable project-summary/task-summary cards
- places where project-specific fetching/transformation logic is too tightly
  coupled to rendering
- places where top-level navigation concerns and project-detail concerns are
  currently mixed together

### Non-goal

This is **not** a mandate for a vanity rewrite or a giant design-system detour.

The intent is:

- improve structure where the new Projects-first architecture touches the UI
- create cleaner boundaries and reusable pieces while doing that work
- avoid carrying forward bespoke project-view code that will make the new
  top-level product harder to evolve

### Proof requirement

The `0.5.0` implementation should leave the UI in a state where:

- the Projects screen is assembled from intentional reusable pieces
- the project shell uses clearer shared layout/navigation primitives
- project-specific data handling is more clearly separated from presentational
  components than it is today

## Init / Setup Requirements

Initialization should move inside the project shell for uninitialized projects.

That means:

- selecting a folder should not force an immediate full wizard before the user sees the project shell
- instead, an uninitialized project should show:
  - what Guildhall detected
  - what is missing
  - the next obvious setup action

This slower posture supports both:

- brand-new projects
- existing Guildhall projects coming from another machine

## Testing and Proof Requirements

Before `0.5.0` ships, prove:

1. installer path works on macOS
2. packaged executable runs correctly
3. LaunchAgent service lifecycle works
4. `guildhall serve` correctly starts/opens the product in the friendly path
5. project registry and attach flow work
6. existing project detection works
7. per-project start/stop behavior works
8. nested project UI still supports the current proven task flow

This release is not only about product structure. It must still preserve the narrow-lane autonomy proof we established in `0.4.0`.

## Non-goals

For `0.5.0`, do **not**:

- optimize for Linux-first or Windows-first packaging
- make "create a brand-new folder/project" the default new-project path
- teach a complex daemon-management story to normal users
- re-architect the core runtime purely for aesthetic reasons
- switch to Deno unless the packaging spike produces a clearly better overall outcome

## Risks

### Packaging risk

Bundled executable + LaunchAgent work can sprawl if treated as an open-ended packaging rewrite.

Mitigation:

- keep the runtime mostly intact
- treat Deno as evaluation, not assumption
- stay macOS-first

### UI scope risk

Moving from a single-project-feeling UI to a projects-first UI can accidentally turn into a full redesign.

Mitigation:

- preserve current project surfaces where possible
- focus on information architecture first

### State-model risk

Confusion between local registry state and project-owned config/state could create brittle behavior.

Mitigation:

- keep project config/state in the project
- keep the registry as a local list of known projects

## Recommendation

Ship `0.5.0` as:

- a macOS-first project/service pivot
- with a packaged executable
- a LaunchAgent-backed local service
- `guildhall serve` as the friendly entrypoint
- a top-level Projects screen
- existing Guildhall UI nested inside each project
- attach-existing-folder as the only new-project entry path
- npm-global still supported, but no longer the primary story

After implementation and proof:

1. publish `0.5.0`
2. recover the VitePress WIP worktree
3. rewrite docs to match the new product truth
4. get the VitePress docs experience up and running cleanly
