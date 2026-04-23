# The Guildhall roster

Each persona is an expert with a role in the lifecycle:
- **Overseer** — watches every task (Project Manager).
- **Designers** — author specs at `exploring` (via `specContribution`) and verify at `review`. Never write code.
- **Specialists** — author spec requirements + review + ship deterministic checks that run at `gate_check`.
- **Engineers** — build to an approved spec at `in_progress`. One primary engineer is chosen per task by `pickPrimaryEngineer`.

## Built-in personas

| Slug | Persona | Role | Deterministic checks | Triggers when |
|---|---|---|---|---|
| `project-manager` | The Project Manager | overseer | _(lifecycle enforced elsewhere)_ | Always |
| `component-designer` | The Component Designer | designer | `findExternalMargins`, `findHardcodedDesignValues` (pure detectors; wiring TBD) | UI task or design system exists |
| `visual-designer` | The Visual Designer | designer | _(rubric-only)_ | Design system exists, product brief, or surface keywords |
| `copywriter` | The Copywriter | designer | `findBannedTerms` (pure) | Copy voice declared, product brief, or copy keywords |
| `color-theorist` | The Color Theorist | designer | `color.near-duplicate-roles` (OKLab distance) | Design system has color tokens |
| `api-designer` | The API Designer | designer | _(rubric-only; OpenAPI diff in future)_ | API / endpoint / schema keywords |
| `accessibility-specialist` | The Accessibility Specialist | specialist | `a11y.contrast-matrix` (WCAG math over declared token pairs) | UI task or design system exists |
| `security-engineer` | The Security Engineer | specialist | `sec.no-hardcoded-secrets` — pure detector `findSecrets` | Security-sensitive keywords or product brief |
| `test-engineer` | The Test Engineer | specialist | `test.no-focused-or-skipped` — pure detector `findTestSmells` | Project has a test framework or test keywords |
| `performance-engineer` | The Performance Engineer | specialist | _(rubric-only; bundle / Core Web Vitals wiring later)_ | Product brief or perf keywords |
| `frontend-engineer` | The Frontend Engineer | engineer | _(delegates to framework tooling)_ | Detected framework (Vue/React/Svelte/Solid/Angular) or UI keywords |
| `backend-engineer` | The Backend Engineer | engineer | _(delegates to project gates)_ | Backend deps (Express/Fastify/Hono/…) + backend keywords |
| `typescript-engineer` | The TypeScript Engineer | engineer | _(delegates to `pnpm typecheck`)_ | Project has `tsconfig.json` |

## Lifecycle integration

- **`exploring`** — context-builder calls `renderSpecContributions(applicableGuilds)`; every applicable designer/specialist's `specContribution` is injected into the Spec Agent's prompt.
- **`in_progress`** — `pickPrimaryEngineer(applicableGuilds)` chooses one engineer (Frontend > Backend > TypeScript on specificity); their `renderPersonaPrompt()` output is the worker's persona.
- **`review`** — when an `OrchestratorOptions.reviewerFanout` runner is configured, every applicable persona with a `rubric` produces an independent `ReviewVerdict`. Strict-all aggregation: any revise bounces to `in_progress` with combined feedback.
- **`gate_check`** — `runGuildGates()` runs every applicable guild's deterministic checks before the LLM gate-checker. Failing pure checks (e.g. WCAG contrast) short-circuit to `in_progress` without invoking the shell-gate agent.

## Directory shape

Each guild lives at `src/guilds/<slug>/`:

```
src/guilds/<slug>/
  principles.md      — first-person expert voice (target 200–500 words)
  rubric.ts          — SoftGateRubricItem[] (weighted review questions)
  deterministic.ts   — pure-function checks (optional; specialists typically ship one)
  applicable.ts      — (task, designSystem, projectPath) → boolean
  index.ts           — assembles the GuildDefinition
```

Projects can shadow principles (and later, any piece) per-project via `<memoryDir>/guilds/<slug>/…` with the same layout; the shared loader at `src/guilds/load-asset.ts` honors overrides.
