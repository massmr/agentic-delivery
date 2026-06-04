<p align="center">
  <img src="assets/ewokbot-logo.png" alt="Ewokbot logo" width="280" />
</p>

# Ewokbot

Ewokbot is an open-source agent runtime for autonomous software delivery.

It is designed to read work from Jira, inspect the relevant repositories, delegate implementation to a coding agent such as OpenCode, run quality gates, verify staging through Railway and/or Vercel, and prepare production pull requests for human approval.

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
- Package aliases for `ewokbot`, `ewok`, and the retained `agentic` binary.
- Interactive and non-interactive local onboarding that writes `config/workspace.yml` and `.env.example` placeholders.
- Local-only `ewokbot doctor` readiness checks with PASS/WARN/FAIL output and secret redaction.
- Deterministic mock end-to-end ticket runs.
- Persistent run state and Markdown reports under `runs/`.
- Jira ticket intake boundary with MCP-backed adapter support.
- GitHub code-host boundary for branches, pull requests, comments, and checks.
- Railway staging verification boundary for deployment state and service URLs.
- OpenCode execution contract with subprocess guardrails.
- Local quality-gate runner.
- Foreground `ewokbot worker start` runtime with bounded or continuous operation, dry-run preview, workspace locking, graceful shutdown, and restart-safe state reuse.
- Operation ledger for idempotent GitHub delivery handoffs.
- MCP tool discovery, allowlist, audit records, and error mapping.

Default behavior is safe:

- No real Jira, GitHub, Railway, or OpenCode calls by default.
- No remote git fetch, pull, or push by default.
- No production merge.
- No production deployment.
- No credentials required for mock mode.

The project is ready for local exploration and contribution, but not yet a turnkey autonomous production operator.

## Product Direction

Ewokbot is moving toward an npm-installable CLI that can be configured on a VPS and left running continuously.

Target shape:

```bash
npm install -g ewokbot
ewokbot init
ewokbot doctor
ewokbot worker start
ewokbot status
```

The first control surface is the terminal. It should feel familiar to users of Claude Code or OpenCode: explicit commands, readable state, local logs, and human approval gates. Telegram, WhatsApp, and other remote controls are future interfaces, not the current product surface.

The first supported setup path should cover OpenCode, optional oh-my-openagent configuration, GitHub, Jira, Railway, and Vercel. Railway and Vercel are both first-class deployment/CI monitoring targets.

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

After building locally, use the built CLI entrypoint directly. In an installed package, the same commands are available as `ewokbot`, `ewok`, or the retained `agentic` alias.

Initialize local setup files:

```bash
node dist/src/cli/index.js init
```

For automation or CI, use the non-interactive path:

```bash
node dist/src/cli/index.js init --non-interactive --deployment-monitor railway
```

Validate local setup files without provider, MCP, installer, or network calls:

```bash
node dist/src/cli/index.js doctor
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

Preview the mock backlog without writing run state or touching providers:

```bash
node dist/src/cli/index.js worker start --dry-run
```

Process the mock backlog through one foreground worker cycle:

```bash
node dist/src/cli/index.js worker start --once --concurrency 1 --max-attempts 2
```

Run the worker as a foreground VPS process:

```bash
node dist/src/cli/index.js worker start
```

`worker start` acquires a workspace lock at `runs/worker.lock` before it opens provider adapters, so two workers cannot process the same workspace concurrently. It logs startup mode, provider modes, lock lifecycle, cycle summaries, restart-safety decisions, and the human-only production boundary in operator-readable text.

Use `--once` for a single cycle, `--dry-run` for a read-only backlog preview, `--max-cycles` to bound a foreground session, and `--poll-interval-ms` to tune the continuous polling interval. `SIGINT` and `SIGTERM` request graceful shutdown and release the lock in cleanup. On restart, the worker checks the latest persisted state for each backlog ticket and skips tickets that already have run state so repeated launches do not duplicate side effects.

The legacy `worker` command remains available for compatibility with existing local and test workflows.

## Configuration

`ewokbot init` creates a mock-safe `config/workspace.yml` and a root `.env.example` with empty secret placeholders. It supports Railway-only, Vercel-only, or both deployment/CI monitor choices while keeping runtime provider modes on `mock` by default.

Examples:

```bash
ewokbot init --non-interactive --deployment-monitor railway
ewokbot init --non-interactive --deployment-monitor vercel
ewokbot init --non-interactive --deployment-monitor both
```

`ewokbot doctor` validates local readiness before worker use. It reports PASS/WARN/FAIL checks for Node.js, pnpm, OpenCode, optional oh-my-openagent markers, workspace config, `.env.example`, `.env`, GitHub, Jira, Railway, Vercel, repository paths, staging/production branch settings, and static quality gate presence.

Doctor output is redacted for all secret-related diagnostics. It names missing environment keys, but it does not print token, email, organization, URL, or secret values. It does not call Jira, GitHub, Railway, Vercel, MCP servers, OpenCode, package managers, git, package scripts, installers, or network APIs.

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

- CLI control commands for status, runs, pause/resume, and approval,
- real provider smoke runs with explicit operator approval,
- richer GitHub, Jira, Railway, and Vercel integrations.

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
