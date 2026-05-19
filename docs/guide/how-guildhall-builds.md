---
title: How Guildhall builds
pageClass: gh-first-visit-page
---

# How Guildhall builds

Guildhall treats software work like a project built by a guild of trades. That
does not mean it follows a rigid waterfall plan. It means every meaningful
handoff should leave behind a visible artifact that helps the next person or
agent do better work.

The short version:

1. **Survey the site**: understand the repo, tools, constraints, dirty state,
   provider setup, and existing plans.
2. **Draft the blueprint**: write the project, release, or task shape before
   implementation begins.
3. **Frame the work**: group tasks into phases, dependencies, active tranches,
   and clear ownership.
4. **Assign the trades**: let workers implement bounded pieces against the
   accepted plan.
5. **Inspect the build**: run reviewers, gates, browser checks, and release
   readiness checks.
6. **Handle change orders**: revise scope or sequencing when evidence proves
   the old plan is wrong.
7. **Finish the punch list**: separate shipping blockers from follow-up polish.

## Not a fixed template

The point is not to pick a prebuilt project skeleton and force your repo into
it. The point is to compose a sensible structure from:

- your goal
- the repo's current shape
- available materials and commands
- known constraints
- open questions
- review standards
- evidence from the work itself

Good Guildhall work should feel balanced. The plan, task, implementation,
verification, docs, and release criteria should fit together instead of each
being locally reasonable but globally confused.

The process should also stay proportional. Guildhall should not turn planning
into a burden that slows the real product down. It should ask for human input
when the answer changes intent, audience, user flow, risk, data ownership, or
release quality. For routine engineering choices, it should infer a good
default from the project and offer a small set of sensible options only when
the choice actually matters.

For example, Guildhall should not list every possible database engine. It
should first decide whether the project needs a database. If it does, it should
recommend the most fitting option with a short rationale and maybe one or two
realistic alternatives.

## What each layer means

| Construction layer | Software layer | What Guildhall should produce |
|---|---|---|
| Site survey | Project intake | Repo facts, provider state, commands, risks, and source material. |
| Blueprint | Planning and spec | Project charter, release plan, task brief, acceptance criteria, non-goals, and verification plan. |
| Foundation | Safe execution setup | Worktree isolation, clean or intentionally packaged git state, installed dependencies, and baseline checks. |
| Framing | Task organization | Phases, dependencies, active tranches, task boundaries, and attached questions. |
| Trade work | Implementation | Source edits, tests, docs, migrations, UI changes, and verification output. |
| Inspection | Review and gates | Reviewer verdicts, deterministic checks, browser evidence, and release readiness. |
| Change order | Plan revision | A named change to scope, sequencing, assumptions, or task shape based on new evidence. |
| Punch list | Finish and release | Blockers, follow-ups, docs alignment, cleanup, and explicit deferrals. |

## The durable artifact rule

Narration is not progress.

If an agent says "I understand and will write the spec next," that may be a
useful transcript line, but it is not construction progress. Progress means a
durable artifact changed:

- a project map
- a release plan
- a task blueprint
- acceptance criteria
- an explicit question
- a decision record
- a change order
- a code diff
- a verification result
- a review finding
- a learning record

This rule is why Guildhall should not look locked up while claiming to run. If
the guild is working, some artifact should be visible or the blocker should be
honest.

## What this changes for you

When you start a new project, your first job is not "make a giant task list."
It is to help Guildhall survey the site and create a small, trustworthy
blueprint.

When you import existing notes, Guildhall should not turn every paragraph into
a runnable task. It should group source material, show evidence, and keep weak
candidates as drafts until they are framed.

When a worker starts, it should already know:

- the accepted task blueprint
- what files or surfaces are likely in scope
- what verification command matters
- what has already been tried
- what counts as a normal repair
- when it must propose a change order instead of guessing

When review happens, reviewers should inspect against the plan, not just decide
whether the worker sounded confident.

When Guildhall needs the owner, the question should be bounded and useful. A
good question protects product quality. A bad question offloads routine
strategy onto the human operator.

## Where to go next

- [Start here](./quick-start) for the first browser run.
- [New project](./new-project) for a clean or early repo.
- [Existing project](./existing-project) for importing notes and plans.
- [First task set](./first-tasks) for choosing work that can actually move.
- [Task lifecycle](./task-lifecycle) for how construction layers map to task
  statuses.
