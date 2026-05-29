# Guildhall vs Hermes Benchmark Comparison Attempt

Date: 2026-05-28

Status: `BLOCKED_FOR_HERMES_RUN`

This is not a completed comparative benchmark. It records the Guildhall smoke
evidence gathered today, the exact Hermes installation/run attempts, and the
blocker that prevented a Hermes task run.

## Sources Checked

- Guildhall repo: `/Users/matthew/git/oss/guildhall`
- Guildhall branch: `feature/0.9.0-orientation-proof-paths`
- Guildhall commit: `5cdc0db926e7`
- Hermes release tag: `v2026.5.28`
- Hermes release commit: `0c859a1c044c77d24bcc8832f5a27d8b4a50fab7`
- Hermes current main commit: `11d93096b39e2956deae7dbf5b2bdb67a2059521`
- Hermes docs checked:
  - `https://hermes-agent.nousresearch.com/docs/getting-started/installation/`
  - `https://hermes-agent.lzw.me/docs/en/developer-guide/environments`
  - `https://github.com/NousResearch/hermes-agent`

The Hermes environments docs describe TBLite and TerminalBench2 commands under
`environments/benchmarks/...`, but the checked `v2026.5.28` and current `main`
source trees did not contain an `environments/` directory.

## Shared Task Fit

The closest intended shared lane is terminal-task execution:

| Capability | Guildhall lane | Hermes documented lane | Fit |
| --- | --- | --- | --- |
| Terminal smoke | `tblite --subset smoke` | TBLite / TerminalBench2 | Conceptually closest, but Hermes entrypoint missing locally. |
| Coding fixture | `swe-local --subset smoke` | HermesSweEnv docs mention SWE-bench-style training | Not runnable locally; no comparable Hermes command found. |
| Lifecycle/product finishability | `lifecycle --fixture-set smoke` | No direct equivalent found | Guildhall-specific; useful internally, not an apples-to-apples Hermes benchmark. |

## Guildhall Evidence

Build:

```bash
pnpm build
```

Result: passed. Build emitted third-party Svelte warnings from
`svelte-sonner` / `runed`, but produced `dist/cli.js`,
`dist/web/app.js`, `dist/web/app.css`, and `dist/release-manifest.json`.

Benchmark commands:

```bash
node dist/cli.js benchmarks run lifecycle --fixture-set smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/lifecycle
node dist/cli.js benchmarks run tblite --subset smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/tblite
node dist/cli.js benchmarks run swe-local --subset smoke --automation fully-automated --output-dir /tmp/guildhall-hermes-comparison-20260528/guildhall/swe-local
```

Result summary:

| Lane | Result | Failure class | Subset hash | Output files |
| --- | --- | --- | --- | --- |
| Lifecycle smoke | 9/9 pass | `none` | `7600cb2cae178c33` | `lifecycle-95910fe7-6f9d-480d-b34a-132819420d89.{jsonl,md}` |
| TBLite smoke | 1/1 pass | `none` | `0805b9523c1027af` | `tblite-7a03ed25-fcf8-40a6-bf55-d45af7b9c295.{jsonl,md}` |
| SWE-local smoke | 1/1 pass | `none` | `4ddcc87c5f4c82b9` | `swe-local-8da1977a-6caa-4313-a2b0-1b1d23f865a4.{jsonl,md}` |

Telemetry exposed by Guildhall JSONL:

| Field | Lifecycle smoke | TBLite smoke | SWE-local smoke | Interpretation |
| --- | --- | --- | --- | --- |
| Input/output tokens | `0/0` each task | `0/0` | `0/0` | Fixture/deterministic harness, not a live model call. |
| Cost USD | `0` each task | `0` | `0` | Not comparable to a live Hermes model run. |
| Turns | `1` each task | `1` | `1` | Fixture-level placeholder count. |
| Command count | `0` each task | `1` | `0` | Only TBLite smoke exercises runtime command evidence. |
| Latency | `0-1ms` | `4ms` | `0ms` | Local fixture latency, not model/provider latency. |
| Quality metrics | Expected scorecard metrics passed | `task_success=1`, `command_evidence=1` | `task_success=1`, `proof_completeness=1`, `over_editing=0` | Smoke quality is real for the fixture contract but not a live-agent quality comparison. |

## Hermes Evidence

Local availability:

```bash
command -v hermes
test -d "$HOME/.hermes"
```

Result: no `hermes` binary on `PATH`; no `~/.hermes` directory.

Credential/environment scan:

```bash
env | awk -F= '/(OPENAI|OPENROUTER|ANTHROPIC|NOUS|MODAL|HERMES|WANDB|TINKER|API_KEY|TOKEN)/ {print $1"=<redacted>"}' | sort
```

Result: only unrelated `SLACK_MCP_BEARER_TOKEN` was present. No inference or
Modal credentials were available.

Pinned temp clone:

```bash
git clone --depth 1 --branch v2026.5.28 https://github.com/NousResearch/hermes-agent.git /tmp/guildhall-hermes-comparison-20260528/hermes-agent
```

Result: tag peeled to `0c859a1c044c77d24bcc8832f5a27d8b4a50fab7`. The source
tree had no `environments/benchmarks` directory.

Current main temp clone:

