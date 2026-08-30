# DeepInfra GLM 5.3 Flash vs DeepSeek V4 Pro - 2026-08-29

## Guildhall role-specific follow-up - 2026-08-30

The initial run below exercised Narrative Harness's structured drafting/review contract. A follow-up used Guildhall's historical live role-by-model harness for the two roles actually under consideration: `reviewer` and `contextIndexer`. The live command exists on the retained `guildhall/task-task-001` benchmark branch, not in the current `0.13.2` CLI; it was built and run from an isolated detached worktree at `/tmp/guildhall-role-bakeoff-20260830`. No implementation from that branch was merged.

No Guildhall MCP client/tool surface was configured in this Codex environment. Project state, harness code, configuration, and evidence were therefore inspected through the local CLI and files rather than represented as MCP reads.

The configured comparison lane was `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning`. DeepInfra's model catalog marked that ID deprecated and named `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B` as its replacement. A direct contract response requested with the configured Nano ID reported the served model as the Ultra replacement, so the results below distinguish the requested configuration from the provider-reported served identity.

### Exact role-harness commands and scoring

```sh
cd /Users/matthew/.codex/worktrees/2ec9/guildhall
git worktree add --detach /tmp/guildhall-role-bakeoff-20260830 \
  67c4753e8c3b3c5bc4d4f7687e776c2ca225f4e9
cd /tmp/guildhall-role-bakeoff-20260830
pnpm install --frozen-lockfile
pnpm build
git rev-parse HEAD
git show HEAD:src/runtime/model-bakeoff.ts | shasum -a 256

node dist/cli.js model-bakeoff --live \
  --provider openai-api \
  --models zai-org/GLM-5.3-Flash,nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning \
  --roles reviewer \
  --scenario-set reviewer-calibration \
  --concurrency 2 \
  /Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer.json

node dist/cli.js model-bakeoff --live \
  --provider openai-api \
  --models zai-org/GLM-5.3-Flash,nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning \
  --roles contextIndexer \
  --scenario-set context-indexer-calibration \
  --concurrency 2 \
  /Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/context-indexer.json
```

The detached checkout resolved to `67c4753e8c3b3c5bc4d4f7687e776c2ca225f4e9`; its `src/runtime/model-bakeoff.ts` SHA-256 was `5cb530122707cd2af9ad8aa383d963da7787202dfeb93d1e1213c72a2db21ccb`.

Both suites use temperature `0`, no tools, a 1,200-token completion cap, and a 180-second client timeout. Each role has three fixed cases. The harness passes a case at 75% expected phrase-signal coverage, rejects empty output, and penalizes detected false approval, false escalation, and retry behavior. That scorer is useful calibration evidence but is not an operational contract: it matches model prose and therefore cannot by itself justify a role assignment under Guildhall's model-independence boundary.

The reviewer cases test missing screenshot proof, browser-default visual quality, and inaccessible clickable-div/focus behavior. The context-indexer cases test canonical primitive selection, stale-versus-current guidance, and bounded design-system abstraction advice.

### Role-harness results

| Role | Lane | Pass rate | Phrase score | Avg latency | Output tokens | False approvals | False escalations | Estimated cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| reviewer | GLM 5.3 Flash | 3/3 | `93.3` | `14,263 ms` | `530` | 0 | 0 | `$0.000151` at current published rates |
| reviewer | configured Nemotron ID | 3/3 | `87.7` | `14,117 ms` | `1,441` | 0 | 0 | `$0.001209` catalog estimate |
| contextIndexer | GLM 5.3 Flash | 3/3 | `100.0` | `12,457 ms` | `722` | 0 | 0 | `$0.000199` at current published rates |
| contextIndexer | configured Nemotron ID | 3/3 | `100.0` | `12,481 ms` | `1,983` | 0 | 0 | `$0.001643` catalog estimate |

