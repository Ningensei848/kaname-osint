# Feature 003: Orchestrator MCP review loop

## Goal

Aegis-Orchestrator が Writer / Reviewer / GitHub MCP を安全に調停し、最大3回の修正ループ、CI/security gate 前提の merge、失敗時 Issue escalation を保証する。

## Requirements

### F003-R1: State machine

The orchestrator MUST be defined by an explicit state transition table, not only pseudocode.

| Current | Event | Guard | Action | Next |
| --- | --- | --- | --- | --- |
| INIT | diff_empty | - | exit 0 | DONE |
| INIT | diff_found | - | start MCP | MCP_READY |
| MCP_READY | writer_success | PR exists | wait CI | PROPOSED |
| PROPOSED | deterministic_guard_failed | - | comment reject | REJECTED |
| PROPOSED | reviewer_approved | all gates passed | squash merge | MERGED |
| REJECTED | loop < 3 | - | writer revise | PROPOSED |
| REJECTED | loop >= 3 | - | create issue | ESCALATED |
| ANY | fatal_error | - | create issue and cleanup MCP | FAILED |

### F003-R2: MCP lifecycle

MCP child process MUST be terminated on DONE, MERGED, ESCALATED, FAILED, SIGTERM, and uncaught fatal errors.

### F003-R3: GitHub App token flow

Production MUST NOT use PAT. The flow is:

1. Generate GitHub App JWT with `exp <= 10 minutes`.
2. Exchange JWT for installation access token with `exp <= 1 hour`.
3. Pass installation token to MCP as `GITHUB_TOKEN_FOR_MCP` or provider-specific equivalent.

### F003-R4: Merge preconditions

Reviewer MUST NOT merge unless CI, deterministic content guards, security gates, and branch policy pass.

## Acceptance scenarios

- Unchanged diff exits without MCP startup.
- Three consecutive rejections create an Issue and do not merge.
- SIGTERM kills MCP child process.
- Merge is impossible if any deterministic guard fails.
