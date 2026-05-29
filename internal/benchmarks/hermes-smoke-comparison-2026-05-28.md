# Guildhall vs Hermes Smoke Comparison - 2026-05-28

This is an internal smoke comparison, not a benchmark result and not a public
leaderboard claim. The goal was to prove what can run locally right now, expose
any blocking gaps, and decide what a fair benchmark harness needs next.

## Environment

- Guildhall: local repo build from `/Users/matthew/git/oss/guildhall`.
- Hermes: `Hermes Agent v0.15.1 (2026.5.29)`.
- Hermes home: `/Users/matthew/.hermes`.
- Hermes project: `/Users/matthew/.hermes/hermes-agent`.
- Smoke output root: `/tmp/guildhall-hermes-smoke-20260528-214434`.

## Smoke Results

| Lane | Result | Evidence |
| --- | --- | --- |
| Guildhall deterministic lifecycle smoke | Pass, 9/9 | `/tmp/guildhall-hermes-smoke-20260528-214434/guildhall/lifecycle/lifecycle-07eadfa7-e2fe-4c52-b804-e03af4c474d5.md` |
| Guildhall deterministic SWE-local smoke | Pass, 1/1 | `/tmp/guildhall-hermes-smoke-20260528-214434/guildhall/swe-local/swe-local-d93f43f7-6cb1-43ab-8b52-be08ab20260e.md` |
| Hermes one-shot file creation | Pass | `/tmp/guildhall-hermes-smoke-20260528-214434/hermes-work/hermes_smoke.txt` contains `HERMES_SMOKE_OK`. |
| Guildhall live `task run-once` file creation | Failed smoke / useful gap | No `guildhall_smoke.txt`; no `run-once-report.json`; task looped in spec review until stopped. |
| Hermes benchmark preflight | Inconclusive | `/tmp/guildhall-hermes-smoke-20260528-214434/preflight/hermes-compare-89d52b8c-ea0d-41bb-aa2b-569c7edc47ea.md` |

## Commands Run

```bash
node dist/cli.js benchmarks run lifecycle \
  --fixture-set smoke \
  --automation fully-automated \
  --output-dir /tmp/guildhall-hermes-smoke-20260528-214434/guildhall/lifecycle

node dist/cli.js benchmarks run swe-local \
  --subset smoke \
  --automation fully-automated \
  --output-dir /tmp/guildhall-hermes-smoke-20260528-214434/guildhall/swe-local

node dist/cli.js benchmarks compare hermes \
  --hermes-root "$HOME/.hermes/hermes-agent" \
  --output-dir /tmp/guildhall-hermes-smoke-20260528-214434/preflight

HERMES_HOME="$HOME/.hermes" hermes -z \
  'Create a file named hermes_smoke.txt in the current directory containing exactly HERMES_SMOKE_OK, then reply with exactly DONE.' \
  --ignore-rules

node /Users/matthew/git/oss/guildhall/dist/cli.js task run-once \
  'Create a file named guildhall_smoke.txt in the project root containing exactly GUILDHALL_SMOKE_OK.' \
  --project /tmp/guildhall-hermes-smoke-20260528-214434/guildhall-runonce-project \
  --automation fully-automated \
  --proof commands \
  --output /tmp/guildhall-hermes-smoke-20260528-214434/guildhall/run-once-report.json \
  --max-ticks 12
```

## Guildhall Live Run Finding

The live `run-once` lane created a task and successfully resolved owner
checkpoints through the central fully automated policy, but it did not advance to
implementation. It repeatedly returned to `spec_review` with this approval
failure:

```text
Spec is not ready for approval: Product brief must name the user/project job and observable success metric.
```

The stored task state did contain a `productBrief`, a spec with an explicit
product brief, acceptance criteria, and a completion boundary. The progress log
also recorded that the spec agent could not use the `update-product-brief` tool:

```text
update-product-brief tool consistently fails (no params, rejects all calls).
Product brief content is embedded in spec. Pipeline may need to accept
spec-embedded brief or fix tool.
```