Across the six phrase-scored calls, latency was effectively tied (`13,360 ms` GLM versus `13,299 ms` configured-Nemotron average). GLM used `1,252` output tokens versus `3,424`, a 63% reduction, and its manually priced role-suite cost was about 8.1x lower. The historical harness did not yet contain GLM 5.3 pricing, so its JSON reports GLM cost as unknown; the table applies DeepInfra's published promotional rate of `$0.075/M` input and `$0.25/M` output.

### Current production-contract probes

Two supplemental probes closed gaps in the historical harness without changing production code or repository defaults:

1. The current `0.13.2` `corpus-map refresh --semantic` path ran against identical disposable four-file TypeScript corpora, once per model, using isolated `GUILDHALL_CONFIG_DIR` copies. Both produced schema-valid semantic maps on the first attempt; neither invoked the fixed DeepSeek repair model. GLM was more cautious about missing imports and absent tests. The configured-Nemotron result invented a repository testing-directory convention. GLM's main qualitative miss was setting `needsBroaderRead: false` while also identifying unindexed imports that should be read.
2. A reviewer packet probe used JSON-object mode, temperature `0`, a 1,200-token cap, persisted criterion ID `ac-visual`, and proof ID `proof-browser`. The saved responses were then passed through Guildhall's current `readStructuredReviewResult` and `validateStructuredReviewResultTargets` functions. GLM returned valid JSON and a Guildhall-valid `revise` contract in `14.279 s`, with no false approval. The configured Nemotron request returned in `7.467 s`, reported the served model as `nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B`, and emitted invalid target-kind values (`"acceptance criterion"` and `"proof evidence"` rather than the required enums `acceptance_criterion` and `proof_evidence`). Guildhall rejected it, which would fail closed with `invalid_review_contract` rather than falsely approving the work.

The direct reviewer calls reported `$0.00009035` for GLM and `$0.0009475` for the served Ultra replacement. The semantic-map CLI does not persist provider usage or cost, so no invoice-grade cost is available for those two calls.

Sanitized setup and semantic-map commands, with the literal credential omitted:

```sh
cd /Users/matthew/.codex/worktrees/2ec9/guildhall
node -p 'require("./package.json").version'
pnpm install --frozen-lockfile
pnpm build

mkdir -p /tmp/guildhall-config-role-bakeoff-glm /tmp/guildhall-config-role-bakeoff-nemotron
cp ~/.guildhall/providers.yaml /tmp/guildhall-config-role-bakeoff-glm/providers.yaml
cp ~/.guildhall/providers.yaml /tmp/guildhall-config-role-bakeoff-nemotron/providers.yaml
cp ~/.guildhall/config.yaml /tmp/guildhall-config-role-bakeoff-glm/config.yaml
cp ~/.guildhall/config.yaml /tmp/guildhall-config-role-bakeoff-nemotron/config.yaml

node -e 'const fs=require("fs"); const y=require("js-yaml"); const p=process.argv[1]; const c=y.load(fs.readFileSync(p,"utf8")); c.models["openai-api"].contextIndexer=process.argv[2]; fs.writeFileSync(p,y.dump(c,{lineWidth:120,noRefs:true}));' \
  /tmp/guildhall-config-role-bakeoff-glm/config.yaml zai-org/GLM-5.3-Flash
node -e 'const fs=require("fs"); const y=require("js-yaml"); const p=process.argv[1]; const c=y.load(fs.readFileSync(p,"utf8")); c.models["openai-api"].contextIndexer=process.argv[2]; fs.writeFileSync(p,y.dump(c,{lineWidth:120,noRefs:true}));' \
  /tmp/guildhall-config-role-bakeoff-nemotron/config.yaml nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning

GUILDHALL_CONFIG_DIR=/tmp/guildhall-config-role-bakeoff-glm \
  node dist/cli.js corpus-map refresh --semantic \
  /Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/semantic-glm
GUILDHALL_CONFIG_DIR=/tmp/guildhall-config-role-bakeoff-nemotron \
  node dist/cli.js corpus-map refresh --semantic \
  /Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/semantic-nemotron
```

The reviewer probe used the same two model IDs and this request contract for each call:

