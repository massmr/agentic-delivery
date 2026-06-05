# Technical Architecture

## Stack

- Runtime: Node.js.
- Language: TypeScript.
- Interface: CLI first.
- Current interface: CLI plus mock-safe worker process.
- Future interface: dashboard.
- State storage for MVP: local SQLite or JSONL-backed state store.
- Configuration: YAML.
- Development runner: OpenCode.

## Architecture Direction

Ewokbot is an agent runtime with typed business ports backed first by MCP tools, with native, subprocess, and mock adapters as fallbacks.

See [MCP-First Architecture](mcp-first-architecture.md).

MCP is the preferred control plane for external SaaS providers such as Jira, GitHub, Railway, Vercel, and Bitbucket. The runtime still owns state, decisions, policy, retries, reports, and production approval gates.

## High-Level Components

```text
CLI
  -> Agent Runtime
    -> Agent Worker Loop
    -> State Machine
    -> Decision Policy
    -> Operation Ledger
    -> Business Ports
      -> TicketPort
      -> CodeHostPort
      -> DeploymentPort
      -> DevRunnerPort
      -> WorkspacePort
    -> MCP Layer
      -> Server Registry
      -> Tool Discovery
      -> Tool Allowlist
      -> Tool Schema Mapping
    -> Native Fallback Contracts
    -> Native/Subprocess/Mock Adapters
    -> Quality Gate Runner
    -> Report Writer
```

## Package Boundaries

```text
src/
  cli/
    index.ts
    commands/
  core/
    orchestrator.ts
    state-machine.ts
    autonomy-policy.ts
  agent/
    runtime.ts
    decision-policy.ts
    operation-ledger.ts
  ports/
    ticket-port.ts
    code-host-port.ts
    deployment-port.ts
    dev-runner-port.ts
    workspace-port.ts
  mcp/
    server-registry.ts
    client.ts
    tool-mapper.ts
  connectors/
    jira/
    github/
    railway/
  runners/
    opencode/
  quality/
  config/
  reports/
  state/
```

## Configuration Model

The global config describes providers, branches, repositories, and autonomy.

Default workspace configuration lives at `.ewokbot/workspace.yml`; `ewokbot init` generates it under the workspace-local `.ewokbot/` directory.

Repository configuration supports two input shapes. Fresh init uses `repos.discovery: sibling-git-directories` plus `exclude: []`, which scans only direct child directories of the workspace root that contain `.git/`, ignores `.ewokbot/`, hidden directories, `node_modules/`, non-Git directories, and nested repos, then normalizes the result into `WorkspaceConfig.repos`. Explicit `repos: [...]` arrays remain supported and use the same normalized runtime model.

Each target repository may also contain a local `.agent-quality.yml` file. If missing, the orchestrator falls back to a configured quality profile.

## Ports And Connector Interfaces

Core delivery logic must depend on typed ports, not raw MCP tool names. Connectors and MCP adapters implement these ports.

### Ticket Port

Responsibilities:

- List backlog tickets.
- Fetch ticket details.
- Add comments.
- Transition ticket status where configured.
- Attach run summaries.

Current runtime intake can route `agentic scan`, `ewokbot plan <ticket-key>`, and worker backlog intake through `createRuntimeTicketPort(...)`. Mock Jira remains the default, while explicit `jira.mode: mcp` runtime wiring uses injected MCP clients, discovery, allowlist validation, and audit capture. The planning command reads exactly one ticket through `TicketPort.getTicket`, writes only local dry-run evidence under `.ewokbot/runs/`, and does not create branches, run OpenCode, run package scripts, write operation ledgers, call GitHub, call Railway or Vercel, open PRs, verify deployments, merge production, or deploy production. No Jira REST adapter or live MCP session startup is part of the runtime path.

Required methods:

```ts
interface TicketPort {
  listBacklog(): Promise<JiraTicket[]>;
  getTicket(key: string): Promise<JiraTicket>;
  comment(key: string, body: string): Promise<void>;
  transition?(key: string, status: string): Promise<void>;
}
```

### Code Host Port

Responsibilities:

- Ensure branches exist.
- Push branches.
- Open pull requests.
- Read checks.
- Comment on PRs.

