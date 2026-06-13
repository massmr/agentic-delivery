<p align="center">
  <img src="assets/ewokbot-logo.png" alt="Ewokbot logo" width="280" />
</p>

# Ewokbot

Ewokbot is an open-source agent runtime for autonomous software delivery.

It is designed to read work from an Atlassian workspace through Jira work items, inspect the relevant repositories, delegate implementation to a coding agent such as OpenCode, run quality gates, verify staging through Railway and/or Vercel, and prepare production pull requests for human approval.

The core idea is simple:

```text
Jira work item
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
- Ewokbot-owned auth metadata commands for Atlassian/Jira, GitHub, Railway, and Vercel that keep OpenCode auth external.
- Dev tool setup detection adapters, starting with OpenCode command/config/auth/model readiness without taking ownership of OpenCode credentials.
- Local-only `ewokbot doctor` readiness checks with PASS/WARN/FAIL output and secret redaction.
- Deterministic mock end-to-end ticket runs.
- Persistent run state and Markdown reports under `.ewokbot/runs/`.
- Direct sibling Git repository discovery for parent workspace dry runs.
- Explicit `ewokbot run-dev <ticket-key> --confirm-dev-execution` flow for one controlled local development execution through branch creation, OpenCode, meaningful diff, agent completion, core safety, test relevance, and local quality evidence only.
- Local fixture harness with `ewokbot harness run <fixture-id>` and `ewokbot harness run --all` for deterministic scoring of meaningful diff, repository selection, policy decisions, quality results, and report presence.
- Local CLI control plane for run listing, inspection, pause/resume intent, approval/rejection records, and persisted logs.
- Local `ewokbot ui` invocation control surface for one workspace-bound session, backed by safe read-only APIs for workspace readiness, provider configuration, runs, and reports.
- Atlassian MCP ticket intake boundary with Jira as the first supported work-item surface.
- GitHub code-host boundary for branches, pull requests, comments, and checks.
- Railway staging verification boundary for per-repository deployment state, service URLs, and explicit Railway project/environment/service mappings.
- OpenCode execution contract with subprocess guardrails.
- Local quality-gate runner.
- Foreground `ewokbot worker start` runtime with bounded or continuous operation, dry-run preview, workspace locking, graceful shutdown, and restart-safe state reuse.
- Operation ledger for idempotent GitHub delivery handoffs.
- MCP tool discovery, allowlist, audit records, and error mapping.
- Read-only MCP schema inspection with human-readable and JSON output, plus policy-gated tool registry metadata for configured provider servers.
- Explicit `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` flow for one Atlassian MCP Jira work-item read, validated local evidence, develop PR handoff, and read-only Railway staging verification evidence using the selected repository's deployment mapping.

Default behavior is safe:

- No real Atlassian/Jira, GitHub, Railway, or OpenCode calls by default.
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

The first supported setup path should cover OpenCode, optional oh-my-openagent configuration, GitHub, Atlassian MCP with Jira work items, Railway, and Vercel. Railway and Vercel are both first-class deployment/CI monitoring targets. Confluence is future policy-gated Atlassian work and is not implemented in the current setup or runtime workflows.

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

Start the local invocation control UI for the current workspace:

```bash
node dist/src/cli/index.js ui
```

The UI is local-only and bound to the current workspace root. It shows workspace readiness, configured provider modes, repository discovery, Railway mapping placeholders, run state, and known reports without exposing `.ewokbot/.env` values or starting delivery side effects such as OpenCode execution, branch creation, pull requests, staging verification, deployment, or production merge.

Inspect Ewokbot-owned provider auth metadata without touching OpenCode auth:

```bash
node dist/src/cli/index.js auth status
node dist/src/cli/index.js auth list
node dist/src/cli/index.js auth login github
node dist/src/cli/index.js auth logout github
```

Scan the configured Jira backlog from `.ewokbot/workspace.yml`. Mock mode remains the default; when the Atlassian MCP Jira surface is configured as MCP, scan uses the typed `TicketPort` without writing run evidence:

```bash
node dist/src/cli/index.js scan
```

Plan one ticket against the discovered or explicitly configured repositories:

```bash
node dist/src/cli/index.js plan LK-101
```

The planning command is a dry-run boundary. It reads exactly one ticket through the configured typed `TicketPort.getTicket`, can use Atlassian MCP for Jira work items when `.ewokbot/workspace.yml` selects `jira.mode: mcp`, selects candidate repositories from direct sibling Git discovery or explicit `repos: [...]`, and writes only local planning evidence under `.ewokbot/runs/<ticket-key>/<run-id>/`. It does not create branches, run OpenCode, run package scripts, write an operation ledger, call GitHub, call Railway or Vercel, open pull requests, verify deployments, merge production, or deploy production.

Execute one explicitly confirmed development-only ticket after planning selects exactly one repository:

```bash
node dist/src/cli/index.js run-dev LK-101 --confirm-dev-execution
```

The `run-dev` command reuses the Jira ticket intake and repository planning boundary, refuses to start without `--confirm-dev-execution`, prints the selected ticket, repository, branch, quality gates, evidence path, and local-only stop boundary before creating state or git/OpenCode/quality side effects, then creates a local branch only in the selected repository. It invokes the configured OpenCode runner through the existing execution contract, writes `meaningful-diff.json`, evaluates the agent completion summary into `agent-completion.json`, evaluates core safety into `core-safety.json`, then runs local quality gates only when the diff is meaningful, agent completion is `pass`, and the safety decision is `pass`. Agent completion or safety `fail` stops as `FAILED`; `needs_human` stops as `NEEDS_HUMAN` with a human-action reason. It does not open GitHub pull requests, push branches, call Railway or Vercel, verify deployments, write an operation ledger, merge production, deploy production, or enable autonomous production automation.

Run the deterministic local fixture harness after building:

```bash
node dist/src/cli/index.js harness run ad-101-minimal-node
node dist/src/cli/index.js harness run --all
```

The harness copies fixture repositories into temporary workspaces, injects fake ticket, git, coding-runner, and quality seams, and scores expected outcomes against the persisted run evidence. It is local-only: it does not mutate source fixture repositories or user repositories, start live OpenCode, call Jira, GitHub, Railway, Vercel, MCP, or network services, push branches, open pull requests, merge, or deploy.

Run one mock ticket end to end:

```bash
node dist/src/cli/index.js run LK-101
```

Run one explicitly confirmed real-provider smoke ticket after `.ewokbot/workspace.yml` and local readiness are prepared:

```bash
node dist/src/cli/index.js smoke LK-101 --confirm-real-provider-smoke
```

The smoke command uses `.ewokbot/workspace.yml` by default, refuses to start without `--confirm-real-provider-smoke`, validates scoped runtime MCP readiness for Jira ticket intake, GitHub develop PR handoff, and Railway read-only staging evidence, reads exactly one Jira ticket, and requires planning to select exactly one repository. After preflight passes it creates local run state, creates a local git branch, invokes the configured OpenCode runner, writes meaningful-diff, agent-completion, core-safety, test-relevance, and local quality evidence, opens the develop-target handoff through the typed code-host boundary, verifies staging through policy-approved read-only Railway deployment evidence, runs configured staging smoke URLs when available, and writes `staging-report.md` plus `final-report.md`. It stops at `STAGING_VERIFIED` or a failure/human-action state. It does not list the full backlog, transition or comment on Jira outside the typed handoff, call Railway deploy/rollback/scale/variable/domain mutation tools, call Vercel, prepare or open production pull requests, merge production, or deploy production. Tests for this path remain fake-only.

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

Inspect a configured MCP server before mapping provider tools:

```bash
node dist/src/cli/index.js mcp inspect atlassian
node dist/src/cli/index.js mcp inspect atlassian --schema
node dist/src/cli/index.js mcp inspect railway --json
node dist/src/cli/index.js mcp inspect railway --cache-registry
```

The default inspect output stays compact and human-readable. `--schema` adds sanitized input schemas plus any output schema or output metadata exposed by MCP discovery, and `--json` emits the same inspected server/tool data as parseable JSON with safety metadata, an internal tool registry, and MCP policy decisions. Registry entries record provider, server id, tool name, sanitized schemas, output metadata when present, category, classification, source, and default-deny policy metadata. Known registry classifications are `read`, `write`, `destructive`, `secret_sensitive`, `unknown`, and `custom`; unknown and unclassified tools remain denied by default.

`--cache-registry` is the explicit operator opt-in for writing an inspection snapshot to `.ewokbot/cache/mcp-tools/<server-id>.json`. Snapshots are sanitized, live separately from provider credentials and run evidence, and support full mapping with policy-gated execution. Inspect mode remains read-only: it may call MCP tool discovery (`listTools`) for the configured server, but it does not call provider tools, deploy Railway services, mutate Jira/GitHub, execute registry entries, cache schemas outside Ewokbot-owned paths, or print credential-like defaults/examples.

## Configuration

`ewokbot init` creates mock-safe `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/` owned paths. It does not create root `config/workspace.yml`, root `.env`, root `.env.example`, or root `runs/` defaults. It also prepares the user-level Ewokbot directories used for machine-wide config, auth metadata, durable user state, and cache. In an interactive terminal, init uses an `@inquirer/prompts` TUI with guided selections for OpenCode command readiness, optional oh-my-openagent intent, Atlassian MCP for Jira work items, GitHub MCP, Railway MCP, Railway/Vercel deployment-monitor intent, and optional per-repository Railway staging mappings while keeping deterministic non-interactive init mock-safe by default. Missing or not-ready OpenCode states offer mock mode, setup instructions, or explicit custom-command/acknowledged continuation choices only; Ewokbot does not install OpenCode, launch auth, or copy OpenCode-owned auth and model/provider credentials into `.ewokbot/.env`.

For GitHub MCP, init configures the official Docker-based local MCP server preset and asks only for `GITHUB_PERSONAL_ACCESS_TOKEN`. Ewokbot should derive repository owners and names from the local git remotes in the directory where it is launched, so there is no global GitHub organization prompt in the onboarding flow. Run `ewokbot doctor` after init to verify Docker, provider secrets, local MCP commands, OpenCode, and repository readiness before using `ewokbot mcp inspect github`.

User-level paths follow XDG overrides when present and otherwise default to:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

The generated user `auth.json` is Ewokbot auth metadata only; OpenCode credentials remain owned by OpenCode and provider secrets remain in `.ewokbot/.env`. Where supported, `auth.json` is created with owner-only permissions. `ewokbot auth status`, `ewokbot auth list`, `ewokbot auth login <provider>`, and `ewokbot auth logout <provider>` manage metadata-only Atlassian/Jira, GitHub, Railway, and Vercel entries in that user-level auth file without live OAuth/provider calls or workspace `.ewokbot/` auth writes. `ewokbot auth login opencode` refuses and points operators to OpenCode because OpenCode auth is managed by OpenCode. `ewokbot doctor` reports whether these user-level paths are present without reading or printing auth contents.

The generated `.ewokbot/.env.example` file is placeholder-only. Secret values belong only in `.ewokbot/.env`, and `init` refuses to overwrite existing `.ewokbot/workspace.yml`, `.ewokbot/.env`, or `.ewokbot/.env.example` by default.

Generated configs discover repositories from the workspace root by default:

```yaml
repos:
  discovery: sibling-git-directories
  exclude: []
