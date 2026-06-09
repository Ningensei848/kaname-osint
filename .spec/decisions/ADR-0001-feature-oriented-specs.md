# ADR-0001: Feature-oriented spec organization

## Status

Accepted

## Context

The original `.spec/` package grouped product specification, business rules, data models, contracts, and tasks by document type. This was readable but weak for PR-level traceability.

## Decision

Keep global documents for cross-cutting principles, but add feature-specific folders under `.spec/features/<id>-<slug>/` with `spec.md`, `plan.md`, `tasks.md`, and `acceptance.md`.

## Consequences

- PRs can cite feature IDs and task IDs.
- Traceability can be maintained without editing one giant task list for every change.
- Cross-cutting documents remain as shared context, not per-feature implementation plans.