Develop handoff uses this port for GitHub branch metadata, pull request creation, PR comments, and check reads. Actual branch push is intentionally outside the GitHub MCP surface and uses the local git/native subprocess fallback through `LocalGitAdapter.pushBranch(...)`. Required local quality gates must pass before the workflow attempts local push, PR handoff, comments, or check reads. Mutating handoff actions are recorded in the operation ledger before and after execution so reruns can avoid duplicate branches, pushes, PRs, comments, and check polling side effects.

Required methods:

```ts
interface CodeHostPort {
  createBranch(input: CreateBranchInput): Promise<BranchRef>;
  openPullRequest(input: PullRequestInput): Promise<PullRequestRef>;
  getChecks(input: ChecksInput): Promise<CheckRunSummary>;
  commentOnPullRequest(input: PullRequestCommentInput): Promise<void>;
}
```

### Deployment Port

Responsibilities:

- Find deployment for repository and branch.
- Wait for staging deployment.
- Read deployment status.
- Resolve staging URLs.

Staging verification uses this port for Railway deployment polling and service URL lookup. Railway MCP results must precisely match the requested branch, commit SHA, deployment reference, and staging environment before smoke verification can run. Missing, invalid, or non-HTTP(S) service URLs fail staging before smoke checks. Failed polling, failed deployment status, missing URLs, and failed smoke checks persist `FAILED` state plus staging report evidence and block production PR preparation.

Required methods:

```ts
interface DeploymentPort {
  waitForDeployment(input: DeploymentInput): Promise<DeploymentResult>;
  getServiceUrl(input: ServiceUrlInput): Promise<string>;
}
```

### Dev Runner Port

Responsibilities:

- Build execution context.
- Invoke OpenCode.
- Stream logs.
- Capture result.
- Enforce retry policy.

OpenCode execution is subprocess-first. The subprocess runner must use an executable plus argument array, validate the working directory against the configured workspace root, pass only allowlisted environment variables, enforce timeout and cancellation, capture stdout/stderr into implementation logs, redact secret-like output before persistence, and stop retrying after timeout or cancellation.

Required methods:

```ts
interface DevRunner {
  run(input: DevRunInput): Promise<DevRunResult>;
}
```

## MCP Policy

MCP tools are classified before use:

- `read`: planning and verification actions.
- `write`: actions allowed only through typed ports and state transitions.
- `danger`: actions requiring human approval or explicit policy.

Production merge is always `danger` and remains human-only.

## Native Fallback Policy

Native, subprocess, and mock adapters are allowed only through explicit contracts, not by ad hoc provider selection. The shared policy module is `src/policy/native-fallback-contracts.ts`.

Rules:

- MCP is the default for external SaaS actions on Jira, GitHub, and Railway when the MCP tool maps cleanly into a typed port.
- Native provider APIs are allowed for GitHub checks/PR details and Railway deployment polling/service URL lookup only when MCP lacks required precision.
- Local git branch pushing and workspace operations use native or subprocess behavior because they depend on local repository state and credentials.
- Filesystem state/report writes, quality gates, and OpenCode execution are runtime-owned native/subprocess surfaces, not MCP provider calls.
- Mock adapters remain valid for local deterministic runs and tests without credentials or network.
- Production pull request merge and production deployment mutation remain human-only and have no autonomous fallback adapter.

Any new port action must add a contract and tests before an adapter can call it.

## State Machine

Every ticket run must be durable and resumable.

State is persisted after each transition. A failed process can resume from the latest completed state.

Required run fields:

- run id
- Jira ticket key
- current state
- target repositories
- branches
- PR URLs
- staging URLs
- quality results
- timestamps
- failure reason
- human action needed reason

## Agent Worker Loop

The worker loop processes queued backlog tickets through the same typed ports and delivery orchestration as one-shot runs. It is a runtime-owned coordinator, not a provider adapter.

Required behavior:

