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
- Interactive and non-interactive local onboarding that writes `.ewokbot/workspace.yml`, `.ewokbot/.env`, and placeholder-only `.ewokbot/.env.example` setup files.
- User-level Ewokbot config/data/auth/cache layout under XDG-style paths, with workspace delivery evidence still kept under `.ewokbot/`.
- Dev tool setup detection adapters, starting with OpenCode command/config/auth/model readiness without taking ownership of OpenCode credentials.
- Local-only `ewokbot doctor` readiness checks with PASS/WARN/FAIL output and secret redaction.
- Deterministic mock end-to-end ticket runs.
- Persistent run state and Markdown reports under `.ewokbot/runs/`.
- Direct sibling Git repository discovery for parent workspace dry runs.
- Explicit `ewokbot run-dev <ticket-key> --confirm-dev-execution` flow for one controlled local development execution through branch creation, OpenCode, and local quality evidence only.
- Local CLI control plane for run listing, inspection, pause/resume intent, approval/rejection records, and persisted logs.
- Jira ticket intake boundary with MCP-backed adapter support.
- GitHub code-host boundary for branches, pull requests, comments, and checks.
- Railway staging verification boundary for deployment state and service URLs.
- OpenCode execution contract with subprocess guardrails.
- Local quality-gate runner.
- Foreground `ewokbot worker start` runtime with bounded or continuous operation, dry-run preview, workspace locking, graceful shutdown, and restart-safe state reuse.
- Operation ledger for idempotent GitHub delivery handoffs.
- MCP tool discovery, allowlist, audit records, and error mapping.
- Explicit `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` flow for one real-provider MCP smoke run through production PR preparation only.

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
ewokbot runs
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

Scan the configured Jira backlog from `.ewokbot/workspace.yml`. Mock mode remains the default; when Jira is configured as MCP, scan uses the typed `TicketPort` without writing run evidence:

```bash
node dist/src/cli/index.js scan
```

Plan one ticket against the discovered or explicitly configured repositories:

```bash
node dist/src/cli/index.js plan LK-101
```

The planning command is a dry-run boundary. It reads exactly one ticket through the configured typed `TicketPort.getTicket`, can use Jira MCP when `.ewokbot/workspace.yml` selects `jira.mode: mcp`, selects candidate repositories from direct sibling Git discovery or explicit `repos: [...]`, and writes only local planning evidence under `.ewokbot/runs/<ticket-key>/<run-id>/`. It does not create branches, run OpenCode, run package scripts, write an operation ledger, call GitHub, call Railway or Vercel, open pull requests, verify deployments, merge production, or deploy production.

Execute one explicitly confirmed development-only ticket after planning selects exactly one repository:

```bash
node dist/src/cli/index.js run-dev LK-101 --confirm-dev-execution
```

The `run-dev` command reuses the Jira ticket intake and repository planning boundary, refuses to start without `--confirm-dev-execution`, prints the selected ticket, repository, branch, quality gates, evidence path, and local-only stop boundary before creating state or git/OpenCode/quality side effects, then creates a local branch only in the selected repository. It invokes the configured OpenCode runner through the existing execution contract, runs local quality gates, and writes implementation and quality evidence under `.ewokbot/runs/<ticket-key>/<run-id>/`. It does not open GitHub pull requests, push branches, call Railway or Vercel, verify deployments, write an operation ledger, merge production, deploy production, or enable autonomous production automation.

Run one mock ticket end to end:

```bash
node dist/src/cli/index.js run LK-101
```

Run one explicitly confirmed real-provider smoke ticket after `.ewokbot/workspace.yml` and local readiness are prepared:

```bash
node dist/src/cli/index.js smoke LK-101 --confirm-real-provider-smoke
```

The smoke command uses `.ewokbot/workspace.yml` by default, refuses to start without `--confirm-real-provider-smoke`, runs `ewokbot doctor` checks before side effects, requires Jira, GitHub, and Railway to be configured as `mcp`, reads exactly one Jira ticket through `TicketPort.getTicket`, and requires planning to select exactly one repository. After preflight passes it creates local run state, creates a local git branch, invokes the configured OpenCode runner, runs local quality gates, opens the develop PR through the typed code host port, verifies Railway staging, and prepares a production PR for human review. It does not list the full backlog, merge production, or deploy production.

Inspect persisted run state:

```bash
node dist/src/cli/index.js status LK-101
```

List all persisted runs and inspect one by run id:

```bash
node dist/src/cli/index.js runs
node dist/src/cli/index.js inspect <run-id>
```

Pause worker processing, record a resume intent for a resumable run, and read local run reports/logs:

```bash
node dist/src/cli/index.js pause
node dist/src/cli/index.js resume <run-id>
node dist/src/cli/index.js logs <run-id>
```

Record the human production decision for a run that has opened a production PR:

```bash
node dist/src/cli/index.js approve <run-id>
node dist/src/cli/index.js reject <run-id>
```

These control commands read and write only local files under `.ewokbot/runs/`. `pause` writes `.ewokbot/runs/control.json`; `resume`, `approve`, and `reject` write `.ewokbot/runs/<ticket-key>/<run-id>/control.json`. Approval and rejection are local operator records only: they do not merge pull requests, deploy production, call providers, run OpenCode, or push git changes.

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

`worker start` acquires a workspace lock at `.ewokbot/runs/worker.lock` before it processes work, so two workers cannot process the same workspace concurrently. In MCP mode, runtime MCP setup is validated before the lock is created, run state is written, Jira is read, git/OpenCode/PR/deployment work starts, or provider mutations occur. It logs startup mode, provider modes, lock lifecycle, cycle summaries, restart-safety decisions, and the human-only production boundary in operator-readable text.

