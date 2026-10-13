# MCP Runtime Lab v0.1.0

Initial public reference implementation.

## Included

- Functional browser dashboard for registry, status, tool inspection/testing, process lifecycle, scaling, logs, benchmarks and audit.
- Working local stdio MCP process pool with JSON-RPC initialize, round-robin routing, concurrent calls, shutdown, crash restart and health reporting.
- Streamable HTTP JSON-response MCP endpoint and remote HTTP client adapter.
- Docker Engine API and namespace-scoped Kubernetes API workload adapters.
- Docker Compose, optional Docker socket integration, Helm chart, RBAC, persistent state volume.
- Self-contained example MCP servers (stdio and HTTP), architecture source/PNG/SVG, real dashboard screenshots.
- 16 passing Node.js tests including full API integration, provider mocks, crash recovery and a 10 MiB IPC response.
- Benchmark engine with concurrent real tool calls, process/performance metrics and Prometheus exposition.

## Important scope boundaries

This is a single-control-plane reference implementation. Real Docker daemon and Kubernetes cluster deployment were not available for live validation in the packaging environment. Full MCP SSE/OAuth/resumability and enterprise HA/RBAC/secret vault integrations are deliberately out of scope for v0.1. Read README and docs/OPERATIONS.md before deploying.
