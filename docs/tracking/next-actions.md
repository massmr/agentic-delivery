# Next Actions

## Immediate

1. Implement Milestone S from `docs/plans/approved-backlog.md`: Native Fallback Contracts.
2. Use the shared MCP client foundation from Milestone O and the typed port pattern from Milestones P, Q, and R.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone M

Completed through Milestone R. Workspace config supports `mock` and `real` provider modes, Jira additionally supports `mode: mcp` with an injected MCP client, GitHub now supports `mode: mcp` with an injected MCP client, Railway now supports `mode: mcp` with an injected MCP client for deployment state and service URL lookups, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, and Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work:

1. Milestone S: Native Fallback Contracts
2. Milestone T: Agent Worker Loop

Any other task must be proposed here first and must not be implemented until approved.
