# Guildhall 0.10.0 OpenRouter Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class OpenRouter support that guides Guildhall users toward reliable, cost-aware model setups instead of merely accepting an OpenAI-compatible URL.

**Architecture:** Treat OpenRouter as a named provider profile built on the existing OpenAI-compatible transport, with OpenRouter-specific attribution, routing, privacy, and model-lane policy layered above the generic client. Keep recommendations evidence-backed through Guildhall's model bakeoff and lifecycle benchmark lanes, and make the setup UI explain which profile is best for the user's trust, cost, privacy, and throughput posture.

**Tech Stack:** TypeScript, Vitest, Svelte, VitePress, OpenAI-compatible chat completions, OpenRouter provider routing, Guildhall provider runtime config, Guildhall model catalog, model bakeoff, provider health and concurrency controls.

---

## Why This Belongs In 0.10.0

Guildhall already has the beginnings of a strong provider story: normalized
OpenAI-compatible request handling, role/model policy, cached-token telemetry,
structured-output request options, provider concurrency, and model bakeoff
reports. OpenRouter should build on that work rather than become a one-off
endpoint field.

The 0.10.0 product goal is:

> A new user can paste an OpenRouter key, choose a Guildhall-recommended setup,
> understand the cost/privacy/quality tradeoff, and run tool-heavy Guildhall
> work with routing settings that match the role instead of hoping a random
> model/provider combination behaves well.

This is also the right shape if Guildhall should later appear in OpenRouter's
agent or app surfaces. OpenRouter's current public app-attribution docs require
`HTTP-Referer` for app tracking, support `X-OpenRouter-Title` for display name,
and accept `X-OpenRouter-Categories` values such as `cli-agent`. For localhost
development, their docs specifically say to include a title header as well.

## Source Notes

- OpenRouter Agent SDK overview:
  `https://openrouter.ai/docs/agent-sdk/overview`
- OpenRouter custom agent TUI guide:
  `https://openrouter.ai/docs/cookbook/building-agents/create-agent-harness-tui`
- OpenRouter long-horizon agent guide:
  `https://openrouter.ai/docs/cookbook/building-agents/long-horizon-agents`
- OpenRouter app attribution:
  `https://openrouter.ai/docs/app-attribution`
- OpenRouter provider routing:
  `https://openrouter.ai/docs/guides/routing/provider-selection`
- OpenRouter Auto Exacto:
  `https://openrouter.ai/docs/guides/routing/auto-exacto`
- Guildhall provider abstraction note:
  `internal/design-notes/provider-abstraction-and-throughput.md`
- Guildhall DeepInfra/OpenAI-compatible hardening plan:
  `docs/superpowers/plans/2026-05-25-deepinfra-api-design-hardening.md`
- Guildhall open model recommendations:
  `docs/guide/open-models.md`

## Product Principles

1. **Guide the setup, do not just support the endpoint.**
   OpenRouter exposes many models and provider routes. Guildhall should present
   tested role-lane presets, not a blank model text box as the happy path.

2. **Route by role.**
   Spec, worker, reviewer, gate, and context-indexer lanes need different
   model qualities, output constraints, latency tolerance, and cost posture.

3. **Preserve deterministic proof.**
   OpenRouter routing can improve availability and throughput, but Guildhall
   must still score hard facts first: tool-call validity, structured output,
   verification results, proof paths, and false-success resistance.

4. **Make privacy and cost visible.**
   ZDR, data-collection policy, max price, fallback behavior, and provider
   allow/deny choices should be explicit setup choices, not hidden request
   details.

5. **Attribute Guildhall clearly when the owner opts into OpenRouter.**
   Requests to OpenRouter should identify Guildhall for analytics/listing
   readiness without leaking project names, task text, or local paths.

## Recommended User-Facing Presets

### Best Default

Use this when the owner wants the best chance of high-quality Guildhall work
without hand-tuning every lane.

- Provider route: OpenRouter managed routing.
- Tool calls: rely on OpenRouter's tool-calling routing signals unless a
  Guildhall bakeoff finds a better pinned route.
