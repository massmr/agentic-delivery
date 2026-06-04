# Next Actions

## Immediate

1. Implement Milestone T from `docs/plans/approved-backlog.md`: Agent Worker Loop.
2. Use the shared MCP client foundation from Milestone O, the typed port pattern from Milestones P, Q, and R, and the Native Fallback Contracts from Milestone S.
3. Keep production merge human-only and keep credentials out of repository files and tests.

## OpenCode Prompt

Use:

```text
Read AGENTS.md, then execute docs/prompts/opencode-next-step.md.
```

## After Milestone S

Completed through Milestone S. Workspace config supports `mock` and `real` provider modes, Jira additionally supports `mode: mcp` with an injected MCP client, GitHub now supports `mode: mcp` with an injected MCP client, Railway now supports `mode: mcp` with an injected MCP client for deployment state and service URL lookups, adapter factories keep mock connectors as the default, real Jira/GitHub/Railway factories fail fast before live adapters are implemented, shared MCP client infrastructure exists without live provider calls, Jira, GitHub, and Railway MCP operations now have typed ports with audit capture and configurable tool names where applicable, and native fallback contracts explicitly define when MCP, native, subprocess, mock, and human-only surfaces are allowed.

Architecture direction changed after review and Milestone N is complete: external SaaS integrations are MCP-first, with native/subprocess/mock adapters kept as fallbacks behind typed business ports. Do not implement Jira REST as the next milestone.

Next approved work:

1. Milestone T: Agent Worker Loop

Any other task must be proposed here first and must not be implemented until approved.
