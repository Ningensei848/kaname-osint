# ADR-0004: Security gates and Takumi Guard

## Status

Accepted

## Context

Takumi Guard is a core supply-chain security gate. Operational unavailability is expected to be rare and primarily caused by communication failures or Takumi-side incidents.

## Decision

Takumi Guard remains a required security gate for protected PRs. It is part of a broader security gate set, but protected autonomous merge must fail closed when Takumi Guard cannot produce a successful result.

## Required baseline gates

- Frozen pnpm install.
- TypeScript typecheck.
- Unit and contract tests.
- Secret scanning or equivalent CI check.
- Takumi Guard success.

## Failure policy

If Takumi Guard is unreachable or returns an indeterminate status, Aegis-Reviewer must not merge. The system should create or update a GitHub Issue with the failure fingerprint rather than bypass the gate.
