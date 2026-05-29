---
title: How the work loop works
---

# How the work loop works

Once Guildhall has a project and a task, it runs a visible loop: plan the work,
do the work, inspect the work, and remember what changed.

Here is the machinery tour. If you only want to install and try a small task,
start with [Start here](./quick-start). Come back when you want to know why
Guildhall cares about blueprints, gates, context packets, and all the other
nouns it keeps politely placing on the table.

Each run pulls from a few kinds of state:

1. **Project state**: the registered project, `./guildhall.yaml`, provider setup,
   local commands, memory files, and current task queue.
2. **Planning state**: project goals, task blueprints, open questions,
   acceptance criteria, out-of-scope boundaries, and change orders.
3. **Codebase orientation**: the [Corpus Map](./corpus-map) and likely target files that point
   helpers toward existing modules, helpers, components, design tokens, tests,
   and conventions.
4. **Execution state**: active worktree, checkpoint, previous attempts,
   verification output, and unresolved reviewer feedback.
5. **Inspection state**: reviewer rubrics, guild specialists, gate results,
   current work closure, and your decisions.
6. **Learning state**: project habits and cross-project preferences that can be
   accepted, ignored, or scoped.

## The guild

Guildhall splits work by job, because "one agent does everything" gets messy
fast.

| Role | Job | Watch out for |
|---|---|---|
| Spec agent | Turns rough intent into a buildable blueprint. | Guessing when it needs your product call. |
| Coordinator | Keeps the project coherent across tasks. | Treating every task like a tiny island. |
| Worker | Makes focused changes against the accepted plan. | Inventing a new helper or component because it was convenient in the moment. |
| Reviewer | Checks the result against the plan and evidence. | Mistaking confidence for correctness. |
| Gate checker | Runs commands and records the outcome. | Pretending a passing command proves the product is good. |

The split is not lore for lore's sake. Each role catches a different kind of
mistake:

- A spec agent can over-plan or ask vague questions.
- A coordinator can lose the project-level thread.
- A worker can optimize for the local file and miss the system.
- A reviewer can rubber-stamp plausible prose.
- A gate checker can confuse passing commands with product quality.

Guildhall’s job is to make those mistakes harder to miss. The plan says what
good means. The worker names what it reused. Reviewers compare the result to
the plan. Gates keep command output attached. The coordinator keeps an eye on
whether the whole project still makes sense.

## Structured flexibility

Software work is not deterministic, and pretending otherwise is how tools
become brittle. Guildhall uses lanes instead: enough structure to stop drift,
enough room to solve the real problem.

For example:

- A task blueprint can name the goal, non-goals, likely files, and checks
  without dictating every edit.
- A question card can offer good choices and still let you type the better
  answer.
- A setting can inherit from your global defaults, stay project-specific, or
  become a new default when the same preference keeps showing up.
- The [Corpus Map](./corpus-map) can point to the likely helper, package, or component, while
  the worker still reads the files before editing.

That is the middle path between "just chat with an agent" and "please enjoy
this mandatory process cathedral."

## Making good output more likely

Good output usually comes from a chain of smaller wins:

1. The task is framed clearly enough that an agent knows what success means.
2. The request type is clear: spec, implementation, question, or a parent
   feature that needs linked child tasks.
3. The helper sees the project state and constraints that matter for that task.
4. The task points toward the existing helpers, tokens, tests, and conventions
   that matter.
5. The run leaves durable evidence: a blueprint, question, code diff,
   checkpoint, review finding, gate result, or decision.
6. Another role or deterministic check inspects that evidence.

That is why Guildhall invests in blueprints, context packets, [Corpus Map](./corpus-map),
design-system summaries, review rubrics, checkpoints, and gates. None of those
exist to make the app feel busy. They exist because plausible-looking work is
still wrong if it ignores the project around it.

The [Research-backed design](./research-backed-design) page keeps the citations
and friendly explainers for the ideas behind this shape. The short version:
keep decisions small enough to answer, keep work small enough to review, make
uncertainty visible, and keep evidence attached.

In practice, that should feel simple: smaller work packets, one question at a
time, visible proof of done, and fewer half-finished tasks hanging around. The
point is not to make you manage a process. The point is to take as much
cognitive overhead off your plate as Guildhall safely can while leaving the
real product, risk, taste, and release judgments with you.

Guildhall also tries to keep the stack of work visible. A broad ask may contain
a policy decision, a spec, implementation surfaces, data or API changes, docs,
release work, and verification. Those can be linked without being crammed into
one task. You should be able to see why Guildhall asked a question, split the
work, or kept it together.

## Feedback loops

Guildhall asks for feedback where it changes the outcome.

Your feedback belongs on product calls, risk calls, taste calls, and release
judgment. If the answer changes what the product is, who it serves, or whether
you are comfortable shipping it, Guildhall asks.

Reviewer feedback belongs where another lens catches a class of mistake:
architecture fit, product flow, accessibility, security, test coverage,
design-system consistency, or closure readiness.

Copy review is part of that loop. When a task changes docs or a visible
surface, Guildhall brings in the Copywriter to check the small words too:
button labels, nav labels, status text, tooltips, headings, empty states, and
capitalization. Those details are where an app starts to feel either calm and
intentional or weirdly stitched together.

Command feedback belongs where commands can prove something: tests, typechecks,
builds, lint, browser checks, and release scripts. Guildhall records those
outcomes so the next run does not have to rediscover whether a claim was
actually verified.

