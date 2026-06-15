# Guildhall 0.9.0 Implementation Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this tracker task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Guildhall 0.9.0 as a runtime-backed, finishability-focused release where project work runs in managed containers, completed work has proof paths, accepted memory shapes future agents, and MCP can explain what Guildhall knows.

**Architecture:** Build the runtime foundation first, then route durable state through a persistence boundary, then layer proof paths, memory packets, MCP visibility, task shaping, and review calibration on top. Keep each workstream independently testable, but make runtime evidence and persistence the shared backbone.

**Tech Stack:** TypeScript/Node host supervisor, Svelte UI, Podman/GHCR runtime images, Debian 13 trixie runtime base, Vitest, Playwright, GitHub Actions, npm package release, macOS packaged artifact, MCP SDK.

---

## Source Plans

- `internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md`
- `internal/design-notes/persistence-system-boundary.md`
- `internal/plans/2026-05-27-project-orientation-and-proof-paths.md`
- `internal/plans/2026-05-27-guildhall-0-9-memory-system.md`
- `internal/plans/2026-05-24-guildhall-0-9-task-shaping-and-finishability.md`
- `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`
- `internal/plans/2026-05-24-guildhall-mcp-server-bridge.md`
- `internal/plans/2026-05-27-guildhall-0-9-benchmarks-and-hermes-comparison.md`
- `internal/plans/2026-05-27-guildhall-0-9-trust-and-completeness-proposal.md`
- `internal/specs/2026-05-27-guildhall-0-9-flexible-work-hierarchy-and-work-list.md`
- `internal/specs/2026-05-27-guildhall-0-9-small-app-proof-run.md`
- `internal/plans/2026-05-28-guildhall-0-9-design-quality-and-taste.md`
- `internal/audits/2026-05-27-pressure-test-intake-alignment.md`
- `internal/audits/2026-05-27-guildhall-role-alignment.md`

## Release Thesis

0.9.0 should prove that Guildhall can safely do real project work without turning the host machine into the workspace, and can explain the result without transcript archaeology.

The deeper product promise is trust: Guildhall should turn rough user intent into
high-quality, inspectable project work with the minimum useful owner
supervision. The owner should supervise judgment, not babysit process. Every
task or project phase should be pressure-tested enough to make the work
trustworthy, and the system should make that pressure visible through durable
state, proof, review, and memory.

Guildhall 0.9.0 is supported when the Guildhall host app/CLI is running on macOS. Linux and Windows may appear in implementation seams where the abstraction is cheap, but Guildhall-on-Linux and Guildhall-on-Windows are not release-supported host environments for 0.9.0 unless a later plan explicitly adds them.

The release is ready only when:

- projects opened by a supported macOS Guildhall host run normal commands inside managed project runtimes by default;
- project runtimes are off by default, start on demand, and mount both the project checkout and host `~/.guildhall`;
- runtime images publish to GHCR as part of the same release set as npm/macOS artifacts;
- completed work produces proof paths and owner-facing handoffs;
- accepted project/user memory appears in future agent context;
- MCP can answer what Guildhall knows, what runtime/evidence exists, and what shaped the latest handoff;
- the UI gives the owner current state, proof, memory, and blockers without exposing raw internal state first;
- at least one small app spec has been pushed through Guildhall end-to-end, with the starting spec, hierarchy, runtime evidence, review/gate evidence, proof path, and completion point all defined before the run;
- the small app proof is judged against design quality, not only functional completion: control semantics, palette intent, visual hierarchy, responsive screenshots, and reviewer-approved design proof must be present;
- every new or changed public-facing feature has matching public docs before release;
- every changed UI surface has fresh 0.9.0 screenshots checked into the docs assets.

## Priority Order

1. Runtime foundation and release artifact model.
2. Persistence boundary and write-path guardrail.
3. Runtime-backed command execution and evidence.
4. Pressure summaries and completeness packets.
5. Proof paths and completion handoffs.
6. Memory store, memory quality gates, and effective memory packet.
7. MCP runtime/memory/context/completeness surfaces.
8. Owner-facing UI slices, especially "why this is ready / blocked / done."
9. Flexible work hierarchy and smarter work-list defaults.
10. Task readiness, decomposition, and finishability rules.
11. End-to-end small app spec proof run.
12. Design quality and taste system for UI tasks and Pantry Pulse.
13. Review calibration, pressure adequacy, and failure corpus.
14. Feature docs and screenshot updates shipped with each feature PR.
15. Internal benchmarks and Hermes comparison, after the higher-priority 0.9 release work.

## Cross-Cutting Docs And Screenshot Rule

**Purpose:** Prevent 0.9 from shipping features that only exist in code, internal plans, or stale screenshots.

Every implementation PR that adds or changes user-visible behavior must include one of these outcomes:

- public docs updated in `docs/guide`, `docs/reference`, `docs/releases`, `docs/levers`, or `docs/web-ui`;
- a short note in the PR explaining why no public docs are needed because the change is purely internal, invisible, or behind unreleased infrastructure;
- if the UI changed, fresh screenshots in `docs/assets/ui-audit/0-9-0/` showing the 0.9.0 surface after the change.

Required checks for feature PRs:

- [ ] Identify public-facing behavior changes before implementation is marked done.
- [ ] Update public docs in the same PR as the feature, not in a final release-docs sweep.
- [ ] Add or refresh 0.9.0 screenshots for every changed owner-facing UI surface.
- [ ] Make screenshot filenames match the surface (`projects.png`, `work.png`, `release.png`, `memory.png`, `runtime.png`, etc.).
- [ ] Keep unreleased strategy and implementation notes under `internal/`; public docs should describe shipped behavior in reader-facing language.
- [ ] Run `pnpm docs:check-copy`.
- [ ] Run `pnpm docs:check-help-sync`.
- [ ] Run `pnpm docs:build` before any release-candidate PR.

## Milestone 0: Baseline And Planning Hygiene

**Purpose:** Make 0.9 implementation start from clean, discoverable planning sources.

**Files:**

- Modify: `internal/README.md`
- Modify: `internal/plans/2026-05-24-guildhall-0-9-task-shaping-and-finishability.md`
- Modify: `internal/specs/2026-05-22-guildhall-0-8-podman-project-runtime.md`
- Create/maintain: this tracker

- [x] Link this tracker from `internal/README.md`.
- [x] Update the umbrella 0.9 plan so Podman runtime is named as the first major proving lane, not a late spike.
- [x] Confirm the Podman runtime spec names GHCR, Debian 13 trixie, Node 22, Python 3.13, runtime executables, release/update flow, and on-demand lifecycle.
- [x] Confirm no public docs present 0.9 runtime behavior as shipped.
- [x] Run `pnpm docs:check-help-sync`.
- [x] Run `git diff --check`.

## Milestone 1: Runtime Image Contract

**Purpose:** Create the versioned container image contract that every runtime-backed project depends on.

**Files:**