```

Discovery watches direct child directories that contain `.git/`, sorts them by folder name, ignores `.ewokbot/`, hidden directories, `node_modules/`, non-Git directories, nested repositories, and any names listed in `exclude`. Discovered repositories use the folder basename as the repo name and `./<folder>` as the local path. Explicit `repos: [...]` entries remain supported for workspaces that need manual repository metadata.

Repository deployment mappings are explicit per repository. Discovery mode can keep watching every sibling Git repository while storing per-repository deployment overrides under `repos.deployments`. A Railway smoke run requires the selected repository to have a valid staging mapping unless the repository explicitly chooses `github_only` or `none` verification. Repositories that do verify staging can use `railway_mcp`, `http_smoke`, `github_only`, or `none` verification modes:

```yaml
repos:
  discovery: sibling-git-directories
  exclude: []
  deployments:
    api:
      staging:
        provider: railway
        project_id: prj_api
        environment_id: env_staging
        service_id: svc_api
        branch: develop
        verification:
          mode: railway_mcp
          smoke_urls:
            - /health
    worker:
      staging:
        provider: railway
        branch: develop
        verification:
          mode: none
          smoke_urls: []
```

Examples:

```bash
ewokbot init --non-interactive --deployment-monitor railway
ewokbot init --non-interactive --deployment-monitor vercel
ewokbot init --non-interactive --deployment-monitor both
```

`ewokbot doctor` validates local readiness before worker use. It reports PASS/WARN/FAIL checks for Node.js, pnpm, OpenCode, optional oh-my-openagent markers, workspace config, `.ewokbot/.env.example`, `.ewokbot/.env`, GitHub, Atlassian/Jira, Railway, Vercel, discovered or explicit repository paths, per-repository deployment mappings, staging/production branch settings, and static quality gate presence. OpenCode readiness uses a dev-tool setup adapter with normalized states for missing commands, command failures, unsupported versions, missing authentication, missing model configuration, and ready setups. It checks configured/custom command paths, OpenCode config presence at `~/.config/opencode/opencode.json`, OpenCode auth presence at `~/.local/share/opencode/auth.json` or an explicitly injected `opencode auth list` probe, and project config at `<workspace-root>/opencode.json` without printing raw config or auth values. Discovery mode warns clearly when no direct sibling Git repositories are found. Railway mapping checks are static and actionable: `railway_mcp` requires `project_id`, `environment_id`, and `service_id`; `http_smoke` requires absolute HTTP(S) smoke URLs; `github_only` and `none` do not require Railway IDs.

Doctor output is redacted for all secret-related diagnostics. It names missing environment keys, but it does not print token, email, organization, URL, or secret values. It does not call Atlassian/Jira, GitHub, Railway, Vercel, MCP servers, OpenCode, package managers, git, package scripts, installers, or network APIs.

Providers default to `mock` mode. The Atlassian/Jira ticket provider, GitHub, and Railway also support `mcp` mode. Runtime commands load `.ewokbot/.env` before provider, OpenCode, and MCP construction without mutating `process.env`; MCP subprocesses receive only the configured allowlisted environment variable names. The public CLI constructs supported stdio MCP clients from `.ewokbot/workspace.yml` when provider modes reference configured `mcp_servers`; tests can still inject mock MCP clients directly. The controlled `run-dev` command requires only the Jira ticket read boundary and does not require GitHub or Railway MCP readiness. The BB/BD smoke command requires `jira.mode`, `github.mode`, and `railway.mode` to all be `mcp`; it fails before run state, git, OpenCode, quality, provider handoff, operation ledger, staging report, production PR, merge, or deploy side effects if any of those providers remain in mock mode. When the modes are valid, smoke validates scoped readiness for Jira `TicketPort.getTicket`, GitHub develop PR handoff tools, and Railway read-only staging evidence, then uses only the selected repository's `deployments.staging` mapping for Railway calls. Vercel readiness is not required or contacted by smoke. The existing mock `run` command remains unchanged and loads `.ewokbot/workspace.yml` by default.

MCP policy defaults to `read_only` and is configured through top-level `mcp_policy`. Supported modes are `read_only`, `supervised`, `trusted`, and `custom`; supported decisions are `allow`, `allow_redacted`, `require_human`, and `deny`. Overrides can target providers, servers, or tools, with tool overrides taking precedence. Runtime MCP readiness evaluates the inspected registry classification and configured policy before typed-port allowlist checks; autonomous runtime execution proceeds only for `allow`, while `deny`, `require_human`, and `allow_redacted` stop before provider side effects. Secret-sensitive tools, unknown tools, destructive deletes, production merge, and production deploy are not autonomously allowed by default.

Example MCP policy configuration:

```yaml
mcp_policy:
  mode: read_only
  providers:
    atlassian:
      decision: require_human
      reason: Jira writes require operator approval.
  servers:
    railway:
      decision: deny
      reason: Railway writes are disabled in this workspace.
  tools:
    create_pull_request:
      decision: require_human
      reason: GitHub PR creation is policy-gated until PR handoff is explicitly enabled.
