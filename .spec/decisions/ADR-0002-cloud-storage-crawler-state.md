# ADR-0002: Store crawler state in Cloud Storage

## Status

Accepted

## Context

Cloud Run Jobs are stateless. The prior design considered committing `crawler-state.json` to the repository to preserve idempotency metadata.

## Decision

`crawler-state.json` is stored outside Git, with Cloud Storage as the default backend. Firestore remains a future option if transactional or query-heavy state management becomes necessary.

## Rationale

- Avoids state-only commits and noisy Git history.
- Avoids merge conflicts between autonomous content PRs and state updates.
- Supports generation preconditions for concurrency control.
- Keeps immutable content history separate from mutable runtime metadata.

## Consequences

- Cloud Run Jobs require access to a configured state bucket.
- Tests must mock Cloud Storage generation preconditions.
- Git repository remains the content and spec source of truth, not the runtime state store.