- Create: `runtime/Containerfile`
- Create: `runtime/package.json` or equivalent runtime-service package entry if needed
- Create: `src/runtime-container/`
- Create: `src/runtime-container/__tests__/`
- Modify: `build.mjs`
- Modify: `package.json`

- [x] Add a committed `Containerfile` based on Debian 13 `trixie-slim`.
- [x] Install baseline executables: `bash`, `coreutils`, `ca-certificates`, `curl`, `git`, `openssh-client`, `ripgrep`, `findutils`, `jq`, `tar`, `unzip`, `xz-utils`, build-essential class tools.
- [x] Install Node.js 22 LTS and enable Corepack.
- [x] Install Python 3.13 plus `pipx` and virtualenv support.
- [x] Install Playwright-compatible system dependencies.
- [x] Create stable `guildhall` user with predictable uid/gid behavior.
- [x] Add `guildhall-runtime` executable.
- [x] Add `guildhall-exec` executable.
- [x] Add `guildhall-healthcheck` executable.
- [x] Add `guildhall-runtime-info` executable.
- [x] Add `guildhall-capability-request` executable.
- [x] Make `guildhall-runtime` the image entrypoint.
- [x] Add unit tests for runtime-info output shape.
- [x] Add unit tests for healthcheck mount checks using temporary directories.
- [x] Add unit tests for healthcheck tool/version checks.
- [x] Add local build command, for example `pnpm runtime:image:build`.
- [x] Add local smoke command, for example `pnpm runtime:image:smoke`.
- [x] Verify `podman build` works locally. `pnpm runtime:image:build` passed on macOS Podman 5.8.2 after adjusting the image to reuse the Node base image's existing UID 1000 user as `guildhall`.
- [x] Verify `guildhall-runtime-info` reports OS, Node, Python, image version, runtime API, and executable schema. Local container proof reports Debian 13 trixie, Node v22.22.3, Python 3.13.5, runtime API 1, and all five runtime executables.

**Verification:**

- `pnpm typecheck`
- `pnpm test -- src/runtime-container`
- `pnpm runtime:image:build`
- `pnpm runtime:image:smoke`

## Milestone 2: Release Artifact Model

**Purpose:** Treat host package and runtime image as one compatible release set.

**Files:**

- Create: `src/runtime/release-manifest.ts`
- Create: `src/runtime/__tests__/release-manifest.test.ts`
- Create: `.github/workflows/runtime-image.yml` or extend `.github/workflows/release.yml`
- Modify: `scripts/publish.mjs`
- Modify: `scripts/build-macos-package.mjs`
- Modify: `scripts/release-smoke.mjs`

- [x] Add release manifest schema with `guildhallVersion`, host Node line, runtime API, default runtime image, digest, OS, Node, Python, and project migrations.
- [x] Include release manifest in npm package and macOS package.
- [x] Add helper to read installed release manifest at runtime.
- [x] Add GHCR publishing workflow for `ghcr.io/matthew-dean/guildhall-runtime-debian`.
- [x] Publish immutable tags like `0.9.0-trixie-node22-python313-playwright`.
- [x] Publish patch-line tags like `0.9-trixie-node22-python313-playwright`.
- [x] Record image digest in release manifest when `GUILDHALL_RUNTIME_IMAGE_DIGEST` is provided.
- [x] Update release script so a real 0.9 release fails if the default runtime image is missing or unverified.
- [x] Keep runtime image pull lazy: package install should not pull the image unless the installer explicitly asks.
- [x] Add release smoke that verifies host package can resolve the default runtime metadata.

**Verification:**

- `pnpm test -- src/runtime/__tests__/release-manifest.test.ts`
- `pnpm release:dry`
- GitHub Actions runtime image dry run or workflow dispatch on a test tag.

## Milestone 3: Host Supervisor Runtime Registry

**Purpose:** Let Guildhall know which projects have runtimes, what image/digest they use, and whether they are stopped/running/failed.

**Public docs/screenshots:** No public docs or screenshots for this milestone. It adds host-side state, supervisor methods, and internal API endpoints; no public runtime behavior or owner-facing UI is shipped yet.

**Files:**

- Create: `src/runtime/project-runtime-store.ts`
- Create: `src/runtime/project-runtime-supervisor.ts`
- Create: `src/runtime/__tests__/project-runtime-store.test.ts`
- Create: `src/runtime/__tests__/project-runtime-supervisor.test.ts`
- Modify: `src/sessions/local-history.ts`
- Modify: `src/runtime/serve.ts`

- [x] Define project runtime state: backend, image tag, digest, runtime API, container id, status, mounts, cache volumes, ports, health, last started/stopped.
- [x] Store runtime state in host-owned Guildhall state, not inside the container.
- [x] Add stopped-by-default lifecycle state.
- [x] Add supervisor methods: create, start, stop, inspect, logs, rebuild, remove.
- [x] Add runtime status API.
- [x] Add runtime health API.
- [x] Ensure registered projects do not start containers just because they appear in the UI.
- [x] Start runtime on command/proof/dev-server/browser work only.
- [x] Stop runtime after idle timeout when no keep-alive reason exists.
- [x] Add tests for stopped-by-default and start-on-demand behavior.

**Verification:**

- `pnpm test -- src/runtime/__tests__/project-runtime-store.test.ts src/runtime/__tests__/project-runtime-supervisor.test.ts`
- Manual `podman ps` proof that opening a project does not start a container. Current local proof on macOS Podman 5.8.2: `podman ps --format '{{.ID}} {{.Image}} {{.Names}} {{.Status}}'` returned no running containers after the registry/supervisor work.

## Milestone 4: Guided Runtime Backend Setup

**Purpose:** Make Podman an assisted, owner-approved setup path instead of hidden homework or a silent installer side effect.

**Public docs/screenshots:** Public install/runtime docs must explain the guided setup choice before this ships. If surfaced in the UI, add fresh screenshots under `docs/assets/ui-audit/0-9-0/`.

**Files:**

- Create: `src/runtime/runtime-backend-setup.ts`
- Create: `src/runtime/__tests__/runtime-backend-setup.test.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/web/surfaces/project/SettingsTab.svelte` or the current runtime/settings surface when UI is added
- Modify: `docs/guide/quick-start.md`
- Modify: `docs/guide/running.md`

