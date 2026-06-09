# Feature 002: Wiki incremental update and graph quality

## Goal

Aegis-Writer が既存 OFM コンテンツを破壊せず、新規ファクトだけを追記・統合し、内部リンクで重複説明を抑制する。

## Scope

- Topic frontmatter validation.
- No-overwrite / no-fact-loss guard.
- Incremental section append / merge.
- Orphan note detection and link proposal.
- Report novelty and duplicate suppression.

## Requirements

### F002-R1: Immutable vs mutable content

- `ssot.yml` and past dated reports are immutable.
- Topic pages are mutable but must preserve existing facts unless a deterministic migration explicitly permits removal.

### F002-R2: LLM boundary

LLM may propose Markdown patches. Deterministic guards MUST validate frontmatter, immutable files, no-overwrite policy, broken links, orphan-score regression, and duplicate thresholds.

### F002-R3: Orphan handling

Orphan handling SHOULD be score-based rather than binary. New high-severity orphan growth fails CI; existing orphan debt may be reported without blocking until explicitly targeted.

### F002-R4: Report novelty

Reports SHOULD focus on new facts. Repeated explanations SHOULD be replaced by `[[internal links]]` to existing topics or prior reports.

## Acceptance scenarios

- Existing topic content remains byte-for-byte present outside the intended insertion region.
- Internal links are not double-wrapped.
- A report item includes source evidence and at least one internal link unless it creates a new root topic.
- Broken internal links fail deterministic validation before Reviewer approval.