```sh
PROBE_KEY=<configured Guildhall DeepInfra credential>
PROBE_SYSTEM='You are testing the Guildhall reviewer machine contract. Return only one JSON object with exactly these fields: verdict ("approve" or "revise"), acceptedCriteriaIds (string array), proofEvidenceIds (string array), findings (array of objects with targetKind, targetId, disposition, evidenceRefs, and optional workerInstruction), revisionItems (string array), riskItems (string array), followUpItems (string array), advisoryScores (object). Every finding target must be one of acceptance criterion ac-visual or proof evidence proof-browser. A revise verdict must include at least one unsatisfied finding. Do not put operational decisions only in prose.'
PROBE_PROMPT='Review this handoff. Acceptance criterion ac-visual requires a polished, accessible Pantry Pulse UI. Required proof evidence proof-browser requires a screenshot demonstrating responsive layout and focus states. The handoff only says tests passed; it provides no screenshot or browser proof, and the filter is implemented as clickable divs. Produce the machine verdict.'

jq -n --arg model '<model-id>' --arg system "$PROBE_SYSTEM" --arg prompt "$PROBE_PROMPT" \
  '{model:$model,messages:[{role:"system",content:$system},{role:"user",content:$prompt}],temperature:0,max_tokens:1200,response_format:{type:"json_object"}}' \
  | curl -fsS -w 'seconds=%{time_total}\n' \
      -H "Authorization: Bearer $PROBE_KEY" \
      -H 'Content-Type: application/json' \
      --data-binary @- \
      -o '<raw-evidence-path>.api.json' \
      https://api.deepinfra.com/v1/openai/chat/completions
```

The parser/target validation was retained as `reviewer-contract-validator.test.ts` in the raw evidence directory. It was copied into the repository test tree temporarily, run with the command below, and removed afterward; both assertions passed.

```sh
cp /Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer-contract-validator.test.ts \
  src/runtime/__tests__/model-bakeoff-live-probe.tmp.test.ts
pnpm exec vitest run src/runtime/__tests__/model-bakeoff-live-probe.tmp.test.ts --reporter=verbose
```

The validator stdout is retained as `reviewer-contract-validator-vitest.txt`. The semantic CLI stdout showed no repair invocation, and curl printed the reviewer timings quoted above. Those two transient stdout streams were observed but not persisted, so the maps and API responses are the durable evidence; a repeat run is required to independently reproduce first-attempt repair frequency or latency variance.

After the evidence was copied, `git worktree remove /tmp/guildhall-role-bakeoff-20260830` removed the historical checkout. The two exact credential-bearing temporary config directories were deleted and their absence was verified. The reusable raw evidence contains no provider credential.

### Role decision and settings change

GLM 5.3 Flash is the stronger bounded candidate for both roles because it was substantially more concise and cheaper, produced a valid reviewer machine contract, and passed the real semantic-map schema without repair. The prior configured model is deprecated, silently substituted by the provider, and failed the reviewer contract probe. Phrase scores above are audit-only and had no routing weight.

This is a bounded promotion, not a general model verdict. The reviewer suite has only revision-expected cases, not a clean approval case, and each structured contract probe ran once. A future calibration should measure false revision/over-rejection behavior, repeated-run schema reliability and latency, and a full persisted Guildhall reviewer dispatch/fan-out path.

The machine-level Guildhall assignments in `~/.guildhall/config.yaml` were changed to:

```yaml
models:
  openai-api:
    reviewer: zai-org/GLM-5.3-Flash
    contextIndexer: zai-org/GLM-5.3-Flash
```

The `spec`, `coordinator`, `worker`, and `gateChecker` assignments remain `deepseek-ai/DeepSeek-V4-Flash`. Narrative Harness defaults were not changed: the initial narrative run supports GLM as a promising draft/review candidate, but its illegal `sourceRef` values and missing intent checks argue for a role-specific narrative contract run before changing that project's settings.

### Role-specific raw evidence