- [x] Detect Podman CLI availability without installing anything.
- [x] Treat Guildhall-on-macOS as the only release-supported 0.9.0 local host environment.
- [x] Detect Podman machine state on macOS when the CLI exists.
- [x] Return owner-facing setup status: ready, missing, machine-not-created, machine-stopped, unsupported-platform, unknown-error.
- [x] Provide explicit one-click setup actions, not command handoff: install instructions when needed, initialize machine, start machine, retry detection, use host-run compatibility.
- [x] When the owner approves setup, Guildhall runs `podman machine init --now` or the equivalent init/start sequence itself and returns progress/results back to the UI.
- [x] Detect whether Homebrew is available, but do not require it.
- [x] On macOS, document and implement installation guidance for both Homebrew users and non-Homebrew users using Podman's official macOS installer path.
- [x] Require explicit owner approval before any install/init/start action that changes the host.
- [x] Do not pull the Guildhall runtime image during package install.
- [x] Pull/smoke the runtime image only during approved runtime setup or first runtime use.
- [x] Persist setup decisions/results in host-owned runtime state.
- [x] Add API endpoint for runtime backend setup status.
- [x] Add API endpoint for approved setup actions.
- [x] Keep host-run compatibility mode available and visibly labeled when setup is skipped or fails.
- [x] Add tests for missing Podman, ready Podman, stopped machine, and declined setup.

**Verification:**

- `pnpm test -- src/runtime/__tests__/runtime-backend-setup.test.ts`
- Manual proof on macOS with Podman absent: UI/API offers guided setup and host-run compatibility, without changing the host until the owner approves an action.
- Manual proof on macOS with Podman installed but no machine: Guildhall offers a single approved setup action, runs Podman machine initialization itself after approval, then re-detects readiness.
- Manual proof on macOS with Podman installed but stopped: Guildhall offers machine start, runs it after approval, then re-detects readiness.
- Manual proof or unit-backed platform override: non-macOS hosts report unsupported-platform for 0.9.0 runtime-backed mode and keep host-run compatibility available.

Current proof:

- `pnpm vitest run src/runtime/__tests__/runtime-backend-setup.test.ts src/runtime/__tests__/serve-runtime.test.ts` passed with 11 tests.
- `pnpm typecheck` passed after the backend/API/UI changes.
- Browser proof against a fresh local branch build at `http://localhost:7788/projects/looma-knit/settings/ready`: Settings -> Ready shows Local runtime `ready`, Podman version, `podman-machine-default running`, Retry, and Host-run compatibility.
- Screenshot captured at `docs/assets/ui-audit/0-9-0/settings-runtime.jpg`.

## Milestone 5: Mounts, Health Checks, And Migration

**Purpose:** Make runtime-backed projects safe to enable and reversible.

**Files:**

- Create: `src/runtime/project-runtime-migration.ts`
- Create: `src/runtime/runtime-health.ts`
- Create: `src/runtime/__tests__/project-runtime-migration.test.ts`
- Create: `src/runtime/__tests__/runtime-health.test.ts`
- Modify: `src/runtime/migrations.ts` or existing project migration entrypoint
- Modify: `docs/reference/memory-layout.md` later when public docs are updated

- [x] Define required mounts: selected project checkout and host `~/.guildhall`.
- [x] Define stable container paths: `/workspace/<project-slug>` and `/home/guildhall/.guildhall`.
- [x] Add mount health checks: read/write, host ownership, delete, rename, chmod, symlink, file-watch or polling fallback.
- [x] Add tool health checks: shell, git, rg, jq, node/npm/corepack, python3/pipx.
- [x] Add DNS/network health check.
- [x] Add command-log persistence check into host `~/.guildhall`.
- [x] Add guided host-run to runtime-backed migration.
- [x] Keep host-run fallback until migration passes and owner accepts.
- [x] Add rollback path that restores previous runtime state or compatibility mode.
- [x] Add migration record with image tag/digest, runtime API, mount layout, checks, and rollback ref.

**Verification:**

- `pnpm test -- src/runtime/__tests__/runtime-health.test.ts src/runtime/__tests__/project-runtime-migration.test.ts`
- Manual migration of one existing local project into runtime-backed mode.

Current proof:

- `pnpm vitest run src/runtime/__tests__/runtime-health.test.ts src/runtime/__tests__/project-runtime-migration.test.ts src/runtime/__tests__/project-runtime-store.test.ts src/runtime/__tests__/migrations.test.ts src/runtime/__tests__/index.test.ts` passed with 17 tests.
- `pnpm typecheck` passed after the runtime health/migration state changes.
- Manual Podman-backed smoke against `/Users/matthew/git/oss/guildhall` passed: health reported `healthy`, accepted migration recorded `runtime-backed` with `/workspace/guildhall`, then rollback restored `host-run` compatibility.

## Milestone 6: Runtime Command Execution And Evidence

**Purpose:** Route normal project commands through the runtime and preserve useful evidence.

**Files:**

- Create: `src/runtime/project-runtime-command.ts`
- Create: `src/runtime/__tests__/project-runtime-command.test.ts`
- Create: `src/runtime/podman-project-runtime-backend.ts`
- Create: `src/runtime/__tests__/podman-project-runtime-backend.test.ts`
- Modify: `src/runtime/project-runtime-supervisor.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/sessions/local-history.ts`

- [x] Add typed command request schema: project id, cwd, argv, env diff, timeout, expected ports, task id.
- [x] Add typed command event schema: started, stdout, stderr, exit, failed, port, health warning.
- [x] Run commands as `guildhall` user inside the project runtime.
- [x] Persist command evidence with runtime id, project id, cwd, env diff, exit code, timestamps, and port map.
- [x] Surface denied host access as capability request or task blocker.
- [x] Add command timeout and cancellation.
- [x] Ensure stopped runtime starts on command request.
- [x] Ensure idle runtime stops after command completion unless keep-alive exists.
- [x] Add tests for command event ordering.
- [x] Add tests for evidence records.

**Verification:**

- `pnpm vitest run src/runtime/__tests__/project-runtime-command.test.ts src/runtime/__tests__/serve-runtime.test.ts src/runtime/__tests__/project-runtime-supervisor.test.ts src/runtime/__tests__/podman-project-runtime-backend.test.ts` passed with 13 tests.
- API-level command proof covers ordered events, `guildhall` runtime user, expected ports, persisted evidence, and denied host access becoming a pending `mount_directory` capability request.
- Podman backend proof covers default supervisor wiring to real `podman create/start/exec`, project and `~/.guildhall` mounts, `guildhall` runtime user execution, env diff propagation, stdout/stderr events, and `guildhall-exec`.
- Manual Podman smoke against the local runtime image passed: disposable container mounted the repo at `/workspace/guildhall`, mounted host `~/.guildhall`, and `podman exec --user guildhall ... guildhall-exec sh -lc 'id -un && pwd && test -d /home/guildhall/.guildhall && node --version'` returned `guildhall`, `/workspace/guildhall`, and Node `v22.22.3`.

## Milestone 7: Dev Server, Ports, And Browser Proof

**Purpose:** Make runtime-backed proof paths usable for real web projects.

**Files:**

