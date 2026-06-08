# Approved Backlog

This file is the authority for work after Milestone I.

Autonomous agents must only implement tasks listed here or in `docs/tracking/next-actions.md`.

If an agent identifies useful work that is not listed here, it must:

1. Add it as a proposal under `docs/tracking/next-actions.md`.
2. Mark it as proposed, not approved.
3. Stop without implementing it.

## Approved Milestones

### Milestone J: Status And Resume Foundation

Goal:

Make existing run state inspectable and prepare the orchestrator for safe resumability.

Build:

- `agentic status <ticket-key> [--run-id <run-id>]`
- Run state reader for `runs/<ticket-key>/<run-id>/state.json`
- Run listing when `--run-id` is omitted
- Latest-run selection for a ticket
- Concise status rendering
- `getNextActionForState(state)`

Acceptance:

- Status works without provider credentials.
- Missing ticket/run paths return actionable errors.
- Summary includes state, repositories, branches, PRs, quality, staging, failures, and human action.
- Next action is deterministic for each lifecycle state.
- Tests cover state lookup, latest-run selection, missing state, and summary rendering.

### Milestone K: Resume Guard

Goal:

Define what can and cannot be resumed before implementing live provider actions.

Build:

- `canResumeState(state)`
- `assertStateResumable(state)`
- documented state-to-resume policy
- no automatic live side effects

Acceptance:

- `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, and `PRODUCTION_PR_OPENED` do not resume automatically.
- Resume policy is documented in README or tracking docs.
- Tests cover every delivery run state.

### Milestone L: Multi-Repo Safety Guard

Goal:

Avoid false completion for Jira tickets that match multiple repositories.

Build:

- In `agentic run`, fail safely when planning selects multiple repositories.
- Persist or report `NEEDS_HUMAN` with a clear reason.
- Document that multi-repo sub-runs are not implemented yet.

Acceptance:

- Single-repo tickets still complete the mock run.
- Multi-repo tickets do not proceed to implementation.
- Tests cover the guard.

### Milestone M: Real Provider Adapter Design

Goal:

Prepare real Jira, GitHub, Railway, and OpenCode adapters without live calls.

Build:

- Provider mode types beyond `mock`
- adapter factories
- explicit credential requirement errors
- no network calls in tests

Acceptance:

- Mock mode remains default.
- Real mode fails fast when required env vars are missing.
- Tests assert no hidden live calls.

### Milestone N: MCP-First Architecture Realignment

Goal:

Reorient the post-Milestone M plan from provider-specific REST/native adapters toward an MCP-first agent runtime.

Build:

- Document MCP-first as the external SaaS control plane.
- Define typed business ports that hide raw MCP tools from core delivery logic.
- Define MCP layer responsibilities: server registry, tool discovery, allowlist, schema mapping, auth/session handling, and audit logs.
- Define safety classifications for MCP tools: `read`, `write`, `danger`.
- Keep native/subprocess/mock connectors as fallback adapter types.

Acceptance:

- `docs/specs/mcp-first-architecture.md` exists.
- `docs/specs/technical-architecture.md` references the MCP-first model.
- Next approved milestones are MCP client foundation and MCP-backed provider ports, not Jira REST.

### Milestone O: MCP Client Foundation

Goal:

Create shared MCP infrastructure without live provider calls in tests.

Build:

- MCP server config model.
- MCP client interface.
- Mock MCP client.
- Tool discovery model.
- Tool allowlist model.
- Tool call audit model.
- Timeout/error mapping.

Acceptance:

- Tests use mock MCP clients only.
- No OAuth, network, or live MCP server calls happen in tests.
- Business adapters can depend on an MCP client interface.

### Milestone P: Jira MCP TicketPort

Goal:

Read Jira backlog and tickets through an MCP-backed TicketPort.

Build:

- `jira.mode = mcp` or role-based `providers.ticket.kind = mcp`.
- Atlassian MCP server config example using `mcp-remote`.
- MCP-backed Jira ticket adapter.
- Tool mapping from Atlassian MCP search/fetch/comment capabilities into `TicketPort`.
- Mock MCP tests for backlog, get ticket, comment, and missing tool errors.

Acceptance:

- No Jira REST adapter is implemented for this milestone.
- No live Atlassian calls in tests.
- Missing MCP tools fail with actionable errors.

### Milestone Q: GitHub MCP CodeHostPort

Goal:

Create branches, inspect checks, comment, and open pull requests through an MCP-backed CodeHostPort where MCP provides enough capability.

Build only after Milestone O is complete.

Native GitHub fallback remains allowed for operations where MCP cannot provide required precision.

### Milestone R: Railway MCP DeploymentPort

Goal:

Read Railway deployment state and service URLs through an MCP-backed DeploymentPort where MCP provides enough capability.

Build only after Milestone O is complete.

Native Railway fallback remains allowed for deployment polling if MCP capabilities are insufficient.

### Milestone S: Native Fallback Contracts

Goal:

Define when native connectors are allowed or preferred over MCP.

Examples:

- Local git remains native/subprocess.
- Filesystem and quality gates remain native/subprocess.
- GitHub checks or Railway polling may use native APIs if MCP does not expose enough detail.

### Milestone T: Agent Worker Loop

Goal:

Run the backlog processor continuously with queueing, concurrency limits, and escalation policy.

Build only after MCP-backed provider ports and fallback contracts are individually tested.

### Milestone U: Runtime MCP Wiring

Goal:

Wire configured MCP clients into the runtime provider factory so MCP-backed typed ports can be selected by workspace configuration without leaking raw MCP tools into delivery logic.

Build:

- Runtime MCP server resolution from workspace configuration.
- MCP client construction and injection path for Jira, GitHub, and Railway MCP adapters.
- Tool discovery and allowlist validation before adapter use.
- Tool call audit capture for MCP-backed port operations.
- Clear startup errors for missing server config, missing tools, or disallowed tools.

Acceptance:

- Mock mode remains the default and works without MCP servers or credentials.
- Tests use mock MCP clients only and do not start live MCP servers.
- Runtime configuration can select MCP-backed Jira, GitHub, or Railway ports through typed adapters.
- Missing or disallowed MCP tools fail before delivery side effects occur.
- Raw MCP tool names remain inside MCP adapter/config layers and do not leak into core delivery logic.

Explicit safety constraints:

- Keep MCP-first architecture for external SaaS providers.
- Do not store credentials, OAuth tokens, or private server config in the repository.
- Do not add live provider calls, live MCP server calls, or network calls in tests.
- Do not implement production merge or production deployment automation.
- Production merge and production deploy remain human-only.

### Milestone V: Real Jira Intake

Goal:

Enable real backlog intake through the Jira MCP TicketPort while preserving deterministic mock intake as the default local and test path.

Build:

- Workspace configuration for selecting Jira MCP intake at runtime.
- Backlog listing and ticket fetching through the typed `TicketPort` using the MCP adapter.
- Jira comment/report handoff through typed port methods where configured and allowed.
- Intake error mapping for missing credentials, inaccessible projects, empty backlog, and missing MCP tools.
- Tests covering intake behavior with mock MCP clients and mock Jira connectors.

Acceptance:

- `agentic scan` and worker intake can use Jira MCP mode when explicitly configured.
- Mock Jira remains the default and all tests pass without credentials.
- Jira MCP intake records audit entries for external tool calls.
- Missing credentials or missing MCP tools produce actionable errors and no hidden fallback to live REST APIs.
- No Jira REST adapter is introduced for this milestone.

Explicit safety constraints:

- Keep Jira MCP-first for external Jira access.
- Do not commit Jira domains, emails, tokens, OAuth material, or private project credentials.
- Do not make live Jira or Atlassian MCP calls in tests.
- Do not transition real Jira tickets unless the typed policy explicitly allows it in a later approved milestone.
- Production merge and production deploy remain human-only.

### Milestone W: Worker MCP Mode

Goal:

Allow the agent worker loop to process backlog tickets using explicitly configured MCP-backed provider ports while retaining mock-safe defaults and worker stop guarantees.

Build:

- Worker configuration path that selects MCP-backed ticket, code host, and deployment ports through the runtime provider factory.
- Worker startup checks for MCP readiness, allowlisted tools, and native fallback contracts.
- Queue processing that preserves concurrency caps, retries, escalation, abort handling, and durable state writes in MCP mode.
- Clear operator output distinguishing mock mode from explicitly configured MCP mode.
- Tests using mock MCP clients to prove the worker does not require live services.

Acceptance:

- `agentic worker` remains mock by default.
- Explicit MCP mode can be constructed with injected/mock MCP clients in tests.
- Worker MCP mode refuses to start when required MCP configuration or tools are missing.
- Retry, escalation, safe stop, and concurrency behavior remains unchanged from mock mode.
- Native/subprocess fallbacks are used only where Milestone S contracts allow them.

Explicit safety constraints:

- Do not make live MCP, Jira, GitHub, or Railway calls in tests.
- Do not allow CLI flags to bypass workspace concurrency or production gates.
- Do not perform remote pushes, production merges, or production deployments as part of worker MCP mode.
- Do not store credentials or OAuth state in repository files.
- Production merge and production deploy remain human-only.

### Milestone X: OpenCode Execution Contract

Goal:

Define and enforce the contract for invoking OpenCode as the development runner so implementation attempts are bounded, observable, retryable, and safe for local execution.

Build:

- Typed OpenCode execution input/output contract for prompts, workspace paths, timeout, logs, exit status, and produced summary.
- Subprocess runner guardrails for command construction, working directory, environment allowlist, timeout, and cancellation.
- Run-state and report updates for OpenCode attempt start, completion, failure, retry, and escalation.
- Tests using fake subprocess execution only.
- Documentation for local runner requirements and failure handling.

Acceptance:

- OpenCode execution remains subprocess-first unless a stable OpenCode MCP server is explicitly contracted later.
- Tests do not execute real OpenCode or require OpenCode credentials.
- Runner failures map to retry/escalation policy without skipping quality gates.
- Logs and summaries are persisted without storing secrets.
- Cancellation or timeout stops further attempts safely.

Explicit safety constraints:

- Do not run untrusted shell commands outside the configured workspace.
- Do not add live OpenCode execution to tests.
- Do not expose secrets through prompts, logs, reports, or persisted state.
- Do not bypass required quality gates after runner success or failure.
- Production merge and production deploy remain human-only.

### Milestone Y: GitHub Delivery Workflow

Goal:

Implement the GitHub delivery handoff through typed CodeHostPort operations, using MCP where precise enough and local/native fallback only where explicitly contracted.

Build:

- Branch creation, pull request opening, check reading, and PR commenting through the configured CodeHostPort.
- Local git/subprocess push handoff for actual branch push according to Native Fallback Contracts.
- Operation ledger entries for mutating GitHub actions.
- Idempotency checks for existing branches, existing PRs, duplicate comments, and repeated check reads.
- Tests using mock CodeHostPort and mock subprocess/local git behavior only.

Acceptance:

- GitHub MCP remains first choice for precise typed operations.
- Actual branch push does not use MCP until a precise MCP push contract exists.
- Quality gates must pass before any push or PR handoff is attempted.
- Re-running the same delivery does not duplicate branches, PRs, or comments when ledger state exists.
- Tests do not call live GitHub APIs, live MCP servers, or real remote git endpoints.

Explicit safety constraints:

- Do not store GitHub tokens, SSH keys, or remote credentials in the repository.
- Do not perform real remote pushes in tests.
- Do not merge production pull requests automatically.
- Do not treat GitHub check mocks as proof of real provider integration.
- Production merge and production deploy remain human-only.

### Milestone Z: Railway Staging Verification

Goal:

Verify staging deployments through the typed DeploymentPort using Railway MCP where precise enough and native fallback only for documented polling or service URL precision gaps.

Build:

- Staging deployment lookup and polling through `DeploymentPort.waitForDeployment` and deployment reads.
- Service URL resolution through `DeploymentPort.getServiceUrl`.
- Staging verification report persisted into the run directory and status summary.
- Timeout, failed deployment, missing service URL, and imprecise MCP result handling.
- Tests using mock Railway MCP/native deployment ports only.

Acceptance:

- Railway MCP remains first choice for deployment state and service URL reads.
- Native Railway fallback is allowed only when MCP lacks required polling, metadata, timeout, or URL precision.
- Staging verification failures block production PR handoff and escalate with actionable state.
- Tests do not call live Railway APIs, live MCP servers, or deployed services.
- Production deployment mutation is not implemented.

Explicit safety constraints:

- Do not store Railway tokens, project IDs, service IDs, or environment credentials in the repository.
- Do not make live Railway calls in tests.
- Do not deploy to production or mutate production environments.
- Do not bypass failed or missing staging verification.
- Production merge and production deploy remain human-only.

### Milestone AA: Interactive CLI Onboarding For VPS Setup

Goal:

Make Ewokbot feel like a product that can be installed from npm, configured from the terminal, and prepared to run continuously on a VPS.

Product direction:

- CLI is the first control plane.
- Telegram, WhatsApp, and dashboard controls are explicitly future work.
- Railway and Vercel are both first-class deployment/CI monitoring choices.
- OpenCode is the only supported development runner for now.
- oh-my-openagent is optional setup assistance for OpenCode users.

Build:

- Primary CLI entrypoints for `ewokbot` and `ewok`, while keeping `agentic` as a backward-compatible alias.
- A friendly no-command entrypoint that points new users toward setup.
- Interactive `ewokbot init` onboarding backed by typed setup/provider capability modules.
- Non-interactive init behavior retained for tests and automation.
- Provider capability contracts for detecting existing setup, describing install steps, collecting non-secret config, declaring required secret env vars, validating generated config, and producing a setup summary.
- First setup choices:
  - Dev runner: OpenCode only.
  - Optional OpenCode preset/tooling: oh-my-openagent yes/no.
  - Code host: GitHub only.
  - Ticket provider: Jira only.
  - Deployment/CI monitor: Railway, Vercel, or both.
  - Control plane: CLI only.
- Non-secret workspace config generation in `config/workspace.yml`.
- Secret placeholder generation in `.env.example`, without storing real secrets in tracked files.
- A first `ewokbot doctor` command skeleton that validates local config shape and reports missing setup pieces without live provider calls.

Acceptance:

- Mock mode remains available and safe by default.
- Tests cover CLI aliases/help, no-command setup hint, generated config for Railway only, Vercel only, and both, secret placeholder/redaction behavior, existing config detection, provider capability ordering, and doctor behavior for missing and generated config.
- The onboarding flow does not perform live provider calls.
- The onboarding flow does not install global packages automatically.
- Real secret values are never printed or written to tracked files.
- Telegram, WhatsApp, daemonization, systemd, pm2, Docker, hosted workers, and production automation are not implemented in this milestone.

### Milestone AB: Doctor And Local Readiness Checks

Goal:

Make `ewokbot doctor` the operator's first readiness tool before running a long-lived worker.

Build:

- Local checks for Node, pnpm, OpenCode, optional oh-my-openagent config, workspace config, `.env`, GitHub, Jira, Railway, Vercel, repository paths, staging/production branch settings, and quality gate presence.
- Redacted output for all secret-related diagnostics.
- Clear pass/warn/fail categories.
- No live provider calls unless an explicit future flag is approved.

Acceptance:

- Doctor is safe on a fresh clone and on a partially configured VPS.
- Missing secrets or tools produce actionable next steps.
- No secrets are printed.

### Milestone AC: Long-Running Worker Runtime

Goal:

Turn the existing worker loop into a VPS-suitable runtime process.

Build:

- `ewokbot worker start`.
- `--once` and `--dry-run` modes.
- Worker lock to prevent concurrent workers in the same workspace.
- Graceful shutdown.
- Crash-safe state reuse.
- Operator-readable logs.

Acceptance:

- The worker can run continuously without relying on a developer laptop.
- Restarting after interruption preserves state and avoids duplicate side effects.
- Production merge and production deployment remain human-only.

### Milestone AD: CLI Control Plane

Goal:

Provide day-to-day terminal control over runs without needing Telegram or a dashboard.

Build:

- `ewokbot runs`.
- `ewokbot inspect <run-id>`.
- `ewokbot run <ticket-key>`.
- `ewokbot pause`.
- `ewokbot resume <run-id>`.
- `ewokbot approve <run-id>`.
- `ewokbot reject <run-id>`.
- `ewokbot logs <run-id>`.

Acceptance:

- Commands operate on persisted state.
- Approval commands do not merge or deploy production directly.
- Output remains readable over SSH on a VPS.

### Milestone AE: First Real Provider Smoke Run

Goal:

Validate a narrowly scoped real-provider path after onboarding, doctor, and worker controls exist.

Build:

- A single-ticket smoke run with explicit operator confirmation.
- Jira intake through MCP.
- GitHub PR preparation through the typed code host port.
- Railway and/or Vercel staging observation through typed deployment/CI ports.
- No production merge.

Acceptance:

- The run can be tested with one real ticket and one configured repository.
- Every provider write is auditable and idempotency-protected.
- Production remains human-approved.

### Milestone AF: Real MCP Client Runtime Wiring

Goal:

Make the public CLI capable of constructing real MCP clients from `config/workspace.yml` so `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` can be run from an operator machine or VPS without test-only client injection.

Build:

- A runtime MCP client adapter/factory that turns configured `mcp_servers` entries into `McpClient` instances for Jira, GitHub, and Railway.
- CLI wiring so `createCliProgram().run(process.argv)` can pass a real `createMcpClient` implementation into scan, worker, and smoke commands when providers are configured as `mcp`.
- A fail-fast readiness path for unsupported MCP server shapes, missing local MCP bridge dependencies, missing OAuth/session material, unavailable commands, missing tools, and disallowed tools.
- Operator-readable errors that explain which MCP server/provider failed and what to configure next.
- Tests that use fake process/client factories only and do not start live MCP servers, open OAuth flows, call provider services, run OpenCode, push git, or hit deployed URLs.
- Documentation for the first real smoke launch sequence after AF.

Acceptance:

- The CLI no longer fails with `MCP runtime requires an injected or constructed McpClient` when valid supported MCP server config is present.
- Missing or unsupported MCP runtime setup fails before Jira reads, run-state writes, git, OpenCode, PRs, Railway checks, operation-ledger writes, or provider mutations.
- Mock mode remains the default and still works without credentials, MCP servers, or network access.
- Existing injected mock MCP tests continue to pass.
- Production merge and production deployment remain human-only.

### Milestone AG: Workspace Layout Migration To `.ewokbot/`

Goal:

Make Ewokbot run from the parent directory that already contains the target repository or repositories, with all Ewokbot-owned config, secrets, state, logs, and cache under a local `.ewokbot/` directory. Remove the old root-level `config/workspace.yml`, `.env`, `.env.example`, and `runs/` layout instead of keeping legacy fallback behavior.

Target layout:

```text
<workspace-root>/
  service-a/
    .git/
  service-b/
    .git/
  app-mobile/
    .git/
  .ewokbot/
    workspace.yml
    .env
    .env.example
    runs/
    logs/
    cache/
