# Guildhall Release-Cycle Product Goal v5

This replaces the earlier goal wording that made “finish the Narrative
Harness MVP” sound like the product objective. Narrative Harness is the
proving project. Guildhall is the product being finished and evaluated.

## Copy/paste goal

> Make Guildhall trustworthy by taking one real project through one complete,
> bounded release cycle: turn information visible in Guildhall into a clear
> project shape, select or define a release, show exactly what belongs to it,
> execute only that scope, preserve current proof and activity, close the
> release with durable evidence, and activate later work without changing the
> truth of the closed release.
>
> Use Narrative Harness as the proving ground. Re-intake only from sources
> visible in Guildhall. Choose a meaningful, non-empty release or bounded
> scope from that information. Drive it through shaping, decomposition,
> delegated authorization, Start/Resume, implementation, review, proof, and
> release closure. Then activate a later scope and prove that the earlier
> release remains closed, unchanged, and findable.
>
> Every failure found during this cycle is a Guildhall product defect first.
> Repair the owning data model, write path, projection, workflow, read
> boundary, or shared UI component; migrate affected state; remove competing
> interpretations; add regression coverage; and replay the same stage. Do not
> fit Narrative Harness around a bug, manufacture records during reads,
> duplicate business rules, silently broaden the run, or hide uncertainty in
> copy.
>
> Releases are optional and may have arbitrary names. A project remains open;
> only a selected release or bounded scope can close. Guildhall may reason
> about scope, sequencing, decomposition, and proof, but it may not convert
> its own confidence into owner approval. Codex may perform explicitly
> delegated owner actions during this validation, which is separate from what
> Guildhall itself is permitted to automate.

## Finish line

This goal is complete only when the installed product demonstrates all of the
following for the same Narrative Harness state:

1. **Shape:** a first-time user can see the project purpose, capability chain,
   selected release, later/deferred work, unknowns, and source trail without
   opening every task.
2. **Scope:** the selected release has stable, untruncated work identities,
   hierarchy, membership, status, ownership, and proof contracts. Later work
   is visible but cannot enter execution silently.
3. **Execution:** Start and Resume consume only the selected scope. Each run
   has one durable current task, checkpoint, next action, and bounded context.
   A stall becomes an honest actionable state rather than an indefinitely
   active run.
4. **Proof:** every included item has current project-backed proof. A generic
   build, checkbox, worker paragraph, stale projection, or retained transcript
   cannot masquerade as the required proof.
5. **Closure:** the release closes only after all included work and proof are
   complete. The project does not become terminally complete.
6. **Later work:** activating a later scope changes only the active scope. It
   does not reopen, rewrite, duplicate, or alter the closed release's counts,
   evidence, or history.
7. **Communication:** Project Map, Overview, Work, Release, Activity, Thread,
   task detail, API, and CLI agree on scope, counts, status, blockers, next
   action, proof, and closure. The 1,000-foot view explains the skeleton; the
   100-foot view explains the current situation.
8. **Weight:** fleet reads use saved bounded summaries; detail is on demand;
   raw transcripts and debug payloads are bounded operational evidence; cold
   restart preserves the same truth without loading every project's full
   history.

## Operating rule

At each stage, capture the user's job, reproduce the failure through the
installed route and authoritative API or CLI, identify the single owning
authority, repair it, test the cross-surface contract, rebuild/install/restart,
and replay the stage. A failure that does not block this finite cycle becomes
later Guildhall work instead of expanding the Narrative Harness release.

The validation must include one deliberate proof failure and recovery, one
worker pause/resume, one restart, and one later-scope activation. Evidence is
accepted only when API, CLI, visible UI, and the restarted installation agree.

## Explicit non-goals

- Completing every future Narrative Harness capability.
- Requiring every project to define releases.
- Treating “MVP,” “Product Shape,” or “Closure” as universal product stages.
- Making Guildhall impersonate the owner or invent approval.
- Adding another parallel spine, map, task tree, closure model, or summary
  ledger.