- Create: `src/runtime/dev-server-manager.ts`
- Create: `src/runtime/port-router.ts`
- Create: `src/runtime/__tests__/dev-server-manager.test.ts`
- Create: `src/runtime/__tests__/port-router.test.ts`
- Modify: `src/runtime/serve.ts`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/TaskDrawer.svelte`

- [x] Add dev-server process model: starting, running, stopped, failed, stale.
- [x] Allocate host ports for runtime ports.
- [x] Show command, cwd, container port, host port, and readiness.
- [x] Add stop/restart controls.
- [x] Preserve enough state to reconcile after UI reload.
- [x] Add port conflict handling.
- [x] Add redacted log disclosure.
- [x] Add browser proof against exposed host URL.
- [x] Add test fixture project with a tiny web server if needed.

**Verification:**

- `pnpm test -- src/runtime/__tests__/dev-server-manager.test.ts src/runtime/__tests__/port-router.test.ts`
- `pnpm test:ui` for the visible dev-server/proof flow when browser tests exist.
- Manual proof: start dev server in runtime, open host URL, stop it.

Current proof:

- `pnpm vitest run src/runtime/__tests__/dev-server-manager.test.ts src/runtime/__tests__/port-router.test.ts src/runtime/__tests__/serve-runtime.test.ts src/runtime/__tests__/podman-project-runtime-backend.test.ts` passed with 14 tests.
- `pnpm typecheck` passed.
- Manual Podman dev-server proof passed: disposable runtime container published `45179:5173`, started `python3 -m http.server 5173 --bind 0.0.0.0` through `guildhall-exec` as `guildhall`, and host `curl http://127.0.0.1:45179/package.json` returned the repo package metadata before cleanup.

## Milestone 8: Capability Requests

**Purpose:** Replace ambient host access with visible owner-approved grants.

**Files:**

- Create: `src/runtime/capability-grants.ts`
- Create: `src/runtime/__tests__/capability-grants.test.ts`
- Modify: `src/mcp-server/project-reader.ts`
- Modify: `src/mcp-server/server.ts`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`

- [x] Implement `mount_directory` capability request.
- [x] Render request in Thread with reason, exact path, access level, duration, evidence note, and fallback.
- [x] Support approve read-only, approve read/write, choose alternate path, deny, and mark blocked.
- [x] Grant approved mount at `/mnt/guildhall-grants/<grant-id>`.
- [x] Record grant in task evidence.
- [x] Show active grants in Settings.
- [x] Expose active/denied grants through MCP.
- [x] Make grants revocable at project level.

**Verification:**

- `pnpm test -- src/runtime/__tests__/capability-grants.test.ts`
- Manual proof: request sibling repo read-only mount, approve, verify runtime sees narrow mount only.

**Completed proof:**

- Focused regression passed: `pnpm vitest run src/runtime/__tests__/capability-grants.test.ts src/runtime/__tests__/podman-project-runtime-backend.test.ts src/runtime/__tests__/serve-runtime.test.ts src/mcp-server/__tests__/project-reader.test.ts src/mcp-server/__tests__/server.test.ts src/web/surfaces/project/__tests__/ThreadTab.svelte.test.ts src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts`.
- `pnpm typecheck` passed.
- Manual Podman grant proof passed: a disposable host folder mounted read-only at `/mnt/guildhall-grants/manual` was readable by the `guildhall` runtime user, and writes failed with `Read-only file system`.

## Milestone 9: Persistence Boundary Core

**Purpose:** Stop new 0.9 features from adding ad hoc state islands.

**Files:**

- Create: `src/persistence/`
- Create: `src/persistence/__tests__/`
- Modify: `src/runtime/context-observability.ts`
- Modify: runtime evidence writers from earlier milestones

- [x] Add `GuildhallPersistence` core with typed record writes, append events, artifact writes, placement policy, evidence refs, and evidence resolution.
- [x] Add placement scopes: shared project, local history, global user, exported artifact.
- [x] Add visibility and commit-policy metadata.
- [x] Add file-backed implementation for current repo/local-history layout.
- [x] Add static guardrail or focused test that flags new direct writes to managed Guildhall paths outside approved low-level modules.
- [x] Move runtime command evidence to the persistence boundary.
- [x] Move capability grant evidence to the persistence boundary.
- [x] Treat legacy runtime command JSONL as migration input, not an ongoing output format.
- [x] Keep temporary read fallback only where old local-history files may still exist before migration.

**Verification:**

- `pnpm test -- src/persistence`
- Static guardrail test for managed-path writes.

**Completed proof:**

- Focused regression passed: `pnpm vitest run src/persistence src/runtime/__tests__/project-runtime-command.test.ts src/runtime/__tests__/capability-grants.test.ts src/runtime/__tests__/context-observability.test.ts src/runtime/__tests__/serve-runtime.test.ts`.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- Runtime command evidence, capability grant evidence, and context-debug records now append persistence events. Runtime command JSONL is no longer dual-written; `0.9.0/runtime-command-evidence-persistence` migrates old JSONL into persistence and removes the legacy file, with read fallback only for pre-migration installs.

## Milestone 10: Proof Paths And Completion Handoffs

**Purpose:** Make done work understandable and reproducible.

**Files:**

- Create: `src/runtime/proof-paths.ts`
- Create: `src/runtime/completion-handoff.ts`
- Create: `src/runtime/__tests__/proof-paths.test.ts`
- Create: `src/runtime/__tests__/completion-handoff.test.ts`
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: task drawer Journey UI

- [x] Define `ProofPath`, `LaunchStep`, `ExpectedEvidence`, `VerificationRecord`, and `CompletionHandoff` schemas.
- [x] Add task-scoped proof paths.
- [x] Add project-scoped proof paths.
- [x] Add launch step kinds: copy command, open URL, manual step, external dashboard, blocked until setup.
- [x] Do not add executable long-running launch buttons until dev-server lifecycle is reliable.
- [x] Teach spec agent to propose proof path for non-trivial tasks.
- [x] Teach worker to update proof path with actual commands/routes/workflows.
- [x] Teach reviewer to reject handoff when proof path is missing or overclaims.
- [x] Teach gate checker to distinguish automated proof from manual/provider proof.
- [x] Render proof path and completion handoff in Journey.

**Verification:**

- `pnpm test -- src/runtime/__tests__/proof-paths.test.ts src/runtime/__tests__/completion-handoff.test.ts`
- Browser/UI proof for Journey rendering.

Current proof:

- `pnpm vitest run src/runtime/__tests__/proof-paths.test.ts src/runtime/__tests__/completion-handoff.test.ts` passed with 7 tests.
- `pnpm vitest run src/runtime/__tests__/context-builder.test.ts -t "proof paths"` passed and proves proof paths plus completion handoff are injected into agent context.
- `pnpm vitest run src/agents/__tests__/guildhall-agent.test.ts -t "proof-path responsibilities"` passed and proves spec/worker/reviewer/gate-checker prompts carry their proof responsibilities.
- `pnpm vitest run src/web/surfaces/drawer/__tests__/drawer-tabs.svelte.test.ts -t "proof paths"` passed and proves Journey renders proof paths and completion handoff without adding executable launch controls.
- `pnpm vitest run src/runtime/__tests__/proof-paths.test.ts src/runtime/__tests__/completion-handoff.test.ts src/runtime/__tests__/context-builder.test.ts src/agents/__tests__/guildhall-agent.test.ts src/web/surfaces/drawer/__tests__/drawer-tabs.svelte.test.ts` passed with 139 tests.
- `pnpm typecheck`, `pnpm build`, and `git diff --check` passed.
- Browser proof: built `dist`, started `node dist/cli.js serve-internal --port 7789`, opened `http://localhost:7789` in the in-app browser, and verified the built dashboard loaded with Guildhall/Projects visible. The temporary server was stopped afterward.