```

Build:

- Change `ewokbot init` to create `.ewokbot/workspace.yml`, `.ewokbot/.env.example`, `.ewokbot/runs/`, `.ewokbot/logs/`, and `.ewokbot/cache/`.
- Stop generating root `.env.example`, root `.env`, root `config/workspace.yml`, and root `runs/`.
- Generate repository discovery config by default: `repos.discovery: sibling-git-directories` with `exclude: []`.
- Discover direct sibling directories with `.git/`, ignore `.ewokbot/`, hidden directories, `node_modules/`, non-Git directories, nested repos, and excluded names; sort discovered repositories deterministically.
- Update all CLI commands to load `.ewokbot/workspace.yml` by default.
- Update all state, reports, run controls, operation ledgers, worker locks, and log reads/writes to live under `.ewokbot/runs/`.
- Keep discovered and explicit repository paths relative to the workspace root as siblings of `.ewokbot/`.
- Update doctor/setup validation to inspect `.ewokbot/.env.example`, `.ewokbot/.env`, `.ewokbot/workspace.yml`, and repository paths from the workspace root.
- Remove fallback lookup for `config/workspace.yml`, root `.env`, root `.env.example`, and root `runs/`.
- Update README, specs, runbooks, prompts, tracking docs, and tests to describe the `.ewokbot/` layout.

Acceptance:

- A fresh `ewokbot init` in a directory containing repos creates only `.ewokbot/` owned files and directories.
- Fresh init does not generate fake repository names; it watches all direct sibling Git repositories by default through discovery mode.
- `doctor`, `scan`, `worker`, `smoke`, `status`, `runs`, `inspect`, `logs`, `pause`, `resume`, `approve`, `reject`, and `quality` use `.ewokbot/` paths by default.
- Tests assert that root-level legacy files and directories are not created or read.
- No command silently falls back to `config/workspace.yml`, root `.env`, root `.env.example`, or root `runs/`.
- Existing mock mode and fake-only MCP tests continue to pass after path migration.
- Production merge and production deployment remain human-only.

### Milestone AH: Real Workspace Dry Run

Goal:

Let an operator validate a real multi-repository workspace from the parent directory without starting code generation or delivery side effects. This milestone should prove that `.ewokbot/` setup, sibling Git repository discovery, local readiness checks, Jira MCP intake, and ticket-to-repository planning all work together on a real workspace.

Operator flow:

```bash
cd <workspace-root>
ewokbot init
ewokbot doctor
ewokbot scan
ewokbot plan <ticket-key>
```

Build:

- Add an explicit dry-run path, command output, or command option that makes the supported no-delivery operator flow obvious for a real workspace.
- Ensure `ewokbot doctor` reports discovered sibling repositories clearly, including the discovered count and names when available.
- Ensure `ewokbot scan` can use Jira MCP from `.ewokbot/workspace.yml` while keeping mock mode safe by default.
- Ensure `ewokbot plan <ticket-key>` can read one ticket and select from discovered sibling repositories without creating branches, running OpenCode, running quality gates, opening pull requests, verifying deployments, or writing operation ledgers.
- If `plan` still uses the mock Jira connector, introduce a safe MCP-backed planning intake path so the operator can plan a real Jira ticket without starting delivery.
- Persist only local planning evidence under `.ewokbot/runs/`, with clear output showing selected repository candidates and whether human input is needed.
- Keep all repository discovery bounded to direct sibling Git directories.
- Keep explicit `repos: [...]` configs supported for advanced/manual workspaces.
- Update README, technical architecture, next actions, roadmap, and tests for the real workspace dry-run workflow.

Acceptance:

- From a temporary parent workspace with multiple sibling fake Git repositories, tests prove discovery, doctor, scan, and plan work deterministically.
- Real-provider planning can read a single Jira ticket through the typed MCP `TicketPort.getTicket` path when configured, using fake MCP clients in tests.
- The dry-run/planning path does not create git branches, run OpenCode, run package scripts, write operation ledgers, call GitHub, call Railway, open PRs, verify deployments, merge production, or deploy production.
- Missing MCP readiness, missing Jira tools, missing repositories, or no confident repository match fail with operator-readable next steps.
- Mock mode remains the default and all tests remain fake-only with no live MCP/OAuth/provider/network/OpenCode/git side effects.
- Production merge and production deployment remain human-only.

### Milestone AI: Controlled Single-Repository Dev Execution

Goal:

Enable the first controlled development execution on one discovered repository after AH proves the real workspace dry-run path. This milestone should let Ewokbot invoke OpenCode on exactly one selected repository, run local quality gates, and produce local evidence, while keeping provider writes and production actions gated.

Operator flow:

```bash
cd <workspace-root>
ewokbot run-dev <ticket-key> --confirm-dev-execution
```

Build:

- Add an explicit command or option for single-ticket, single-repository dev execution that cannot be confused with production delivery.
- Reuse the AH real Jira/MCP ticket intake and repository planning path.
- Refuse execution unless planning selects exactly one discovered or explicit repository.
- Require an explicit confirmation flag before any OpenCode subprocess, git branch, quality command, provider write, PR, or deployment side effect.
- Before running OpenCode, print the selected ticket, repository, branch target, quality profile, and human-only production boundary.
- Create a local working branch only in the selected repository, invoke the configured OpenCode runner with the existing execution contract, and write implementation logs under `.ewokbot/runs/`.
- Run local quality gates only for the selected repository and write quality reports/logs under `.ewokbot/runs/`.
- Stop after local implementation and local quality evidence unless a later approved milestone explicitly enables PR/deployment handoff.
- Keep all failures resumable/inspectable through existing status, logs, and control commands.
- Update README, technical architecture, next actions, roadmap, and tests.

Acceptance:

- Tests prove missing `--confirm-dev-execution` stops before run state writes, git, OpenCode, quality, provider calls, PRs, deployments, and ledgers.
- Tests prove multi-repository or zero-repository planning refuses execution with human-readable guidance.
- Tests prove a fake OpenCode runner and fake local git path can complete one selected repository through implementation and local quality evidence.
- No GitHub PR is opened, no Railway/Vercel deployment is checked, and no production merge/deploy action is possible in this milestone.
- Mock mode remains the default and all tests remain fake-only with no live MCP/OAuth/provider/network/OpenCode subprocess/remote git side effects unless explicitly injected fakes are used.
- Production merge and production deployment remain human-only.

### Milestone AJ: Interactive Init Wizard And Credential Setup

Goal:

Make `ewokbot init` a real first-run wizard that can configure a usable local workspace end to end. At the end of the wizard, an operator should have `.ewokbot/workspace.yml`, `.ewokbot/.env`, `.ewokbot/.env.example`, owned directories, repository discovery settings, provider choices, MCP server commands, and local credential placeholders/values ready for `ewokbot doctor`, `ewokbot scan`, `ewokbot plan <ticket-key>`, and `ewokbot run-dev <ticket-key> --confirm-dev-execution`.

Operator flow:

```bash
cd <workspace-root>
ewokbot init
ewokbot doctor
ewokbot scan
ewokbot plan <ticket-key>
ewokbot run-dev <ticket-key> --confirm-dev-execution
```

Build:

- Extend `ewokbot init` with an interactive wizard while preserving a deterministic non-interactive mode for tests and automation.
- Detect an existing `.ewokbot/workspace.yml`, `.ewokbot/.env`, and `.ewokbot/.env.example`; refuse destructive overwrite by default and offer explicit safe update behavior only if implemented with tests.
- Ask which dev runner to use, with OpenCode as the only supported implementation for now.
- Detect whether OpenCode is installed; if missing, print the exact install command and stop or continue in mock mode based on explicit operator choice. Do not auto-install without explicit confirmation.
- Ask whether to use oh-my-openagent; detect existing local config when possible and write only Ewokbot-owned config or documented instructions unless explicit mutation is approved.
- Ask for model/provider environment variables needed by the selected OpenCode setup and write them to `.ewokbot/.env`; never print secret values back to stdout/stderr.
- Ask for ticket provider, with Jira MCP as the only supported real provider for now and mock mode as an explicit option.
- Configure Jira MCP through maintained Ewokbot connector presets, starting with the local `mcp-atlassian` stdio server, so normal users enter only Jira URL, project keys, email, and API token instead of MCP server id, command, args, or env allowlists.
- Ask for code host provider, with GitHub MCP as the first real target and mock mode as an explicit option.
- Configure GitHub MCP server settings when selected, but do not require GitHub for `run-dev`.
- Ask for deployment/CI monitor, supporting Railway MCP, Vercel placeholder/mock, both, or none where appropriate. Railway remains the first real staging target; Vercel may be captured as config intent if real support is not implemented yet.
- Configure Railway MCP through maintained Ewokbot connector presets, starting with the local Railway CLI stdio server (`railway mcp`), so normal users do not enter MCP server id, command, args, env allowlists, or Railway API tokens for that default path.
- Keep repository discovery as the default: watch all direct sibling Git repositories from the launch directory unless the operator chooses explicit repos.
- Generate `.ewokbot/.env.example` from the chosen providers and `.ewokbot/.env` from entered values or blank placeholders when the operator skips a secret.
- Load `.ewokbot/.env` in runtime commands that need environment variables, before constructing providers or OpenCode runners.
- Update `ewokbot doctor` so it validates wizard-generated provider choices and reports missing secrets by variable name only.
- Update README, technical architecture, next actions, roadmap, and tests.

Acceptance:

- Tests cover the interactive wizard with injected prompts, without reading stdin directly or requiring a real terminal.
- Tests cover non-interactive init staying deterministic and mock-safe.
- Tests prove generated `.ewokbot/workspace.yml`, `.ewokbot/.env.example`, and `.ewokbot/.env` match selected providers.
- Tests prove secret values written to `.ewokbot/.env` are never printed in init or doctor output.
- Tests prove existing `.ewokbot/` files are not overwritten accidentally.
- Tests prove runtime commands can load `.ewokbot/.env` and pass selected environment variables to Jira MCP/OpenCode paths through fakes only.
- Tests remain fake-only: no live MCP/OAuth/provider/network/OpenCode/package-manager/git side effects.
- Production merge and production deployment remain human-only.

### Milestone AK: User-Level Ewokbot Layout

Goal:

Add Ewokbot's user-level config, data, auth, state, and cache layout so workspace-local `.ewokbot/` files are no longer forced to carry machine-wide settings or credentials.

Target user layout:

```text
~/.config/ewokbot/config.json
~/.local/share/ewokbot/auth.json
~/.local/share/ewokbot/state/
~/.cache/ewokbot/
```

Workspace-local layout remains:

```text
<workspace-root>/
  .ewokbot/
    workspace.yml
    .env
    .env.example
    runs/
    logs/
    cache/
