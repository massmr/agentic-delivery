<p align="center">
  <img src="assets/ewokbot-logo.png" alt="Ewokbot logo" width="280" />
</p>

# Ewokbot

Ewokbot is an open-source agent runtime for autonomous software delivery.

It is designed to read work from Jira, inspect the relevant repositories, delegate implementation to a coding agent such as OpenCode, run quality gates, verify staging, and prepare production pull requests for human approval.

The core idea is simple:

```text
Jira ticket
  -> repo analysis
  -> implementation by coding runner
  -> tests and quality gates
  -> develop PR
  -> staging verification
  -> production PR
  -> human approval
```

Ewokbot is **MCP-first** for external SaaS providers and **human-gated** for production. It is not intended to silently merge production code.

## Project Status

Ewokbot is early, active, and intentionally conservative.

Current capabilities:

- CLI-first local runtime.
- Deterministic mock end-to-end ticket runs.
- Persistent run state and Markdown reports under `runs/`.
- Jira ticket intake boundary with MCP-backed adapter support.
- GitHub code-host boundary for branches, pull requests, comments, and checks.
- Railway staging verification boundary for deployment state and service URLs.
- OpenCode execution contract with subprocess guardrails.
- Local quality-gate runner.
- Worker loop with bounded concurrency, retry, and escalation policy.
- Operation ledger for idempotent GitHub delivery handoffs.
- MCP tool discovery, allowlist, audit records, and error mapping.

Default behavior is safe:

- No real Jira, GitHub, Railway, or OpenCode calls by default.
- No remote git fetch, pull, or push by default.
- No production merge.
- No production deployment.
- No credentials required for mock mode.

The project is ready for local exploration and contribution, but not yet a turnkey autonomous production operator.

## Why Ewokbot?

Most coding agents are good at implementing a task once they are given a clean prompt and a checked-out repository. Real delivery work needs more around that:

- picking the right ticket,
- finding the right repository,
- creating safe branches,
- producing a focused implementation prompt,
- running repeatable quality gates,
- verifying staging,
- preparing pull requests,
- preserving state across failures,
- keeping production approval human-only.

Ewokbot is the orchestration layer around the coding agent.

## Installation

Requirements:

- Node.js 20+
- pnpm

Install dependencies:

```bash
pnpm install
```

Build:

```bash
pnpm build
```

Run tests:

```bash
pnpm test
```

Typecheck:

```bash
pnpm typecheck
```

## Quickstart

Initialize a local workspace config:

```bash
node dist/src/cli/index.js init
```

Inspect available commands:

```bash
node dist/src/cli/index.js --help
```

Scan the mock Jira backlog:

```bash
node dist/src/cli/index.js scan
```

Plan a mock ticket:

```bash
node dist/src/cli/index.js plan LK-101
```

Run one mock ticket end to end:

```bash
node dist/src/cli/index.js run LK-101
```

Inspect persisted run state:

```bash
node dist/src/cli/index.js status LK-101
```

Run local quality gates for a repository:

```bash
node dist/src/cli/index.js quality ./path/to/repo --ticket-key LK-101 --run-id local-checks
```

Process the mock backlog through the worker:

```bash
node dist/src/cli/index.js worker --concurrency 1 --max-cycles 1 --max-attempts 2
```

## Configuration

`ewokbot init` copies `config/workspace.example.yml` to `config/workspace.yml`.

Providers default to `mock` mode. Jira, GitHub, and Railway also support `mcp` mode through runtime-injected MCP clients.

Example Jira MCP configuration:

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

The public CLI does not start live MCP sessions, OAuth flows, or network clients by itself yet. MCP clients are wired through runtime factories and tests currently use mock clients.

See:

- [MCP-first architecture](docs/specs/mcp-first-architecture.md)
- [Technical architecture](docs/specs/technical-architecture.md)
- [Product spec](docs/specs/product-spec.md)
- [Quality gates](docs/specs/quality-gates.md)

## Architecture

Ewokbot separates business intent from provider-specific tools through typed ports:

- `TicketPort` for Jira-like backlog systems.
- `CodeHostPort` for GitHub-like code hosts.
- `DeploymentPort` for Railway-like deployment providers.
- `DevRunnerPort` for coding agents such as OpenCode.
- Local git, filesystem state, reports, and quality gates through native or subprocess adapters.

External SaaS providers are MCP-first:

```text
Ewokbot runtime
  -> typed business port
  -> MCP adapter
  -> provider MCP tool
```

Fallbacks are explicit and policy-bound:

- MCP for external SaaS tools when possible.
- Native APIs only for documented precision gaps.
- Subprocesses for local git, quality commands, and OpenCode.
- Mocks for deterministic tests and local demos.
- Human-only for production merge and production deployment.

## Safety Model

Ewokbot is built around a strict production boundary.

Allowed autonomously:

- read backlog tickets,
- analyze repositories,
- create working branches,
- run a coding runner,
- run local quality gates,
- prepare develop pull requests,
- verify staging,
- prepare production pull requests.

Requires a human:

- merging to production,
- deploying production,
- changing production deployment configuration,
- exposing or rotating secrets,
- destructive data operations.

Never commit `.env` files or provider credentials. Use `.env.example` and local environment variables for private configuration.

## Development

Common commands:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Run formatting checks for whitespace-sensitive diffs:

```bash
git diff --check
```

The test suite is intentionally mock-heavy. New provider work should add contract tests around typed ports before adding live network behavior.

## Roadmap

Near-term direction:

- real MCP session runner for local CLI usage,
- real Jira intake smoke test,
- control-plane command layer for Telegram, WhatsApp, CLI, and future mobile interfaces,
- first real end-to-end ticket run with explicit operator approval,
- durable worker and resume flow,
- richer GitHub and Railway MCP integrations.

Track detailed planning in:

- [Roadmap](docs/tracking/roadmap.md)
- [Next actions](docs/tracking/next-actions.md)
- [Progress log](docs/tracking/progress-log.md)
- [Risks and blockers](docs/tracking/risks-and-blockers.md)

## Contributing

Contributions are welcome. Please keep changes aligned with the safety model:

- mock mode must remain the default,
- production merge must remain human-only,
- provider adapters must stay behind typed ports,
- MCP tool names must not leak into delivery logic,
- tests should not require live credentials or network access.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

If you find a security issue, please do not open a public issue with exploit details. See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
