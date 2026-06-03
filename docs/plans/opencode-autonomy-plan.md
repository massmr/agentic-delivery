# OpenCode Autonomy Plan

## Purpose

This plan lets OpenCode work autonomously through the build without waiting for additional product decisions.

The implementation should proceed milestone by milestone. Each milestone must leave the repository in a working state.

## Current Build Strategy

Start with a local CLI and mock connectors. Real Jira, GitHub, Railway, and OpenCode integrations should be added after the core state machine, config, reporting, and quality gate logic are stable.

## Milestone A: Repository Foundation

Build:

- `package.json`
- `tsconfig.json`
- test runner configuration
- source folder structure
- CLI entrypoint
- basic README usage section

Commands:

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

If `pnpm` is unavailable, use `npm` and document the reason.

Acceptance:

- `agentic --help` works after build.
- Tests can run with no credentials.
- No real provider calls are made.

## Milestone B: Config And Domain Model

Build:

- YAML config loader.
- Config validation.
- Domain types for tickets, repos, runs, quality gates, PRs, deployments.
- `agentic init` to copy `config/workspace.example.yml`.

Acceptance:

- Invalid config returns actionable errors.
- Example config validates.
- Unit tests cover success and failure cases.

## Milestone C: State And Reports

Build:

- Local state store.
- Run directory creation.
- State transition helpers.
- Markdown report writer.

Acceptance:

- Runs are resumable.
- State is persisted after each transition.
- Reports are deterministic and testable.

## Milestone D: Mock Jira Planning

Build:

- Jira connector interface.
- Mock Jira connector.
- `agentic scan`.
- `agentic plan <ticket>`.
- Repository resolver using configured hints.

Acceptance:

- Mock tickets can be scanned.
- Planning produces `plan.md`.
- Ambiguous repository matches become `NEEDS_HUMAN`.

## Milestone E: Quality Gates

Build:

- `.agent-quality.yml` parser.
- Package manager/script detection fallback.
- Ordered command execution.
- Quality report.

Acceptance:

- Required gate failure stops execution.
- Optional missing gates warn but do not fail.
- Logs are written per gate.

## Milestone F: OpenCode Runner Contract

Build:

- Prompt builder.
- OpenCode subprocess runner.
- Log streaming to run folder.
- Retry policy skeleton.

Acceptance:

- Runner can be tested with a harmless mock command.
- Prompt includes ticket, repo, branch, quality policy, and definition of done.
- Failures are captured in state.

## Milestone G: Git And GitHub Interfaces

Build:

- Local git adapter.
- GitHub connector interface.
- PR body builder.
- Mock GitHub connector.

Acceptance:

- Branch names are deterministic.
- PR bodies include Jira link, summary, quality status, risks.
- Real GitHub adapter can be added without changing orchestration logic.

## Milestone H: Railway Verification Interface

Build:

- Railway connector interface.
- Mock deployment status.
- Smoke URL verifier.
- Staging report writer.

Acceptance:

- Production PR can only be prepared after staging verification passes.
- Staging failures are recorded clearly.

## Milestone I: End-To-End Mock Run

Build:

- `agentic run <ticket>` through mock Jira, mock GitHub, mock Railway, and mock OpenCode.

Acceptance:

- One command creates a complete run folder.
- State reaches `PRODUCTION_PR_OPENED` in mock mode.
- The final report explains every major action.

## Default Decisions

- Use TypeScript ESM.
- Use a small CLI library.
- Use a small YAML parser.
- Use Node's built-in test runner or Vitest.
- Prefer JSON state for MVP unless SQLite becomes necessary.
- Keep external APIs behind interfaces.
- Keep mock mode first-class.
