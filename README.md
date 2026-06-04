# Agentic Delivery

Agentic Delivery is an independent orchestration layer for autonomous software delivery.

The project goal is to connect Jira, GitHub, Railway, and a coding runner such as OpenCode so backlog items can move from analysis to implementation, staging verification, and production pull request creation.

The planned system is designed for full autonomy until production. A human validates production pull requests before merge.

## Architecture Direction

Agentic Delivery is an agent runtime with typed business ports backed first by MCP tools, with native, subprocess, and mock adapters as fallbacks.

MCP is the preferred control plane for external SaaS providers such as Jira, GitHub, Railway, Vercel, and Bitbucket. The runtime still owns state, decisions, policies, retries, reports, local quality gates, and production approval.

See [MCP-First Architecture](docs/specs/mcp-first-architecture.md).

## Core Goal

```text
Jira backlog
  -> ticket analysis
  -> repo discovery
  -> branch creation
  -> OpenCode implementation
  -> quality gates
  -> PR to develop
  -> Railway staging verification
  -> PR to main
  -> human production approval
```

## Current Phase

This repository now includes the config, domain, state, report, mock planning, local quality-gate, OpenCode runner, local git/GitHub handoff, mock Railway staging verification, local run-status foundations, resume guard policy, multi-repo safety guard, provider adapter design boundaries, shared MCP client foundation, MCP-backed Jira TicketPort, GitHub CodeHostPort, Railway DeploymentPort, tested native fallback contracts, a mock-safe agent worker loop, and runtime MCP wiring for the orchestrator. It can initialize and validate a local workspace configuration, scan deterministic mock Jira backlog tickets, plan one ticket, process queued mock backlog tickets with concurrency and retry limits, select candidate repositories, run local repository quality gates, build deterministic working branch names, create local-only git branches, prepare mock or MCP-backed GitHub develop PR handoffs, verify mock or MCP-backed Railway deployment state and service URLs, write staging reports, inspect existing run state, identify automatically resumable states, stop safely when one ticket maps to multiple repositories, discover and authorize mock MCP tools, audit MCP tool calls, map MCP timeout/auth/session errors, validate runtime MCP tool readiness before adapter use, map Atlassian MCP Jira search/get/comment tools behind `TicketPort`, and write resumable run state without provider credentials. GitHub MCP currently covers branch creation, pull requests, checks, and comments; actual branch pushing remains on the local git/native or subprocess fallback path until a precise MCP push contract exists. Railway MCP is read-oriented for deployment state and service URL lookups; native Railway fallback is allowed only when MCP lacks required polling, metadata, or service URL precision.

The current public CLI implementation is still local and mock-only. It makes no real Jira, GitHub, Railway, or OpenCode provider calls, performs no remote git fetch/pull/push, and never merges or deploys production. The public `agentic run <ticket-key>` command executes one deterministic mock ticket run through production PR preparation for human approval. The public `agentic worker` command processes the deterministic mock backlog queue with bounded concurrency, retry/backoff, escalation, and safe stop limits. Runtime MCP wiring is exposed as a library path for injected or constructed `McpClient` instances; it does not start live MCP sessions, OAuth, or network clients by itself.

Start with:

- [Product Spec](docs/specs/product-spec.md)
- [Technical Architecture](docs/specs/technical-architecture.md)
- [MVP Plan](docs/plans/mvp-plan.md)
- [OpenCode Execution Prompt](docs/prompts/opencode-build-orchestrator.md)

## Usage

Install dependencies:

```bash
pnpm install
```

Typecheck:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Build the CLI:

```bash
pnpm build
```

Show the built CLI help:

```bash
node dist/src/cli/index.js --help
```

Initialize a workspace config:

```bash
node dist/src/cli/index.js init
```

Scan the mock Jira backlog:

```bash
node dist/src/cli/index.js scan
```

Plan one mock Jira ticket:

```bash
node dist/src/cli/index.js plan LK-101
```

Run one mock ticket end to end:

```bash
node dist/src/cli/index.js run LK-101
```

Process the mock backlog queue with the worker loop:

```bash
node dist/src/cli/index.js worker --concurrency 1 --max-cycles 1 --max-attempts 2
```

`agentic worker` reads backlog tickets through the typed ticket port, keeps mock providers as the default, de-duplicates tickets within the invocation, enforces bounded concurrency, and stops safely when the queue is idle unless additional cycles are requested. `--concurrency` can only lower or match the workspace `max_concurrent_tickets` policy; it cannot raise that cap. Safe options are `--concurrency`, `--max-cycles`, `--max-attempts`, `--base-backoff-ms`, `--max-backoff-ms`, and `--poll-interval-ms`.

Inspect an existing run state:

```bash
node dist/src/cli/index.js status LK-101
node dist/src/cli/index.js status LK-101 --run-id LK-101-20260603-100000000
```

Run local quality gates for a repository:

```bash
node dist/src/cli/index.js quality ./path/to/repo --ticket-key LK-101 --run-id local-checks
```

`agentic init` copies `config/workspace.example.yml` to `config/workspace.yml`. It creates the `config` directory when needed and refuses to overwrite an existing `config/workspace.yml`.

`config/workspace.yml` is the local workspace file. Provider sections support `mock` and `real` modes, and Jira, GitHub, and Railway also support `mcp` mode for runtime-wired MCP clients. Mock remains the default and the public commands still run without provider credentials. Real Jira, GitHub, and Railway modes currently fail fast in adapter factories when required environment variables are missing and otherwise report that live adapters are reserved for their later milestones. GitHub supports `mcp` mode for branch creation, pull requests, checks, and comments only; Railway supports `mcp` mode for deployment state and service URL lookups only.

An Atlassian MCP remote server can be declared without repository secrets like this:

```yaml
jira:
  mode: mcp
  base_url: https://your-domain.atlassian.net
  project_keys:
    - LK
  mcp_server: atlassian
  mcp_tools:
    list_backlog: searchJiraIssuesUsingJql
    get_ticket: getJiraIssue
    comment: addCommentToJiraIssue

mcp_servers:
  atlassian:
    display_name: Atlassian MCP
    command: npx
    args:
      - -y
      - mcp-remote
      - https://mcp.atlassian.com/v1/mcp/authv2
```

The runtime factory path for `jira.mode: mcp`, `github.mode: mcp`, and `railway.mode: mcp` resolves configured `mcp_servers`, uses either injected `mcpClients[serverId]` or an injectable `createMcpClient(serverConfig)` factory, discovers required tools, validates them against typed port/action allowlists, and passes audit records through a shared MCP audit sink. Jira MCP tool names default to the Atlassian names above and can be overridden with `jira.mcp_tools`. In MCP mode, `jira.project_keys` are validated as uppercase Jira project keys before building JQL. Runtime MCP wiring does not add a live MCP process/session runner, OAuth flow, provider REST adapter, or public CLI MCP mode.

Railway follows the same runtime-wired client pattern. `railway.mode: mcp` requires a resolved `McpClient` keyed by `railway.mcp_server`. Railway MCP tool names default to the deployment-state and service URL names above and can be overridden with `railway.mcp_tools`. Railway MCP is read-oriented: it reads deployment state and service URLs, but any unsupported deployment action stays on the native/local fallback path.

## Native Fallback Contracts

The exported `nativeFallbackContracts` policy defines which adapter kinds are allowed for each typed port action. External SaaS providers stay MCP-first by default:

- Jira ticket list/get/comment actions use MCP or mock only.
- GitHub branch creation, pull requests, checks, and PR comments are MCP-first; native GitHub fallback is allowed only when MCP lacks the precision needed for PR fields, check status/conclusion detail, or exact comment targeting.
- GitHub `pushBranch` is not an MCP action. Actual branch pushes require local git/native or subprocess behavior until a precise MCP push contract exists.
- Railway deployment polling, deployment reads, and service URL lookup are MCP-first; native Railway fallback is allowed only when MCP lacks required polling state, metadata, timeout, or URL precision.
- Local workspace git operations, filesystem run state/report writes, quality gates, and OpenCode execution use native or subprocess adapters rather than MCP.
- Production merge and production deployment mutation remain human-only and have no autonomous adapter fallback.

