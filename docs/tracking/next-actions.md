# Next Actions

## Immediate

1. Milestone X from `docs/plans/approved-backlog.md` is the immediate next approved work: OpenCode Execution Contract.
2. Do not implement Milestone Y or later until Milestone X is complete and tracking is updated.
3. Do not implement unlisted work. Add proposals here first and stop before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone W

Completed through Milestone W. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, Jira intake for `agentic scan` and worker backlog processing can use a runtime-injected Jira MCP `TicketPort` while preserving the mock default, and `agentic worker` can start in explicit MCP mode with injected runtime clients after validating Jira/GitHub/Railway tool readiness and fallback contracts before queue processing.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: Milestone X, OpenCode Execution Contract, from `docs/plans/approved-backlog.md`.

Milestone X must keep OpenCode subprocess-first unless a future stable OpenCode MCP server is explicitly contracted, avoid real OpenCode execution in tests, avoid exposing secrets through prompts/logs/reports/state, preserve retry/escalation behavior for runner failures, keep required quality gates mandatory after runner attempts, and keep production merge and production deployment human-only.

Any other task must be proposed here first and must not be implemented until approved.