## Milestone 11: Memory Store And Effective Memory Packet

**Purpose:** Make the self-improving memory story true in agent context.

**Files:**

- Create: `src/runtime/memory-store.ts`
- Create: `src/runtime/effective-memory-packet.ts`
- Create: `src/runtime/__tests__/memory-store.test.ts`
- Create: `src/runtime/__tests__/effective-memory-packet.test.ts`
- Modify: `src/runtime/learning.ts`
- Modify: `src/runtime/context-builder.ts`
- Modify: `src/runtime/context-observability.ts`

- [x] Add memory lifecycle states: observed, proposed, active, used, retired.
- [x] Add memory types: project fact, project habit, user preference, project skill, codebase knowledge, product idea.
- [x] Add read adapters for existing `.guildhall/learning.json`, `MEMORY.md`, `project-skills.json`, and `~/.guildhall/learning.json`.
- [x] Add deterministic retrieval by scope, type, tags, domain, task kind, file area, confidence, risk, and freshness.
- [x] Add effective memory packet with included, withheld, and evidence refs.
- [x] Inject active memory into `buildContext` as named sections.
- [x] Record memory use in context-debug.
- [x] Generate candidate observations from completed tasks, corrections, proof paths, review misses, and recovery playbooks.
- [x] Ensure proposed memory remains inert until accepted.

**Verification:**

- `pnpm test -- src/runtime/__tests__/memory-store.test.ts src/runtime/__tests__/effective-memory-packet.test.ts`
- Focused context-builder test proving accepted project/global memory appears and proposed memory does not.

Current proof:

- `pnpm vitest run src/runtime/__tests__/memory-store.test.ts src/runtime/__tests__/effective-memory-packet.test.ts` passed with 7 tests.
- `pnpm vitest run src/runtime/__tests__/memory-store.test.ts src/runtime/__tests__/effective-memory-packet.test.ts src/runtime/__tests__/context-builder.test.ts src/runtime/__tests__/context-observability.test.ts src/runtime/__tests__/learning.test.ts src/persistence/__tests__/managed-path-guardrail.test.ts` passed with 83 tests.
- `pnpm typecheck` passed.
- `git diff --check` passed.

## Milestone 12: MCP Runtime, Memory, And Context Surfaces

**Purpose:** Let external agents answer the 0.9 audit through MCP without shell fallback.

**Files:**

- Modify: `src/mcp-server/types.ts`
- Modify: `src/mcp-server/project-reader.ts`
- Modify: `src/mcp-server/server.ts`
- Modify: `src/mcp-server/__tests__/project-reader.test.ts`
- Modify: `src/mcp-server/__tests__/server.test.ts`
- Modify: `internal/specs/guildhall-mcp-server-contract.md`

- [x] Expand `guildhall://project` with runtime, memory health, codebase map freshness, and latest context-debug health.
- [x] Expand `guildhall://project/memory` beyond `MEMORY.md`.
- [x] Add `guildhall://project/learning`.
- [x] Add `guildhall://project/context`.
- [x] Add `guildhall://project/local-history`.
- [x] Add `guildhall://project/codebase-knowledge`.
- [x] Add `guildhall://project/runtime`.
- [x] Add `guildhall.list_memory`.
- [x] Add `guildhall.read_memory`.
- [x] Add `guildhall.record_memory_observation`.
- [x] Add `guildhall.update_memory_status`.
- [x] Add `guildhall.read_effective_context`.
- [x] Ensure MCP summaries are bounded and redact secrets/unbounded logs by default.

**Verification:**

- `pnpm test -- src/mcp-server`
- MCP stdio smoke proving project memory/runtime/context audit works without shell reads.

**Completion evidence (2026-05-28):**

- `guildhall://project` now summarizes runtime health, memory health, codebase
  map freshness, and latest context-debug health.
- `guildhall://project/memory` now surfaces normalized memory records from
  `memory-store.json`, `MEMORY.md`, project/global `learning.json`, and
  project skills instead of acting as a raw Markdown file read.
- Added MCP resources for learning, context, local history, codebase knowledge,
  and runtime.
- Added MCP memory tools for listing, reading, recording observations,
  updating status, and reading the effective memory packet for a task.
- Broad MCP resource output is clipped and redacts common secret tokens and
  secret-looking key/value lines. Local history is summarized by health/counts
  instead of dumping transcripts or logs.
- `pnpm vitest run src/mcp-server` passed with 10 tests, including stdio
  resource reads for memory, runtime, and context.
- `pnpm typecheck` passed.
- `pnpm build` passed with existing third-party Svelte warnings from
  `svelte-sonner`/`runed`.
- `git diff --check` passed.

## Milestone 13: Owner-Facing UI Slices

**Purpose:** Show the new truth where the owner naturally looks.

**Files:**

- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Modify: `src/web/surfaces/project/ThreadTab.svelte`
- Modify: project overview surface
- Modify: task drawer/Journey surface
- Modify: relevant Svelte tests

- [x] Project Overview shows current state, runtime health, primary proof paths, blockers, and memory health.
- [x] Task Journey shows completion handoff, proof path, runtime evidence, files changed, review/gate summary, and remaining uncertainty.
- [x] Settings Guidance becomes memory control: project context, user preferences, proposed memories, recent memory use.
- [x] Thread renders runtime/capability decisions in owner language.
- [x] Thread renders behind-the-scenes task splitting and reorientation events.
- [x] UI labels host-run mode as compatibility mode.
- [x] UI shows runtime stopped/running/failed clearly.

**Verification:**

- `pnpm typecheck` passed, including `pnpm --filter @guildhall/ui typecheck`.
- Focused Svelte tests passed: `ProjectOverviewTab`, `SettingsTab`, `ThreadTab`, and drawer/Journey tabs, 81 tests total.
- `pnpm test:ui` passed after build, 5 Playwright tests total.
- Live browser smoke passed against the runtime-backed Looma + Knit project on the built service: Overview showed runtime stopped, compatibility mode, memory health, and primary proof paths; Thread showed runtime stopped and compatibility mode.

## Milestone 14: Flexible Work Hierarchy And Work List

**Purpose:** Replace the arbitrary "parent task" mental model with flexible, inspectable work items that can represent app specs, feature specs, epics, stories, tasks, subtasks, verification items, or other containing work without introducing separate data silos.