```

Develop draft PR handoff is intentionally narrower than general GitHub write access. BA handoff may create a draft PR to the repository's develop/staging target only after local evidence has already passed: local quality, meaningful diff, agent completion, core safety, and test relevance must all be usable and passing in run state. Workspaces that want this handoff must explicitly allow `create_pull_request`; otherwise runtime readiness fails before branch push, GitHub PR creation, or operation-ledger mutation:

```yaml
mcp_policy:
  mode: trusted
  tools:
    create_pull_request:
      decision: allow
      reason: Develop PR handoff is allowed after local evidence.
```

Develop PR follow-up is branch-scoped: teams can allow Ewokbot to auto-merge non-production branches such as `develop` after local evidence and remote checks are acceptable, while keeping `main` and production PRs human-only. Repositories without GitHub Actions or external CI still need deterministic tracking, so the `no_remote_checks` policy decides whether absent remote checks are accepted, waited on, escalated to a human, or treated as a failure:

```yaml
delivery:
  checks:
    no_remote_checks: pass
  pull_requests:
    develop:
      auto_merge: true
      merge_method: squash
      require_checks: pass_or_absent
      after_merge:
        verify_deployment: true
    main:
      auto_merge: false
      require_human_approval: true
```

When a develop PR is opened, Ewokbot reads PR state and checks through the typed `CodeHostPort`, records follow-up evidence in run state and reports, stops cleanly if the PR is closed without merge, and continues to Railway staging only after develop is actually ready. Human-merged PRs are staging-ready. Absent checks are accepted only when `no_remote_checks: pass` and `require_checks: pass_or_absent` are both configured; if develop `auto_merge` is also enabled, Ewokbot merges the develop PR before marking staging-ready, and if `auto_merge` is disabled it waits for a human merge instead. Staging verification is not attempted while the develop PR remains open, waiting, needs human review, failed policy checks, or closed without merge.

Example Atlassian MCP configuration for Jira work items:

```yaml
jira:
  mode: mcp
  base_url: https://your-domain.atlassian.net
  # Optional filter. Leave [] to scan all visible Jira projects.
  project_keys:
    - LK
  mcp_server: atlassian
  mcp_tools:
    list_backlog: search_jira_issues
    get_ticket: read_jira_issue
    comment: add_jira_comment

