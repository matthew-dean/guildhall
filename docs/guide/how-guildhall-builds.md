---
title: How Guildhall builds
pageClass: gh-first-visit-page
---

# How Guildhall builds

Guildhall treats software work like a job site: before anyone starts changing
files, the product needs a shape, a scope, and a way to tell whether the work
is done.

That does not mean you have to manage a heavyweight process. It means
Guildhall keeps the important pieces visible:

1. **Survey**: what repo is this, what tools does it use, what plans or notes
   already exist, and what might block a safe run?
2. **Blueprint**: what is the goal, what is out of scope, and how will the work
   be checked?
3. **Frame**: which pieces can move now, which depend on something else, and
   which need your decision first?
4. **Build**: make focused changes against the accepted plan.
5. **Inspect**: review the work, run checks, and keep the evidence attached.
6. **Revise**: if the facts change, update the plan instead of drifting.
7. **Finish**: separate real release blockers from follow-up polish.

## Not a fixed template

Guildhall is not a project template generator. It does not need every repo to
look the same. It builds a working plan from:

- your goal
- the repo's current shape
- available materials and commands
- known constraints
- open questions
- review standards
- evidence from the work itself

Small work stays small. A tiny documentation fix does not need a release map. A
new product area probably does. Guildhall follows the obvious local convention
when the choice is routine. When a choice changes what you are building, who it
serves, what data it touches, or whether you are comfortable shipping it, the
app brings that choice to you with enough context to answer.

For example, you do not need a giant menu of database engines before Guildhall
knows whether the project needs a database. If a database choice matters, the
app explains the likely fit and offers realistic alternatives.

## What each layer means

| Construction layer | Software layer | What you see |
|---|---|---|
| Site survey | Project intake | Repo facts, provider state, useful notes, known commands, and obvious risks. |
| Blueprint | Planning and spec | A project, release, or task plan with goals, non-goals, acceptance criteria, and checks. |
| Foundation | Safe execution setup | Worktree status, dependencies, baseline checks, and any setup blocker. |
| Framing | Task organization | Work grouped into understandable pieces with dependencies and open questions. |
| Trade work | Implementation | Source edits, tests, docs, migrations, UI changes, and the evidence behind them. |
| Inspection | Review and gates | Review findings, command results, browser checks, and current work closure. |
| Change order | Plan revision | A clear note explaining what changed and why. |
| Punch list | Finish and release | Shipping blockers, follow-ups, cleanup, and explicit deferrals. |

## The durable evidence rule

Narration is not progress.

If Guildhall says it is working, something durable changes. A transcript
line can be useful, but it is not enough by itself. Progress means one of these
changed:

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

That is why a run cannot feel frozen while the app claims to be busy. You
either see new evidence or a clear blocker.

## What this changes for you

When you start a new project, your job is not to invent a giant task list. Give
Guildhall enough direction to survey the repo and draft a small, trustworthy
blueprint.

When you import existing notes, every paragraph does not become runnable work.
Guildhall groups the source material, shows the evidence, and keeps weak
candidates as drafts until they have a clear shape.

When work starts, the task already includes:

- the accepted task blueprint
- what files or surfaces are likely in scope
- what existing helper, component, package, or convention is likely relevant
- what check matters
- what has already been tried
- what counts as a normal repair
- when the plan needs to change instead of guessing

When review happens, it compares the result to the plan and evidence, not
to how confident the transcript sounded.

When Guildhall needs your answer, the question is bounded and useful. A
good question protects product quality. A bad question makes you do the tool's
ordinary thinking for it.

## Where to go next

- [Start here](./quick-start) for the first browser run.
- [How Guildhall works](./how-guildhall-works) for the system model behind
  context, agents, [Corpus Map](./corpus-map), and inspections.
- [Agent context](./agent-context) for what agents receive before they act.
- [Corpus Map](./corpus-map) for how Guildhall indexes codebase structure.
- [New project](./new-project) for a clean or early repo.
- [Existing project](./existing-project) for importing notes and plans.
- [First task set](./first-tasks) for choosing work that can actually move.
- [Task lifecycle](./task-lifecycle) for how construction layers map to task
  statuses.