- Structured lanes: require providers that support requested parameters.
- Cost posture: visible but not cheapest-first.
- Privacy posture: normal OpenRouter account policy unless the owner chooses a
  stricter profile.

### Budget

Use this when the owner wants useful automation at lower cost.

- Provider route: price-aware routing where it does not harm tool or structured
  output reliability.
- Worker lane: use a tested lower-cost coding model from the Guildhall bakeoff.
- Reviewer/gate lanes: favor faster lower-cost models and deterministic checks.
- Guardrail: do not let a cheap model win if it increases false-success risk.

### Privacy Sensitive

Use this when the owner is working on code or data where provider handling
matters more than cost.

- Provider route: enforce ZDR where available.
- Data collection: deny providers that may store prompts when OpenRouter
  supports that preference.
- Fallbacks: visible and configurable; default to no hidden broadening of data
  handling.
- UI copy: explain that stricter routing may reduce model/provider availability.

### Reproducible Benchmark

Use this for model bakeoffs, release evaluation, and public claims.

- Provider route: pin model and provider route where possible.
- Fallbacks: disabled unless the report explicitly marks fallback behavior.
- Report: include model slug, provider preferences, fallback policy, token use,
  latency, tool-call validity, structured-output validity, cost, and evidence.

## OpenRouter Listing Readiness

OpenRouter's current public app-attribution docs describe the app/rankings path,
not a separate submission API for a generic agent-harness directory. The
minimum Guildhall implementation should therefore prepare both:

- **API attribution:** send `HTTP-Referer`, `X-OpenRouter-Title`, and
  `X-OpenRouter-Categories` on OpenRouter requests.
- **Public listing packet:** keep a small internal checklist with Guildhall's
  app URL, GitHub URL, short description, category (`cli-agent`), supported
  surfaces, setup steps, and proof that real OpenRouter traffic attributes to
  Guildhall.

If OpenRouter has a separate human-reviewed agent harness page by the time
0.10.0 ships, the listing packet should be enough to submit without rewriting
the feature.

## Files And Responsibilities

- `src/runtime/provider-runtime-config.ts`
  Parse and normalize a named `openrouter-api` provider profile, while keeping
  existing OpenAI-compatible providers working.

- `src/runtime/provider-selection.ts`
  Prefer `openrouter-api` when explicitly selected and keep provider/model
  mismatch warnings useful.

- `src/providers/openai-client.ts`
  Continue to own the OpenAI-compatible transport. Add optional request headers
  and OpenRouter provider preferences without coupling non-OpenRouter clients
  to OpenRouter defaults.

- `src/engine/client.ts`
  Carry provider-neutral request extras needed for OpenRouter routing,
  attribution, and policy.

- `src/runtime/model-api-policy.ts`
  Resolve role-specific OpenRouter defaults such as structured-output
  requirements, fallback behavior, routing sort, ZDR, and max-price policy.

- `src/core/models.ts`
  Add OpenRouter-facing recommended model entries or aliases only after live
  bakeoff evidence exists.

- `src/runtime/model-bakeoff.ts`
  Add OpenRouter live evaluation mode and report the provider routing settings
  used for each run.

- `src/web/surfaces/SetupWizard.svelte`
  Offer OpenRouter as a guided hosted provider setup path.

- `src/web/surfaces/project/SettingsTab.svelte`
  Show selected preset, privacy/cost posture, and provider health.

- `docs/guide/open-models.md`
  Explain recommended OpenRouter setups in public, reader-facing language after
  implementation has real evidence.

- `docs/web-ui/providers.md`
  Document how to configure OpenRouter through the Providers page after the UI
  exists.

- `docs/reference/env.md`
  Add environment variables for OpenRouter key, base URL override, attribution,
  and optional default routing posture.

- `internal/audits/flow-audit.md`
  Keep a live checklist item for browser-testing provider setup and guidance.

## Task 1: Add OpenRouter Provider Profile Shape

