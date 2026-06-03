# Product Spec

## Vision

Build an autonomous delivery orchestrator that processes the full Jira backlog, analyzes the relevant repositories, delegates implementation to OpenCode, verifies quality, deploys through the existing branch-based Railway flow, and prepares production pull requests for human approval.

The orchestrator is a standalone software product. It does not live inside the business applications it modifies.

## Users

Primary user:

- A technical founder or engineering lead who wants autonomous backlog execution with production control.

Secondary users:

- Developers reviewing generated pull requests.
- Operators inspecting failed runs.

## Inputs

- Jira workspace and project keys.
- GitHub organization and repositories.
- Railway projects or services mapped to repositories and branches.
- OpenCode command or API runner configuration.
- Quality gate definitions per repository.
- Autonomy policy.

## Outputs

- Ticket analysis reports.
- Technical plans.
- Branches.
- Commits.
- Pull requests to `develop`.
- Staging verification reports.
- Pull requests to `main`.
- Jira status updates and comments.
- Run logs and state records.

## Autonomy Model

The orchestrator has full autonomy until production approval.

Allowed without human approval:

- Scan Jira backlog.
- Prioritize eligible tickets.
- Infer affected repositories.
- Clone or update repositories.
- Create working branches.
- Run OpenCode.
- Create tests.
- Modify code.
- Run local quality gates.
- Commit.
- Push feature branches.
- Open pull requests to `develop`.
- Monitor GitHub checks.
- Verify Railway staging.
- Open production pull requests from `develop` to `main`.
- Comment on Jira and GitHub.

Requires human approval:

- Merging pull requests to `main`.
- Changing production deployment configuration.
- Rotating or exposing secrets.
- Performing destructive data operations.

## Ticket Lifecycle

```text
DISCOVERED
PLANNED
BRANCH_CREATED
IMPLEMENTING
LOCAL_CHECKS_RUNNING
LOCAL_CHECKS_PASSED
PUSHED
PR_TO_DEVELOP_OPENED
DEVELOP_CHECKS_PASSED
STAGING_DEPLOYING
STAGING_VERIFIED
PRODUCTION_PR_OPENED
DONE
```

Exceptional states:

```text
NEEDS_HUMAN
FAILED
SKIPPED
```

## MVP Scope

The MVP must provide a CLI-first orchestrator with:

- Workspace configuration.
- Jira backlog scan.
- Ticket planning.
- Repository matching.
- Branch creation.
- OpenCode execution wrapper.
- Quality gate runner.
- State persistence.
- Markdown run reports.
- GitHub PR creation interfaces.
- Railway staging verification interfaces.

The MVP can use mock connectors where real credentials are not yet configured, but interfaces must be production-shaped.

## Non-Goals For MVP

- Dashboard UI.
- Parallel execution across many tickets.
- Automatic production merge.
- Sophisticated ML prioritization.
- Custom workflow editor.
- Multi-tenant SaaS hosting.

## Success Criteria

- A user can configure Jira, GitHub, Railway, OpenCode, and repositories.
- A user can run a command for a Jira ticket.
- The system creates or resumes a durable run.
- The system produces a plan before implementation.
- The system can delegate implementation to OpenCode with a strict prompt.
- The system runs configured quality gates.
- The system produces a clear final report.
- Production remains gated by human PR approval.
