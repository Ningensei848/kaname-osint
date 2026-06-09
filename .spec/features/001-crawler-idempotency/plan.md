# Plan: Feature 001

## Architecture

```mermaid
flowchart TD
  A[Cloud Run Job] --> B[Load ssot.yml]
  B --> C[Read crawler-state.json from Cloud Storage]
  C --> D[Fetch each source]
  D --> E[Normalize content]
  E --> F[SHA-256 compare]
  F -- unchanged --> G[Skip source]
  F -- changed --> H[Emit diff data]
  H --> I[Write state with generation precondition]
```

## State backend

Use Cloud Storage as the default state backend. Firestore MAY be used later if queryability or transactional multi-object updates become necessary.

## Parser policy

Start with Native Fetch and minimal string processing. If malformed HTML / RSS coverage becomes brittle, introduce an approved parser through ADR.
