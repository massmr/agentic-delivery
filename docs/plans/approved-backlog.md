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
