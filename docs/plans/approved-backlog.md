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

### Milestone N: Real Jira Adapter

Goal:

Read Jira backlog and tickets through the Jira REST API.

Build only after Milestone M is approved and complete.

### Milestone O: Real GitHub Adapter

Goal:

Create branches and pull requests through GitHub APIs and local git handoff.

Build only after Milestone M is approved and complete.

### Milestone P: Real Railway Adapter

Goal:

Read Railway deployment state and service URLs for staging verification.

Build only after Milestone M is approved and complete.

### Milestone Q: Worker Loop

Goal:

Run the backlog processor continuously with queueing, concurrency limits, and escalation policy.

Build only after real provider adapters are individually tested.
