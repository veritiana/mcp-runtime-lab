# MCP Runtime Lab

**by [VERITIANA](https://www.veritiana.com)**

### Run MCP servers. Manage their lifecycle. Measure their performance.

**An open-source runtime management platform for Model Context Protocol servers — built for local execution, Docker and Kubernetes.**

[![CI](https://github.com/veritiana/mcp-runtime-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/veritiana/mcp-runtime-lab/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-22%2B-43853d)
![License](https://img.shields.io/badge/License-Apache--2.0-blue)
![Release](https://img.shields.io/badge/Release-v0.1.0-6259EA)

---

![Veritiana MCP Runtime Lab Architecture](<docs/images/MCP Runtime Lab Architecture Infographic.png>)

---

## Beyond connecting tools

The Model Context Protocol makes tools accessible to AI agents.

But exposing a tool is only the beginning.

Once an organisation starts running dozens or hundreds of MCP server instances, a different set of engineering questions emerges:

- Who manages the server processes?
- How are they started, stopped, restarted and scaled?
- What happens when an MCP server crashes?
- How much memory and CPU does each runtime consume?
- How do we inspect and test tools before agents execute them?
- How do we compare local process execution with containerised deployment?
- How do we observe performance under concurrent agent workloads?

**MCP Runtime Lab was built to explore and address these operational challenges.**

Instead of treating every MCP server as an isolated integration, it introduces a unified management layer for deploying, operating, inspecting and benchmarking MCP workloads.

One platform. Multiple execution environments. Measurable behaviour.

## What you can do

| Capability | Description |
|---|---|
| MCP Server Registry | Register and configure local and remote MCP servers |
| Lifecycle Management | Start, stop, restart and remove managed workloads |
| Process Orchestration | Run multiple MCP subprocesses through stdio |
| Docker Integration | Deploy and manage MCP containers |
| Kubernetes Integration | Create and manage MCP workloads in a Kubernetes namespace |
| Tool Inspector | Discover MCP tools, resources, prompts and schemas |
| Tool Execution | Execute tools with JSON arguments and inspect responses |
| Performance Benchmarking | Measure throughput, latency and concurrent execution |
| Observability | Inspect process metrics, activity, errors and logs |
| Web Dashboard | Operate MCP servers through a browser-based management interface |

## Three execution models. One control plane.

MCP Runtime Lab separates management responsibilities from the execution of MCP tools.

### 01 — Local stdio runtime

Run MCP servers as independent operating-system processes.

Each worker has its own PID, memory space and bidirectional stdin/stdout pipes.

**No TCP listening port is required for individual stdio workers.**

The runtime provides:

- Managed process pools
- Concurrent request distribution
- Process health monitoring
- Automatic recovery with restart protection
- Execution timeouts and resource safeguards
- JSON-RPC message correlation
- Process-level status and logs

This model is especially useful for local agent environments, lightweight MCP tools and workloads where process isolation is preferred without introducing additional internal HTTP services.

### 02 — Docker runtime

Package MCP services into containers and manage them through the Docker Engine API.

The Docker adapter supports container creation, lifecycle operations, inspection and controlled execution.

Containerised deployment provides a repeatable environment with configurable resource limits and explicit execution boundaries.

Docker Engine workload management is optional and disabled by default because access to the Docker socket is highly privileged.

### 03 — Kubernetes runtime

Run MCP services as Kubernetes workloads.

The Kubernetes adapter manages Deployments and ClusterIP Services through the Kubernetes API, with namespace-scoped permissions and managed-resource ownership checks.

Supported operations include deployment, inspection, lifecycle management and replica scaling.

This provides a foundation for distributed MCP execution using Kubernetes infrastructure.

**The v0.1 release is not a Kubernetes Operator and does not implement a highly available, multi-replica control plane.**

## A management dashboard built for MCP operations

MCP Runtime Lab includes a browser-based dashboard connected to the actual management API.

The interface is designed around operational tasks rather than static demonstrations.

**Server Management**

Register MCP servers, inspect their current state and execute lifecycle operations from one interface.

**Tool Inspector**

Discover the tools exposed by an MCP server, examine their input schemas and execute test calls with JSON arguments.

**Runtime Visibility**

Inspect active processes, replica counts, runtime status, recent activity and execution errors.

**Benchmarking**

Generate concurrent tool calls and review latency distributions, throughput and execution results.

**Operational Control**

Configure supported workloads, manage process pools and investigate failures without manually controlling each process.

The dashboard uses lightweight JavaScript and CSS and does not require a frontend build framework.

## Architecture principles

MCP Runtime Lab follows five core design principles.

**1. Separate the control plane from the data plane.**

The control plane manages registration, configuration, lifecycle operations and observability.

The data plane executes MCP tool requests against the corresponding runtime.

**2. Avoid unnecessary network layers.**

Local MCP subprocesses communicate through operating-system pipes.

They do not require an additional internal HTTP server per worker.

**3. Respect execution boundaries.**

Local processes, Docker containers and Kubernetes workloads are managed through separate runtime adapters.

**4. Make behaviour measurable.**

Performance and failure characteristics should be measured against actual tool calls, not inferred from architectural diagrams.

**5. Keep infrastructure replaceable.**

Execution environments should evolve independently from the dashboard and management API.

### Technical foundation

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 |
| Implementation | JavaScript ES modules |
| Protocol | MCP / JSON-RPC 2.0 |
| Local IPC | stdin/stdout |
| Remote communication | HTTP |
| Web interface | Vanilla JavaScript + CSS |
| Persistence | Local JSON registry |
| Docker integration | Docker Engine API |
| Kubernetes integration | Kubernetes REST API |
| Observability | Prometheus metrics endpoint |
| Tests | Node.js built-in test runner |
| Deployment | Docker Compose / Helm |
| License | Apache-2.0 |

The project has no mandatory external JavaScript runtime dependencies or database.

## Quick start

### Option A — Run locally

Requirements:

- Node.js 22.12 or newer
- Linux, macOS or Windows with WSL
- VS Code recommended

Clone the repository:

```bash
git clone https://github.com/veritiana/mcp-runtime-lab.git
cd mcp-runtime-lab
```

Configure the environment:

```bash
cp .env.example .env
```

Generate two different authentication tokens:

```bash
openssl rand -hex 32
```

Edit `.env` in VS Code and configure `MCP_ADMIN_TOKEN` and `MCP_AGENT_TOKEN`.

Start the application:

```bash
set -a
source .env
set +a

npm start
```

Open:

**http://127.0.0.1:8787**

Authenticate using your administrator token.

On first launch, the application automatically registers the included Echo MCP demo, unless demo seeding has been disabled.

The example starts with two local MCP subprocesses and exposes working demonstration tools.

You can immediately inspect the server, execute a tool and run a benchmark.

### Option B — Docker Compose

For containerised execution:

```bash
cp .env.example .env
```

Configure authentication tokens in `.env`.

Then run:

```bash
docker compose up -d --build
```

Open:

**http://127.0.0.1:8787**

The Compose environment includes the MCP Runtime Lab control plane and an example HTTP MCP service.

The dashboard and persistent registry use a Docker volume.

### Optional Docker management

Docker Engine access is disabled by default.

On a trusted Linux Docker host, it can be enabled using the dedicated Compose override:

```bash
export DOCKER_SOCK_GID=$(stat -c %g /var/run/docker.sock)

DOCKER_ENABLED=true docker compose \
  -f compose.yaml \
  -f compose.docker-management.yaml \
  up -d --build
```

**Security:** Docker socket access can provide effective root-level control of the host. Do not enable it in an untrusted environment.

### Option C — Kubernetes

MCP Runtime Lab includes a Helm chart for Kubernetes deployment.

Requirements:

- A reachable Kubernetes cluster
- Helm 3
- kubectl
- A container registry accessible from the cluster

Build and publish the application image:

```bash
docker build \
  -f deploy/docker/Dockerfile \
  -t REGISTRY/mcp-runtime-lab:0.1.0 .

docker push REGISTRY/mcp-runtime-lab:0.1.0
```

Create the namespace and credentials:

```bash
kubectl create namespace mcp-system

kubectl -n mcp-system create secret generic mcp-runtime-secrets \
  --from-literal=admin-token="$(openssl rand -hex 32)" \
  --from-literal=agent-token="$(openssl rand -hex 32)"
```

Keep the generated token values securely for subsequent access.

Deploy with Helm:

```bash
helm upgrade --install mcp-runtime-lab \
  deploy/helm/mcp-runtime-lab \
  -n mcp-system \
  --set image.repository=REGISTRY/mcp-runtime-lab \
  --set image.tag=0.1.0
```

Access the dashboard:

```bash
kubectl -n mcp-system port-forward \
  service/mcp-runtime-lab 8787:8787
```

Open `http://127.0.0.1:8787`.

The Helm deployment uses one control-plane replica and namespace-scoped Kubernetes permissions.

To deploy managed MCP workloads, build and publish the included example HTTP MCP image or supply your own compatible image.

## MCP Tool Inspector

The Tool Inspector provides direct visibility into capabilities advertised by MCP servers.

Supported discovery operations include:

- `tools/list`
- `resources/list`
- `prompts/list`

You can inspect declared tool schemas and execute supported operations through the dashboard.

For example, the included Echo MCP server exposes tools such as:

- `echo`
- `sleep`
- `echo_bytes`
- `fibonacci`

This allows developers to verify MCP integration and runtime behaviour before introducing a full agent orchestration framework.

## MCP API

MCP requests are exposed through:

`POST /mcp/:serverId`

For example:

```bash
curl http://127.0.0.1:8787/mcp/echo-local \
  -H "Authorization: Bearer $MCP_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

The runtime supports a functional JSON-response subset of MCP Streamable HTTP, including initialization and tool execution.

It does not yet implement SSE streaming, OAuth authorization-server functionality, resumable sessions or all advanced MCP capabilities.

## Performance benchmarking

**Architecture should be measured, not assumed.**

One of the core objectives of MCP Runtime Lab is to make MCP execution performance observable and reproducible.

The benchmark engine records:

| Metric | Purpose |
|---|---|
| Throughput | Completed tool calls per second |
| p50 latency | Median response time |
| p95 latency | Tail latency |
| p99 latency | High-percentile latency |
| Success rate | Completed versus failed operations |
| Concurrency | Simultaneous execution pressure |
| Runtime status | Worker availability and failure behaviour |

### Run a local benchmark

```bash
npm run bench -- echo-local 10 5
```

This runs the benchmark against the registered `echo-local` MCP server with 10 workers for 5 seconds.

Benchmarks can also be initiated from the dashboard.

### What the benchmark tells you

The runtime benchmark measures actual MCP tool execution through the application.

It can help investigate:

- Process-pool concurrency
- JSON-RPC execution overhead
- Response latency
- Worker availability
- Error behaviour under load

It should not be confused with a distributed network benchmark.

A realistic comparison of HTTP/1.1, HTTP/2 and stdio under WAN conditions requires separately controlled network latency, bandwidth and client topology.

**The project does not claim that stdio is universally faster than HTTP.**

Its objective is to make architectural trade-offs measurable.

## Observability

The platform provides operational visibility through:

- Runtime status
- Managed process information
- Tool-call counters
- Request latency measurements
- Recent execution activity
- Bounded runtime logs
- Error tracking
- Prometheus-compatible metrics

Prometheus metrics are available through the authenticated:

`GET /metrics`

The v0.1 release does not bundle a complete Grafana, Loki or OpenTelemetry deployment.

These systems can be integrated separately as the observability architecture evolves.

## REST Management API

| Method | Endpoint | Operation |
|---|---|---|
| GET | `/api/overview` | Runtime overview |
| GET / POST | `/api/servers` | List or register servers |
| GET / PUT / DELETE | `/api/servers/:id` | Manage server configuration |
| POST | `/api/servers/:id/start` | Start server |
| POST | `/api/servers/:id/stop` | Stop server |
| POST | `/api/servers/:id/restart` | Restart server |
| POST | `/api/servers/:id/scale` | Scale supported runtimes |
| GET | `/api/servers/:id/inspect` | Inspect MCP capabilities |
| POST | `/api/servers/:id/call` | Execute MCP tool |
| GET | `/api/servers/:id/logs` | Retrieve recent logs |
| POST | `/api/servers/:id/benchmark` | Start benchmark |
| GET | `/api/benchmarks/:id` | Retrieve benchmark result |
| GET | `/metrics` | Prometheus metrics |
| POST | `/mcp/:id` | MCP JSON-RPC endpoint |

Management endpoints require an administrator bearer token.

MCP endpoints support separate agent authentication.

## Testing and validation

The project includes automated tests for the control plane, execution runtime and management adapters.

Run:

```bash
npm test
```

Or run syntax validation and the full test suite:

```bash
npm run check
```

### Verified in v0.1.0

The initial development environment reported **16 passing tests**, covering:

- Configuration validation
- Authentication enforcement
- Server registration and lifecycle
- MCP initialization over stdio
- Tool discovery and execution
- Process scaling and restart
- Process recovery
- Large stdio responses
- Benchmark execution
- Metrics and persistence
- HTTP MCP interaction
- Simulated Docker Engine API
- Simulated Kubernetes API

The application was also smoke-tested locally with running MCP subprocesses and the browser dashboard.

### Validation still required

Real Docker Engine management, real Kubernetes cluster operations and Helm deployment should be verified on the target infrastructure.

The automated adapter tests use simulated APIs and are not a substitute for full integration testing.

## Security model

MCP Runtime Lab includes basic operational safeguards, but v0.1 is a reference implementation rather than a production-hardened multi-tenant management system.

Current safeguards include:

- Separate administrator and agent tokens
- Default localhost binding outside containers
- Request and response limits
- Process timeout controls
- Restart protection
- Restricted inherited process environments
- Managed workload ownership checks
- Namespace-scoped Kubernetes permissions
- Basic container security settings

### Important limitations

The local registry uses JSON file persistence rather than a transactional database.

Environment overrides containing credentials may be stored in the local registry. Use a trusted host and protect the data directory.

The control plane supports one active registry owner. Distributed state coordination, leader election and high availability are not implemented.

Stdio workers can be shared across clients, so stateful per-client isolation requires additional session-aware routing.

There is no full user directory, OIDC integration or fine-grained RBAC in v0.1.

The HTTP MCP endpoint buffers JSON requests and responses and does not support streaming large payloads.

**Do not expose the management API directly to the public internet.** Remote deployments require appropriately configured HTTPS, authentication and network access controls.

## Repository structure

```text
mcp-runtime-lab/
├── src/
│   ├── runtime/
│   │   ├── stdio.mjs
│   │   ├── http-client.mjs
│   │   └── manager.mjs
│   ├── adapters/
│   │   ├── docker.mjs
│   │   └── kubernetes.mjs
│   ├── web/
│   ├── server.mjs
│   ├── config.mjs
│   ├── storage.mjs
│   ├── metrics.mjs
│   └── validate.mjs
├── examples/
├── benchmarks/
├── tests/
├── deploy/
│   ├── docker/
│   └── helm/
├── docs/
│   └── images/
│       └── MCP Runtime Lab Architecture Infographic.png
├── .github/
│   └── workflows/
├── compose.yaml
├── compose.docker-management.yaml
├── README.md
└── LICENSE
```

## Project roadmap

The next stages of MCP Runtime Lab are focused on operational maturity.

| Milestone | Planned direction |
|---|---|
| v0.1 | Working management dashboard, stdio runtime, Docker/Kubernetes adapters and benchmarks |
| v0.2 | Expanded real-environment integration testing and deployment validation |
| v0.3 | Improved process scheduling, session-aware routing and resource policies |
| v0.4 | Enhanced security, secrets management and audit capabilities |
| Future | Distributed control-plane state, high availability and deeper observability |

These are proposed directions, not completed functionality or guaranteed release commitments.

## Who is this for?

**AI architects**

Evaluate MCP runtime topology, deployment boundaries and process orchestration strategies.

**Platform engineers**

Explore operational models for managing MCP services across infrastructure environments.

**Agent developers**

Run, inspect and test MCP tools without building a complete management platform first.

**Open-source contributors**

Experiment with runtime scheduling, protocol transports, performance benchmarking and failure recovery.

## About Veritiana

**Engineering intelligent systems. Making architecture measurable.**

Veritiana explores AI architecture, runtime systems, developer infrastructure and practical approaches to building reliable AI-enabled software.

MCP Runtime Lab is part of that engineering work: an open-source reference project designed to turn architectural discussions into executable software and reproducible experiments.

The goal is not another abstraction around AI agents.

**The goal is to understand, control and measure the infrastructure on which they depend.**

Explore more projects and architecture work:

**[veritiana.com](https://www.veritiana.com)**

**[GitHub — Veritiana](https://github.com/veritiana)**

## Contributing

Contributions, technical feedback and reproducible benchmark results are welcome.

Areas of particular interest include MCP protocol compatibility, process orchestration, Kubernetes operations, performance measurement, observability and security.

When proposing performance changes, include the workload, runtime version, host configuration and reproducible measurements.

## License

Licensed under the **Apache License, Version 2.0**.

See [LICENSE](LICENSE) for details.

---

**VERITIANA — MCP Runtime Lab**

*From running tools to engineering reliable agent infrastructure.*

[Website](https://www.veritiana.com) · [GitHub](https://github.com/veritiana/mcp-runtime-lab) · Apache-2.0
