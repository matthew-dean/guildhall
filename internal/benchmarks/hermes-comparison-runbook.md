# Hermes Comparison Runbook

This runbook is for internal benchmark comparison work. It is not a public
leaderboard script and it should not produce "Guildhall beats Hermes" claims.

## Required Run Metadata

Record these fields before running either harness:

- Hermes version or commit.
- Guildhall version or commit.
- Benchmark dataset and version.
- Task subset hash.
- Model provider, model name, temperature, reasoning settings, and tool policy.
- Runtime backend and image tag or digest.
- Environment variables and secrets required, with redaction notes.
- Timeout, retry, turn, and budget settings.
- Token/cost telemetry policy for each harness: input tokens, output tokens,
  cache tokens if exposed, estimated or actual USD cost, turns, command count,
  latency, and the source of each number.
- Output directory for JSONL, Markdown, command logs, and evidence refs.

Raw run output belongs under `internal/benchmarks/runs/`, which is ignored.
When a run teaches us something durable, write a compact curated entry under
`internal/benchmarks/history/` instead of committing raw sessions, generated
projects, screenshots, or bulky comparison JSON.

## Guildhall Lifecycle Smoke

```bash
guildhall benchmarks run lifecycle --fixture-set smoke --automation fully-automated
```

The report must include shaping, decomposition, proof-path, completion-handoff,
memory, and MCP auditability metrics. Treat a policy-blocked task as
`inconclusive` unless the fixture intentionally tests a non-delegable decision.

The smoke fixture harness records `tokenUse`, `costUsd`, `turns`,
`commandCount`, and `durationMs` in each JSONL result. Today the deterministic
smoke fixtures use `modelProvider: fixture` and `model: deterministic-smoke`,
so token and cost fields are expected to be `0`. Do not compare these fixture
cost fields against a live Hermes model run as if they were equivalent.

## Guildhall TBLite Smoke

```bash
guildhall benchmarks run tblite --subset smoke --automation fully-automated
```

The adapter must run through Guildhall's runtime command path and produce
runtime command evidence. A harness failure is not the same thing as a task
failure; keep those failure classes separate.

For terminal-style comparisons, also record command count and latency from the
Guildhall result record. If the fixture command is deterministic and does not
call a model, token and cost are not comparable with a live Hermes run.

## Hermes Run

Run Hermes against the same task subset and model/provider settings whenever
Hermes supports the benchmark shape. Save the raw Hermes output next to the
Guildhall report and record unsupported tasks as `unsupported`, not failed.

Hermes is an optional Guildhall development comparator. It must not be added to
Guildhall's runtime dependencies, optional dependencies, bundled dependencies,
or publish `files` allow-list. Local development checkouts live under
`.guildhall/dev-tools/`, which is ignored and never distributed. Prepare that
local checkout with:

```bash
pnpm dev:hermes:install
pnpm benchmarks:compare:hermes
```

As of the first local check on 2026-05-28, `hermes` was not installed on `PATH`.
A non-invasive temp install of NousResearch/hermes-agent `v2026.5.28`
(`0c859a1c044c77d24bcc8832f5a27d8b4a50fab7`) succeeded, but both that tag and
current `main` (`11d93096b39e2956deae7dbf5b2bdb67a2059521`) lacked the
documented `environments/benchmarks/tblite` and
`environments/benchmarks/terminalbench_2` entrypoints. The temp Hermes home also
had no configured inference provider, no OpenRouter/OpenAI-style API key, and no
Modal credentials. A Hermes one-shot attempt failed before any model call with:

```text
AuthError: No inference provider configured. Run 'hermes model' to choose a provider and model, or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.
```

On the later local smoke check, Hermes was configured at `<home>/.hermes`
and `Hermes Agent v0.15.1 (2026.5.29)` was runnable. The normal one-shot path
successfully created a file, and `hermes sessions export` exposed session-level
token fields. Cost was still not reliable for that run:

```text
input_tokens: 12175
output_tokens: 97
cache_read_tokens: 11776
estimated_cost_usd: 0
actual_cost_usd: null
cost_status: unknown
cost_source: none
```

The current checkout still lacks the documented TBLite/TerminalBench entrypoints.
It has `tools/environments/*`, `hermes -z`, `hermes sessions export`, and
`hermes insights`. That means the next fair comparison should use a neutral CLI
runner around both normal tools, and only add a Hermes-native benchmark lane if
we find a real current entrypoint.

On 2026-05-29, Guildhall added that neutral CLI comparator as a local dev
script:

```bash
pnpm benchmarks:compare:hermes-quality
```

or, after build:

```bash
node scripts/compare-hermes-quality.mjs \
  --output-dir internal/benchmarks/runs/<run-id>/neutral-hermes
```

The script creates separate temp projects, runs `guildhall task run-once` and
`hermes -z` with the same prompt, grades user-visible artifacts first, and
records token/cost telemetry only as secondary context. It deliberately avoids
Hermes repo internals and does not require `environments/benchmarks/*`.
Guildhall's own `.guildhall/` metadata is harness state, not user output, so the
quality score ignores it when checking for unexpected project files.

2026-05-29 smoke result:

- Durable summary: `internal/benchmarks/history/2026-05-29-hermes-quality.md`
- Raw local report: `internal/benchmarks/runs/2026-05-29-quality/neutral-hermes-rerun/quality-comparison-report.md`
- Guildhall: 100/100 on the deterministic file task.
- Hermes: 100/100 on the deterministic file task.
- Hermes completed faster on this direct task; Guildhall used its normal
  pressure-test/review/gate path. Treat that as latency/process telemetry, not
  a quality win for either harness.

The same comparator also supports two app-quality runs. Keep them separate:

- `app-explicit`: the prompt includes behavior, palette, accessibility, and
  quality constraints. This measures instruction-following and implementation.
- `app-infer`: the prompt is intentionally sparse. This measures whether the
  harness infers product shape and design quality instead of being handed the
  palette and quality bar.

```bash
pnpm benchmarks:compare:hermes-app-explicit
pnpm benchmarks:compare:hermes-app-infer
```

or:

```bash
node scripts/compare-hermes-quality.mjs --mode app-explicit \
  --output-dir internal/benchmarks/runs/<run-id>/app-explicit-hermes

node scripts/compare-hermes-quality.mjs --mode app-infer \
  --output-dir internal/benchmarks/runs/<run-id>/app-hermes
```

Both app modes ask the harnesses to build a dependency-free Pantry Pulse web
app, serve the generated static app, run browser checks for heading, seeded
items, filter behavior, Mark used behavior, mobile/desktop screenshots, and
palette fit, then embed screenshots in the Markdown report.

2026-05-29 explicit app-quality result:

- Durable summary: `internal/benchmarks/history/2026-05-29-hermes-quality.md`
- Raw local report: `internal/benchmarks/runs/2026-05-29-quality/app-hermes/quality-comparison-report.md`
- Initial Guildhall score: 5/100. That score was misleading: the worker created
  `index.html` in the task worktree, but the comparator only inspected the
  project root and therefore produced no Guildhall screenshots.
- Regenerated Guildhall artifact score after fixing worktree discovery:
  87/100. The app passed browser load, seeded item, filter, Mark used,
  screenshot, warm-palette, and non-blue-primary checks. It correctly lost
  points because the artifact was still worktree-only and the run had not exited
  cleanly.
- Guildhall regenerated screenshot evidence:
  `internal/benchmarks/runs/2026-05-29-quality/app-hermes/screenshots/guildhall-regenerated/desktop.png`
  and
  `internal/benchmarks/runs/2026-05-29-quality/app-hermes/screenshots/guildhall-regenerated/mobile.png`.