```text
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer.json
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer.md
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/context-indexer.json
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/context-indexer.md
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/semantic-glm-codebase-map.yaml
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/semantic-nemotron-codebase-map.yaml
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer-contract-glm.api.json
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer-contract-nemotron.api.json
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer-contract-validator.test.ts
/Users/matthew/.guildhall/data/benchmarks/runs/guildhall-role-bakeoff-2026-08-30/reviewer-contract-validator-vitest.txt
```

## Scope

- Branch/commit: `feature/deepinfra-model-bakeoff` at Guildhall `7c148b6d`
- Benchmark: Narrative Harness Stage 1 provider-backed drafting/review bakeoff, which Guildhall's release proof consumes as its live model-bakeoff evidence
- Harness: `/Users/matthew/git/oss/narrative-harness/scripts/model-bakeoff.mjs` at Narrative Harness `6a3f53a`
- Fixture/subset: all five `stage1-v1` fixtures; literary, fantasy, science fiction, contemporary romance, and non-graphic consensual adult romance
- Models/providers: DeepInfra `zai-org/GLM-5.3-Flash` and `deepseek-ai/DeepSeek-V4-Pro-0813`
- Runtime: Node 24.11.1, PNPM harness command, macOS, OpenAI-compatible DeepInfra chat-completions endpoint
- Automation policy: serial standard-harness execution; five fixtures x drafting and review = 10 jobs per model; no retries or model-specific fallback
- Request policy: temperature `0`, provider seed `17`, no reasoning-effort override, JSON-object response format, 120-second request timeout, 3,000 draft and 4,000 review output-token caps, no priority or flex service tier

Guildhall's own `pnpm model:bakeoff` command was inspected first. It uses saved replay scenarios and simulated model lanes; its public guide describes provider-backed `--live` mode as planned. The live harness used here is the adjacent Narrative Harness implementation already recognized by Guildhall's release-acceptance proof.

## Required Setup and Exact Commands

The machine-scoped Guildhall provider store had a configured OpenAI-compatible credential, a DeepInfra base URL, and file mode `0600`. The credential was injected from `~/.guildhall/providers.yaml` without printing it or writing it to an artifact. The focused harness test passed 13/13 before network use.

```sh
cd /Users/matthew/git/oss/narrative-harness
pnpm exec node --test scripts/model-bakeoff.test.mjs

pnpm exec node scripts/model-bakeoff.mjs \
  --offline \
  --fixtures=last-lighthouse-literary,cartographers-oath-fantasy,europa-orchard-science-fiction,borrowed-season-romance,after-rain-adult-romance \
  --draft-max-output-tokens=3000 \
  --review-max-output-tokens=4000 \
  --temperature=0 \
  --timeout-ms=120000 \
  --seed=stage1-v1 \
  --run-id=guildhall-deepinfra-bakeoff-offline-20260829 \
  --output-dir=/tmp/guildhall-deepinfra-bakeoff-20260829/offline
```

For each live command, `DEEPINFRA_API_TOKEN` was populated in the process environment from the configured `providers.openai-api.apiKey`. The literal secret is intentionally omitted here.

```sh
DEEPINFRA_API_TOKEN=<configured Guildhall DeepInfra credential> \
pnpm exec node scripts/model-bakeoff.mjs \
  --live \
  --provider=deepinfra \
  --base-url=https://api.deepinfra.com/v1/openai/chat/completions \
  --models=zai-org/GLM-5.3-Flash \
  --api-key-env=DEEPINFRA_API_TOKEN \
  --fixtures=last-lighthouse-literary,cartographers-oath-fantasy,europa-orchard-science-fiction,borrowed-season-romance,after-rain-adult-romance \
  --draft-max-output-tokens=3000 \
  --review-max-output-tokens=4000 \
  --temperature=0 \
  --timeout-ms=120000 \
  --seed=stage1-v1 \
  --input-cost-per-1m=0.075 \
  --output-cost-per-1m=0.25 \
  --run-id=guildhall-glm-5-3-flash-20260829 \
  --output-dir=/tmp/guildhall-deepinfra-bakeoff-20260829/glm-5.3-flash

DEEPINFRA_API_TOKEN=<configured Guildhall DeepInfra credential> \
pnpm exec node scripts/model-bakeoff.mjs \
  --live \
  --provider=deepinfra \
  --base-url=https://api.deepinfra.com/v1/openai/chat/completions \
  --models=deepseek-ai/DeepSeek-V4-Pro-0813 \
  --api-key-env=DEEPINFRA_API_TOKEN \
  --fixtures=last-lighthouse-literary,cartographers-oath-fantasy,europa-orchard-science-fiction,borrowed-season-romance,after-rain-adult-romance \
  --draft-max-output-tokens=3000 \
  --review-max-output-tokens=4000 \
  --temperature=0 \
  --timeout-ms=120000 \
  --seed=stage1-v1 \
  --input-cost-per-1m=1.30 \
  --output-cost-per-1m=2.60 \
  --run-id=guildhall-deepseek-v4-pro-0813-20260829 \
  --output-dir=/tmp/guildhall-deepinfra-bakeoff-20260829/deepseek-v4-pro-0813
```

