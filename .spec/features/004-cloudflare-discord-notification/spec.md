# Feature 004: Cloudflare deployment gated Discord notification

## Goal

Discord 通知を main merge ではなく、Cloudflare Pages の production deployment success に厳格にバインドする。

## Requirements

### F004-R1: Notification gate

Discord notification MUST be sent only when all are true:

- `deployment.status === "success"`
- `deployment.environment === "production"`
- `deployment.meta.branch === "main"`
- deployment URL matches configured public base URL
- latest report URL is live
- commit hash has not already been notified

### F004-R2: Idempotency

Notification state SHOULD be stored outside Git, using the same state backend family as crawler state unless a separate ADR says otherwise.

### F004-R3: Failure handling

Discord webhook failures SHOULD retry with bounded backoff. Repeated failures create a GitHub Issue; they must not re-run content generation.

## Acceptance scenarios

- Preview deployments do not notify.
- Failed or pending deployments do not notify.
- Duplicate commit hash does not notify twice.
- Production success with live report URL produces a valid Discord embed.
