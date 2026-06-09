# Acceptance: Feature 001

Feature 001 is complete when:

- `crawler-state.json` is never committed to the content repository.
- Cloud Storage state read/write is covered by mocked generation-precondition tests.
- unchanged sources produce zero Writer invocations and zero MCP write calls.
- SSoT and crawler-state schemas are executable test inputs, not only Markdown examples.