- Pull backlog tickets through `TicketPort.listBacklog` and de-duplicate ticket keys within the worker invocation.
- Fetch ticket details through `TicketPort.getTicket` before processing, allowing Jira MCP intake while keeping processing mock/local until later worker-provider milestones.
- Distinguish mock and MCP worker modes from workspace provider config. If any external provider is explicitly configured for MCP mode, startup validates runtime MCP clients, discovered tools, typed allowlists, and Native Fallback Contracts before the queue starts.
- Report worker mode, intake mode, and Jira/GitHub/Railway provider modes in operator output.
- Respect `max_concurrent_tickets` from workspace config unless a stricter CLI option is provided.
- Bound execution with safe stop conditions: idle queue, max cycles, explicit stop callback, and abort signal.
- Support deterministic retry/backoff through injectable sleep so tests do not wait or call live services.
- Escalate exhausted retries and human-gated ticket results to `NEEDS_HUMAN` instead of bypassing production controls.
- Persist worker attempt state before each ticket attempt and persist returned run state after the ticket processor completes.
- Keep mock mode default. Tests and local worker runs must not require credentials, OAuth, webhooks, live provider calls, remote pushes, production merge, or production deployment.

## Long-Running Worker Runtime

`ewokbot worker start` wraps the worker loop as a foreground runtime suitable for a VPS shell session. The legacy `ewokbot worker` command remains available for bounded compatibility workflows, while `worker start` is the operator-facing command for Milestone AC.

Runtime behavior:

- Acquire `.ewokbot/runs/worker.lock` before listing backlog tickets. The lock is created atomically, records owner metadata, rejects a second live worker in the same workspace, and recovers stale dead-PID locks.
- Support `--dry-run` as a read-only backlog preview. Dry-run mode may list configured backlog tickets through the ticket intake port, but it must not write run state, write operation ledgers, invoke the ticket processor, run OpenCode, run git, push branches, create PRs, read checks, verify deployments, or touch production controls.
- Support `--once` for one worker cycle and default `worker start` to a foreground continuous polling process with a safe poll interval. `--max-cycles` can bound the foreground process for troubleshooting and tests.
- Wire `SIGINT` and `SIGTERM` to the worker abort signal, stop accepting future cycles, print a shutdown summary, and release the workspace lock in cleanup.
- Before processing a backlog ticket, inspect the latest persisted run state under `.ewokbot/runs/<ticket>/<run-id>/state.json`. If any prior run exists, preserve that state and skip automatic processing for Milestone AC so restarts do not create duplicate side effects. Production PR states remain human-only and must never resume into merge or deployment.
- Emit operator-readable logs for startup, mode, provider modes, lock lifecycle, stale lock recovery, dry-run results, state reuse decisions, cycle summaries, shutdown, and the human-only production boundary. Logs must not include secret values.
- In MCP mode, validate runtime MCP clients, discovered tools, typed allowlists, and fallback contracts before acquiring `.ewokbot/runs/worker.lock`. This validation remains before run state writes, Jira reads, git, OpenCode, PRs, Railway checks, operation-ledger writes, and provider mutations. Dry-run MCP intake validates only the Jira read tools needed for the preview.
- Preserve mock mode as the default and keep tests deterministic with injected clients, clocks, sleeps, and filesystem roots.

## Branch Policy

Working branch format:

```text
agent/<JIRA_KEY>-<short-slug>
```

Target branches:

- Staging PR target: `develop`
- Production PR target: `main`

## Quality Policy

The orchestrator must not push or open a staging PR unless required local quality gates pass.

OpenCode runner success does not bypass quality gates. Failed, timed-out, or cancelled runner attempts persist actionable run state and reports before stopping or escalating; later GitHub and staging steps remain blocked until required quality gates pass.

GitHub develop handoff also remains blocked until the latest required quality report has passed. The workflow may prepare local branch state, but it must not push the branch, create/open the develop pull request, comment on the pull request, or read checks until quality has passed.

Default required gates:

- install
- lint
- typecheck
- test
- build

Optional gates:

- format check
- coverage
- secret scan
- dependency audit
- e2e

## Reporting

Each run writes:

```text
.ewokbot/runs/<JIRA_KEY>/<run_id>/
  plan.md
  implementation-log.md
  quality-report.md
  staging-report.md
  final-report.md
  state.json
```

Reports must be written in clear Markdown and suitable for Jira or GitHub comments.
