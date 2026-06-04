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

Agentic Delivery is an agent runtime with typed business ports backed first by MCP tools, with native, subprocess, and mock adapters as fallbacks.

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

See [workspace.example.yml](../../config/workspace.example.yml).

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
- Respect `max_concurrent_tickets` from workspace config unless a stricter CLI option is provided.
- Bound execution with safe stop conditions: idle queue, max cycles, explicit stop callback, and abort signal.
- Support deterministic retry/backoff through injectable sleep so tests do not wait or call live services.
- Escalate exhausted retries and human-gated ticket results to `NEEDS_HUMAN` instead of bypassing production controls.
- Persist worker attempt state before each ticket attempt and persist returned run state after the ticket processor completes.
- Keep mock mode default. Tests and local worker runs must not require credentials, OAuth, webhooks, live provider calls, remote pushes, production merge, or production deployment.

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
runs/<JIRA_KEY>/<run_id>/
  plan.md
  implementation-log.md
  quality-report.md
  staging-report.md
  final-report.md
  state.json
```

Reports must be written in clear Markdown and suitable for Jira or GitHub comments.
