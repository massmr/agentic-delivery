# Agentic Delivery

Agentic Delivery is an independent orchestration layer for autonomous software delivery.

The project goal is to connect Jira, GitHub, Railway, and a coding runner such as OpenCode so backlog items can move from analysis to implementation, staging verification, and production pull request creation.

The planned system is designed for full autonomy until production. A human validates production pull requests before merge.

## Core Goal

```text
Jira backlog
  -> ticket analysis
  -> repo discovery
  -> branch creation
  -> OpenCode implementation
  -> quality gates
  -> PR to develop
  -> Railway staging verification
  -> PR to main
  -> human production approval
```

## Current Phase

This repository now includes the config, domain, state, report, mock planning, local quality-gate, OpenCode runner, local git/GitHub handoff, mock Railway staging verification, local run-status foundations, and resume guard policy for the orchestrator. It can initialize and validate a local workspace configuration, scan deterministic mock Jira backlog tickets, plan one ticket, select candidate repositories, run local repository quality gates, build deterministic working branch names, create local-only git branches, prepare mock GitHub develop PR handoffs, verify mock Railway staging deployments with deterministic smoke checks, write staging reports, inspect existing run state, identify automatically resumable states, and write resumable run state without provider credentials.

The current implementation is still local and mock-only. It makes no real Jira, GitHub, Railway, or OpenCode provider calls, performs no remote git fetch/pull/push, and never merges or deploys production. The public `agentic run <ticket-key>` command now executes one deterministic mock ticket run through production PR preparation for human approval.

Start with:

- [Product Spec](docs/specs/product-spec.md)
- [Technical Architecture](docs/specs/technical-architecture.md)
- [MVP Plan](docs/plans/mvp-plan.md)
- [OpenCode Execution Prompt](docs/prompts/opencode-build-orchestrator.md)

## Usage

Install dependencies:

```bash
pnpm install
```

Typecheck:

```bash
pnpm typecheck
```

Run tests:

```bash
pnpm test
```

Build the CLI:

```bash
pnpm build
```

Show the built CLI help:

```bash
node dist/src/cli/index.js --help
```

Initialize a workspace config:

```bash
node dist/src/cli/index.js init
```

Scan the mock Jira backlog:

```bash
node dist/src/cli/index.js scan
```

Plan one mock Jira ticket:

```bash
node dist/src/cli/index.js plan LK-101
```

Run one mock ticket end to end:

```bash
node dist/src/cli/index.js run LK-101
```

Inspect an existing run state:

```bash
node dist/src/cli/index.js status LK-101
node dist/src/cli/index.js status LK-101 --run-id LK-101-20260603-100000000
```

Run local quality gates for a repository:

```bash
node dist/src/cli/index.js quality ./path/to/repo --ticket-key LK-101 --run-id local-checks
```

`agentic init` copies `config/workspace.example.yml` to `config/workspace.yml`. It creates the `config` directory when needed and refuses to overwrite an existing `config/workspace.yml`.

`config/workspace.yml` is the local Milestone B workspace file. Provider sections must stay in `mock` mode, so the CLI can validate config and domain structure without Jira, GitHub, Railway, or OpenCode credentials.

`agentic plan` writes:

```text
runs/<ticket-key>/<run-id>/
  plan.md
  state.json
```

`agentic run <ticket-key>` uses mock Jira, mock GitHub, mock Railway, a deterministic mock OpenCode runner, and local-only git command simulation. It writes a complete mock run folder and stops at `PRODUCTION_PR_OPENED` so production merge remains a human-only action:

```text
runs/<ticket-key>/<run-id>/
  plan.md
  implementation-log.md
  quality-report.md
  quality-logs/
    test.stdout.log
    test.stderr.log
  staging-report.md
  final-report.md
  state.json
```

The final report summarizes the selected repositories, branch refs, implementation log path, quality outcome, develop PR, staging deployment and smoke checks, production PR, final state, and the mock-only/human approval note.

`agentic status <ticket-key> [--run-id <run-id>]` reads existing local `runs/<ticket-key>/<run-id>/state.json` files without provider credentials. When `--run-id` is omitted, it lists known runs for the ticket and selects the latest run by persisted `updatedAt` timestamp. The status output summarizes state, next action, repositories, branches, PRs, quality, staging, failures, and required human action.

Resume policy is currently exposed as library helpers only: `canResumeState(state)` and `assertStateResumable(state)`. Automatic resume is allowed for active lifecycle states from `DISCOVERED` through `STAGING_VERIFIED`. It is blocked for terminal or human-gated states: `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE`. The guard has no side effects and does not call providers, rerun commands, merge production, or trigger a resume command.

`agentic quality <repo-path> --ticket-key <ticket-key> [--run-id <run-id>]` reads `.agent-quality.yml` from the target repository or falls back to detected Node package scripts. Required gates without commands fail configuration. Optional gates without commands are recorded as skipped warning results and do not fail the run.

`agentic quality` writes:

```text
runs/<ticket-key>/<run-id>/
  quality-report.md
  quality-logs/
    <gate>.stdout.log
    <gate>.stderr.log
  state.json
```

Milestone G adds library interfaces for the future develop PR handoff path without adding a public CLI command. The exported helpers include deterministic `agent/<JIRA_KEY>-<short-slug>` branch naming, a local-only git adapter with an injectable argument-array command runner, a mock GitHub connector, a develop PR body builder, and state helpers for `BRANCH_CREATED`, `PUSHED`, and `PR_TO_DEVELOP_OPENED`.

Milestone H adds library interfaces for the future Railway staging verification path without adding a public CLI command. The exported helpers include a future-shaped Railway connector interface, deterministic `MockRailwayConnector`, `SmokeUrlVerifier` interface, deterministic `MockSmokeUrlVerifier`, `runStagingVerification(...)`, staging state helpers for `STAGING_DEPLOYING`, `STAGING_VERIFIED`, and failed staging outcomes, and a production pull request readiness guard that accepts only `STAGING_VERIFIED` runs. Staging verification writes `runs/<ticket-key>/<run-id>/staging-report.md` through `MarkdownReportWriter.writeStaging(...)`.

Milestone I adds the public mock `agentic run <ticket-key>` path, deterministic `MockOpenCodeRunner`, production PR preparation helper, production PR body builder, `PRODUCTION_PR_OPENED` state recording, and final report writer. The command is still mock-only and prepares a production PR ref for human review without real provider calls, remote pushes, production merge, or production deployment.

Milestone J adds the public local `agentic status <ticket-key> [--run-id <run-id>]` path, run-state lookup/listing/latest-selection helpers, concise Markdown status rendering, and deterministic `getNextActionForState(...)` guidance for every delivery lifecycle state. It does not resume or trigger side effects; resumability policy is reserved for Milestone K.

Milestone K adds the resume guard policy with `canResumeState(...)` and `assertStateResumable(...)`. The policy covers every delivery lifecycle state and prevents automatic continuation from `FAILED`, `NEEDS_HUMAN`, `SKIPPED`, `PRODUCTION_PR_OPENED`, and `DONE`. No resume command or live provider action is added in this milestone.

Repository entries in `config/workspace.yml` can define staging smoke checks with `staging_smoke_urls`. Use an empty array to intentionally skip smoke checks for a repository:

```yaml
repos:
  - name: api
    staging_smoke_urls:
      - /health
```

## Operating Principles

- Jira is the source of truth for work.
- GitHub is the source of truth for code review and checks.
- Railway deploys staging from `develop` and production from `main`.
- OpenCode is the primary development runner.
- Quality gates are required before pushing work.
- Production merges require human approval.
- Every ticket run must be resumable, auditable, and reportable.
