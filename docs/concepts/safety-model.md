# Safety Model

Ewokbot is supervised delivery infrastructure. It is designed to do useful local and staging work while preserving human control over production.

## Core Rules

| Rule | Meaning |
| --- | --- |
| Mock by default | New workspaces avoid live provider calls until configured. |
| Explicit confirmation | Riskier real paths require flags such as `--confirm-dev-execution` or `--confirm-real-provider-smoke`. |
| Typed ports | Provider capabilities are exposed through Ewokbot interfaces, not raw tool names. |
| MCP policy | Provider tool use is allowed, redacted, escalated, or denied through policy decisions. |
| Human production gate | Production PR merge and production deployment stay human-only. |
| Persisted state | Runs store transitions and evidence under `.ewokbot/runs/`. |

## Human-only Actions

Ewokbot must not autonomously:

- Merge production PRs.
- Deploy to production.
- Rotate or expose secrets.
- Perform destructive data operations.
- Grant itself broad provider permissions.
- Execute raw shell or raw MCP commands through UI/operator surfaces.

## Policy Modes

Workspace MCP policy can be configured as `read_only`, `supervised`, `trusted`, or `custom`. Decisions are `allow`, `allow_redacted`, `require_human`, or `deny`.

Autonomous execution proceeds only on `allow`. Unknown, secret-like, destructive, or production-sensitive actions are denied or escalated by default.

## Quality Gates

Before handoff, runs gather local evidence. Quality checks are configured through workspace quality profiles and include TypeScript/build/test-style commands where configured, plus guards for meaningful diffs, forbidden files, secret-like diffs, diff size, and safety-sensitive changes.

See [Quality Gates](../specs/quality-gates.md) for deep design.

## Status Labels

Docs use status labels consistently:

| Label | Meaning |
| --- | --- |
| Today | Implemented behavior. |
| Supervised | Implemented behind explicit flags, policy, or human approval. |
| Experimental | Narrow/local/provider-dependent behavior. |
| Roadmap-only | Planned but not implemented. |
