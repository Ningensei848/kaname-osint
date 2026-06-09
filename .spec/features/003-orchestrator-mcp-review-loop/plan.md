# Plan: Feature 003

## Components

- `AegisOrchestrator`: deterministic state machine.
- `McpClient`: stdio JSON-RPC process wrapper.
- `GitHubAuth`: GitHub App JWT and installation token exchange.
- `ReviewerGate`: CI, deterministic guards, security gate aggregation.

## Tool policy

Writer can write only to `osint/*` branches and approved content paths. Reviewer can merge only `osint/* -> main` after all gates pass.
