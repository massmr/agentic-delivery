# Next Actions

## Immediate

1. Milestone Z from `docs/plans/approved-backlog.md` is complete.
2. No next approved milestone is currently listed after Milestone Z.
3. Do not implement unlisted work. Add proposals here first and stop before implementation.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone Z

Completed through Milestone Z. Workspace config supports `mock`, `real`, and selected `mcp` provider modes, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed, the mock-safe agent worker loop can process queued backlog tickets with concurrency, retry/backoff, escalation, durable state updates, and safe stop limits, runtime MCP wiring can resolve configured MCP servers to injected or constructed clients, Jira intake for `agentic scan` and worker backlog processing can use a runtime-injected Jira MCP `TicketPort` while preserving the mock default, `agentic worker` can start in explicit MCP mode with injected runtime clients after validating Jira/GitHub/Railway tool readiness and fallback contracts before queue processing, OpenCode execution now has a typed subprocess-first contract with safe command arguments, workspace cwd validation, environment allowlists, timeout/cancellation handling, sanitized logs, fake-executor tests, and actionable run-state/report summaries, GitHub develop handoff now uses `CodeHostPort` for branch metadata, PR creation, comments, and checks while keeping actual branch push on local git/native fallback with persistent operation-ledger idempotency under the run directory, and Railway staging verification now validates MCP deployment precision, service URL evidence, deployment status, and smoke checks before allowing production PR preparation.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work: none listed. Add any proposed post-Z work here before implementation.

Any other task must be proposed here first and must not be implemented until approved.