**Files:**

- Follow: `internal/specs/2026-05-27-guildhall-0-9-flexible-work-hierarchy-and-work-list.md`
- Modify: `src/core/task.ts`
- Modify: `src/runtime/task-state-store.ts`
- Modify: `src/runtime/intake.ts`
- Modify: `src/runtime/orchestrator.ts`
- Modify: `src/runtime/thread.ts`
- Modify: `src/web/surfaces/ProjectView.svelte`
- Modify: `src/web/surfaces/TaskDrawer.svelte`
- Modify: `src/web/surfaces/drawer/OverviewTab.svelte`
- Modify: public docs page/section for ways to work with Guildhall
- Modify: relevant runtime and Svelte tests

- [x] Add a flexible work-item hierarchy model while preserving compatibility with current `Task` records.
- [x] Replace owner-facing "parent task" language with containing/nested work language.
- [x] Support arbitrary hierarchy depth with rollups and explicit completion boundaries.
- [x] Keep dependencies separate from containment.
- [x] Teach intake/decomposition to choose hierarchy automatically from rough intent.
- [x] Redesign work-list grouping, default done/shelved filtering, sorting, and filters.
- [x] Update drawer/thread/work-list UI for breadcrumbs, nested work, child counts, and completion boundary.
- [x] Add explicit scoped-start semantics so project Start starts the project, while card/work-item Start only starts that scoped work item or subtree.
- [x] Add labels/toasts/API naming/tests proving scoped Start does not dispatch unrelated ready work.
- [x] Add public docs explaining the different ways to work with Guildhall: whole project, feature-at-a-time through `New request`, one focused work item, setup/verification lane, and exploration/decision lane.
- [x] Migrate or derive compatibility from existing `parentGoalId`, `parent` status, and recommended child data.
- [x] Add runtime and Svelte tests named in the detailed spec.

**Verification:**

- Focused runtime tests for hierarchy read/write, rollups, completion boundary, and dependency separation.
- Focused runtime/UI tests for scoped Start behavior: starting one card does not run unrelated ready work.
- Focused Svelte tests for default work-list filtering, hierarchy breadcrumbs, done reveal, scoped-start labels/toasts, and nested work drawer copy.
- Browser proof on a project with at least three hierarchy levels: app spec -> feature spec -> implementation/proof work.

## Milestone 15: Task Shaping And Finishability

**Purpose:** Make tasks small, ready, proofable, and honest before dispatch.

**Files:**

- Create: `src/runtime/task-readiness.ts`
- Create: `src/runtime/task-decomposition.ts`
- Create: `src/runtime/task-kinds.ts`
- Create: `src/runtime/__tests__/task-readiness.test.ts`
- Create: `src/runtime/__tests__/task-decomposition.test.ts`
- Modify: intake/spec/coordinator code paths

- [x] Add task kinds: implementation, research, decision, spike, cleanup, verification, release, learning.
- [x] Add readiness dimensions: outcome clarity, size, proofability, context load, dependency risk, uncertainty, user-judgment exposure.
- [x] Add recommendation states: ready, needs one question, needs research/spike, split, shelve/defer.
- [x] Persist decomposition reasons.
- [x] Add Definition of Done to first-class task state.
- [x] Add if-then blocker plans.
- [x] Add context budget estimation.
- [x] Add coordinator reflection that suggests practices/preferences without auto-approving them.

**Verification:**

- `pnpm test -- src/runtime/__tests__/task-readiness.test.ts src/runtime/__tests__/task-decomposition.test.ts`
- focused runtime tests for intake/spec transitions.

## Milestone 16: End-To-End Small App Spec Proof Run

**Purpose:** Define one small app spec that is big enough to exercise Guildhall's full lifecycle, but small enough that we can observe it move through every stage to a concrete completion point.

**Files:**

- Follow: `internal/specs/2026-05-27-guildhall-0-9-small-app-proof-run.md`
- Create: `internal/fixtures/app-spec-smoke/`
- Create: `internal/fixtures/app-spec-smoke/spec.md`
- Create: `internal/fixtures/app-spec-smoke/completion-boundary.md`
- Create: `internal/fixtures/app-spec-smoke/expected-hierarchy.md`
- Create: `internal/fixtures/app-spec-smoke/proof-checklist.md`
- Create: `internal/fixtures/app-spec-smoke/run-report-template.md`
- Create: `internal/fixtures/app-spec-smoke/recorded-run.md`
- Create: `internal/fixtures/zero-info-spec-intake/scenario.md`
- Modify: benchmark/lifecycle harness once available
- Modify: docs/screenshots only if the proof run changes public UI

- [x] Create the Pantry Pulse app-spec fixture files named in the detailed spec.
- [x] Define the completion boundary and expected hierarchy before running the fixture.
- [x] Define the separate zero-information directory scenario from the detailed spec: empty folder, rough idea only, reviewed initial app spec and hierarchy as the completion point.
- [x] Run the fixed Pantry Pulse spec through a deterministic end-to-end harness that creates the app, reaches done, serves it, and browser-proofs the core behavior.
- [x] Complete the true live-agent Pantry Pulse run through app creation, done status, and browser proof of the core behavior.
- [ ] Extend the true live-agent Pantry Pulse report to include explicit release-grade handoff, memory proposal, and MCP/context audit evidence.
- [x] Capture owner interventions and classify them as necessary, avoidable, or non-delegable.
- [x] Capture runtime command/dev-server/browser evidence and link it from the final handoff.
- [x] Verify the work list presents current, nested, blocked, and done work according to the detailed spec.
- [x] Produce the live-agent internal run report and feed misses back into the tracker.

**Verification:**

- A recorded deterministic smoke run against the fixed Pantry Pulse spec creates the app and reaches its defined completion boundary.
- The live-agent benchmark also creates the app, recovers from spec-shape misses, moves through review/gate, lands the work, and passes browser proof before 0.9 release acceptance.
- A separate recorded zero-information directory run reaches a reviewed initial app spec, hierarchy, first runnable work item, and proof path without manual file editing.
- The final handoff can be understood from Guildhall UI/API/MCP without transcript archaeology.
- Any false success, unclear hierarchy, unnecessary owner question, missing proof, blank-project orientation gap, or work-list confusion becomes a follow-up item before release.

## Milestone 17: Design Quality And Taste

**Purpose:** Make UI work design-aware enough that the Pantry Pulse proof and
future app specs produce polished, trustworthy results instead of merely
functional screens.

**Files:**

- Follow: `internal/plans/2026-05-28-guildhall-0-9-design-quality-and-taste.md`
- Modify: `src/runtime/request-intake.ts`
- Modify: `src/runtime/pressure-test-intake.ts`
- Modify: `src/guilds/component-designer/`
- Modify: `src/guilds/color-theorist/`
- Modify: task card, task drawer, Thread, and project settings/design surfaces as UI slices are added
- Modify: Pantry Pulse fixture and live proof harness