The price inputs came from the model pages on the run date:

- <https://deepinfra.com/zai-org/GLM-5.3-Flash> showed the active promotional price of `$0.075/M` input and `$0.25/M` output.
- <https://deepinfra.com/deepseek-ai/DeepSeek-V4-Pro-0813> showed standard-tier pricing of `$1.30/M` input and `$2.60/M` output.

Separate live commands were necessary because the harness accepts one price pair for an entire run. The harness has no explicit dollar-budget flag. Its five-fixture limit, serial execution, request timeout, and output caps bounded this comparison conservatively below roughly `$0.15` at the supplied rates.

## Scoring

Rubric `stage1-structured-contract-rubric-v2` evaluates stable structured contracts, not model prose:

- Drafting averages output schema validity and exactly-once coverage of eight source keys: `brief`, `voice`, `characters`, `world`, `objects`, `time`, `geography`, and `constraints`.
- Review averages JSON shape, all 12 required lens IDs, allowed evidence source references, actionable status/claim/risk/question fields, and nonempty intent checks.
- A live candidate is eligible only when every job succeeds, drafting and review averages are each at least `0.75`, and the adult fixture does not refuse.
- The provisional ranking uses structured score first and latency second. It does not claim literary quality.

False approvals and false-positive review findings are not deterministically scored by this harness. Review status distribution and manual spot checks are reported below as qualitative evidence, not converted into a made-up operational metric.

## Results

| Lane | Result | Structured score | Jobs | Latency | Tokens | Estimated cost | Notes |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| GLM 5.3 Flash | eligible / provisional single-candidate winner | draft `1.000`; review `0.963` | 10/10 success | `488,199 ms` total; `48,820 ms`/job | `10,731` in; `14,200` out | `$0.004355` | No failures or refusals; adult case passed. |
| DeepSeek V4 Pro 0813 | not eligible | successful drafts `1.000`; successful reviews `1.000` | 7/10 success | `528,494 ms` total; `58,722 ms`/actual provider call | `7,771` in + `13,191` out provider-reported; `4,102` additional estimated tokens | `$0.049735` | Fantasy review timed out; romance draft timed out; romance review was skipped as an upstream failure. No refusals; adult case passed. |

On the seven jobs both models completed, DeepSeek averaged `41,212 ms` and GLM `42,076 ms`; DeepSeek was about 2% faster on successful common work. It emitted 41% more output tokens on those jobs and cost about 15.7x as much at the supplied rates. Across the full bounded task, GLM was more reliable and finished about 40 seconds sooner despite DeepSeek's slightly faster successful calls.

DeepSeek's timeout and skipped-job token counts are character-based estimates because no provider response was available. Its cost number is therefore not invoice-grade and may omit provider-side work performed before the client timeout. The harness also does not retain DeepInfra cached-token usage, so both estimates use standard input pricing.

## Structured Output and Failure Modes

