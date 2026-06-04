# Progress Log

## 2026-06-04

Completed Milestone V Real Jira Intake:

- Added a Jira-only runtime `TicketPort` factory with `createRuntimeTicketPort(...)`, preserving mock defaults while validating Jira MCP clients, discovered tools, and typed allowlists before intake use.
- Routed `agentic scan` through the runtime `TicketPort` so explicit Jira MCP configuration can list backlog tickets with injected `MockMcpClient` tests and MCP audit capture.
- Routed worker intake through a typed `TicketPort`, fetching ticket details with `getTicket` before handing tickets to the existing mock-safe delivery path.
- Added mock-only tests for Jira MCP scan intake, empty backlog handling, missing client/tool readiness failures, typed comment audit capture, and worker list/get intake behavior.
- Preserved the no-Jira-REST boundary, mock local default, no live provider/MCP calls in tests, and human-only production merge/deployment controls.

Completed Milestone U Runtime MCP Wiring:

- Added runtime MCP provider construction through `createRuntimeWorkspaceAdapters(...)`, resolving configured MCP servers to injected clients or an injectable `createMcpClient(serverConfig)` factory.
- Exposed Jira, GitHub, and Railway MCP tool requirement metadata from adapter layers while keeping raw MCP tool names out of core delivery logic.
- Added startup readiness validation for discovered tools and typed port/action allowlists before MCP-backed adapter use.
- Wired a shared MCP audit sink through runtime-created Jira, GitHub, and Railway adapters.
- Added mock-only runtime MCP wiring tests for mock defaults, client construction, readiness failures, disallowed tools, audit capture, and GitHub `pushBranch` exclusion.
- Preserved mock mode as the default and avoided live MCP sessions, provider network calls, credentials, production merge, or production deployment automation.

Completed Milestone T Agent Worker Loop:

- Added a mock-safe `runAgentWorkerLoop(...)` delivery coordinator that queues backlog tickets, de-duplicates tickets within an invocation, respects concurrency limits, and stops on idle, max cycles, explicit stop callbacks, or abort signals.
- Added deterministic retry/backoff and escalation behavior with injectable sleep, preserving human-only production boundaries and escalating exhausted or human-gated tickets to `NEEDS_HUMAN`.
- Persisted worker attempt state and returned ticket run state through the existing run-state store so worker progress remains auditable.
- Added the public `agentic worker` CLI command with safe concurrency, retry, cycle, and polling options while keeping mock mode as the default and avoiding credentials or live provider calls.
- Added worker-loop and CLI tests for queue behavior, concurrency, retries, escalation, safe stops, durable state writes, and mock-only execution.
- Documented worker behavior in README and technical architecture, and updated tracking to mark Milestone T complete.

## 2026-06-04 Earlier - Milestone S

Completed Milestone S Native Fallback Contracts:

- Added a typed `nativeFallbackContracts` policy surface under `src/policy` with explicit MCP, native, subprocess, mock, and human-only adapter rules.
- Covered Jira MCP-first ticket actions, GitHub MCP-first PR/check/comment actions, GitHub local git push fallback, Railway MCP-first deployment reads with narrow native precision fallback, local workspace/filesystem/quality/OpenCode subprocess boundaries, and human-only production merge/deployment controls.
- Added tests for the contract matrix, disallowed adapters, undeclared operations, and Milestone S required policy surfaces without live API calls or credentials.
- Documented the fallback rules in README, MCP-first architecture, technical architecture, and quality gate specs.

## 2026-06-04 Earlier - Milestone R

Completed Milestone R Railway MCP DeploymentPort:

- Added a typed `DeploymentPort` boundary under `src/ports` and kept `RailwayConnector` compatible with that surface.
- Added `RailwayMcpDeploymentPort`, which maps read-oriented Railway MCP tools into `waitForDeployment`, `readDeployment`, and `getServiceUrl` while keeping raw tool names private to the adapter.
- Extended workspace config with Railway `mode: mcp`, optional top-level `mcp_servers`, configurable Railway MCP tool names, and MCP-mode server validation.
- Updated provider factory behavior so mock remains the default, real Railway remains fail-fast/no live adapter, and MCP Railway requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for Railway MCP deployment state, service URL lookup, audit capture, missing tools, Railway MCP config parsing, and factory selection.
- Documented that Railway MCP is read-oriented and unsupported deployment actions remain on the native/local fallback path until the next fallback-contract milestone.
- Verified the milestone with `pnpm typecheck`, `pnpm test`, and `pnpm build`.