- [x] Add UI design-quality pressure checks to request intake.
- [x] Add design-quality pressure-test domain and spec rendering.
- [x] Teach Component Designer to review interaction semantics and wrong control types.
- [x] Teach Color Theorist to review product mood, palette fit, and saturation budget for broad UI app work.
- [x] Add a project design/taste store with global, user, and project override layers.
- [x] Add the Design System Profile for tokens, components, catalogs, and UI libraries.
- [x] Add Storybook-compatible, Storybook-optional design preview adapter discovery and API.
- [x] Evaluate Looma as a candidate blessed foundation, including public GitHub home, MIT licensing, package publishing, and token-pyramid maturity. Tracked as Guildhall task `looma-004` and Codex subagent link `link-looma-004-codex-subagent`; the Codex subagent pushed the public MIT repo and recorded npm/package-shape blockers for follow-up.
- [x] Keep Guildhall library-agnostic by mapping Looma and non-Looma systems into the same design proof contract.
- [x] Add DesignFinding, DesignDecision, DesignSystemCandidate, and design-system improvement schemas with persistence placement. Superseded naming note, 2026-06-02: Looma-specific improvement records were generalized to `DesignSystemImprovement`.
- [x] Classify design proof findings as project-specific, reusable pattern, token-system gap, taste guidance gap, or design-system defect.
- [x] Route project-specific findings into project design decisions and reusable findings into design-system candidate improvements.
- [x] Add candidate targets for tokens, core primitives, layout, framework adapters, Storybook, docs, and review rubrics.
- [x] Superseded 2026-06-02: remove optional experimental local Looma development config under `~/.guildhall/config.yaml`.
- [x] Superseded 2026-06-02: remove local Looma hook discovery. Provider-owned reusable design feedback now routes through first-class project graph/domain authority instead of machine-local checkout discovery.
- [x] Superseded 2026-06-02: do not report inactive local Looma hook status. Missing provider projects should appear as graph/project registration or capability-routing work, not as design-feedback API target status.
- [x] Keep portable `DesignSystemCandidate` records as the product contract; provider-owned follow-up is a project graph exchange, not a local write-through acceleration path.
- [x] Add external agent link persistence and API wiring so Guildhall can connect a tracked task to a real Codex subagent handoff.
- [x] Add interactable design-system catalog support for web apps, reusing Storybook/Ladle/docs catalogs when present.
- [x] Add browser design-intent surrogate support for native apps, clearly labeled as approximate.
- [x] Add owner feedback capture for rendered directions, screenshots, selectors, components, and viewports.
- [x] Convert accepted feedback into a design decision packet available to workers, reviewers, MCP, and owner UI.
- [x] Recheck in-process UI work against the current design lens so existing projects benefit when the design-system guidance improves.
- [x] Add a conservative improvement-review backstop so active work can be rechecked against current Guildhall lenses beyond design.
- [x] Surface reusable design-system follow-ups compactly from design proof without making them a new required owner workflow.
- [x] Surface design quality progressively: compact chips/rows first, proof detail on demand, raw machinery only in deeper views.
- [x] Update Pantry Pulse completion boundary to require design foundation, rendered proof, correct control semantics, palette rationale, design reviewer approval, and at least one reusable-vs-local design finding classification.
- [x] Harden abstraction fit across Spec, Worker, Reviewer, API Designer, and TypeScript Engineer so durable schemas, API routes, MCP resources, persistence records, events, and public packets are reviewed for right-sized taxonomy instead of only local reuse.
- [x] Add a consolidated `guildhall://project/design` MCP context resource so agents can inspect design system, taste, catalog/preview, and design feedback without proliferating narrow resource shapes.

**Verification:**

- Focused intake/guild tests proving UI work receives design-quality pressure and reviewers carry the right rubric.
- Schema and classification tests proving reusable design misses are separated from local project decisions.
- Tests proving Guildhall works without local design-system checkout hooks and that reusable findings remain portable unless a graph-routed provider project owns the follow-up.
- Browser proof that design-quality status appears in project/task surfaces without adding a noisy new primary navigation lane.
- Rendered UI smoke now covers Settings Advanced showing design taste memory and the interactable design-system catalog state.
- Pantry Pulse live proof produces rendered screenshots, design decision packet, reusable design-system candidate packet, and design reviewer approval before release acceptance.
- Focused agent/guild tests prove abstraction fit now catches both too-narrow and too-generic durable contract shapes, including generic shell with typed domain payload choices.
- Focused MCP reader/server tests prove the design context resource is discoverable and carries design system, taste, catalog/preview, and accepted feedback summary.

## Milestone 18: Review Calibration

**Purpose:** Make review evidence stronger, starting with UX review risk.

**Files:**

- Follow: `internal/plans/2026-05-25-review-calibration-and-failure-corpus.md`
- Create/modify files named by that detailed implementation plan.

- [x] Add failure corpus schema.
- [x] Add reviewer recipe schema.
- [x] Add calibration result records.
- [x] Add escaped-miss records.
- [x] Add `reviewRisk` profile during task shaping.
- [x] Require artifacts for user-facing review when risk profile demands it.
- [x] Store review audit through persistence boundary.

**Verification:**

- Follow detailed review calibration plan.
- Add at least one source-backed UX corpus case and prove reviewer recipe scoring.
- Focused review-calibration tests prove corpus loading, hidden finding packets, recipe selection, grading, escaped-miss draft creation, persistence-backed validation, task `reviewRisk` projection, and required-artifact readiness.

## Milestone 19: Public Docs, Screenshots, And Release Notes

**Purpose:** Finish the public 0.9 story, verify every feature PR already carried its docs/screenshot updates, and cut the release docs snapshot without stale visual evidence.

**Files:**

- Create: `docs/releases/0.9.0.md`
- Create: `docs/assets/ui-audit/0-9-0/`
- Modify: `docs/guide/quick-start.md`
- Modify: `docs/guide/running.md`
- Modify: `docs/guide/memory-and-recovery.md`
- Modify: `docs/guide/task-lifecycle.md`
- Modify: `docs/web-ui/` pages for every changed owner-facing surface
- Modify: `docs/reference/cli.md`
- Modify: `docs/reference/memory-layout.md`

- [x] Audit every 0.9 implementation PR and confirm public-facing behavior has docs in the same change or an explicit no-docs-needed note.
- [x] Audit every changed UI surface and confirm a fresh 0.9.0 screenshot exists under `docs/assets/ui-audit/0-9-0/`.
- [x] Document runtime-backed execution as shipped behavior only after implemented.
- [x] Document host-run compatibility mode.
- [x] Document runtime image/version/update behavior.
- [x] Document proof paths and completion handoffs.
- [x] Document memory lifecycle and owner controls.
- [x] Document MCP memory/runtime/context resources.
- [x] Update UI docs and screenshots for runtime state, proof paths, memory controls, MCP/context audit views, task shaping, and release readiness where those surfaces change.
- [x] Ensure release notes link to the relevant guide/reference pages instead of repeating all behavior inline.
- [x] Document the release-time docs version snapshot boundary so the 0.9.0 snapshot is cut only after package version and runtime image digest are finalized.

