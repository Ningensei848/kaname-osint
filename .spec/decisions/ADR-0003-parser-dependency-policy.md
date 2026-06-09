# ADR-0003: Parser dependency policy

## Status

Accepted

## Context

The original design elevated Regex-only HTML/XML parsing to a strict rule. Real-world feeds and government sites include malformed HTML, namespace fields, CDATA, and embedded HTML.

## Decision

Regex-only parsing is a SHOULD-level preference, not a MUST. Parser dependencies MAY be introduced when justified by correctness, security, and maintainability.

## Approval criteria

A parser dependency requires:

- ADR update with alternatives considered.
- pnpm lockfile pinning.
- Takumi Guard pass.
- License and vulnerability checks.
- Fixtures covering malformed HTML, RSS, Atom, namespace, and CDATA cases.
