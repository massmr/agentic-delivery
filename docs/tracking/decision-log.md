# Decision Log

## 2026-06-03: Build A Standalone Orchestrator

Decision:

Build Ewokbot as an independent software product rather than embedding agent logic inside business repositories.

Rationale:

- It can operate across many repositories.
- It centralizes autonomy policy, logs, and quality gates.
- It can swap coding runners over time.
- It keeps product repositories clean.

## 2026-06-03: Use TypeScript And Node.js

Decision:

Use TypeScript on Node.js for the orchestrator.

Rationale:

- Strong fit for CLIs, APIs, subprocesses, and future dashboard/worker work.
- Good ecosystem for Jira, GitHub, YAML, and testing.

## 2026-06-03: Use OpenCode As The Primary Dev Runner

Decision:

Ewokbot orchestrates work and delegates implementation to OpenCode.

Rationale:

- OpenCode already covers the code editing loop.
- The orchestrator should own state, provider integrations, policies, and quality gates.

## 2026-06-03: Production Requires Human Approval

Decision:

The orchestrator may open production pull requests but must not merge them.

Rationale:

- This preserves 100% automation until production while keeping a human gate for production release.

## 2026-06-03: Start CLI-First

Decision:

Build the CLI and worker foundation before any dashboard.

Rationale:

- Reliability comes from state, retries, and quality gates.
- A dashboard is useful later but should not be the first dependency.