- GLM returned parseable JSON for all 10 jobs. All five draft contracts scored `1.000`. Every review contained all 12 lenses, but eight Borrowed Season findings used the disallowed source key `draft`, and three otherwise valid findings omitted `intentCheck`. Those misses explain the `0.963` review average.
- DeepSeek's seven completed jobs all returned parseable, contract-perfect JSON: four drafts and three reviews. The other three job records were two hard 120-second timeouts and the correctly propagated upstream skip, not malformed JSON or refusal.
- GLM's main weakness was looser evidence-key discipline inside otherwise useful reviews. DeepSeek's main weakness was long-tail completion reliability under the equivalent 120-second cap.
- DeepSeek produced longer successful outputs. That increased cost substantially and likely contributed to timeout risk, although this single run cannot establish causality.

## False-Positive and False-Approval Signals

- GLM's 60 review findings were `55 pass`, `5 needs_attention`, and `0 blocked`. The attention findings were evidence-linked and asked bounded author questions. Two are plausible false-positive risks rather than definite defects: treating roughly 24 seconds as inconsistent with “a long time,” and treating an alternating-close-third instruction as requiring both viewpoints inside one chapter.
- DeepSeek's 36 completed review findings were `36 pass`, `0 needs_attention`, and `0 blocked`. That all-pass pattern is a potential approval-bias signal, not proof of false approval. A spot check found one weak temporal approval in After the Rain: the review asserted that several hours were implied, while the draft only made the one-hour post-flood interval explicit.
- Neither model emitted a `blocked` review, so this run found no false escalation in the narrow status sense. No honest numeric false-approval rate is available because each model reviewed its own draft and the harness has no independent semantic ground truth or second reviewer.
- No candidate refused the legal, consensual, non-graphic adult fixture. This is a bounded policy signal, not a general content-policy audit.

## Interpretation

- What this proves: under the repository's current bounded structured-contract harness and equivalent request settings, GLM 5.3 Flash was the only reliable eligible candidate. DeepSeek V4 Pro produced excellent contracts when it finished but failed the all-jobs gate because of two timeouts.
- What this does not prove: literary quality, general agentic/coding quality, independent review accuracy, provider policy suitability, cached-cost behavior, or superiority under DeepSeek's recommended higher reasoning settings.
- Regressions or false-success risks: contract scores can hide semantic approval bias; evidence excerpts are not verified against their claimed source; timeout usage/cost is estimated; separate one-candidate runs do not create a native cross-candidate ranking artifact.
- Follow-up: add an independent semantic review/ground-truth lane before changing any model default; add explicit false-approval/false-positive fixtures; consider a bounded rerun at the same settings to measure timeout variance before ruling out DeepSeek; record cached-token usage and a hard dollar budget in the live harness.

The 2026-08-29 Narrative Harness run did not change production code, model defaults, provider settings, or public documentation. The 2026-08-30 role-specific follow-up changed only the two machine-level Guildhall assignments documented above.

## Raw Evidence

Raw artifacts are local and untracked:

```text
/tmp/guildhall-deepinfra-bakeoff-20260829/offline/model-bakeoff.json
/tmp/guildhall-deepinfra-bakeoff-20260829/offline/model-bakeoff.md
/tmp/guildhall-deepinfra-bakeoff-20260829/glm-5.3-flash/model-bakeoff.json
/tmp/guildhall-deepinfra-bakeoff-20260829/glm-5.3-flash/model-bakeoff.md
/tmp/guildhall-deepinfra-bakeoff-20260829/deepseek-v4-pro-0813/model-bakeoff.json
/tmp/guildhall-deepinfra-bakeoff-20260829/deepseek-v4-pro-0813/model-bakeoff.md
```

SHA-256 for the JSON artifacts:

```text
4e1a31eedabf3011c390478d0bf11cc37d208ec98127add3da238e643e63f63a  offline/model-bakeoff.json
578cbed544fc400c8e82485bd6eaf5118007f1994deeec80e01cc3b91b033f86  glm-5.3-flash/model-bakeoff.json
c8de62f74f9c6d8902f4f7e97874a3e3694ff77b8538ff8df676f1cc853d7c82  deepseek-v4-pro-0813/model-bakeoff.json
```
