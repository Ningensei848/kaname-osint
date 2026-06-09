# Security policy

## Gate levels

- MUST: Violations can leak secrets, corrupt content, or publish broken output.
- SHOULD: Default operational preference. Exceptions require ADR.
- MAY: Allowed implementation detail.

## Protected autonomous merge requirements

Aegis-Reviewer MUST NOT merge unless all required security gates are green:

- frozen dependency install
- typecheck
- tests
- secret scanning or equivalent
- Takumi Guard
- deterministic content guards

Takumi Guard indeterminate or unavailable status is treated as fail-closed for autonomous merge.