Mock adapters remain allowed for deterministic local runs and tests. The fallback contracts do not add live API calls, credentials, remote git pushes, production merges, or production deployments.

`agentic plan` writes:

```text
runs/<ticket-key>/<run-id>/
  plan.md
  state.json
```

`agentic run <ticket-key>` uses mock Jira, mock GitHub, mock Railway, a deterministic mock OpenCode runner, and local-only git command simulation. It writes a complete mock run folder and stops at `PRODUCTION_PR_OPENED` so production merge remains a human-only action:

```text
runs/<ticket-key>/<run-id>/
  plan.md
  implementation-log.md
  quality-report.md
  quality-logs/
    test.stdout.log
    test.stderr.log
  staging-report.md
  final-report.md
  state.json
```

The final report summarizes the selected repositories, branch refs, implementation log path, quality outcome, develop PR, staging deployment and smoke checks, production PR, final state, and the mock-only/human approval note.

If mock planning selects more than one repository, `agentic run <ticket-key>` stops before branch creation or implementation, persists `NEEDS_HUMAN`, writes the plan report, and exits non-zero with a reason. Multi-repo sub-runs are not implemented yet; split the Jira ticket or choose one repository before continuing.

`agentic worker` uses the same mock-safe delivery path for each queued ticket. It persists worker attempt state before processing, writes returned ticket run state, retries failed tickets with deterministic backoff, escalates exhausted or human-gated tickets to `NEEDS_HUMAN`, and returns a non-zero exit code when any ticket escalates. It does not make live provider calls, request credentials, push remote branches, merge production pull requests, or deploy production.

`agentic status <ticket-key> [--run-id <run-id>]` reads existing local `runs/<ticket-key>/<run-id>/state.json` files without provider credentials. When `--run-id` is omitted, it lists known runs for the ticket and selects the latest run by persisted `updatedAt` timestamp. The status output summarizes state, next action, repositories, branches, PRs, quality, staging, failures, and required human action.

Resume policy is currently exposed as library helpers only: `canResumeState(state)` and `assertStateResumable(state)`. Automatic resume is allowed for active lifecycle states from `DISCOVERED` through `STAGING_VERIFIED`. It is blocked for terminal or human-gated states: `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE`. The guard has no side effects and does not call providers, rerun commands, merge production, or trigger a resume command.

`agentic quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]` reads `.agent-quality.yml` from the target repository or falls back to detected Node package scripts. Required gates without commands fail configuration. Optional gates without commands are recorded as skipped warning results and do not fail the run.

`agentic quality` writes:

```text
runs/<ticket-key>/<run-id>/
  quality-report.md
  quality-logs/
    <gate>.stdout.log
    <gate>.stderr.log
  state.json
```

Milestone G adds library interfaces for the future develop PR handoff path without adding a public CLI command. The exported helpers include deterministic `agent/<JIRA_KEY>-<short-slug>` branch naming, a local-only git adapter with an injectable argument-array command runner, a mock GitHub connector, a develop PR body builder, and state helpers for `BRANCH_CREATED`, `PUSHED`, and `PR_TO_DEVELOP_OPENED`.

Milestone H adds library interfaces for the future Railway staging verification path without adding a public CLI command. The exported helpers include a future-shaped Railway connector interface, deterministic `MockRailwayConnector`, `SmokeUrlVerifier` interface, deterministic `MockSmokeUrlVerifier`, `runStagingVerification(...)`, staging state helpers for `STAGING_DEPLOYING`, `STAGING_VERIFIED`, and failed staging outcomes, and a production pull request readiness guard that accepts only `STAGING_VERIFIED` runs. Staging verification writes `runs/<ticket-key>/<run-id>/staging-report.md` through `MarkdownReportWriter.writeStaging(...)`.

