---
title: Pressure-Test Intake
help_topic: guide.pressure_test_intake
help_summary: |
  New Request routes broad or risky asks into Pressure-Test Intake. Guildhall
  asks one question at a time, keeps the answers, and turns the result into a
  buildable spec with assumptions and deferrals called out.
---

# Pressure-Test Intake

Some requests are ready to become a task. Others are more like a foggy field
with a useful building somewhere inside it.

Pressure-Test Intake is the path for the second kind. It is how Guildhall takes
a broad feature, release, or product request and turns it into something a
worker can actually build without making up the important parts.

## What New Request does first

When you add a New Request, Guildhall routes it before it creates work. A small
bug fix can become a task brief. A question can stay a question. A settings
change can go to Settings. A repair ask can become triage.

Broad release and feature requests take the Pressure-Test path. So do requests
that sound like "pressure test this," "ask me everything," or "turn this into a
product spec." Multi-part requests are split into reviewable actions instead of
being mashed into one grand mystery sandwich.

Guildhall also watches for a quieter kind of ambiguity: requests that sound
like policy, planning, or spec work but could also mean "go implement this now."
For example, "set the overhead fee policy" might mean:

- decide the business rule;
- write the policy/spec;
- apply it in the product;
- verify calculations, copy, docs, and rollout.

Those pieces belong together, but they are not all the same task. Guildhall can
record that component stack and ask whether you want a spec first, a parent
feature with linked child tasks, or direct implementation.

The first visible card is simple: **New request**, the original ask, and the
routing summary. If Guildhall finds a similar live card, it reuses that card
instead of starting a duplicate trail.

The aim is to remove overhead, not judgment. Guildhall inspects project
evidence, narrows the uncertainty, and asks the smallest useful question it
can. Product taste, risk tolerance, release judgment, and the calls that
actually need your hand stay visible instead of being quietly decided for you.

## The intake rhythm

Pressure-Test Intake asks one question at a time in Thread. Each question has:

- the target it is pressure-testing;
- the domain it belongs to, such as product goals, workflows, or risks and non-goals;
- why this question matters;
- any evidence Guildhall already found in project notes or docs.

After you answer, Guildhall saves the answer and decides the next useful move.
If the answer is still too soft for a worker, it asks for one concrete example
or threshold. If the domain looks covered, it asks a closeout question before
moving on.

This is intentionally slower than "sure, I'll build it." It is also where a lot
of future pain gets politely mugged before it reaches your codebase.

## What gets persisted

Pressure-Test Intake is not a chat memory trick. Guildhall writes down the
useful parts so you can pause, come back, and continue without asking everyone
to remember the last conversation. It keeps:

- known facts and where they came from;
- open unknowns;
- questions already asked and answered;
- follow-up candidates;
- assumptions, decisions, and deferrals;
- language-map candidates that may become project vocabulary later.

That matters because a release plan is rarely decided in one sitting. You can
answer a question, stop, come back, and still see what Guildhall believes it
knows.

## The output

When the intake closes, Guildhall can render a buildable spec or release plan.
The useful part is not the formatting. The useful part is that the spec tells
the truth:

- what domains were covered;
- what Guildhall is assuming;
- what was explicitly deferred;
- what a worker and reviewer need to verify.

A completed intake makes the next task smaller, not just prettier. If a
domain is unknown, it stays visible as an assumption or deferral instead of
quietly turning into a surprise halfway through implementation.

For ambiguous policy/spec requests, the output may be a parent feature rather
than one runnable task. That parent can hold the decision and spec while linked
child tasks handle UI, API, data, docs, release, and verification work in
smaller pieces.

## When not to use it

Pressure-Test Intake is for broad, risky, or under-shaped work. A tiny docs
copy edit, a known failing test, or a one-file repair can take the shorter
task path. Guildhall can still ask a clarification question when needed, but it
does not need to stage a whole town meeting for a missing comma.