```bash
git clone --depth 1 https://github.com/NousResearch/hermes-agent.git /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main
```

Result: commit `11d93096b39e2956deae7dbf5b2bdb67a2059521`. The source tree had
no `environments/` directory.

Temp CLI install/version check:

```bash
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home \
  uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main \
  hermes --version
```

Result:

```text
Hermes Agent v0.15.0 (2026.5.28)
Project: /private/tmp/guildhall-hermes-comparison-20260528/hermes-agent-main
Python: 3.11.13
OpenAI SDK: 2.24.0
Up to date
```

Doctor check:

```bash
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home \
  uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main \
  hermes doctor
```

Result: Hermes core dependencies installed, but `.env` and config were missing,
provider auth was not configured, OpenRouter API was not configured, and the
global `~/.local/bin/hermes` symlink was intentionally not created because this
was a temp install.

Closest local Hermes task attempt:

```bash
HERMES_HOME=/tmp/guildhall-hermes-comparison-20260528/hermes-home \
  uv run --python 3.11 --project /tmp/guildhall-hermes-comparison-20260528/hermes-agent-main \
  hermes --ignore-user-config --yolo -z "Benchmark smoke: create the file /tmp/guildhall-hermes-comparison-20260528/hermes-smoke-output.txt containing exactly guildhall hermes smoke, then report done."
```

Result: failed before any task execution or model call:

```text
hermes_cli.auth.AuthError: No inference provider configured. Run 'hermes model' to choose a provider and model, or set an API key (OPENROUTER_API_KEY, OPENAI_API_KEY, etc.) in ~/.hermes/.env.
```

## Telemetry Comparison

| Field | Guildhall exposed? | Hermes exposed? | Current comparison value |
| --- | --- | --- | --- |
| Input tokens | Yes, `tokenUse.input` in JSONL | Session code exposes `input_tokens`; no Hermes task ran | Guildhall fixture `0`; Hermes missing. |
| Output tokens | Yes, `tokenUse.output` in JSONL | Session code exposes `output_tokens`; no Hermes task ran | Guildhall fixture `0`; Hermes missing. |
| Cache tokens | No field in current Guildhall smoke result | Hermes session store has cache read/write fields | Missing/incomparable in this run. |
| Cost | Yes, `costUsd` in JSONL | Hermes session store and insights estimate cost when sessions exist | Guildhall fixture `0`; Hermes missing. |
| Turns | Yes, `turns` in JSONL | Not confirmed per benchmark task; session/message counts exist | Guildhall fixture `1`; Hermes missing. |
| Command count | Yes, `commandCount` in JSONL | Tool-call counts exist in insights; per-command benchmark count not confirmed | Guildhall TBLite `1`; Hermes missing. |
| Latency | Yes, `durationMs` in JSONL | Session duration exists; per-task benchmark duration not confirmed | Guildhall fixture-only latency; Hermes missing. |
| Quality/result | Yes, pass/fail plus metrics | No task run | Guildhall smoke passed; Hermes missing. |

Hermes token/cost gap: if Hermes runs through normal sessions, usage can be
estimated from `hermes sessions export`, `hermes insights`, or provider API
telemetry. This local run could not confirm per-task token/cost fields for the
documented benchmark scripts because those scripts were not present.

## Interpretation

Guildhall's smoke harness is runnable and produces internal JSONL/Markdown
reports with result, failure-class, evidence, token, cost, turn, command, and
latency fields. The current fixture values are intentionally cheap deterministic
smoke values, not live model-consumption evidence.

Hermes is installable enough to run `hermes --version`, `hermes --help`,
`hermes doctor`, and `hermes insights`, but this environment cannot run a Hermes
benchmark task because two prerequisites are missing:

1. A Hermes source tree containing the documented benchmark entrypoints.
2. A configured inference provider and, for TBLite/TerminalBench2, Modal
   credentials.

Quality-only comparison is not sufficient, and no Hermes quality result exists
anyway. The next valid comparison must collect both quality and consumption
telemetry for both harnesses.

## Next Command

Use this only after choosing a Hermes commit that actually contains
`environments/benchmarks/tblite`:

```bash
cd /tmp/hermes-agent
git checkout <commit-or-tag-with-environments>
HERMES_HOME=/tmp/hermes-home uv run --python 3.11 --project . hermes model
export OPENROUTER_API_KEY=<redacted-or-use-another-configured-provider>
export MODAL_TOKEN_ID=<redacted>
export MODAL_TOKEN_SECRET=<redacted>
HERMES_HOME=/tmp/hermes-home uv run --python 3.11 --project . \
  python environments/benchmarks/tblite/tblite_env.py evaluate \
  --config environments/benchmarks/tblite/default.yaml \
  --env.task_filter <shared-task-id> \
  --openai.model_name <provider/model>
HERMES_HOME=/tmp/hermes-home uv run --python 3.11 --project . \
  hermes sessions export /tmp/hermes-sessions.jsonl
HERMES_HOME=/tmp/hermes-home uv run --python 3.11 --project . \
  hermes insights --days 1
```

If the benchmark script writes its own rollouts instead of Hermes sessions,
collect that raw output and provider telemetry, then mark token/cost as
`direct`, `provider-estimated`, or `missing` per task.