mcp_servers:
  atlassian:
    transport: stdio
    command: mcp-atlassian
    args: []
    env_var_names:
      - ATLASSIAN_BASE_URL
      - ATLASSIAN_EMAIL
      - ATLASSIAN_API_TOKEN
```

`ewokbot init` keeps the Atlassian MCP Jira connector as an Ewokbot-owned preset, so operators should not need to know or type the MCP server id, command, args, or environment allowlist for the default Jira path. The current maintained preset is the local `mcp-atlassian` stdio server with `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, and `ATLASSIAN_API_TOKEN`. Jira project keys are an optional backlog constraint, not credentials; leaving them blank writes `project_keys: []` and scans all visible projects available to the configured Atlassian MCP session. Ewokbot does not read OpenCode MCP configuration for Jira; OpenCode remains only the development runner. Confluence remains future policy-gated work and is not read, scanned, or mutated by this setup path. The CLI passes a restricted environment allowlist to MCP subprocesses: standard local process variables plus any `mcp_servers.<id>.env_var_names` entries.

GitHub MCP runtime mapping uses the inspected tools documented in `docs/reference/github-mcp-tools.md`. The default `CodeHostPort` mapping checks branch readiness with `list_branches`, creates remote branches only through `create_branch` when explicitly needed, opens develop-target draft PRs with `create_pull_request`, resolves PR numbers with `list_pull_requests`, reads PR state and checks through `pull_request_read` using typed methods, comments on PRs through `add_issue_comment` with the PR number as `issue_number`, and can call `merge_pull_request` only through the typed develop auto-merge path when workspace delivery config enables develop `auto_merge`, `require_human_approval` is false, and MCP policy explicitly allows that merge tool. Raw `merge_pull_request` policy evaluation remains human-only outside that typed develop path. Custom `github.mcp_tools` overrides remain supported for these typed actions. GitHub branch push remains on the local/native git fallback path, and Ewokbot does not call branch deletion, remote file mutation, repository mutation, workflow mutation, secret management, main/production merge, or production automation tools by default.

