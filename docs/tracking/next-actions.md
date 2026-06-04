# Next Actions

## Immediate

1. Milestone Y from `docs/plans/approved-backlog.md` is the immediate next approved work: GitHub Delivery Workflow.
2. Do not implement Milestone Z or later until Milestone Y is complete and tracking is updated.
3. Do not implement unlisted work. Add proposals here first and stop before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone X

Completed through Milestone X. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, Jira intake for `agentic scan` and worker backlog processing can use a runtime-injected Jira MCP `TicketPort` while preserving the mock default, `agentic worker` can start in explicit MCP mode with injected runtime clients after validating Jira/GitHub/Railway tool readiness and fallback contracts before queue processing, and OpenCode execution now has a typed subprocess-first contract with safe command arguments, workspace cwd validation, environment allowlists, timeout/cancellation handling, sanitized logs, fake-executor tests, and actionable run-state/report summaries.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: Milestone Y, GitHub Delivery Workflow, from `docs/plans/approved-backlog.md`.

Milestone Y must keep GitHub MCP-first for create-branch, checks, pull request, and comment operations; keep actual local branch push on the native/subprocess fallback allowed by the fallback contracts; require passed quality gates before push or PR handoff; use mock MCP clients and local git test doubles in tests; avoid live GitHub calls, credentials, remote pushes in tests, production merge, and production deployment automation.

Any other task must be proposed here first and must not be implemented until approved.
