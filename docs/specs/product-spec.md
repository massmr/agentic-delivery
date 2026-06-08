# Product Spec

## Vision

Build an autonomous delivery orchestrator that processes the full Jira backlog, analyzes the relevant repositories, delegates implementation to OpenCode, verifies quality, monitors staging through Railway and/or Vercel, and prepares production pull requests for human approval.

The orchestrator is a standalone software product. It does not live inside the business applications it modifies.

The target product is an npm-installable CLI that can be configured once and then left running on a VPS. Operators should be able to control it from the terminal first, with chat-based controls such as Telegram or WhatsApp reserved for later interfaces over the same command model.

## Users

Primary user:

- A technical founder or engineering lead who wants autonomous backlog execution with production control.

Secondary users:

- Developers reviewing generated pull requests.
- Operators inspecting failed runs.
- Solo builders running Ewokbot continuously on a VPS.

## Inputs

- Jira workspace and project keys.
- GitHub repositories discovered from local workspace git remotes.
- Railway and/or Vercel projects mapped to repositories and branches.
- OpenCode command or API runner configuration.
- Optional oh-my-openagent setup.
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
- Verify Railway and/or Vercel staging.
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
- Interactive first-run onboarding.
- Local readiness checks.
- Jira backlog scan.
- Ticket planning.
- Repository matching.
- Branch creation.
- OpenCode execution wrapper.
- Quality gate runner.
- State persistence.
- Markdown run reports.
- GitHub PR creation interfaces.
- Railway and Vercel staging/CI verification interfaces.

The MVP can use mock connectors where real credentials are not yet configured, but interfaces must be production-shaped.

## Non-Goals For MVP

- Dashboard UI.
- Telegram or WhatsApp control.
- Parallel execution across many tickets.
- Automatic production merge.
- Sophisticated ML prioritization.
- Custom workflow editor.
- Multi-tenant SaaS hosting.

## Success Criteria

- A user can configure Jira, GitHub, Railway and/or Vercel, OpenCode, and repositories.
- A user can run Ewokbot on a VPS without relying on their personal laptop.
- A user can run a command for a Jira ticket.
- The system creates or resumes a durable run.
- The system produces a plan before implementation.
- The system can delegate implementation to OpenCode with a strict prompt.
- The system runs configured quality gates.
- The system produces a clear final report.
- Production remains gated by human PR approval.

## Safety Policy Direction

Ewokbot must become a verifier around coding agents, not only a runner. OpenCode or another `DevAgentPort` may produce code changes, but Ewokbot owns the decision about whether those changes can proceed.

The next product layer starts with a meaningful-diff guard for the controlled development path:

- inspect the files and diff produced by the coding agent;
- ignore agent/runtime artifacts such as `.omo/`, `.ewokbot/`, logs, caches, and run evidence when deciding whether product code changed;
- fail or escalate an agent run that exits successfully but produces no meaningful product diff;
- persist the no-diff decision before local success or later handoff can be considered.

After that, the core safety loop expands the decision model:

- inspect the files and diff produced by the coding agent;
- fail forbidden file changes such as `.env`, credentials, private keys, and Ewokbot-owned auth/config files;
- scan changed diff content for secret-like additions without printing matched values;
- escalate oversized diffs and sensitive domains such as dependencies, migrations, auth, payments, and infrastructure to `NEEDS_HUMAN`;
- persist a local safety report before any later PR, staging, or production handoff can be considered.