- Hermes: 100/100 on deterministic browser checks. It produced a static app,
  passed filter and Mark used behavior, and used warm/sage/amber/coral tokens.
- Interpretation: this result proves Hermes followed an explicit quality brief
  well. It does not prove Hermes inferred the design direction from sparse
  product intent, because the prompt handed it the palette and quality bar.
- Remaining Guildhall issue: a benchmark run must still land the accepted
  worktree result into the project root before completion. Worktree-only output
  is useful evidence, not a complete pass.
- Visual judgment: Hermes passed the deterministic quality bar, but the
  screenshot is still a modest mobile utility, not yet a strong
  app-store-caliber design. The next comparator iteration should add a stricter
  visual-review score, not only behavior/palette gates.

If a current Hermes-native benchmark entrypoint is found, the setup should look
like this:

```bash
pnpm dev:hermes:install -- --ref <commit-or-tag-that-contains-environments/benchmarks/tblite>
cd .guildhall/dev-tools/hermes-agent
git checkout <commit-or-tag-that-contains-environments/benchmarks/tblite>
HERMES_HOME=../hermes-home uv run --python 3.11 --project . hermes model
export OPENROUTER_API_KEY=<redacted-or-use-another-configured-provider>
export MODAL_TOKEN_ID=<redacted>
export MODAL_TOKEN_SECRET=<redacted>
HERMES_HOME=../hermes-home uv run --python 3.11 --project . \
  python environments/benchmarks/tblite/tblite_env.py evaluate \
  --config environments/benchmarks/tblite/default.yaml \
  --env.task_filter <shared-task-id> \
  --openai.model_name <provider/model>
```

If Hermes runs through its normal session path rather than a benchmark script,
export session history with `hermes sessions export` and summarize usage with
`hermes insights`. Current Hermes code exposes session-level `input_tokens`,
`output_tokens`, cache tokens, total tokens, estimated cost, and cost status in
its session store, but the benchmark scripts must either preserve those fields
per task or the comparison must state that token/cost came from provider logs or
cannot be recovered per task.

For the immediate neutral CLI comparator, use this shape:

```bash
# Guildhall lane
guildhall task run-once "$TASK_PROMPT" \
  --project "$GUILDHALL_TEMP_PROJECT" \
  --automation fully-automated \
  --proof commands \
  --output "$OUT/guildhall-report.json"

# Hermes lane
(
  cd "$HERMES_TEMP_PROJECT"
  HERMES_HOME="$HOME/.hermes" hermes -z "$TASK_PROMPT" --ignore-rules
)
HERMES_HOME="$HOME/.hermes" hermes sessions export \
  --session-id "$HERMES_SESSION_ID" \
  "$OUT/hermes-session.jsonl"
HERMES_HOME="$HOME/.hermes" hermes insights --days 1 > "$OUT/hermes-insights.txt"
```

The comparator should normalize both outputs into one schema with:

- Task id, prompt, project path, and acceptance checks.
- Result: `pass`, `fail`, `unsupported`, or `inconclusive`.
- Failure class: task failure, harness failure, provider failure, policy block,
  timeout, or unsupported surface.
- Duration, model/provider, tokens, cache tokens, cost, and cost status.
- Tool/command count and raw evidence refs.
- Final artifact checks, including exact file contents for file tasks.

The comparison report should answer:

- Where did Guildhall's task shaping, proof, handoff, memory, or auditability
  structure improve the result?
- Where did Hermes' simpler or broader agent runtime do better?
- Which failures were caused by the model, the benchmark adapter, the runtime,
  or the workflow?
- Which tasks do not map cleanly between the two harnesses?
- Which token, cost, turn, command, and latency fields were directly exposed,
  estimated from logs, or missing/incomparable for each harness?

## Output Policy

Benchmark outputs are internal and redacted by default. Before sharing anything
publicly, rerun with pinned commits, inspect raw evidence, remove secrets and
private paths, and review whether the benchmark actually measures the claim.