Use `--once` for a single cycle, `--dry-run` for a read-only backlog preview, `--max-cycles` to bound a foreground session, and `--poll-interval-ms` to tune the continuous polling interval. `SIGINT` and `SIGTERM` request graceful shutdown and release the lock in cleanup. On restart, the worker checks the latest persisted state for each backlog ticket and skips tickets that already have run state so repeated launches do not duplicate side effects. If `.ewokbot/runs/control.json` marks the workspace paused, the worker exits before opening ticket providers or starting delivery work.

The legacy `worker` command remains available for compatibility with existing local and test workflows.

## Configuration

`ewokbot init` creates mock-safe `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` owned paths. It does not create root `config/workspace.yml`, root `.env`, root `.env.example`, or root `runs/` defaults. It also prepares the user-level Ewokbot directories used for machine-wide config, auth metadata, durable user state, and cache. It supports interactive wizard choices for OpenCode command selection, optional oh-my-openagent intent, Jira MCP, GitHub MCP, Railway MCP, and Railway/Vercel deployment-monitor intent while keeping deterministic non-interactive init mock-safe by default. OpenCode-owned auth and model/provider credentials stay in OpenCode's own setup; Ewokbot init does not ask for or copy them into `.ewokbot/.env`.

User-level paths follow XDG overrides when present and otherwise default to:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

The generated user `auth.json` is Ewokbot auth metadata only; OpenCode credentials remain owned by OpenCode and provider secrets remain in `.ewokbot/.env`. Where supported, `auth.json` is created with owner-only permissions. `ewokbot doctor` reports whether these user-level paths are present without reading or printing auth contents.

The generated `.ewokbot/.env.example` file is placeholder-only. Secret values belong only in `.ewokbot/.env`, and `init` refuses to overwrite existing `.ewokbot/workspace.yml`, `.ewokbot/.env`, or `.ewokbot/.env.example` by default.

Generated configs discover repositories from the workspace root by default:

```yaml
repos:
  discovery: sibling-git-directories
  exclude: []
```

Discovery watches direct child directories that contain `.git/`, sorts them by folder name, ignores `.ewokbot/`, hidden directories, `node_modules/`, non-Git directories, nested repositories, and any names listed in `exclude`. Discovered repositories use the folder basename as the repo name and `./<folder>` as the local path. Explicit `repos: [...]` entries remain supported for workspaces that need manual repository metadata.

Examples:

```bash
ewokbot init --non-interactive --deployment-monitor railway
ewokbot init --non-interactive --deployment-monitor vercel
ewokbot init --non-interactive --deployment-monitor both
```

`ewokbot doctor` validates local readiness before worker use. It reports PASS/WARN/FAIL checks for Node.js, pnpm, OpenCode, optional oh-my-openagent markers, workspace config, `.ewokbot/.env.example`, `.ewokbot/.env`, GitHub, Jira, Railway, Vercel, discovered or explicit repository paths, staging/production branch settings, and static quality gate presence. OpenCode readiness uses a dev-tool setup adapter with normalized states for missing commands, command failures, unsupported versions, missing authentication, missing model configuration, and ready setups. It checks configured/custom command paths, OpenCode config presence at `~/.config/opencode/opencode.json`, OpenCode auth presence at `~/.local/share/opencode/auth.json` or an explicitly injected `opencode auth list` probe, and project config at `<workspace-root>/opencode.json` without printing raw config or auth values. Discovery mode warns clearly when no direct sibling Git repositories are found.

Doctor output is redacted for all secret-related diagnostics. It names missing environment keys, but it does not print token, email, organization, URL, or secret values. It does not call Jira, GitHub, Railway, Vercel, MCP servers, OpenCode, package managers, git, package scripts, installers, or network APIs.

Providers default to `mock` mode. Jira, GitHub, and Railway also support `mcp` mode. Runtime commands load `.ewokbot/.env` before provider, OpenCode, and MCP construction without mutating `process.env`; MCP subprocesses receive only the configured allowlisted environment variable names. The public CLI constructs supported stdio MCP clients from `.ewokbot/workspace.yml` when provider modes reference configured `mcp_servers`; tests can still inject mock MCP clients directly. The controlled `run-dev` command requires only the Jira ticket read boundary and does not require GitHub or Railway MCP readiness. The real-provider smoke command requires all three provider modes to be explicitly set to `mcp`; the existing mock `run` command remains unchanged and loads `.ewokbot/workspace.yml` by default.

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

For Milestone AF, public runtime construction supports stdio MCP servers (`command` plus optional `args`). HTTP MCP server entries remain parsed by configuration but fail fast as unsupported by the public runtime until a later approved milestone adds and tests that transport. The CLI passes a restricted environment allowlist to MCP subprocesses: standard local process variables plus any `mcp_servers.<id>.env_var_names` entries.

First real smoke launch sequence after configuring local MCP/OAuth sessions:

```bash
ewokbot doctor
ewokbot scan
ewokbot run-dev LK-101 --confirm-dev-execution
ewokbot smoke LK-101 --confirm-real-provider-smoke
```

`ewokbot scan`, `ewokbot worker start`, `ewokbot run-dev`, and `ewokbot smoke` all receive the public runtime MCP factory. Tests still use fake SDK/client factories or mock MCP clients only; no live MCP sessions, provider services, OpenCode subprocesses, package managers, remote git endpoints, provider CLIs, production merge, or production deployment are exercised in tests.

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

Never commit `.env` files or provider credentials. Use generated `.ewokbot/.env` for local workspace secrets, keep `.ewokbot/.env.example` placeholder-only, and use the wizard or Ewokbot-owned files when intentionally changing workspace-local runtime environment values.

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

- completed CLI control commands for status, runs, pause/resume, and approval,
- one explicit real-provider smoke command with operator confirmation,
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
