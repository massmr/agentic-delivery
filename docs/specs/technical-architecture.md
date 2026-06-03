# Technical Architecture

## Stack

- Runtime: Node.js.
- Language: TypeScript.
- Interface: CLI first.
- Future interface: worker process and dashboard.
- State storage for MVP: local SQLite or JSONL-backed state store.
- Configuration: YAML.
- Development runner: OpenCode.

## High-Level Components

```text
CLI
  -> Core Orchestrator
    -> State Machine
    -> Jira Connector
    -> Repo Resolver
    -> GitHub Connector
    -> Railway Connector
    -> OpenCode Runner
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

## Connector Interfaces

### Jira Connector

Responsibilities:

- List backlog tickets.
- Fetch ticket details.
- Add comments.
- Transition ticket status where configured.
- Attach run summaries.

Required methods:

```ts
interface JiraConnector {
  listBacklog(): Promise<JiraTicket[]>;
  getTicket(key: string): Promise<JiraTicket>;
  comment(key: string, body: string): Promise<void>;
  transition?(key: string, status: string): Promise<void>;
}
```

### GitHub Connector

Responsibilities:

- Ensure branches exist.
- Push branches.
- Open pull requests.
- Read checks.
- Comment on PRs.

Required methods:

```ts
interface GitHubConnector {
  createBranch(input: CreateBranchInput): Promise<BranchRef>;
  openPullRequest(input: PullRequestInput): Promise<PullRequestRef>;
  getChecks(input: ChecksInput): Promise<CheckRunSummary>;
  commentOnPullRequest(input: PullRequestCommentInput): Promise<void>;
}
```

### Railway Connector

Responsibilities:

- Find deployment for repository and branch.
- Wait for staging deployment.
- Read deployment status.
- Resolve staging URLs.

Required methods:

```ts
interface RailwayConnector {
  waitForDeployment(input: DeploymentInput): Promise<DeploymentResult>;
  getServiceUrl(input: ServiceUrlInput): Promise<string>;
}
```

### OpenCode Runner

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