**Files:**

- Modify: `src/runtime/provider-runtime-config.ts`
- Modify: `src/runtime/provider-selection.ts`
- Test: `src/runtime/__tests__/provider-runtime-config.test.ts`
- Test: `src/runtime/__tests__/provider-selection.test.ts`

- [ ] **Step 1: Add failing provider config tests**

  Add tests proving that Guildhall recognizes `openrouter-api` as a named
  hosted provider profile with:

  - `OPENROUTER_API_KEY`;
  - default base URL `https://openrouter.ai/api/v1`;
  - optional saved connection name;
  - selected preset: `best-default`, `budget`, `privacy-sensitive`, or
    `reproducible-benchmark`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

  Run:

  ```bash
  pnpm vitest run \
    src/runtime/__tests__/provider-runtime-config.test.ts \
    src/runtime/__tests__/provider-selection.test.ts \
    --reporter=dot
  ```

  Expected: tests fail because `openrouter-api` is not recognized.

- [ ] **Step 3: Implement the provider profile**

  Extend the provider runtime config parser and provider selection code so
  `openrouter-api` is distinct from generic `openai-api` in user-facing state
  while still reusing the OpenAI-compatible transport internally.

- [ ] **Step 4: Run the focused tests**

  Run the same Vitest command. Expected: all focused provider profile tests pass.

## Task 2: Add OpenRouter Attribution And Routing Request Fields

**Files:**

- Modify: `src/engine/client.ts`
- Modify: `src/providers/openai-client.ts`
- Test: `src/providers/__tests__/openai-client.test.ts`

- [ ] **Step 1: Add failing transport tests**

  Add tests proving that OpenRouter requests can send:

  - `HTTP-Referer`;
  - `X-OpenRouter-Title`;
  - `X-OpenRouter-Categories`;
  - `provider.require_parameters`;
  - `provider.allow_fallbacks`;
  - `provider.sort`;
  - `provider.zdr`;
  - `provider.data_collection`;
  - `provider.only`;
  - `provider.ignore`;
  - `provider.max_price`.

  Also prove these fields are omitted for ordinary local OpenAI-compatible
  server calls unless explicitly supplied.

- [ ] **Step 2: Run the focused transport test**

  Run:

  ```bash
  pnpm vitest run src/providers/__tests__/openai-client.test.ts --reporter=dot
  ```

  Expected: the new tests fail because the request fields are not forwarded.

- [ ] **Step 3: Implement minimal request support**

  Add provider-neutral optional fields to `ApiMessageRequest`, then forward
  them in `OpenAICompatibleClient` only when supplied. Keep existing behavior
  that strips unsupported OpenAI-compatible extras after strict local-server
  failures.

- [ ] **Step 4: Run the focused transport test**

  Run the same Vitest command. Expected: all OpenAI-compatible client tests
  pass.

## Task 3: Resolve Role-Specific OpenRouter Presets

**Files:**

- Modify: `src/runtime/model-api-policy.ts`
- Modify: `src/runtime/provider-concurrency.ts`
- Test: `src/runtime/__tests__/model-api-policy.test.ts`
- Test: `src/runtime/__tests__/provider-client-pool.test.ts`

- [ ] **Step 1: Add failing policy tests**

  Cover the four presets:

  - `best-default` uses parameter-compatible routing for structured lanes and
    does not force cheapest-first routing for tool-heavy requests.
  - `budget` allows price sorting only when a lane is not marked as
    strict-tool or strict-structured.
  - `privacy-sensitive` sets ZDR/data-handling preferences and keeps fallback
    broadening visible.
  - `reproducible-benchmark` pins provider choices where supplied and disables
    fallback unless the run explicitly allows it.

- [ ] **Step 2: Run policy tests and confirm failure**

  Run:

  ```bash
  pnpm vitest run \
    src/runtime/__tests__/model-api-policy.test.ts \
    src/runtime/__tests__/provider-client-pool.test.ts \
    --reporter=dot
  ```

  Expected: new preset tests fail.

