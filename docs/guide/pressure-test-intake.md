---
title: Pressure-Test Intake
help_topic: guide.pressure_test_intake
help_summary: |
  Guildhall pressure-tests every task. It inspects the project, reasons about
  completeness, asks only the questions that need owner judgment, and turns
  rough intent into buildable work with assumptions and deferrals called out.
---

# Pressure-Test Intake

Pressure testing is not an optional mode you have to choose. It is part of
Guildhall's job.

You should be able to dump a pile of ideas, bugs, worries, half-plans, and
taste notes into Guildhall. Guildhall's job is to turn that into work you can
trust: a spec that matches the vision, names what is complete, names what is
still uncertain, gives workers clear boundaries, gives reviewers real things
to check, and keeps human supervision focused on the calls only you can make.

That means every task gets pressure-tested. Guildhall decides how much pressure
the work needs to reach the quality bar. A tiny one-file repair may only need
automatic checks against scope, repo evidence, tests, and review expectations.
A release, product change, policy decision, or vague "make this better" request
may need a longer intake loop with focused questions in Thread.

Either way, the burden is not on you to pick the right path. Guildhall routes
the request, inspects what it can, and asks for your judgment only when an
answer could reveal a missing truth.

## What New Request does first

When you add a New Request, Guildhall routes it before it creates work. A small
bug fix can become a task brief. A question can stay a question. A settings
change can go to Settings. A repair ask can become triage. All of those paths
still carry a pressure-test requirement: Guildhall checks whether the request
has enough context, scope, verification, review coverage, and project fit to
move safely.

Broad release and feature requests take the deeper Pressure-Test Intake path.
So do requests that sound like "ask me everything," "turn this into a product
spec," or "I have a bunch of thoughts and need Guildhall to shape them."
Multi-part requests are split into reviewable actions instead of being mashed
into one oversized task.

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

The aim is to remove overhead, not judgment. Guildhall does the work it can do
automatically: inspect the repo, read project memory, compare against accepted
plans, identify likely gaps, propose task boundaries, attach verification
paths, and prepare review lenses. Product taste, risk tolerance, release
judgment, and the calls that actually need your hand stay visible instead of
being quietly decided for you.

## The intake rhythm

When the deeper intake loop is needed, Pressure-Test Intake asks one question
at a time in Thread. Each question has:

- the target it is pressure-testing;
- the domain it belongs to, such as product goals, workflows, or risks and non-goals;
- why this question matters;
- any evidence Guildhall already found in project notes or docs.

After you answer, Guildhall saves the answer and decides the next useful move.
If the answer is still too soft for a worker, Guildhall can ask for one
concrete example or threshold. If the domain looks covered, it asks a closeout
question before moving on.

This is intentionally more careful than "sure, I'll build it." It is where
Guildhall tries to find missing requirements, hidden assumptions, vague quality
bars, risky non-goals, weak verification, and reviewer concerns before they
reach the codebase.

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

## What Guildhall Is Trying To Prove

The output is not just a prettier spec. Guildhall is trying to make the best
effort case that the work is ready to build:

- the spec matches the user's actual vision;
- the work is complete enough for the current phase;
- important assumptions, non-goals, and deferrals are visible;
- task boundaries are small enough to build and review;
- acceptance criteria are concrete;
- TDD and verification paths are known before implementation;
- the right expert lenses can review the result;
- a human can digest the plan without reading the whole transcript.

If a domain is unknown, it stays visible as an assumption or deferral instead
of quietly turning into a surprise halfway through implementation.

For ambiguous policy/spec requests, the output may be a parent feature rather
than one runnable task. That parent can hold the decision and spec while linked
child tasks handle UI, API, data, docs, release, and verification work in
smaller pieces.

## What Changes With The Work

Every task is pressure-tested, but the system owns how much pressure to apply.
The goal is always the same: enough inspection, verification, and review to make
the work trustworthy.

A tiny docs edit still gets checked for intent, location, tone, and verification
need. A known failing test still gets checked for the real failing path, likely
blast radius, and proof that the fix answers the failure. A one-file repair
still gets checked for scope, regression risk, and review expectations.

The difference is not a weaker standard. The difference is how much Guildhall
can prove automatically. It only stops you when your answer could change the
work: product intent, quality bar, risk tolerance, release boundary, or a
tradeoff the repo cannot decide on its own.