## 2026-06-03

Created initial project specifications and OpenCode execution material:

- `README.md`
- `docs/specs/product-spec.md`
- `docs/specs/technical-architecture.md`
- `docs/specs/quality-gates.md`
- `docs/plans/mvp-plan.md`
- `docs/plans/opencode-autonomy-plan.md`
- `docs/prompts/opencode-build-orchestrator.md`
- `docs/prompts/opencode-next-step.md`
- `docs/runbooks/ticket-run.md`
- `config/workspace.example.yml`
- `.env.example`
- `.gitignore`
- `AGENTS.md`

Added roadmap controls for post-Milestone I autonomy:

- Added `docs/plans/approved-backlog.md`.
- Updated `AGENTS.md` to forbid unapproved autonomous milestones.
- Updated `docs/tracking/next-actions.md` to make Milestone J the next approved task.
- Clarified that real provider adapter work must wait until Milestones J, K, and L are complete.

Added tracking system:

- `docs/tracking/README.md`
- `docs/tracking/roadmap.md`
- `docs/tracking/decision-log.md`
- `docs/tracking/progress-log.md`
- `docs/tracking/risks-and-blockers.md`
- `docs/tracking/next-actions.md`

Resumed development directly and completed the first mock planning loop:

- Added JSON run state store and state transition helpers.
- Added mock Jira connector.
- Added repository resolver based on configured hints.
- Added Markdown plan report writer.
- Added `agentic scan`.
- Added `agentic plan <ticket-key>`.
- Added tests for state, scan, planning, and reports.
- Verified `pnpm test`: 23 passing tests.

Started quality gate implementation:

- Added `.agent-quality.yml` parser.
- Added Node package script quality detection fallback.
- Added ordered quality gate runner with stdout/stderr log capture.
- Added tests for parsing, detection, and required-gate fail-fast behavior.
- Verified `pnpm test`: 27 passing tests.

Completed Milestone E quality gates:

- Optional configured gates without commands now produce skipped warning results and logs instead of failing the run.
- Required configured gates without commands still fail configuration.
- Added deterministic `quality-report.md` output under `runs/<ticket-key>/<run-id>/`.
- Added `agentic quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]` for local quality execution, log capture, report writing, and state persistence.
- Added tests for optional skip warnings, required configuration failure, Markdown report writing, CLI help, passing quality runs, and required-gate fail-fast behavior.
- Verified `pnpm test`: 32 passing tests.
- Verified `pnpm typecheck` and `pnpm build`.

Completed Milestone F OpenCode runner contract:

- Added typed dev runner domain models and persisted `devRuns` on run state records.
- Added state helper behavior for recording passed implementation runs at `IMPLEMENTING` and failed implementation runs at `FAILED` with actionable implementation log and exit-code context.
- Added deterministic OpenCode prompt builder covering ticket, repository, branch, quality policy, definition of done, and local/mock-only guardrails.
- Added OpenCode-compatible subprocess runner with prompt stdin, implementation log capture at `runs/<ticket-key>/<run-id>/implementation-log.md`, and retry attempt sections.
- Added stateful implementation wrapper that writes `IMPLEMENTING`, runs the typed runner, appends dev run results, and persists failed outcomes.
- Added harmless `process.execPath -e` mock-command tests for prompt rendering, runner success, runner failure, retry logging, and stateful failure persistence.

Completed Milestone G git and GitHub interfaces:

- Added deterministic working branch naming using `agent/<JIRA_KEY>-<short-slug>` with custom prefix support.
- Added a local-only git adapter with an injectable argument-array command runner; it creates/checks out local branches and never fetches, pulls, or pushes remotes.
- Added a future-shaped GitHub connector interface, deterministic mock GitHub connector, and develop PR body builder with Jira, run, branch, quality, risks, and local/mock-only details.
- Added state helpers for branch creation, pushed branch state, and develop PR creation with idempotent replacement of matching branch and PR entries.
- Added develop PR handoff flow that writes `BRANCH_CREATED`, then requires `LOCAL_CHECKS_PASSED` plus a latest passed required quality report before mock push and PR state writes.
- Added tests for branch naming, mock GitHub behavior, PR body rendering, state helpers, local git command-runner behavior, a harmless temp git repository, handoff write sequencing, and failed-quality guarding.