That makes this a Guildhall runtime/spec-quality wiring bug, not a missing human
approval problem. Fully automated mode did the right kind of thing by not
waiting for the owner, but the normal path still got trapped in a revision loop.

## Hermes Smoke Finding

Hermes' one-shot path is operational in this local setup. It created the file
and replied `DONE`.

Hermes session telemetry is exportable:

```text
session: 20260528_214449_5845ee
model: deepseek-ai/DeepSeek-V4-Flash
input_tokens: 12175
output_tokens: 97
cache_read_tokens: 11776
tool_call_count: 1
api_call_count: 2
estimated_cost_usd: 0
actual_cost_usd: null
cost_status: unknown
cost_source: none
```

So Hermes can provide token evidence for this lane, but this provider/model path
did not provide reliable cost evidence.

## What This Proves

Guildhall has deterministic smoke harnesses that pass and produce structured
reports. Hermes has a simple prompt-to-file CLI path that works locally right
now.

Guildhall's normal live fully automated request-to-completion path is not yet
smoke-green for even a tiny file task. That is the next correctness bug to fix
before we claim an end-to-end benchmark comparison.

The current Hermes checkout does not contain the previously documented
`environments/benchmarks/tblite` or `environments/benchmarks/terminalbench_2`
entrypoints. It does contain `tools/environments/*`, session export, and
insights. That means the immediate comparable path is a neutral external runner
around both tools' normal CLI flows, not the old TBLite/TerminalBench command.

## Benchmark Comparison Plan

1. Define a shared task manifest with exact acceptance checks. Start with
   no-UI file tasks and tiny repo edits, then graduate to small app tasks.
2. Add a Guildhall external benchmark lane that runs `guildhall task run-once`
   in a fresh temp project with `--automation fully-automated`, captures stage
   transitions, final files, proof commands, tokens/cost when exposed, and the
   final report.
3. Add a Hermes external benchmark lane that runs `hermes -z` in a matching temp
   project, exports the exact session with `hermes sessions export`, runs
   `hermes insights`, captures final files, and records unsupported/missing
   fields explicitly.
4. Normalize both lanes into one result schema: task id, pass/fail/inconclusive,
   failure class, duration, tokens, cache tokens, cost status, command/tool
   count, final artifacts, proof command output, and raw evidence refs.
5. Pin model/provider settings before comparing quality or cost. Token totals
   are currently available from Hermes; Guildhall live token/cost capture needs
   to be wired into the run-once benchmark lane.
6. Keep official benchmark claims internal until Guildhall's live path completes
   the smoke task and at least a small fixed suite runs through both systems.
7. If an official Hermes benchmark entrypoint is found later, add it as a third
   lane instead of replacing the neutral CLI comparator.

## Immediate Fix Before a Real Benchmark

Initial smoke fix landed after the first failed run:

- Task sizing now treats deterministic single-file exact-content requests as
  `tiny`, with `reviewBudgetHint: lean`.
- Fully automated mode now repairs an obvious missing structured product brief
  from the existing spec before spec approval, instead of asking the spec agent
  to revise the same content repeatedly.

Rerun evidence:

```text
root: /tmp/guildhall-runonce-scale-smoke-20260528-220159
tick 1: task-001 exploring -> spec_review via spec-agent
fully automated run resolved 2 owner checkpoint(s)
tick 2: task-001 ready -> in_progress via task-claimer
tick 3: task-001 in_progress -> done via worker-agent
stop: all_terminal, 1 done
file: guildhall_smoke.txt contains GUILDHALL_SMOKE_OK
sizePlan: score 1, band tiny, action proceed, reviewBudgetHint lean
```

This makes the marker-file smoke green for the normal live run-once path. The
next benchmark step is still to build the neutral Guildhall-vs-Hermes CLI
comparator so the result schema captures the same task, proof, tokens, latency,
and raw evidence on both sides.
