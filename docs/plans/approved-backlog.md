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
