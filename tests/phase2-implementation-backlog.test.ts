/**
 * Phase 2 implementation backlog captured as executable TODO tests.
 *
 * These TODOs intentionally do not implement production code. They translate
 * reviewer feedback into a precise, test-visible backlog for the implementation
 * agent that will later move from test prototypes to `src/` modules.
 */

import { test } from "node:test";

test.todo(
	"F002 guards are extracted from test prototypes into pure src/guards functions with identical fixture verdicts",
);

test.todo(
	"F002 Aegis-Reviewer merge preconditions consume deterministic content guard verdicts before merge_pull_request",
);

test.todo(
	"F001 crawler state uses a StateBackendAdapter abstraction rather than direct filesystem coupling",
);

test.todo(
	"F001 GCS backend contract rejects stale generation writes and maps conflicts to safe escalation or retry policy",
);

test.todo(
	"F003 GitHub App JWT is exchanged for an installation access token via an injectable fetch boundary",
);

test.todo(
	"F003 installation token exchange failures produce safe degraded operation metadata for Issue escalation",
);
