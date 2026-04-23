# Architecture standards
Boundaries are enforced by tooling, not by convention.

## Module boundaries
- Enforce allowed imports with dependency-cruiser (or equivalent). CI fails on violation.
- Dependencies point inward: domain core → adapters → I/O. Never the reverse.
- No circular dependencies, ever. Break with an interface or a shared lower layer.

## Layering
- Domain/core is pure. No filesystem, network, DB, or time calls in core.
- Side effects live at the top (entry points, handlers). Pure logic sits underneath.
- Adapters translate between the outside world and domain types. They do no business logic.

## API surface
- Public package exports are a stable contract. Breaking changes are a major version.
- Internal helpers are free to change. Do not export what callers do not import.
- Inversion of control at module seams: pass callbacks and interfaces, do not hard-wire concretes.

## File & directory size
- Warn at ~300 LOC per file. Split when a file has multiple responsibilities.
- Warn at ~20 files per directory. Split by feature, not by type.
- Organize by feature (`orders/`, `billing/`) not by kind (`controllers/`, `models/`).

## Functions
- One level of abstraction per function. Orchestrate or do work, not both.
- Functions take explicit parameters. No reading from global config mid-logic.
- Return data, not side-effect handles, where possible.