- [ ] **Step 3: Implement preset resolution**

  Implement a pure resolver that accepts role, selected model, selected preset,
  and optional user overrides, then returns request extras for the provider
  call. Keep the resolver deterministic and testable without network access.

- [ ] **Step 4: Run policy tests**

  Run the same Vitest command. Expected: all focused policy tests pass.

## Task 4: Add Guided UI Setup

**Files:**

- Modify: `src/runtime/serve.ts`
- Modify: `src/web/surfaces/SetupWizard.svelte`
- Modify: `src/web/surfaces/project/SettingsTab.svelte`
- Test: `src/runtime/__tests__/serve-providers.test.ts`
- Test: `src/web/surfaces/__tests__/SetupWizard.svelte.test.ts`
- Test: `src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts`

- [ ] **Step 1: Add failing API and UI tests**

  Tests should prove the UI:

  - lists OpenRouter as a hosted provider;
  - accepts an OpenRouter API key without asking for a generic base URL first;
  - offers the four presets in reader-facing language;
  - shows cost/privacy/fallback consequences before saving;
  - avoids storing attribution headers that contain project names or local
    paths.

- [ ] **Step 2: Run focused API and UI tests**

  Run:

  ```bash
  pnpm vitest run \
    src/runtime/__tests__/serve-providers.test.ts \
    src/web/surfaces/__tests__/SetupWizard.svelte.test.ts \
    src/web/surfaces/project/__tests__/SettingsTab.svelte.test.ts \
    --reporter=dot
  ```

  Expected: new OpenRouter UI tests fail.

- [ ] **Step 3: Implement guided setup**

  Add the OpenRouter card and settings controls using the existing provider
  save/read APIs. The default setup path should be "Best default" rather than a
  blank advanced form.

- [ ] **Step 4: Run focused API and UI tests**

  Run the same Vitest command. Expected: all focused tests pass.

## Task 5: Add OpenRouter Live Bakeoff Mode

**Files:**

- Modify: `src/runtime/model-bakeoff.ts`
- Modify: `scripts/model-bakeoff.mjs`
- Test: `src/runtime/__tests__/model-bakeoff.test.ts`

- [ ] **Step 1: Add failing bakeoff tests**

  Tests should prove a live OpenRouter bakeoff report records:

  - provider kind `openrouter-api`;
  - model slug;
  - preset;
  - provider routing preferences;
  - fallback policy;
  - structured-output validity;
  - tool-call validity;
  - usage and cached-token details when reported;
  - latency and failure class.

- [ ] **Step 2: Run bakeoff tests**

  Run:

  ```bash
  pnpm vitest run src/runtime/__tests__/model-bakeoff.test.ts --reporter=dot
  ```

  Expected: new OpenRouter report tests fail.

- [ ] **Step 3: Implement OpenRouter bakeoff report fields**

  Add report fields without requiring live network calls in unit tests. Real
  live bakeoff remains opt-in and requires `OPENROUTER_API_KEY`.

- [ ] **Step 4: Run bakeoff tests**

  Run the same Vitest command. Expected: all focused bakeoff tests pass.

## Task 6: Update Model Catalog From Evidence

**Files:**

- Modify: `src/core/models.ts`
- Modify: `docs/guide/open-models.md`
- Test: `src/core/__tests__/models.test.ts`

- [ ] **Step 1: Run a small live OpenRouter bakeoff**

  Run an opt-in candidate set with `OPENROUTER_API_KEY` configured:

  ```bash
  guildhall model-bakeoff --live \
    --provider openrouter-api \
    --preset reproducible-benchmark \
    --models openai/gpt-5-mini,anthropic/claude-sonnet-4,deepseek/deepseek-chat \
    --judge-model openai/gpt-5-mini
  ```

  Expected: a JSON and Markdown report that includes the routing settings and
  hard validity checks.