**Verification:**

- `pnpm docs:check-copy`
- `pnpm docs:check-help-sync`
- `pnpm docs:build`
- Browser-verify each changed docs page and screenshot image after `pnpm docs:dev`.
- 0.9 screenshot capture refreshed `projects.png`, `project-overview.png`, `work.png`, `settings-runtime.png`, and `settings-advanced.png`; capture asserted visible page text contained `v0.9.0` and no `v0.8.0`.

## Milestone 20: Internal Benchmarks And Hermes Comparison

**Purpose:** Add a late 0.9 benchmark lane that measures finishability, false-success resistance, auditability, and comparable terminal/coding task performance without making benchmark work block the runtime foundation.

**Files:**

- Follow: `internal/plans/2026-05-27-guildhall-0-9-benchmarks-and-hermes-comparison.md`
- Create: `src/benchmarks/`
- Create: `src/benchmarks/__tests__/`
- Create: `internal/benchmarks/` if fixture data needs a private home
- Modify: `package.json` for benchmark commands only after a runnable harness exists

- [x] Add benchmark run/result schema with task subset hash, model/provider settings, runtime image, timeout/retry policy, automation policy, cost, latency, result, failure class, and evidence refs.
- [x] Add recommended-answer metadata for multiple-choice owner questions, including confidence, reason, risk, and evidence refs.
- [x] Add run-scoped automation policy for benchmarks and CLI runs: ask more often, ask when necessary, fully automated.
- [x] Persist auto-resolution records whenever Guildhall answers a question, approval, or escalation on behalf of the owner.
- [x] Keep project-policy non-delegable decisions blocked unless a benchmark fixture supplies an explicit synthetic answer.
- [x] Add Guildhall lifecycle eval fixtures for shaping, decomposition, worker scope, review, gate, proof path, completion handoff, MCP auditability, and accepted-memory reuse.
- [x] Add lifecycle scorecard metrics for task success, false success, owner interventions, auto-resolutions, unnecessary questions, split quality, proof completeness, handoff quality, memory precision, and auditability.
- [x] Add a TBLite/Terminal-Bench-style adapter spike that runs a tiny shared terminal task through Guildhall's runtime-backed command path.
- [x] Add a SWE-bench-style local fixture lane before attempting public SWE-bench Lite/Verified infrastructure.
- [x] Write the Hermes comparison runbook covering Hermes version/commit, Guildhall version/commit, benchmark dataset/version, task subset hash, model/provider settings, env vars, timeout/retry/budget settings, token/cost/turn/command/latency telemetry, output paths, and unsupported/inconclusive interpretation.
- [x] Produce JSONL and Markdown reports for Guildhall lifecycle, TBLite-smoke, and SWE-local smoke runs.
- [x] Add `guildhall benchmarks compare hermes` as an honest preflight/report command that records blocked prerequisites as `inconclusive` instead of implying a real comparison ran.
- [ ] Produce an actual Hermes comparison run with raw Hermes task output, token/cost telemetry, turn/command/latency data, and quality results. The current preflight is blocked before task execution because this environment has no runnable Hermes CLI, no discovered Hermes benchmark entrypoints, and no configured inference-provider or Modal credentials.
- [x] Keep tau-bench-style policy/tool interaction scenarios and OSWorld/WebArena-style browser/desktop evals as lower-priority follow-ons unless a 0.9 task explicitly needs them.
- [x] Ensure benchmark outputs are internal/redacted by default and do not produce public "Guildhall beats Hermes" claims.

**Verification:**

- `pnpm test -- src/benchmarks`
- `guildhall benchmarks run lifecycle --fixture-set smoke` once the command exists
- `guildhall benchmarks run tblite --subset smoke` or equivalent adapter smoke once the command exists
- `guildhall benchmarks run swe-local --subset smoke`
- Manual comparison runbook exists; `guildhall benchmarks compare hermes` records the current blocker as an inconclusive harness failure. Do not treat the Guildhall smoke report as comparative proof until Hermes task output and usage telemetry exist.

## Release Blockers

- [ ] Runtime-backed command execution works on at least one real registered project.
- [ ] Runtime image publishes to GHCR and is referenced by release manifest with digest.
- [ ] Projects opened by supported macOS Guildhall hosts default to runtime-backed mode.
- [ ] Existing projects have guided migration and rollback.
- [ ] Host-run compatibility mode is labeled and does not claim runtime isolation.
- [ ] Project runtime mounts both project checkout and host `~/.guildhall`.
- [ ] Project runtimes are stopped by default and start on demand.
- [ ] Runtime evidence is visible in UI/API/MCP.
- [ ] Proof paths and completion handoffs are generated for completed non-trivial work.
- [ ] Accepted memory appears in agent context and context-debug proves it.
- [ ] MCP can answer project memory/runtime/context audit without shell fallback.
- [x] Work hierarchy supports nested containing work without owner-facing "parent task" categories, and the default work list hides done work while keeping it discoverable.
- [ ] The Pantry Pulse small-app proof run reaches its defined completion boundary and produces a run report with hierarchy, runtime evidence, proof path, handoff, memory, and MCP audit refs. App creation and browser proof now pass; handoff, memory, and MCP audit refs remain the release-grade gap.
- [ ] Persistence guardrail prevents new unmanaged durable writes for 0.9 features.
- [ ] Release workflow publishes npm/macOS artifacts and runtime image as a compatible set.
- [ ] Every public-facing feature has public docs updated in the feature PR or an explicit no-docs-needed note.
- [ ] Every changed owner-facing UI surface has a fresh screenshot under `docs/assets/ui-audit/0-9-0/`.
- [ ] The 0.9.0 docs snapshot includes the updated docs and screenshots.

## Suggested PR Sequence

Each PR below should carry its own public docs and 0.9.0 screenshots when it changes user-visible behavior. The final docs PR is for release-note stitching, snapshot verification, and any last cross-page cleanup, not for catching up on all feature documentation.

1. Runtime image contract and executable stubs.
2. Release manifest and GHCR workflow.
3. Runtime registry/supervisor skeleton.
4. Guided runtime backend setup.
5. Runtime health checks and migration record.
6. Runtime command execution and evidence.
7. Dev-server/port/browser proof.
8. Capability requests.
9. Persistence boundary core and guardrail.
10. Proof paths/completion handoffs.
11. Memory store/effective memory packet.
12. MCP expansion.
13. Owner-facing UI slices.
14. Flexible work hierarchy and smarter work list.
15. Task readiness/decomposition.
16. Small app proof run.
17. Design quality and taste.
18. Review calibration.
19. Public docs/screenshots/release notes.
20. Internal benchmarks and Hermes comparison.
