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

This repository now includes the config, domain, state, report, mock planning, and local quality-gate foundation for the orchestrator. It can initialize and validate a local workspace configuration, scan deterministic mock Jira backlog tickets, plan one ticket, select candidate repositories, run local repository quality gates, and write resumable run state without provider credentials.

The current implementation is still local and mock-only. It makes no real Jira, GitHub, Railway, or OpenCode provider calls.

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

## Operating Principles

- Jira is the source of truth for work.
- GitHub is the source of truth for code review and checks.
- Railway deploys staging from `develop` and production from `main`.
- OpenCode is the primary development runner.
- Quality gates are required before pushing work.
- Production merges require human approval.
- Every ticket run must be resumable, auditable, and reportable.