- [ ] **Step 2: Add catalog tests for accepted recommendations**

  Only add model catalog entries or recommendation changes for models that
  passed the role-specific evidence threshold. Test that every OpenRouter
  recommendation names a role, model slug, evidence note, and watch-for note.

- [ ] **Step 3: Run model tests**

  Run:

  ```bash
  pnpm vitest run src/core/__tests__/models.test.ts --reporter=dot
  ```

  Expected: new recommendation tests fail before catalog updates.

- [ ] **Step 4: Update catalog and public recommendation copy**

  Add only evidence-backed OpenRouter recommendations. Public docs should say
  what setup readers should choose and why, not merely that OpenRouter is
  supported.

- [ ] **Step 5: Run model tests**

  Run the same Vitest command. Expected: all focused model tests pass.

## Task 7: Prepare OpenRouter Listing Packet

**Files:**

- Create: `internal/research/openrouter-listing-readiness.md`
- Modify: `README.md`
- Modify: `docs/guide/open-models.md`

- [ ] **Step 1: Create listing-readiness note**

  Record:

  - Guildhall app URL;
  - GitHub repository URL;
  - short product description;
  - category candidates, starting with `cli-agent`;
  - app attribution headers sent by Guildhall;
  - screenshots or proof paths that show OpenRouter setup;
  - contact or submission route if OpenRouter publishes one before release.

- [ ] **Step 2: Add public README/docs copy after implementation**

  Add a concise public mention that Guildhall supports guided OpenRouter setup,
  with a link to the provider docs page and model recommendations.

- [ ] **Step 3: Verify docs**

  Run:

  ```bash
  pnpm docs:check-copy
  pnpm docs:build
  ```

  Expected: docs copy checks and VitePress build pass.

## Task 8: Browser-Proof The Setup Flow

**Files:**

- Modify: `internal/audits/flow-audit.md`
- Create or refresh: `docs/assets/ui-audit/0-10-0/providers-openrouter.png`

- [ ] **Step 1: Start the local web service**

  Start Guildhall in the normal local-dev way for this repo and open the
  Providers or Settings surface in the browser.

- [ ] **Step 2: Verify the OpenRouter setup path**

  Browser proof should cover:

  - OpenRouter appears as a hosted provider;
  - the API key field is clear;
  - preset choices are understandable;
  - privacy/cost/fallback language is visible before save;
  - saved OpenRouter state appears in project readiness/provider indicators;
  - no project path, task title, or local username appears in attribution
    headers or UI copy.

- [ ] **Step 3: Capture screenshot and update audit evidence**

  Save a screenshot under `docs/assets/ui-audit/0-10-0/` and update
  `internal/audits/flow-audit.md` with the exact proof path and commands.

## Release Acceptance

0.10.0 OpenRouter support is ready when:

- `openrouter-api` is a named provider path, not just a custom URL example.
- OpenRouter attribution headers are sent only for OpenRouter requests.
- App attribution uses a stable Guildhall URL/title/category and does not leak
  local project information.
- Role-specific presets resolve to visible request policy.
- Structured/tool-heavy lanes prefer provider routes that support required
  parameters.
- Privacy-sensitive setup can request stricter provider data handling where
  OpenRouter supports it.
- Reproducible benchmark mode records model, provider preferences, fallback
  policy, and evidence.
- OpenRouter recommendations in public docs are backed by live Guildhall
  bakeoff evidence.
- Provider setup is browser-verified and documented with a 0.10.0 screenshot.

## Verification Commands

Run the focused checks while implementing each task, then run this release-slice
set before marking the feature complete:

```bash
pnpm vitest run \
  src/providers/__tests__/openai-client.test.ts \
  src/runtime/__tests__/provider-runtime-config.test.ts \
  src/runtime/__tests__/provider-selection.test.ts \
  src/runtime/__tests__/model-api-policy.test.ts \
  src/runtime/__tests__/model-bakeoff.test.ts \
  src/core/__tests__/models.test.ts \
  --reporter=dot

pnpm typecheck
pnpm docs:check-copy
pnpm docs:build
git diff --check
```