Completed Milestone H Railway staging verification foundation:

- Added a future-shaped Railway connector interface and deterministic `MockRailwayConnector` for local staging deployment status, service URL resolution, and failure simulation.
- Added a `SmokeUrlVerifier` contract and deterministic `MockSmokeUrlVerifier` with passed, failed, and skipped outcomes without HTTP or network calls.
- Added `runStagingVerification(...)` to require `DEVELOP_CHECKS_PASSED`, persist `STAGING_DEPLOYING`, verify mock deployment and smoke checks, then persist `STAGING_VERIFIED` or actionable `FAILED` state.
- Added staging state helpers and a production PR readiness guard that rejects anything except `STAGING_VERIFIED`.
- Added deterministic staging report rendering and `MarkdownReportWriter.writeStaging(...)` for `runs/<ticket-key>/<run-id>/staging-report.md`.
- Added workspace config parsing for repository `staging_smoke_urls`, including explicit empty arrays for skipped smoke checks.
- Added tests for mock Railway pass/fail behavior, smoke verifier pass/fail/skipped behavior, staging state write sequencing, failed deployment and smoke checks, production readiness guard, staging report output, and config parsing.


Completed Milestone I end-to-end mock run:

- Added mock-only production PR preparation with `assertProductionPullRequestReady(...)`, production PR body rendering, and `PRODUCTION_PR_OPENED` state recording.
- Added deterministic `MockOpenCodeRunner` that writes `implementation-log.md` without spawning OpenCode or making provider calls.
- Added `runEndToEndMockDelivery(...)` and public `agentic run <ticket-key>` wiring for the mock lifecycle through `PRODUCTION_PR_OPENED`.
- Added `final-report.md` rendering with ticket, run, repositories, branches, implementation, quality, develop PR, staging, production PR, final state, and human-only production approval note.
- Added tests for production PR body/state/preparation, final report output, mock OpenCode runner, CLI help, and complete CLI run artifacts.
- Verified `pnpm typecheck` and `pnpm test` during implementation.

Completed Milestone J status and resume foundation:

- Added run-state lookup helpers for explicit `runs/<ticket-key>/<run-id>/state.json` reads, per-ticket run listing, and latest-run selection by persisted `updatedAt` timestamp.
- Added deterministic `getNextActionForState(...)` guidance for every delivery lifecycle state without triggering side effects.
- Added concise status rendering that includes state, repositories, branches, PRs, quality, staging, failures, and human action.
- Added `agentic status <ticket-key> [--run-id <run-id>]` for local run inspection without provider credentials.
- Added tests for state lookup, latest-run selection, missing run errors, summary rendering, next-action coverage, CLI help, and CLI status output.
- Verified `pnpm typecheck` and `pnpm test` during implementation.

Completed Milestone K resume guard:

- Added `canResumeState(...)` and `assertStateResumable(...)` as side-effect-free policy helpers over persisted run state.
- Covered every delivery lifecycle state in the resume policy.
- Blocked automatic resume from `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE` with explicit error reasons.
- Documented the resume policy in README and advanced next actions to Milestone L.
- Added tests for every delivery run state and blocked-state error reasons.

Completed Milestone L multi-repo safety guard:

- Added a guard in `agentic run <ticket-key>` that stops before branch creation or implementation when planning selects multiple repositories.
- Persisted `NEEDS_HUMAN` with a clear reason that multi-repo sub-runs are not implemented yet.
- Preserved the single-repo mock run path through `PRODUCTION_PR_OPENED`.
- Documented the multi-repo guard in README and advanced next actions to Milestone M.
- Added tests for single-repo completion and multi-repo safe stop behavior.

Completed Milestone M real provider adapter design:

- Expanded workspace provider mode types from mock-only to `mock | real` while keeping mock as the default behavior.
- Added adapter factories for Jira, GitHub, Railway, and OpenCode runner boundaries.
- Added explicit credential errors for real Jira, GitHub, and Railway factory paths before any live adapter can be constructed.
- Kept real provider implementations out of scope and documented that Jira, GitHub, and Railway live adapters remain future milestones.
- Added tests for real-mode parsing, mock-default factories, credential failures, and no-live-call factory behavior.

Completed Milestone N MCP-first architecture realignment:

- Added `docs/specs/mcp-first-architecture.md`.
- Updated technical architecture to describe Agent Runtime, typed business ports, MCP layer, and native/subprocess/mock fallbacks.
- Replaced the next approved Jira REST milestone with MCP-first architecture realignment, MCP client foundation, Jira MCP TicketPort, GitHub MCP CodeHostPort, and Railway MCP DeploymentPort.
- Clarified that MCP is the preferred external SaaS control plane, while local git, filesystem, quality gates, state, reports, and production approval remain runtime-owned.

Completed Milestone O MCP client foundation:

- Added `src/mcp` shared infrastructure for MCP server config, `McpClient`, deterministic `MockMcpClient`, tool discovery, tool allowlist rules, tool call audit records, allowed tool-call execution, and timeout/auth/session error mapping.
- Exported public MCP APIs through `src/mcp/index.ts` and `src/index.ts` so future TicketPort, CodeHostPort, and DeploymentPort MCP adapters can depend on typed interfaces instead of raw tool names in delivery logic.
- Added mock-only tests for MCP config validation, discovery, missing-tool errors, allowlist enforcement, audit records, allowed tool calls, timeout/error mapping, failed-call audit capture, and no-live-call behavior.
- Kept provider factories and live Jira/GitHub/Railway/Vercel/Bitbucket integrations untouched; Milestone O adds infrastructure only.

Completed Milestone P Jira MCP TicketPort:

- Added a typed `TicketPort` boundary under `src/ports` and kept `JiraConnector` compatible with that surface.
- Added `JiraMcpTicketPort`, which maps Atlassian MCP Jira search, issue fetch, and comment capabilities into `listBacklog`, `getTicket`, and `comment` while keeping raw tool names private to the adapter.
- Extended workspace config with Jira-only `mode: mcp`, optional top-level `mcp_servers`, and an Atlassian `mcp-remote` example without repository secrets.
- Updated provider factory behavior so mock remains the default, real Jira remains fail-fast/no REST, and MCP Jira requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for backlog, ticket fetch, comments, missing MCP tools, Jira-only MCP config, factory selection, and no-live-call behavior.
- Corrected Milestone P before moving to Milestone Q by preserving MCP audit records through an optional Jira MCP audit sink, allowing configurable Jira MCP tool names with Atlassian defaults, and validating MCP-mode Jira project keys before JQL construction.
- Tightened the Milestone P Jira MCP acceptance gap by sharing project-key validation between workspace parsing and `JiraMcpTicketPort` construction, rejecting invalid keys before any MCP call while keeping valid uppercase keys like `LK`, `LK2`, and `LK_API` supported.
- Verified the validation refactor with `pnpm typecheck` and `pnpm test`.

Completed Milestone Q GitHub MCP CodeHostPort:

- Added a typed `CodeHostPort` boundary under `src/ports` and kept `GitHubConnector` compatible with that surface.
- Added `GitHubMcpCodeHostPort`, which maps MCP branch, pull-request, checks, and comment tools into the GitHub connector contract while keeping raw tool names private to the adapter.
- Extended workspace config with GitHub `mode: mcp`, optional top-level `mcp_servers`, configurable GitHub MCP tool names, and MCP-mode server validation.
- Updated provider factory behavior so mock remains the default, real GitHub remains fail-fast/no live adapter, and MCP GitHub requires an injected `McpClient` keyed by configured server id.
- Added mock-only tests for GitHub MCP branch/PR/check/comment flows, missing tools, GitHub MCP config parsing, and factory selection.
- Verified the Milestone Q implementation with `pnpm typecheck`, `pnpm test`, and `pnpm build`.
- Corrected the Milestone Q GitHub MCP acceptance gap by removing unsafe metadata-only pushBranch support, keeping pushBranch on the native/local git fallback path, and adding default GitHub MCP tool-name coverage alongside the existing custom-name tests.