Example Railway MCP configuration generated by the maintained local preset:

```yaml
railway:
  mode: mcp
  staging_branch: develop
  production_branch: main
  mcp_server: railway

mcp_servers:
  railway:
    transport: stdio
    command: railway
    args:
      - mcp
    env_var_names: []
```

Railway MCP uses the Railway CLI session owned by Railway. Install the Railway CLI and run `railway login` outside Ewokbot before enabling this path; `ewokbot init` does not collect `RAILWAY_TOKEN` for the default Railway MCP preset. Interactive init can prompt for explicit repository-to-Railway mappings and manual project/environment/service IDs when discovery is unavailable, so runtime staging verification does not rely on `railway link` or the current working directory. When Railway MCP discovery is available, `ewokbot init` can list sibling Git repositories and discovered Railway projects/services through read-only setup tools, let operators map each repository to a staging service or explicitly choose `none`/`github_only`, and persist the same `repos.deployments` mapping shape without forcing operators to type opaque ids.

Railway MCP runtime mapping uses the inspected tools documented in `docs/reference/railway-mcp-tools.md`. The default Railway `DeploymentPort` mapping calls the read-only deployment evidence tools it currently uses, `environment_status` and `list_deployments`, with explicit `project_id`, `environment_id`, and `service_id` arguments from the selected repository mapping. The read-only setup/discovery tools `list_projects`, `list_services`, and `get_service_config` are parsed, classified, and allowlisted for typed discovery/setup surfaces, but they remain non-mutating. Service URLs must come from deployment evidence or from an explicitly configured safe URL tool; custom `railway.mcp_tools.get_service_url` overrides remain supported when an operator has a safe read-only URL tool. Ewokbot does not call Railway deploy, source/link mutation, variable mutation, variable-value reads, domain generation, scaling/removal, staging mutation, or production deployment tools by default; `list_variables` is treated as secret-sensitive/redacted/denied, and `whoami`, `http_error_rate`, `http_requests`, and `http_response_time` remain unmapped and denied until a later classifier explicitly approves them.