Milestone I adds the public mock `agentic run <ticket-key>` path, deterministic `MockOpenCodeRunner`, production PR preparation helper, production PR body builder, `PRODUCTION_PR_OPENED` state recording, and final report writer. The command is still mock-only and prepares a production PR ref for human review without real provider calls, remote pushes, production merge, or production deployment.

Milestone J adds the public local `agentic status <ticket-key> [--run-id <run-id>]` path, run-state lookup/listing/latest-selection helpers, concise Markdown status rendering, and deterministic `getNextActionForState(...)` guidance for every delivery lifecycle state. It does not resume or trigger side effects; resumability policy is reserved for Milestone K.

Milestone K adds the resume guard policy with `canResumeState(...)` and `assertStateResumable(...)`. The policy covers every delivery lifecycle state and prevents automatic continuation from `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE`. No resume command or live provider action is added in this milestone.

Milestone L adds the multi-repo safety guard for `agentic run <ticket-key>`. Single-repo mock runs still complete to `PRODUCTION_PR_OPENED`; tickets that resolve to multiple repositories persist `NEEDS_HUMAN` with a clear reason and do not proceed to implementation, quality, staging, or production PR preparation.

Milestone M adds real provider adapter design boundaries without live calls. Workspace config now accepts `mock` or `real` provider modes, adapter factories keep mock connectors as the default, and real Jira/GitHub/Railway factories fail fast with explicit credential errors before any future live adapter can be constructed. Real Jira, GitHub, and Railway implementations remain future milestones.

Milestone O adds the shared MCP client foundation without live provider calls. The exported `src/mcp` APIs include MCP server config helpers, `McpClient`, deterministic `MockMcpClient`, tool discovery, tool allowlist enforcement for typed port/action pairs, audit record creation, allowed tool-call execution with audit records, and timeout/auth/session error mapping. Tests use only mock MCP clients and do not start OAuth, network, or live MCP server sessions.

Milestone P adds a typed `TicketPort` boundary and a Jira MCP adapter for Atlassian MCP search, issue fetch, and comment capabilities. Raw MCP tool names stay inside the Jira adapter/config layer, can be overridden per workspace, and missing tools raise actionable `McpToolNotFoundError`s. The adapter preserves MCP audit records through an optional typed audit sink, and MCP-mode project keys are validated before JQL construction. Tests use only `MockMcpClient` with no live Jira, OAuth, or MCP server calls. `JiraConnector` remains compatible with `TicketPort` for existing planning and run code.

Milestone S adds tested Native Fallback Contracts under `src/policy`. The policy defines when MCP, native, subprocess, mock, and human-only surfaces are allowed for Jira, GitHub, Railway, local workspace git, filesystem writes, quality gates, OpenCode execution, and production controls. It preserves MCP-first external SaaS behavior while making local/subprocess fallback boundaries explicit.

Milestone T adds the mock-safe `agentic worker` backlog processor. The worker queues mock backlog tickets, honors concurrency and max-cycle stop limits, supports deterministic retry/backoff and escalation, persists attempt and returned run states, and exposes a safe CLI command without live provider calls, credentials, remote pushes, production merge, or production deployment.

Milestone U adds runtime MCP wiring for typed Jira, GitHub, and Railway adapters. `createRuntimeWorkspaceAdapters(...)` resolves configured MCP servers, constructs or injects clients, validates tool discovery and typed allowlists before adapter use, exposes provider MCP requirement metadata, and shares MCP audit capture across providers. Tests use only `MockMcpClient`; no live MCP sessions, OAuth, provider network calls, production merge, or production deployment are added.

Repository entries in `config/workspace.yml` can define staging smoke checks with `staging_smoke_urls`. Use an empty array to intentionally skip smoke checks for a repository:

```yaml
repos:
  - name: api
    staging_smoke_urls:
      - /health
```

## Operating Principles

- Jira is the source of truth for work.
- GitHub is the source of truth for code review and checks.
- Railway deploys staging from `develop` and production from `main`.
- OpenCode is the primary development runner.
- Quality gates are required before pushing work.
- Production merges require human approval.
- Every ticket run must be resumable, auditable, and reportable.
