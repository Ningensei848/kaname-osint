# Feature 001: Crawler idempotency and external state

## Goal

SSoT から公式情報源を収集し、正規化済み本文ハッシュと条件付き GET メタデータを用いて、不要な LLM 呼び出し、commit、PR 作成を機械的に防ぐ。

## Scope

- `ssot.yml` のロードと validation。
- Native Fetch による HTML / RSS / Atom の取得。
- コンテンツ正規化と SHA-256 ハッシュ計算。
- `crawler-state.json` の Cloud Storage 永続化。
- Cloud Storage generation precondition による競合防止。
- ソース単位の縮退運転。

## Non-goals

- Wiki Markdown 生成。
- GitHub MCP による PR 作成。
- Discord 通知。

## Requirements

### F001-R1: State storage

`crawler-state.json` は Git repository に commit しない。Cloud Run Jobs は Cloud Storage の object として state を読み書きする。

Recommended object layout:

```text
gs://<KANAME_STATE_BUCKET>/<environment>/crawler-state.json
```

### F001-R2: Concurrency control

state write は Cloud Storage generation precondition を用い、同一 state に対する並行 job の last-write-wins を禁止する。generation mismatch 時は再読込・再計算するか、Issue escalation する。

### F001-R3: Idempotency gate

前回 state の `content_hash` と今回正規化本文の hash が一致する source は、LLM、commit、PR の対象にしてはならない。

### F001-R4: Parser dependency policy

HTML / XML parsing は依存最小化を SHOULD とする。Regex only は MUST ではない。正確性・安全性・保守性の観点で必要な場合、ADR と security gate を通したうえで parser 依存を導入してよい。

## Acceptance scenarios

### Scenario A: unchanged source

Given state contains a source hash
When the crawler fetches equivalent normalized content
Then no Writer, MCP write, commit, or PR is started.

### Scenario B: concurrent state update

Given two Cloud Run Jobs read the same state generation
When both try to write updated state
Then only the first write succeeds and the second detects generation mismatch.

### Scenario C: malformed source

Given one invalid SSoT source and one valid source
When parsing SSoT
Then the invalid source is skipped with warning and the valid source is still processed.