First real smoke launch sequence after configuring local MCP/OAuth sessions:

```bash
ewokbot doctor
ewokbot scan
ewokbot run-dev LK-101 --confirm-dev-execution
ewokbot smoke LK-101 --confirm-real-provider-smoke
```

`ewokbot run-dev` persists local guard evidence under `.ewokbot/runs/<ticket-key>/<run-id>/`, including `meaningful-diff.json`, `agent-completion.json`, `core-safety.json`, `test-relevance.json`, `quality-report.md`, and `final-report.md`. Test relevance treats realistic local test commands as passing evidence, surfaces stub/no-op commands as `WARN`, and escalates explicit missing test evidence to `NEEDS_HUMAN` before any later handoff can occur.

`ewokbot harness run --all` exercises local AS fixtures, including a regression fixture that fails when ignored agent artifacts are mistaken for a meaningful product diff. Harness output is a compact CI-readable table with fixture id, pass/fail status, score, final state, and evidence path.

`ewokbot scan`, `ewokbot worker start`, `ewokbot run-dev`, `ewokbot harness`, and `ewokbot smoke` all receive local fake or public runtime seams as appropriate. Tests still use fake SDK/client factories or mock MCP clients only; no live MCP sessions, provider services, OpenCode subprocesses, package managers, remote git endpoints, provider CLIs, production merge, or production deployment are exercised in tests.

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

The core post-agent diff loop already inspects coding-runner changes, fails forbidden file or secret-like changes, escalates large or sensitive diffs to `NEEDS_HUMAN`, and writes local safety evidence before any later PR, staging, or production handoff can be considered. The next planned work is governed by [Next actions](docs/tracking/next-actions.md).

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
- meaningful diff guard so an agent success with only ignored artifacts cannot pass as implemented work,
- completed core safety loop for post-agent diff policy after the meaningful-diff guard,
- richer GitHub, Jira, Railway, and Vercel integrations after safety controls are stronger.

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