```

Build:

- Add cross-platform path helpers using `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME` when set, with macOS/Linux-safe defaults.
- Add typed models for user config, auth file metadata, global state directory, and cache directory.
- Add filesystem helpers that create Ewokbot user directories only when explicitly requested by init/auth/setup flows.
- Ensure `auth.json` creation uses strict owner-only permissions where the platform supports it.
- Add doctor/readiness output for user-level Ewokbot paths without printing secrets.
- Keep `.ewokbot/workspace.yml` as the workspace contract and `.ewokbot/runs/` as the workspace run ledger.
- Update docs to explain what lives globally versus what lives in a workspace.

Acceptance:

- Tests cover default and XDG-overridden paths without touching the real home directory.
- Tests cover owner-only permissions for generated auth files where supported.
- Doctor can report missing/present user-level directories and auth files without exposing values.
- No existing workspace-local commands silently move run state or workspace config into global user paths.
- No secrets are written to tracked files or printed in stdout/stderr.
- Tests remain fake-only and do not require real OpenCode, provider auth, MCP servers, network, or home-directory mutation.

Explicit safety constraints:

- Do not migrate existing user secrets automatically.
- Do not read or write real `~/.config`, `~/.local/share`, or `~/.cache` in tests.
- Do not store OpenCode credentials in Ewokbot user auth.
- Production merge and production deployment remain human-only.

### Milestone AL: Dev Tool Detection Adapters

Goal:

Replace naive dev-runner setup assumptions with explicit detection and readiness adapters, starting with OpenCode.

Build:

- Define a `DevToolSetupAdapter` contract with:
  - `detect()`
  - `doctor()`
  - `launchSetup()`
  - `getConfigSummary()`
- Implement `OpenCodeSetupAdapter`.
- Detect OpenCode command path and version without mutating the machine.
- Detect global OpenCode config at `~/.config/opencode/opencode.json`.
- Detect OpenCode auth state at `~/.local/share/opencode/auth.json` and/or through `opencode auth list`, without printing or copying secrets.
- Detect project OpenCode config at `<workspace-root>/opencode.json`.
- Return normalized readiness states such as `not_installed`, `installed_not_authenticated`, `installed_authenticated_no_model`, `installed_ready`, `installed_unsupported`, and `command_failed`.
- Preserve support for custom OpenCode command paths.
- Add fake process/filesystem tests for every readiness branch.

Acceptance:

- Ewokbot can tell the operator when OpenCode is already installed and configured.
- Ewokbot does not attempt to install OpenCode when a usable command is already detected.
- Ewokbot does not ask for OpenAI/Anthropic API keys on behalf of OpenCode.
- OpenCode credentials stay owned by OpenCode and are never copied into `.ewokbot/.env` or Ewokbot auth.
- `launchSetup()` only returns or invokes approved setup actions when explicitly selected by the operator.
- Tests remain fake-only and do not run real `opencode`, package managers, OAuth flows, or network calls.

Explicit safety constraints:

- Do not run install scripts, package managers, or `opencode auth login` without explicit user confirmation.
- Do not parse or print raw OpenCode secret values.
- Do not mutate `~/.config/opencode` or `~/.local/share/opencode` in tests.
- Production merge and production deployment remain human-only.

### Milestone AM: Inquirer TUI Init

Goal:

Replace the readline-style init wizard with an `@inquirer/prompts` TUI while preserving non-interactive automation and the existing safety model.

Build:

- Add `@inquirer/prompts` for interactive `ewokbot init`.
- Use `select`, `confirm`, `input`, and `checkbox` prompts for guided choices.
- Keep deterministic `--non-interactive` behavior for tests, CI, and scripted VPS setup.
- Surface OpenCode detection/readiness from Milestone AL inside the TUI.
- If OpenCode is absent, offer install instructions, custom command path, mock mode, or skip.
- If OpenCode is installed but not authenticated, offer to launch the OpenCode setup/auth flow or continue without claiming readiness.
- If OpenCode is ready, allow direct selection without asking for provider API keys.
- Keep Jira/GitHub/Railway/Vercel provider choices guided by select prompts.
- Write only Ewokbot-owned workspace files under `.ewokbot/`.
- Update tests to use injected prompt adapters rather than a real terminal.

Acceptance:

- `ewokbot init` no longer requires users to type magic string values for closed questions.
- Operator choices are visible as TUI selections.
- Non-interactive init remains stable and mock-safe.
- Existing `.ewokbot/` files are not overwritten accidentally.
- The wizard does not install tools, launch auth flows, mutate external config, call MCP servers, call providers, run OpenCode, create branches, open PRs, deploy, or merge without explicit follow-up confirmation.
- Tests remain fake-only.

Explicit safety constraints:

- Do not remove `--non-interactive`.
- Do not require a real TTY in tests.
- Do not demand model provider API keys for OpenCode during Ewokbot init.
- Production merge and production deployment remain human-only.

### Milestone AN: Ewokbot Auth Commands

Goal:

Give Ewokbot its own auth flow for credentials Ewokbot owns, separate from OpenCode's auth and separate from workspace-local `.ewokbot/.env`.

Build:

- Add `ewokbot auth login`.
- Add `ewokbot auth list`.
- Add `ewokbot auth logout`.
- Store Ewokbot-owned credentials or credential metadata in `~/.local/share/ewokbot/auth.json`.
- Keep OpenCode auth external and detected only through the OpenCode adapter.
- Support initial Ewokbot model/provider auth choices without requiring them during `ewokbot init`.
- Redact all credential values in output, logs, reports, tests, and errors.
- Ensure auth file creation uses strict permissions where supported.
- Update doctor to distinguish OpenCode auth readiness from Ewokbot auth readiness.

Acceptance:

- `ewokbot auth list` reports configured providers without secret values.
- `ewokbot auth logout` removes only Ewokbot-owned auth entries.
- `ewokbot init` may offer to launch `ewokbot auth login`, but does not directly collect model provider secrets as the default OpenCode path.
- Ewokbot does not copy or mutate OpenCode auth.
- Tests use fake home directories and fake prompt inputs only.
- Tests remain fake-only with no live provider, OAuth, MCP, OpenCode, package-manager, or network calls.

Explicit safety constraints:

- Do not store secrets in `.ewokbot/workspace.yml`, tracked docs, test fixtures, or stdout/stderr.
- Do not treat Ewokbot auth as a substitute for OpenCode auth when OpenCode is the selected runner.
- Production merge and production deployment remain human-only.

### Milestone AO: Meaningful Diff Guard

Goal:

Prevent false-positive development runs where the coding agent exits successfully and local quality gates pass, but no meaningful product code changed.

Build:

- Capture changed files and diff summary after OpenCode execution in `run-dev`.
- Ignore agent/runtime artifacts such as `.omo/`, `.ewokbot/`, logs, caches, and generated run evidence when deciding whether the run produced a meaningful product diff.
- If the agent exits `0` but there is no meaningful product diff, stop the run as `FAILED` or `NEEDS_HUMAN` with a clear reason.
- Persist the meaningful-diff decision and ignored files in the run directory.
- Surface the reason in `final-report.md`, status output, and implementation/safety evidence.
- Add tests for an OpenCode success with only ignored artifacts and for a safe non-empty product diff.

Acceptance:

- `run-dev` cannot reach `LOCAL_CHECKS_PASSED` when only ignored artifacts changed.
- `run-dev` can still reach `LOCAL_CHECKS_PASSED` when a meaningful product diff exists and local quality gates pass.
- The run report makes the no-diff failure obvious to an operator.
- Ignored paths are deterministic and documented.
- Tests use fake repositories and fake diffs only; no live providers, OpenCode, MCP, network, package-manager, or home-directory mutation.

Explicit safety constraints:

- Do not implement the full diff safety policy in AO; that is Milestone AP.
- Do not implement GitHub PR handoff, staging verification, production merge, production deployment, dashboard, Telegram, WhatsApp, Sentry, PostHog, Notion, or external signal ingestion in AO.
- Do not delete or revert user changes outside a controlled temporary test repository.
- Do not print secret values, even when a secret scan fails.
- Production merge and production deployment remain human-only.

### Milestone AP: Core Safety Loop v1

Goal:

Evaluate whether a non-empty agent diff is allowed, requires human review, or must fail before any later handoff can be considered.

Build:

- Add a policy module for post-agent diff evaluation.
- Add forbidden-file detection for `.env`, `.env.*`, private keys, credential files, and Ewokbot auth/config files that must not be changed by an agent.
- Add secret-like content detection over changed diff additions without printing matched secret values.
- Add diff-size limits for changed files and diff lines, with configurable defaults.
- Detect human-review categories such as dependency lockfile changes, database migrations, auth-related paths, payment-related paths, and infrastructure/deployment config changes.
- Return deterministic policy decisions: `pass`, `needs_human`, or `fail`.
- Write a local safety report under the run directory.
- Block later local success/handoff states when the safety policy returns `needs_human` or `fail`.

Acceptance:

- Safe code-only changes can pass the policy.
- Forbidden files fail before any PR, staging, production, provider, or remote side effect.
- Secret-like additions fail with redacted output only.
- Large diffs and sensitive categories escalate to `NEEDS_HUMAN` with clear reasons.
- `run-dev` persists safety evidence in `.ewokbot/runs/<ticket-key>/<run-id>/`.
- Tests use fake repositories and fake diffs only.

Explicit safety constraints:

- Do not implement GitHub PR handoff, staging verification, production merge, production deployment, dashboard, Telegram, WhatsApp, Sentry, PostHog, Notion, or external signal ingestion in AP.
- Do not make live provider, MCP, network, package-manager, or real OpenCode calls in tests.
- Do not print secret values, even when a secret scan fails.
- Production merge and production deployment remain human-only.

### Milestone AQ: Agent Completion Contract

Goal:

Make development-run success depend on a clear agent completion signal instead of only subprocess exit code and local quality gates.

Build:

- Tighten the OpenCode prompt so the agent must finish implementation, summarize changed files, mention tests, and state known limits.
- Capture or parse a completion summary from the agent output where practical.
- Detect obvious incomplete-agent output such as unfinished todos, exploration-only summaries, or "waiting for background agents" endings.
- Fail or escalate when the agent reports no implementation, no changed files, or unresolved blockers.
- Persist the completion evaluation under the run directory.

Acceptance:

- Exploration-only agent output does not count as successful implementation.
- Completed implementation output can pass when paired with meaningful diff, safety pass, and quality gates.
- Tests use fake agent outputs and fake diffs only.

Explicit safety constraints:

- Do not require live OpenCode execution in tests.
- Do not make success depend on brittle wording alone when diff and quality evidence contradict it.
- Production merge and production deployment remain human-only.

### Milestone AR: Test Relevance Guard

Goal:

Avoid treating trivial stub scripts as strong evidence that a generated feature is correct.

Build:

- Detect obviously trivial quality scripts such as `node -e "console.log('ok')"` and equivalent no-op commands.
- Mark test relevance as `pass`, `warn`, or `needs_human`.
- Include test relevance in the run report and quality report.
- Keep the heuristic conservative and transparent.

Acceptance:

- Stub-only tests are surfaced as weak evidence.
- Realistic test commands are not blocked by default.
- The guard does not prevent local development, but can escalate the run before provider handoff.

Explicit safety constraints:

- Do not attempt to infer full semantic test quality in this milestone.
- Do not run package-manager installs automatically.
- Production merge and production deployment remain human-only.

### Milestone AS: Harness v1

Goal:

Turn the temporary real smoke learnings into a reproducible local harness that can score Ewokbot behavior against fixtures.

Build:

- Add a fixture format for tickets, repositories, and expected outcomes.
- Add a minimal Node fixture repository and the AD-101-style ticket fixture.
- Add `ewokbot harness run <fixture-id>` and `ewokbot harness run --all`.
- Score expected outcomes such as meaningful diff, selected repository, policy decision, quality result, and report presence.
- Keep harness fixtures local and deterministic.

Acceptance:

- The harness catches a no-meaningful-diff false positive.
- Harness tests do not call live OpenCode, Jira, GitHub, Railway, Vercel, MCP, or network services.
- Harness output is readable enough for CI and local development.

Explicit safety constraints:

- Do not add live provider credentials or live service calls.
- Do not make harness execution mutate user repositories.
- Production merge and production deployment remain human-only.

### Milestone AT: Real Provider Smoke v1

Goal:

Run one controlled smoke using a real Jira MCP ticket while keeping development and provider mutations tightly bounded.

Build:

- Use Jira MCP to read one explicitly selected sandbox ticket.
- Reuse planning, `run-dev`, meaningful-diff, safety, completion, test relevance, and local quality evidence.
- Do not open GitHub PRs or call deployment providers in this milestone.
- Produce an operator report that explains exactly what was read and what local actions happened.

Acceptance:

- One real Jira ticket can drive `scan`, `plan`, and `run-dev` locally.
- Missing Jira MCP readiness fails before repository or agent side effects.
- No GitHub, Railway, Vercel, production, or remote mutation is attempted.

Explicit safety constraints:

- Use sandbox or explicitly selected tickets only.
- Do not transition Jira tickets unless a later milestone explicitly approves it.
- Production merge and production deployment remain human-only.

### Milestone AU: MCP Inspect Schemas

Goal:

Make MCP inspection precise enough to discover real provider contracts before any provider mapping or automation is trusted.

Build:

- Extend `ewokbot mcp inspect <server-id>` with `--json` and/or `--schema` output.
- Include tool names, descriptions, input schemas, and available output metadata where the MCP server exposes it.
- Preserve the current default human-readable output for quick inspection.
- Keep inspect mode read-only: it may call MCP `listTools`, but must not call any provider tool.
- Support Atlassian, Railway, GitHub, and future configured MCP servers through the same command path.
- Redact any secret-like values if a server ever exposes defaults or examples that look credential-like.
- Add tests using injected mock MCP clients only.

Acceptance:

- `ewokbot mcp inspect atlassian --schema` can show the schema for tools such as `search_jira_issues`, `read_jira_issue`, and `add_jira_comment` when returned by the MCP server.
- `ewokbot mcp inspect railway --schema` can show Railway tool schemas without calling `deploy`, `set_variables`, or any mutating tool.
- Unknown servers and unsupported flags fail with actionable messages.
- Tests prove no MCP tool call occurs beyond tool discovery.
- Tests remain fake-only with no live MCP server startup, provider calls, OAuth flows, network calls, or credential access.

Explicit safety constraints:

- Do not implement provider tool execution in AU.
- Do not change Jira, Railway, or GitHub business port mappings in AU.
- Do not cache schemas outside Ewokbot-owned local cache paths unless explicitly requested.
- Do not print secrets.
- Production merge and production deployment remain human-only.

### Milestone AV: MCP Tool Registry

Goal:

Give Ewokbot a complete internal registry for discovered MCP tools so providers can be mapped from real contracts instead of guessed names.

Build:

- Add typed models for MCP tool registry entries: provider, server id, tool name, description, input schema, output metadata if available, category, classification, and source.
- Support classifications such as `read`, `write`, `destructive`, `secret_sensitive`, `unknown`, and `custom`.
- Add a local cache path under `.ewokbot/cache/mcp-tools/` for operator-generated inspection snapshots when explicitly requested.
- Keep registry data separate from provider credentials and run evidence.
- Add registry loaders for inspected Atlassian, Railway, GitHub, and custom MCP servers.
- Treat unknown or unclassified tools as denied by default until a policy explicitly allows them.
- Update docs to explain "full mapping, policy-gated execution".

Acceptance:

- Registry entries can be built from fake MCP inspection data.
- Unknown tools are represented explicitly and are not silently allowed.
- No raw secrets are stored in registry snapshots.
- Tests cover Atlassian, Railway, GitHub, and custom server registry data.
- Tests remain fake-only with no live provider or MCP calls.

Explicit safety constraints:

- Do not execute any provider tool in AV.
- Do not implement GitHub PR handoff, Railway staging verification, or Jira transitions in AV.
- Production merge and production deployment remain human-only.

### Milestone AW: MCP Policy Modes

Goal:

Make MCP execution permissions explicit, configurable, and safe by default before broad provider capabilities are enabled.

Build:

- Add policy modes:
  - `read_only`
  - `supervised`
  - `trusted`
  - `custom`
- Add an `mcp_policy` config model for provider/server/tool-level overrides.
- Define decisions: `allow`, `allow_redacted`, `require_human`, and `deny`.
- Deny unknown or unclassified tools by default.
- Add policy evaluation that uses the registry classification and selected autonomy mode.
- Add clear report/audit output for why a tool was allowed, redacted, blocked, or required human approval.
- Keep production merge and production deployment human-only regardless of mode.

Acceptance:

- `read_only` permits only read-classified tools.
- `supervised` can permit selected non-destructive writes while requiring confirmation for risky writes.
- `trusted` can permit broader staging-safe actions but still blocks production merge/deploy and destructive tools unless explicitly overridden.
- `custom` honors explicit per-tool policy while still denying unknown tools by default.
- Tests cover Atlassian, Railway, GitHub, and custom tool decisions.

Explicit safety constraints:

- Do not call live tools in policy tests.
- Do not allow `set_variables`, secret reads, destructive deletes, production merge, or production deploy by default.
- Do not expose raw MCP tool calling to coding agents or operator agents.

### Milestone AX: Atlassian MCP Real Mapping

Goal:

Align Jira/Atlassian runtime mapping with the real tools exposed by the maintained local `mcp-atlassian` server.

Known real tool names from local inspection:

- `search_jira_issues`
- `read_jira_issue`
- `add_jira_comment`
- Additional Jira and Confluence tools are present and must be classified before use.

Build:

- Update Jira MCP defaults from guessed names to the real `mcp-atlassian` names after AU schema inspection confirms argument shapes.
- Adapt `JiraMcpTicketPort` argument mapping to the real input schemas.
- Preserve `jira.mcp_tools` overrides for custom Atlassian MCP servers.
- Classify all discovered Atlassian tools into read, write, destructive, secret-sensitive, or unknown categories.
- Decide the initial supported business intents for Jira: search backlog, read one issue, and optionally comment only under policy.
- Treat Confluence tools as mapped registry entries, but do not add Confluence business workflows unless separately approved.

Acceptance:

- `ewokbot scan`, `ewokbot plan <ticket-key>`, `ewokbot run-dev <ticket-key> --confirm-dev-execution`, and `ewokbot smoke <ticket-key> --confirm-real-provider-smoke` can use real Atlassian tool names through fake tests and documented live-smoke instructions.
- Missing or renamed Jira tools fail with actionable guidance showing how to inspect and override `jira.mcp_tools`.
- Comment writes require policy permission or human confirmation according to the selected mode.
- Tests remain fake-only.

Explicit safety constraints:

- Do not transition Jira issues in AX.
- Do not create Jira issues in AX.
- Do not add Confluence writes to delivery flows in AX.
- Production merge and production deployment remain human-only.

### Milestone AY: Railway MCP Real Mapping

Goal:

Align Railway runtime mapping with the real tools exposed by `railway mcp`, starting with read-only staging verification capabilities.

Known real tool names from local inspection include:

- `whoami`
- `environment_status`
- `list_deployments`
- `list_projects`
- `list_services`
- `get_service_config`
- `get_logs`
- `service_metrics`
- `http_error_rate`
- `http_requests`
- `http_response_time`
- Mutating tools such as `deploy`, `set_variables`, `create_*`, `remove_*`, `scale_service`, and `generate_domain`.

Build:

- Map Railway read-only tools to staging inspection and observability intents.
- Avoid using mutating tools for default staging verification.
- Treat `list_variables` as denied or redacted-only by default because it can expose secrets.
- Replace guessed Railway default tool names with real schema-driven mapping after AU confirms input shapes.
- Add policy classifications for all discovered Railway tools.
- Keep service URLs/smoke URLs configured by workspace/repo config unless a safe read-only tool reliably exposes them.

Acceptance:

- Railway readiness and staging status can be checked through read-only fake MCP tools.
- Mutating Railway tools require human confirmation or are denied according to policy.
- Secret-sensitive Railway outputs are redacted or blocked.
- Tests remain fake-only.

Explicit safety constraints:

- Do not call `deploy`, `set_variables`, `remove_*`, `scale_service`, or `generate_domain` by default.
- Do not print Railway variable values.
- Production merge and production deployment remain human-only.

### Milestone AZ: GitHub MCP Real Mapping

Goal:

Integrate GitHub MCP through the same inspection, registry, and policy model used for Atlassian and Railway.

Build:

- Add/confirm a maintained GitHub MCP connector preset.
- Use AU schema inspection to discover the real GitHub MCP tool names and input schemas.
- Map GitHub business intents: repository discovery where needed, branch/refs readiness, draft PR creation, PR comments, and checks/status reading.
- Classify GitHub tools such as issue reads, PR creation, comments, checks, workflow operations, branch deletion, repository writes, secrets, and merges.
- Preserve custom `github.mcp_tools` overrides.
- Deny merge, branch deletion, secret management, and workflow mutation by default.

Acceptance:

- GitHub MCP real tool contracts are documented and represented in the registry.
- GitHub write actions are policy-gated before any PR handoff milestone uses them.
- Tests prove unclassified or destructive GitHub tools are denied by default.
- Tests remain fake-only.

Explicit safety constraints:

- Do not open real PRs in AZ.
- Do not push real branches in AZ.
- Do not merge PRs, mutate secrets, or change workflows.
- Production merge and production deployment remain human-only.

### Milestone BA: GitHub PR Handoff v1

Goal:

After local evidence passes and GitHub MCP mapping/policy are accepted, hand off a validated branch to GitHub as a draft pull request without merging.

Build:

- Push the local branch through the allowed local git/native fallback path.
- Open or reuse a draft PR against the configured develop branch through the typed CodeHostPort.
- Attach the run report, safety decision, quality evidence, and known limitations to the PR body/comment.
- Add idempotency protection for repeated handoff attempts.
- Require MCP policy permission for all GitHub MCP writes.

Acceptance:

- PR handoff requires meaningful diff, safety pass or accepted human review, completion pass, test relevance, and quality gates.
- Re-running the same handoff does not duplicate branches, PRs, or comments.
- GitHub write actions pass through the policy engine.
- Tests use fake CodeHostPort and fake git remotes only.

Explicit safety constraints:

- Do not merge PRs automatically.
- Do not open production PRs in BA.
- Do not perform real remote pushes in tests.
- Production merge and production deployment remain human-only.

### Milestone BB: Real Staging Verification v1

Goal:

Verify staging through policy-approved read-only Railway MCP evidence after a development PR handoff.

Build:

- Read Railway environment/deployment status through mapped Railway MCP tools.
- Read safe logs/metrics/status evidence with redaction.
- Run configured staging smoke URLs when available.
- Write staging evidence into the run directory and final report.
- Stop before production PR/merge/deploy unless a later milestone explicitly approves those handoffs.

Acceptance:

- Staging verification can pass/fail from fake Railway MCP status plus fake smoke checks.
- Mutating Railway actions are not called.
- Secret-sensitive outputs are redacted.
- Tests remain fake-only.

Explicit safety constraints:

- Do not deploy, rollback, scale, mutate variables, create domains, or delete resources in BB.
- Do not merge production or deploy production.

### Milestone BC: Operator Agent Action Sandbox

Goal:

Add an Ewokbot operator agent that can converse with the user and drive the existing delivery flow only through an explicit registry of approved Ewokbot actions.

Build:

- Add an operator-agent action registry with typed actions such as list tickets, plan ticket, start dev run, inspect run, summarize run, request human approval, and later prepare PR.
- Require schemas for every action input and reject unknown or malformed actions.
- Map approved actions to internal Ewokbot command handlers or service functions instead of giving the agent a raw shell.
- Add confirmation policy per action, including mandatory human confirmation before side effects such as starting development, pushing branches, opening PRs, or provider mutations.
- Keep raw MCP tools, provider tokens, filesystem access, and shell commands unavailable to the operator agent.
- Persist an audit trail of proposed, approved, executed, refused, and failed actions.
- Keep OpenCode or other coding agents behind the existing dev-runner boundary; the operator agent supervises, but does not become a free-form coding shell.

Acceptance:

- The operator agent can propose and execute only registered Ewokbot actions.
- Attempts to call unregistered actions, raw shell commands, raw MCP tools, or provider credentials are refused and audited.
- Human confirmation is required for side-effectful actions.
- Existing CLI commands remain usable without the operator agent.
- Tests use fake LLM/action proposals only and do not call live providers, MCP servers, OpenCode, shells, or networks.

Explicit safety constraints:

- Do not expose a raw shell to the operator agent.
- Do not expose raw MCP tool calling to the operator agent.
- Do not expose provider credentials or OpenCode credentials to the operator agent.
- Do not implement Telegram, WhatsApp, or dashboard surfaces in AV.
- Production merge and production deployment remain human-only.
