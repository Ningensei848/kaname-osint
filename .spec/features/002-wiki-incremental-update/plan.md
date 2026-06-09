# Plan: Feature 002

## Deterministic guard pipeline

```mermaid
flowchart TD
  A[Writer proposed patch] --> B[Frontmatter schema]
  B --> C[Immutable path guard]
  C --> D[No-overwrite diff guard]
  D --> E[Internal link graph guard]
  E --> F[Orphan score guard]
  F --> G[Duplicate / novelty guard]
  G --> H[Reviewer semantic review]
```

## Implementation notes

- Markdown manipulation utilities are allowed, but full Writer output must be validated as a whole document.
- Semantic link suggestions are LLM-assisted; graph validation is deterministic.