## How Guildhall learns

Guildhall can notice useful patterns: the command that always proves a project
is healthy, the component library a repo already uses, the way you prefer tasks
to be split, or the kind of question you never want buried in a transcript.

It does not treat every correction as a new law. A lesson has a scope and a
source. Some lessons belong only to the current task, some become project
habits, and some are candidates for your global defaults. Broad changes stay
off until you approve them.

When Guildhall itself gets better, active work gets a light recheck too. The
improvement review looks for obvious matches against current Guildhall features
and records a small advisory note when an in-progress task may benefit. It is
bounded on purpose: no full repo crawl, no surprise rewrite, and no expensive
deep dive until the task reaches the moment where that lens matters.

That keeps learning useful without making the product spooky. You can inspect
what Guildhall wants to remember in **Settings -> Memory**, choose whether it
applies here or everywhere, and ignore suggestions that were only true once.

Recovery uses the same trail. When a worker gets stuck, Guildhall can reread
the right files, retry a bounded step, ask a sharper question, or turn the
blocker into a visible change order. The goal is not to hide failure. The goal
is to make the next move obvious.

See [Memory, learning, and recovery](./memory-and-recovery) for the inspectable
memory layers and recovery paths.

## Auditability as product quality

Auditability is not an enterprise checkbox. It is how Guildhall keeps AI work
from becoming a magic trick.

The system records:

- what you asked for
- how Guildhall read the request shape
- what questions were asked and answered
- what blueprint was accepted
- what context the worker received
- what files changed
- what checkpoint the worker left behind
- what reviewers found
- what gates ran
- what decisions changed the plan
- what settings or learned behaviors affected execution

This matters because good work is not only “the diff looks okay today.” Good
work is being able to answer, tomorrow, why the change was made, what tradeoff
was accepted, what verification ran, and whether the agent followed the
project’s existing architecture instead of inventing a parallel one.

The trail still has to be readable. You need a quick status when you are
scanning, a review packet when you are checking a task, and deeper history only
when something smells off.

## The context principle

Helpers need enough context to make good local decisions without stuffing the
entire repository into the prompt. That means Guildhall prefers
compact maps, summaries, pointers, and current state over full-file dumps.

When a helper needs more, it can read the specific file, search the repo, or run
a command. The injected context is a navigation layer, not a substitute for
evidence.

This is especially important for reuse. Guildhall points work toward existing
shared code before anyone edits:

- helpers, services, schemas, and packages for backend/runtime work
- components, design tokens, and interaction patterns for UI work
- tests and fixtures that show the intended contract
- docs and decisions that explain why the system has its current shape

If the same idea appears twice, it may be time for a small abstraction. If it
is still a one-off, the project does not need a brand-new framework-shaped hat.

Two pages cover the most important pieces:

- [Agent context](./agent-context) explains what each agent receives before it
  acts.
- [Corpus Map](./corpus-map) explains how Guildhall builds and refreshes the
  compact codebase map.

## The work loop

Guildhall’s default loop is:

1. Survey the project and capture facts.
2. Draft or revise the blueprint.
3. Ask bounded questions only when your answer changes the plan.
4. Size the task and split oversized work into linked child tasks.
5. Promote ready work into implementation.
6. Give the worker scoped context, likely files, and [Corpus Map](./corpus-map) guidance.
7. Record checkpoints and verification evidence as work changes.
8. Inspect the result with reviewers and deterministic gates.
9. Finish, revise, escalate, or record a change order.

This is why Guildhall has visible task states, transcripts, review packets,
checkpoints, and settings provenance. The product is not just the final diff.
It is also the trail that lets you trust the diff.

## Finish What Is Already Moving

Guildhall is biased toward finishing active work before starting something new.
That sounds small, but it is one of the main ways the product stays calm.

When work is already in progress, review, or gate checks, Guildhall keeps
driving that work toward a clear outcome before it grabs unrelated tasks. A
finished task with a review packet is more useful than five half-started tasks
with lively transcripts.

The loop looks like this:

1. Finish anything waiting on gates.
2. Resolve work already in review.
3. Continue active implementation.
4. Claim the next ready task only when the active lane is clear.

That keeps the queue honest. Blocked work is marked as blocked instead of
quietly falling behind fresher work. Ready work is claimed explicitly so two
agents do not collide. Every handoff needs evidence: what changed, what was
checked, what still needs a decision, and where to resume.

## Where Guildhall stays quiet

More structure is not always better. A tiny project does not need to think
about release maps, coordinator rosters, design-system maturity, or settings
inheritance unless those concepts become useful.

Guildhall keeps advanced detail available, not mandatory. It asks when the
project gets complicated, suggests a split when a task is too broad, or surfaces
a setting when the default keeps being wrong. Until then, it quietly does the
ordinary thing.

## What makes this different from a long chat

A long chat can remember a lot, but it is fragile. Important state gets buried
in prose, and each new task depends on the model rediscovering the project.

Guildhall keeps durable state first-class:

- task status and acceptance criteria live in structured task state
- questions live as answerable cards
- project settings live as levers with provenance
- codebase orientation, including design-system maturity, lives in the Corpus
  Map
- review findings live on the task
- verification output is tied to gates and checkpoints
- learned behavior must be accepted before it becomes a default

The result feels less like "one clever conversation" and more like a
small local team with a shared project room.
