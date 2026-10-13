# Operations runbook

## MCP stdio worker failures

Inspect `/api/servers/:id/status` and `/api/servers/:id/logs`.
Workers restart at most five times in a 60-second window. A crashed worker is removed from routing; existing pending calls receive errors. Restart manually after fixing the command/image/environment.

## Container and Kubernetes ownership

Only Docker containers named `mcp-lab-<server-id>` carrying `mcp-runtime-lab.id=<server-id>` are managed. Only Kubernetes resources carrying `app.kubernetes.io/managed-by=mcp-runtime-lab` in the configured namespace may be updated or removed. Never grant untrusted users the admin token.

## Resource limits

Stdio: 1–32 replicas, max 100 pending calls per worker, 16 MiB maximum stdout line, 12s default per request, 1.8s graceful shutdown. API: max 1 MiB JSON, 20s request timeout. Benchmark: 1–100 workers, 1–30 seconds, max 3 simultaneous benchmark runs. Persistent registry keeps last 500 activity records and last 30 benchmark results.

## Backups

Stop the control plane before copying `/app/.data/registry.json` to avoid inconsistent administrative state. Secrets may be present in the file; encrypt backups.

## Observability

Use `/api/overview` for live state and `/metrics` for Prometheus; both require the administrator bearer token. Prometheus can use a bearer token file in a secured environment. The response is an in-memory rolling aggregate, not a durable time-series database.

## Future production hardening

A production multi-tenant control plane would need OIDC, fine-grained RBAC, secrets backends, PostgreSQL or another transactional datastore, desired-state reconciliation, HA leader election, structured distributed tracing, admission controls and a supported full MCP SDK transport for SSE/OAuth workflows. These are explicitly not claimed in v0.1.
