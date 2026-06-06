# MVP Plan

## Objective

Build the first CLI version of Ewokbot. It should be capable of taking a Jira ticket key, creating a durable run, planning the work, invoking OpenCode, running quality gates, and preparing GitHub/Railway handoffs through production-shaped interfaces.

## Milestone 1: Project Foundation

Deliverables:

- TypeScript project setup.
- CLI entrypoint.
- Config loader for YAML.
- Typed domain models.
- Local state store.
- Markdown report writer.

Acceptance criteria:

- `agentic --help` works.
- `ewokbot init` creates example config.
- Config validation returns useful errors.
- State can be created, updated, and read.

## Milestone 2: Ticket Planning

Deliverables:

- Jira connector interface.
- Mock Jira connector for local development.
- `agentic scan`.
- `agentic plan <ticket>`.
- Repo resolver based on explicit config plus text inference.

Acceptance criteria:

- A ticket can be loaded from mock data.
- A plan report is generated.
- Candidate repositories are listed with confidence and reasoning.
- Ambiguous tickets enter `NEEDS_HUMAN`.

## Milestone 3: Repository And Branch Workflow

Deliverables:

- Git shell adapter.
- GitHub connector interface.
- Branch naming.
- Branch creation.
- Workspace checkout management.

Acceptance criteria:

- `agentic run <ticket>` creates a branch in the local target repo.
- Existing branches are handled idempotently.
- State records branch names and repo paths.

## Milestone 4: OpenCode Runner

Deliverables:

- OpenCode subprocess runner.
- Prompt builder.
- Log capture.
- Retry policy.
- Result parser or final report protocol.

Acceptance criteria:

- The orchestrator can call OpenCode with a generated prompt.
- OpenCode receives ticket, repo, branch, quality policy, and definition of done.
- Logs are stored under the run directory.
- Failures are captured with actionable messages.

## Milestone 5: Quality Gates

Deliverables:

- `.agent-quality.yml` parser.
- Quality profile fallback.
- Command runner.
- Quality report.
- Meaningful diff guard after agent execution.
- Post-agent diff safety policy.
- Forbidden-file, redacted secret-like diff, diff-size, and sensitive-path checks.

Acceptance criteria:

- Required gates run in order.
- A failed gate stops the workflow before push.
- Reports include command, exit code, duration, and summary.
- Agent success with no meaningful product diff does not reach local success.
- Agent-produced forbidden file or secret-like changes fail before handoff.
- Sensitive or oversized diffs enter `NEEDS_HUMAN` with a clear local safety report.

## Milestone 6: GitHub PR Interfaces

Deliverables:

- GitHub API adapter.
- PR to `develop`.
- PR body generator.
- Check status reader.

Acceptance criteria:

- The orchestrator can open a staging PR when credentials are configured.
- The PR body links Jira ticket and run reports.
- Checks are read and summarized.

## Milestone 7: Railway Staging Verification

Deliverables:

- Railway connector interface.
- Deployment status polling.
- Smoke URL verification.
- Staging report.

Acceptance criteria:

- The orchestrator can wait for a staging deployment for `develop`.
- Smoke checks are executed.
- A production PR is prepared only after staging verification passes.

## Milestone 8: Production PR Gate

Deliverables:

- PR from `develop` to `main`.
- Production PR body.
- Human approval note.

Acceptance criteria:

- The system opens a production PR but never merges it.
- The PR includes staging evidence, quality results, risk notes, and rollback notes.

## Initial Command Set

```bash
ewokbot init
agentic scan
agentic plan JIRA-123
agentic run JIRA-123
agentic status JIRA-123
agentic verify-staging JIRA-123
```

## Implementation Order For OpenCode

1. Build project foundation.
2. Add config and state.
3. Add mock Jira and mock GitHub/Railway connectors.
4. Add planning flow.
5. Add quality gate runner.
6. Add OpenCode runner.
7. Add real Jira connector.
8. Add real GitHub connector.
9. Add real Railway connector.
